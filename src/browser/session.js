import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DeepSeekEyesError, errorMessage } from '../error.js'
import { launchBrowser } from './launch.js'
import { browserActionNeedsState, reportableBrowserArgs } from './protocol.js'

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function boundedPush(array, value, maximum = 100) {
  array.push(value)
  if (array.length > maximum) array.splice(0, array.length - maximum)
}

function cleanName(value, fallback) {
  const rendered = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  return rendered === '' ? fallback : rendered
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function serializeExpected(value) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function targetSummary(args) {
  for (const key of ['ref', 'selector']) {
    if (args[key] !== undefined) return { [key]: args[key] }
  }
  if (args.role !== undefined) {
    return { role: args.role, ...(args.name === undefined ? {} : { name: args.name }) }
  }
  for (const key of ['name', 'text']) {
    if (args[key] !== undefined) return { [key]: args[key] }
  }
  if (args.x !== undefined) return { x: args.x, y: args.y }
  return undefined
}

function observationText(result) {
  const copy = structuredClone(result)
  delete copy.image
  return `[DeepSeekEyes browser state]\n${JSON.stringify(copy, null, 2)}`
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/** Project a canonical browser result into text plus its screenshot attachment. */
export function renderBrowserResult(value) {
  const content = [{ type: 'text', text: observationText(value) }]
  if (value.image !== undefined) content.push({ type: 'image', attachment: value.image })
  return content
}

export class BrowserSession {
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.chromiumApi = options.chromiumApi
    this.now = options.now ?? (() => new Date())
    this.runId = options.runId ?? randomUUID()
    this.sessionId = String(options.sessionId ?? 'default')
    this.browser = undefined
    this.context = undefined
    this.page = undefined
    this.launchInfo = undefined
    this.latest = undefined
    this.latestRefs = new Map()
    this.sequence = 0
    this.createdAt = this.now().toISOString()
    this.closedAt = undefined
    this.events = []
    this.assertions = []
    this.observations = []
    this.consoleMessages = []
    this.pageErrors = []
    this.requestFailures = []
  }

  get closed() {
    return this.browser === undefined && this.closedAt !== undefined
  }

  browserIsConnected() {
    return this.browser !== undefined
      && (typeof this.browser.isConnected !== 'function' || this.browser.isConnected())
  }

  clearLiveState() {
    this.browser = undefined
    this.context = undefined
    this.page = undefined
    this.latest = undefined
    this.latestRefs.clear()
  }

  async releaseBrowser(markClosed = false) {
    const browser = this.browser
    const context = this.context
    this.clearLiveState()
    if (markClosed) this.closedAt = this.now().toISOString()
    await Promise.allSettled([
      context?.close(),
      browser?.close(),
    ].filter(Boolean))
  }

  async ensure(signal) {
    if (this.browserIsConnected() && this.page !== undefined && !this.page.isClosed()) return
    if (this.browser !== undefined || this.context !== undefined || this.page !== undefined) {
      await this.releaseBrowser(false)
    }
    if (signal?.aborted) throw signal.reason
    const launched = await launchBrowser(this.config, signal, this.chromiumApi)
    let context
    try {
      context = await launched.browser.newContext({
        viewport: {
          width: this.config.browserViewportWidth,
          height: this.config.browserViewportHeight,
        },
        locale: this.config.browserLocale,
        acceptDownloads: true,
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()
      page.setDefaultTimeout(this.config.browserTimeoutMs)
      page.setDefaultNavigationTimeout(this.config.browserTimeoutMs)
      page.on('console', (message) => {
        if (!['warning', 'error'].includes(message.type())) return
        boundedPush(this.consoleMessages, {
          at: this.now().toISOString(),
          type: message.type(),
          text: message.text().slice(0, 4_000),
        })
      })
      page.on('pageerror', (error) => {
        boundedPush(this.pageErrors, { at: this.now().toISOString(), message: errorMessage(error).slice(0, 4_000) })
      })
      page.on('requestfailed', (request) => {
        boundedPush(this.requestFailures, {
          at: this.now().toISOString(),
          method: request.method(),
          url: request.url().slice(0, 2_000),
          failure: request.failure()?.errorText ?? 'unknown request failure',
        })
      })
      launched.browser.on?.('disconnected', () => {
        if (this.browser !== launched.browser) return
        this.clearLiveState()
      })
      this.browser = launched.browser
      this.context = context
      this.page = page
      this.launchInfo = launched.launch
      this.closedAt = undefined
    } catch (error) {
      await Promise.allSettled([
        context?.close(),
        launched.browser.close(),
      ].filter(Boolean))
      throw error
    }
  }

  requirePage() {
    if (this.page === undefined || this.page.isClosed()) {
      throw new DeepSeekEyesError('browser session is not open; call browser action open first', 'BROWSER_NOT_OPEN')
    }
    return this.page
  }

  requireCurrentState(stateId) {
    if (this.latest === undefined) {
      throw new DeepSeekEyesError('browser has no observed state; call observe first', 'BROWSER_STATE_MISSING')
    }
    return stateId === this.latest.stateId
  }

  requireCoordinateInLatestViewport(args) {
    if (args.x === undefined) return
    const viewport = this.latest?.viewport
    if (viewport === undefined) {
      throw new DeepSeekEyesError('browser coordinate target has no current viewport', 'BROWSER_STATE_MISSING')
    }
    if (args.x >= viewport.width || args.y >= viewport.height) {
      throw new DeepSeekEyesError(
        `browser coordinate (${args.x}, ${args.y}) is outside the ${viewport.width}x${viewport.height} viewport`,
        'BROWSER_COORDINATE_OUT_OF_BOUNDS',
      )
    }
  }

  locatorFor(args) {
    const page = this.requirePage()
    if (args.ref !== undefined) {
      const locator = this.latestRefs.get(args.ref)
      if (locator === undefined) {
        throw new DeepSeekEyesError(`browser element ref ${args.ref} is not present in the latest state`, 'BROWSER_REF_NOT_FOUND')
      }
      return locator
    }
    if (args.selector !== undefined) return page.locator(args.selector)
    if (args.role !== undefined) {
      return page.getByRole(args.role, {
        ...(args.name === undefined ? {} : { name: args.name }),
        exact: args.exact ?? false,
      })
    }
    if (args.text !== undefined) return page.getByText(args.text, { exact: args.exact ?? false })
    if (args.name !== undefined) return page.getByText(args.name, { exact: args.exact ?? false })
    return undefined
  }

  async settle(page) {
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(this.config.browserTimeoutMs, 2_000) }).catch(() => {})
    if (this.config.browserSettleMs > 0) await page.waitForTimeout(this.config.browserSettleMs)
  }

  async collectDom(page) {
    return page.evaluate(({ selector, maximum, textMaximum }) => {
      const roleFor = (element) => {
        const declared = element.getAttribute('role')
        if (declared) return declared
        const tag = element.tagName.toLowerCase()
        if (tag === 'a') return 'link'
        if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(element.type))) return 'button'
        if (tag === 'input' && element.type === 'checkbox') return 'checkbox'
        if (tag === 'input' && element.type === 'radio') return 'radio'
        if (tag === 'select') return 'combobox'
        if (tag === 'textarea' || tag === 'input' || element.isContentEditable) return 'textbox'
        return tag
      }
      const nameFor = (element) => {
        const labels = element.labels === undefined ? '' : [...element.labels].map(label => label.innerText).join(' ')
        return [
          element.getAttribute('aria-label'),
          labels,
          element.getAttribute('alt'),
          element.getAttribute('title'),
          element.getAttribute('placeholder'),
          element.innerText,
          ['button', 'submit', 'reset'].includes(element.type) ? element.value : '',
        ].map(value => String(value ?? '').trim()).find(Boolean) ?? ''
      }
      const nodes = [...document.querySelectorAll(selector)]
      const elements = []
      for (let domIndex = 0; domIndex < nodes.length && elements.length < maximum; domIndex += 1) {
        const element = nodes[domIndex]
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const visible = style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
        if (!visible) continue
        const inViewport = rect.bottom > 0 && rect.right > 0
          && rect.top < innerHeight && rect.left < innerWidth
        const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          || element instanceof HTMLSelectElement ? element.value : undefined
        const checked = element instanceof HTMLInputElement
          && ['checkbox', 'radio'].includes(element.type) ? element.checked : undefined
        elements.push({
          domIndex,
          tag: element.tagName.toLowerCase(),
          role: roleFor(element),
          name: nameFor(element).replace(/\s+/g, ' ').slice(0, 240),
          text: String(element.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
          type: element.getAttribute('type') ?? undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          value: element instanceof HTMLInputElement && element.type === 'password' ? undefined : value,
          checked,
          disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
          editable: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable,
          inViewport,
          bbox: {
            x: Math.round(rect.x * 100) / 100,
            y: Math.round(rect.y * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          },
        })
      }
      const fullText = String(document.body?.innerText ?? '').replace(/\r/g, '')
      return {
        documentText: fullText.slice(0, textMaximum),
        documentTextTruncated: fullText.length > textMaximum,
        interactiveTotal: nodes.length,
        elements,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        scroll: {
          x: scrollX,
          y: scrollY,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
          documentHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        },
      }
    }, {
      selector: INTERACTIVE_SELECTOR,
      maximum: this.config.browserMaxElements,
      textMaximum: this.config.browserMaxTextChars,
    })
  }

  async saveObservationArtifact(sequence, digest, screenshot) {
    if (this.config.browserArtifactsDir === undefined) return undefined
    const directory = join(this.config.browserArtifactsDir, this.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${String(sequence).padStart(4, '0')}-${digest}.png`)
    await writeFile(path, screenshot, { mode: 0o600 })
    return path
  }

  async observe(action, actionResult, signal) {
    const page = this.requirePage()
    if (signal?.aborted) throw signal.reason
    const [screenshot, dom, title] = await Promise.all([
      page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', caret: 'hide' }),
      this.collectDom(page),
      page.title(),
    ])
    const digest = sha256(screenshot)
    const nextSequence = this.sequence + 1
    const stateId = `browser-state:${sha256(Buffer.from(`${this.runId}\u0000${nextSequence}\u0000${digest}\u0000${page.url()}`))}`
    const attachmentId = `sha256:${digest}`
    const image = await this.ctx.attachments.saveImage({
      data: screenshot,
      mediaType: 'image/png',
      name: `deepseekeyes-browser-${this.runId}-${nextSequence}.png`,
    })
    if (String(image.attachmentId) !== attachmentId) {
      throw new DeepSeekEyesError(
        `browser screenshot attachment digest mismatch: ${image.attachmentId} != ${attachmentId}`,
        'BROWSER_SCREENSHOT_INTEGRITY_FAILED',
      )
    }
    this.sequence = nextSequence
    const artifactPath = await this.saveObservationArtifact(this.sequence, digest, screenshot)
    this.latestRefs.clear()
    const elements = dom.elements.map((element, index) => {
      const ref = `e${index + 1}`
      this.latestRefs.set(ref, page.locator(INTERACTIVE_SELECTOR).nth(element.domIndex))
      const { domIndex: _domIndex, ...visible } = element
      return { ref, ...visible }
    })
    const result = {
      ok: actionResult?.passed !== false && actionResult?.performed !== false,
      action,
      runId: this.runId,
      sessionId: this.sessionId,
      sequence: this.sequence,
      stateId,
      observedAt: this.now().toISOString(),
      url: page.url(),
      title,
      viewport: dom.viewport,
      scroll: dom.scroll,
      documentText: dom.documentText,
      documentTextTruncated: dom.documentTextTruncated,
      interactiveTotal: dom.interactiveTotal,
      elements,
      diagnostics: {
        consoleMessages: this.consoleMessages.slice(-20),
        pageErrors: this.pageErrors.slice(-20),
        requestFailures: this.requestFailures.slice(-20),
      },
      screenshot: {
        sha256: digest,
        bytes: screenshot.length,
        attachmentId: String(image.attachmentId),
        ...(artifactPath === undefined ? {} : { artifactPath }),
      },
      image,
      ...(actionResult === undefined ? {} : { actionResult }),
    }
    this.latest = result
    this.observations.push({
      sequence: result.sequence,
      stateId,
      observedAt: result.observedAt,
      url: result.url,
      title: result.title,
      screenshot: result.screenshot,
      action,
    })
    return result
  }

  async staleResult(args, signal) {
    return this.observe(args.action, {
      performed: false,
      code: 'STALE_BROWSER_STATE',
      receivedStateId: args.stateId,
      latestStateId: this.latest?.stateId,
      message: 'Action was not executed. Repeat it with this observation stateId.',
    }, signal)
  }

  async performTargetAction(args) {
    const page = this.requirePage()
    const timeout = args.timeoutMs ?? this.config.browserTimeoutMs
    const locator = this.locatorFor(args)
    switch (args.action) {
      case 'click':
        if (args.x !== undefined) {
          await page.mouse.click(args.x, args.y, { button: args.button ?? 'left' })
        } else {
          await locator.first().click({ button: args.button ?? 'left', timeout })
        }
        return { performed: true, target: targetSummary(args) }
      case 'type':
        if (args.x !== undefined) {
          await page.mouse.click(args.x, args.y)
          await page.keyboard.type(args.value)
        } else {
          await locator.first().fill(args.value, { timeout })
        }
        if (args.submit) await page.keyboard.press('Enter')
        return { performed: true, target: targetSummary(args), submitted: args.submit ?? false, valueLength: args.value.length }
      case 'press':
        if (locator === undefined) await page.keyboard.press(args.key)
        else await locator.first().press(args.key, { timeout })
        return { performed: true, target: targetSummary(args), key: args.key }
      case 'select': {
        const selected = await locator.first().selectOption(args.value, { timeout })
        return { performed: true, target: targetSummary(args), selected }
      }
      case 'check':
        await locator.first().check({ timeout })
        return { performed: true, target: targetSummary(args), checked: true }
      case 'uncheck':
        await locator.first().uncheck({ timeout })
        return { performed: true, target: targetSummary(args), checked: false }
      default:
        throw new DeepSeekEyesError(`unsupported target action ${args.action}`, 'BROWSER_ACTION_UNSUPPORTED')
    }
  }

  async performWait(args) {
    const page = this.requirePage()
    const timeout = args.timeoutMs ?? (args.waitFor === 'timeout' ? 1_000 : this.config.browserTimeoutMs)
    switch (args.waitFor) {
      case 'timeout':
        await page.waitForTimeout(timeout)
        break
      case 'networkidle':
        await page.waitForLoadState('networkidle', { timeout })
        break
      case 'text':
        await page.getByText(String(args.expected), { exact: args.exact ?? false }).first().waitFor({ state: 'visible', timeout })
        break
      case 'url':
        await page.waitForURL(url => url.href.includes(String(args.expected)), { timeout })
        break
      case 'visible':
      case 'hidden':
        await this.locatorFor(args).first().waitFor({ state: args.waitFor, timeout })
        break
      default:
        throw new DeepSeekEyesError(`unsupported browser wait ${args.waitFor}`, 'BROWSER_WAIT_UNSUPPORTED')
    }
    return { performed: true, waitFor: args.waitFor, timeoutMs: timeout }
  }

  async performAssertion(args) {
    const page = this.requirePage()
    const locator = this.locatorFor(args)
    const expected = serializeExpected(args.expected)
    let actual
    let passed
    switch (args.assertion) {
      case 'url_contains':
        actual = page.url()
        passed = actual.includes(expected)
        break
      case 'url_equals':
        actual = page.url()
        passed = actual === expected
        break
      case 'title_contains':
        actual = await page.title()
        passed = actual.includes(expected)
        break
      case 'title_equals':
        actual = await page.title()
        passed = actual === expected
        break
      case 'count_equals':
        actual = await locator.count()
        passed = actual === args.expected
        break
      case 'visible':
        actual = await locator.first().isVisible()
        passed = actual
        break
      case 'hidden':
        actual = await locator.first().isHidden()
        passed = actual
        break
      case 'enabled':
        actual = await locator.first().isEnabled()
        passed = actual
        break
      case 'disabled':
        actual = await locator.first().isDisabled()
        passed = actual
        break
      case 'checked':
        actual = await locator.first().isChecked()
        passed = actual
        break
      case 'unchecked':
        actual = await locator.first().isChecked()
        passed = !actual
        break
      case 'text_contains':
        actual = (await locator.first().innerText()).trim()
        passed = actual.includes(expected)
        break
      case 'text_equals':
        actual = (await locator.first().innerText()).trim()
        passed = actual === expected
        break
      case 'value_equals':
        actual = await locator.first().inputValue()
        passed = actual === expected
        break
      default:
        throw new DeepSeekEyesError(`unsupported assertion ${args.assertion}`, 'BROWSER_ASSERTION_UNSUPPORTED')
    }
    const assertion = {
      assertion: args.assertion,
      target: targetSummary(args),
      expected: args.expected,
      actual,
      passed,
      at: this.now().toISOString(),
    }
    this.assertions.push(assertion)
    return assertion
  }

  async writeReport(name) {
    const actionFailures = this.events.filter(event =>
      event.error !== undefined || (event.action !== 'assert' && event.result?.ok === false))
    const summary = {
      runId: this.runId,
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      generatedAt: this.now().toISOString(),
      launch: this.launchInfo,
      passed: this.assertions.every(assertion => assertion.passed) && actionFailures.length === 0,
      assertionCount: this.assertions.length,
      assertionFailures: this.assertions.filter(assertion => !assertion.passed).length,
      actionFailureCount: actionFailures.length,
      eventCount: this.events.length,
      observations: this.observations,
      assertions: this.assertions,
      events: this.events,
      diagnostics: {
        consoleMessages: this.consoleMessages,
        pageErrors: this.pageErrors,
        requestFailures: this.requestFailures,
      },
    }
    if (this.config.browserArtifactsDir === undefined) return { summary }
    const directory = join(this.config.browserArtifactsDir, this.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${cleanName(name, 'report')}.json`)
    await writeJsonAtomic(path, summary)
    return { path, summary }
  }

  async execute(args, signal) {
    if (signal?.aborted) throw signal.reason
    const started = Date.now()
    let abortClose
    const onAbort = () => {
      abortClose ??= this.close()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const event = {
      action: args.action,
      args: reportableBrowserArgs(args),
      startedAt: this.now().toISOString(),
    }
    try {
      if (args.action === 'close') {
        await this.close()
        const result = {
          ok: true,
          action: 'close',
          runId: this.runId,
          sessionId: this.sessionId,
          sequence: this.sequence,
          closed: true,
          closedAt: this.closedAt,
        }
        event.result = { ok: true, closed: true }
        return result
      }

      await this.ensure(signal)
      const page = this.requirePage()
      if (browserActionNeedsState(args.action) && !this.requireCurrentState(args.stateId)) {
        const result = await this.staleResult(args, signal)
        event.result = { ok: false, code: 'STALE_BROWSER_STATE', stateId: result.stateId }
        return result
      }
      this.requireCoordinateInLatestViewport(args)

      let actionResult
      switch (args.action) {
        case 'open':
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs ?? this.config.browserTimeoutMs })
          actionResult = { performed: true, url: page.url() }
          break
        case 'observe':
          actionResult = { performed: true }
          break
        case 'click':
        case 'type':
        case 'press':
        case 'select':
        case 'check':
        case 'uncheck':
          actionResult = await this.performTargetAction(args)
          break
        case 'scroll': {
          const locator = this.locatorFor(args)
          if (locator !== undefined) {
            await locator.first().hover({ timeout: args.timeoutMs ?? this.config.browserTimeoutMs })
          } else if (args.x !== undefined) {
            await page.mouse.move(args.x, args.y)
          }
          await page.mouse.wheel(args.deltaX ?? 0, args.deltaY ?? 600)
          actionResult = { performed: true, deltaX: args.deltaX ?? 0, deltaY: args.deltaY ?? 600, target: targetSummary(args) }
          break
        }
        case 'wait':
          actionResult = await this.performWait(args)
          break
        case 'assert':
          actionResult = await this.performAssertion(args)
          break
        case 'back':
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: args.timeoutMs ?? this.config.browserTimeoutMs })
          actionResult = { performed: true }
          break
        case 'forward':
          await page.goForward({ waitUntil: 'domcontentloaded', timeout: args.timeoutMs ?? this.config.browserTimeoutMs })
          actionResult = { performed: true }
          break
        case 'reload':
          await page.reload({ waitUntil: 'domcontentloaded', timeout: args.timeoutMs ?? this.config.browserTimeoutMs })
          actionResult = { performed: true }
          break
        case 'report': {
          const observed = await this.observe('report', { performed: true }, signal)
          const report = await this.writeReport(args.reportName)
          observed.report = {
            ...(report.path === undefined ? {} : { path: report.path }),
            passed: report.summary.passed,
            assertionCount: report.summary.assertionCount,
            assertionFailures: report.summary.assertionFailures,
            actionFailureCount: report.summary.actionFailureCount,
          }
          event.result = { ok: observed.ok, stateId: observed.stateId, report: observed.report }
          return observed
        }
        default:
          throw new DeepSeekEyesError(`unsupported browser action ${args.action}`, 'BROWSER_ACTION_UNSUPPORTED')
      }
      if (!['observe', 'assert'].includes(args.action)) await this.settle(page)
      const result = await this.observe(args.action, actionResult, signal)
      event.result = {
        ok: result.ok,
        stateId: result.stateId,
        ...(actionResult?.passed === undefined ? {} : { assertionPassed: actionResult.passed }),
      }
      return result
    } catch (error) {
      event.error = { message: errorMessage(error), code: error?.code }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (abortClose !== undefined) await abortClose.catch(() => {})
      event.durationMs = Date.now() - started
      event.finishedAt = this.now().toISOString()
      this.events.push(event)
    }
  }

  async close() {
    await this.releaseBrowser(true)
  }
}

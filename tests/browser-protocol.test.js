import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import {
  BROWSER_SYSTEM_PROMPT,
  applyBrowserComputerUse,
  BrowserSession,
  BrowserSessionManager,
  createBrowserTool,
  launchBrowser,
  parseBrowserArgs,
  renderBrowserResult,
  reportableBrowserArgs,
} from '../src/browser/index.js'
import { mockContext } from './_helpers.js'

test('browser protocol normalizes navigation and requires current state for actions', () => {
  const opened = parseBrowserArgs({ action: 'OPEN', url: 'https://example.com/path' })
  assert.equal(opened.action, 'open')
  assert.equal(opened.url, 'https://example.com/path')
  assert.throws(() => parseBrowserArgs({ action: 'click', ref: 'e1' }), /latest stateId/)
  assert.throws(
    () => parseBrowserArgs({ action: 'click', stateId: 'sha256:x', x: 10 }),
    /both x and y/,
  )
  assert.throws(
    () => parseBrowserArgs({ action: 'click', stateId: 'sha256:x', x: -1, y: 0 }),
    /non-negative/,
  )
  assert.throws(
    () => parseBrowserArgs({ action: 'check', stateId: 'sha256:x', x: 1, y: 1 }),
    /requires ref, selector, role\/name, or text/,
  )
  assert.throws(
    () => parseBrowserArgs({ action: 'assert', stateId: 'sha256:x', x: 1, y: 1, assertion: 'visible' }),
    /requires ref, selector, role\/name, or text/,
  )
})

test('browser rejects screenshot coordinates outside the latest viewport', () => {
  const config = resolveConfig({ browserArtifactsDir: false }, {}, '/tmp')
  const session = new BrowserSession(mockContext(), config)
  session.latest = { viewport: { width: 1280, height: 800 } }
  assert.doesNotThrow(() => session.requireCoordinateInLatestViewport({ x: 1279, y: 799 }))
  assert.throws(
    () => session.requireCoordinateInLatestViewport({ x: 1280, y: 799 }),
    error => error.code === 'BROWSER_COORDINATE_OUT_OF_BOUNDS',
  )
})

test('browser report fails when a prior action returned an error', async () => {
  const config = resolveConfig({ browserArtifactsDir: false }, {}, '/tmp')
  const session = new BrowserSession(mockContext(), config)
  session.events.push({ action: 'click', result: { ok: false, code: 'STALE_BROWSER_STATE' } })
  const report = await session.writeReport('unit-report')
  assert.equal(report.summary.passed, false)
  assert.equal(report.summary.actionFailureCount, 1)
})

test('browser session replaces and closes a disconnected or closed browser before relaunch', async () => {
  const launched = []
  const chromiumApi = {
    async launch() {
      const page = {
        closed: false,
        isClosed() { return this.closed },
        setDefaultTimeout() {},
        setDefaultNavigationTimeout() {},
        on() {},
      }
      const context = {
        closeCalls: 0,
        async newPage() { return page },
        async close() { this.closeCalls += 1 },
      }
      const browser = {
        connected: true,
        closeCalls: 0,
        handlers: new Map(),
        isConnected() { return this.connected },
        async newContext() { return context },
        on(event, listener) { this.handlers.set(event, listener) },
        async close() {
          this.closeCalls += 1
          this.connected = false
          this.handlers.get('disconnected')?.()
        },
      }
      const value = { browser, context, page }
      launched.push(value)
      return browser
    },
  }
  const config = resolveConfig({ browserArtifactsDir: false }, {}, '/tmp')
  const session = new BrowserSession(mockContext(), config, { chromiumApi })
  const signal = new AbortController().signal
  await session.ensure(signal)
  session.latest = { stateId: 'browser-state:old', viewport: { width: 1280, height: 800 } }
  session.latestRefs.set('e1', {})
  launched[0].page.closed = true
  await session.ensure(signal)
  assert.equal(launched.length, 2)
  assert.equal(launched[0].context.closeCalls, 1)
  assert.equal(launched[0].browser.closeCalls, 1)
  assert.equal(session.latest, undefined)
  assert.equal(session.latestRefs.size, 0)
  assert.equal(session.browser, launched[1].browser)
  await session.close()
  assert.equal(launched[1].browser.closeCalls, 1)
  assert.equal(session.closed, true)
})

test('browser launcher tries installed Edge first on Windows', async () => {
  const attempts = []
  const browser = { async close() {} }
  const chromiumApi = {
    async launch(options) {
      attempts.push(options)
      return browser
    },
  }
  const config = resolveConfig({ browserArtifactsDir: false, browserHeadless: true }, {}, '/tmp')
  const launched = await launchBrowser(config, new AbortController().signal, chromiumApi, 'win32')
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].channel, 'msedge')
  assert.equal(attempts[0].headless, true)
  assert.equal(launched.browser, browser)
})

test('browser report arguments hash typed values instead of retaining their text', () => {
  const args = parseBrowserArgs({
    action: 'type',
    stateId: 'sha256:test',
    ref: 'e1',
    value: 'example-secret',
  })
  const reportable = reportableBrowserArgs(args)
  assert.equal(reportable.value, undefined)
  assert.equal(reportable.valueLength, 14)
  assert.match(reportable.valueSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(reportable).includes('example-secret'), false)
})

test('browser 0.2 configuration is opt-in and supports Windows-style explicit browser settings', () => {
  const defaults = resolveConfig({}, {}, '/home')
  assert.equal(defaults.browserComputerUse, false)
  assert.equal(defaults.browserHeadless, false)
  assert.equal(defaults.browserViewportWidth, 1440)
  assert.equal(defaults.browserArtifactsDir, join('/home', '.dsh', 'deepseekeyes', 'browser-runs'))
  const configured = resolveConfig({
    browserChannel: 'msedge',
    browserHeadless: true,
    browserArtifactsDir: false,
  }, {}, '/home')
  assert.equal(configured.browserChannel, 'msedge')
  assert.equal(configured.browserHeadless, true)
  assert.equal(configured.browserArtifactsDir, undefined)
})

test('browser manager applies live configuration, removes disabled tools, and blocks direct calls', async () => {
  const ctx = mockContext()
  const enabled = resolveConfig({ browserArtifactsDir: false, browserComputerUse: true }, {}, '/tmp')
  const manager = applyBrowserComputerUse(ctx, enabled)
  assert.ok(ctx.tools.get('browser'))
  assert.ok(ctx.systemPrompt.sections.has('deepseekeyes:browser-computer-use'))
  manager.reconfigure(resolveConfig({ browserArtifactsDir: false, browserComputerUse: false }, {}, '/tmp'))
  assert.equal(ctx.tools.get('browser'), undefined)
  assert.equal(ctx.systemPrompt.sections.has('deepseekeyes:browser-computer-use'), false)
  await assert.rejects(
    manager.execute({ action: 'open', url: 'https://example.com' }, { signal: new AbortController().signal }),
    error => error.code === 'BROWSER_COMPUTER_USE_DISABLED',
  )
  manager.reconfigure(enabled)
  assert.ok(ctx.tools.get('browser'))
  assert.ok(ctx.systemPrompt.sections.has('deepseekeyes:browser-computer-use'))
  const reenabledTool = ctx.tools.get('browser')
  const longerTimeout = resolveConfig({
    browserArtifactsDir: false,
    browserComputerUse: true,
    browserTimeoutMs: 120_000,
  }, {}, '/tmp')
  manager.reconfigure(longerTimeout)
  assert.notEqual(ctx.tools.get('browser'), reenabledTool)
  assert.equal(ctx.tools.get('browser').timeoutMs, 135_000)
})

test('browser tool returns screenshot content and rejects non-DeepSeekEyes agent routes', async () => {
  const ctx = mockContext()
  const config = resolveConfig({ browserArtifactsDir: false, browserComputerUse: true }, {}, '/tmp')
  const manager = new BrowserSessionManager(ctx, config)
  const tool = createBrowserTool(manager, config)
  const content = renderBrowserResult({
    ok: true,
    action: 'observe',
    stateId: 'sha256:test',
    image: { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
  })
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image')
  assert.match(BROWSER_SYSTEM_PROMPT, /stateId/)
  await assert.rejects(
    tool.execute(
      { action: 'open', url: 'https://example.com' },
      {
        signal: new AbortController().signal,
        agent: {
          id: 'session-1',
          options: { provider: 'deepseek-official' },
          session: { requestHeader: () => ({ config: { provider: 'deepseek-official' } }) },
        },
      },
    ),
    error => error.code === 'BROWSER_REQUIRES_DEEPSEEKEYES',
  )
})

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DESKTOP_STATE_PREFIX } from '../content.js'
import { DeepSeekEyesError, errorMessage } from '../error.js'
import { createDesktopDriver } from './driver.js'
import { losslessDesktopPngTiles } from './png-tiles.js'
import { desktopActionNeedsState, reportableDesktopArgs } from './protocol.js'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function cleanName(value, fallback) {
  const rendered = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  return rendered === '' ? fallback : rendered
}

function pngSize(buffer) {
  const signature = '89504e470d0a1a0a'
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new DeepSeekEyesError('native desktop screenshot is not a valid PNG', 'DESKTOP_SCREENSHOT_INVALID')
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width <= 0 || height <= 0) {
    throw new DeepSeekEyesError('native desktop screenshot has invalid dimensions', 'DESKTOP_SCREENSHOT_INVALID')
  }
  return { width, height }
}

function valueOf(value, lower, upper) {
  return value?.[lower] ?? value?.[upper]
}

function normalizeWindow(value) {
  if (value === undefined || value === null) return undefined
  const nativeId = String(valueOf(value, 'nativeId', 'NativeId') ?? '')
  const application = String(valueOf(value, 'application', 'Application') ?? 'unknown').slice(0, 200)
  const title = String(valueOf(value, 'title', 'Title') ?? application).slice(0, 500)
  const number = field => {
    const raw = Number(valueOf(value, field, field[0].toUpperCase() + field.slice(1)))
    return Number.isFinite(raw) ? raw : undefined
  }
  return {
    nativeId,
    pid: number('pid'),
    application,
    title,
    active: Boolean(valueOf(value, 'active', 'Active')),
    x: number('x'),
    y: number('y'),
    width: number('width'),
    height: number('height'),
    index: number('index'),
  }
}

function modelWindow(value, ref) {
  return Object.fromEntries(Object.entries({
    ref,
    pid: value.pid,
    application: value.application,
    title: value.title,
    active: value.active,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }).filter(([, field]) => field !== undefined))
}

function observationText(result) {
  const copy = structuredClone(result)
  delete copy.image
  delete copy.images
  return `${DESKTOP_STATE_PREFIX}${JSON.stringify(copy, null, 2)}`
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/** Render one state as compact JSON evidence plus the exact native screenshot. */
export function renderDesktopResult(value) {
  const content = [{ type: 'text', text: observationText(value) }]
  const images = Array.isArray(value.images)
    ? value.images
    : value.image === undefined ? [] : [value.image]
  for (const attachment of images) content.push({ type: 'image', attachment })
  return content
}

export class DesktopSession {
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.now = options.now ?? (() => new Date())
    this.runId = options.runId ?? randomUUID()
    this.sessionId = String(options.sessionId ?? 'default')
    this.driver = options.driver ?? createDesktopDriver(config, options.driverOptions)
    this.sequence = 0
    this.latest = undefined
    this.latestWindows = new Map()
    this.events = []
    this.assertions = []
    this.observations = []
    this.createdAt = this.now().toISOString()
    this.closedAt = undefined
  }

  get closed() {
    return this.closedAt !== undefined
  }

  requireCurrentState(stateId) {
    if (this.latest === undefined) {
      throw new DeepSeekEyesError('computer has no observed state; call computer action observe first', 'DESKTOP_STATE_MISSING')
    }
    return stateId === this.latest.stateId
  }

  requireCoordinateInLatestScreen(args) {
    const fields = [['x', 'y'], ['endX', 'endY']]
    for (const [xField, yField] of fields) {
      if (args[xField] === undefined) continue
      const screen = this.latest?.screen
      if (screen === undefined) {
        throw new DeepSeekEyesError('computer coordinate has no current screen', 'DESKTOP_STATE_MISSING')
      }
      if (args[xField] >= screen.width || args[yField] >= screen.height) {
        throw new DeepSeekEyesError(
          `computer coordinate (${args[xField]}, ${args[yField]}) is outside the ${screen.width}x${screen.height} screenshot`,
          'DESKTOP_COORDINATE_OUT_OF_BOUNDS',
        )
      }
    }
  }

  resolveNativeWindow(args) {
    if (args.windowRef === undefined) return undefined
    const found = this.latestWindows.get(args.windowRef)
    if (found === undefined) {
      throw new DeepSeekEyesError(
        `computer window ref ${args.windowRef} is not present in the latest state`,
        'DESKTOP_WINDOW_REF_NOT_FOUND',
      )
    }
    return found
  }

  async saveScreenshot(sequence, digest, screenshot) {
    if (this.config.desktopArtifactsDir === undefined) return undefined
    const directory = join(this.config.desktopArtifactsDir, cleanName(this.sessionId, 'session'), this.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${String(sequence).padStart(4, '0')}-${digest.slice(0, 16)}.png`)
    await writeFile(path, screenshot, { mode: 0o600 })
    return path
  }

  async observe(action, args, native, event) {
    const screenshot = native.screenshot
    const dimensions = pngSize(screenshot)
    const digest = sha256(screenshot)
    const tiled = losslessDesktopPngTiles(screenshot)
    if (tiled.width !== dimensions.width || tiled.height !== dimensions.height) {
      throw new DeepSeekEyesError('desktop screenshot dimensions changed during lossless tiling', 'DESKTOP_SCREENSHOT_INVALID')
    }
    this.sequence += 1
    const windows = (native.windows ?? [])
      .map(normalizeWindow)
      .filter(Boolean)
      .slice(0, this.config.desktopMaxWindows)
    this.latestWindows.clear()
    const modelWindows = windows.map((window, index) => {
      const ref = `win_${index + 1}`
      this.latestWindows.set(ref, window)
      return modelWindow(window, ref)
    })
    const helperScreen = native.screen ?? {}
    const screen = {
      x: Number.isFinite(Number(helperScreen.x)) ? Number(helperScreen.x) : 0,
      y: Number.isFinite(Number(helperScreen.y)) ? Number(helperScreen.y) : 0,
      width: dimensions.width,
      height: dimensions.height,
      scaleFactor: Number.isFinite(Number(helperScreen.scaleFactor)) ? Number(helperScreen.scaleFactor) : 1,
    }
    const stateId = `desktop-state:${sha256(Buffer.from(`${this.runId}\u0000${this.sequence}\u0000${digest}\u0000${native.platform}`))}`
    const images = []
    const tileRecords = []
    for (let index = 0; index < tiled.tiles.length; index += 1) {
      const tile = tiled.tiles[index]
      const tileDigest = sha256(tile.data)
      const image = await this.ctx.attachments.saveImage({
        data: tile.data,
        mediaType: 'image/png',
        width: tile.width,
        height: tile.height,
        name: tiled.tiles.length === 1
          ? `desktop-${this.sequence}.png`
          : `desktop-${this.sequence}-tile-${index + 1}-x${tile.x}-y${tile.y}.png`,
      })
      const expectedAttachmentId = `sha256:${tileDigest}`
      if (String(image.attachmentId) !== expectedAttachmentId) {
        throw new DeepSeekEyesError(
          `desktop screenshot tile attachment digest mismatch: ${image.attachmentId} != ${expectedAttachmentId}`,
          'DESKTOP_ATTACHMENT_DIGEST_MISMATCH',
        )
      }
      images.push(image)
      tileRecords.push({
        index: index + 1,
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        sha256: tileDigest,
        pixelSha256: tile.pixelSha256,
        bytes: tile.data.length,
        attachmentId: String(image.attachmentId),
      })
    }
    const artifactPath = await this.saveScreenshot(this.sequence, digest, screenshot)
    const activeRaw = normalizeWindow(native.activeWindow)
    const activeWindow = activeRaw === undefined
      ? modelWindows.find(window => window.active)
      : modelWindow(activeRaw, modelWindows.find(window => window.pid === activeRaw.pid && window.title === activeRaw.title)?.ref)
    const result = {
      ok: true,
      action,
      sequence: this.sequence,
      stateId,
      observedAt: this.now().toISOString(),
      platform: native.platform,
      screen,
      cursor: native.cursor,
      activeWindow,
      windows: modelWindows,
      windowCount: modelWindows.length,
      capabilities: native.capabilities,
      actionResult: native.actionResult,
      screenshot: {
        sha256: digest,
        pixelSha256: tiled.sourcePixelSha256,
        bytes: screenshot.length,
        width: dimensions.width,
        height: dimensions.height,
        delivery: tiled.tiles.length === 1 ? 'lossless-png' : 'lossless-png-tiles',
        tileCount: tiled.tiles.length,
        tiles: tileRecords,
        ...(images.length === 1 ? { attachmentId: String(images[0].attachmentId) } : {}),
        ...(artifactPath === undefined ? {} : { artifactPath }),
      },
      ...(images.length === 1 ? { image: images[0] } : { images }),
    }
    this.latest = result
    this.observations.push({ ...result, image: undefined, images: undefined })
    event.result = { ok: true, stateId, screenshotSha256: digest }
    return result
  }

  async stale(args, event, signal) {
    const native = await this.driver.execute({ action: 'observe' }, signal)
    const result = await this.observe('observe', args, native, event)
    event.result = { ok: false, code: 'STALE_DESKTOP_STATE', stateId: result.stateId }
    return {
      ...result,
      ok: false,
      code: 'STALE_DESKTOP_STATE',
      receivedStateId: args.stateId,
      latestStateId: this.latest.stateId,
      message: 'Action was not executed. Repeat it with this observation stateId.',
    }
  }

  async writeReport(name = 'desktop-report') {
    const actionFailures = this.events.filter(event =>
      event.result?.ok === false
      && (event.action !== 'assert' || event.result.assertionPassed === undefined))
    const assertionFailures = this.assertions.filter(assertion => !assertion.passed)
    const report = {
      schemaVersion: 'deepseekeyes.desktop-report.v1',
      sessionId: this.sessionId,
      runId: this.runId,
      createdAt: this.createdAt,
      generatedAt: this.now().toISOString(),
      summary: {
        passed: actionFailures.length === 0 && assertionFailures.length === 0,
        actionCount: this.events.length,
        actionFailureCount: actionFailures.length,
        assertionCount: this.assertions.length,
        assertionFailureCount: assertionFailures.length,
        screenshotCount: this.observations.length,
      },
      events: this.events,
      assertions: this.assertions,
      observations: this.observations,
    }
    if (this.config.desktopArtifactsDir === undefined) return { ...report, path: undefined }
    const directory = join(this.config.desktopArtifactsDir, cleanName(this.sessionId, 'session'), this.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${cleanName(name, 'desktop-report')}.json`)
    await writeJsonAtomic(path, report)
    return { ...report, path }
  }

  async execute(args, signal) {
    if (this.closed && args.action !== 'observe') {
      throw new DeepSeekEyesError('computer session is closed; call observe to start a new session', 'DESKTOP_SESSION_CLOSED')
    }
    if (args.action === 'observe' && this.closed) this.closedAt = undefined
    if (args.action === 'close') {
      this.closedAt = this.now().toISOString()
      this.latest = undefined
      this.latestWindows.clear()
      return { ok: true, action: 'close', closed: true, closedAt: this.closedAt }
    }

    const event = {
      sequence: this.events.length + 1,
      at: this.now().toISOString(),
      action: args.action,
      args: reportableDesktopArgs(args),
      result: undefined,
    }
    this.events.push(event)
    try {
      if (desktopActionNeedsState(args.action) && !this.requireCurrentState(args.stateId)) {
        return await this.stale(args, event, signal)
      }
      this.requireCoordinateInLatestScreen(args)
      const window = this.resolveNativeWindow(args)
      const native = await this.driver.execute({
        ...args,
        ...(this.latest?.screen === undefined ? {} : { screen: this.latest.screen }),
        ...(window === undefined ? {} : { window }),
      }, signal)
      const result = await this.observe(args.action, args, native, event)
      if (args.action === 'assert') {
        const assertion = {
          assertion: args.assertion,
          expected: args.expected,
          actual: args.actual,
          passed: args.passed,
          stateId: args.stateId,
          screenshotSha256: result.screenshot.sha256,
          at: this.now().toISOString(),
        }
        this.assertions.push(assertion)
        result.ok = assertion.passed
        result.assertion = assertion
        event.result = {
          ok: assertion.passed,
          stateId: result.stateId,
          assertionPassed: assertion.passed,
        }
      }
      if (args.action === 'report') {
        const report = await this.writeReport(args.reportName)
        result.report = {
          path: report.path,
          summary: report.summary,
        }
        event.result.report = result.report
      }
      return result
    } catch (error) {
      event.result = {
        ok: false,
        code: error?.code ?? 'DESKTOP_ACTION_FAILED',
        message: errorMessage(error).slice(0, 2_000),
      }
      throw error
    }
  }
}

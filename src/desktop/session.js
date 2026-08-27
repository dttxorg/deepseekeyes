import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DESKTOP_STATE_PREFIX } from '../content.js'
import { DeepSeekEyesError, errorMessage } from '../error.js'
import { createDesktopDriver } from './driver.js'
import {
  DEFAULT_DESKTOP_ATTACHMENT_LIMIT,
  DEFAULT_DESKTOP_MAX_DIMENSION,
  DEFAULT_DESKTOP_MAX_PIXELS,
  DEFAULT_DESKTOP_MAX_TILES,
  DEFAULT_DESKTOP_MESSAGE_LIMIT,
  losslessDesktopPngTiles,
} from './png-tiles.js'
import { desktopActionNeedsState, reportableDesktopArgs } from './protocol.js'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isSha256AttachmentId(value) {
  return /^sha256:[0-9a-f]{64}$/.test(String(value ?? ''))
}

function cleanName(value, fallback) {
  const rendered = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  return rendered === '' ? fallback : rendered
}

function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new DeepSeekEyesError('native desktop screenshot is not a valid PNG', 'DESKTOP_SCREENSHOT_INVALID')
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width <= 0 || height <= 0) {
    throw new DeepSeekEyesError('native desktop screenshot has invalid dimensions', 'DESKTOP_SCREENSHOT_INVALID')
  }
  return { width, height }
}

function positiveHostLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function desktopAttachmentLimits(ctx) {
  const host = ctx.attachments?.imageLimits ?? {}
  const maxTotalBytes = positiveHostLimit(host.maxMessageImageBytes, DEFAULT_DESKTOP_MESSAGE_LIMIT)
  return {
    maxBytes: Math.min(
      positiveHostLimit(host.maxImageBytes, DEFAULT_DESKTOP_ATTACHMENT_LIMIT),
      maxTotalBytes,
    ),
    maxDimension: positiveHostLimit(host.maxImageDimension, DEFAULT_DESKTOP_MAX_DIMENSION),
    maxPixels: positiveHostLimit(host.maxImagePixels, DEFAULT_DESKTOP_MAX_PIXELS),
    maxTiles: positiveHostLimit(host.maxImagesPerMessage, DEFAULT_DESKTOP_MAX_TILES),
    maxTotalBytes,
  }
}

function valueOf(value, lower, upper) {
  if (value === null || typeof value !== 'object') return undefined
  return value[lower] ?? value[upper]
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function optionalText(value, maximum = 1_000) {
  if (value === undefined || value === null) return undefined
  const rendered = String(value).replace(/\s+/g, ' ').trim()
  return rendered === '' ? undefined : rendered.slice(0, maximum)
}

function normalizeWindow(value) {
  if (value === null || typeof value !== 'object') return undefined
  const nativeId = String(valueOf(value, 'nativeId', 'NativeId') ?? '')
  if (nativeId === '') return undefined
  const application = String(valueOf(value, 'application', 'Application') ?? 'unknown').slice(0, 200)
  const title = String(valueOf(value, 'title', 'Title') ?? application).slice(0, 500)
  const number = field => finite(valueOf(value, field, field[0].toUpperCase() + field.slice(1)))
  return {
    nativeId,
    ownerNativeId: optionalText(valueOf(value, 'ownerNativeId', 'OwnerNativeId'), 1_000),
    pid: number('pid'),
    application,
    title,
    active: Boolean(valueOf(value, 'active', 'Active')),
    modal: Boolean(valueOf(value, 'modal', 'Modal')),
    x: number('x'),
    y: number('y'),
    width: number('width'),
    height: number('height'),
    index: number('index'),
  }
}

function windowRef(value) {
  return `win_${sha256(Buffer.from(value.nativeId)).slice(0, 12)}`
}

function modelWindow(value, ref = windowRef(value)) {
  return Object.fromEntries(Object.entries({
    ref,
    pid: value.pid,
    application: value.application,
    title: value.title,
    active: value.active,
    modal: value.modal ? true : undefined,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }).filter(([, field]) => field !== undefined))
}

function normalizeElement(value) {
  if (value === null || typeof value !== 'object') return undefined
  const nativeId = optionalText(valueOf(value, 'nativeId', 'NativeId'), 1_000)
  if (nativeId === undefined) return undefined
  const actions = valueOf(value, 'actions', 'Actions')
  const normalizedActions = Array.isArray(actions)
    ? [...new Set(actions.map(action => optionalText(action, 120)).filter(Boolean))].slice(0, 24)
    : []
  const number = field => finite(valueOf(value, field, field[0].toUpperCase() + field.slice(1)))
  const role = optionalText(valueOf(value, 'role', 'Role'), 120) ?? 'unknown'
  const password = Boolean(valueOf(value, 'password', 'Password'))
  return {
    nativeId,
    windowNativeId: optionalText(valueOf(value, 'windowNativeId', 'WindowNativeId'), 1_000),
    pid: number('pid'),
    path: Array.isArray(value.path) ? value.path.map(Number).filter(Number.isInteger).slice(0, 32) : undefined,
    flatIndex: Number.isInteger(Number(value.flatIndex)) ? Number(value.flatIndex) : undefined,
    automationId: optionalText(valueOf(value, 'automationId', 'AutomationId'), 300),
    className: optionalText(valueOf(value, 'className', 'ClassName'), 300),
    role,
    subrole: optionalText(valueOf(value, 'subrole', 'Subrole'), 120),
    name: optionalText(valueOf(value, 'name', 'Name'), 500),
    description: optionalText(valueOf(value, 'description', 'Description'), 500),
    value: password ? undefined : optionalText(valueOf(value, 'value', 'Value'), 2_000),
    password,
    enabled: valueOf(value, 'enabled', 'Enabled') === undefined ? undefined : Boolean(valueOf(value, 'enabled', 'Enabled')),
    visible: valueOf(value, 'visible', 'Visible') === undefined
      ? !Boolean(valueOf(value, 'offscreen', 'Offscreen'))
      : Boolean(valueOf(value, 'visible', 'Visible')),
    focused: valueOf(value, 'focused', 'Focused') === undefined ? undefined : Boolean(valueOf(value, 'focused', 'Focused')),
    editable: valueOf(value, 'editable', 'Editable') === undefined ? undefined : Boolean(valueOf(value, 'editable', 'Editable')),
    selected: valueOf(value, 'selected', 'Selected') === undefined ? undefined : Boolean(valueOf(value, 'selected', 'Selected')),
    checked: valueOf(value, 'checked', 'Checked') === undefined ? undefined : Boolean(valueOf(value, 'checked', 'Checked')),
    x: number('x'),
    y: number('y'),
    width: number('width'),
    height: number('height'),
    actions: normalizedActions,
  }
}

function elementRef(value) {
  return `el_${sha256(Buffer.from(value.nativeId)).slice(0, 12)}`
}

function modelElement(value, screen, ref = elementRef(value)) {
  const scale = finite(screen?.scaleFactor) ?? 1
  const originX = finite(screen?.x) ?? 0
  const originY = finite(screen?.y) ?? 0
  const bbox = [value.x, value.y, value.width, value.height].every(Number.isFinite)
    ? {
        x: Math.round((value.x - originX) * scale * 100) / 100,
        y: Math.round((value.y - originY) * scale * 100) / 100,
        width: Math.round(value.width * scale * 100) / 100,
        height: Math.round(value.height * scale * 100) / 100,
      }
    : undefined
  return Object.fromEntries(Object.entries({
    ref,
    role: value.role,
    subrole: value.subrole,
    name: value.name,
    description: value.description,
    value: value.value,
    automationId: value.automationId,
    enabled: value.enabled,
    visible: value.visible,
    focused: value.focused,
    editable: value.editable,
    selected: value.selected,
    checked: value.checked,
    bbox,
    actions: value.actions.length === 0 ? undefined : value.actions,
  }).filter(([, field]) => field !== undefined))
}

function semanticStatus(elements, enabled, options = {}) {
  const titlebarSubroles = new Set(['close_button', 'minimize_button', 'full_screen_button', 'zoom_button'])
  const actionableCount = elements.filter(element => element.editable || element.actions.length > 0).length
  const contentElementCount = elements.filter(element => !['window', 'group'].includes(element.role)
    && !titlebarSubroles.has(element.subrole)).length
  const quality = !enabled
    ? 'disabled'
    : elements.length === 0
      ? 'empty'
      : contentElementCount === 0
        ? 'sparse'
        : 'available'
  return {
    enabled: Boolean(enabled),
    quality,
    elementCount: elements.length,
    actionableCount,
    contentElementCount,
    truncated: Boolean(options.truncated),
    ...(options.limitReason === undefined ? {} : { limitReason: options.limitReason }),
    ...(Number.isFinite(Number(options.elapsedMs)) ? { elapsedMs: Number(options.elapsedMs) } : {}),
    preferredTargeting: ['disabled', 'empty', 'sparse'].includes(quality)
      ? 'screenshot-coordinates'
      : 'element-ref',
  }
}

function visualDeliveryFor(config, args, result, attachmentCount) {
  const requested = args.includeScreenshot === true
    ? 'include'
    : args.includeScreenshot === false ? 'omit' : 'auto'
  const mode = config.desktopVisualMode ?? 'always'
  let delivered
  let reason
  if (attachmentCount === 0) {
    delivered = false
    reason = 'screenshot-unavailable'
  } else if (requested === 'include') {
    delivered = true
    reason = 'explicit-request'
  } else if (requested === 'omit') {
    delivered = false
    reason = 'explicit-omit'
  } else if (mode === 'always') {
    delivered = true
    reason = 'configured-always'
  } else if (mode === 'manual') {
    delivered = false
    reason = 'configured-manual'
  } else if (args.action === 'assert' && args.assertion === 'visual') {
    delivered = true
    reason = 'visual-assertion'
  } else if (['observe', 'launch', 'wait'].includes(args.action)) {
    const semantic = result.semanticStatus
    const semanticSufficient = semantic?.quality === 'available' && semantic.truncated !== true
    delivered = !semanticSufficient
    reason = semanticSufficient
      ? 'semantic-state-sufficient'
      : `semantic-${semantic?.quality ?? 'unavailable'}-fallback`
  } else {
    delivered = false
    reason = 'action-result-fast-path'
  }
  return {
    mode,
    requested,
    delivered,
    reason,
    fullScreenshotPreserved: result.screenshot?.artifactPath !== undefined || attachmentCount > 0,
    attachmentCount,
    ...(delivered ? {} : {
      next: 'Use includeScreenshot=true on observe or the next action only when current pixels are required.',
    }),
  }
}

const ELEMENT_DIFF_FIELDS = [
  'role', 'subrole', 'name', 'description', 'value', 'enabled', 'visible', 'focused',
  'editable', 'selected', 'checked', 'bbox', 'actions',
]
const WINDOW_DIFF_FIELDS = ['application', 'title', 'active', 'x', 'y', 'width', 'height']

function diffRecords(before = [], after = [], fields) {
  const old = new Map(before.map(record => [record.ref, record]))
  const current = new Map(after.map(record => [record.ref, record]))
  const added = [...current.keys()].filter(ref => !old.has(ref))
  const removed = [...old.keys()].filter(ref => !current.has(ref))
  const changed = []
  for (const [ref, record] of current) {
    const previous = old.get(ref)
    if (previous === undefined) continue
    const changedFields = fields.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(record[field]))
    if (changedFields.length > 0) changed.push({ ref, fields: changedFields })
  }
  return { added, removed, changed }
}

function stateDelta(previous, current) {
  if (previous === undefined) {
    return {
      initial: true,
      screenshotChanged: true,
      scopeChanged: true,
      elements: { added: current.elements.map(element => element.ref), removed: [], changed: [] },
      windows: { added: current.windows.map(window => window.ref), removed: [], changed: [] },
    }
  }
  const previousScope = previous.observationScope?.window?.ref ?? previous.observationScope?.type ?? 'desktop'
  const currentScope = current.observationScope?.window?.ref ?? current.observationScope?.type ?? 'desktop'
  return {
    fromStateId: previous.stateId,
    screenshotChanged: previous.screenshot.pixelSha256 !== current.screenshot.pixelSha256,
    scopeChanged: previousScope !== currentScope,
    elements: diffRecords(previous.elements, current.elements, ELEMENT_DIFF_FIELDS),
    windows: diffRecords(previous.windows, current.windows, WINDOW_DIFF_FIELDS),
  }
}

function reportableObservation(result) {
  const copy = structuredClone(result)
  delete copy.image
  delete copy.images
  copy.elements = copy.elements.map((element) => {
    if (element.value === undefined) return element
    const value = String(element.value)
    const { value: _value, ...rest } = element
    return {
      ...rest,
      valueLength: value.length,
      valueSha256: sha256(Buffer.from(value)),
    }
  })
  return copy
}

function observationText(result) {
  const copy = structuredClone(result)
  delete copy.image
  delete copy.images
  if (copy.visualDelivery?.delivered === false && copy.screenshot !== undefined) {
    const screenshot = copy.screenshot
    copy.screenshot = Object.fromEntries(Object.entries({
      sha256: screenshot.sha256,
      pixelSha256: screenshot.pixelSha256,
      bytes: screenshot.bytes,
      width: screenshot.width,
      height: screenshot.height,
      delivery: screenshot.delivery,
      tileCount: screenshot.tileCount,
      artifactPath: screenshot.artifactPath,
    }).filter(([, value]) => value !== undefined))
  }
  return `${DESKTOP_STATE_PREFIX}${JSON.stringify(copy)}`
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/** Render one state as compact JSON evidence plus the exact native screenshot. */
export function renderDesktopResult(value) {
  const content = [{ type: 'text', text: observationText(value) }]
  if (value.visualDelivery?.delivered === false) return content
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
    this.monotonicNow = options.monotonicNow ?? (() => Number(process.hrtime.bigint() / 1_000_000n))
    this.runId = options.runId ?? randomUUID()
    this.sessionId = String(options.sessionId ?? 'default')
    this.driver = options.driver ?? createDesktopDriver(config, options.driverOptions)
    this.sequence = 0
    this.latest = undefined
    this.latestWindows = new Map()
    this.latestElements = new Map()
    this.captureWindow = undefined
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

  resolveNativeElement(args) {
    if (args.elementRef === undefined) return undefined
    const found = this.latestElements.get(args.elementRef)
    if (found === undefined) {
      throw new DeepSeekEyesError(
        `computer element ref ${args.elementRef} is not present in the latest state`,
        'DESKTOP_ELEMENT_REF_NOT_FOUND',
      )
    }
    return found
  }

  windowForElement(element) {
    if (element?.windowNativeId === undefined) return undefined
    return [...this.latestWindows.values()].find(window => window.nativeId === element.windowNativeId)
  }

  activeNativeWindow() {
    return [...this.latestWindows.values()].find(window => window.active)
  }

  typeTargetWindow(args, window, element) {
    if (args.action !== 'type') return undefined
    const elementWindow = this.windowForElement(element)
    if (window !== undefined && elementWindow !== undefined && window.nativeId !== elementWindow.nativeId) {
      throw new DeepSeekEyesError(
        `computer type element belongs to window ${elementWindow.nativeId}, not ${window.nativeId}`,
        'DESKTOP_TYPE_TARGET_MISMATCH',
      )
    }
    if (element?.editable === false) {
      throw new DeepSeekEyesError(
        `computer type target ${args.elementRef} is not editable in the latest state`,
        'DESKTOP_TYPE_TARGET_NOT_EDITABLE',
      )
    }
    const target = window
      ?? elementWindow
      ?? this.captureWindow
      ?? (args.allowFocusedTarget === true ? this.activeNativeWindow() : undefined)
    if (target === undefined && args.allowFocusedTarget !== true) {
      throw new DeepSeekEyesError(
        'computer coordinate type needs windowRef or a latest window-scoped observation',
        'DESKTOP_TYPE_WINDOW_REQUIRED',
      )
    }
    return target
  }

  requireTypeTargetSafe(args, targetWindow) {
    if (args.action !== 'type') return
    const active = this.activeNativeWindow()
    if (active?.modal === true
      && targetWindow !== undefined
      && active.nativeId !== targetWindow.nativeId) {
      throw new DeepSeekEyesError(
        `computer type is blocked by active modal window ${active.title || active.nativeId}; target it or close it first`,
        'DESKTOP_MODAL_TARGET_BLOCKED',
      )
    }
    if (args.x === undefined || targetWindow === undefined) return
    if (this.captureWindow !== undefined && this.captureWindow.nativeId !== targetWindow.nativeId) {
      throw new DeepSeekEyesError(
        'computer type coordinates belong to a different window-scoped screenshot; observe the target window again',
        'DESKTOP_COORDINATE_SPACE_MISMATCH',
      )
    }
    const screen = this.latest?.screen
    const fields = [targetWindow.x, targetWindow.y, targetWindow.width, targetWindow.height]
    if (screen === undefined || !fields.every(Number.isFinite)) {
      throw new DeepSeekEyesError(
        'computer type target window has no verifiable bounds in the latest state',
        'DESKTOP_TARGET_BOUNDS_MISSING',
      )
    }
    const scale = Number.isFinite(Number(screen.scaleFactor)) && Number(screen.scaleFactor) > 0
      ? Number(screen.scaleFactor)
      : 1
    const globalX = Number(screen.x ?? 0) + Number(args.x) / scale
    const globalY = Number(screen.y ?? 0) + Number(args.y) / scale
    const inside = globalX >= targetWindow.x
      && globalY >= targetWindow.y
      && globalX < targetWindow.x + targetWindow.width
      && globalY < targetWindow.y + targetWindow.height
    if (!inside) {
      throw new DeepSeekEyesError(
        `computer type coordinate (${args.x}, ${args.y}) is outside target window ${targetWindow.title || targetWindow.nativeId}`,
        'DESKTOP_TYPE_COORDINATE_OUTSIDE_WINDOW',
      )
    }
  }

  captureFor(args, window, element) {
    if (args.action === 'observe' && args.scope === 'desktop') {
      return { captureScope: 'desktop' }
    }
    if (args.action === 'close_window') {
      return { captureScope: 'desktop' }
    }
    if (args.action === 'assert' && args.assertion === 'window_exists') {
      return { captureScope: 'desktop' }
    }
    const elementWindow = this.windowForElement(element)
    const explicitWindow = window ?? elementWindow
    const hasNamedTarget = args.application !== undefined || args.title !== undefined
    const wantsWindow = args.scope === 'window'
      || explicitWindow !== undefined
      || args.application !== undefined
      || args.title !== undefined
      || (args.action !== 'observe' && this.captureWindow !== undefined)
    if (!wantsWindow) return { captureScope: 'desktop' }
    return {
      captureScope: 'window',
      captureWindow: explicitWindow ?? (hasNamedTarget ? undefined : this.captureWindow),
      captureApplication: args.application,
      captureTitle: args.title,
    }
  }

  async saveScreenshot(sequence, digest, screenshot) {
    if (this.config.desktopArtifactsDir === undefined) return undefined
    const directory = join(this.config.desktopArtifactsDir, cleanName(this.sessionId, 'session'), this.runId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${String(sequence).padStart(4, '0')}-${digest.slice(0, 16)}.png`)
    await writeFile(path, screenshot, { mode: 0o600 })
    return path
  }

  async runNative(input, signal) {
    const startedAt = this.monotonicNow()
    const native = await this.driver.execute(input, signal)
    return {
      native,
      nativeRoundTripMs: Math.max(0, this.monotonicNow() - startedAt),
    }
  }

  async observe(action, args, native, event, timings = {}) {
    const processingStartedAt = this.monotonicNow()
    const screenshot = native.screenshot
    const dimensions = pngSize(screenshot)
    const digest = sha256(screenshot)
    const tiled = losslessDesktopPngTiles(screenshot, desktopAttachmentLimits(this.ctx))
    if (tiled.width !== dimensions.width || tiled.height !== dimensions.height) {
      throw new DeepSeekEyesError('desktop screenshot dimensions changed during lossless tiling', 'DESKTOP_SCREENSHOT_INVALID')
    }
    const previous = this.latest
    this.sequence += 1
    const windows = (native.windows ?? [])
      .map(normalizeWindow)
      .filter(Boolean)
      .slice(0, this.config.desktopMaxWindows)
    this.latestWindows.clear()
    const modelWindows = windows.map((window) => {
      const ref = windowRef(window)
      this.latestWindows.set(ref, window)
      return modelWindow(window, ref)
    })
    const helperScreen = native.screen ?? {}
    const screen = {
      x: finite(helperScreen.x) ?? 0,
      y: finite(helperScreen.y) ?? 0,
      width: dimensions.width,
      height: dimensions.height,
      scaleFactor: finite(helperScreen.scaleFactor) ?? 1,
    }
    const elements = (native.elements ?? [])
      .map(normalizeElement)
      .filter(Boolean)
      .slice(0, this.config.desktopMaxElements)
    this.latestElements.clear()
    const modelElements = elements.map((element) => {
      const ref = elementRef(element)
      this.latestElements.set(ref, element)
      return modelElement(element, screen, ref)
    })
    const capturedRaw = normalizeWindow(native.capturedWindow)
    const capturedModel = capturedRaw === undefined ? undefined : modelWindow(capturedRaw)
    this.captureWindow = capturedRaw
    const observationScope = capturedModel === undefined
      ? { type: 'desktop' }
      : { type: 'window', window: capturedModel }
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
      const attachmentId = String(image?.attachmentId ?? '')
      if (!isSha256AttachmentId(attachmentId)) {
        throw new DeepSeekEyesError(
          `desktop screenshot tile attachment id is invalid: ${attachmentId || '[missing]'}; expected sha256:<64 hex>`,
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
        // The Host owns the canonical attachment identity and may normalize or
        // re-encode PNG bytes before hashing. Keep the original tile digest and
        // pixel digest above for auditability, while using the returned ID for
        // every model-facing attachment reference.
        attachmentId,
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
      observationScope,
      screen,
      cursor: native.cursor,
      activeWindow,
      windows: modelWindows,
      windowCount: modelWindows.length,
      elements: modelElements,
      elementCount: modelElements.length,
      elementTotal: finite(native.elementTotal) ?? modelElements.length,
      elementsTruncated: Boolean(native.elementsTruncated)
        || Number(native.elementTotal ?? modelElements.length) > modelElements.length,
      semanticStatus: semanticStatus(elements, native.capabilities?.accessibility, {
        truncated: Boolean(native.elementsTruncated)
          || Number(native.elementTotal ?? modelElements.length) > modelElements.length,
        limitReason: native.semanticLimitReason,
        elapsedMs: native.semanticElapsedMs,
      }),
      capabilities: { ...native.capabilities, stateDiff: true },
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
    result.stateDelta = stateDelta(previous, result)
    const screenshotProcessingMs = Math.max(0, this.monotonicNow() - processingStartedAt)
    result.timings = {
      nativeRoundTripMs: Number(timings.nativeRoundTripMs ?? 0),
      semanticMs: Number(native.semanticElapsedMs ?? 0),
      screenshotProcessingMs,
      settleConfiguredMs: this.config.desktopSettleMs,
      toolTotalMs: Number(timings.nativeRoundTripMs ?? 0) + screenshotProcessingMs,
    }
    result.visualDelivery = visualDeliveryFor(this.config, { ...args, action }, result, images.length)
    this.latest = result
    this.observations.push(reportableObservation(result))
    event.result = {
      ok: true,
      stateId,
      screenshotSha256: digest,
      visualDelivered: result.visualDelivery.delivered,
      toolTotalMs: result.timings.toolTotalMs,
    }
    return result
  }

  async stale(args, event, signal) {
    const { native, nativeRoundTripMs } = await this.runNative({
      action: 'observe',
      captureScope: this.captureWindow === undefined ? 'desktop' : 'window',
      captureWindow: this.captureWindow,
    }, signal)
    const result = await this.observe('observe', args, native, event, { nativeRoundTripMs })
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

  performAssertion(args, result, previous) {
    const element = args.elementRef === undefined
      ? undefined
      : result.elements.find(candidate => candidate.ref === args.elementRef)
    const window = args.windowRef === undefined
      ? result.windows.find(candidate => {
          const applicationMatches = args.application === undefined
            || candidate.application.toLowerCase().includes(args.application.toLowerCase())
          const titleMatches = args.title === undefined
            || candidate.title.toLowerCase().includes(args.title.toLowerCase())
          return applicationMatches && titleMatches
        })
      : result.windows.find(candidate => candidate.ref === args.windowRef)
    let actual
    let passed
    switch (args.assertion) {
      case 'window_exists':
        actual = window !== undefined
        passed = actual
        break
      case 'window_title_contains':
        actual = window?.title
        passed = actual !== undefined && actual.includes(args.expected)
        break
      case 'element_exists':
        actual = element !== undefined
        passed = actual
        break
      case 'element_visible':
        actual = element?.visible ?? false
        passed = actual === true
        break
      case 'element_hidden':
        actual = element?.visible ?? false
        passed = element === undefined || actual === false
        break
      case 'element_enabled':
        actual = element?.enabled ?? false
        passed = actual === true
        break
      case 'element_disabled':
        actual = element?.enabled
        passed = element !== undefined && actual === false
        break
      case 'element_focused':
        actual = element?.focused ?? false
        passed = actual === true
        break
      case 'element_value_equals':
        actual = element?.value
        passed = actual === args.expected
        break
      case 'element_name_contains':
        actual = element?.name
        passed = actual !== undefined && actual.includes(args.expected)
        break
      case 'screen_changed':
        actual = result.stateDelta.screenshotChanged
        passed = previous !== undefined && actual === true
        break
      case 'screen_unchanged':
        actual = result.stateDelta.screenshotChanged
        passed = previous !== undefined && actual === false
        break
      case 'visual':
        actual = args.actual
        passed = args.passed
        break
      default:
        throw new DeepSeekEyesError(`unsupported desktop assertion ${args.assertion}`, 'DESKTOP_ASSERTION_UNSUPPORTED')
    }
    return {
      assertion: args.assertion,
      target: args.elementRef ?? args.windowRef ?? args.application ?? args.title,
      expected: args.expected,
      actual,
      passed,
      verifiedBy: args.assertion === 'visual' ? 'model-visual-evidence' : 'desktop-runtime',
      stateId: result.stateId,
      screenshotSha256: result.screenshot.sha256,
      at: this.now().toISOString(),
    }
  }

  async writeReport(name = 'desktop-report') {
    const actionFailures = this.events.filter(event =>
      event.result?.ok === false
      && (event.action !== 'assert' || event.result.assertionPassed === undefined))
    const assertionFailures = this.assertions.filter(assertion => !assertion.passed)
    const report = {
      schemaVersion: 'deepseekeyes.desktop-report.v2',
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
      this.latestElements.clear()
      this.captureWindow = undefined
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
      const usesLatestRef = args.windowRef !== undefined || args.elementRef !== undefined
      const refNeedsState = usesLatestRef && args.action !== 'observe'
      if ((desktopActionNeedsState(args.action) || refNeedsState) && !this.requireCurrentState(args.stateId)) {
        return await this.stale(args, event, signal)
      }
      this.requireCoordinateInLatestScreen(args)
      const window = this.resolveNativeWindow(args)
      const element = this.resolveNativeElement(args)
      const targetWindow = this.typeTargetWindow(args, window, element)
      this.requireTypeTargetSafe(args, targetWindow)
      const capture = this.captureFor(args, window, element)
      const previous = this.latest
      const { native, nativeRoundTripMs } = await this.runNative({
        ...args,
        ...capture,
        ...(this.latest?.screen === undefined ? {} : { screen: this.latest.screen }),
        ...(window === undefined ? {} : { window }),
        ...(element === undefined ? {} : { element }),
        ...(targetWindow === undefined ? {} : { targetWindow }),
      }, signal)
      const result = await this.observe(args.action, args, native, event, { nativeRoundTripMs })
      if (args.action === 'assert') {
        const assertion = this.performAssertion(args, result, previous)
        this.assertions.push(assertion)
        result.ok = assertion.passed
        result.assertion = assertion
        event.result = {
          ok: assertion.passed,
          stateId: result.stateId,
          assertionPassed: assertion.passed,
          verifiedBy: assertion.verifiedBy,
        }
      }
      if (args.action === 'report') {
        const report = await this.writeReport(args.reportName)
        result.report = { path: report.path, summary: report.summary }
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

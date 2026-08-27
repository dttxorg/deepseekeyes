import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import {
  DesktopSession,
  losslessDesktopPngTiles,
  parseDesktopArgs,
  renderDesktopResult,
} from '../src/desktop/index.js'
import { PROBE_COLORS, createProbePng } from '../src/probe.js'
import { mockContext } from './_helpers.js'

const order = PROBE_COLORS.map(entry => entry.name)

function nativeResult(sequence, action, input = {}) {
  const screenshot = createProbePng(sequence % 2 === 0 ? [...order].reverse() : order, 2)
  const window = {
    nativeId: '42:0', pid: 42, application: 'Fixture', title: `Fixture ${sequence}`,
    active: true, modal: false, x: 100, y: 50, width: 6, height: 6, index: 0,
  }
  const windowCapture = input.captureScope === 'window'
  return {
    platform: 'darwin',
    screenshot,
    screen: { x: windowCapture ? 100 : 0, y: windowCapture ? 50 : 0, width: 6, height: 6, scaleFactor: 1 },
    cursor: { x: sequence, y: sequence },
    activeWindow: window,
    capturedWindow: windowCapture ? window : undefined,
    windows: [window],
    elements: [{
      nativeId: '42:0:0.1', windowNativeId: '42:0', pid: 42, path: [0, 1],
      role: 'button', name: 'Fixture control', value: `value-${sequence}`,
      enabled: true, visible: true, focused: sequence % 2 === 0,
      x: 101, y: 51, width: 4, height: 2, actions: ['press'],
    }],
    elementTotal: 1,
    capabilities: {
      screenshot: true, mouse: true, keyboard: true, windows: true,
      accessibility: true, windowCapture: true, elementActions: true,
    },
    actionResult: { performed: action },
  }
}

class FakeDesktopDriver {
  constructor() {
    this.calls = []
  }

  async execute(args) {
    this.calls.push(structuredClone(args))
    return nativeResult(this.calls.length, args.action, args)
  }
}

test('desktop session returns a fresh state and exact screenshot after every action', async () => {
  const ctx = mockContext()
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(ctx, config, { driver, sessionId: 'desktop-fixture' })

  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  assert.equal(observed.sequence, 1)
  assert.equal(observed.screen.width, 6)
  assert.equal(observed.screen.height, 6)
  assert.match(observed.windows[0].ref, /^win_[a-f0-9]{12}$/)
  assert.match(observed.elements[0].ref, /^el_[a-f0-9]{12}$/)
  assert.equal(observed.semanticStatus.quality, 'available')
  assert.equal(observed.semanticStatus.preferredTargeting, 'element-ref')
  assert.equal(observed.stateDelta.initial, true)
  assert.equal(observed.stateDelta.elements.added[0], observed.elements[0].ref)
  assert.match(observed.stateId, /^desktop-state:[a-f0-9]{64}$/)
  assert.equal(observed.screenshot.attachmentId, observed.image.attachmentId)
  assert.equal(observed.visualDelivery.mode, 'auto')
  assert.equal(observed.visualDelivery.delivered, false)
  assert.equal(observed.visualDelivery.reason, 'semantic-state-sufficient')
  assert.equal(renderDesktopResult(observed).some(block => block.type === 'image'), false)
  assert.ok(observed.timings.toolTotalMs >= 0)

  const clicked = await session.execute(parseDesktopArgs({
    action: 'click', stateId: observed.stateId, x: 5, y: 5,
  }))
  assert.equal(clicked.sequence, 2)
  assert.notEqual(clicked.stateId, observed.stateId)
  assert.equal(clicked.stateDelta.fromStateId, observed.stateId)
  assert.equal(clicked.stateDelta.screenshotChanged, true)
  assert.deepEqual(clicked.stateDelta.elements.changed, [{
    ref: clicked.elements[0].ref,
    fields: ['value', 'focused'],
  }])
  assert.deepEqual(driver.calls[1].screen, observed.screen)
  assert.deepEqual(driver.calls.map(call => call.action), ['observe', 'click'])
  assert.equal(clicked.visualDelivery.delivered, false)
  assert.equal(clicked.visualDelivery.reason, 'action-result-fast-path')
})

test('desktop auto visual delivery falls back for sparse states and supports explicit overrides', async () => {
  const sparseDriver = new FakeDesktopDriver()
  sparseDriver.execute = async function execute(args) {
    this.calls.push(structuredClone(args))
    return { ...nativeResult(this.calls.length, args.action, args), elements: [], elementTotal: 0 }
  }
  const auto = new DesktopSession(mockContext(), resolveConfig({
    desktopArtifactsDir: false,
    desktopComputerUse: true,
  }, {}, '/tmp'), { driver: sparseDriver })
  const sparse = await auto.execute(parseDesktopArgs({ action: 'observe' }))
  assert.equal(sparse.semanticStatus.quality, 'empty')
  assert.equal(sparse.visualDelivery.delivered, true)
  assert.equal(sparse.visualDelivery.reason, 'semantic-empty-fallback')
  assert.equal(renderDesktopResult(sparse).filter(block => block.type === 'image').length, 1)

  const forcedOmit = await auto.execute(parseDesktopArgs({
    action: 'observe', includeScreenshot: false,
  }))
  assert.equal(forcedOmit.visualDelivery.delivered, false)
  assert.equal(forcedOmit.visualDelivery.reason, 'explicit-omit')
  assert.equal(renderDesktopResult(forcedOmit).some(block => block.type === 'image'), false)

  const forcedInclude = await auto.execute(parseDesktopArgs({
    action: 'observe', includeScreenshot: true,
  }))
  assert.equal(forcedInclude.visualDelivery.delivered, true)
  assert.equal(forcedInclude.visualDelivery.reason, 'explicit-request')

  const always = new DesktopSession(mockContext(), resolveConfig({
    desktopArtifactsDir: false,
    desktopComputerUse: true,
    desktopVisualMode: 'always',
  }, {}, '/tmp'), { driver: new FakeDesktopDriver() })
  const audited = await always.execute(parseDesktopArgs({ action: 'observe' }))
  assert.equal(audited.semanticStatus.quality, 'available')
  assert.equal(audited.visualDelivery.delivered, true)
  assert.equal(audited.visualDelivery.reason, 'configured-always')

  const manual = new DesktopSession(mockContext(), resolveConfig({
    desktopArtifactsDir: false,
    desktopComputerUse: true,
    desktopVisualMode: 'manual',
  }, {}, '/tmp'), { driver: new FakeDesktopDriver() })
  const manualState = await manual.execute(parseDesktopArgs({ action: 'observe' }))
  assert.equal(manualState.visualDelivery.delivered, false)
  assert.equal(manualState.visualDelivery.reason, 'configured-manual')
})

test('desktop accepts a Host-normalized attachment id while preserving source digests', async () => {
  const ctx = mockContext()
  const canonicalId = `sha256:${'f'.repeat(64)}`
  const originalSaveImage = ctx.attachments.saveImage.bind(ctx.attachments)
  ctx.attachments.saveImage = async (input) => {
    const original = await originalSaveImage(input)
    const normalized = { ...original, attachmentId: canonicalId }
    ctx.attachments.images.set(canonicalId, { ref: normalized, data: Buffer.from(input.data) })
    return normalized
  }
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const session = new DesktopSession(ctx, config, { driver: new FakeDesktopDriver() })

  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  assert.equal(observed.screenshot.attachmentId, canonicalId)
  assert.equal(observed.image.attachmentId, canonicalId)
  assert.equal(observed.screenshot.tiles[0].attachmentId, canonicalId)
  assert.match(observed.screenshot.tiles[0].sha256, /^[a-f0-9]{64}$/)
  assert.notEqual(observed.screenshot.tiles[0].sha256, canonicalId.slice('sha256:'.length))
})

test('desktop rejects a Host attachment id outside the sha256 contract', async () => {
  const ctx = mockContext()
  ctx.attachments.saveImage = async () => ({ attachmentId: 'fixture:normalized' })
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const session = new DesktopSession(ctx, config, { driver: new FakeDesktopDriver() })

  await assert.rejects(
    session.execute(parseDesktopArgs({ action: 'observe' })),
    error => error.code === 'DESKTOP_ATTACHMENT_DIGEST_MISMATCH',
  )
})

test('stale state is observed again without executing the requested mutation', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const first = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const second = await session.execute(parseDesktopArgs({
    action: 'click', stateId: first.stateId, x: 1, y: 1,
  }))
  const stale = await session.execute(parseDesktopArgs({
    action: 'click', stateId: first.stateId, x: 2, y: 2,
  }))
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'STALE_DESKTOP_STATE')
  assert.equal(stale.receivedStateId, first.stateId)
  assert.notEqual(stale.latestStateId, second.stateId)
  assert.deepEqual(driver.calls.map(call => call.action), ['observe', 'click', 'observe'])
})

test('desktop coordinates and window refs are valid only against the latest observation', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const state = await session.execute(parseDesktopArgs({ action: 'observe' }))
  await assert.rejects(
    session.execute(parseDesktopArgs({ action: 'click', stateId: state.stateId, x: 6, y: 5 })),
    error => error.code === 'DESKTOP_COORDINATE_OUT_OF_BOUNDS',
  )
  assert.equal(session.events.at(-1).result.ok, false)
  await assert.rejects(
    session.execute(parseDesktopArgs({ action: 'focus', stateId: state.stateId, windowRef: 'win_99' })),
    error => error.code === 'DESKTOP_WINDOW_REF_NOT_FOUND',
  )
  assert.equal(session.events.at(-1).result.ok, false)
  const focused = await session.execute(parseDesktopArgs({
    action: 'focus', stateId: state.stateId, windowRef: state.windows[0].ref,
  }))
  assert.equal(focused.ok, true)
  assert.equal(driver.calls.at(-1).window.nativeId, '42:0')
})

test('desktop type rejects ambient focus and keeps the explicit compatibility escape hatch auditable', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const state = await session.execute(parseDesktopArgs({ action: 'observe' }))
  await assert.rejects(
    session.execute(parseDesktopArgs({
      action: 'type', stateId: state.stateId, x: 1, y: 1, text: 'must-not-run',
    })),
    error => error.code === 'DESKTOP_TYPE_WINDOW_REQUIRED',
  )
  assert.deepEqual(driver.calls.map(call => call.action), ['observe'])

  const compatibility = await session.execute(parseDesktopArgs({
    action: 'type', stateId: state.stateId, text: 'explicit-focus', allowFocusedTarget: true,
  }))
  assert.equal(compatibility.ok, true)
  assert.equal(driver.calls[1].targetWindow.nativeId, '42:0')
  assert.equal(driver.calls[1].allowFocusedTarget, true)
  assert.equal(JSON.stringify(session.events).includes('explicit-focus'), false)
})

test('window-scoped coordinate type binds click and text to one verified target window', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({
    action: 'observe', scope: 'window', application: 'Fixture', includeScreenshot: true,
  }))
  const typed = await session.execute(parseDesktopArgs({
    action: 'type', stateId: observed.stateId, x: 2, y: 3, text: 'target-bound',
  }))
  assert.equal(typed.ok, true)
  assert.equal(driver.calls[1].targetWindow.nativeId, '42:0')
  assert.equal(driver.calls[1].captureWindow.nativeId, '42:0')
  assert.equal(driver.calls[1].x, 2)
  assert.equal(driver.calls[1].y, 3)
  assert.equal(JSON.stringify(session.events).includes('target-bound'), false)
})

test('coordinate type refuses a point outside its declared window', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  driver.execute = async function execute(args) {
    this.calls.push(structuredClone(args))
    const result = nativeResult(this.calls.length, args.action, args)
    result.windows[0] = { ...result.windows[0], x: 0, y: 0, width: 3, height: 6 }
    result.activeWindow = result.windows[0]
    return result
  }
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  await assert.rejects(
    session.execute(parseDesktopArgs({
      action: 'type', stateId: observed.stateId, windowRef: observed.windows[0].ref,
      x: 5, y: 5, text: 'outside',
    })),
    error => error.code === 'DESKTOP_TYPE_COORDINATE_OUTSIDE_WINDOW',
  )
  assert.deepEqual(driver.calls.map(call => call.action), ['observe'])
})

test('active modal protection prevents text from reaching a different window', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  driver.execute = async function execute(args) {
    this.calls.push(structuredClone(args))
    const result = nativeResult(this.calls.length, args.action, args)
    const parent = {
      ...result.windows[0], nativeId: '42:parent', title: 'Editor', active: false,
      x: 0, y: 0, width: 6, height: 6,
    }
    const modal = {
      ...parent, nativeId: '42:dialog', ownerNativeId: parent.nativeId,
      title: 'Error', active: true, modal: true, x: 1, y: 1, width: 4, height: 4,
    }
    result.windows = [modal, parent]
    result.activeWindow = modal
    result.capturedWindow = undefined
    return result
  }
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const parent = observed.windows.find(window => window.title === 'Editor')
  assert.equal(observed.activeWindow.modal, true)
  await assert.rejects(
    session.execute(parseDesktopArgs({
      action: 'type', stateId: observed.stateId, windowRef: parent.ref,
      x: 2, y: 2, text: 'must-not-enter-dialog',
    })),
    error => error.code === 'DESKTOP_MODAL_TARGET_BLOCKED',
  )
  assert.deepEqual(driver.calls.map(call => call.action), ['observe'])
})

test('element type resolves its owning window and sends both refs to the native helper', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({
    action: 'observe', scope: 'window', application: 'Fixture',
  }))
  const typed = await session.execute(parseDesktopArgs({
    action: 'type', stateId: observed.stateId, elementRef: observed.elements[0].ref, text: 'semantic-target',
  }))
  assert.equal(typed.ok, true)
  assert.equal(driver.calls[1].element.nativeId, '42:0:0.1')
  assert.equal(driver.calls[1].targetWindow.nativeId, '42:0')
  assert.equal(JSON.stringify(session.events).includes('semantic-target'), false)
})

test('window-scoped observations expose stable refs and semantic element actions', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({
    action: 'observe', scope: 'window', application: 'Fixture',
  }))
  assert.equal(observed.observationScope.type, 'window')
  assert.equal(observed.observationScope.window.ref, observed.windows[0].ref)
  assert.deepEqual(observed.screen, { x: 100, y: 50, width: 6, height: 6, scaleFactor: 1 })
  assert.deepEqual(observed.elements[0].bbox, { x: 1, y: 1, width: 4, height: 2 })
  assert.equal(observed.capabilities.stateDiff, true)
  assert.equal(observed.elementsTruncated, false)
  assert.equal(observed.elementTotal, 1)
  assert.equal(driver.calls[0].captureScope, 'window')
  assert.equal(driver.calls[0].captureApplication, 'Fixture')

  const invoked = await session.execute(parseDesktopArgs({
    action: 'invoke', stateId: observed.stateId, elementRef: observed.elements[0].ref,
  }))
  assert.equal(invoked.observationScope.type, 'window')
  assert.equal(invoked.elements[0].ref, observed.elements[0].ref)
  assert.equal(driver.calls[1].element.nativeId, '42:0:0.1')
  assert.equal(driver.calls[1].captureWindow.nativeId, '42:0')

  const assigned = await session.execute(parseDesktopArgs({
    action: 'set_value', stateId: invoked.stateId, elementRef: invoked.elements[0].ref, value: 'private value',
  }))
  assert.equal(assigned.ok, true)
  assert.equal(driver.calls[2].value, 'private value')
  assert.equal(JSON.stringify(session.events).includes('private value'), false)
  assert.match(JSON.stringify(session.events), /valueSha256/)

  const closedWindow = await session.execute(parseDesktopArgs({
    action: 'close_window', stateId: assigned.stateId, windowRef: assigned.windows[0].ref,
  }))
  assert.equal(closedWindow.observationScope.type, 'desktop')
  assert.equal(driver.calls[3].captureScope, 'desktop')
})

test('launch and name-based focus are stateless while read-only window ref observation reuses current state', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const launched = await session.execute(parseDesktopArgs({ action: 'launch', application: 'Fixture' }))
  assert.equal(launched.ok, true)
  assert.equal(driver.calls[0].captureApplication, 'Fixture')

  const focused = await session.execute(parseDesktopArgs({ action: 'focus', application: 'Fixture' }))
  assert.equal(focused.ok, true)
  assert.equal(driver.calls[1].application, 'Fixture')

  const observed = await session.execute(parseDesktopArgs({
    action: 'observe', scope: 'window', windowRef: focused.windows[0].ref,
  }))
  assert.equal(observed.ok, true)
  assert.equal(driver.calls[2].window.nativeId, '42:0')
  assert.equal(driver.calls[2].captureWindow.nativeId, '42:0')
})

test('an explicit application target overrides the previously captured window', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  await session.execute(parseDesktopArgs({ action: 'observe', scope: 'window', application: 'Fixture' }))
  assert.equal(driver.calls[0].captureWindow, undefined)
  await session.execute(parseDesktopArgs({ action: 'launch', application: 'Another App' }))
  assert.equal(driver.calls[1].captureWindow, undefined)
  assert.equal(driver.calls[1].captureApplication, 'Another App')
})

test('runtime assertions evaluate the latest native window, element, and screenshot state', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const session = new DesktopSession(mockContext(), config, { driver: new FakeDesktopDriver() })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const elementRef = observed.elements[0].ref
  const windowRef = observed.windows[0].ref
  const visible = await session.execute(parseDesktopArgs({
    action: 'assert', stateId: observed.stateId, assertion: 'element_visible', elementRef,
  }))
  assert.equal(visible.ok, true)
  assert.equal(visible.assertion.verifiedBy, 'desktop-runtime')
  const titled = await session.execute(parseDesktopArgs({
    action: 'assert', stateId: visible.stateId, assertion: 'window_title_contains',
    windowRef, expected: 'Fixture',
  }))
  assert.equal(titled.ok, true)
  const changed = await session.execute(parseDesktopArgs({
    action: 'assert', stateId: titled.stateId, assertion: 'screen_changed',
  }))
  assert.equal(changed.ok, true)
  assert.equal(changed.assertion.actual, true)
})

test('screen_unchanged compares decoded pixels instead of PNG encoding bytes', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const fixed = nativeResult(1, 'observe')
  const recompressed = losslessDesktopPngTiles(fixed.screenshot).tiles[0].data
  assert.notDeepEqual(recompressed, fixed.screenshot)
  const driver = {
    calls: [],
    async execute(args) {
      this.calls.push(structuredClone(args))
      const screenshot = this.calls.length === 1 ? fixed.screenshot : recompressed
      return { ...structuredClone(fixed), screenshot: Buffer.from(screenshot), actionResult: { performed: args.action } }
    },
  }
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const unchanged = await session.execute(parseDesktopArgs({
    action: 'assert', stateId: observed.stateId, assertion: 'screen_unchanged',
  }))
  assert.equal(unchanged.ok, true)
  assert.notEqual(unchanged.screenshot.sha256, observed.screenshot.sha256)
  assert.equal(unchanged.screenshot.pixelSha256, observed.screenshot.pixelSha256)
  assert.equal(unchanged.stateDelta.screenshotChanged, false)
})

test('desktop reports never persist typed text and close clears live state', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const typed = await session.execute(parseDesktopArgs({
    action: 'type', stateId: observed.stateId, elementRef: observed.elements[0].ref,
    text: 'private fixture text', secret: true,
  }))
  const reportState = await session.execute(parseDesktopArgs({
    action: 'report', stateId: typed.stateId, reportName: 'acceptance',
  }))
  assert.equal(reportState.report.summary.passed, true)
  const serialized = JSON.stringify(session.events)
  assert.equal(serialized.includes('private fixture text'), false)
  assert.match(serialized, /textSha256/)

  const closed = await session.execute(parseDesktopArgs({ action: 'close' }))
  assert.equal(closed.closed, true)
  assert.equal(session.latest, undefined)
  assert.equal(session.latestWindows.size, 0)
})

test('desktop visual assertions feed the automatic test report', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const session = new DesktopSession(mockContext(), config, { driver: new FakeDesktopDriver() })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const passed = await session.execute(parseDesktopArgs({
    action: 'assert',
    stateId: observed.stateId,
    assertion: 'visual',
    passed: true,
    expected: 'Fixture window',
    actual: 'Fixture window',
  }))
  assert.equal(passed.ok, true)
  assert.equal(passed.assertion.passed, true)
  const failed = await session.execute(parseDesktopArgs({
    action: 'assert',
    stateId: passed.stateId,
    assertion: 'visual',
    passed: false,
    expected: 'No error banner',
    actual: 'Error banner visible',
  }))
  assert.equal(failed.ok, false)
  const reportState = await session.execute(parseDesktopArgs({
    action: 'report', stateId: failed.stateId, reportName: 'assertions',
  }))
  assert.equal(reportState.report.summary.passed, false)
  assert.equal(reportState.report.summary.assertionCount, 2)
  assert.equal(reportState.report.summary.assertionFailureCount, 1)
  assert.equal(reportState.report.summary.actionFailureCount, 0)
})

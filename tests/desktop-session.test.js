import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import { DesktopSession, parseDesktopArgs } from '../src/desktop/index.js'
import { PROBE_COLORS, createProbePng } from '../src/probe.js'
import { mockContext } from './_helpers.js'

const order = PROBE_COLORS.map(entry => entry.name)

function nativeResult(sequence, action) {
  const screenshot = createProbePng(sequence % 2 === 0 ? [...order].reverse() : order, 2)
  return {
    platform: 'darwin',
    screenshot,
    screen: { x: 0, y: 0, width: 6, height: 6, scaleFactor: 1 },
    cursor: { x: sequence, y: sequence },
    activeWindow: {
      nativeId: '42:0', pid: 42, application: 'Fixture', title: `Fixture ${sequence}`,
      active: true, x: 0, y: 0, width: 6, height: 6, index: 0,
    },
    windows: [{
      nativeId: '42:0', pid: 42, application: 'Fixture', title: `Fixture ${sequence}`,
      active: true, x: 0, y: 0, width: 6, height: 6, index: 0,
    }],
    capabilities: { screenshot: true, mouse: true, keyboard: true, windows: true },
    actionResult: { performed: action },
  }
}

class FakeDesktopDriver {
  constructor() {
    this.calls = []
  }

  async execute(args) {
    this.calls.push(structuredClone(args))
    return nativeResult(this.calls.length, args.action)
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
  assert.equal(observed.windows[0].ref, 'win_1')
  assert.match(observed.stateId, /^desktop-state:[a-f0-9]{64}$/)
  assert.equal(observed.screenshot.attachmentId, observed.image.attachmentId)

  const clicked = await session.execute(parseDesktopArgs({
    action: 'click', stateId: observed.stateId, x: 5, y: 5,
  }))
  assert.equal(clicked.sequence, 2)
  assert.notEqual(clicked.stateId, observed.stateId)
  assert.deepEqual(driver.calls[1].screen, observed.screen)
  assert.deepEqual(driver.calls.map(call => call.action), ['observe', 'click'])
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
    action: 'focus', stateId: state.stateId, windowRef: 'win_1',
  }))
  assert.equal(focused.ok, true)
  assert.equal(driver.calls.at(-1).window.nativeId, '42:0')
})

test('desktop reports never persist typed text and close clears live state', async () => {
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const driver = new FakeDesktopDriver()
  const session = new DesktopSession(mockContext(), config, { driver })
  const observed = await session.execute(parseDesktopArgs({ action: 'observe' }))
  const typed = await session.execute(parseDesktopArgs({
    action: 'type', stateId: observed.stateId, text: 'private fixture text', secret: true,
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
    assertion: 'Fixture window is visible',
    passed: true,
    expected: 'Fixture window',
    actual: 'Fixture window',
  }))
  assert.equal(passed.ok, true)
  assert.equal(passed.assertion.passed, true)
  const failed = await session.execute(parseDesktopArgs({
    action: 'assert',
    stateId: passed.stateId,
    assertion: 'Error banner is absent',
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

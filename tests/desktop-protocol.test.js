import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import {
  DESKTOP_SYSTEM_PROMPT,
  DesktopSessionManager,
  applyDesktopComputerUse,
  createDesktopTool,
  parseDesktopArgs,
  renderDesktopResult,
  reportableDesktopArgs,
} from '../src/desktop/index.js'
import { mockContext } from './_helpers.js'

test('desktop protocol binds mutations to state, coordinates, current windows, and semantic elements', () => {
  assert.equal(parseDesktopArgs({ action: 'OBSERVE' }).action, 'observe')
  assert.equal(parseDesktopArgs({ action: 'observe', scope: 'WINDOW', application: 'Fixture' }).scope, 'window')
  assert.throws(() => parseDesktopArgs({ action: 'observe', scope: 'display' }), /scope must be one of/)
  assert.throws(() => parseDesktopArgs({ action: 'click', x: 1, y: 2 }), /latest computer result/)
  assert.throws(
    () => parseDesktopArgs({ action: 'click', stateId: 'desktop-state:x', elementRef: 'el_1', x: 1, y: 2 }),
    /elementRef or x\/y, not both/,
  )
  assert.throws(
    () => parseDesktopArgs({ action: 'drag', stateId: 'desktop-state:x', x: 1, y: 2, endX: 3 }),
    /endX and endY/,
  )
  assert.throws(
    () => parseDesktopArgs({ action: 'move_window', stateId: 'desktop-state:x', x: 1, y: 2 }),
    /requires windowRef, application, or title/,
  )
  assert.throws(
    () => parseDesktopArgs({ action: 'resize_window', stateId: 'desktop-state:x', windowRef: 'win_1', width: 0, height: 2 }),
    /positive width and height/,
  )
  assert.throws(
    () => parseDesktopArgs({ action: 'assert', stateId: 'desktop-state:x', assertion: 'window visible' }),
    /assertion must be one of/,
  )
  assert.throws(
    () => parseDesktopArgs({ action: 'set_value', stateId: 'desktop-state:x', elementRef: 'el_1' }),
    /requires value/,
  )
  assert.throws(
    () => parseDesktopArgs({ action: 'type', stateId: 'desktop-state:x', text: 'fixture' }),
    /requires elementRef or x\/y/,
  )
  assert.equal(parseDesktopArgs({
    action: 'type', stateId: 'desktop-state:x', text: 'fixture', allowFocusedTarget: true,
  }).allowFocusedTarget, true)
  const coordinateType = parseDesktopArgs({
    action: 'type', stateId: 'desktop-state:x', text: 'fixture', x: 10, y: 20,
  })
  assert.equal(coordinateType.x, 10)
  assert.equal(coordinateType.y, 20)
  assert.equal(coordinateType.allowFocusedTarget, undefined)
  assert.throws(
    () => parseDesktopArgs({ action: 'type', stateId: 'desktop-state:x', text: 'fixture', x: 10 }),
    /requires x and y/,
  )
  assert.throws(
    () => parseDesktopArgs({
      action: 'type', stateId: 'desktop-state:x', text: 'fixture', elementRef: 'el_1', x: 10, y: 20,
    }),
    /elementRef or x\/y, not both/,
  )
  assert.equal(parseDesktopArgs({
    action: 'set_value', stateId: 'desktop-state:x', elementRef: 'el_1', value: 42,
  }).value, '42')
  assert.equal(parseDesktopArgs({
    action: 'assert', stateId: 'desktop-state:x', assertion: 'visual', passed: true,
  }).passed, true)
  assert.equal(parseDesktopArgs({ action: 'focus', application: 'ChatGPT' }).stateId, undefined)
  assert.equal(parseDesktopArgs({ action: 'observe', windowRef: 'win_fixture' }).stateId, undefined)
  assert.equal(parseDesktopArgs({ action: 'observe', includeScreenshot: true }).includeScreenshot, true)
  assert.throws(
    () => parseDesktopArgs({ action: 'observe', includeScreenshot: 'yes' }),
    /includeScreenshot must be boolean/,
  )
  assert.throws(() => parseDesktopArgs({ action: 'focus', windowRef: 'win_fixture' }), /same latest computer result/)
})

test('desktop action reports hash typed text and launch arguments', () => {
  const typed = reportableDesktopArgs(parseDesktopArgs({
    action: 'type',
    stateId: 'desktop-state:x',
    elementRef: 'el_fixture',
    text: 'example-private-input',
    secret: true,
  }))
  assert.equal(typed.text, undefined)
  assert.equal(typed.textLength, 21)
  assert.match(typed.textSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(typed).includes('example-private-input'), false)

  const assigned = reportableDesktopArgs(parseDesktopArgs({
    action: 'set_value',
    stateId: 'desktop-state:x',
    elementRef: 'el_fixture',
    value: 'example-private-value',
  }))
  assert.equal(assigned.value, undefined)
  assert.equal(assigned.valueLength, 21)
  assert.match(assigned.valueSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(assigned).includes('example-private-value'), false)

  const launched = reportableDesktopArgs(parseDesktopArgs({
    action: 'launch',
    application: 'sample-app',
    arguments: ['--fixture', 'value'],
  }))
  assert.equal(launched.arguments, undefined)
  assert.equal(launched.argumentCount, 2)
  assert.match(launched.argumentsSha256, /^[a-f0-9]{64}$/)
  assert.equal(parseDesktopArgs({ action: 'launch', application: 'ChatGPT' }).stateId, undefined)
})

test('desktop 0.5 configuration is opt-in with Windows and macOS semantic controls', () => {
  const defaults = resolveConfig({}, {}, '/home')
  assert.equal(defaults.desktopComputerUse, false)
  assert.equal(defaults.desktopVisualMode, 'auto')
  assert.equal(defaults.desktopHistoryLimit, 8)
  assert.equal(defaults.desktopTimeoutMs, 30_000)
  assert.equal(defaults.desktopSettleMs, 300)
  assert.equal(defaults.desktopMaxWindows, 50)
  assert.equal(defaults.desktopSemantic, true)
  assert.equal(defaults.desktopMaxElements, 200)
  assert.equal(defaults.desktopMacDisplay, 1)
  assert.equal(defaults.desktopWindowsPowerShell, undefined)
  assert.equal(defaults.desktopArtifactsDir, join('/home', '.dsh', 'deepseekeyes', 'desktop-runs'))

  const configured = resolveConfig({ desktopArtifactsDir: false, desktopMaxElements: 320 }, {
    DEEPSEEKEYES_DESKTOP_ENABLED: 'true',
    DEEPSEEKEYES_DESKTOP_SEMANTIC: 'false',
    DEEPSEEKEYES_DESKTOP_VISUAL_MODE: 'manual',
    DEEPSEEKEYES_DESKTOP_WINDOWS_POWERSHELL: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  }, '/home')
  assert.equal(configured.desktopComputerUse, true)
  assert.equal(configured.desktopSemantic, false)
  assert.equal(configured.desktopVisualMode, 'manual')
  assert.equal(configured.desktopMaxElements, 320)
  assert.match(configured.desktopWindowsPowerShell, /powershell\.exe$/)
  assert.equal(configured.desktopArtifactsDir, undefined)
  assert.throws(
    () => resolveConfig({ desktopVisualMode: 'sometimes' }, {}, '/home'),
    /desktopVisualMode must be one of auto, always, manual/,
  )
})

test('desktop manager applies live enablement without adding overhead to ordinary sessions', async () => {
  const ctx = mockContext()
  const disabled = resolveConfig({ desktopArtifactsDir: false }, {}, '/tmp')
  const manager = applyDesktopComputerUse(ctx, disabled)
  assert.equal(ctx.tools.get('computer'), undefined)
  assert.equal(ctx.systemPrompt.sections.has('deepseekeyes:desktop-computer-use'), false)

  const enabled = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  manager.reconfigure(enabled)
  assert.ok(ctx.tools.get('computer'))
  assert.ok(ctx.systemPrompt.sections.has('deepseekeyes:desktop-computer-use'))
  const registered = ctx.tools.get('computer')
  manager.reconfigure(resolveConfig({
    desktopArtifactsDir: false,
    desktopComputerUse: true,
    desktopTimeoutMs: 120_000,
  }, {}, '/tmp'))
  assert.notEqual(ctx.tools.get('computer'), registered)
  assert.equal(ctx.tools.get('computer').timeoutMs, 135_000)
  manager.reconfigure(disabled)
  assert.equal(ctx.tools.get('computer'), undefined)
  await assert.rejects(
    manager.execute({ action: 'observe' }, { signal: new AbortController().signal }),
    error => error.code === 'DESKTOP_COMPUTER_USE_DISABLED',
  )
})

test('desktop tool renders the current screenshot and rejects non-Eyes routes before native execution', async () => {
  const ctx = mockContext()
  const config = resolveConfig({ desktopArtifactsDir: false, desktopComputerUse: true }, {}, '/tmp')
  const manager = new DesktopSessionManager(ctx, config)
  const tool = createDesktopTool(manager, config)
  const content = renderDesktopResult({
    ok: true,
    action: 'observe',
    stateId: 'desktop-state:test',
    image: { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
  })
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image')
  const fastContent = renderDesktopResult({
    ok: true,
    action: 'observe',
    stateId: 'desktop-state:fast',
    visualDelivery: { delivered: false, reason: 'semantic-state-sufficient' },
    screenshot: { sha256: 'a'.repeat(64), tiles: [{ attachmentId: 'sha256:test' }] },
    image: { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
  })
  assert.equal(fastContent.length, 1)
  assert.equal(fastContent[0].text.includes('"tiles"'), false)
  assert.match(DESKTOP_SYSTEM_PROMPT, /includeScreenshot=true/)
  assert.match(DESKTOP_SYSTEM_PROMPT, /visual model as the pixel-grounding layer/)
  assert.match(DESKTOP_SYSTEM_PROMPT, /Never call type with only text/)
  assert.match(DESKTOP_SYSTEM_PROMPT, /TARGET_FOCUS_MISMATCH/)
  await assert.rejects(
    tool.execute({ action: 'observe' }, {
      signal: new AbortController().signal,
      agent: {
        id: 'session-1',
        options: { provider: 'deepseek-official' },
        session: { requestHeader: () => ({ config: { provider: 'deepseek-official' } }) },
      },
    }),
    error => error.code === 'DESKTOP_REQUIRES_DEEPSEEKEYES',
  )
})

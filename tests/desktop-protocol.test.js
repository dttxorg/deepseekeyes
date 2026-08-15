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

test('desktop protocol binds mutations to state, coordinates, and current windows', () => {
  assert.equal(parseDesktopArgs({ action: 'OBSERVE' }).action, 'observe')
  assert.throws(() => parseDesktopArgs({ action: 'click', x: 1, y: 2 }), /latest stateId/)
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
    /requires assertion and passed/,
  )
  assert.equal(parseDesktopArgs({
    action: 'assert', stateId: 'desktop-state:x', assertion: 'window visible', passed: true,
  }).passed, true)
})

test('desktop action reports hash typed text and launch arguments', () => {
  const typed = reportableDesktopArgs(parseDesktopArgs({
    action: 'type',
    stateId: 'desktop-state:x',
    text: 'example-private-input',
    secret: true,
  }))
  assert.equal(typed.text, undefined)
  assert.equal(typed.textLength, 21)
  assert.match(typed.textSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(typed).includes('example-private-input'), false)

  const launched = reportableDesktopArgs(parseDesktopArgs({
    action: 'launch',
    stateId: 'desktop-state:x',
    application: 'sample-app',
    arguments: ['--fixture', 'value'],
  }))
  assert.equal(launched.arguments, undefined)
  assert.equal(launched.argumentCount, 2)
  assert.match(launched.argumentsSha256, /^[a-f0-9]{64}$/)
})

test('desktop 0.3 configuration is opt-in with Windows and macOS native controls', () => {
  const defaults = resolveConfig({}, {}, '/home')
  assert.equal(defaults.desktopComputerUse, false)
  assert.equal(defaults.desktopHistoryLimit, 8)
  assert.equal(defaults.desktopTimeoutMs, 15_000)
  assert.equal(defaults.desktopSettleMs, 300)
  assert.equal(defaults.desktopMaxWindows, 50)
  assert.equal(defaults.desktopMacDisplay, 1)
  assert.equal(defaults.desktopWindowsPowerShell, undefined)
  assert.equal(defaults.desktopArtifactsDir, join('/home', '.dsh', 'deepseekeyes', 'desktop-runs'))

  const configured = resolveConfig({ desktopArtifactsDir: false }, {
    DEEPSEEKEYES_DESKTOP_ENABLED: 'true',
    DEEPSEEKEYES_DESKTOP_WINDOWS_POWERSHELL: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  }, '/home')
  assert.equal(configured.desktopComputerUse, true)
  assert.match(configured.desktopWindowsPowerShell, /powershell\.exe$/)
  assert.equal(configured.desktopArtifactsDir, undefined)
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
  assert.match(DESKTOP_SYSTEM_PROMPT, /Windows or macOS/)
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

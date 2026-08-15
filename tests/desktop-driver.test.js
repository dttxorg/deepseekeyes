import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import { NativeDesktopDriver, runNativeJson } from '../src/desktop/index.js'
import { PROBE_COLORS, createProbePng } from '../src/probe.js'

const png = createProbePng(PROBE_COLORS.map(entry => entry.name), 1)

test('native desktop driver routes macOS and Windows to packaged native helpers', async () => {
  const calls = []
  const runJson = async (command, args, input, options) => {
    calls.push({ command, args, input, options })
    await writeFile(input.screenshotPath, png)
    return { ok: true, windows: [], capabilities: { screenshot: true } }
  }
  const macConfig = resolveConfig({ desktopArtifactsDir: false }, {}, '/tmp')
  const mac = new NativeDesktopDriver(macConfig, { platform: 'darwin', runJson, temporaryRoot: tmpdir() })
  const macResult = await mac.execute({ action: 'observe' })
  assert.equal(calls[0].command, '/usr/bin/osascript')
  assert.deepEqual(calls[0].args.slice(0, 2), ['-l', 'JavaScript'])
  assert.match(calls[0].args[2], /helpers\/macos\.jxa$/)
  assert.equal(calls[0].input.macDisplay, 1)
  assert.equal(macResult.platform, 'darwin')
  assert.deepEqual(macResult.screenshot, png)

  const windowsConfig = resolveConfig({
    desktopArtifactsDir: false,
    desktopWindowsPowerShell: 'C:\\Fixture\\powershell.exe',
  }, {}, '/tmp')
  const windows = new NativeDesktopDriver(windowsConfig, { platform: 'win32', runJson, temporaryRoot: tmpdir() })
  await windows.execute({ action: 'observe' })
  assert.equal(calls[1].command, 'C:\\Fixture\\powershell.exe')
  assert.ok(calls[1].args.includes('-NonInteractive'))
  assert.match(calls[1].args.at(-1), /helpers\/windows\.ps1$/)
  assert.equal(calls[1].input.maxWindows, 50)

  const unsupported = new NativeDesktopDriver(macConfig, { platform: 'linux', runJson })
  await assert.rejects(unsupported.execute({ action: 'observe' }), error => error.code === 'DESKTOP_PLATFORM_UNSUPPORTED')
})

test('native JSON runner keeps input on stdin and validates helper output', async () => {
  const echo = [
    '-e',
    'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({ok:true,input:JSON.parse(s)})))',
  ]
  const value = await runNativeJson(process.execPath, echo, { action: 'observe', text: 'stdin-only' })
  assert.equal(value.input.text, 'stdin-only')

  await assert.rejects(
    runNativeJson(process.execPath, ['-e', 'process.stdout.write("not-json")'], {}),
    error => error.code === 'DESKTOP_HELPER_INVALID_JSON',
  )
  await assert.rejects(
    runNativeJson(process.execPath, ['-e', 'process.stderr.write("fixture failure");process.exit(9)'], {}),
    error => error.code === 'DESKTOP_HELPER_FAILED' && /fixture failure/.test(error.message),
  )
})

test('packaged helpers retain both native platforms and avoid the macOS CFRelease crash', async () => {
  const mac = await readFile(new URL('../src/desktop/helpers/macos.jxa', import.meta.url), 'utf8')
  const windows = await readFile(new URL('../src/desktop/helpers/windows.ps1', import.meta.url), 'utf8')
  assert.match(mac, /screencapture/)
  assert.match(mac, /CGEventCreateMouseEvent/)
  assert.doesNotMatch(mac, /\$\.CFRelease\(/)
  assert.match(windows, /user32\.dll/)
  assert.match(windows, /CopyFromScreen/)
  assert.match(windows, /SendUnicode/)
  assert.match(windows, /public static void Scroll/)
})

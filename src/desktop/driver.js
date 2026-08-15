import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekEyesError } from '../error.js'
import { runNativeJson } from './native-runner.js'

const MAC_HELPER = fileURLToPath(new URL('./helpers/macos.jxa', import.meta.url))
const WINDOWS_HELPER = fileURLToPath(new URL('./helpers/windows.ps1', import.meta.url))

function helperCommand(platform, config) {
  if (platform === 'darwin') {
    return { command: '/usr/bin/osascript', args: ['-l', 'JavaScript', MAC_HELPER] }
  }
  if (platform === 'win32') {
    return {
      command: config.desktopWindowsPowerShell ?? 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_HELPER],
    }
  }
  throw new DeepSeekEyesError(
    `native desktop computer use has no driver for ${platform}`,
    'DESKTOP_PLATFORM_UNSUPPORTED',
  )
}

/** Native Windows/macOS driver. The helper writes screenshots to a private temporary path. */
export class NativeDesktopDriver {
  constructor(config, options = {}) {
    this.config = config
    this.platform = options.platform ?? process.platform
    this.runJson = options.runJson ?? runNativeJson
    this.temporaryRoot = options.temporaryRoot ?? tmpdir()
  }

  async execute(args, signal) {
    const helper = helperCommand(this.platform, this.config)
    const folder = await mkdtemp(join(this.temporaryRoot, 'deepseekeyes-desktop-'))
    const screenshotPath = join(folder, 'screen.png')
    try {
      const value = await this.runJson(helper.command, helper.args, {
        ...args,
        platform: this.platform,
        screenshotPath,
        settleMs: this.config.desktopSettleMs,
        maxWindows: this.config.desktopMaxWindows,
        semantic: this.config.desktopSemantic,
        maxElements: this.config.desktopMaxElements,
        macDisplay: this.config.desktopMacDisplay,
      }, {
        signal,
        timeoutMs: Math.max(
          args.timeoutMs ?? this.config.desktopTimeoutMs,
          Number(args.durationMs ?? 0) + this.config.desktopSettleMs + 5_000,
        ),
      })
      const screenshot = await readFile(screenshotPath).catch(() => undefined)
      if (!Buffer.isBuffer(screenshot) || screenshot.length < 24) {
        throw new DeepSeekEyesError(
          'native desktop helper did not produce a PNG screenshot',
          'DESKTOP_SCREENSHOT_MISSING',
        )
      }
      return { ...value, platform: this.platform, screenshot }
    } finally {
      await rm(folder, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function createDesktopDriver(config, options = {}) {
  return new NativeDesktopDriver(config, options)
}

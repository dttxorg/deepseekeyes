import { chromium } from 'playwright-core'
import { DeepSeekEyesError, errorMessage } from '../error.js'

function automaticCandidates(platform) {
  if (platform === 'win32') return [{ channel: 'msedge' }, { channel: 'chrome' }, {}]
  if (platform === 'darwin') return [{ channel: 'chrome' }, { channel: 'msedge' }, {}]
  return [{ channel: 'chrome' }, { channel: 'msedge' }, {}]
}

function candidateLabel(candidate) {
  if (candidate.executablePath !== undefined) return `executable ${candidate.executablePath}`
  if (candidate.channel !== undefined) return `channel ${candidate.channel}`
  return 'Playwright Chromium'
}

/** Launch installed Chrome/Edge first and fall back to Playwright's Chromium. */
export async function launchBrowser(config, signal, chromiumApi = chromium, platform = process.platform) {
  const explicit = config.browserExecutablePath !== undefined
    ? [{ executablePath: config.browserExecutablePath }]
    : config.browserChannel !== undefined
      ? [{ channel: config.browserChannel }]
      : automaticCandidates(platform)
  const failures = []
  for (const candidate of explicit) {
    if (signal?.aborted) throw signal.reason
    try {
      const browser = await chromiumApi.launch({
        ...candidate,
        headless: config.browserHeadless,
        timeout: config.browserTimeoutMs,
      })
      return Object.freeze({ browser, launch: Object.freeze({ ...candidate }) })
    } catch (error) {
      failures.push(`${candidateLabel(candidate)}: ${errorMessage(error).split('\n')[0]}`)
    }
  }
  throw new DeepSeekEyesError(
    `no usable Chromium browser was found; ${failures.join(' | ')}`,
    'BROWSER_LAUNCH_FAILED',
  )
}

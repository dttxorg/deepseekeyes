import { spawn } from 'node:child_process'
import { DeepSeekEyesError, errorMessage } from '../error.js'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** Run one native JSON helper without placing typed input in process arguments. */
export function runNativeJson(command, args, input, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? 30_000
  const signal = options.signal
  return new Promise((resolve, reject) => {
    let settled = false
    let stdoutBytes = 0
    let stderrBytes = 0
    const stdout = []
    const stderr = []
    const child = spawnImpl(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: options.env ?? process.env,
    })

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const terminate = () => {
      try { child.kill('SIGKILL') } catch {}
    }
    const onAbort = () => {
      terminate()
      finish(signal.reason instanceof Error ? signal.reason : new Error('desktop action aborted'))
    }
    const timer = setTimeout(() => {
      terminate()
      finish(new DeepSeekEyesError(
        `native desktop helper timed out after ${timeoutMs}ms`,
        'DESKTOP_HELPER_TIMEOUT',
      ))
    }, timeoutMs)
    timer.unref?.()
    signal?.addEventListener?.('abort', onAbort, { once: true })

    child.on('error', error => finish(new DeepSeekEyesError(
      `native desktop helper failed to start: ${errorMessage(error)}`,
      'DESKTOP_HELPER_START_FAILED',
    )))
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        terminate()
        finish(new DeepSeekEyesError('native desktop helper output exceeded 8 MiB', 'DESKTOP_HELPER_OUTPUT_LIMIT'))
        return
      }
      stdout.push(Buffer.from(chunk))
    })
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length
      if (stderrBytes <= MAX_OUTPUT_BYTES) stderr.push(Buffer.from(chunk))
    })
    child.on('close', (code, processSignal) => {
      if (settled) return
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        finish(new DeepSeekEyesError(
          `native desktop helper exited ${code ?? processSignal ?? 'unknown'}${errorText === '' ? '' : `: ${errorText.slice(0, 4_000)}`}`,
          'DESKTOP_HELPER_FAILED',
        ))
        return
      }
      const text = Buffer.concat(stdout).toString('utf8').trim()
      try {
        const value = JSON.parse(text)
        if (value?.ok === false) {
          finish(new DeepSeekEyesError(
            value.message ?? 'native desktop helper rejected the action',
            value.code ?? 'DESKTOP_NATIVE_ACTION_FAILED',
          ))
          return
        }
        finish(undefined, value)
      } catch (error) {
        finish(new DeepSeekEyesError(
          `native desktop helper returned invalid JSON: ${errorMessage(error)}`,
          'DESKTOP_HELPER_INVALID_JSON',
        ))
      }
    })
    try {
      child.stdin.end(JSON.stringify(input))
    } catch (error) {
      terminate()
      finish(error)
    }
  })
}

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const VISION_ATTEMPT_SCHEMA_VERSION = 1

function hashSession(sessionId) {
  if (sessionId === undefined || sessionId === null || String(sessionId) === '') return undefined
  return createHash('sha256').update(String(sessionId)).digest('hex')
}

function boundedInteger(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

function normalizeAttempt(input, now) {
  return {
    attemptId: typeof input.attemptId === 'string' ? input.attemptId : randomUUID(),
    timestamp: typeof input.timestamp === 'string' ? input.timestamp : new Date(now()).toISOString(),
    operation: String(input.operation ?? 'unknown').slice(0, 64),
    provider: String(input.provider ?? '').slice(0, 256),
    model: String(input.model ?? '').slice(0, 512),
    priority: boundedInteger(input.priority),
    failoverIndex: boundedInteger(input.failoverIndex),
    phase: ['health', 'operation', 'circuit'].includes(input.phase) ? input.phase : 'operation',
    status: ['success', 'cache-hit', 'failed', 'skipped-open-circuit'].includes(input.status)
      ? input.status
      : 'failed',
    durationMs: boundedInteger(input.durationMs),
    ...(typeof input.errorCode === 'string' && input.errorCode !== ''
      ? { errorCode: input.errorCode.slice(0, 128) }
      : {}),
    ...(typeof input.sessionHash === 'string'
      ? { sessionHash: input.sessionHash }
      : hashSession(input.sessionId) === undefined ? {} : { sessionHash: hashSession(input.sessionId) }),
    ...(typeof input.imageSha256 === 'string' && /^[0-9a-f]{64}$/.test(input.imageSha256)
      ? { imageSha256: input.imageSha256 }
      : {}),
  }
}

function validState(value, limit, now) {
  const attempts = Array.isArray(value?.attempts)
    ? value.attempts.slice(-limit).map(attempt => normalizeAttempt(attempt, now))
    : []
  return {
    schemaVersion: VISION_ATTEMPT_SCHEMA_VERSION,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : new Date(now()).toISOString(),
    attempts,
  }
}

/** Bounded local audit record for health checks, failures and route failover. */
export class VisionAttemptTracker {
  constructor({ enabled = true, file, limit = 1_000, logger = console, now = Date.now } = {}) {
    this.enabled = enabled
    this.file = file
    this.limit = limit
    this.logger = logger
    this.now = now
    this.state = validState(undefined, limit, now)
    this.persistenceError = undefined
    this.queue = this.load()
  }

  async load() {
    if (this.file === undefined) return
    try {
      this.state = validState(JSON.parse(await readFile(this.file, 'utf8')), this.limit, this.now)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.persistenceError = error.message
        this.logger.warn?.(`deepseekeyes: vision attempt log load failed: ${error.message}`)
      }
    }
  }

  async persistSafely() {
    if (this.file === undefined) return
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.file)
      await chmod(this.file, 0o600)
      this.persistenceError = undefined
    } catch (error) {
      this.persistenceError = error.message
      this.logger.warn?.(`deepseekeyes: vision attempt log persist failed: ${error.message}`)
    }
  }

  record(input) {
    const attempt = normalizeAttempt(input, this.now)
    if (!this.enabled) return Promise.resolve(attempt)
    this.queue = this.queue.then(async () => {
      this.state.attempts.push(attempt)
      this.state.attempts = this.state.attempts.slice(-this.limit)
      this.state.updatedAt = attempt.timestamp
      await this.persistSafely()
      return structuredClone(attempt)
    })
    return this.queue
  }

  async snapshot() {
    await this.queue
    return {
      ...structuredClone(this.state),
      persistence: {
        enabled: this.enabled,
        file: this.file,
        healthy: this.persistenceError === undefined,
        ...(this.persistenceError === undefined ? {} : { error: this.persistenceError }),
      },
    }
  }
}

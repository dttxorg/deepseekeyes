import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DeepSeekEyesError, errorMessage } from './error.js'

/** In-memory plus optional private on-disk cache for immutable visual evidence. */
export class EvidenceCache {
  constructor({ directory, persistent = true, logger = console }) {
    this.directory = directory
    this.persistent = persistent && directory !== undefined
    this.logger = logger
    this.memory = new Map()
  }

  pathFor(key) {
    return join(this.directory, `${key}.json`)
  }

  async read(key) {
    const memory = this.memory.get(key)
    if (memory !== undefined) return structuredClone(memory)
    if (!this.persistent) return undefined
    try {
      const value = JSON.parse(await readFile(this.pathFor(key), 'utf8'))
      if (value?.cacheKey !== key) throw new Error('cache key mismatch')
      this.memory.set(key, value)
      return structuredClone(value)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn?.(`deepseekeyes: ignoring unreadable evidence cache ${key}: ${errorMessage(error)}`)
      }
      return undefined
    }
  }

  async write(key, record) {
    const value = Object.freeze({ ...structuredClone(record), cacheKey: key })
    if (this.persistent) {
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const temporary = join(this.directory, `.${key}.${randomUUID()}.tmp`)
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
        await rename(temporary, this.pathFor(key))
      } catch (error) {
        throw new DeepSeekEyesError(
          `visual evidence was produced but could not be persisted: ${errorMessage(error)}`,
          'EVIDENCE_PERSIST_FAILED',
          { cause: error },
        )
      }
    }
    this.memory.set(key, value)
    return structuredClone(value)
  }
}

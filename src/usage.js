import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const USAGE_STATS_SCHEMA_VERSION = 1
export const DEFAULT_USAGE_SESSION_LIMIT = 50

const USAGE_FIELDS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
])

export const USAGE_CATEGORIES = Object.freeze([
  'visionProbe',
  'visionBase',
  'visionTarget',
  'upstreamClarification',
  'upstreamAutomation',
  'upstreamFinal',
])

function timestamp(now) {
  return new Date(now()).toISOString()
}

function zeroUsage() {
  return Object.fromEntries(USAGE_FIELDS.map(field => [field, 0]))
}

function zeroCalls() {
  return Object.fromEntries(USAGE_CATEGORIES.map(category => [category, 0]))
}

function zeroUsageByCategory() {
  return Object.fromEntries(USAGE_CATEGORIES.map(category => [category, zeroUsage()]))
}

function zeroAggregate() {
  return {
    visualTurns: 0,
    automationTurns: 0,
    automationContextCompactions: 0,
    automationLimitStops: 0,
    lookCalls: 0,
    cacheHits: 0,
    estimatedBridgeInputTokens: 0,
    estimatedAutomationInputTokensSaved: 0,
    calls: zeroCalls(),
    usage: zeroUsageByCategory(),
  }
}

function zeroState(now) {
  const at = timestamp(now)
  return {
    schemaVersion: USAGE_STATS_SCHEMA_VERSION,
    startedAt: at,
    updatedAt: at,
    totals: zeroAggregate(),
    sessions: [],
  }
}

function nonnegativeInteger(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

function normalizedUsage(input = {}) {
  return Object.fromEntries(USAGE_FIELDS.map(field => [field, nonnegativeInteger(input[field])]))
}

function addUsage(target, input) {
  const normalized = normalizedUsage(input)
  for (const field of USAGE_FIELDS) target[field] += normalized[field]
}

function usageTotal(usage) {
  return usage.inputTokens
    + usage.outputTokens
    + usage.cacheReadTokens
    + usage.cacheWriteTokens
}

function sumCategories(aggregate, categories) {
  const total = zeroUsage()
  for (const category of categories) addUsage(total, aggregate.usage[category])
  return total
}

function summary(aggregate) {
  const vision = sumCategories(aggregate, ['visionProbe', 'visionBase', 'visionTarget'])
  const upstreamClarification = normalizedUsage(aggregate.usage.upstreamClarification)
  const automation = normalizedUsage(aggregate.usage.upstreamAutomation)
  const finalModel = normalizedUsage(aggregate.usage.upstreamFinal)
  const exactAdditionalUsage = zeroUsage()
  addUsage(exactAdditionalUsage, vision)
  addUsage(exactAdditionalUsage, upstreamClarification)
  addUsage(exactAdditionalUsage, automation)
  const exactAdditionalTokens = usageTotal(exactAdditionalUsage)
  return {
    ...structuredClone(aggregate),
    derived: {
      visionUsage: vision,
      visionTokens: usageTotal(vision),
      upstreamClarificationUsage: upstreamClarification,
      upstreamClarificationTokens: usageTotal(upstreamClarification),
      automationUsage: automation,
      automationTokens: usageTotal(automation),
      finalModelVisualTurnUsage: finalModel,
      finalModelVisualTurnTokens: usageTotal(finalModel),
      exactAdditionalUsage,
      exactAdditionalTokens,
      estimatedBridgeInputTokens: aggregate.estimatedBridgeInputTokens,
      estimatedAdditionalTokens: exactAdditionalTokens + aggregate.estimatedBridgeInputTokens,
    },
  }
}

function validAggregate(input) {
  const aggregate = zeroAggregate()
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return aggregate
  aggregate.visualTurns = nonnegativeInteger(input.visualTurns)
  aggregate.automationTurns = nonnegativeInteger(input.automationTurns)
  aggregate.automationContextCompactions = nonnegativeInteger(input.automationContextCompactions)
  aggregate.automationLimitStops = nonnegativeInteger(input.automationLimitStops)
  aggregate.lookCalls = nonnegativeInteger(input.lookCalls)
  aggregate.cacheHits = nonnegativeInteger(input.cacheHits)
  aggregate.estimatedBridgeInputTokens = nonnegativeInteger(input.estimatedBridgeInputTokens)
  aggregate.estimatedAutomationInputTokensSaved = nonnegativeInteger(input.estimatedAutomationInputTokensSaved)
  for (const category of USAGE_CATEGORIES) {
    aggregate.calls[category] = nonnegativeInteger(input.calls?.[category])
    aggregate.usage[category] = normalizedUsage(input.usage?.[category])
  }
  return aggregate
}

function validState(input, now, sessionLimit) {
  if (input?.schemaVersion !== USAGE_STATS_SCHEMA_VERSION) return zeroState(now)
  const fallback = zeroState(now)
  const sessions = Array.isArray(input.sessions)
    ? input.sessions
        .filter(entry => entry !== null && typeof entry === 'object' && typeof entry.sessionId === 'string')
        .slice(-sessionLimit)
        .map(entry => ({
          sessionId: entry.sessionId,
          updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : fallback.updatedAt,
          aggregate: validAggregate(entry.aggregate),
        }))
    : []
  return {
    schemaVersion: USAGE_STATS_SCHEMA_VERSION,
    startedAt: typeof input.startedAt === 'string' ? input.startedAt : fallback.startedAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : fallback.updatedAt,
    totals: validAggregate(input.totals),
    sessions,
  }
}

function applyDelta(aggregate, delta) {
  if (delta.visualTurns !== undefined) aggregate.visualTurns += nonnegativeInteger(delta.visualTurns)
  if (delta.automationTurns !== undefined) aggregate.automationTurns += nonnegativeInteger(delta.automationTurns)
  if (delta.automationContextCompactions !== undefined) {
    aggregate.automationContextCompactions += nonnegativeInteger(delta.automationContextCompactions)
  }
  if (delta.automationLimitStops !== undefined) {
    aggregate.automationLimitStops += nonnegativeInteger(delta.automationLimitStops)
  }
  if (delta.lookCalls !== undefined) aggregate.lookCalls += nonnegativeInteger(delta.lookCalls)
  if (delta.cacheHits !== undefined) aggregate.cacheHits += nonnegativeInteger(delta.cacheHits)
  if (delta.estimatedBridgeInputTokens !== undefined) {
    aggregate.estimatedBridgeInputTokens += nonnegativeInteger(delta.estimatedBridgeInputTokens)
  }
  if (delta.estimatedAutomationInputTokensSaved !== undefined) {
    aggregate.estimatedAutomationInputTokensSaved += nonnegativeInteger(delta.estimatedAutomationInputTokensSaved)
  }
  if (delta.category !== undefined) {
    if (!USAGE_CATEGORIES.includes(delta.category)) throw new TypeError(`unknown usage category ${delta.category}`)
    aggregate.calls[delta.category] += nonnegativeInteger(delta.calls ?? 1)
    addUsage(aggregate.usage[delta.category], delta.usage)
  }
}

/** Fixed DSH-compatible heuristic for plugin-injected text when a provider cannot split input usage. */
export function estimateInjectedTextTokens(text, { block = true, message = false } = {}) {
  if (typeof text !== 'string' || text.length === 0) return 0
  return Math.ceil(text.length / 4) + (block ? 4 : 0) + (message ? 4 : 0)
}

/** Persistent, local-only accounting of provider-reported and estimated DeepSeekEyes overhead. */
export class UsageTracker {
  constructor({ enabled = true, file, sessionLimit = DEFAULT_USAGE_SESSION_LIMIT, logger = console, now = Date.now } = {}) {
    this.enabled = enabled
    this.file = file
    this.sessionLimit = sessionLimit
    this.logger = logger
    this.now = now
    this.state = zeroState(now)
    this.persistenceError = undefined
    this.queue = this.load()
  }

  async load() {
    if (this.file === undefined) return
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      this.state = validState(parsed, this.now, this.sessionLimit)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.persistenceError = error.message
        this.logger.warn?.(`deepseekeyes: usage stats load failed: ${error.message}`)
      }
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled)
  }

  mutate(sessionId, delta) {
    if (!this.enabled) return Promise.resolve(this.snapshotSync())
    this.queue = this.queue.then(async () => {
      const at = timestamp(this.now)
      applyDelta(this.state.totals, delta)
      if (sessionId !== undefined && sessionId !== null && String(sessionId) !== '') {
        const key = String(sessionId)
        let session = this.state.sessions.find(entry => entry.sessionId === key)
        if (session === undefined) {
          session = { sessionId: key, updatedAt: at, aggregate: zeroAggregate() }
          this.state.sessions.push(session)
        }
        session.updatedAt = at
        applyDelta(session.aggregate, delta)
        this.state.sessions.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        this.state.sessions = this.state.sessions.slice(-this.sessionLimit)
      }
      this.state.updatedAt = at
      await this.persistSafely()
      return this.snapshotSync()
    })
    return this.queue
  }

  recordCall(sessionId, category, usage) {
    return this.mutate(sessionId, { category, usage, calls: 1 })
  }

  recordBridgeEstimate(sessionId, tokens) {
    return this.mutate(sessionId, { estimatedBridgeInputTokens: tokens })
  }

  recordVisualTurn(sessionId) {
    return this.mutate(sessionId, { visualTurns: 1 })
  }

  recordAutomationTurn(sessionId) {
    return this.mutate(sessionId, { automationTurns: 1 })
  }

  recordAutomationContextCompaction(sessionId, savedTokens) {
    return this.mutate(sessionId, {
      automationContextCompactions: 1,
      estimatedAutomationInputTokensSaved: savedTokens,
    })
  }

  recordAutomationLimitStop(sessionId) {
    return this.mutate(sessionId, { automationLimitStops: 1 })
  }

  recordLookCall(sessionId) {
    return this.mutate(sessionId, { lookCalls: 1 })
  }

  recordCacheHit(sessionId) {
    return this.mutate(sessionId, { cacheHits: 1 })
  }

  async persist() {
    if (this.file === undefined) return
    const directory = dirname(this.file)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  async persistSafely() {
    if (this.file === undefined) return true
    try {
      await this.persist()
      if (this.persistenceError !== undefined) {
        this.logger.info?.('deepseekeyes: usage stats persistence recovered')
      }
      this.persistenceError = undefined
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.persistenceError !== message) {
        this.logger.warn?.(`deepseekeyes: usage stats persist failed; continuing in memory: ${message}`)
      }
      this.persistenceError = message
      return false
    }
  }

  snapshotSync() {
    const sessions = [...this.state.sessions]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(entry => ({
        sessionId: entry.sessionId,
        updatedAt: entry.updatedAt,
        ...summary(entry.aggregate),
      }))
    return {
      schemaVersion: USAGE_STATS_SCHEMA_VERSION,
      enabled: this.enabled,
      persistent: this.file !== undefined,
      persistence: {
        configured: this.file !== undefined,
        healthy: this.persistenceError === undefined,
        ...(this.persistenceError === undefined ? {} : { error: this.persistenceError }),
      },
      startedAt: this.state.startedAt,
      updatedAt: this.state.updatedAt,
      totals: summary(this.state.totals),
      sessions,
      accounting: {
        providerReported: 'exact-as-reported',
        bridgeInput: 'estimated-4-characters-per-token-plus-structure',
        automationInputSavings: 'estimated-request-tokens-before-minus-after-context-window',
        finalModelVisualTurnUsageExcludedFromAdditional: true,
        automationModelUsageIncludedInAdditional: true,
        reasoningTokensAreOutputSubdivision: true,
      },
    }
  }

  async snapshot() {
    await this.queue
    return this.snapshotSync()
  }

  reset() {
    this.queue = this.queue.then(async () => {
      this.state = zeroState(this.now)
      await this.persistSafely()
      return this.snapshotSync()
    })
    return this.queue
  }
}

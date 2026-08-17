import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { estimateInjectedTextTokens, UsageTracker } from '../src/usage.js'

test('usage tracker separates exact plugin overhead from final model usage', async () => {
  let now = Date.parse('2026-08-15T00:00:00.000Z')
  const tracker = new UsageTracker({ file: undefined, now: () => now })
  await tracker.recordVisualTurn('session-a')
  await tracker.recordCall('session-a', 'visionProbe', {
    inputTokens: 10,
    outputTokens: 2,
    reasoningTokens: 1,
  })
  await tracker.recordCall('session-a', 'visionBase', {
    inputTokens: 100,
    outputTokens: 30,
    cacheReadTokens: 20,
  })
  await tracker.recordCall('session-a', 'upstreamClarification', {
    inputTokens: 80,
    outputTokens: 8,
  })
  await tracker.recordAutomationTurn('session-a')
  await tracker.recordAutomationContextCompaction('session-a', 450_000)
  await tracker.recordCall('session-a', 'upstreamAutomation', {
    inputTokens: 32_000,
    outputTokens: 100,
    cacheReadTokens: 30_000,
  })
  await tracker.recordCall('session-a', 'upstreamFinal', {
    inputTokens: 120,
    outputTokens: 40,
  })
  await tracker.recordBridgeEstimate('session-a', 25)
  await tracker.recordCacheHit('session-a')
  now += 1_000

  const snapshot = await tracker.snapshot()
  assert.equal(snapshot.totals.visualTurns, 1)
  assert.equal(snapshot.totals.cacheHits, 1)
  assert.equal(snapshot.totals.derived.visionTokens, 162)
  assert.equal(snapshot.totals.derived.upstreamClarificationTokens, 88)
  assert.equal(snapshot.totals.derived.automationTokens, 62_100)
  assert.equal(snapshot.totals.derived.exactAdditionalTokens, 62_350)
  assert.equal(snapshot.totals.derived.estimatedBridgeInputTokens, 25)
  assert.equal(snapshot.totals.derived.estimatedAdditionalTokens, 62_375)
  assert.equal(snapshot.totals.derived.finalModelVisualTurnTokens, 160)
  assert.equal(snapshot.totals.derived.exactAdditionalUsage.reasoningTokens, 1)
  assert.equal(snapshot.totals.automationTurns, 1)
  assert.equal(snapshot.totals.automationContextCompactions, 1)
  assert.equal(snapshot.totals.estimatedAutomationInputTokensSaved, 450_000)
  assert.equal(snapshot.sessions[0].sessionId, 'session-a')
  assert.equal(snapshot.accounting.finalModelVisualTurnUsageExcludedFromAdditional, true)
  assert.equal(snapshot.accounting.automationModelUsageIncludedInAdditional, true)
})

test('usage tracker persists, bounds sessions, disables writes, and resets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-usage-'))
  const file = join(directory, 'usage.json')
  let now = Date.parse('2026-08-15T01:00:00.000Z')
  const tracker = new UsageTracker({ file, sessionLimit: 2, now: () => now })
  await tracker.recordCall('a', 'visionBase', { inputTokens: 1, outputTokens: 1 })
  now += 1_000
  await tracker.recordCall('b', 'visionBase', { inputTokens: 2, outputTokens: 2 })
  now += 1_000
  await tracker.recordCall('c', 'visionTarget', { inputTokens: 3, outputTokens: 3 })

  const reopened = new UsageTracker({ file, sessionLimit: 2, now: () => now })
  let snapshot = await reopened.snapshot()
  assert.deepEqual(snapshot.sessions.map(entry => entry.sessionId), ['c', 'b'])
  assert.equal(snapshot.totals.derived.exactAdditionalTokens, 12)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 1)

  reopened.setEnabled(false)
  await reopened.recordCall('c', 'visionBase', { inputTokens: 99, outputTokens: 99 })
  snapshot = await reopened.snapshot()
  assert.equal(snapshot.enabled, false)
  assert.equal(snapshot.totals.derived.exactAdditionalTokens, 12)

  reopened.setEnabled(true)
  snapshot = await reopened.reset()
  assert.equal(snapshot.totals.derived.exactAdditionalTokens, 0)
  assert.deepEqual(snapshot.sessions, [])
})

test('bridge estimate follows the DSH fixed-density heuristic', () => {
  assert.equal(estimateInjectedTextTokens('12345678'), 6)
  assert.equal(estimateInjectedTextTokens('12345678', { message: true }), 10)
  assert.equal(estimateInjectedTextTokens('', { message: true }), 0)
})

test('persistence failure keeps accounting live in memory and recovers on a later write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-usage-recovery-'))
  const file = join(directory, 'usage.json')
  const warnings = []
  const infos = []
  const tracker = new UsageTracker({
    file,
    logger: {
      warn: message => warnings.push(message),
      info: message => infos.push(message),
    },
  })
  await tracker.snapshot()

  const originalPersist = tracker.persist.bind(tracker)
  let failWrites = true
  tracker.persist = async () => {
    if (failWrites) throw new Error('synthetic disk failure')
    return originalPersist()
  }

  await tracker.recordCall('recovery', 'visionBase', { inputTokens: 1, outputTokens: 1 })
  let snapshot = await tracker.snapshot()
  assert.equal(snapshot.totals.derived.exactAdditionalTokens, 2)
  assert.equal(snapshot.persistence.healthy, false)
  assert.match(snapshot.persistence.error, /synthetic disk failure/)
  assert.equal(warnings.length, 1)

  failWrites = false
  await tracker.recordCall('recovery', 'visionTarget', { inputTokens: 1, outputTokens: 1 })
  snapshot = await tracker.snapshot()
  assert.equal(snapshot.totals.derived.exactAdditionalTokens, 4)
  assert.equal(snapshot.persistence.healthy, true)
  assert.equal(infos.length, 1)

  const reopened = new UsageTracker({ file })
  assert.equal((await reopened.snapshot()).totals.derived.exactAdditionalTokens, 4)
})

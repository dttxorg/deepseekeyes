import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import { DeepSeekEyesError } from '../src/error.js'
import { VisionRouter } from '../src/vision.js'
import { VisionAttemptTracker } from '../src/vision-attempts.js'
import { mockContext } from './_helpers.js'

test('vision router skips text-only models and selects a declared image route', async () => {
  const ctx = mockContext()
  ctx.llm.addProvider('text-provider', [{ id: 'blind', inputModalities: ['text'] }])
  ctx.llm.addProvider('visual-provider', [
    { id: 'unknown' },
    { id: 'sighted', inputModalities: ['text', 'image'] },
  ])
  const route = await new VisionRouter(ctx, resolveConfig({ cacheDir: false }, {}, '/tmp')).resolve()
  assert.deepEqual(
    { provider: route.provider, model: route.model },
    { provider: 'visual-provider', model: 'sighted' },
  )
})

test('explicitly configured text-only eye is rejected before image dispatch', async () => {
  const ctx = mockContext()
  ctx.llm.addProvider('configured', [{ id: 'blind', inputModalities: ['text'] }])
  const config = resolveConfig({
    visionProvider: 'configured',
    visionModel: 'blind',
    cacheDir: false,
  }, {}, '/tmp')
  await assert.rejects(
    new VisionRouter(ctx, config).resolve(),
    (error) => error.code === 'VISION_MODEL_NOT_MULTIMODAL',
  )
})

test('image-only metadata is rejected because evidence prompts also require text', async () => {
  const ctx = mockContext()
  ctx.llm.addProvider('image-only', [{ id: 'decoder', inputModalities: ['image'] }])
  const config = resolveConfig({
    visionProvider: 'image-only',
    visionModel: 'decoder',
    cacheDir: false,
  }, {}, '/tmp')
  await assert.rejects(
    new VisionRouter(ctx, config).resolve(),
    (error) => error.code === 'VISION_MODEL_NOT_MULTIMODAL',
  )
})

test('ordered routes fail over, open a health circuit and persist bounded attempts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-routes-'))
  const file = join(directory, 'attempts.json')
  const ctx = mockContext()
  ctx.llm.addProvider('primary', [{ id: 'vision-a', inputModalities: ['text', 'image'] }])
  ctx.llm.addProvider('fallback', [{ id: 'vision-b', inputModalities: ['text', 'image'] }])
  const config = resolveConfig({
    cacheDir: false,
    visionProvider: 'primary',
    visionModel: 'vision-a',
    visionRoutePriority: 'fallback/vision-b',
    autoDetectVision: false,
    visionFailoverAttempts: 2,
    visionFailureCooldownMs: 60_000,
    visionAttemptLogPath: file,
  }, {}, directory)
  const tracker = new VisionAttemptTracker({ file, limit: 10 })
  const router = new VisionRouter(ctx, config, { warn() {}, info() {} }, tracker)
  const visited = []
  const result = await router.run('base', {
    sessionId: 'raw-session-id', imageSha256: 'a'.repeat(64),
  }, async (route) => {
    visited.push(`${route.provider}/${route.model}`)
    if (route.provider === 'primary') {
      throw new DeepSeekEyesError('temporary provider failure', 'PROVIDER_UNAVAILABLE')
    }
    return { cacheHit: false, value: 'evidence' }
  })
  assert.deepEqual(visited, ['primary/vision-a', 'fallback/vision-b'])
  assert.equal(result.route.provider, 'fallback')
  assert.deepEqual(result.routeAttempts.map(attempt => attempt.status), ['failed', 'success'])
  assert.equal(router.healthSnapshot().find(route => route.provider === 'primary').circuitOpen, true)

  const second = await router.run('target', { sessionId: 'raw-session-id' }, async route => ({
    cacheHit: true, value: route.provider,
  }))
  assert.equal(second.route.provider, 'fallback')
  assert.deepEqual(second.routeAttempts.map(attempt => attempt.status), [
    'skipped-open-circuit',
    'cache-hit',
  ])

  const snapshot = await tracker.snapshot()
  assert.equal(snapshot.attempts.length, 4)
  assert.match(snapshot.attempts[0].sessionHash, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(snapshot), /raw-session-id/)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).attempts.length, 4)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test('failover bound zero preserves the primary error and skips fallback execution', async () => {
  const ctx = mockContext()
  ctx.llm.addProvider('primary', [{ id: 'vision-a', inputModalities: ['text', 'image'] }])
  ctx.llm.addProvider('fallback', [{ id: 'vision-b', inputModalities: ['text', 'image'] }])
  const router = new VisionRouter(ctx, resolveConfig({
    cacheDir: false,
    visionProvider: 'primary',
    visionModel: 'vision-a',
    visionRoutePriority: 'fallback/vision-b',
    autoDetectVision: false,
    visionFailoverAttempts: 0,
  }, {}, '/tmp'), { warn() {}, info() {} })
  let calls = 0
  await assert.rejects(
    router.run('base', {}, async () => {
      calls += 1
      throw new DeepSeekEyesError('primary failed', 'PRIMARY_FAILED')
    }),
    error => error.code === 'PRIMARY_FAILED' && error.attempts.length === 1,
  )
  assert.equal(calls, 1)
})

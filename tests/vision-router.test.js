import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import { VisionRouter } from '../src/vision.js'
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

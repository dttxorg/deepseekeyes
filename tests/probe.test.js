import assert from 'node:assert/strict'
import test from 'node:test'
import { createProbePng, PROBE_COLORS, VisionProbe } from '../src/probe.js'
import { textStream } from '../src/stream.js'
import { decodeProbeOrder, jsonStream, mockContext } from './_helpers.js'

test('probe PNG preserves the requested randomized color order', () => {
  const order = PROBE_COLORS.map((entry) => entry.name).reverse()
  const png = createProbePng(order)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.deepEqual(decodeProbeOrder(png), order)
})

test('active probe proves the selected model consumed the generated pixels', async () => {
  const ctx = mockContext()
  ctx.llm.addProvider('eyes', [{ id: 'vision', inputModalities: ['text', 'image'] }], (options) =>
    (async function* () {
      const ref = options.messages[0].content.find((block) => block.type === 'image').attachment
      const stored = await ctx.attachments.readImage(ref)
      yield* textStream(`Observed grid:\n${JSON.stringify({
        cells: decodeProbeOrder(Buffer.from(stored.data)),
      })}`)
    })())
  const probe = new VisionProbe(ctx, { enabled: true, nextInt: () => 0 })
  const result = await probe.ensure({ provider: 'eyes', model: 'vision' })
  assert.equal(result.validation, 'metadata+active-grid-probe')
  assert.deepEqual(result.usage, { inputTokens: 1, outputTokens: 1 })
  assert.equal(ctx.attachments.saved.length, 1)
  const reused = await probe.ensure({ provider: 'eyes', model: 'vision' })
  assert.deepEqual(reused.usage, { inputTokens: 0, outputTokens: 0 })
  assert.equal(ctx.attachments.saved.length, 1)
})

test('active probe rejects a provider that only claims image support', async () => {
  const ctx = mockContext()
  ctx.llm.addProvider('blind', [{ id: 'text', inputModalities: ['text', 'image'] }], () =>
    jsonStream({ cells: Array(9).fill('red') }))
  const probe = new VisionProbe(ctx, { enabled: true, nextInt: () => 0 })
  await assert.rejects(
    probe.ensure({ provider: 'blind', model: 'text' }),
    (error) => error.code === 'VISION_PROBE_FAILED',
  )
})

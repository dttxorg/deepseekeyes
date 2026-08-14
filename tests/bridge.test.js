import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { apply } from '../dsh/index.js'
import { collectStream, textStream } from '../src/stream.js'
import {
  jsonStream,
  mockContext,
  userMessage,
  validBaseEvidence,
  validTargetEvidence,
} from './_helpers.js'

function setupBridge({ visionHandler, upstreamHandler, activeProbe = false } = {}) {
  const ctx = mockContext()
  ctx.llm.addProvider(
    'deepseek-official',
    [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', inputModalities: ['text'] }],
    upstreamHandler,
  )
  if (visionHandler !== undefined) {
    ctx.llm.addProvider(
      'configured-vision',
      [{ id: 'vision-model', name: 'Vision Model', inputModalities: ['text', 'image'] }],
      visionHandler,
    )
  }
  apply(ctx, {
    visionProvider: visionHandler === undefined ? undefined : 'configured-vision',
    visionModel: visionHandler === undefined ? undefined : 'vision-model',
    activeProbe,
    cacheDir: false,
  })
  return ctx
}

test('virtual model advertises images, keeps the session block, and completes a private clarification loop', async () => {
  const bytes = Buffer.from('exact original image bytes')
  const sha = createHash('sha256').update(bytes).digest('hex')
  let baseCalls = 0
  let targetCalls = 0
  let upstreamCalls = 0

  const ctx = setupBridge({
    visionHandler(options) {
      const prompt = options.messages[0].content.find((block) => block.type === 'text').text
      const image = options.messages[0].content.find((block) => block.type === 'image')
      assert.ok(image)
      if (prompt.includes('deepseekeyes.evidence.v1')) {
        baseCalls += 1
        return jsonStream(validBaseEvidence({ summary: 'Screenshot with a small error message' }))
      }
      if (prompt.includes('deepseekeyes.target.v1')) {
        targetCalls += 1
        return jsonStream(validTargetEvidence({ answer: 'Exact small text' }))
      }
      throw new Error('unexpected vision prompt')
    },
    upstreamHandler(options) {
      upstreamCalls += 1
      assert.equal(options.messages.some((message) =>
        message.content.some((block) => block.type === 'image')),
      false)
      if (upstreamCalls === 1) {
        return textStream(`<deepseekeyes-request>{"imageSha256":"${sha}","question":"Read the small text exactly"}</deepseekeyes-request>`)
      }
      assert.match(JSON.stringify(options.messages), /clarification evidence/)
      return textStream('最终回答：Exact small text')
    },
  })
  const ref = ctx.attachments.add(bytes, { attachmentId: 'original-1', width: 640, height: 360 })
  const originalMessage = userMessage([
    { type: 'text', text: 'What does the screenshot say?' },
    { type: 'image', attachment: ref },
  ])

  const model = await ctx.llm.resolveModelInfo('deepseekeyes', 'deepseek-v4-flash')
  assert.deepEqual(model.inputModalities, ['text', 'image'])
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [originalMessage],
  }))

  assert.equal(result.text, '最终回答：Exact small text')
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 4 })
  assert.equal(baseCalls, 1)
  assert.equal(targetCalls, 1)
  assert.equal(upstreamCalls, 2)
  assert.equal(originalMessage.content[1].type, 'image')
  assert.deepEqual(Buffer.from((await ctx.attachments.readImage(ref)).data), bytes)
})

test('text-only turns delegate directly without spending a visual call', async () => {
  let visionCalls = 0
  let upstreamCalls = 0
  const ctx = setupBridge({
    visionHandler() {
      visionCalls += 1
      return jsonStream(validBaseEvidence())
    },
    upstreamHandler() {
      upstreamCalls += 1
      return textStream('plain text answer')
    },
  })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [userMessage([{ type: 'text', text: 'hello' }])],
  }))
  assert.equal(result.text, 'plain text answer')
  assert.equal(visionCalls, 0)
  assert.equal(upstreamCalls, 1)
})

test('explicit final model locks catalog, text turns, image turns, and exposes both model roles', async () => {
  const ctx = mockContext()
  const upstreamModels = []
  let visionCalls = 0
  ctx.llm.addProvider(
    'final-provider',
    [
      { id: 'reasoner-a', name: 'Reasoner A', inputModalities: ['text'] },
      { id: 'reasoner-b', name: 'Reasoner B', inputModalities: ['text'] },
    ],
    (options) => {
      upstreamModels.push(options.model)
      return textStream(options.messages.some(message =>
        message.content.some(block => block.type === 'text' && block.text.includes('DeepSeekEyes image evidence')))
        ? 'image answer'
        : 'text answer')
    },
  )
  ctx.llm.addProvider(
    'vision-provider',
    [{ id: 'vision-m3', name: 'Vision M3', inputModalities: ['text', 'image'] }],
    () => {
      visionCalls += 1
      return jsonStream(validBaseEvidence())
    },
  )
  apply(ctx, {
    upstreamProvider: 'final-provider',
    upstreamModel: 'reasoner-b',
    visionProvider: 'vision-provider',
    visionModel: 'vision-m3',
    activeProbe: false,
    cacheDir: false,
  })

  const models = await ctx.llm.listModels('deepseekeyes')
  assert.deepEqual(models.map(model => model.id), ['reasoner-b'])
  assert.equal(models[0].name, 'Reasoner B · Vision M3 Eyes')
  assert.equal(models[0].description, 'Vision: vision-provider/vision-m3 · Final: final-provider/reasoner-b')

  const text = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'reasoner-b',
    messages: [userMessage([{ type: 'text', text: 'hello' }])],
  }))
  assert.equal(text.text, 'text answer')

  const ref = ctx.attachments.add(Buffer.from('original image'), { attachmentId: 'locked-route-image' })
  const image = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'reasoner-b',
    messages: [userMessage([{ type: 'image', attachment: ref }])],
  }))
  assert.equal(image.text, 'image answer')
  assert.equal(visionCalls, 1)
  assert.deepEqual(upstreamModels, ['reasoner-b', 'reasoner-b'])

  await assert.rejects(
    collectStream(ctx.llm.stream({
      provider: 'deepseekeyes',
      model: 'reasoner-a',
      messages: [userMessage([{ type: 'text', text: 'stale session' }])],
    })),
    (error) => error.code === 'UPSTREAM_MODEL_LOCKED',
  )
})

test('invalid visual evidence stops the DeepSeek dispatch', async () => {
  let upstreamCalls = 0
  const ctx = setupBridge({
    visionHandler: () => textStream('not JSON'),
    upstreamHandler() {
      upstreamCalls += 1
      return textStream('should not run')
    },
  })
  const ref = ctx.attachments.add(Buffer.from('image'), { attachmentId: 'bad-evidence-image' })
  await assert.rejects(
    collectStream(ctx.llm.stream({
      provider: 'deepseekeyes',
      model: 'deepseek-v4-flash',
      messages: [userMessage([{ type: 'image', attachment: ref }])],
    })),
    (error) => error.code === 'INVALID_MODEL_OUTPUT',
  )
  assert.equal(upstreamCalls, 0)
})

test('no visual model leaves the virtual catalog empty and rejects exact resolution', async () => {
  const ctx = setupBridge({ upstreamHandler: () => textStream('unused') })
  assert.deepEqual(await ctx.llm.listModels('deepseekeyes'), [])
  await assert.rejects(
    ctx.llm.resolveModelInfo('deepseekeyes', 'deepseek-v4-flash'),
    (error) => error.code === 'NO_VISION_MODEL',
  )
})

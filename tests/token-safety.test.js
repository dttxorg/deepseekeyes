import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { apply } from '../dsh/index.js'
import { collectStream, textStream } from '../src/stream.js'
import {
  jsonStream,
  mockContext,
  userMessage,
  validBaseEvidence,
} from './_helpers.js'

function assistantMessage(text = 'previous answer') {
  return {
    id: randomUUID(),
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
  }
}

function safetyBridge({ visionHandler, upstreamHandler, model = {} } = {}) {
  const ctx = mockContext()
  ctx.llm.addProvider(
    'text-provider',
    [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      inputModalities: ['text'],
      ...model,
    }],
    upstreamHandler,
  )
  ctx.llm.addProvider(
    'vision-provider',
    [{ id: 'vision-model', name: 'Vision Model', inputModalities: ['text', 'image'] }],
    visionHandler,
  )
  apply(ctx, {
    upstreamProvider: 'text-provider',
    upstreamModel: 'deepseek-v4-flash',
    visionProvider: 'vision-provider',
    visionModel: 'vision-model',
    activeProbe: false,
    cacheDir: false,
  })
  return ctx
}

test('a new text turn after an image makes zero new visual calls and never forwards raw history images', async () => {
  let visionCalls = 0
  let upstreamCalls = 0
  let upstreamWire = ''
  const ctx = safetyBridge({
    visionHandler() {
      visionCalls += 1
      return jsonStream(validBaseEvidence({ summary: 'historical screenshot' }))
    },
    upstreamHandler(options) {
      upstreamCalls += 1
      upstreamWire = JSON.stringify(options.messages)
      return textStream('plain follow-up answer')
    },
  })
  const ref = ctx.attachments.add(Buffer.from('historical-image'), { attachmentId: 'history-image' })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [
      userMessage([{ type: 'text', text: 'read this' }, { type: 'image', attachment: ref }]),
      assistantMessage(),
      userMessage([{ type: 'text', text: 'now compare the Lua files without using the image' }]),
    ],
  }))

  assert.equal(result.text, 'plain follow-up answer')
  assert.equal(visionCalls, 0)
  assert.equal(upstreamCalls, 1)
  assert.equal(upstreamWire.includes('"type":"image"'), false)
  assert.equal(upstreamWire.includes('evidence_json'), false)
})

test('twenty historical browser screenshots add bounded compact context instead of twenty OCR payloads', async () => {
  let visionCalls = 0
  let upstreamWire = ''
  const ctx = safetyBridge({
    visionHandler() {
      visionCalls += 1
      return jsonStream(validBaseEvidence({
        summary: 'browser screenshot',
        ocr: [{ text: 'x'.repeat(8_000), bbox: [0, 0, 1, 1], confidence: 1 }],
      }))
    },
    upstreamHandler(options) {
      upstreamWire = JSON.stringify({ system: options.system, messages: options.messages })
      return textStream('bounded')
    },
  })
  const messages = []
  for (let index = 0; index < 20; index += 1) {
    const ref = ctx.attachments.add(Buffer.from(`browser-${index}`), { attachmentId: `browser-${index}` })
    messages.push(userMessage([{
      type: 'tool-result',
      toolCallId: `browser-call-${index}`,
      toolName: 'browser',
      content: [
        {
          type: 'text',
          text: `[DeepSeekEyes browser state]\n${JSON.stringify({
            action: 'observe',
            sequence: index + 1,
            stateId: `state-${index + 1}`,
            url: `https://example.test/${index}`,
            title: `Page ${index}`,
            documentText: 'D'.repeat(20_000),
            elements: Array.from({ length: 100 }, (_, item) => ({ ref: `e${item}`, name: 'control' })),
          })}`,
        },
        { type: 'image', attachment: ref },
      ],
    }]))
    messages.push(assistantMessage(`step ${index + 1}`))
  }
  messages.push(userMessage([{ type: 'text', text: 'write a short unrelated note' }]))

  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages,
  }))

  assert.equal(result.text, 'bounded')
  assert.equal(visionCalls, 0)
  assert.equal(upstreamWire.includes('evidence_json'), false)
  assert.ok(upstreamWire.length < 40_000, `historical bridge payload was ${upstreamWire.length} characters`)
})

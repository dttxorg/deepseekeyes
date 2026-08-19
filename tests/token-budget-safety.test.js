import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../dsh/index.js'
import { collectStream, textStream } from '../src/stream.js'
import {
  collectFinalWithBudget,
  estimateRequestTokens,
  estimateToolDefinitionTokens,
  fitOutputBudget,
} from '../src/token-safety.js'
import {
  jsonStream,
  mockContext,
  userMessage,
  validBaseEvidence,
} from './_helpers.js'

function providerError(message) {
  return (async function* () {
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'invalid_request_error', message },
      },
    }
  })()
}

test('the 1,048,576 context / 384,000 output case is fitted below the provider boundary', () => {
  const options = {
    provider: 'text',
    model: 'deepseek-v4-flash',
    maxTokens: 384_000,
    messages: [userMessage([{ type: 'text', text: 'x'.repeat(2_680_000) }])],
  }
  const modelInfo = {
    context: { contextWindow: 1_048_576 },
    defaultMaxTokens: 384_000,
  }
  const fitted = fitOutputBudget(options, modelInfo, { warn() {} })
  const estimated = estimateRequestTokens(options)

  assert.equal(fitted.changed, true)
  assert.ok(fitted.options.maxTokens < 384_000)
  assert.ok(estimated + fitted.options.maxTokens + fitted.margin <= 1_048_576)
})

test('tool definition accounting can isolate only MCP schemas', () => {
  const tools = [
    { name: 'computer', parameters: { type: 'object' } },
    { name: 'mcp__github__list_issues', parameters: { type: 'object', properties: { state: { type: 'string' } } } },
  ]
  const mcp = estimateToolDefinitionTokens(
    tools,
    (_tool, name) => name.startsWith('mcp__'),
  )
  assert.ok(mcp > 4)
  assert.ok(mcp < estimateToolDefinitionTokens(tools))
})

test('an exact provider overflow retries once with the capacity reported by the provider', async () => {
  const calls = []
  const ctx = {
    llm: {
      stream(options) {
        calls.push(options.maxTokens)
        if (calls.length === 1) {
          return providerError(
            'This model\'s maximum context length is 1048576 tokens. However, you requested 1054302 tokens (670302 in the messages, 384000 in the completion). Please reduce the length of the messages or completion.',
          )
        }
        return textStream('retry succeeded')
      },
    },
  }
  const guarded = await collectFinalWithBudget(ctx, {
    provider: 'text',
    model: 'deepseek-v4-flash',
    messages: [userMessage([{ type: 'text', text: 'short fixture' }])],
  }, {}, { warn() {} })

  assert.equal(guarded.result.text, 'retry succeeded')
  assert.equal(guarded.retries, 1)
  assert.deepEqual(calls, [undefined, 370_082])
})

test('the visual bridge caps only the final model request while keeping visual budgets independent', async () => {
  const ctx = mockContext()
  const upstreamMaxTokens = []
  const visualMaxTokens = []
  ctx.llm.addProvider(
    'text-provider',
    [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      inputModalities: ['text'],
      context: { contextWindow: 10_000 },
      defaultMaxTokens: 5_000,
    }],
    (options) => {
      upstreamMaxTokens.push(options.maxTokens)
      return textStream('fitted answer')
    },
  )
  ctx.llm.addProvider(
    'vision-provider',
    [{ id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] }],
    (options) => {
      visualMaxTokens.push(options.maxTokens)
      return jsonStream(validBaseEvidence({ summary: 'small screenshot' }))
    },
  )
  apply(ctx, {
    upstreamProvider: 'text-provider',
    upstreamModel: 'deepseek-v4-flash',
    visionProvider: 'vision-provider',
    visionModel: 'vision-model',
    activeProbe: false,
    cacheDir: false,
    baseMaxTokens: 16_384,
  })
  const ref = ctx.attachments.add(Buffer.from('budget-image'))
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    maxTokens: 5_000,
    messages: [userMessage([
      { type: 'text', text: 'x'.repeat(24_000) },
      { type: 'image', attachment: ref },
    ])],
  }))

  assert.equal(result.text, 'fitted answer')
  assert.deepEqual(visualMaxTokens, [16_384])
  assert.equal(upstreamMaxTokens.length, 1)
  assert.ok(upstreamMaxTokens[0] < 5_000)
})

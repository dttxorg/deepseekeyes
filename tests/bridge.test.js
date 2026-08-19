import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { apply } from '../dsh/index.js'
import { MCP_CONTEXT_PREFIX } from '../src/content.js'
import { renderDesktopResult } from '../src/desktop/index.js'
import { collectStream, textStream } from '../src/stream.js'
import {
  jsonStream,
  mockContext,
  userMessage,
  validBaseEvidence,
  validTargetEvidence,
} from './_helpers.js'

function setupBridge({
  visionHandler,
  upstreamHandler,
  activeProbe = false,
  bridgeConfig = {},
  visionModelId = 'vision-model',
} = {}) {
  const ctx = mockContext()
  ctx.llm.addProvider(
    'deepseek-official',
    [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', inputModalities: ['text'] }],
    upstreamHandler,
  )
  if (visionHandler !== undefined) {
    ctx.llm.addProvider(
      'configured-vision',
      [{ id: visionModelId, name: 'Vision Model', inputModalities: ['text', 'image'] }],
      visionHandler,
    )
  }
  ctx.deepseekEyesState = apply(ctx, {
    visionProvider: visionHandler === undefined ? undefined : 'configured-vision',
    visionModel: visionHandler === undefined ? undefined : visionModelId,
    activeProbe,
    cacheDir: false,
    ...bridgeConfig,
  })
  return ctx
}

function failedStream(code, message) {
  return (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code, message } } }
  })()
}

test('virtual model advertises images, keeps the session block, and completes a private clarification loop', async () => {
  const bytes = Buffer.from('exact original image bytes')
  const sha = createHash('sha256').update(bytes).digest('hex')
  let baseCalls = 0
  let targetCalls = 0
  let upstreamCalls = 0

  const ctx = setupBridge({
    bridgeConfig: { baseMaxTokens: 0, targetMaxTokens: 0 },
    visionHandler(options) {
      assert.equal(Object.hasOwn(options, 'maxTokens'), false)
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
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.derived.exactAdditionalTokens, 6)
  assert.ok(usage.totals.derived.estimatedBridgeInputTokens > 0)
  assert.equal(usage.totals.derived.finalModelVisualTurnTokens, 2)
  assert.equal(usage.totals.visualTurns, 1)
  assert.equal(usage.totals.calls.visionBase, 1)
  assert.equal(usage.totals.calls.visionTarget, 1)
  assert.equal(usage.totals.calls.upstreamClarification, 1)
  assert.equal(usage.totals.calls.upstreamFinal, 1)
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
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.derived.estimatedAdditionalTokens, 0)
  assert.deepEqual(usage.sessions, [])
})

test('MCP continuation calls are isolated and account their model plus schema input', async () => {
  const ctx = setupBridge({
    bridgeConfig: { mcpEnabled: true },
    upstreamHandler: () => textStream('MCP result consumed', {
      inputTokens: 30,
      outputTokens: 4,
      cacheReadTokens: 10,
    }),
  })
  const task = userMessage([{ type: 'text', text: 'List the open application issues.' }])
  const assistant = {
    role: 'assistant',
    content: [{
      type: 'tool-call',
      id: 'mcp-call-1',
      name: 'mcp__github__list_issues',
      arguments: '{}',
    }],
    source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
  }
  const resultMessage = userMessage([{
    type: 'tool-result',
    toolCallId: 'mcp-call-1',
    toolName: 'mcp__github__list_issues',
    content: [{ type: 'text', text: '[DeepSeekEyes MCP result]\npreview: issue 1' }],
  }])
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'mcp-session',
    messages: [task, assistant, resultMessage],
    tools: [{
      name: 'mcp__github__list_issues',
      description: 'List issues',
      parameters: { type: 'object', additionalProperties: false },
    }],
  }))
  assert.equal(result.text, 'MCP result consumed')
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.calls.upstreamMcp, 1)
  assert.equal(usage.totals.derived.mcpTokens, 44)
  assert.ok(usage.totals.mcpSchemaInputTokensEstimated > 0)
  assert.equal(usage.totals.automationTurns, 1)
})

test('Code Mode MCP image context reaches Eyes, keeps MCP budgets, and installs targeted reread', async () => {
  const bytes = Buffer.from('code-mode MCP source image')
  const imageSha256 = createHash('sha256').update(bytes).digest('hex')
  let visionCalls = 0
  let upstreamCalls = 0
  let forwarded
  const ctx = setupBridge({
    bridgeConfig: {
      mcpEnabled: true,
      mcpServers: [],
      automationMaxCallsPerTurn: 1,
    },
    visionHandler(options) {
      visionCalls += 1
      assert.equal(options.messages[0].content.some(block => block.type === 'image'), true)
      const prompt = options.messages[0].content.find(block => block.type === 'text').text
      return prompt.includes('deepseekeyes.target.v1')
        ? jsonStream(validTargetEvidence({ answer: 'targeted MCP image detail' }))
        : jsonStream(validBaseEvidence({ summary: 'MCP application returned a visible chart' }))
    },
    upstreamHandler(options) {
      upstreamCalls += 1
      forwarded = options
      return textStream('MCP image evidence consumed', {
        inputTokens: 30,
        outputTokens: 4,
        cacheReadTokens: 10,
      })
    },
  })
  const ref = ctx.attachments.add(bytes, { width: 800, height: 450, name: 'mcp-chart.png' })
  const task = userMessage([{ type: 'text', text: 'Inspect the application chart through MCP.' }])
  const assistant = {
    id: 'mcp-code-image-assistant',
    role: 'assistant',
    content: [{
      type: 'tool-call',
      id: 'mcp-code-image-call',
      name: 'run_code',
      arguments: '{"code":"fixture","description":"Read chart"}',
    }],
    source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
  }
  const outerResult = userMessage([{
    type: 'tool-result',
    toolCallId: 'mcp-code-image-call',
    toolName: 'run_code',
    content: [{ type: 'text', text: 'MCP image call completed' }],
  }])
  const context = {
    id: 'mcp-code-image-context',
    role: 'user',
    content: [{
      type: 'text',
      text: `${MCP_CONTEXT_PREFIX}${JSON.stringify({
        schemaVersion: 'deepseekeyes.mcp-context.v1',
        tool: 'mcp__fixture__image',
        status: 'success',
        resultSha256: 'a'.repeat(64),
        imageCount: 1,
      })}`,
    }, { type: 'image', attachment: ref }],
    source: {
      kind: 'plugin',
      plugin: 'deepseekeyes',
      form: 'mcp-context',
      summary: 'MCP image result context',
    },
  }
  const messages = [task, assistant, outerResult, context]
  const sessionId = 'mcp-code-image-session'
  const agent = {
    id: sessionId,
    ctx,
    session: { deriveMessages: () => messages },
  }
  ctx.agents = { get: id => id === sessionId ? agent : undefined }
  const request = () => collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId,
    messages,
  }))

  const result = await request()
  assert.equal(result.text, 'MCP image evidence consumed')
  assert.equal(visionCalls, 1)
  assert.equal(upstreamCalls, 1)
  const wire = JSON.stringify(forwarded.messages)
  assert.equal(wire.includes('"type":"image"'), false)
  assert.match(wire, /DeepSeekEyes MCP context/)
  assert.match(wire, /MCP application returned a visible chart/)
  assert.ok(ctx.deepseekEyesState.evidenceManager.knownBase(imageSha256))
  assert.deepEqual(Buffer.from((await ctx.attachments.readImage(ref)).data), bytes)

  const look = ctx.tools.get('deepseekeyes_look')
  assert.ok(look, 'the original MCP attachment must be registered for targeted reread')
  const reread = await look.execute({
    imageSha256,
    question: 'Read the exact highlighted value.',
  }, { agent, signal: new AbortController().signal })
  assert.equal(reread.evidence.answer, 'targeted MCP image detail')
  assert.equal(visionCalls, 2)

  await assert.rejects(request(), error => error.code === 'AUTOMATION_CALL_LIMIT')
  assert.equal(visionCalls, 2)
  assert.equal(upstreamCalls, 1)
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.calls.upstreamMcp, 1)
  assert.equal(usage.totals.automationTurns, 1)
  assert.equal(usage.totals.mcpLimitStops, 1)
  assert.equal(usage.totals.lookCalls, 1)
})

async function realMcpSchemaMode(mode, { mcpEnabled = true } = {}) {
  const root = new Context()
  const systemPromptFiber = root.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: '' })
  await systemPromptFiber
  const disposeCodeRuntime = root.provide('codeRuntime', { language: 'typescript' })
  const toolsFiber = root.plugin(ToolRuntime, { mode })
  await toolsFiber

  const output = {
    schema: {
      type: 'object',
      properties: { preview: { type: 'string' } },
      required: ['preview'],
      additionalProperties: false,
    },
    render(_args, value) { return [{ type: 'text', text: value.preview }] },
  }
  const disposeOrdinary = root.tools.register({
    name: 'ordinary_lookup',
    description: 'Ordinary non-MCP fixture',
    parameters: { type: 'object', additionalProperties: false },
    output,
    async execute() { return { preview: 'ordinary' } },
  })
  const disposeMcp = root.tools.register({
    name: 'mcp__fixture__search',
    description: 'Search a fixture application through MCP',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    output,
    async execute() { return { preview: 'mcp' } },
  })

  const ctx = mockContext()
  ctx.tools = root.tools
  ctx.systemPrompt = root.systemPrompt
  ctx.get = root.get.bind(root)
  let forwarded
  ctx.llm.addProvider(
    'deepseek-official',
    [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', inputModalities: ['text'] }],
    options => {
      forwarded = options
      return textStream('schema surface consumed')
    },
  )
  const state = apply(
    ctx,
    {
      upstreamProvider: 'deepseek-official',
      activeProbe: false,
      cacheDir: false,
      mcpEnabled,
      mcpServers: [],
    },
    { loadDshTools: () => import('@deepseek-ai/dsh-tools') },
  )

  const sessionId = `schema-${mode}-${mcpEnabled ? 'enabled' : 'disabled'}`
  const agent = { id: sessionId, options: { provider: 'deepseekeyes' }, session: {} }
  const scope = createScope(root, agent)
  agent.ctx = scope.ctx
  ctx.agents = { get: id => id === sessionId ? agent : undefined }
  const assembly = await root.systemPrompt.assemble({ agent, scope: agent })
  const request = {
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId,
    messages: [userMessage([{ type: 'text', text: 'Use the available application tools.' }])],
    system: renderPrompt(assembly),
    tools: assembly.tools,
  }
  await collectStream(ctx.llm.stream(request))
  const usage = await state.usage.snapshot()

  await scope.dispose()
  disposeMcp()
  disposeOrdinary()
  await toolsFiber.dispose()
  await disposeCodeRuntime()
  await systemPromptFiber.dispose()
  return {
    tokens: usage.totals.mcpSchemaInputTokensEstimated,
    request,
    forwarded,
  }
}

test('real DSH native, code, and both modes account every MCP input surface actually sent', async () => {
  const native = await realMcpSchemaMode('native')
  const code = await realMcpSchemaMode('code')
  const both = await realMcpSchemaMode('both')
  const disabled = await realMcpSchemaMode('code', { mcpEnabled: false })

  assert.ok(native.tokens > 0)
  assert.ok(code.tokens > 0)
  assert.equal(
    both.tokens,
    native.tokens + code.tokens,
    'both mode sends and must account the native schema plus its tools:sdk declaration',
  )
  assert.equal(disabled.tokens, 0)

  assert.match(JSON.stringify(native.request.tools), /mcp__fixture__search/)
  assert.doesNotMatch(native.request.system, /mcp__fixture__search/)
  assert.deepEqual(code.request.tools.map(tool => tool.name), ['run_code'])
  assert.match(code.request.system, /mcp__fixture__search/)
  assert.match(JSON.stringify(both.request.tools), /mcp__fixture__search/)
  assert.match(both.request.system, /mcp__fixture__search/)
  assert.equal(code.forwarded.system, code.request.system)
  assert.deepEqual(code.forwarded.tools, code.request.tools)
})

test('historical-image MCP continuation still compacts context, accounts usage, and enforces the call guard', async () => {
  let upstreamCalls = 0
  let forwarded
  const ctx = setupBridge({
    bridgeConfig: {
      automationContextMaxTokens: 4_096,
      automationMaxCallsPerTurn: 1,
    },
    upstreamHandler(options) {
      upstreamCalls += 1
      forwarded = options
      return textStream('historical image MCP consumed', {
        inputTokens: 30,
        outputTokens: 4,
        cacheReadTokens: 10,
      })
    },
  })
  const ref = ctx.attachments.add(Buffer.from('historical image bytes'), {
    attachmentId: 'historical-mcp-image',
    width: 640,
    height: 360,
  })
  const oldImageTask = userMessage([
    { type: 'text', text: `old payload ${'x'.repeat(200_000)}` },
    { type: 'image', attachment: ref },
  ])
  const oldAssistant = {
    id: 'historical-assistant',
    role: 'assistant',
    content: [{ type: 'text', text: 'old completed image answer' }],
    source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
  }
  const currentTask = userMessage([{ type: 'text', text: 'List the current issues through MCP.' }])
  const assistant = {
    id: 'historical-mcp-assistant',
    role: 'assistant',
    content: [{
      type: 'tool-call',
      id: 'historical-mcp-call',
      name: 'mcp__github__list_issues',
      arguments: '{}',
    }],
    source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
  }
  const resultMessage = userMessage([{
    type: 'tool-result',
    toolCallId: 'historical-mcp-call',
    toolName: 'mcp__github__list_issues',
    content: [{ type: 'text', text: '[DeepSeekEyes MCP result]\npreview: issue 1' }],
  }])
  const request = () => collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'historical-mcp-session',
    messages: [oldImageTask, oldAssistant, currentTask, assistant, resultMessage],
    tools: [{
      name: 'mcp__github__list_issues',
      description: 'List issues',
      parameters: { type: 'object', additionalProperties: false },
    }],
  }))

  const result = await request()
  assert.equal(result.text, 'historical image MCP consumed')
  assert.equal(upstreamCalls, 1)
  const wire = JSON.stringify(forwarded.messages)
  assert.equal(wire.includes('old payload'), false)
  assert.match(wire, /List the current issues through MCP/)
  assert.match(wire, /preview: issue 1/)

  await assert.rejects(request(), error => error.code === 'AUTOMATION_CALL_LIMIT')
  assert.equal(upstreamCalls, 1)
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.calls.upstreamMcp, 1)
  assert.equal(usage.totals.derived.mcpTokens, 44)
  assert.equal(usage.totals.automationTurns, 1)
  assert.equal(usage.totals.automationContextCompactions, 1)
  assert.equal(usage.totals.mcpContextCompactions, 1)
  assert.equal(usage.totals.automationLimitStops, 1)
  assert.equal(usage.totals.mcpLimitStops, 1)
  assert.ok(usage.totals.estimatedAutomationInputTokensSaved > 40_000)
})

test('browser screenshot inside a tool result is reread by Eyes before DeepSeek continues', async () => {
  const bytes = Buffer.from('browser screenshot bytes')
  let visionCalls = 0
  const ctx = setupBridge({
    visionHandler(options) {
      visionCalls += 1
      assert.equal(options.messages[0].content.some(block => block.type === 'image'), true)
      return jsonStream(validBaseEvidence({ summary: 'Browser shows a successful form submission' }))
    },
    upstreamHandler(options) {
      const wire = JSON.stringify(options.messages)
      assert.equal(wire.includes('"type":"image"'), false)
      assert.match(wire, /DeepSeekEyes browser state/)
      assert.match(wire, /Browser shows a successful form submission/)
      return textStream('浏览器状态已验证')
    },
  })
  const ref = ctx.attachments.add(bytes, { width: 1280, height: 800 })
  const toolResult = userMessage([{
    type: 'tool-result',
    toolCallId: 'browser-call-1',
    toolName: 'browser',
    content: [
      { type: 'text', text: '[DeepSeekEyes browser state]\n{"stateId":"browser-state:test"}' },
      { type: 'image', attachment: ref },
    ],
  }])
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [toolResult],
  }))
  assert.equal(result.text, '浏览器状态已验证')
  assert.equal(visionCalls, 1)
  assert.equal(toolResult.content[0].content[1].type, 'image')
})

test('desktop screenshot inside computer output is reread by Eyes in the same conversation', async () => {
  const bytes = Buffer.from('desktop screenshot bytes')
  let visionCalls = 0
  const ctx = setupBridge({
    visionHandler(options) {
      visionCalls += 1
      assert.equal(options.messages[0].content.some(block => block.type === 'image'), true)
      return jsonStream(validBaseEvidence({ summary: 'Native desktop shows the expected application window' }))
    },
    upstreamHandler(options) {
      const wire = JSON.stringify(options.messages)
      assert.equal(wire.includes('"type":"image"'), false)
      assert.match(wire, /DeepSeekEyes desktop state/)
      assert.match(wire, /Native desktop shows the expected application window/)
      return textStream('桌面状态已验证')
    },
  })
  const ref = ctx.attachments.add(bytes, { width: 1920, height: 1080 })
  const toolResult = userMessage([{
    type: 'tool-result',
    toolCallId: 'computer-call-1',
    toolName: 'computer',
    content: [
      { type: 'text', text: '[DeepSeekEyes desktop state]\n{"stateId":"desktop-state:test"}' },
      { type: 'image', attachment: ref },
    ],
  }])
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [toolResult],
  }))
  assert.equal(result.text, '桌面状态已验证')
  assert.equal(visionCalls, 1)
  assert.equal(toolResult.content[0].content[1].type, 'image')
})

test('desktop semantic fast path reaches DeepSeek with zero visual-model calls', async () => {
  let visionCalls = 0
  let upstreamCalls = 0
  const ctx = setupBridge({
    visionHandler() {
      visionCalls += 1
      return jsonStream(validBaseEvidence())
    },
    upstreamHandler(options) {
      upstreamCalls += 1
      const wire = JSON.stringify(options.messages)
      assert.match(wire, /semantic-state-sufficient/)
      assert.equal(wire.includes('"type":"image"'), false)
      return textStream('语义快路径继续')
    },
  })
  const content = renderDesktopResult({
    ok: true,
    action: 'observe',
    stateId: `desktop-state:${'a'.repeat(64)}`,
    semanticStatus: { quality: 'available', truncated: false },
    visualDelivery: {
      mode: 'auto',
      requested: 'auto',
      delivered: false,
      reason: 'semantic-state-sufficient',
      fullScreenshotPreserved: true,
      attachmentCount: 1,
    },
    screenshot: {
      sha256: 'b'.repeat(64),
      pixelSha256: 'c'.repeat(64),
      width: 1220,
      height: 1069,
      tileCount: 1,
      tiles: [{ attachmentId: `sha256:${'d'.repeat(64)}` }],
    },
    image: {
      attachmentId: `sha256:${'d'.repeat(64)}`,
      mediaType: 'image/png',
      width: 1220,
      height: 1069,
      bytes: 100,
    },
  })
  assert.deepEqual(content.map(block => block.type), ['text'])
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [userMessage([{
      type: 'tool-result',
      toolCallId: 'computer-fast-path-1',
      toolName: 'computer',
      content,
    }])],
  }))
  assert.equal(result.text, '语义快路径继续')
  assert.equal(visionCalls, 0)
  assert.equal(upstreamCalls, 1)
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.visualTurns, 0)
  assert.equal(usage.totals.calls.visionBase, 0)
  assert.equal(usage.totals.calls.upstreamAutomation, 1)
  assert.equal(usage.totals.derived.automationTokens, 2)
  assert.equal(usage.totals.derived.exactAdditionalTokens, 2)
})

test('semantic Computer Use bounds an unrelated long task prefix and accounts its DeepSeek call', async () => {
  let forwarded
  const ctx = setupBridge({
    bridgeConfig: {
      automationContextMaxTokens: 32_768,
      automationMaxCallsPerTurn: 4,
    },
    upstreamHandler(options) {
      forwarded = options
      return textStream('continue automation', { inputTokens: 30_000, outputTokens: 25 })
    },
  })
  const assistant = (content) => ({
    id: `assistant-${Math.random()}`,
    role: 'assistant',
    content,
    source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
  })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'automation-bounded',
    messages: [
      userMessage([{ type: 'text', text: `old payload ${'x'.repeat(2_000_000)}` }]),
      assistant([{ type: 'text', text: 'old answer' }]),
      userMessage([{ type: 'text', text: 'Inspect the current TARGET window.' }]),
      assistant([{
        type: 'tool-call',
        id: 'computer-bounded-call',
        name: 'computer',
        arguments: '{"action":"observe"}',
      }]),
      userMessage([{
        type: 'tool-result',
        toolCallId: 'computer-bounded-call',
        toolName: 'computer',
        content: [{
          type: 'text',
          text: '[DeepSeekEyes desktop state]\n{"ok":true,"stateId":"desktop-state:bounded"}',
        }],
      }]),
    ],
  }))

  assert.equal(result.text, 'continue automation')
  const wire = JSON.stringify(forwarded.messages)
  assert.equal(wire.includes('old payload'), false)
  assert.match(wire, /Inspect the current TARGET window/)
  assert.match(wire, /desktop-state:bounded/)
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.automationTurns, 1)
  assert.equal(usage.totals.automationContextCompactions, 1)
  assert.ok(usage.totals.estimatedAutomationInputTokensSaved > 450_000)
  assert.equal(usage.totals.derived.automationTokens, 30_025)
  assert.equal(usage.totals.derived.exactAdditionalTokens, 30_025)
})

test('Computer Use model-call guard stops one runaway user instruction and resets on the next', async () => {
  let upstreamCalls = 0
  const ctx = setupBridge({
    bridgeConfig: { automationMaxCallsPerTurn: 2 },
    upstreamHandler() {
      upstreamCalls += 1
      return textStream('next')
    },
  })
  const task = userMessage([{ type: 'text', text: 'Complete the desktop task.' }])
  const automationMessages = (directTask) => [
    directTask,
    {
      id: 'assistant-call-limit',
      role: 'assistant',
      content: [{
        type: 'tool-call',
        id: 'computer-call-limit',
        name: 'computer',
        arguments: '{"action":"observe"}',
      }],
      source: { kind: 'model', provider: 'deepseekeyes', model: 'deepseek-v4-flash' },
    },
    userMessage([{
      type: 'tool-result',
      toolCallId: 'computer-call-limit',
      toolName: 'computer',
      content: [{ type: 'text', text: '[DeepSeekEyes desktop state]\n{"stateId":"call-limit"}' }],
    }]),
  ]
  const call = directTask => collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'automation-call-limit',
    messages: automationMessages(directTask),
  }))

  await call(task)
  await call(task)
  await assert.rejects(call(task), error => error.code === 'AUTOMATION_CALL_LIMIT')
  assert.equal(upstreamCalls, 2)

  await call(userMessage([{ type: 'text', text: 'Continue with a new explicit instruction.' }]))
  assert.equal(upstreamCalls, 3)
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.automationTurns, 2)
  assert.equal(usage.totals.automationLimitStops, 1)
  assert.equal(usage.totals.calls.upstreamAutomation, 3)
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

test('wrapped Qwen evidence is normalized once before DeepSeek and retains an audit trail', async () => {
  let upstreamEvidence
  let visionCalls = 0
  const ctx = setupBridge({
    visionModelId: 'qwen3.7-plus',
    bridgeConfig: { autoDetectVision: false },
    visionHandler() {
      visionCalls += 1
      return textStream(`Result:\n${JSON.stringify(validBaseEvidence({
        ocr: [{ text: 'Error 132', bbox: [100, 200, 600, 260], confidence: 0.98 }],
      }))}`)
    },
    upstreamHandler(options) {
      upstreamEvidence = options.messages[0].content[0].text
      return textStream('normalized evidence reached DeepSeek')
    },
  })
  const bytes = Buffer.from('qwen desktop tile')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const ref = ctx.attachments.add(bytes, { width: 1720, height: 1440 })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [userMessage([{ type: 'image', attachment: ref }])],
  }))
  assert.equal(result.text, 'normalized evidence reached DeepSeek')
  assert.equal(visionCalls, 1)
  assert.match(upstreamEvidence, /"bbox":\[0\.1,0\.2,0\.5,0\.06\]/)
  const record = ctx.deepseekEyesState.evidenceManager.knownBase(hash)
  assert.equal(record.vision.coordinateNormalization.transformedCount, 1)
  assert.equal(record.vision.coordinateNormalization.convention, 'qwen-1000-xyxy')
  assert.deepEqual(record.vision.coordinateNormalization.transforms[0].original, [100, 200, 600, 260])
})

test('MiniMax reasoning preambles and incomplete empty-list structure recover locally before strict validation', async () => {
  const bytes = Buffer.from('minimax recovery image')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const ctx = setupBridge({
    bridgeConfig: { autoDetectVision: false },
    visionHandler() {
      return textStream([
        'Analysis: {"schemaVersion":"example","note":"not the result"}',
        JSON.stringify({
          schemaVersion: 'deepseekeyes.evidence.v1',
          summary: 'Game window and CatAssist panel are visible',
          ocr: { text: 'CatAssist', bbox: { x: '0.1', y: '0.2', width: '0.3', height: '0.1' }, confidence: '0.98' },
        }),
      ].join('\n'))
    },
    upstreamHandler(options) {
      const wire = JSON.stringify(options.messages)
      assert.match(wire, /Game window and CatAssist panel are visible/)
      assert.match(wire, /\\"confidence\\":0\.98/)
      assert.equal(wire.includes('"type":"image"'), false)
      return textStream('恢复后的视觉证据已到达 DeepSeek')
    },
  })
  const ref = ctx.attachments.add(bytes, { width: 1920, height: 1080 })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [userMessage([{ type: 'image', attachment: ref }])],
  }))
  assert.equal(result.text, '恢复后的视觉证据已到达 DeepSeek')
  const record = ctx.deepseekEyesState.evidenceManager.knownBase(hash)
  assert.ok(record.vision.structuralCanonicalization.repairedCount >= 7)
  assert.deepEqual(record.evidence.regions, [])
})

test('one incomplete Anthropic SSE event retries on the same visual route and counts both usages', async () => {
  let visionCalls = 0
  const ctx = setupBridge({
    bridgeConfig: { autoDetectVision: false, visionFailoverAttempts: 0 },
    visionHandler() {
      visionCalls += 1
      if (visionCalls === 1) {
        return (async function* () {
          yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 1 } }
          const error = new Error('Could not parse Anthropic SSE event content_block_delta: Unexpected end of JSON input')
          error.code = 'PI_AI_ERROR'
          throw error
        })()
      }
      return jsonStream(validBaseEvidence({ summary: 'SSE retry recovered the desktop' }), {
        inputTokens: 13,
        outputTokens: 2,
      })
    },
    upstreamHandler: () => textStream('同路由重试成功'),
  })
  const ref = ctx.attachments.add(Buffer.from('transient SSE desktop'))
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'transport-retry-session',
    messages: [userMessage([{ type: 'image', attachment: ref }])],
  }))
  assert.equal(result.text, '同路由重试成功')
  assert.equal(visionCalls, 2)
  assert.deepEqual(result.usage, { inputTokens: 25, outputTokens: 4 })
  const attempts = await ctx.deepseekEyesState.visionAttempts.snapshot()
  assert.deepEqual(attempts.attempts.map(attempt => [attempt.phase, attempt.status]), [
    ['transport-retry', 'retry'],
    ['operation', 'success'],
  ])
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.deepEqual(usage.totals.usage.visionBase, {
    inputTokens: 24,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  })
})

test('desktop visual exhaustion forwards preserved semantic state while direct uploads stay strict', async () => {
  let upstreamCalls = 0
  let visionCalls = 0
  const ctx = setupBridge({
    bridgeConfig: { autoDetectVision: false, visionFailoverAttempts: 0 },
    visionHandler() {
      visionCalls += 1
      return textStream('not valid visual JSON', { inputTokens: 7, outputTokens: 3 })
    },
    upstreamHandler(options) {
      upstreamCalls += 1
      const wire = JSON.stringify(options.messages)
      assert.match(wire, /DeepSeekEyes desktop state/)
      assert.match(wire, /DeepSeekEyes desktop visual fallback/)
      assert.match(wire, /unavailable-after-bounded-recovery/)
      assert.match(wire, /desktop-state:windows-fixture/)
      assert.equal(wire.includes('"type":"image"'), false)
      return textStream('视觉暂时失败，但桌面状态继续到达 DeepSeek')
    },
  })
  const ref = ctx.attachments.add(Buffer.from('desktop fallback pixels'), { width: 1920, height: 1080 })
  const secondRef = ctx.attachments.add(Buffer.from('desktop fallback second tile'), { width: 1920, height: 1080 })
  const desktop = userMessage([{
    type: 'tool-result',
    toolCallId: 'computer-fallback-1',
    toolName: 'computer',
    content: [
      { type: 'text', text: '[DeepSeekEyes desktop state]\n{"stateId":"desktop-state:windows-fixture","actionResult":{"observed":true}}' },
      { type: 'image', attachment: ref },
      { type: 'image', attachment: secondRef },
    ],
  }])
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'desktop-fallback-session',
    messages: [desktop],
  }))
  assert.equal(result.text, '视觉暂时失败，但桌面状态继续到达 DeepSeek')
  assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 4 })
  assert.equal(upstreamCalls, 1)
  assert.equal(visionCalls, 1)
  const usage = await ctx.deepseekEyesState.usage.snapshot()
  assert.equal(usage.totals.usage.visionBase.inputTokens, 7)
  assert.equal(usage.totals.usage.visionBase.outputTokens, 3)

  await assert.rejects(
    collectStream(ctx.llm.stream({
      provider: 'deepseekeyes',
      model: 'deepseek-v4-flash',
      messages: [userMessage([{ type: 'image', attachment: ref }])],
    })),
    error => error.code === 'INVALID_MODEL_OUTPUT',
  )
  assert.equal(upstreamCalls, 1)
  assert.equal(visionCalls, 2)
})

test('an explicit visual max-token rejection retries once with provider-managed output', async () => {
  let visionCalls = 0
  const ctx = setupBridge({
    bridgeConfig: { autoDetectVision: false, baseMaxTokens: 16_384 },
    visionHandler(options) {
      visionCalls += 1
      if (Object.hasOwn(options, 'maxTokens')) {
        return failedStream('invalid_request_error', 'max_tokens must be less than or equal to 8192')
      }
      return jsonStream(validBaseEvidence({ summary: 'Game window with an error dialog' }))
    },
    upstreamHandler: () => textStream('desktop evidence reached DeepSeek'),
  })
  const ref = ctx.attachments.add(Buffer.from('desktop tile'), { width: 1720, height: 1440 })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    messages: [userMessage([{ type: 'image', attachment: ref }])],
  }))
  assert.equal(result.text, 'desktop evidence reached DeepSeek')
  assert.equal(visionCalls, 2)
})

test('a visual max-token finish is classified as truncation before JSON parsing', async () => {
  const ctx = setupBridge({
    bridgeConfig: { autoDetectVision: false, baseMaxTokens: 4_096 },
    visionHandler() {
      return (async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '{"schemaVersion":' }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4096 } }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })()
    },
    upstreamHandler: () => textStream('should not run'),
  })
  const ref = ctx.attachments.add(Buffer.from('dense desktop tile'))
  await assert.rejects(
    collectStream(ctx.llm.stream({
      provider: 'deepseekeyes',
      model: 'deepseek-v4-flash',
      messages: [userMessage([{ type: 'image', attachment: ref }])],
    })),
    (error) => error.code === 'VISION_OUTPUT_TRUNCATED' && /provider-managed output/.test(error.message),
  )
})

test('no visual model leaves the virtual catalog empty and rejects exact resolution', async () => {
  const ctx = setupBridge({ upstreamHandler: () => textStream('unused') })
  assert.deepEqual(await ctx.llm.listModels('deepseekeyes'), [])
  await assert.rejects(
    ctx.llm.resolveModelInfo('deepseekeyes', 'deepseek-v4-flash'),
    (error) => error.code === 'NO_VISION_MODEL',
  )
})

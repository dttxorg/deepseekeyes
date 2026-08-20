import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import {
  estimateMcpResultTokens,
  estimateToolSchemaTokens,
  HASH_UNAVAILABLE,
  MCP_RESULT_OUTPUT,
  MCP_RESULT_CONTEXT_PREFIX,
  McpManager,
  toolDefinitionTokenSurface,
} from '../src/mcp/index.js'
import { MockAttachments, mockContext } from './_helpers.js'

const loadSourceDshTools = () => import('@deepseek-ai/dsh-tools')

function config(overrides = {}, serverOverrides = {}) {
  return {
    providerId: 'deepseekeyes',
    mcpEnabled: true,
    mcpArtifactDir: false,
    mcpMaxResultChars: 1_000,
    mcpServers: [{
      id: 'fixture',
      name: 'Fixture App',
      enabled: true,
      transport: 'stdio',
      command: 'fixture-command',
      allowedTools: [],
      ...serverOverrides,
    }],
    ...overrides,
  }
}

function fakeFactory(definitions = []) {
  const state = { created: [], calls: [], closed: 0, probes: 0, refreshes: 0 }
  return {
    state,
    create(server, hooks) {
      const adapter = {
        server,
        tools: definitions.map(value => structuredClone(value)),
        connected: false,
        async start() {
          this.connected = true
          hooks.onToolsChanged?.(this.tools, { connected: true, reason: 'connected' })
        },
        async listTools() { return this.tools },
        connectionState() { return { connected: this.connected, toolCount: this.tools.length } },
        async probe() {
          state.probes += 1
          return this.tools.map(value => structuredClone(value))
        },
        async refresh() {
          state.refreshes += 1
          this.connected = true
          hooks.onToolsChanged?.(this.tools, { connected: true, reason: 'refreshed' })
          return this.tools
        },
        publish(nextTools, connection) {
          this.tools = nextTools.map(value => structuredClone(value))
          if (typeof connection?.connected === 'boolean') this.connected = connection.connected
          hooks.onToolsChanged?.(this.tools, connection)
        },
        async callTool(tool, args) {
          state.calls.push({ server: server.id, tool: tool.rawName, args })
          if (tool.rawName === 'fails') {
            throw Object.assign(
              new Error(`fixture failed Bearer secret-token ${'x'.repeat(10_000)}`),
              { code: 'FIXTURE_FAILED' },
            )
          }
          if (tool.rawName === 'coded-error') {
            throw Object.assign(new Error('coded fixture failure'), { code: args.code })
          }
          if (tool.rawName === 'oversized') {
            let structuredContent = { leaf: true }
            for (let index = 0; index < 20_000; index += 1) structuredContent = { child: structuredContent }
            return {
              content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('png').toString('base64') }],
              structuredContent,
            }
          }
          if (tool.rawName === 'once') {
            return { content: [{ type: 'text', text: 'result:once' }] }
          }
          return tool.rawName === 'image'
            ? { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('png').toString('base64') }] }
            : { content: [{ type: 'text', text: `result:${args.query ?? ''}` }] }
        },
        async close() {
          this.connected = false
          state.closed += 1
        },
      }
      state.created.push(adapter)
      return adapter
    },
  }
}

const tools = [
  { name: 'search', description: 'Search records', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'write', description: 'Write a record', inputSchema: { type: 'object' } },
]

test('MCP manager connects while exposing zero tools by default', async () => {
  const ctx = mockContext()
  const factory = fakeFactory(tools)
  const manager = new McpManager(ctx, config(), { adapterFactory: factory })
  await manager.start()
  const snapshot = manager.snapshot()
  assert.equal(snapshot.summary.connectedServers, 1)
  assert.equal(snapshot.summary.exposedTools, 0)
  assert.equal(snapshot.servers[0].toolCount, 2)
  assert.equal(snapshot.servers[0].tools.every(tool => tool.allowed === false), true)
  assert.equal(ctx.tools.definitions.size, 0)
  assert.equal(ctx.systemPrompt.sections.size, 0)
  await manager.stop()
})

test('MCP managed tools enforce the Eyes route, bound output, preserve images, audit, and account usage', async () => {
  const ctx = mockContext()
  const factory = fakeFactory([...tools, { name: 'image', inputSchema: { type: 'object' } }])
  const usage = []
  const manager = new McpManager(ctx, config({}, { allowedTools: ['search', 'image'] }), {
    adapterFactory: factory,
    usageTracker: {
      async recordMcpExternalCall(sessionId, value) { usage.push({ sessionId, ...value }) },
    },
  })
  await manager.start()
  const search = ctx.tools.get('mcp__fixture__search')
  assert.ok(search)
  assert.equal(search.presentCall({ query: 'secret' }).kind, 'read')
  assert.equal(search.presentCall({ query: 'secret' }).rawInput.query, undefined)
  assert.equal(ctx.tools.get('mcp__fixture__write'), undefined)
  assert.ok(ctx.systemPrompt.sections.has('deepseekeyes:mcp-applications'))
  await assert.rejects(
    search.execute({ query: 'x' }, {
      agent: { id: 'wrong', options: { provider: 'text-provider' } },
      signal: new AbortController().signal,
    }),
    error => error.code === 'MCP_REQUIRES_DEEPSEEKEYES',
  )
  const result = await search.execute({ query: 'ok' }, {
    agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
    signal: new AbortController().signal,
  })
  assert.equal(result.preview, 'result:ok')
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(usage.length, 1)
  assert.equal(usage[0].sessionId, 'session-1')
  assert.equal(usage[0].schemaTokens, undefined)
  assert.equal(usage[0].resultTokens, estimateMcpResultTokens(result))
  assert.equal(manager.snapshot().audit.length, 1)
  assert.equal(JSON.stringify(manager.snapshot().audit).includes('ok'), false)

  const imageTool = ctx.tools.get('mcp__fixture__image')
  const imageResult = await imageTool.execute({}, {
    agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
    signal: new AbortController().signal,
  })
  assert.equal(imageResult.images.length, 1)
  assert.equal(ctx.attachments.saved.length, 1)
  const rendered = imageTool.output.render({}, imageResult)
  assert.equal(rendered[1].type, 'image')
  assert.equal(rendered[1].attachment.attachmentId, imageResult.images[0].attachmentId)
  assert.equal(usage[1].resultTokens, estimateMcpResultTokens(imageResult))
  assert.ok(usage[1].resultTokens > usage[0].resultTokens)
  await manager.stop()
})

test('MCP unknown annotations present as edit and failures remain hash-only audited and accounted', async () => {
  const ctx = mockContext()
  const factory = fakeFactory([{ name: 'fails', inputSchema: { type: 'object' } }])
  let calls = 0
  const manager = new McpManager(ctx, config({}, { allowedTools: ['fails'] }), {
    adapterFactory: factory,
    usageTracker: { async recordMcpExternalCall() { calls += 1 } },
  })
  await manager.start()
  const tool = ctx.tools.get('mcp__fixture__fails')
  assert.equal(tool.presentCall({ password: 'secret' }).kind, 'edit')
  await assert.rejects(
    tool.execute({ password: 'secret' }, {
      agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
      signal: new AbortController().signal,
    }),
    error => error.name === 'DeepSeekEyesError'
      && error.code === 'MCP_TOOL_CALL_FAILED'
      && error.message.includes('fixture failed')
      && !error.message.includes('secret-token')
      && error.message.length < 600,
  )
  assert.equal(calls, 1)
  const [audit] = manager.snapshot().audit
  assert.equal(audit.status, 'error')
  assert.equal(audit.error.code, 'MCP_TOOL_CALL_FAILED')
  assert.equal(JSON.stringify(audit).includes('secret'), false)
  await manager.stop()
})

test('MCP Code Mode enforces the cumulative external-call limit before transport dispatch', async () => {
  const ctx = mockContext()
  const factory = fakeFactory([tools[0]])
  let limitStops = 0
  const manager = new McpManager(
    ctx,
    config({ mcpMaxExternalCallsPerRun: 2 }, { allowedTools: ['search'] }),
    {
      adapterFactory: factory,
      usageTracker: {
        async recordMcpExternalCall() {},
        async recordMcpLimitStop() { limitStops += 1 },
      },
    },
  )
  await manager.start()
  const tool = ctx.tools.get('mcp__fixture__search')
  const parent = {}
  const contexts = []
  const exec = {
    agent: { id: 'session-limited', options: { provider: 'deepseekeyes' } },
    parent,
    deferContext(value) { contexts.push(value) },
    signal: new AbortController().signal,
  }
  await tool.execute({ query: 'one' }, exec)
  await tool.execute({ query: 'two' }, exec)
  await assert.rejects(
    tool.execute({ query: 'three' }, exec),
    error => error.code === 'MCP_EXTERNAL_CALL_LIMIT_REACHED'
      && error.message.includes('configured 2 external calls'),
  )
  assert.equal(factory.state.calls.length, 2)
  assert.equal(limitStops, 1)
  assert.equal(contexts.length, 3)
  assert.match(contexts[2].content[0].text, /MCP_EXTERNAL_CALL_LIMIT_REACHED/)

  const anotherRun = { ...exec, parent: {}, deferContext() {} }
  await tool.execute({ query: 'new-run' }, anotherRun)
  assert.equal(factory.state.calls.length, 3)
  await manager.stop()
})

test('MCP manager rejects an oversized raw result before attachment writes and reports zero result tokens', async () => {
  const ctx = mockContext()
  const factory = fakeFactory([{ name: 'oversized', inputSchema: { type: 'object' } }])
  const usage = []
  const manager = new McpManager(ctx, config({}, { allowedTools: ['oversized'] }), {
    adapterFactory: factory,
    usageTracker: { async recordMcpExternalCall(_sessionId, value) { usage.push(value) } },
  })
  await manager.start()
  await assert.rejects(
    ctx.tools.get('mcp__fixture__oversized').execute({}, {
      agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
      signal: new AbortController().signal,
    }),
    error => error.name === 'DeepSeekEyesError' && error.code === 'MCP_RESULT_DEPTH_LIMIT',
  )
  assert.equal(ctx.attachments.saved.length, 0)
  assert.deepEqual(usage, [{ resultTokens: 0 }])
  assert.equal(manager.snapshot().audit[0].error.code, 'MCP_RESULT_DEPTH_LIMIT')
  await manager.stop()
})

test('MCP presentation and audit safely hash hostile args without retrying or overriding successful execution', async () => {
  const ctx = mockContext()
  const factory = fakeFactory([{ name: 'once', inputSchema: { type: 'object' } }])
  const manager = new McpManager(ctx, config({}, { allowedTools: ['once'] }), {
    adapterFactory: factory,
    async onAudit() { throw new Error('audit sink unavailable') },
  })
  await manager.start()
  const tool = ctx.tools.get('mcp__fixture__once')

  let deep = { leaf: true }
  for (let index = 0; index < 20_000; index += 1) deep = { child: deep }
  const deepPresentation = tool.presentCall(deep)
  assert.deepEqual(deepPresentation.rawInput, { keys: [], argsSha256: HASH_UNAVAILABLE })

  const getterArgs = {}
  Object.defineProperty(getterArgs, 'token', {
    enumerable: true,
    get() { throw new Error('getter exposed plaintext-secret') },
  })
  assert.deepEqual(tool.presentCall(getterArgs).rawInput, { keys: [], argsSha256: HASH_UNAVAILABLE })
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  assert.doesNotThrow(() => tool.presentCall(revoked.proxy))
  assert.equal(tool.presentCall(revoked.proxy).rawInput.argsSha256, HASH_UNAVAILABLE)

  const exec = {
    agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
    signal: new AbortController().signal,
  }
  const deepResult = await tool.execute(deep, exec)
  assert.equal(deepResult.preview, 'result:once')
  assert.equal(factory.state.calls.length, 1)
  assert.equal(manager.snapshot().audit[0].argsSha256, HASH_UNAVAILABLE)

  const getterResult = await tool.execute(getterArgs, exec)
  assert.equal(getterResult.preview, 'result:once')
  assert.equal(factory.state.calls.length, 2)
  assert.equal(manager.snapshot().audit[1].argsSha256, HASH_UNAVAILABLE)
  assert.equal(JSON.stringify(manager.snapshot().audit).includes('plaintext-secret'), false)
  await manager.stop()
})

test('MCP tool failures contain throwing error getters and revoked Proxies without retry or false-success audit', async () => {
  const getterSecret = 'getter-plaintext-secret'
  const revokedSecret = 'revoked-plaintext-secret'
  const oversizedSecret = 'oversized-plaintext-secret'
  const state = { calls: [], messageReads: 0, codeReads: 0 }
  const factory = {
    create(_server, hooks) {
      const tools = [{ name: 'hostile-error', inputSchema: { type: 'object' } }]
      return {
        connected: false,
        async start() {
          this.connected = true
          hooks.onToolsChanged?.(tools, { connected: true, status: 'connected' })
        },
        async listTools() { return tools },
        connectionState() { return { connected: this.connected } },
        async callTool(_tool, args) {
          state.calls.push(args.variant)
          if (args.variant === 'getter') {
            const failure = new Error('inaccessible')
            Object.defineProperties(failure, {
              message: {
                configurable: true,
                get() {
                  state.messageReads += 1
                  throw new Error(`message getter exposed ${getterSecret}`)
                },
              },
              code: {
                configurable: true,
                get() {
                  state.codeReads += 1
                  throw new Error(`code getter exposed ${getterSecret}`)
                },
              },
            })
            throw failure
          }
          if (args.variant === 'oversized') {
            throw Object.assign(
              new Error(`ordinary prefix ${'x'.repeat(2_000_000)} token=${oversizedSecret}`),
              { code: `${'C'.repeat(1_000_000)}token=${oversizedSecret}` },
            )
          }
          const revoked = Proxy.revocable(
            Object.assign(new Error(revokedSecret), { code: `token=${revokedSecret}` }),
            {},
          )
          revoked.revoke()
          throw revoked.proxy
        },
        async close() { this.connected = false },
      }
    },
  }
  const ctx = mockContext()
  const manager = new McpManager(ctx, config({}, { allowedTools: ['hostile-error'] }), {
    adapterFactory: factory,
  })
  await manager.start()
  const tool = ctx.tools.get('mcp__fixture__hostile-error')
  const exec = {
    agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
    signal: new AbortController().signal,
  }

  for (const variant of ['getter', 'revoked', 'oversized']) {
    await assert.rejects(
      tool.execute({ variant }, exec),
      error => error.name === 'DeepSeekEyesError'
        && error.code === 'MCP_TOOL_CALL_FAILED'
        && (variant === 'oversized'
          ? error.message.includes('ordinary prefix') && error.message.length < 600
          : error.message.includes('unknown error'))
        && !error.message.includes('plaintext-secret'),
      variant,
    )
  }

  assert.deepEqual(state.calls, ['getter', 'revoked', 'oversized'], 'each failing side effect runs exactly once')
  assert.equal(state.messageReads, 1)
  assert.equal(state.codeReads, 1)
  const audit = manager.snapshot().audit
  assert.equal(audit.length, 3)
  assert.equal(audit.every(event => event.status === 'error'), true)
  assert.equal(audit.every(event => event.error.code === 'MCP_TOOL_CALL_FAILED'), true)
  const serialized = JSON.stringify({ audit })
  assert.equal(serialized.includes(getterSecret), false)
  assert.equal(serialized.includes(revokedSecret), false)
  assert.equal(serialized.includes(oversizedSecret), false)
  await manager.stop()
})

test('MCP managed errors preserve only stable result and Host image admission codes', async () => {
  const ctx = mockContext()
  const manager = new McpManager(
    ctx,
    config({}, { allowedTools: ['coded-error'] }),
    { adapterFactory: fakeFactory([{ name: 'coded-error', inputSchema: { type: 'object' } }]) },
  )
  await manager.start()
  const tool = ctx.tools.get('mcp__fixture__coded-error')
  const stableCodes = [
    'TOO_MANY_IMAGES',
    'IMAGES_TOO_LARGE',
    'IMAGE_TOO_LARGE',
    'UNSUPPORTED_IMAGE_TYPE',
    'INVALID_IMAGE_BASE64',
    'MCP_RESULT_DEPTH_LIMIT',
  ]
  for (const code of stableCodes) {
    await assert.rejects(
      tool.execute({ code }, {
        agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
        signal: new AbortController().signal,
      }),
      error => error.code === code,
      code,
    )
  }
  await assert.rejects(
    tool.execute({ code: 'UPSTREAM_SECRET_CODE' }, {
      agent: { id: 'session-1', options: { provider: 'deepseekeyes' } },
      signal: new AbortController().signal,
    }),
    error => error.code === 'MCP_TOOL_CALL_FAILED',
  )
  await manager.stop()
})

test('MCP policy-only reconfiguration avoids reconnect while connection changes restart', async () => {
  const ctx = mockContext()
  const factory = fakeFactory(tools)
  const manager = new McpManager(ctx, config(), { adapterFactory: factory })
  await manager.start()
  assert.equal(factory.state.created.length, 1)
  await manager.reconfigure(config({}, { allowedTools: ['search'] }))
  assert.equal(factory.state.created.length, 1)
  assert.ok(ctx.tools.get('mcp__fixture__search'))
  await manager.reconfigure(config({}, { command: 'new-command', allowedTools: ['search'] }))
  assert.equal(factory.state.created.length, 2)
  assert.equal(factory.state.closed, 1)
  assert.ok(ctx.tools.get('mcp__fixture__search'))
  await manager.reconfigure(config({ mcpEnabled: false }, { allowedTools: ['search'] }))
  assert.equal(ctx.tools.get('mcp__fixture__search'), undefined)
  assert.equal(ctx.systemPrompt.sections.size, 0)
  await manager.stop()
})

test('MCP reconfiguration revokes every schema before close and isolates a throwing cleanup per server', async () => {
  const ctx = mockContext()
  const state = { created: [], closed: [] }
  const adapterFactory = {
    create(server, hooks) {
      const adapter = {
        server,
        connected: false,
        tools: [{ name: 'search', inputSchema: { type: 'object' } }],
        async start() {
          this.connected = true
          hooks.onToolsChanged?.(this.tools, { connected: true, status: 'connected', reason: 'connected' })
        },
        async listTools() { return this.tools },
        connectionState() { return { connected: this.connected, status: this.connected ? 'connected' : 'closed' } },
        async close() {
          this.connected = false
          state.closed.push(`${server.id}:${server.command}`)
          if (server.id === 'broken') {
            throw Object.assign(new Error('broken close'), { code: 'MCP_ADAPTER_CLOSE_FAILED' })
          }
        },
      }
      state.created.push(adapter)
      return adapter
    },
  }
  const server = (id, command) => ({
    id,
    name: id,
    enabled: true,
    transport: 'stdio',
    command,
    allowedTools: ['search'],
  })
  const manager = new McpManager(ctx, config({
    mcpServers: [server('broken', 'old-broken'), server('healthy', 'old-healthy')],
  }), { adapterFactory })
  await manager.start()
  assert.equal(manager.snapshot().summary.exposedTools, 2)

  const replaced = await manager.reconfigure(config({
    mcpServers: [server('broken', 'new-broken'), server('healthy', 'new-healthy')],
  }))
  assert.equal(ctx.tools.get('mcp__broken__search'), undefined, 'failed cleanup must revoke its old schema')
  assert.ok(ctx.tools.get('mcp__healthy__search'), 'other servers must complete replacement')
  assert.equal(ctx.systemPrompt.sections.size, 1)
  assert.equal(state.created.filter(adapter => adapter.server.id === 'broken').length, 1, 'no duplicate transport')
  assert.equal(state.created.filter(adapter => adapter.server.id === 'healthy').length, 2)
  assert.equal(replaced.servers.find(entry => entry.id === 'broken').status, 'error')
  assert.equal(replaced.summary.cleanupFailures, 1)
  assert.equal(replaced.cleanupErrors[0].error.code, 'MCP_ADAPTER_CLOSE_FAILED')

  const disabled = await manager.reconfigure(config({
    mcpEnabled: false,
    mcpServers: [server('broken', 'new-broken'), server('healthy', 'new-healthy')],
  }))
  assert.equal(disabled.summary.exposedTools, 0)
  assert.equal(ctx.tools.definitions.size, 0)
  assert.equal(ctx.systemPrompt.sections.size, 0)
  assert.ok(state.closed.includes('healthy:new-healthy'), 'cleanup failure must not block another server close')
  await manager.stop()
})

test('MCP reconfigure and stop keep all schemas revoked throughout slow multi-server cleanup', async () => {
  let pendingGate
  const gateNextClose = (target) => {
    let release
    let entered
    const enteredPromise = new Promise(resolve => { entered = resolve })
    const releasePromise = new Promise(resolve => { release = resolve })
    pendingGate = { target, entered, releasePromise }
    return { entered: enteredPromise, release }
  }
  const adapterFactory = {
    create(server, hooks) {
      const definitions = [{ name: 'search', inputSchema: { type: 'object' } }]
      return {
        async start() { hooks.onToolsChanged?.(definitions, { connected: true }) },
        async listTools() { return definitions },
        connectionState() { return { connected: true } },
        async callTool() { return { content: [{ type: 'text', text: 'ok' }] } },
        async close() {
          const gate = pendingGate
          if (gate?.target !== `${server.id}:${server.command}`) return
          pendingGate = undefined
          gate.entered()
          await gate.releasePromise
        },
      }
    },
  }
  const server = (id, command) => ({
    id,
    name: id,
    enabled: true,
    transport: 'stdio',
    command,
    allowedTools: ['search'],
  })
  const ctx = mockContext()
  const manager = new McpManager(ctx, config({
    mcpServers: [server('a', 'old-a'), server('b', 'old-b')],
  }), { adapterFactory })
  await manager.start()
  assert.equal(manager.snapshot().summary.exposedTools, 2)

  const reconfigureGate = gateNextClose('a:old-a')
  const reconfiguring = manager.reconfigure(config({
    mcpServers: [server('a', 'new-a'), server('b', 'new-b')],
  }))
  await reconfigureGate.entered
  assert.equal(manager.snapshot().summary.exposedTools, 0)
  assert.equal(ctx.tools.get('mcp__a__search'), undefined)
  assert.equal(ctx.tools.get('mcp__b__search'), undefined)
  assert.equal(ctx.systemPrompt.sections.size, 0)
  reconfigureGate.release()
  const reconfigured = await reconfiguring
  assert.equal(reconfigured.summary.exposedTools, 2)
  assert.ok(ctx.tools.get('mcp__a__search'))
  assert.ok(ctx.tools.get('mcp__b__search'))

  const stopGate = gateNextClose('a:new-a')
  const stopping = manager.stop()
  await stopGate.entered
  assert.equal(manager.snapshot().summary.exposedTools, 0)
  assert.equal(ctx.tools.get('mcp__a__search'), undefined)
  assert.equal(ctx.tools.get('mcp__b__search'), undefined)
  assert.equal(ctx.systemPrompt.sections.size, 0)
  stopGate.release()
  const stopped = await stopping
  assert.equal(stopped.summary.exposedTools, 0)
  assert.equal(ctx.tools.definitions.size, 0)
  assert.equal(ctx.systemPrompt.sections.size, 0)
})

test('MCP manager rejects a 20k-deep catalog without stack overflow or cross-server failure', async () => {
  let deepSchema = { type: 'string' }
  for (let index = 0; index < 20_000; index += 1) {
    deepSchema = { type: 'object', properties: { child: deepSchema } }
  }
  const ctx = mockContext()
  const factory = {
    create(server, hooks) {
      const adapter = {
        connected: false,
        tools: server.id === 'deep'
          ? [{ name: 'deep', inputSchema: deepSchema }]
          : [{ name: 'search', inputSchema: { type: 'object' } }],
        async start() {
          this.connected = true
          hooks.onToolsChanged?.(this.tools, { connected: true, status: 'connected' })
        },
        async listTools() { return this.tools },
        connectionState() { return { connected: this.connected } },
        async close() { this.connected = false },
      }
      return adapter
    },
  }
  const makeServer = id => ({
    id,
    name: id,
    enabled: true,
    transport: 'stdio',
    command: id,
    allowedTools: ['*'],
  })
  const manager = new McpManager(ctx, config({
    mcpServers: [makeServer('deep'), makeServer('good')],
  }), { adapterFactory: factory })
  await manager.start()
  await manager.queue
  const snapshot = manager.snapshot()
  const rejected = snapshot.servers.find(server => server.id === 'deep')
  const healthy = snapshot.servers.find(server => server.id === 'good')
  assert.equal(rejected.status, 'error')
  assert.equal(rejected.lastError.code, 'MCP_CATALOG_SCHEMA_DEPTH_LIMIT')
  assert.equal(rejected.toolCount, 0)
  assert.equal(healthy.status, 'connected')
  assert.equal(healthy.exposedToolCount, 1)
  assert.ok(ctx.tools.get('mcp__good__search'))
  await manager.stop()
})

test('MCP zero-tool generation becomes healthy only after a matching live probe', async () => {
  const ctx = mockContext()
  let hooks
  const adapter = {
    connected: false,
    status: 'idle',
    tools: [{ name: 'search', inputSchema: { type: 'object' } }],
    async start() {
      this.connected = true
      this.status = 'connected'
      hooks.onToolsChanged?.(this.tools, { connected: true, status: this.status })
    },
    async listTools() { return this.tools },
    connectionState() {
      return {
        connected: this.status === 'connected' ? true : this.status === 'unknown' ? undefined : false,
        status: this.status,
      }
    },
    publishZero() {
      this.tools = []
      this.connected = false
      this.status = 'unknown'
      hooks.onToolsChanged?.([], { connected: undefined, status: 'unknown', reason: 'tools-empty-unverified' })
    },
    async probe() { return [] },
    reconcileProbe(probed) {
      if (this.status === 'unknown' && probed.length === 0) {
        this.connected = true
        this.status = 'connected'
      }
    },
    async close() { this.connected = false; this.status = 'closed' },
  }
  const manager = new McpManager(ctx, config({}, { allowedTools: ['search'] }), {
    adapterFactory: {
      create(_server, value) { hooks = value; return adapter },
    },
  })
  await manager.start()
  assert.equal(manager.snapshot().summary.exposedTools, 1)
  adapter.publishZero()
  await manager.queue
  let snapshot = manager.snapshot()
  assert.equal(snapshot.servers[0].status, 'degraded')
  assert.equal(snapshot.servers[0].healthy, false)
  assert.equal(snapshot.summary.exposedTools, 0)

  const tested = await manager.testConnection('fixture')
  assert.equal(tested.ok, true)
  assert.equal(tested.toolCount, 0)
  assert.equal(tested.status, 'connected')
  snapshot = manager.snapshot()
  assert.equal(snapshot.servers[0].status, 'connected')
  assert.equal(snapshot.servers[0].healthy, true)
  assert.equal(snapshot.servers[0].toolCount, 0)
  assert.equal(snapshot.summary.exposedTools, 0)
  await manager.stop()
})

test('MCP lifecycle status, probe, and refresh redact untrusted error codes', async () => {
  const secret = 'secret-value'
  const makeError = () => Object.assign(new Error(`provider token=${secret}`), { code: `token=${secret}` })
  const ctx = mockContext()
  const adapter = {
    async start() { throw makeError() },
    async listTools() { return [] },
    async probe() { throw makeError() },
    async refresh() { throw makeError() },
    async close() {},
  }
  const manager = new McpManager(ctx, config(), {
    adapterFactory: { create() { return adapter } },
  })
  await manager.start()
  let serialized = JSON.stringify(manager.snapshot())
  assert.equal(serialized.includes(secret), false)

  const tested = await manager.testConnection('fixture')
  assert.equal(JSON.stringify(tested).includes(secret), false)
  await assert.rejects(
    manager.listTools('fixture', { refresh: true }),
    error => !String(error.code).includes(secret) && !error.message.includes(secret),
  )
  serialized = JSON.stringify(manager.snapshot())
  assert.equal(serialized.includes(secret), false)
  await manager.stop()
})

test('MCP max-tools and schema budgets are enforced before registration and visible in health', async () => {
  const ctx = mockContext()
  const factory = fakeFactory(tools)
  const manager = new McpManager(ctx, config({ mcpMaxTools: 1 }, { allowedTools: ['*'] }), { adapterFactory: factory })
  await manager.start()
  const snapshot = manager.snapshot()
  assert.equal(snapshot.summary.exposedTools, 1)
  assert.equal(snapshot.summary.schemaTokenEstimate, snapshot.summary.schemaTokensEstimated)
  assert.equal(snapshot.servers[0].tools.filter(tool => tool.blockedReason === 'max-tools').length, 1)
  await manager.stop()
})

test('MCP schema budgets use the exact managed ToolRuntime definition and ignore raw server output schemas', async () => {
  const minimal = {
    name: 'minimal',
    inputSchema: {},
    outputSchema: {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [
        `raw_${index}`,
        { type: 'string', description: 'server output that is not registered' },
      ])),
    },
  }
  const ctx = mockContext()
  const manager = new McpManager(ctx, config({ mcpMaxSchemaTokens: 0 }, { allowedTools: ['minimal'] }), {
    adapterFactory: fakeFactory([minimal]),
  })
  await manager.start()

  const publicName = 'mcp__fixture__minimal'
  const registered = ctx.tools.get(publicName)
  const snapshot = manager.snapshot()
  const summary = snapshot.servers[0].tools[0]
  assert.ok(registered)
  assert.deepEqual(registered.output.schema, MCP_RESULT_OUTPUT.schema)
  assert.equal(summary.schemaTokensEstimated, estimateToolSchemaTokens(registered))
  assert.equal(snapshot.summary.schemaTokensEstimated, estimateToolSchemaTokens(registered))
  assert.ok(summary.schemaTokensEstimated < 1_000, 'raw MCP outputSchema must not inflate the managed definition budget')
  await manager.stop()

  const boundaryTool = {
    name: 'boundary',
    description: 'x'.repeat(512),
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }
  const probeCtx = mockContext()
  const probe = new McpManager(probeCtx, config({ mcpMaxSchemaTokens: 0 }, { allowedTools: ['boundary'] }), {
    adapterFactory: fakeFactory([boundaryTool]),
  })
  await probe.start()
  const exactBudget = estimateToolSchemaTokens(probeCtx.tools.get('mcp__fixture__boundary'))
  assert.ok(exactBudget > 256)
  await probe.stop()

  for (const [budget, exposed] of [[exactBudget, true], [exactBudget - 1, false]]) {
    const boundaryCtx = mockContext()
    const boundary = new McpManager(
      boundaryCtx,
      config({ mcpMaxSchemaTokens: budget }, { allowedTools: ['boundary'] }),
      { adapterFactory: fakeFactory([boundaryTool]) },
    )
    await boundary.start()
    const result = boundary.snapshot()
    assert.equal(result.servers[0].tools[0].schemaTokensEstimated, exactBudget)
    assert.equal(result.servers[0].tools[0].exposed, exposed)
    assert.equal(boundaryCtx.tools.get('mcp__fixture__boundary') !== undefined, exposed)
    assert.equal(result.servers[0].tools[0].blockedReason, exposed ? undefined : 'schema-token-budget')
    await boundary.stop()
  }
})

test('MCP test and reconnect APIs report health and refresh lifecycle', async () => {
  const ctx = mockContext()
  const factory = fakeFactory(tools)
  const manager = new McpManager(ctx, config(), { adapterFactory: factory })
  await manager.start()
  const tested = await manager.testConnection('fixture')
  assert.equal(tested.ok, true)
  assert.equal(tested.toolCount, 2)
  assert.equal(
    tested.schemaTokensEstimated,
    manager.snapshot().servers[0].tools.reduce((total, tool) => total + tool.schemaTokensEstimated, 0),
  )
  assert.equal(factory.state.probes, 1, 'health must use a live probe instead of listTools capture cache')
  await manager.health()
  assert.equal(factory.state.probes, 1, 'a recent explicit probe must satisfy automatic health freshness')
  await manager.listTools('fixture', { refresh: true })
  assert.equal(factory.state.refreshes, 1, 'refresh must replace the live transport generation')
  const reconnected = await manager.reconnect('fixture')
  assert.equal(reconnected.servers[0].status, 'connected')
  assert.equal(factory.state.created.length, 2)
  assert.equal(factory.state.closed, 1)
  await manager.stop()
})

test('automatic MCP health probes are single-flight and rate-limited while expired health re-probes', async () => {
  let clock = 0
  const ctx = mockContext()
  const factory = fakeFactory(tools)
  const manager = new McpManager(ctx, config(), {
    adapterFactory: factory,
    now: () => clock,
    healthProbeIntervalMs: 30_000,
  })
  await manager.start()

  await manager.health()
  assert.equal(factory.state.probes, 0, 'successful startup is already a fresh transport check')

  clock = 30_001
  const [first, concurrent] = await Promise.all([manager.health(), manager.health()])
  assert.equal(first.summary.connectedServers, 1)
  assert.equal(concurrent.summary.connectedServers, 1)
  assert.equal(factory.state.probes, 1, 'concurrent stale status reads share one probe')

  await manager.health()
  assert.equal(factory.state.probes, 1, 'polling inside the freshness interval reuses the snapshot')
  clock = 60_002
  await manager.health()
  assert.equal(factory.state.probes, 2, 'the next expired status performs a new real probe')
  await manager.stop()
})

test('MCP probe cleanup failures are visible, revoke schemas, and block repeated probes until reconnect drains them', async () => {
  let clock = 0
  const state = {
    adapters: 0,
    probes: 0,
    cleanupAttempts: 0,
    allowCleanup: false,
    failureInjected: false,
  }
  const definitions = [tools[0]]
  const adapterFactory = {
    create(_server, hooks) {
      state.adapters += 1
      return {
        async start() { hooks.onToolsChanged?.(definitions, { connected: true }) },
        async listTools() { return definitions },
        connectionState() { return { connected: true } },
        async probe() {
          state.probes += 1
          if (!state.failureInjected) {
            state.failureInjected = true
            const failure = Object.assign(new Error('probe cleanup failed'), {
              code: 'MCP_ADAPTER_CLOSE_FAILED',
            })
            const cleanupHandle = {
              async close() {
                state.cleanupAttempts += 1
                if (!state.allowCleanup) throw failure
              },
            }
            hooks.onProbeCleanupFailure?.(cleanupHandle, failure)
            throw failure
          }
          return definitions
        },
        async close() {},
      }
    },
  }
  const ctx = mockContext()
  const manager = new McpManager(
    ctx,
    config({}, { allowedTools: ['search'] }),
    { adapterFactory, now: () => clock, healthProbeIntervalMs: 30_000 },
  )
  await manager.start()
  assert.equal(manager.snapshot().summary.exposedTools, 1)

  clock = 30_001
  const failed = await manager.testConnection('fixture')
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'MCP_ADAPTER_CLOSE_FAILED')
  let snapshot = manager.snapshot()
  assert.equal(snapshot.summary.cleanupFailures, 1)
  assert.equal(snapshot.cleanupErrors[0].phase, 'probe')
  assert.equal(snapshot.summary.exposedTools, 0)
  assert.equal(snapshot.servers[0].status, 'degraded')
  assert.equal(ctx.tools.get('mcp__fixture__search'), undefined)
  assert.equal(ctx.systemPrompt.sections.size, 0)

  const repeated = await manager.testConnection('fixture')
  assert.equal(repeated.ok, false)
  assert.equal(state.probes, 1, 'testConnection must not allocate another probe while cleanup is unresolved')
  clock = 60_002
  await manager.health()
  assert.equal(state.probes, 1, 'health must not allocate another probe while cleanup is unresolved')

  const stillBlocked = await manager.reconnect('fixture')
  assert.equal(stillBlocked.summary.cleanupFailures, 1)
  assert.equal(stillBlocked.summary.exposedTools, 0)
  assert.equal(state.cleanupAttempts, 1)

  state.allowCleanup = true
  const recovered = await manager.reconnect('fixture')
  assert.equal(recovered.summary.cleanupFailures, 0)
  assert.equal(recovered.summary.exposedTools, 1)
  assert.equal(recovered.servers[0].status, 'connected')
  assert.equal(state.cleanupAttempts, 2)
  assert.equal(state.adapters, 2)
  const verified = await manager.testConnection('fixture')
  assert.equal(verified.ok, true)
  assert.equal(state.probes, 2)
  await manager.stop()
})

test('MCP health fails closed when a live generation is cleared or a real probe fails despite cached tools', async () => {
  const ctx = mockContext()
  const factory = fakeFactory(tools)
  const manager = new McpManager(ctx, config({}, { allowedTools: ['search'] }), { adapterFactory: factory })
  await manager.start()
  assert.equal(manager.snapshot().summary.exposedTools, 1)

  const [adapter] = factory.state.created
  adapter.publish([], { connected: false, reason: 'tools-cleared' })
  await manager.queue
  let snapshot = manager.snapshot()
  assert.equal(snapshot.servers[0].status, 'degraded')
  assert.equal(snapshot.servers[0].healthy, false)
  assert.equal(snapshot.summary.connectedServers, 0)
  assert.equal(snapshot.summary.exposedTools, 0)
  assert.equal(ctx.tools.get('mcp__fixture__search'), undefined)

  adapter.tools = tools.map(value => structuredClone(value))
  adapter.connected = true
  adapter.probe = async () => {
    factory.state.probes += 1
    throw Object.assign(new Error('transport refused connection'), { code: 'ECONNREFUSED' })
  }
  const tested = await manager.testConnection('fixture')
  assert.equal(tested.ok, false)
  assert.equal(tested.error.code, 'ECONNREFUSED')
  snapshot = manager.snapshot()
  assert.equal(snapshot.servers[0].status, 'degraded')
  assert.equal(snapshot.servers[0].healthy, false)
  assert.equal(snapshot.summary.exposedTools, 0)
  await manager.stop()
})

test('real DSH SystemPrompt and ToolRuntime hide MCP outside the selected Eyes provider and deny agentless execution', async () => {
  const root = new Context()
  const systemPromptFiber = root.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: '' })
  await systemPromptFiber
  const toolsFiber = root.plugin(ToolRuntime, { mode: 'native' })
  await toolsFiber
  const factory = fakeFactory([tools[0]])
  const manager = new McpManager(root, config({}, { allowedTools: ['search'] }), { adapterFactory: factory })
  await manager.start()

  const makeAgent = (id, provider, selectedProvider) => {
    const agent = { id, options: { provider }, session: {} }
    const scope = createScope(root, agent)
    agent.ctx = scope.ctx
    if (selectedProvider !== undefined) {
      // Mirrors DSH installModelSelection: the scoped selector writes the
      // provider after delegating, and the root isolation listener must observe
      // that final selection rather than stale agent.options.
      agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const resolved = await next()
        return {
          ...resolved,
          variables: { ...resolved.variables, provider: selectedProvider },
        }
      })
    }
    return { agent, scope }
  }

  const eyes = makeAgent('eyes', 'deepseekeyes')
  const text = makeAgent('text', 'text-provider')
  const switchedAway = makeAgent('switched-away', 'deepseekeyes', 'text-provider')
  const switchedToEyes = makeAgent('switched-to-eyes', 'text-provider', 'deepseekeyes')
  const toolName = 'mcp__fixture__search'
  const inspect = async agent => root.systemPrompt.assemble({ agent, scope: agent })

  const eyesAssembly = await inspect(eyes.agent)
  assert.deepEqual(eyesAssembly.tools.map(tool => tool.name), [toolName])
  assert.ok(eyesAssembly.sections.some(section => section.name === 'deepseekeyes:mcp-applications'))
  const registered = root.tools.get(toolName)
  assert.ok(registered)
  assert.deepEqual(toolDefinitionTokenSurface(registered), root.tools.sdkSchemas()[0])
  assert.equal(
    manager.snapshot().servers[0].tools[0].schemaTokensEstimated,
    estimateToolSchemaTokens(registered),
  )

  for (const agent of [text.agent, switchedAway.agent]) {
    const assembly = await inspect(agent)
    assert.equal(assembly.tools.some(tool => tool.name === toolName), false)
    assert.equal(assembly.sections.some(section => section.name === 'deepseekeyes:mcp-applications'), false)
  }
  const switchedAssembly = await inspect(switchedToEyes.agent)
  assert.equal(switchedAssembly.tools.some(tool => tool.name === toolName), true)
  assert.equal(switchedAssembly.sections.some(section => section.name === 'deepseekeyes:mcp-applications'), true)

  const diagnostic = await root.systemPrompt.assemble()
  assert.equal(diagnostic.tools.some(tool => tool.name === toolName), false)
  assert.equal(diagnostic.sections.some(section => section.name === 'deepseekeyes:mcp-applications'), false)

  const denied = await root.tools.execute({
    callId: 'agentless-mcp-call',
    name: toolName,
    arguments: { query: 'must-not-run' },
    signal: new AbortController().signal,
  })
  assert.equal(denied.isError, true)
  assert.match(denied.error.message, /agentless execution is denied/)
  assert.equal(factory.state.calls.length, 0)

  const allowed = await root.tools.execute({
    callId: 'eyes-mcp-call',
    name: toolName,
    arguments: { query: 'verified' },
    agent: eyes.agent,
    signal: new AbortController().signal,
  })
  assert.equal(allowed.isError, false)
  assert.equal(factory.state.calls.length, 1)

  await manager.stop()
  for (const item of [switchedToEyes, switchedAway, text, eyes]) await item.scope.dispose()
  await toolsFiber.dispose()
  await systemPromptFiber.dispose()
})

test('real DSH ToolRuntime isolates MCP schemas in native, code, and both presentation modes', async () => {
  for (const mode of ['native', 'code', 'both']) {
    const root = new Context()
    const systemPromptFiber = root.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: '' })
    await systemPromptFiber
    const disposeCodeRuntime = root.provide('codeRuntime', { language: 'typescript' })
    const toolsFiber = root.plugin(ToolRuntime, { mode })
    await toolsFiber
    const disposeOrdinary = root.tools.register({
      name: 'ordinary_lookup',
      description: 'Ordinary non-MCP fixture',
      parameters: { type: 'object', additionalProperties: false },
      output: {
        schema: { type: 'object', additionalProperties: false },
        render() { return [{ type: 'text', text: 'ordinary' }] },
      },
      async execute() { return {} },
    })
    const manager = new McpManager(
      root,
      config({}, { allowedTools: ['search'] }),
      {
        adapterFactory: fakeFactory([tools[0]]),
        loadDshTools: loadSourceDshTools,
      },
    )
    await manager.start()

    const makeAgent = (id, provider) => {
      const agent = { id, options: { provider }, session: {} }
      const scope = createScope(root, agent)
      agent.ctx = scope.ctx
      return { agent, scope }
    }
    const eyes = makeAgent(`eyes-${mode}`, 'deepseekeyes')
    const text = makeAgent(`text-${mode}`, 'text-provider')
    const assemble = agent => root.systemPrompt.assemble({ agent, scope: agent })
    const eyesAssembly = await assemble(eyes.agent)
    const textAssembly = await assemble(text.agent)
    const mcpName = 'mcp__fixture__search'

    assert.match(JSON.stringify(eyesAssembly), new RegExp(mcpName), `${mode} must retain Eyes MCP schema`)
    assert.doesNotMatch(
      JSON.stringify(textAssembly),
      new RegExp(mcpName),
      `${mode} must remove MCP native and SDK schema outside Eyes`,
    )
    assert.match(JSON.stringify(textAssembly), /ordinary_lookup/, `${mode} must retain another plugin's schema`)
    assert.equal(
      textAssembly.sections.some(section => section.name === 'deepseekeyes:mcp-applications'),
      false,
    )
    if (mode === 'native') {
      assert.deepEqual(textAssembly.tools.map(tool => tool.name), ['ordinary_lookup'])
    } else if (mode === 'code') {
      assert.deepEqual(textAssembly.tools.map(tool => tool.name), ['run_code'])
      assert.match(textAssembly.sections.find(section => section.name === 'tools:sdk').text, /ordinary_lookup/)
    } else {
      assert.deepEqual(textAssembly.tools.map(tool => tool.name).sort(), ['ordinary_lookup', 'run_code'])
      assert.match(textAssembly.sections.find(section => section.name === 'tools:sdk').text, /ordinary_lookup/)
    }

    await text.scope.dispose()
    await eyes.scope.dispose()
    await manager.stop()
    disposeOrdinary()
    await toolsFiber.dispose()
    await disposeCodeRuntime()
    await systemPromptFiber.dispose()
  }
})

test('real DSH Code Mode ferries every MCP marker and image attachment through run_code contexts', async () => {
  const root = new Context()
  const attachments = new MockAttachments()
  const ctx = root.extend({ attachments })
  const systemPromptFiber = ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: '' })
  await systemPromptFiber
  const disposeCodeRuntime = ctx.provide('codeRuntime', {
    language: 'typescript',
    async run({ bindings }) {
      const functions = bindings[0].functions
      const text = await functions.mcp__fixture__search({ query: 'context' })
      const image = await functions.mcp__fixture__image({})
      let caughtFailure = false
      try {
        await functions.mcp__fixture__fails({})
      } catch {
        caughtFailure = true
      }
      return { logs: [], value: { text: text.sha256, image: image.sha256, caughtFailure } }
    },
  })
  const toolsFiber = ctx.plugin(ToolRuntime, { mode: 'code' })
  await toolsFiber
  const factory = fakeFactory([
    tools[0],
    { name: 'image', inputSchema: { type: 'object' } },
    { name: 'fails', inputSchema: { type: 'object' } },
  ])
  const manager = new McpManager(
    ctx,
    config({}, { allowedTools: ['search', 'image', 'fails'] }),
    { adapterFactory: factory, loadDshTools: loadSourceDshTools },
  )
  const events = []
  const agent = {
    id: 'eyes-code-context',
    options: { provider: 'deepseekeyes' },
    session: {
      append(name, value) { events.push({ name, value }) },
    },
  }
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx

  try {
    await manager.start()
    const outer = await ctx.tools.execute({
      callId: 'outer-code-context',
      name: 'run_code',
      arguments: { code: 'fixture', description: 'Read text and image through MCP' },
      agent,
      signal: new AbortController().signal,
    })

    assert.equal(outer.isError, false)
    assert.deepEqual(outer.content.map(block => block.type), ['text'])
    assert.equal(outer.additionalContexts.length, 3, 'successful and caught-failure sub-calls all carry a marker')
    const [textContext, imageContext, failureContext] = outer.additionalContexts
    for (const context of outer.additionalContexts) {
      assert.equal(context.role, 'user')
      assert.deepEqual(context.source, {
        kind: 'plugin',
        plugin: 'deepseekeyes',
        form: 'mcp-context',
        summary: context.source.summary,
      })
      assert.match(context.content[0].text, new RegExp(`^${MCP_RESULT_CONTEXT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    }
    assert.equal(textContext.content.some(block => block.type === 'image'), false)
    assert.match(textContext.content[0].text, /"tool":"mcp__fixture__search"/)
    assert.match(imageContext.content[0].text, /"tool":"mcp__fixture__image"/)
    assert.equal(imageContext.content[1].type, 'image')
    assert.deepEqual(imageContext.content[1].attachment, attachments.saved[0])
    assert.deepEqual(
      Buffer.from((await attachments.readImage(imageContext.content[1].attachment)).data),
      Buffer.from('png'),
    )
    assert.equal(JSON.stringify(outer.additionalContexts).includes(Buffer.from('png').toString('base64')), false)
    assert.match(failureContext.content[0].text, /"tool":"mcp__fixture__fails"/)
    assert.match(failureContext.content[0].text, /"status":"error"/)
    assert.match(failureContext.content[0].text, /"errorCode":"MCP_TOOL_CALL_FAILED"/)
    assert.match(failureContext.content[0].text, /"errorSha256":"[a-f0-9]{64}"/)
    assert.equal(failureContext.content.some(block => block.type === 'image'), false)
    assert.equal(JSON.stringify(failureContext).includes('secret-token'), false)
    const dispatches = events.filter(event => event.name === 'tool/code-dispatch')
    assert.equal(dispatches.length, 3)
    assert.equal(
      dispatches[1].value.content.some(block => block.type === 'image'),
      false,
      'Code Mode binding stays JSON-only; the one deferred MCP context owns the image',
    )
    assert.equal(dispatches[2].value.isError, true)

    const imageDefinition = ctx.tools.get('mcp__fixture__image', agent)
    let nativeDeferred = 0
    await imageDefinition.execute({}, {
      agent,
      signal: new AbortController().signal,
      deferContext() { nativeDeferred += 1 },
    })
    assert.equal(nativeDeferred, 0, 'a native result already renders its image and must not duplicate context')
    await assert.rejects(
      imageDefinition.execute({}, {
        agent,
        parent: Symbol('missing-host-channel'),
        signal: new AbortController().signal,
      }),
      error => error.code === 'MCP_RESULT_CONTEXT_UNAVAILABLE',
    )
  } finally {
    await manager.stop()
    await scope.dispose()
    await toolsFiber.dispose()
    await disposeCodeRuntime()
    await systemPromptFiber.dispose()
  }
})

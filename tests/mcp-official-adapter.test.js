import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  DshMcpClientAdapter,
  materializeDshMcpConfig,
  normalizeMcpConfig,
} from '../src/mcp/index.js'

const loadSourceMcpClient = () => import('@deepseek-ai/dsh-mcp-client')

function normalizedServer(overrides = {}) {
  return normalizeMcpConfig({
    mcpServers: [{
      id: 'fixture',
      transport: 'stdio',
      command: 'node',
      env: { TOKEN: { env: 'FIXTURE_TOKEN' } },
      ...overrides,
    }],
  }).mcpServers[0]
}

test('official adapter materializes credential references only at connection time', () => {
  const server = normalizedServer()
  const materialized = materializeDshMcpConfig(server, { FIXTURE_TOKEN: 'runtime-secret' })
  assert.equal(materialized.env.TOKEN, 'runtime-secret')
  assert.equal(JSON.stringify(server).includes('runtime-secret'), false)
  assert.throws(
    () => materializeDshMcpConfig(server, {}),
    error => error.code === 'MCP_CREDENTIAL_MISSING',
  )
})

test('official adapter captures DSH tool definitions without registering them globally', async () => {
  const effects = []
  const globalRegistrations = []
  let unregisterTool
  const ctx = {
    tools: { register(definition) { globalRegistrations.push(definition); return () => {} } },
    plugin(wrapper) {
      const child = {
        extend(meta) { return { ...this, ...meta } },
        effect(callback) { effects.push(callback()); return () => {} },
      }
      const promise = Promise.resolve(wrapper.apply(child))
      promise.dispose = async () => {
        for (const dispose of effects.splice(0).reverse()) await dispose?.()
      }
      return promise
    },
  }
  const fakePlugin = {
    inject: ['tools'],
    async apply(child, config) {
      assert.equal(config.serverName, 'fixture')
      unregisterTool = child.tools.register({
        name: 'mcp__fixture__search',
        description: 'Search',
        parameters: { type: 'object' },
        output: { schema: {} },
        async execute(args) { return { content: [{ type: 'text', text: args.query }] } },
      })
      child.effect(() => unregisterTool)
    },
  }
  const changed = []
  const adapter = new DshMcpClientAdapter(ctx, normalizedServer({ env: {} }), {
    loadPlugin: async () => fakePlugin,
    onToolsChanged(tools) { changed.push(tools) },
  })
  await adapter.start()
  await new Promise(resolve => queueMicrotask(resolve))
  const [tool] = await adapter.listTools()
  assert.equal(tool.rawName, 'search')
  assert.equal(tool.publicName, 'mcp__fixture__search')
  assert.equal(globalRegistrations.length, 0)
  assert.equal(changed.at(-1).length, 1)
  assert.deepEqual(await adapter.callTool(tool, { query: 'found' }), {
    content: [{ type: 'text', text: 'found' }],
  })
  assert.equal(adapter.connectionState().connected, true)
  unregisterTool()
  await new Promise(resolve => queueMicrotask(resolve))
  assert.equal(adapter.connectionState().connected, undefined, 'an empty replacement requires a real probe')
  assert.equal(adapter.connectionState().status, 'unknown')
  assert.equal(changed.at(-1).length, 0)
  adapter.reconcileProbe([])
  assert.equal(adapter.connectionState().connected, true, 'a matching live zero-tool probe restores health')
  assert.equal(adapter.connectionState().status, 'connected')
  await adapter.close()
  await new Promise(resolve => queueMicrotask(resolve))
  assert.equal(changed.at(-1).length, 0)
})

function syntheticPluginContext({ disposeError } = {}) {
  const effects = []
  return {
    plugin(wrapper) {
      const child = {
        extend(meta) { return { ...this, ...meta } },
        effect(callback) { effects.push(callback()); return () => {} },
      }
      const promise = Promise.resolve().then(() => wrapper.apply(child))
      promise.dispose = async () => {
        for (const dispose of effects.splice(0).reverse()) await dispose?.()
        if (disposeError !== undefined) throw disposeError
      }
      return promise
    },
  }
}

function isolatedProbeContext(state) {
  return {
    plugin(wrapper) {
      const effects = []
      const lifecycle = { serverName: undefined }
      const child = {
        lifecycle,
        extend(meta) { return { ...this, ...meta } },
        effect(callback) { effects.push(callback()); return () => {} },
      }
      const promise = Promise.resolve().then(() => wrapper.apply(child))
      let disposed = false
      promise.dispose = async () => {
        if (disposed) return
        const probe = lifecycle.serverName?.startsWith('probe_') === true
        if (probe) {
          state.probeCleanupAttempts += 1
          if (state.cleanupGate !== undefined) {
            const gate = state.cleanupGate
            state.cleanupGate = undefined
            gate.entered()
            await gate.wait
          }
          if (!state.allowProbeCleanup) throw new Error('probe cleanup fixture failure')
        }
        for (const dispose of effects.splice(0).reverse()) await dispose?.()
        disposed = true
      }
      return promise
    },
  }
}

function probeFixturePlugin(state) {
  return {
    inject: ['tools'],
    async apply(child, config) {
      child.lifecycle.serverName = config.serverName
      state.starts.push(config.serverName)
      const dispose = child.tools.register({
        name: `mcp__${config.serverName}__search`,
        description: 'Search',
        parameters: { type: 'object' },
        output: { schema: {} },
        async execute() { return { content: [] } },
      })
      child.effect(() => dispose)
    },
  }
}

function registeringPlugin(definitions) {
  return {
    inject: ['tools'],
    async apply(child) {
      const disposers = definitions.map(definition => child.tools.register({
        description: '',
        parameters: { type: 'object' },
        output: { schema: {} },
        async execute() { return { content: [] } },
        ...definition,
      }))
      child.effect(() => async () => {
        for (const dispose of disposers.reverse()) dispose()
      })
    },
  }
}

function hostileErrorCases(prefix) {
  let messageReads = 0
  let codeReads = 0
  const getter = {}
  Object.defineProperties(getter, {
    message: {
      get() {
        messageReads += 1
        throw new Error(`${prefix}-getter-secret`)
      },
    },
    code: {
      get() {
        codeReads += 1
        throw new Error(`${prefix}-code-secret`)
      },
    },
  })
  const revoked = Proxy.revocable(
    Object.assign(new Error(`${prefix}-revoked-secret`), { code: `${prefix}-revoked-code` }),
    {},
  )
  revoked.revoke()
  return {
    cases: [
      { name: 'throwing getters', error: getter },
      { name: 'revoked Proxy', error: revoked.proxy },
      {
        name: 'oversized secret text',
        error: Object.assign(
          new Error(`token=${prefix}-token ${'x'.repeat(2_000_000)} ${prefix}-tail-secret`),
          { code: `token=${prefix}-code-secret` },
        ),
      },
    ],
    reads() { return { messageReads, codeReads } },
  }
}

test('official adapter bounds and atomically rejects persistent catalog generations', async () => {
  const cases = [
    {
      name: 'tool count',
      limits: { maxTools: 2 },
      definitions: ['zeta', 'alpha', 'overflow'].map(name => ({ name: `mcp__fixture__${name}` })),
      code: 'MCP_CATALOG_TOOL_LIMIT',
    },
    {
      name: 'schema characters',
      limits: { maxSchemaChars: 80, maxSchemaBytes: 10_000 },
      definitions: [{ name: 'mcp__fixture__large', description: 'x'.repeat(200) }],
      code: 'MCP_CATALOG_SCHEMA_CHARS_LIMIT',
    },
    {
      name: 'schema bytes',
      limits: { maxSchemaChars: 10_000, maxSchemaBytes: 120 },
      definitions: [{ name: 'mcp__fixture__unicode', description: '眼'.repeat(100) }],
      code: 'MCP_CATALOG_SCHEMA_BYTES_LIMIT',
    },
  ]

  for (const entry of cases) {
    const changes = []
    const adapter = new DshMcpClientAdapter(
      syntheticPluginContext(),
      normalizedServer({ env: {} }),
      {
        loadPlugin: async () => registeringPlugin(entry.definitions),
        mcpCatalogLimits: entry.limits,
        onToolsChanged(tools) { changes.push(tools.map(tool => tool.publicName)) },
      },
    )
    await assert.rejects(adapter.start(), error => error.code === entry.code, entry.name)
    await new Promise(resolve => queueMicrotask(resolve))
    assert.deepEqual(await adapter.listTools(), [], `${entry.name} must roll back the whole generation`)
    assert.deepEqual(changes.at(-1), [], `${entry.name} must never publish a partial catalog`)
    assert.equal(adapter.connectionState().status, 'catalog-rejected')
    assert.equal(adapter.connectionState().error.code, entry.code)
    await adapter.close()
  }
})

test('official adapter keeps the bounded captured catalog deterministically sorted', async () => {
  const adapter = new DshMcpClientAdapter(
    syntheticPluginContext(),
    normalizedServer({ env: {} }),
    {
      loadPlugin: async () => registeringPlugin([
        { name: 'mcp__fixture__zeta' },
        { name: 'mcp__fixture__alpha' },
      ]),
    },
  )
  await adapter.start()
  assert.deepEqual(
    (await adapter.listTools()).map(tool => tool.rawName),
    ['alpha', 'zeta'],
  )
  await adapter.close()
})

test('official adapter revokes capture before surfacing a transport cleanup failure', async () => {
  const adapter = new DshMcpClientAdapter(
    syntheticPluginContext({ disposeError: new Error('fixture close failed') }),
    normalizedServer({ env: {} }),
    {
      loadPlugin: async () => registeringPlugin([{ name: 'mcp__fixture__search' }]),
    },
  )
  await adapter.start()
  const [tool] = await adapter.listTools()
  await assert.rejects(adapter.close(), error => error.code === 'MCP_ADAPTER_CLOSE_FAILED')
  assert.deepEqual(await adapter.listTools(), [])
  assert.equal(adapter.connectionState().connected, false)
  assert.equal(adapter.connectionState().status, 'cleanup-failed')
  await assert.rejects(
    adapter.callTool(tool, {}),
    error => error.code === 'MCP_TOOL_UNAVAILABLE',
  )
})

test('official adapter normalizes hostile startup errors before persistence and status projection', async () => {
  const hostile = hostileErrorCases('startup')
  for (const entry of hostile.cases) {
    const adapter = new DshMcpClientAdapter(
      syntheticPluginContext(),
      normalizedServer({ env: {} }),
      {
        loadPlugin: async () => ({
          inject: [],
          apply() { throw entry.error },
        }),
      },
    )
    await assert.rejects(
      adapter.start(),
      error => error.name === 'DeepSeekEyesError'
        && error.code === 'MCP_CONNECT_FAILED'
        && error.message.length <= 500,
      entry.name,
    )
    const state = adapter.connectionState()
    assert.equal(state.status, 'error')
    assert.equal(state.error.code, 'MCP_CONNECT_FAILED')
    assert.equal(Object.isFrozen(state.error), true)
    const serialized = JSON.stringify(state)
    assert.equal(serialized.includes('startup-getter-secret'), false)
    assert.equal(serialized.includes('startup-code-secret'), false)
    assert.equal(serialized.includes('startup-revoked-secret'), false)
    assert.equal(serialized.includes('startup-token'), false)
    assert.equal(serialized.includes('startup-tail-secret'), false)
    await adapter.close()
  }
  assert.deepEqual(hostile.reads(), { messageReads: 1, codeReads: 0 })
})

test('official adapter bounds and redacts hostile cleanup errors before status persistence', async () => {
  const hostile = hostileErrorCases('cleanup')
  for (const entry of hostile.cases) {
    const adapter = new DshMcpClientAdapter(
      syntheticPluginContext({ disposeError: entry.error }),
      normalizedServer({ env: {} }),
      { loadPlugin: async () => registeringPlugin([{ name: 'mcp__fixture__search' }]) },
    )
    await adapter.start()
    await assert.rejects(
      adapter.close(),
      error => error.name === 'DeepSeekEyesError'
        && error.code === 'MCP_ADAPTER_CLOSE_FAILED'
        && error.message.length < 700,
      entry.name,
    )
    const state = adapter.connectionState()
    assert.equal(state.status, 'cleanup-failed')
    assert.equal(state.error.code, 'MCP_ADAPTER_CLOSE_FAILED')
    assert.equal(Object.isFrozen(state.error), true)
    const serialized = JSON.stringify(state)
    assert.equal(serialized.includes('cleanup-getter-secret'), false)
    assert.equal(serialized.includes('cleanup-code-secret'), false)
    assert.equal(serialized.includes('cleanup-revoked-secret'), false)
    assert.equal(serialized.includes('cleanup-token'), false)
    assert.equal(serialized.includes('cleanup-tail-secret'), false)
  }
  assert.deepEqual(hostile.reads(), { messageReads: 1, codeReads: 0 })
})

test('official adapter bounds a hostile persistent error code before redaction', async () => {
  const adapter = new DshMcpClientAdapter(
    syntheticPluginContext(),
    normalizedServer({ env: {} }),
    { loadPlugin: async () => registeringPlugin([]) },
  )
  const secret = 'persistent-code-secret'
  adapter.captureChanged([], {
    error: Object.assign(new Error('catalog failed'), {
      code: `${'C'.repeat(1_000_000)}token=${secret}`,
    }),
  })
  const state = adapter.connectionState()
  assert.equal(state.status, 'catalog-rejected')
  assert.ok(state.error.code.length <= 100)
  assert.equal(state.error.code.includes(secret), false)
  await adapter.close()
})

test('official adapter retains failed probe cleanup and blocks new probe transports until retry succeeds', async () => {
  let releaseCleanup
  let cleanupEntered
  const state = {
    starts: [],
    probeCleanupAttempts: 0,
    allowProbeCleanup: false,
    cleanupGate: {
      entered: () => cleanupEntered(),
      wait: new Promise(resolve => { releaseCleanup = resolve }),
    },
  }
  const entered = new Promise(resolve => { cleanupEntered = resolve })
  const reported = []
  const adapter = new DshMcpClientAdapter(
    isolatedProbeContext(state),
    normalizedServer({ env: {} }),
    {
      loadPlugin: async () => probeFixturePlugin(state),
      onProbeCleanupFailure(handle, error) { reported.push({ handle, error }) },
    },
  )
  await adapter.start()

  const firstProbe = adapter.probe()
  await entered
  assert.equal(state.starts.filter(name => name.startsWith('probe_')).length, 1)
  releaseCleanup()
  await assert.rejects(firstProbe, error => error.code === 'MCP_ADAPTER_CLOSE_FAILED')
  assert.equal(reported.length, 1)
  assert.equal(typeof reported[0].handle.close, 'function')
  assert.equal(adapter.connectionState().probeCleanupFailures, 1)
  assert.equal(adapter.connectionState().status, 'cleanup-failed')
  assert.equal(adapter.connectionState().connected, false)

  await assert.rejects(adapter.probe(), error => error.code === 'MCP_ADAPTER_CLOSE_FAILED')
  assert.equal(
    state.starts.filter(name => name.startsWith('probe_')).length,
    1,
    'a repeated probe must retry cleanup before allocating another child transport',
  )
  assert.equal(state.probeCleanupAttempts, 2)

  state.allowProbeCleanup = true
  await reported[0].handle.close()
  assert.equal(adapter.connectionState().probeCleanupFailures, 0)
  assert.equal(adapter.connectionState().status, 'connected')
  assert.equal(adapter.connectionState().connected, true)
  const tools = await adapter.probe()
  assert.deepEqual(tools.map(tool => tool.publicName), ['mcp__fixture__search'])
  assert.equal(state.starts.filter(name => name.startsWith('probe_')).length, 2)
  assert.equal(state.probeCleanupAttempts, 4)
  await adapter.close()
})

test('official adapter runs capture through a real Cordis child fiber and disposes its effects', async () => {
  const root = new Context()
  const globalDefinitions = new Map()
  const ctx = root.extend({
    tools: {
      register(definition) {
        globalDefinitions.set(definition.name, definition)
        return () => globalDefinitions.delete(definition.name)
      },
    },
  })
  let activationFinished = false
  let disposed = false
  const fakePlugin = {
    inject: [],
    async apply(child) {
      await Promise.resolve()
      const dispose = child.tools.register({
        name: 'mcp__fixture__fiber_check',
        parameters: { type: 'object' },
        output: { schema: {} },
        async execute() { return { content: [{ type: 'text', text: 'fiber-ok' }] } },
      })
      child.effect(() => () => {
        disposed = true
        dispose()
      })
      activationFinished = true
    },
  }
  const changes = []
  const adapter = new DshMcpClientAdapter(ctx, normalizedServer({ env: {} }), {
    loadPlugin: async () => fakePlugin,
    onToolsChanged(tools) { changes.push(tools.map(tool => tool.publicName)) },
  })
  await adapter.start()
  await new Promise(resolve => queueMicrotask(resolve))
  assert.equal(activationFinished, true, 'adapter.start() must await the child fiber')
  assert.deepEqual((await adapter.listTools()).map(tool => tool.publicName), ['mcp__fixture__fiber_check'])
  assert.equal(globalDefinitions.size, 0, 'capture registry must shadow the host tool registry')
  await adapter.close()
  await new Promise(resolve => queueMicrotask(resolve))
  assert.equal(disposed, true)
  assert.deepEqual(changes.at(-1), [])
})

test('official DSH MCP client connects through stdio, discovers, calls, and disposes a real MCP server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-real-mcp-'))
  const script = join(directory, 'server.mjs')
  const sdkServer = import.meta.resolve('@modelcontextprotocol/sdk/server/index.js')
  const sdkStdio = import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js')
  const sdkTypes = import.meta.resolve('@modelcontextprotocol/sdk/types.js')
  await writeFile(script, `
import { Server } from ${JSON.stringify(sdkServer)}
import { StdioServerTransport } from ${JSON.stringify(sdkStdio)}
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(sdkTypes)}

const server = new Server(
  { name: 'deepseekeyes-test', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'echo',
    description: 'Echo one value',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  }],
}))
server.setRequestHandler(CallToolRequestSchema, async request => ({
  content: [{ type: 'text', text: 'echo:' + request.params.arguments.text }],
}))
await server.connect(new StdioServerTransport())
`, { mode: 0o600 })

  const root = new Context()
  const globalDefinitions = new Map()
  const disposeTools = root.provide('tools', {
    register(definition) {
      globalDefinitions.set(definition.name, definition)
      return () => globalDefinitions.delete(definition.name)
    },
  })
  const server = normalizedServer({ command: process.execPath, args: [script], env: {} })
  const adapter = new DshMcpClientAdapter(root, server, { loadPlugin: loadSourceMcpClient })
  try {
    await adapter.start()
    const discovered = await adapter.listTools()
    assert.equal(discovered.length, 1)
    assert.equal(discovered[0].rawName, 'echo')
    assert.equal(globalDefinitions.size, 0)
    const result = await adapter.callTool(discovered[0], { text: 'verified' }, {
      signal: new AbortController().signal,
    })
    assert.deepEqual(result.content, [{ type: 'text', text: 'echo:verified' }])

    const probed = await adapter.probe()
    assert.equal(probed.length, 1)
    assert.equal(probed[0].rawName, 'echo')
    assert.equal(probed[0].publicName, 'mcp__fixture__echo')
    assert.equal(adapter.connectionState().connected, true)

    const refreshed = await adapter.refresh()
    assert.equal(refreshed.length, 1)
    assert.equal(refreshed[0].rawName, 'echo')
    assert.equal(adapter.connectionState().connected, true)
    assert.deepEqual(
      (await adapter.callTool(refreshed[0], { text: 'after-refresh' }, {
        signal: new AbortController().signal,
      })).content,
      [{ type: 'text', text: 'echo:after-refresh' }],
    )
  } finally {
    await adapter.close()
    await disposeTools()
    await rm(directory, { recursive: true, force: true })
  }
  assert.deepEqual(await adapter.listTools(), [])
})

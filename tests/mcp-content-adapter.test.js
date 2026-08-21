import assert from 'node:assert/strict'
import test from 'node:test'
import {
  McpContentAdapter,
  mcpPromptResult,
  mcpResourceResult,
  normalizeMcpConfig,
} from '../src/mcp/index.js'

function server(overrides = {}) {
  return normalizeMcpConfig({
    mcpServers: [{
      id: 'content',
      transport: 'stdio',
      command: 'node',
      toolsEnabled: false,
      resourcesEnabled: true,
      promptsEnabled: true,
      allowedResources: ['notes://welcome'],
      allowedPrompts: ['summarize'],
      ...overrides,
    }],
  }).mcpServers[0]
}

function fakeSdk({ capabilities = { resources: {}, prompts: {} } } = {}) {
  const state = { clients: [], transports: [] }
  class Transport {
    constructor(options) {
      this.options = options
      state.transports.push(this)
    }
  }
  class Client {
    constructor() {
      this.closed = false
      state.clients.push(this)
    }

    async connect(transport) { this.transport = transport }
    getServerCapabilities() { return capabilities }
    async listResources(params) {
      return params.cursor === undefined
        ? { resources: [{ uri: 'notes://welcome', name: 'Welcome', mimeType: 'text/plain' }], nextCursor: 'r2' }
        : { resources: [{ uri: 'image://chart', name: 'Chart', mimeType: 'image/png' }] }
    }
    async listResourceTemplates() {
      return { resourceTemplates: [{ uriTemplate: 'notes://{slug}', name: 'Note' }] }
    }
    async listPrompts() {
      return { prompts: [{ name: 'summarize', arguments: [{ name: 'style', required: false }] }] }
    }
    async readResource({ uri }) {
      return { contents: [{ uri, mimeType: 'text/plain', text: 'hello' }] }
    }
    async getPrompt({ name, arguments: args }) {
      return { description: name, messages: [{ role: 'user', content: { type: 'text', text: args.style } }] }
    }
    async close() {
      this.closed = true
      this.onclose?.()
    }
  }
  return {
    sdk: {
      Client,
      StdioClientTransport: Transport,
      StreamableHTTPClientTransport: Transport,
    },
    state,
  }
}

test('content adapter connects before guarded catalog discovery and closes deliberately', async () => {
  const fixture = fakeSdk()
  const changes = []
  const adapter = new McpContentAdapter({}, server(), {
    loadSdk: async () => fixture.sdk,
    onChanged(catalog, state) { changes.push({ catalog, state }) },
  })

  await adapter.start()
  assert.equal(adapter.state().status, 'connected')
  assert.equal(adapter.state().resourceCount, 2)
  assert.equal(adapter.state().resourceTemplateCount, 1)
  assert.equal(adapter.state().promptCount, 1)
  assert.equal(changes.some(change => change.state.reason === 'refreshed'), true)
  assert.deepEqual(mcpResourceResult(await adapter.readResource('notes://welcome')), {
    content: [{ type: 'text', text: '[MCP resource notes://welcome; text/plain]\nhello' }],
  })
  assert.deepEqual(mcpPromptResult(await adapter.getPrompt('summarize', { style: 'short' })), {
    content: [
      { type: 'text', text: '[MCP prompt description]\nsummarize' },
      { type: 'text', text: '[MCP prompt user]\nshort' },
    ],
  })

  await adapter.close()
  assert.equal(adapter.state().status, 'closed')
  assert.equal(adapter.state().resourceCount, 0)
  assert.equal(changes.at(-1).state.reason, 'closed')
})

test('content adapter keeps startup failures in the error state after transport close', async () => {
  const fixture = fakeSdk({ capabilities: { resources: {} } })
  const adapter = new McpContentAdapter({}, server(), { loadSdk: async () => fixture.sdk })

  await assert.rejects(adapter.start(), error => error?.code === 'MCP_PROMPTS_UNSUPPORTED')
  assert.equal(adapter.state().status, 'error')
  assert.equal(adapter.state().error.code, 'MCP_PROMPTS_UNSUPPORTED')
  assert.equal(fixture.state.clients[0].closed, true)
})

test('content adapter retains a failed close handle until cleanup succeeds', async () => {
  const fixture = fakeSdk()
  const changes = []
  const adapter = new McpContentAdapter({}, server(), {
    loadSdk: async () => fixture.sdk,
    onChanged(_catalog, state) { changes.push(state) },
  })
  await adapter.start()
  const client = fixture.state.clients[0]
  let attempts = 0
  client.close = async () => {
    attempts += 1
    if (attempts === 1) {
      throw Object.assign(new Error('close transport failed'), { code: 'MCP_CONTENT_CLOSE_FAILED' })
    }
    client.closed = true
    client.onclose?.()
  }

  await assert.rejects(adapter.close(), error => error?.code === 'MCP_CONTENT_CLOSE_FAILED')
  assert.equal(adapter.state().status, 'cleanup-failed')
  assert.equal(changes.at(-1).reason, 'cleanup-failed')
  await adapter.close()
  assert.equal(attempts, 2)
  assert.equal(client.closed, true)
  assert.equal(adapter.state().status, 'closed')
  assert.equal(changes.at(-1).reason, 'closed')
})

test('content result adapters preserve text, image and embedded binary resource types', () => {
  assert.deepEqual(mcpResourceResult({ contents: [
    { uri: 'image://a', mimeType: 'image/png', blob: 'AAAA' },
    { uri: 'bin://a', mimeType: 'application/octet-stream', blob: 'AQI=' },
  ] }), {
    content: [
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      {
        type: 'resource',
        resource: { uri: 'bin://a', mimeType: 'application/octet-stream', blob: 'AQI=' },
      },
    ],
  })
  assert.deepEqual(mcpPromptResult({ messages: [{
    role: 'assistant',
    content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
  }] }), {
    content: [
      { type: 'text', text: '[MCP prompt assistant]' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ],
  })
})

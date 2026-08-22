import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  McpContentAdapter,
  McpOAuthClientAdapter,
  McpOAuthSession,
  McpOAuthSessionRegistry,
  normalizeMcpConfig,
} from '../src/mcp/index.js'
import { resolveConfig } from '../src/config.js'

function oauthServer(overrides = {}) {
  return normalizeMcpConfig({
    mcpServers: [{
      id: 'remote-oauth',
      name: 'Remote OAuth',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
      toolsEnabled: true,
      resourcesEnabled: true,
      promptsEnabled: true,
      oauth: {
        enabled: true,
        clientId: { env: 'FIXTURE_OAUTH_CLIENT_ID' },
        clientSecret: { env: 'FIXTURE_OAUTH_CLIENT_SECRET' },
        scope: 'mcp:read',
      },
      ...overrides,
    }],
  }).mcpServers[0]
}

test('OAuth configuration is env-reference-only, disabled by default, and rejects header collisions', () => {
  const base = resolveConfig({ mcpServers: [] }, {}, '/tmp')
  assert.deepEqual(base.mcpServers, [])
  const server = resolveConfig({ mcpServers: [
    {
      id: 'oauth',
      name: 'OAuth',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
      oauth: {
        enabled: true,
        clientId: { env: 'CLIENT_ID' },
        clientSecret: { env: 'CLIENT_SECRET' },
      },
    },
  ] }, {}, '/tmp').mcpServers[0]
  assert.equal(server.oauth.enabled, true)
  assert.deepEqual(server.oauth.clientId, { env: 'CLIENT_ID' })
  assert.equal(JSON.stringify(server).includes('CLIENT_SECRET_VALUE'), false)
  assert.throws(
    () => resolveConfig({ mcpServers: [{
      ...server,
      headers: { Authorization: { env: 'STATIC_AUTH' } },
    }] }, {}, '/tmp'),
    /cannot be combined with an Authorization header/,
  )
})

test('OAuth client credentials discovers protected-resource and authorization-server metadata', async () => {
  let tokenCalls = 0
  const calls = []
  const session = new McpOAuthSession(oauthServer(), {
    FIXTURE_OAUTH_CLIENT_ID: 'fixture-client',
    FIXTURE_OAUTH_CLIENT_SECRET: 'fixture-secret',
  }, { now: () => 1_700_000_000_000 })
  const fetchFn = async (input, init = {}) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/.well-known/oauth-protected-resource')) {
      return new Response(JSON.stringify({
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://auth.example.test'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === 'https://auth.example.test/.well-known/oauth-authorization-server'
      || url === 'https://mcp.example.test/.well-known/oauth-authorization-server') {
      return new Response(JSON.stringify({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        response_types_supported: ['code'],
        grant_types_supported: ['client_credentials'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === 'https://auth.example.test/token') {
      tokenCalls += 1
      assert.equal(init.method, 'POST')
      assert.match(new Headers(init.headers).get('authorization'), /^Basic /)
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('grant_type'), 'client_credentials')
      assert.equal(body.get('scope'), 'mcp:read')
      return new Response(JSON.stringify({
        access_token: 'fixture-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp:read',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected OAuth URL ${url}`)
  }
  assert.equal(await auth(session.provider, {
    serverUrl: 'https://mcp.example.test/mcp',
    fetchFn,
  }), 'AUTHORIZED')
  assert.equal(tokenCalls, 1)
  assert.equal(calls.some(url => url.includes('oauth-protected-resource')), true)
  assert.equal(calls.some(url => url.includes('oauth-authorization-server')), true)
  assert.equal(session.health().authenticated, true)
  assert.equal(session.health().status, 'authenticated')
  assert.equal(JSON.stringify(session.health()).includes('fixture-access-token'), false)
})

function fakeOAuthSdk(state) {
  class Transport {
    constructor(url, options) {
      this.url = url
      this.options = options
      state.transports.push(this)
    }
    async close() {}
  }
  class Client {
    constructor() { state.clients.push(this) }
    setNotificationHandler(_schema, handler) { state.notificationHandlers.push(handler) }
    async connect(transport) { this.transport = transport }
    async request(request) {
      if (request.method === 'tools/list') {
        return { tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] }
      }
      if (request.method === 'tools/call') {
        return { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] }
      }
      throw new Error(`unexpected method ${request.method}`)
    }
    getServerCapabilities() { return { resources: {}, prompts: {} } }
    async listResources() { return { resources: [] } }
    async listResourceTemplates() { return { resourceTemplates: [] } }
    async listPrompts() { return { prompts: [] } }
    async close() { this.onclose?.() }
  }
  const passthrough = { parse(value) { return value } }
  return {
    Client,
    StreamableHTTPClientTransport: Transport,
    StdioClientTransport: Transport,
    ListToolsResultSchema: passthrough,
    CallToolResultSchema: passthrough,
    ToolListChangedNotificationSchema: passthrough,
  }
}

test('Tools and Content use one shared process-local OAuth provider and bearer transport option', async () => {
  const server = oauthServer({ resourcesEnabled: false, promptsEnabled: false })
  const environment = {
    FIXTURE_OAUTH_CLIENT_ID: 'fixture-client',
    FIXTURE_OAUTH_CLIENT_SECRET: 'fixture-secret',
  }
  const registry = new McpOAuthSessionRegistry()
  const state = { clients: [], transports: [], notificationHandlers: [] }
  const loadSdk = async () => fakeOAuthSdk(state)
  const toolAdapter = new McpOAuthClientAdapter({}, server, {
    environment,
    oauthSessions: registry,
    loadSdk,
  })
  await toolAdapter.start()
  const contentServer = { ...server, resourcesEnabled: true }
  const content = new McpContentAdapter({}, contentServer, {
    environment,
    oauthSessions: registry,
    loadSdk,
  })
  await content.start()
  assert.equal(state.transports.length, 2)
  assert.equal(state.transports[0].options.authProvider, state.transports[1].options.authProvider)
  const [tool] = await toolAdapter.listTools()
  assert.deepEqual(await toolAdapter.callTool(tool, { q: 'eyes' }), {
    content: [{ type: 'text', text: '{"q":"eyes"}' }],
  })
  assert.equal(toolAdapter.connectionState().oauth.enabled, true)
  await content.close()
  await toolAdapter.close()
})

test('OAuth adapter rejects a stale changed catalog before issuing tools/call', async () => {
  const server = oauthServer({ resourcesEnabled: false, promptsEnabled: false })
  const state = { catalog: 'Read', calls: 0 }
  class FakeTransport {
    constructor() {}
    async close() {}
  }
  class FakeClient {
    async connect() {}
    async request(request) {
      if (request.method === 'tools/list') {
        return {
          tools: [{
            name: 'search',
            description: state.catalog,
            inputSchema: { type: 'object' },
          }],
        }
      }
      if (request.method === 'tools/call') {
        state.calls += 1
        return { content: [{ type: 'text', text: 'unexpected dispatch' }] }
      }
      throw new Error(`unexpected method ${request.method}`)
    }
    async close() {}
  }
  const passthrough = { parse(value) { return value } }
  const adapter = new McpOAuthClientAdapter({}, server, {
    environment: {
      FIXTURE_OAUTH_CLIENT_ID: 'fixture-client',
      FIXTURE_OAUTH_CLIENT_SECRET: 'fixture-secret',
    },
    loadSdk: async () => ({
      Client: FakeClient,
      StreamableHTTPClientTransport: FakeTransport,
      ListToolsResultSchema: passthrough,
      CallToolResultSchema: passthrough,
    }),
  })
  await adapter.start()
  const [stale] = await adapter.listTools()
  state.catalog = 'Write'
  await adapter.refresh()
  await assert.rejects(
    adapter.callTool(stale, {}),
    error => error.code === 'MCP_TOOL_UNAVAILABLE',
  )
  assert.equal(state.calls, 0)
  await adapter.close()
})

test('OAuth adapter rechecks catalog identity after the SDK load boundary', async () => {
  const server = oauthServer({ resourcesEnabled: false, promptsEnabled: false })
  const state = { catalog: 'Read', calls: 0 }
  let deferNextLoad = false
  let releaseLoad
  class FakeTransport {
    constructor() {}
    async close() {}
  }
  class FakeClient {
    async connect() {}
    async request(request) {
      if (request.method === 'tools/list') {
        return {
          tools: [{
            name: 'search',
            description: state.catalog,
            inputSchema: { type: 'object' },
          }],
        }
      }
      if (request.method === 'tools/call') {
        state.calls += 1
        return { content: [{ type: 'text', text: 'unexpected dispatch' }] }
      }
      throw new Error(`unexpected method ${request.method}`)
    }
    async close() {}
  }
  const passthrough = { parse(value) { return value } }
  const sdk = {
    Client: FakeClient,
    StreamableHTTPClientTransport: FakeTransport,
    ListToolsResultSchema: passthrough,
    CallToolResultSchema: passthrough,
  }
  const adapter = new McpOAuthClientAdapter({}, server, {
    environment: {
      FIXTURE_OAUTH_CLIENT_ID: 'fixture-client',
      FIXTURE_OAUTH_CLIENT_SECRET: 'fixture-secret',
    },
    loadSdk: async () => {
      if (deferNextLoad) {
        deferNextLoad = false
        await new Promise(resolve => { releaseLoad = resolve })
      }
      return sdk
    },
  })
  await adapter.start()
  const [stale] = await adapter.listTools()
  deferNextLoad = true
  const call = adapter.callTool(stale, {})
  for (let attempt = 0; attempt < 20 && releaseLoad === undefined; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve))
  }
  state.catalog = 'Write'
  await adapter.refresh()
  releaseLoad()
  await assert.rejects(call, error => error.code === 'MCP_TOOL_UNAVAILABLE')
  assert.equal(state.calls, 0)
  await adapter.close()
})

/**
 * A real loopback Streamable HTTP server used to exercise the SDK's complete
 * 401 -> discovery -> client_credentials -> retry path. The server deliberately
 * expires and rejects tokens so this test proves refresh rather than only
 * checking that an authProvider option was passed to the transport.
 */
async function createOAuthMcpServer() {
  const state = {
    tokenCalls: 0,
    requests: [],
    forced401: false,
  }
  const sockets = new Set()
  const readBody = async request => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  }
  const json = (response, status, value, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers })
    response.end(JSON.stringify(value))
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      json(response, 200, {
        resource: state.endpoint,
        authorization_servers: [state.origin],
      })
      return
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json(response, 200, {
        issuer: state.origin,
        authorization_endpoint: `${state.origin}/authorize`,
        token_endpoint: `${state.origin}/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['client_credentials'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      })
      return
    }
    if (url.pathname === '/oauth/token') {
      const body = new URLSearchParams(await readBody(request))
      assert.equal(body.get('grant_type'), 'client_credentials')
      assert.equal(body.get('scope'), 'mcp:read')
      const authorization = request.headers.authorization ?? ''
      const clientPost = body.get('client_id') === 'fixture-client'
        && body.get('client_secret') === 'fixture-secret'
      const clientBasic = authorization === `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`
      assert.equal(clientBasic || clientPost, true, 'OAuth credentials must use one configured client authentication method')
      state.tokenCalls += 1
      json(response, 200, {
        access_token: `fixture-token-${state.tokenCalls}`,
        token_type: 'Bearer',
        expires_in: 1,
        scope: 'mcp:read',
      })
      return
    }
    if (url.pathname !== '/mcp') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'GET' || request.method === 'DELETE') {
      response.writeHead(405, { allow: 'POST' }).end()
      return
    }
    const body = JSON.parse(await readBody(request))
    const messages = Array.isArray(body) ? body : [body]
    const methods = messages.map(message => message?.method).filter(Boolean)
    state.requests.push({ methods, authorization: request.headers.authorization })
    const authorization = request.headers.authorization
    const validToken = authorization === 'Bearer fixture-token-1'
      || authorization === 'Bearer fixture-token-2'
      || authorization === 'Bearer fixture-token-3'
    const force401 = state.forced401 && methods.includes('tools/call') && authorization === 'Bearer fixture-token-1'
    if (!validToken || force401) {
      response.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${state.origin}/.well-known/oauth-protected-resource/mcp"`,
      }).end()
      return
    }
    const protocol = new McpServer(
      { name: 'deepseekeyes-oauth-fixture', version: '1.0.0' },
      { capabilities: { tools: { listChanged: true } } },
    )
    protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'echo',
        description: 'OAuth echo',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      }],
    }))
    protocol.setRequestHandler(CallToolRequestSchema, async requestValue => ({
      content: [{ type: 'text', text: `oauth-echo:${requestValue.params.arguments?.text ?? ''}` }],
    }))
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    try {
      await protocol.connect(transport)
      await transport.handleRequest(request, response, body)
    } finally {
      await protocol.close()
    }
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  state.origin = origin
  state.endpoint = `${origin}/mcp`
  return {
    url: state.endpoint,
    state,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(() => resolve()))
    },
  }
}

test('OAuth Streamable HTTP refreshes on an expired or rejected bearer token and reacts to tool-list notifications', { timeout: 30_000 }, async () => {
  const fixture = await createOAuthMcpServer()
  let now = 1_700_000_000_000
  const server = oauthServer({ url: fixture.url })
  const state = { clients: [], transports: [], notificationHandlers: [] }
  class TrackingClient extends Client {
    constructor(...args) {
      super(...args)
      state.clients.push(this)
    }

    setNotificationHandler(schema, handler) {
      state.notificationHandlers.push(handler)
      return super.setNotificationHandler(schema, handler)
    }
  }
  const adapter = new McpOAuthClientAdapter({}, server, {
    now: () => now,
    environment: {
      FIXTURE_OAUTH_CLIENT_ID: 'fixture-client',
      FIXTURE_OAUTH_CLIENT_SECRET: 'fixture-secret',
    },
    loadSdk: async () => ({
      Client: TrackingClient,
      StreamableHTTPClientTransport,
      ListToolsResultSchema,
      CallToolResultSchema,
      ToolListChangedNotificationSchema,
    }),
  })
  try {
    await adapter.start()
    assert.equal(fixture.state.tokenCalls, 1, JSON.stringify(fixture.state))
    assert.ok(state.notificationHandlers.length >= 1)
    state.notificationHandlers.at(-1)({ method: 'notifications/tools/list_changed' })
    await new Promise(resolve => setImmediate(resolve))
    const [tool] = await adapter.listTools()
    fixture.state.forced401 = true
    assert.deepEqual(await adapter.callTool(tool, { text: 're-auth' }), {
      content: [{ type: 'text', text: 'oauth-echo:re-auth' }],
    })
    assert.equal(fixture.state.tokenCalls, 2)
    fixture.state.forced401 = false
    now += 2_000
    assert.deepEqual(await adapter.callTool(tool, { text: 'expired' }), {
      content: [{ type: 'text', text: 'oauth-echo:expired' }],
    })
    assert.equal(fixture.state.tokenCalls, 3)
    assert.equal(adapter.connectionState().oauth.authenticated, true)
  } finally {
    await adapter.close()
    await fixture.close()
  }
  assert.equal(fixture.state.requests.some(entry => entry.methods.includes('tools/call')), true)
})

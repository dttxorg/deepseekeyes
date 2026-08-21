import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageTracker } from '../src/usage.js'
import {
  createUsageRpcHandler,
  installUsageRpc,
  USAGE_RPC_CHANNEL,
} from '../src/usage-rpc.js'

test('usage RPC snapshots and resets only with explicit confirmation', async () => {
  const tracker = new UsageTracker({ file: undefined })
  await tracker.recordCall('s', 'visionBase', { inputTokens: 10, outputTokens: 2 })
  const handle = createUsageRpcHandler(tracker)
  let result = await handle('usage.snapshot', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.totals.derived.exactAdditionalTokens, 12)

  result = await handle('usage.reset', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')

  result = await handle('usage.reset', { confirm: true })
  assert.equal(result.ok, true)
  assert.equal(result.value.totals.derived.exactAdditionalTokens, 0)
  assert.equal((await handle('missing', {})).error.code, 'not-found')
})

test('usage RPC registers a loopback-only model-free channel', async () => {
  let registration
  const tracker = new UsageTracker({ file: undefined })
  const connectionCtx = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options }
          return () => Promise.resolve()
        },
      },
    },
  }
  const ctx = {
    inject(services, install) {
      assert.deepEqual(services, ['connection'])
      install(connectionCtx)
    },
  }
  installUsageRpc(ctx, tracker)
  assert.equal(registration.channel, USAGE_RPC_CHANNEL)
  assert.deepEqual(registration.options, { authority: 'loopback' })
  assert.equal((await registration.handler('usage.snapshot', {})).ok, true)
})

test('local RPC exposes bounded MCP status, connection test, refresh, and reconnect controls', async () => {
  const calls = []
  const mcp = {
    snapshot: () => ({ enabled: true, summary: { connectedServers: 1 } }),
    async health() {
      calls.push(['health'])
      return { enabled: true, summary: { connectedServers: 1 } }
    },
    async testConnection(serverId) {
      calls.push(['test', serverId])
      return { ok: true, serverId, toolCount: 2 }
    },
    async reconnect(serverId) {
      calls.push(['reconnect', serverId])
      return { enabled: true }
    },
    async listTools(serverId, options) {
      calls.push(['tools', serverId, options])
      return [{ name: 'read' }]
    },
    async listContent(serverId, options) {
      calls.push(['content', serverId, options])
      return { resources: [{ uri: 'notes://welcome' }], prompts: [] }
    },
  }
  const handle = createUsageRpcHandler(new UsageTracker({ file: undefined }), mcp)
  assert.equal((await handle('mcp.status', {})).value.summary.connectedServers, 1)
  assert.equal((await handle('mcp.test', { serverId: 'fixture' })).value.toolCount, 2)
  assert.equal((await handle('mcp.reconnect', { serverId: 'fixture' })).ok, true)
  assert.deepEqual(
    (await handle('mcp.tools', { serverId: 'fixture', refresh: true })).value,
    [{ name: 'read' }],
  )
  assert.deepEqual(
    (await handle('mcp.content', { serverId: 'fixture', refresh: true })).value,
    { resources: [{ uri: 'notes://welcome' }], prompts: [] },
  )
  assert.deepEqual(calls, [
    ['health'],
    ['test', 'fixture'],
    ['reconnect', 'fixture'],
    ['tools', 'fixture', { refresh: true }],
    ['content', 'fixture', { refresh: true }],
  ])
  assert.equal((await handle('mcp.test', {})).error.code, 'bad-request')
})

test('MCP status contains active health failures and retains snapshot compatibility', async () => {
  const tracker = new UsageTracker({ file: undefined })
  const failed = createUsageRpcHandler(tracker, {
    async health() { throw Object.assign(new Error('Bearer secret-token transport failed'), { code: 'PROBE_FAILED' }) },
  })
  const failure = await failed('mcp.status', {})
  assert.equal(failure.ok, false)
  assert.equal(failure.error.code, 'PROBE_FAILED')
  assert.equal(failure.error.message.includes('secret-token'), false)

  const legacy = createUsageRpcHandler(tracker, {
    snapshot() { return { enabled: true, summary: { connectedServers: 0 } } },
  })
  assert.equal((await legacy('mcp.status', {})).value.summary.connectedServers, 0)
})

test('MCP loopback RPC errors redact every credential form and retain code and path', async () => {
  const secrets = [
    'rpc-bearer-secret',
    'cnBjOnBhc3N3b3Jk',
    'rpc-cookie-secret',
    'rpc-api-secret',
    'rpc-json-token',
    'rpc-password-secret',
    'github_pat_rpcsecret123456',
    'rpc-digest-secret',
    'rpc-url-password',
  ]
  const cause = Object.assign(new Error([
    '[E_RPC_PROBE] request /var/run/deepseekeyes.sock failed',
    `Authorization: Bearer ${secrets[0]}`,
    `Proxy-Authorization: Basic ${secrets[1]}`,
    `Cookie: sid=${secrets[2]}`,
    `X-API-Key: ${secrets[3]}`,
    `{"token":"${secrets[4]}","password":"${secrets[5]}"}`,
    secrets[6],
    `Authorization: Digest username="rpc", nonce="n", response="${secrets[7]}"`,
    `https://rpc:${secrets[8]}@example.test/mcp`,
  ].join('\n')), { code: 'E_RPC_PROBE token=rpc-code-secret' })
  const tracker = new UsageTracker({ file: undefined })
  const handle = createUsageRpcHandler(tracker, {
    async health() { throw cause },
    async listTools() { throw cause },
  })

  for (const result of [
    await handle('mcp.status', {}),
    await handle('mcp.tools', { serverId: 'fixture', refresh: true }),
  ]) {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'E_RPC_PROBE token=[REDACTED]')
    assert.match(result.error.message, /\[E_RPC_PROBE\] request \/var\/run\/deepseekeyes\.sock failed/)
    assert.ok(result.error.message.length <= 500)
    for (const secret of secrets) assert.equal(result.error.message.includes(secret), false, secret)
    assert.equal(JSON.stringify(result.error).includes('rpc-code-secret'), false)
  }
})

test('MCP loopback RPC keeps ordinary error language readable', async () => {
  const message = '[E_CONFIG] /srv/token-cache: token budget=8192; password authentication failed; Basic authentication required'
  const handle = createUsageRpcHandler(new UsageTracker({ file: undefined }), {
    async health() { throw Object.assign(new Error(message), { code: 'E_CONFIG' }) },
  })
  const result = await handle('mcp.status', {})
  assert.equal(result.error.code, 'E_CONFIG')
  assert.equal(result.error.message, message)
})

test('MCP loopback RPC sanitizes non-Error transport failures', async () => {
  const handle = createUsageRpcHandler(new UsageTracker({ file: undefined }), {
    async health() {
      throw { code: 'E_OBJECT', message: 'probe failed at /tmp/mcp; Authorization: Bearer object-secret-123' }
    },
  })
  const result = await handle('mcp.status', {})
  assert.equal(result.error.code, 'E_OBJECT')
  assert.match(result.error.message, /probe failed at \/tmp\/mcp/)
  assert.equal(result.error.message.includes('object-secret-123'), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createTemporaryMcpHttpServer } from '../acceptance/helpers/temporary-mcp-http-server.mjs'
import {
  DshMcpClientAdapter,
  normalizeMcpConfig,
} from '../src/mcp/index.js'

const loadSourceMcpClient = () => import('@deepseek-ai/dsh-mcp-client')

test('official DSH MCP client completes the adapter lifecycle over real Streamable HTTP', { timeout: 30_000 }, async () => {
  const credentialName = 'DEEPSEEKEYES_HTTP_ACCEPTANCE_TOKEN'
  const credentialValue = 'loopback-acceptance-value'
  const fixture = await createTemporaryMcpHttpServer({
    requiredHeaders: { 'x-deepseekeyes-acceptance': credentialValue },
  })
  const root = new Context()
  const globalDefinitions = new Map()
  const disposeTools = root.provide('tools', {
    register(definition) {
      globalDefinitions.set(definition.name, definition)
      return () => globalDefinitions.delete(definition.name)
    },
  })
  const server = normalizeMcpConfig({
    mcpServers: [{
      id: 'acceptance_http',
      name: 'Acceptance Streamable HTTP',
      transport: 'streamable-http',
      url: fixture.url,
      headers: {
        'x-deepseekeyes-acceptance': { env: credentialName },
      },
      allowedTools: ['echo'],
    }],
  }).mcpServers[0]
  const adapter = new DshMcpClientAdapter(root, server, {
    environment: { [credentialName]: credentialValue },
    loadPlugin: loadSourceMcpClient,
  })

  try {
    assert.deepEqual(await adapter.listTools(), [])
    await adapter.start()
    assert.deepEqual(adapter.connectionState(), {
      connected: true,
      status: 'connected',
      toolCount: 1,
      probeCleanupFailures: 0,
      reconnect: server.reconnect,
    })

    const tools = await adapter.listTools()
    assert.equal(tools.length, 1)
    assert.equal(tools[0].rawName, 'echo')
    assert.equal(tools[0].publicName, 'mcp__acceptance_http__echo')
    assert.equal(globalDefinitions.size, 0, 'HTTP tools must stay in the capture registry')
    assert.deepEqual(
      await adapter.callTool(tools[0], { text: 'connected' }),
      { content: [{ type: 'text', text: 'http-echo:connected' }] },
    )

    const probed = await adapter.probe()
    assert.equal(probed.length, 1)
    assert.equal(probed[0].rawName, 'echo')
    assert.equal(probed[0].publicName, 'mcp__acceptance_http__echo')
    assert.equal(adapter.connectionState().connected, true, 'probe must not disturb the active connection')

    const refreshed = await adapter.refresh()
    assert.equal(refreshed.length, 1)
    assert.equal(refreshed[0].publicName, 'mcp__acceptance_http__echo')
    assert.notEqual(refreshed[0].definition, tools[0].definition, 'refresh must install a fresh generation')
    assert.deepEqual(
      await adapter.callTool(refreshed[0], { text: 'refreshed' }),
      { content: [{ type: 'text', text: 'http-echo:refreshed' }] },
    )
  } finally {
    await adapter.close()
    await disposeTools()
    await fixture.cleanup()
  }

  assert.deepEqual(await adapter.listTools(), [])
  assert.equal(adapter.connectionState().connected, false)
  const observed = fixture.snapshot()
  assert.equal(observed.rejectedRequests, 0)
  assert.equal(observed.activeRequests, 0)
  assert.equal(observed.transportsCreated, observed.transportsClosed)
  assert.equal(observed.methods.initialize, 3, 'start, probe, and refresh must each connect')
  assert.equal(observed.methods['tools/list'], 3)
  assert.equal(observed.methods['tools/call'], 2)
  assert.deepEqual(observed.toolCalls, ['connected', 'refreshed'])
  assert.deepEqual(observed.errors, [])
})

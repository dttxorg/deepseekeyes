import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createTemporaryMcpHttpServer } from '../acceptance/helpers/temporary-mcp-http-server.mjs'
import {
  DshMcpClientAdapter,
  McpContentAdapter,
  mcpPromptResult,
  mcpResourceResult,
  normalizeMcpConfig,
} from '../src/mcp/index.js'

const loadSourceMcpClient = () => import('@deepseek-ai/dsh-mcp-client')
const sourceMcpSdk = { Client, StdioClientTransport, StreamableHTTPClientTransport }

test('DeepSeekEyes Content plane discovers and reads real Streamable HTTP Resources and Prompts', { timeout: 30_000 }, async () => {
  const fixture = await createTemporaryMcpHttpServer()
  const server = normalizeMcpConfig({
    mcpServers: [{
      id: 'content_http',
      name: 'Content HTTP',
      transport: 'streamable-http',
      url: fixture.url,
      headers: {},
      toolsEnabled: false,
      resourcesEnabled: true,
      promptsEnabled: true,
      allowedResources: ['http://resource/*'],
      allowedPrompts: ['http-summary'],
    }],
  }).mcpServers[0]
  const adapter = new McpContentAdapter({}, server, { loadSdk: async () => sourceMcpSdk })
  try {
    await adapter.start()
    assert.equal(adapter.catalog().resources.length, 2)
    assert.equal(adapter.catalog().resourceTemplates.length, 1)
    assert.equal(adapter.catalog().prompts.length, 1)
    const text = mcpResourceResult(await adapter.readResource('http://resource/note'))
    assert.match(text.content[0].text, /http-resource:http:\/\/resource\/note/)
    const image = mcpResourceResult(await adapter.readResource('http://resource/pixel'))
    assert.equal(image.content[0].type, 'image')
    const prompt = mcpPromptResult(await adapter.getPrompt('http-summary', { style: 'brief' }))
    assert.match(prompt.content[0].text, /http-prompt:brief/)
  } finally {
    await adapter.close()
    await fixture.cleanup()
  }
  const observed = fixture.snapshot()
  assert.equal(observed.methods.initialize, 1)
  assert.equal(observed.methods['resources/list'], 1)
  assert.equal(observed.methods['resources/templates/list'], 1)
  assert.equal(observed.methods['resources/read'], 2)
  assert.equal(observed.methods['prompts/list'], 1)
  assert.equal(observed.methods['prompts/get'], 1)
  assert.equal(observed.errors.length, 0)
})

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

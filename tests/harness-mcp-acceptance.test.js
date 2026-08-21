import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createTemporaryMcpServer } from '../acceptance/helpers/temporary-mcp-server.mjs'
import { createTemporaryMcpContentServer } from '../acceptance/helpers/temporary-mcp-content-server.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  DshMcpClientAdapter,
  McpContentAdapter,
  mcpPromptResult,
  mcpResourceResult,
  normalizeMcpConfig,
} from '../src/mcp/index.js'

const loadSourceMcpClient = () => import('@deepseek-ai/dsh-mcp-client')
const sourceMcpSdk = { Client, StdioClientTransport, StreamableHTTPClientTransport }

test('DeepSeekEyes Content plane discovers and reads real stdio Resources and Prompts', async () => {
  const fixture = await createTemporaryMcpContentServer()
  const server = normalizeMcpConfig({
    mcpServers: [{
      id: 'content_stdio',
      name: 'Content stdio',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture.script],
      env: {},
      toolsEnabled: false,
      resourcesEnabled: true,
      promptsEnabled: true,
      allowedResources: ['notes://welcome', 'image://pixel', 'notes://{slug}'],
      allowedPrompts: ['describe-pixel'],
    }],
  }).mcpServers[0]
  const adapter = new McpContentAdapter({}, server, { loadSdk: async () => sourceMcpSdk })
  try {
    await adapter.start()
    const catalog = adapter.catalog()
    assert.equal(catalog.resources.length, 2)
    assert.equal(catalog.resourceTemplates.length, 1)
    assert.equal(catalog.prompts.length, 1)
    assert.deepEqual(mcpResourceResult(await adapter.readResource('notes://welcome')), {
      content: [{ type: 'text', text: '[MCP resource notes://welcome; text/plain]\nstdio-resource:notes://welcome' }],
    })
    const image = mcpResourceResult(await adapter.readResource('image://pixel'))
    assert.equal(image.content[0].type, 'image')
    assert.equal(image.content[0].mimeType, 'image/png')
    const prompt = mcpPromptResult(await adapter.getPrompt('describe-pixel', { detail: 'full' }))
    assert.equal(prompt.content.some(block => block.type === 'image'), true)
    assert.equal(prompt.content.some(block => block.type === 'text' && block.text.includes('detail:full')), true)
  } finally {
    await adapter.close()
    await fixture.cleanup()
  }
})

test('Harness MCP acceptance fixture uses the official client over a real temporary stdio SDK server', async () => {
  const fixture = await createTemporaryMcpServer()
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
      id: 'acceptance',
      name: 'Acceptance stdio',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture.script],
      env: {},
      allowedTools: ['echo'],
    }],
  }).mcpServers[0]
  const adapter = new DshMcpClientAdapter(root, server, { loadPlugin: loadSourceMcpClient })

  try {
    await adapter.start()
    const tools = await adapter.listTools()
    assert.equal(tools.length, 1)
    assert.equal(tools[0].rawName, 'echo')
    assert.equal(tools[0].publicName, 'mcp__acceptance__echo')
    assert.equal(globalDefinitions.size, 0, 'official tools must stay in the capture registry')
    const result = await adapter.callTool(tools[0], { text: 'verified' }, {
      signal: new AbortController().signal,
    })
    assert.deepEqual(result.content, [{ type: 'text', text: 'echo:verified' }])
  } finally {
    await adapter.close()
    await disposeTools()
    await fixture.cleanup()
  }
  assert.deepEqual(await adapter.listTools(), [])
})

test('official client accepts a real reachable stdio MCP server with a zero-tool catalog', async () => {
  const fixture = await createTemporaryMcpServer({ empty: true })
  const root = new Context()
  const disposeTools = root.provide('tools', {
    register() { throw new Error('a zero-tool server must not register a tool') },
  })
  const server = normalizeMcpConfig({
    mcpServers: [{
      id: 'empty_acceptance',
      name: 'Empty acceptance stdio',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture.script],
      env: {},
      allowedTools: ['*'],
    }],
  }).mcpServers[0]
  const adapter = new DshMcpClientAdapter(root, server, { loadPlugin: loadSourceMcpClient })

  try {
    await adapter.start()
    assert.deepEqual(await adapter.listTools(), [])
    assert.equal(adapter.connectionState().connected, true)
    assert.equal(adapter.connectionState().status, 'connected')
    const probed = await adapter.probe()
    assert.deepEqual(probed, [])
    adapter.reconcileProbe(probed)
    assert.equal(adapter.connectionState().connected, true)
  } finally {
    await adapter.close()
    await disposeTools()
    await fixture.cleanup()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createTemporaryMcpServer } from '../acceptance/helpers/temporary-mcp-server.mjs'
import {
  DshMcpClientAdapter,
  normalizeMcpConfig,
} from '../src/mcp/index.js'

const loadSourceMcpClient = () => import('@deepseek-ai/dsh-mcp-client')

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

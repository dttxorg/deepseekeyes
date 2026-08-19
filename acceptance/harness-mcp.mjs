import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTemporaryMcpServer } from './helpers/temporary-mcp-server.mjs'

const [baseURL, settingsPath] = process.argv.slice(2)
if (!baseURL) {
  throw new Error('usage: node acceptance/harness-mcp.mjs BASE_URL [SETTINGS_YAML]')
}

let sequence = 0
async function rpc(method, payload, { channel = '/api' } = {}) {
  sequence += 1
  const request = {
    type: 'client-request',
    rpcId: `deepseekeyes-mcp-${sequence}`,
    method,
    payload,
  }
  const response = await fetch(`${baseURL}${channel}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.rpcId, request.rpcId)
  assert.equal(body.result.ok, true, body.result.error?.message)
  return body.result.value
}

function mcp(method, payload = {}) {
  return rpc(method, payload, { channel: '/deepseekeyes' })
}

async function eyesSettings() {
  const settings = await rpc('settings.describe', {})
  const eyes = settings.namespaces.find(entry => entry.ns === 'deepseekeyes')
  assert.ok(eyes, 'Harness must expose the DeepSeekEyes settings namespace')
  return eyes
}

async function mutate(ops) {
  const current = await eyesSettings()
  await rpc('settings.mutate', {
    ns: 'deepseekeyes',
    expectedRevision: current.revision,
    ops,
  })
}

async function waitForMcp(predicate, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await mcp('mcp.status')
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${description}; latest MCP status: ${JSON.stringify(latest)}`)
}

async function history(sessionId) {
  const value = await rpc('session.history', { sessionId, maxMessages: 200 })
  return value.events.map(entry => entry.event)
}

async function waitForTurn(sessionId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await history(sessionId)
    if (events.some(event => event.type === 'turn/end')) return events
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`MCP acceptance session ${sessionId} did not finish`)
}

function assistantText(events) {
  return events
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

const servedClientResponse = await fetch(`${baseURL}/plugins/@dttxorg/deepseekeyes/client.js`)
assert.equal(servedClientResponse.status, 200)
const servedClient = await servedClientResponse.text()
for (const marker of [
  'deepseekeyes-mcp-max-tools',
  'deepseekeyes-mcp-schema-budget',
  'deepseekeyes-mcp-result-chars',
  'deepseekeyes-mcp-call-timeout',
  'deepseekeyes-mcp-artifact-dir',
  'deepseekeyes-mcp-id-',
  'deepseekeyes-mcp-name-',
  'deepseekeyes-mcp-transport-',
  'deepseekeyes-mcp-command-',
  'deepseekeyes-mcp-args-',
  'deepseekeyes-mcp-url-',
  'deepseekeyes-mcp-env-add-',
  'deepseekeyes-mcp-header-add-',
  'deepseekeyes-mcp-allow-',
  'deepseekeyes-mcp-deny-',
  '/deepseekeyes',
  'mcp.status',
  'mcp.${method}',
]) assert.ok(servedClient.includes(marker), `served settings GUI is missing ${marker}`)

const initial = await eyesSettings()
assert.equal(initial.value.mcpEnabled, false)
assert.deepEqual(initial.value.mcpServers, [])
assert.equal(initial.value.mcpMaxTools, 16)
assert.equal(initial.value.mcpMaxSchemaTokens, 12_000)
assert.equal(initial.value.mcpMaxResultChars, 20_000)
assert.equal(initial.value.mcpToolCallTimeoutMs, 30_000)
assert.equal(initial.value.mcpAudit, true)

const disabled = await mcp('mcp.status')
assert.equal(disabled.enabled, false)
assert.equal(disabled.summary.configuredServers, 0)
assert.equal(disabled.summary.exposedTools, 0)

const fixture = await createTemporaryMcpServer()
const server = {
  id: 'acceptance',
  name: 'Acceptance stdio',
  enabled: true,
  transport: 'stdio',
  command: process.execPath,
  args: [fixture.script],
  env: {},
  allowedTools: [],
  denyTools: [],
  timeoutMs: 10_000,
}

let nestedSettings
let connectedWithoutExposure
let exposed
let testResult
let toolList
let reconnected
let events
try {
  await mutate([
    { op: 'set', path: ['upstreamProvider'], value: 'mock-deepseek' },
    { op: 'set', path: ['upstreamModel'], value: 'mock-deepseek-model' },
    { op: 'set', path: ['visionProvider'], value: 'mock-vision' },
    { op: 'set', path: ['visionModel'], value: 'mock-vision-model' },
    { op: 'set', path: ['activeProbe'], value: false },
    { op: 'set', path: ['mcpArtifactDir'], value: false },
    { op: 'set', path: ['mcpEnabled'], value: true },
    { op: 'set', path: ['mcpServers'], value: [server] },
  ])

  nestedSettings = await eyesSettings()
  assert.equal(Array.isArray(nestedSettings.value.mcpServers), true)
  assert.equal(Array.isArray(nestedSettings.user.mcpServers), true)
  assert.equal(nestedSettings.value.mcpServers[0].transport, 'stdio')
  assert.deepEqual(nestedSettings.value.mcpServers[0].args, [fixture.script])
  assert.deepEqual(nestedSettings.value.mcpServers[0].env, {})
  assert.deepEqual(nestedSettings.value.mcpServers[0].allowedTools, [])

  connectedWithoutExposure = await waitForMcp(
    value => value.servers[0]?.status === 'connected',
    'temporary MCP stdio server did not connect',
  )
  assert.equal(connectedWithoutExposure.summary.connectedServers, 1)
  assert.equal(connectedWithoutExposure.summary.exposedTools, 0)
  assert.equal(connectedWithoutExposure.servers[0].toolCount, 1)
  assert.equal(connectedWithoutExposure.servers[0].tools[0].name, 'echo')
  assert.equal(connectedWithoutExposure.servers[0].tools[0].allowed, false)

  testResult = await mcp('mcp.test', { serverId: 'acceptance' })
  assert.equal(testResult.ok, true, testResult.error?.message)
  assert.equal(testResult.status, 'connected')
  assert.equal(testResult.toolCount, 1)
  assert.ok(testResult.schemaTokensEstimated > 0)

  toolList = await mcp('mcp.tools', { serverId: 'acceptance', refresh: true })
  assert.equal(toolList.length, 1)
  assert.equal(toolList[0].publicName, 'mcp__acceptance__echo')
  assert.equal(toolList[0].allowed, false)
  assert.equal(toolList[0].exposed, false)

  await mutate([{
    op: 'set',
    path: ['mcpServers'],
    value: [{ ...server, allowedTools: ['echo'] }],
  }])
  exposed = await waitForMcp(
    value => value.summary.exposedTools === 1,
    'allowlisted MCP tool was not exposed',
  )
  assert.equal(exposed.servers[0].tools[0].allowed, true)
  assert.equal(exposed.servers[0].tools[0].exposed, true)
  assert.ok(exposed.summary.schemaTokensEstimated > 0)

  reconnected = await mcp('mcp.reconnect', { serverId: 'acceptance' })
  assert.equal(reconnected.servers[0].status, 'connected')
  assert.equal(reconnected.summary.exposedTools, 1)

  const sessionId = `mcp-stdio-${Date.now()}`
  await rpc('session.create', { sessionId })
  await rpc('session.selectModel', {
    sessionId,
    provider: 'deepseekeyes',
    model: 'mock-deepseek-model',
  })
  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'MCP_STDIO_ACCEPTANCE' }],
  })
  events = await waitForTurn(sessionId)
  assert.match(assistantText(events), /MCP_STDIO_ACCEPTANCE_OK/)
  assert.ok(events.some(event => (
    event.type === 'tool/call' && event.data.name === 'mcp__acceptance__echo'
  )))
  assert.ok(events.some(event => (
    event.type === 'tool/result'
      && JSON.stringify(event.data.message).includes('echo:verified')
  )))

  if (settingsPath !== undefined) {
    const yaml = await readFile(settingsPath, 'utf8')
    for (const literal of [
      'mcpEnabled: true',
      'mcpServers:',
      'id: acceptance',
      'transport: stdio',
      'allowedTools:',
      '- echo',
    ]) assert.ok(yaml.includes(literal), `settings.yaml is missing ${literal}`)
  }

  console.log(JSON.stringify({
    result: 'HARNESS_MCP_ACCEPTANCE_OK',
    defaults: {
      enabled: initial.value.mcpEnabled,
      servers: initial.value.mcpServers.length,
      maxTools: initial.value.mcpMaxTools,
      maxSchemaTokens: initial.value.mcpMaxSchemaTokens,
    },
    nestedMcpServers: true,
    guiFieldsAndRpc: true,
    officialClient: '@deepseek-ai/dsh-mcp-client',
    transport: 'stdio',
    connectionTest: testResult.status,
    refreshTools: toolList.map(tool => tool.publicName),
    reconnect: reconnected.servers[0].status,
    defaultExposedTools: connectedWithoutExposure.summary.exposedTools,
    allowlistedExposedTools: exposed.summary.exposedTools,
    modelToolCall: 'mcp__acceptance__echo',
    modelResult: 'MCP_STDIO_ACCEPTANCE_OK',
  }, null, 2))
} finally {
  await mutate([
    { op: 'set', path: ['mcpEnabled'], value: false },
    { op: 'set', path: ['mcpServers'], value: [] },
  ]).catch(() => {})
  await waitForMcp(
    value => value.enabled === false && value.summary.connectedServers === 0,
    'MCP runtime did not stop after acceptance cleanup',
  ).catch(() => {})
  await fixture.cleanup()
}

import assert from 'node:assert/strict'

const [baseURL] = process.argv.slice(2)
if (!baseURL) throw new Error('usage: node acceptance/harness-desktop-computer-use.mjs BASE_URL')

let sequence = 0
async function rpc(method, payload) {
  sequence += 1
  const request = {
    type: 'client-request',
    rpcId: `deepseekeyes-desktop-${sequence}`,
    method,
    payload,
  }
  const response = await fetch(`${baseURL}/api/${method}`, {
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

async function settings() {
  const value = await rpc('settings.describe', {})
  return value.namespaces.find(entry => entry.ns === 'deepseekeyes')
}

async function mutate(ops) {
  const current = await settings()
  assert.ok(current)
  await rpc('settings.mutate', {
    ns: 'deepseekeyes',
    expectedRevision: current.revision,
    ops,
  })
  await new Promise(resolve => setTimeout(resolve, 150))
}

async function history(sessionId) {
  const value = await rpc('session.history', { sessionId, maxMessages: 200 })
  return value.events.map(entry => entry.event)
}

async function waitForTurn(sessionId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await history(sessionId)
    if (events.some(event => event.type === 'turn/end')) return events
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`desktop acceptance session ${sessionId} did not finish`)
}

function assistantText(events) {
  return events
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function contentHasImage(content) {
  return Array.isArray(content) && content.some(block =>
    block?.type === 'image'
      || block?.type === 'tool-result' && contentHasImage(block.content))
}

await mutate([
  { op: 'set', path: ['upstreamProvider'], value: 'mock-deepseek' },
  { op: 'set', path: ['upstreamModel'], value: 'mock-deepseek-model' },
  { op: 'set', path: ['visionProvider'], value: 'mock-vision' },
  { op: 'set', path: ['visionModel'], value: 'mock-vision-model' },
  { op: 'set', path: ['activeProbe'], value: false },
  { op: 'set', path: ['desktopComputerUse'], value: true },
  { op: 'set', path: ['desktopVisualMode'], value: 'always' },
  { op: 'set', path: ['desktopHistoryLimit'], value: 2 },
  { op: 'set', path: ['desktopSettleMs'], value: 0 },
  { op: 'set', path: ['desktopMaxWindows'], value: 10 },
])

const sessionId = `desktop-computer-use-${Date.now()}`
await rpc('session.create', { sessionId })
await rpc('session.selectModel', {
  sessionId,
  provider: 'deepseekeyes',
  model: 'mock-deepseek-model',
})
await rpc('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: 'DESKTOP_COMPUTER_USE_ACCEPTANCE' }],
})
const enabledEvents = await waitForTurn(sessionId)
assert.match(assistantText(enabledEvents), /DESKTOP_COMPUTER_USE_OK/)
assert.ok(enabledEvents.some(event => event.type === 'tool/call' && event.data.name === 'computer'))
const toolResult = enabledEvents.find(event =>
  event.type === 'tool/result' && JSON.stringify(event.data.message).includes('[DeepSeekEyes desktop state]'))
assert.ok(toolResult)
assert.equal(contentHasImage(toolResult.data.message.content), true)
const stateText = JSON.stringify(toolResult.data.message)
assert.match(stateText, /lossless-png/)
assert.match(stateText, /pixelSha256/)

await mutate([{ op: 'set', path: ['desktopComputerUse'], value: false }])
const disabledSessionId = `desktop-disabled-${Date.now()}`
await rpc('session.create', { sessionId: disabledSessionId })
await rpc('session.selectModel', {
  sessionId: disabledSessionId,
  provider: 'deepseekeyes',
  model: 'mock-deepseek-model',
})
await rpc('session.prompt', {
  sessionId: disabledSessionId,
  mode: 'queue',
  content: [{ type: 'text', text: 'DESKTOP_DISABLED_ACCEPTANCE' }],
})
const disabledEvents = await waitForTurn(disabledSessionId)
assert.match(assistantText(disabledEvents), /DESKTOP_DISABLED_OK/)
assert.equal(disabledEvents.some(event => event.type === 'tool/call'), false)

console.log(JSON.stringify({
  result: 'HARNESS_DESKTOP_COMPUTER_USE_OK',
  platform: process.platform,
  sessionId,
  toolCall: 'computer.observe',
  toolResultHasImage: true,
  losslessPixelHash: true,
  finalModelSawVisualEvidence: true,
  liveDisableRemovedTool: true,
}))

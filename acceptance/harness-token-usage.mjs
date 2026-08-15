import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const [baseURL, dshHome] = process.argv.slice(2)
if (!baseURL || !dshHome) {
  throw new Error('usage: node acceptance/harness-token-usage.mjs BASE_URL DSH_HOME')
}

let sequence = 0
async function rpc(method, payload, { channel = '/api' } = {}) {
  sequence += 1
  const request = {
    type: 'client-request',
    rpcId: `deepseekeyes-token-usage-${sequence}`,
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

async function usage(endpoint = 'usage.snapshot', payload = {}) {
  return rpc(endpoint, payload, { channel: '/deepseekeyes' })
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
  throw new Error(`token usage acceptance session ${sessionId} did not finish`)
}

async function configure() {
  const settings = await rpc('settings.describe', {})
  const eyes = settings.namespaces.find(entry => entry.ns === 'deepseekeyes')
  assert.ok(eyes)
  await rpc('settings.mutate', {
    ns: 'deepseekeyes',
    expectedRevision: eyes.revision,
    ops: [
      { op: 'set', path: ['upstreamProvider'], value: 'mock-deepseek' },
      { op: 'set', path: ['upstreamModel'], value: 'mock-deepseek-model' },
      { op: 'set', path: ['visionProvider'], value: 'mock-vision' },
      { op: 'set', path: ['visionModel'], value: 'mock-vision-model' },
      { op: 'set', path: ['activeProbe'], value: false },
      { op: 'set', path: ['usageStats'], value: true },
      { op: 'set', path: ['browserComputerUse'], value: false },
      { op: 'set', path: ['desktopComputerUse'], value: false },
    ],
  })
  await new Promise(resolve => setTimeout(resolve, 150))
}

async function prompt(sessionId, content) {
  await rpc('session.create', { sessionId })
  await rpc('session.selectModel', {
    sessionId,
    provider: 'deepseekeyes',
    model: 'mock-deepseek-model',
  })
  await rpc('session.prompt', { sessionId, mode: 'queue', content })
  return waitForTurn(sessionId)
}

await configure()
await usage('usage.reset', { confirm: true })
const initial = await usage()
assert.equal(initial.totals.derived.estimatedAdditionalTokens, 0)

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
  'base64',
)
const imageSha256 = createHash('sha256').update(imageBytes).digest('hex')
const imageSessionId = `token-image-${Date.now()}`
await prompt(imageSessionId, [
  { type: 'text', text: 'Read this exact original image.' },
  {
    type: 'image',
    data: imageBytes.toString('base64'),
    mediaType: 'image/png',
    name: 'token-usage.png',
  },
])

const afterImage = await usage()
assert.equal(afterImage.totals.visualTurns, 1)
assert.equal(afterImage.totals.calls.visionBase, 1)
assert.equal(afterImage.totals.calls.upstreamFinal, 1)
assert.equal(afterImage.totals.derived.visionTokens, 12)
assert.equal(afterImage.totals.derived.exactAdditionalTokens, 12)
assert.equal(afterImage.totals.derived.finalModelVisualTurnTokens, 12)
assert.ok(afterImage.totals.derived.estimatedBridgeInputTokens > 0)
assert.equal(afterImage.sessions[0].sessionId, imageSessionId)

const beforePlain = structuredClone(afterImage.totals)
const plainSessionId = `token-plain-${Date.now()}`
await prompt(plainSessionId, [{ type: 'text', text: 'Reply without visual work.' }])
const afterPlain = await usage()
assert.deepEqual(afterPlain.totals, beforePlain)
assert.equal(afterPlain.sessions.some(entry => entry.sessionId === plainSessionId), false)

const usagePath = join(dshHome, 'deepseekeyes', 'usage-stats.json')
const persisted = JSON.parse(await readFile(usagePath, 'utf8'))
const usageMode = (await stat(usagePath)).mode & 0o777
assert.equal(persisted.totals.visualTurns, 1)
assert.equal(usageMode, 0o600)

const reset = await usage('usage.reset', { confirm: true })
assert.equal(reset.totals.derived.estimatedAdditionalTokens, 0)
assert.deepEqual(reset.sessions, [])

console.log(JSON.stringify({
  result: 'HARNESS_TOKEN_USAGE_OK',
  imageSha256,
  imageSessionId,
  providerExactAdditionalTokens: afterImage.totals.derived.exactAdditionalTokens,
  estimatedBridgeInputTokens: afterImage.totals.derived.estimatedBridgeInputTokens,
  finalModelVisualTurnTokensExcluded: afterImage.totals.derived.finalModelVisualTurnTokens,
  plainTextAdditionalDelta: 0,
  usageFileMode: usageMode.toString(8),
  localRpc: '/deepseekeyes/usage.snapshot',
  resetAdditionalTokens: reset.totals.derived.estimatedAdditionalTokens,
}, null, 2))

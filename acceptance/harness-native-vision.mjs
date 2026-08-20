import assert from 'node:assert/strict'

const [baseURL] = process.argv.slice(2)
if (!baseURL) throw new Error('usage: node acceptance/harness-native-vision.mjs BASE_URL')

let sequence = 0
async function rpc(method, payload, { channel = '/api' } = {}) {
  sequence += 1
  const request = {
    type: 'client-request',
    rpcId: `deepseekeyes-native-vision-${sequence}`,
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

async function mutate(ops) {
  const settings = await rpc('settings.describe', {})
  const eyes = settings.namespaces.find(entry => entry.ns === 'deepseekeyes')
  assert.ok(eyes)
  await rpc('settings.mutate', {
    ns: 'deepseekeyes',
    expectedRevision: eyes.revision,
    ops,
  })
  await new Promise(resolve => setTimeout(resolve, 150))
}

async function history(sessionId) {
  const value = await rpc('session.history', { sessionId, maxMessages: 200 })
  return value.events.map(entry => entry.event)
}

async function waitForTurns(sessionId, count, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await history(sessionId)
    if (events.filter(event => event.type === 'turn/end').length >= count) return events
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`native vision acceptance session ${sessionId} did not finish ${count} turn(s)`)
}

function eventMessage(event) {
  if (event.type === 'user/message') return event.data
  return event.data?.message
}

function contentHasImage(content) {
  return Array.isArray(content) && content.some(block =>
    block?.type === 'image'
      || block?.type === 'tool-result' && contentHasImage(block.content))
}

function surfaceNodes(events) {
  const nodes = []
  for (const event of events) {
    if (event.surfaceOp === 'append') {
      nodes.push(event.seq)
      continue
    }
    const operation = event.surfaceOp
    if (operation?.op !== 'replace') continue
    const start = nodes.indexOf(operation.start)
    const end = nodes.indexOf(operation.end)
    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    nodes.splice(start, end - start + 1, event.seq)
  }
  return nodes
}

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
  'base64',
)
const sessionId = `native-vision-${Date.now()}`

try {
  await mutate([
    { op: 'set', path: ['upstreamProvider'], value: 'mock-vision' },
    { op: 'set', path: ['upstreamModel'], value: 'mock-vision-model' },
    { op: 'set', path: ['visionProvider'], value: 'mock-vision' },
    { op: 'set', path: ['visionModel'], value: 'mock-vision-model' },
    { op: 'set', path: ['activeProbe'], value: false },
    { op: 'set', path: ['desktopComputerUse'], value: false },
  ])
  await rpc('usage.reset', { confirm: true }, { channel: '/deepseekeyes' })
  await rpc('session.create', { sessionId })
  await rpc('session.selectModel', {
    sessionId,
    provider: 'deepseekeyes',
    model: 'mock-vision-model',
  })
  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [
      { type: 'text', text: 'NATIVE_VISION_ACCEPTANCE' },
      {
        type: 'image',
        data: imageBytes.toString('base64'),
        mediaType: 'image/png',
        name: 'native-vision.png',
      },
    ],
  })
  const first = await waitForTurns(sessionId, 1)
  assert.equal(first.some(event => event.type === 'tool/call'), false)
  assert.ok(first.some(event => contentHasImage(eventMessage(event)?.content)))
  const active = surfaceNodes(first)
    .map(seq => eventMessage(first.find(event => event.seq === seq)))
    .filter(Boolean)
  assert.equal(active.some(message => contentHasImage(message.content)), false)

  const usage = await rpc('usage.snapshot', {}, { channel: '/deepseekeyes' })
  assert.equal(usage.totals.nativeVisualTurns, 1)
  assert.equal(usage.totals.calls.visionBase, 0)
  assert.equal(usage.totals.calls.visionTarget, 0)
  assert.equal(usage.totals.calls.upstreamFinal, 1)
  assert.equal(usage.totals.derived.estimatedAdditionalTokens, 0)

  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'NATIVE_VISION_TEXT_FOLLOW_UP' }],
  })
  const second = await waitForTurns(sessionId, 2)
  assert.equal(second.filter(event => event.type === 'tool/call').length, 0)
  const afterText = await rpc('usage.snapshot', {}, { channel: '/deepseekeyes' })
  assert.equal(afterText.totals.nativeVisualTurns, 1)
  assert.equal(afterText.totals.calls.visionBase, 0)

  console.log(JSON.stringify({
    result: 'HARNESS_NATIVE_VISION_OK',
    sessionId,
    nativeVisualTurns: usage.totals.nativeVisualTurns,
    secondaryVisionCalls: usage.totals.calls.visionBase + usage.totals.calls.visionTarget,
    pluginAdditionalTokens: usage.totals.derived.estimatedAdditionalTokens,
    modelFacingImagesAfterFirstTurn: 0,
    textFollowUpReplayedPixels: false,
    appendOnlyOriginalImageRetained: true,
  }, null, 2))
} finally {
  await mutate([
    { op: 'set', path: ['upstreamProvider'], value: 'mock-deepseek' },
    { op: 'set', path: ['upstreamModel'], value: 'mock-deepseek-model' },
  ]).catch(() => {})
  await rpc('usage.reset', { confirm: true }, { channel: '/deepseekeyes' }).catch(() => {})
}

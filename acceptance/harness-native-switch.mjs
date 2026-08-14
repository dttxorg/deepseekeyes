import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const [baseURL] = process.argv.slice(2)
if (!baseURL) throw new Error('usage: node acceptance/harness-native-switch.mjs BASE_URL')

let sequence = 0
async function rpc(method, payload, { allowError = false } = {}) {
  sequence += 1
  const request = {
    type: 'client-request',
    rpcId: `deepseekeyes-native-switch-${sequence}`,
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
  if (!allowError) assert.equal(body.result.ok, true, body.result.error?.message)
  return body.result
}

function eventMessage(event) {
  if (event.type === 'user/message') return event.data
  return event.data?.message
}

function contentHasImage(content) {
  return Array.isArray(content) && content.some(block =>
    block?.type === 'image'
      || block?.type === 'tool-result' && contentHasImage(block.content),
  )
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

async function history(sessionId) {
  const result = await rpc('session.history', { sessionId, maxMessages: 200 })
  return result.value.events.map(entry => entry.event)
}

async function waitForIdleTurn(sessionId, minimumTurnEnds, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await history(sessionId)
    if (events.filter(event => event.type === 'turn/end').length >= minimumTurnEnds) return events
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`session ${sessionId} did not finish ${minimumTurnEnds} turn(s)`)
}

function assistantText(events) {
  return events
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
  'base64',
)
const imageSha256 = createHash('sha256').update(imageBytes).digest('hex')
const sessionId = `native-switch-${Date.now()}`

const settings = await rpc('settings.describe', {})
const eyesSettings = settings.value.namespaces.find(entry => entry.ns === 'deepseekeyes')
assert.ok(eyesSettings)
await rpc('settings.mutate', {
  ns: 'deepseekeyes',
  expectedRevision: eyesSettings.revision,
  ops: [
    { op: 'set', path: ['upstreamProvider'], value: 'mock-deepseek' },
    { op: 'set', path: ['upstreamModel'], value: 'mock-deepseek-model' },
    { op: 'set', path: ['visionProvider'], value: 'mock-vision' },
    { op: 'set', path: ['visionModel'], value: 'mock-vision-model' },
    { op: 'set', path: ['activeProbe'], value: false },
    { op: 'set', path: ['browserComputerUse'], value: false },
  ],
})
await new Promise(resolve => setTimeout(resolve, 150))

await rpc('session.create', { sessionId })
await rpc('session.selectModel', {
  sessionId,
  provider: 'deepseekeyes',
  model: 'mock-deepseek-model',
})
await rpc('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [
    { type: 'text', text: 'Read the exact original pixel.' },
    {
      type: 'image',
      data: imageBytes.toString('base64'),
      mediaType: 'image/png',
      name: 'native-switch.png',
    },
  ],
})

const afterImage = await waitForIdleTurn(sessionId, 1)
assert.match(assistantText(afterImage), /BRIDGE_IMAGE_OK/)
const rawImageEvent = afterImage.find(event => contentHasImage(eventMessage(event)?.content))
assert.ok(rawImageEvent, 'append-only history must retain the original image event')
const originalRef = eventMessage(rawImageEvent).content.find(block => block.type === 'image').attachment
assert.equal(String(originalRef.attachmentId), `sha256:${imageSha256}`)

const nodesAfterImage = surfaceNodes(afterImage)
const derivedMessages = nodesAfterImage
  .map(seq => eventMessage(afterImage.find(event => event.seq === seq)))
  .filter(Boolean)
assert.equal(derivedMessages.some(message => contentHasImage(message.content)), false)
assert.match(JSON.stringify(derivedMessages), /DeepSeekEyes preserved image/)

const switched = await rpc('session.selectModel', {
  sessionId,
  provider: 'mock-deepseek',
  model: 'mock-deepseek-model',
})
assert.deepEqual(switched.value.selected, {
  provider: 'mock-deepseek',
  model: 'mock-deepseek-model',
})

await rpc('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: 'Use the preserved original pixels and tell me the exact color.' }],
})
const afterSwitch = await waitForIdleTurn(sessionId, 2)
assert.match(assistantText(afterSwitch), /DIRECT_SWITCH_LOOK_OK/)
assert.ok(afterSwitch.some(event =>
  event.type === 'tool/call' && event.data.name === 'deepseekeyes_look'))
assert.ok(afterSwitch.some(event =>
  event.type === 'tool/result'
    && JSON.stringify(event.data.message).includes('DeepSeekEyes on-demand visual evidence')))

const attachmentResult = await rpc('session.attachment', {
  sessionId,
  attachmentId: originalRef.attachmentId,
})
assert.equal(attachmentResult.value.attachment.attachmentId, originalRef.attachmentId)
assert.equal(createHash('sha256').update(Buffer.from(attachmentResult.value.data, 'base64')).digest('hex'), imageSha256)

const plainSessionId = `plain-no-look-${Date.now()}`
await rpc('session.create', { sessionId: plainSessionId })
await rpc('session.selectModel', {
  sessionId: plainSessionId,
  provider: 'mock-deepseek',
  model: 'mock-deepseek-model',
})
await rpc('session.prompt', {
  sessionId: plainSessionId,
  mode: 'queue',
  content: [{ type: 'text', text: 'Reply without any visual work.' }],
})
const plainEvents = await waitForIdleTurn(plainSessionId, 1)
assert.match(assistantText(plainEvents), /PLAIN_NO_LOOK_OK/)
assert.equal(plainEvents.some(event => event.type === 'tool/call'), false)

console.log(JSON.stringify({
  result: 'PASS',
  sessionId,
  imageSha256,
  rawImageEventSeq: rawImageEvent.seq,
  modelFacingImagesAfterBridge: 0,
  preservedMarker: true,
  nativeSelection: switched.value.selected,
  onDemandToolCall: 'deepseekeyes_look',
  directAnswer: 'DIRECT_SWITCH_LOOK_OK: The original pixel is blue.',
  originalAttachmentSha256Verified: true,
  plainSessionVisualToolCalls: 0,
}, null, 2))

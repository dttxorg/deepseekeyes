import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { apply } from '../dsh/index.js'
import { messagesHaveImages } from '../src/content.js'
import { renderPreservedImageReference } from '../src/protocol.js'
import { compactSessionHistory } from '../src/session.js'
import { collectStream, textStream } from '../src/stream.js'
import {
  jsonStream,
  mockContext,
  MockSystemPrompt,
  MockTools,
  userMessage,
  validBaseEvidence,
  validTargetEvidence,
} from './_helpers.js'

test('ordinary sessions receive neither Browser nor preserved-image tool overhead', () => {
  const ctx = mockContext()
  ctx.llm.addProvider(
    'text-provider',
    [{ id: 'deepseek-v4-flash', inputModalities: ['text'] }],
    () => textStream('plain'),
  )
  ctx.llm.addProvider(
    'vision-provider',
    [{ id: 'vision-model', inputModalities: ['text', 'image'] }],
    () => jsonStream(validBaseEvidence()),
  )
  apply(ctx, {
    upstreamProvider: 'text-provider',
    upstreamModel: 'deepseek-v4-flash',
    visionProvider: 'vision-provider',
    visionModel: 'vision-model',
    activeProbe: false,
    cacheDir: false,
  })

  assert.equal(ctx.tools.get('browser'), undefined)
  assert.equal(ctx.tools.get('computer'), undefined)
  assert.equal(ctx.tools.get('deepseekeyes_look'), undefined)
  assert.equal(ctx.systemPrompt.sections.has('deepseekeyes:preserved-images'), false)
  assert.equal(ctx.systemPrompt.sections.has('deepseekeyes:desktop-computer-use'), false)
})

class SurfaceSession {
  constructor(id, message) {
    this.id = id
    this.events = [{ type: 'user/message', seq: 0, time: 1, data: message, surfaceOp: 'append' }]
    this.surface = { nodes: [0] }
  }

  append(type, data, intent) {
    const event = { type, seq: this.events.length, time: Date.now(), data, ...intent }
    this.events.push(event)
    if (intent.surfaceOp?.op === 'replace') {
      const start = this.surface.nodes.indexOf(intent.surfaceOp.start)
      const end = this.surface.nodes.indexOf(intent.surfaceOp.end)
      this.surface.nodes.splice(start, end - start + 1, event.seq)
    } else if (intent.surfaceOp === 'append') {
      this.surface.nodes.push(event.seq)
    }
    return event
  }

  deriveMessages() {
    return this.surface.nodes.map((seq) => {
      const event = this.events[seq]
      return event.type === 'user/message' ? event.data : event.data.message
    })
  }
}

test('durable model Surface keeps only recent preserved references while raw marker events remain', () => {
  const marker = (letter) => renderPreservedImageReference({
    source: {
      sha256: letter.repeat(64),
      attachmentId: `sha256:${letter.repeat(64)}`,
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    },
    evidence: { summary: `image-${letter}` },
  })
  const first = userMessage([{ type: 'text', text: marker('a') }])
  const second = userMessage([{ type: 'text', text: marker('b') }])
  const session = new SurfaceSession('retention-session', first)
  session.append('user/message', second, { surfaceOp: 'append' })
  const agent = { id: 'retention-session', session }
  const ctx = { agents: { get: () => agent } }

  const one = compactSessionHistory(ctx, 'retention-session', {
    historyImageLimit: 1,
    browserHistoryLimit: 0,
  })
  assert.equal(one.compacted, 1)
  assert.equal(JSON.stringify(session.deriveMessages()).includes('a'.repeat(64)), false)
  assert.equal(JSON.stringify(session.deriveMessages()).includes('b'.repeat(64)), true)
  assert.equal(JSON.stringify(session.events[0].data).includes('a'.repeat(64)), true)

  const zero = compactSessionHistory(ctx, 'retention-session', {
    historyImageLimit: 0,
    browserHistoryLimit: 0,
  })
  assert.equal(zero.compacted, 1)
  assert.equal(JSON.stringify(session.deriveMessages()).includes('b'.repeat(64)), false)
  assert.equal(JSON.stringify(session.events[1].data).includes('b'.repeat(64)), true)
})

test('processed images leave the raw log intact but exit the model surface so V4 Flash can be selected', async () => {
  const ctx = mockContext()
  let baseCalls = 0
  let targetCalls = 0
  ctx.llm.addProvider(
    'text-provider',
    [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', inputModalities: ['text'] }],
    () => textStream('image answer'),
  )
  ctx.llm.addProvider(
    'vision-provider',
    [{ id: 'vision-model', name: 'Vision Model', inputModalities: ['text', 'image'] }],
    (options) => {
      const prompt = options.messages[0].content.find(block => block.type === 'text')?.text ?? ''
      if (prompt.includes('deepseekeyes.evidence.v1')) {
        baseCalls += 1
        return jsonStream(validBaseEvidence({ summary: 'A settings screenshot with one error toast' }))
      }
      targetCalls += 1
      return jsonStream(validTargetEvidence({ answer: 'The toast says the text model does not accept image input.' }))
    },
  )
  const bytes = Buffer.from('original-switch-image')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const attachment = ctx.attachments.add(bytes, { attachmentId: `sha256:${hash}` })
  const original = userMessage([
    { type: 'text', text: 'Read this screenshot.' },
    { type: 'image', attachment },
  ])
  const session = new SurfaceSession('switch-session', original)
  const agentCtx = {
    ...ctx,
    tools: new MockTools(),
    systemPrompt: new MockSystemPrompt(),
  }
  const agent = { id: 'switch-session', session, ctx: agentCtx, options: { provider: 'deepseekeyes', model: 'deepseek-v4-flash' } }
  ctx.agents = { get: id => String(id) === agent.id ? agent : undefined }

  apply(ctx, {
    upstreamProvider: 'text-provider',
    upstreamModel: 'deepseek-v4-flash',
    visionProvider: 'vision-provider',
    visionModel: 'vision-model',
    activeProbe: false,
    cacheDir: false,
  })
  const result = await collectStream(ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'deepseek-v4-flash',
    sessionId: 'switch-session',
    messages: [original],
  }))

  assert.equal(result.text, 'image answer')
  assert.equal(baseCalls, 1)
  assert.equal(messagesHaveImages([session.events[0].data]), true, 'append-only original must retain pixels')
  assert.equal(messagesHaveImages(session.deriveMessages()), false, 'model surface must be text-only after preservation')
  assert.match(JSON.stringify(session.deriveMessages()), /DeepSeekEyes preserved image/)
  assert.equal(session.surface.nodes.length, 1)
  assert.equal(session.surface.nodes[0], 1)

  const directInfo = await ctx.llm.resolveModelInfo('text-provider', 'deepseek-v4-flash')
  assert.deepEqual(directInfo.inputModalities, ['text'])
  assert.equal(messagesHaveImages(session.deriveMessages()), false, 'Harness image admission now permits the direct text model')

  assert.equal(ctx.tools.get('deepseekeyes_look'), undefined, 'reread tool must not leak into other sessions')
  const look = agentCtx.tools.get('deepseekeyes_look')
  assert.ok(look, 'image sessions receive the scoped reread tool')
  assert.equal(agentCtx.systemPrompt.sections.has('deepseekeyes:preserved-images'), true)
  const detail = await look.execute({
    imageSha256: hash,
    question: 'Read the error toast exactly.',
  }, { agent, signal: new AbortController().signal })
  assert.equal(detail.evidence.answer, 'The toast says the text model does not accept image input.')
  assert.equal(targetCalls, 1)
  assert.equal(baseCalls, 1, 'on-demand reread reuses the cached base record')
})

import { createHash, randomUUID } from 'node:crypto'
import { inflateSync } from 'node:zlib'

export const name = 'deepseekeyes-dsh-acceptance'
export const inject = ['llm', 'attachments']

const COLORS = new Map([
  ['220,20,60', 'red'],
  ['0,150,70', 'green'],
  ['30,90,220', 'blue'],
  ['245,205,30', 'yellow'],
  ['0,190,200', 'cyan'],
  ['210,50,180', 'magenta'],
  ['15,15,15', 'black'],
  ['245,245,245', 'white'],
  ['125,125,125', 'gray'],
])

function output(text) {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function decodeGrid(png) {
  let offset = 8
  let width
  let height
  const compressed = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    } else if (type === 'IDAT') {
      compressed.push(data)
    }
    offset += 12 + length
  }
  const rows = inflateSync(Buffer.concat(compressed))
  const cells = []
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = Math.floor((column + 0.5) * width / 3)
      const y = Math.floor((row + 0.5) * height / 3)
      const pixel = y * (1 + width * 3) + 1 + x * 3
      cells.push(COLORS.get(`${rows[pixel]},${rows[pixel + 1]},${rows[pixel + 2]}`))
    }
  }
  return cells
}

function baseEvidence() {
  return {
    schemaVersion: 'deepseekeyes.evidence.v1',
    summary: 'Acceptance image containing one blue pixel',
    ocr: [],
    regions: [{ id: 'r1', bbox: [0, 0, 1, 1], description: 'one blue pixel' }],
    objects: [{ name: 'blue pixel', bbox: [0, 0, 1, 1], attributes: ['blue'] }],
    relations: [],
    quantitativeFacts: ['1 pixel'],
    uncertainties: [],
  }
}

function targetEvidence() {
  return {
    schemaVersion: 'deepseekeyes.target.v1',
    answer: 'The pixel is blue.',
    observations: [{ fact: 'blue pixel', bbox: [0, 0, 1, 1], confidence: 1 }],
    ocr: [],
    uncertainties: [],
  }
}

function pluginMessage(content) {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    source: { kind: 'user' },
  }
}

export function apply(ctx) {
  let upstreamCalls = 0
  let baseCalls = 0
  let targetCalls = 0
  let probeCalls = 0
  const adapter = {
    providerInfo(provider) {
      return { id: provider, name: provider }
    },
    providerRetryPolicy() {
      return undefined
    },
    listModels(provider) {
      return Promise.resolve(provider === 'mock-vision'
        ? [{ provider, id: 'mock-vision-model', name: 'Mock Vision', inputModalities: ['text', 'image'] }]
        : [{ provider, id: 'mock-deepseek-model', name: 'Mock DeepSeek', inputModalities: ['text'] }])
    },
    resolveModel(provider, model) {
      return Promise.resolve({
        provider,
        id: model,
        name: model,
        inputModalities: provider === 'mock-vision' ? ['text', 'image'] : ['text'],
      })
    },
    stream(options) {
      if (options.provider === 'mock-vision') {
        const prompt = options.messages.flatMap((message) => message.content)
          .find((block) => block.type === 'text')?.text ?? ''
        const image = options.messages.flatMap((message) => message.content)
          .find((block) => block.type === 'image')
        if (prompt.includes('3 by 3 grid')) {
          probeCalls += 1
          return (async function* () {
            const stored = await ctx.attachments.readImage(image.attachment)
            yield* output(JSON.stringify({ cells: decodeGrid(Buffer.from(stored.data)) }))
          })()
        }
        if (prompt.includes('deepseekeyes.evidence.v1')) {
          baseCalls += 1
          return output(JSON.stringify(baseEvidence()))
        }
        targetCalls += 1
        return output(JSON.stringify(targetEvidence()))
      }
      upstreamCalls += 1
      const visible = JSON.stringify(options.messages)
      if (!visible.includes('clarification evidence')) {
        const hash = /source_sha256: ([0-9a-f]{64})/.exec(visible)?.[1]
        return output(`<deepseekeyes-request>{"imageSha256":"${hash}","question":"What exact color is the pixel?"}</deepseekeyes-request>`)
      }
      return output('ACCEPTANCE_FINAL: The pixel is blue.')
    },
  }

  let started = false
  const run = async () => {
    if (started || !ctx.llm.listProviders().some((provider) => provider.id === 'deepseekeyes')) return
    started = true
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAANgAAADYCAIAAAAGQrq6AAACVklEQVR4nO3SMQ0AMAzAsCEpsGEfmMFoDksGkCNn7oN1Z70AxohEGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSTAiCUYkwYgkGJEEI5JgRBKMSIIRSfhDEhsv7lPy5QAAAABJRU5ErkJggg==', 'base64')
      const attachment = await ctx.attachments.saveImage({ data: png, mediaType: 'image/png', name: 'acceptance.png' })
      const sourceSha256 = createHash('sha256').update(png).digest('hex')
      const info = await ctx.llm.resolveModelInfo('deepseekeyes', 'mock-deepseek-model')
      let text = ''
      let usage
      for await (const chunk of ctx.llm.stream({
        provider: 'deepseekeyes',
        model: 'mock-deepseek-model',
        messages: [pluginMessage([
          { type: 'text', text: 'Identify the exact pixel color.' },
          { type: 'image', attachment },
        ])],
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'usage') usage = chunk.usage
      }
      console.log(`DEEPSEEKEYES_ACCEPTANCE:${JSON.stringify({
        modelModalities: info.inputModalities,
        sourceSha256,
        text,
        usage,
        probeCalls,
        baseCalls,
        targetCalls,
        upstreamCalls,
      })}`)
    } catch (error) {
      console.error(`DEEPSEEKEYES_ACCEPTANCE_ERROR:${error?.stack ?? error}`)
    }
  }

  if (typeof ctx.on === 'function') ctx.on('llm/adapters-updated', () => void run())
  ctx.llm.registerAdapter(['mock-deepseek', 'mock-vision'], adapter)
  queueMicrotask(() => void run())
}

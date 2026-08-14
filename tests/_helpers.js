import { createHash, randomUUID } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { PROBE_COLORS } from '../src/probe.js'
import { textStream } from '../src/stream.js'

export function validBaseEvidence(overrides = {}) {
  return {
    schemaVersion: 'deepseekeyes.evidence.v1',
    summary: 'A test image',
    ocr: [],
    regions: [],
    objects: [],
    relations: [],
    quantitativeFacts: [],
    uncertainties: [],
    ...overrides,
  }
}

export function validTargetEvidence(overrides = {}) {
  return {
    schemaVersion: 'deepseekeyes.target.v1',
    answer: 'Target detail',
    observations: [],
    ocr: [],
    uncertainties: [],
    ...overrides,
  }
}

export function userMessage(content) {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    source: { kind: 'user' },
  }
}

export class MockAttachments {
  constructor() {
    this.images = new Map()
    this.saved = []
  }

  add(data, fields = {}) {
    const buffer = Buffer.from(data)
    const attachmentId = fields.attachmentId ?? `sha256:${createHash('sha256').update(buffer).digest('hex')}`
    const ref = {
      attachmentId,
      mediaType: fields.mediaType ?? 'image/png',
      bytes: buffer.length,
      width: fields.width ?? 320,
      height: fields.height ?? 200,
      ...(fields.name === undefined ? {} : { name: fields.name }),
    }
    this.images.set(attachmentId, { ref, data: buffer })
    return ref
  }

  async saveImage(input) {
    const ref = this.add(input.data, {
      mediaType: input.mediaType,
      width: 216,
      height: 216,
      name: input.name,
    })
    this.saved.push(ref)
    return ref
  }

  async readImage(ref) {
    const found = this.images.get(String(ref.attachmentId))
    if (found === undefined) throw new Error(`missing attachment ${ref.attachmentId}`)
    return { ref: { ...found.ref }, data: new Uint8Array(found.data) }
  }
}

export class MockLlm {
  constructor() {
    this.providers = new Map()
    this.adapters = new Map()
  }

  addProvider(id, models, handler) {
    this.providers.set(id, {
      info: { id, name: id },
      models: models.map((model) => ({ provider: id, name: model.name ?? model.id, ...model })),
      handler,
    })
  }

  listProviders() {
    return [
      ...[...this.providers.values()].map((entry) => ({ ...entry.info })),
      ...[...this.adapters.entries()].map(([id, adapter]) => adapter.providerInfo(id)),
    ]
  }

  async listModels(provider) {
    const adapter = this.adapters.get(provider)
    if (adapter !== undefined) return adapter.listModels(provider)
    const found = this.providers.get(provider)
    if (found === undefined) throw new Error(`no provider ${provider}`)
    return found.models.map((model) => structuredClone(model))
  }

  async resolveModelInfo(provider, model, signal) {
    const adapter = this.adapters.get(provider)
    if (adapter !== undefined) return adapter.resolveModel(provider, model, signal)
    const found = this.providers.get(provider)
    if (found === undefined) throw new Error(`no provider ${provider}`)
    const info = found.models.find((entry) => entry.id === model)
    if (info === undefined) throw new Error(`no model ${provider}/${model}`)
    return structuredClone(info)
  }

  registerAdapter(providers, adapter) {
    for (const provider of providers) {
      if (this.adapters.has(provider) || this.providers.has(provider)) throw new Error(`duplicate ${provider}`)
      this.adapters.set(provider, adapter)
    }
    return () => {
      for (const provider of providers) this.adapters.delete(provider)
    }
  }

  stream(options) {
    const adapter = this.adapters.get(options.provider)
    if (adapter !== undefined) return adapter.stream(options)
    const found = this.providers.get(options.provider)
    if (found?.handler === undefined) throw new Error(`no stream handler ${options.provider}`)
    return found.handler(options)
  }
}

export function mockContext() {
  const listeners = new Map()
  const ctx = {
    attachments: new MockAttachments(),
    llm: new MockLlm(),
    logger: { warn() {}, error() {}, info() {} },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
  }
  return ctx
}

export function jsonStream(value, usage) {
  return textStream(JSON.stringify(value), usage)
}

export function decodeProbeOrder(png) {
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
    }
    if (type === 'IDAT') compressed.push(data)
    offset += 12 + length
  }
  const rows = inflateSync(Buffer.concat(compressed))
  const cell = width / 3
  const byRgb = new Map(PROBE_COLORS.map((entry) => [entry.rgb.join(','), entry.name]))
  const order = []
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = Math.floor(column * cell + cell / 2)
      const y = Math.floor(row * (height / 3) + height / 6)
      const start = y * (1 + width * 3) + 1 + x * 3
      order.push(byRgb.get([rows[start], rows[start + 1], rows[start + 2]].join(',')))
    }
  }
  return order
}

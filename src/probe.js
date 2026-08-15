import { randomInt } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { pluginUserMessage } from './content.js'
import { DeepSeekEyesError } from './error.js'
import { parseJsonObject } from './protocol.js'
import { collectStream, emptyUsage } from './stream.js'

export const PROBE_COLORS = Object.freeze([
  { name: 'red', rgb: [220, 20, 60] },
  { name: 'green', rgb: [0, 150, 70] },
  { name: 'blue', rgb: [30, 90, 220] },
  { name: 'yellow', rgb: [245, 205, 30] },
  { name: 'cyan', rgb: [0, 190, 200] },
  { name: 'magenta', rgb: [210, 50, 180] },
  { name: 'black', rgb: [15, 15, 15] },
  { name: 'white', rgb: [245, 245, 245] },
  { name: 'gray', rgb: [125, 125, 125] },
])

let crcTable
function crc32(buffer) {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let value = n
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      crcTable[n] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const chunk = Buffer.concat([name, data])
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(chunk))
  return Buffer.concat([length, chunk, checksum])
}

/** Produce a standards-valid RGB PNG containing a 3x3 shuffled color grid. */
export function createProbePng(order, cellSize = 72) {
  if (!Array.isArray(order) || order.length !== PROBE_COLORS.length) {
    throw new TypeError('deepseekeyes: probe order must contain nine colors')
  }
  const width = cellSize * 3
  const height = cellSize * 3
  const rows = Buffer.alloc(height * (1 + width * 3))
  const byName = new Map(PROBE_COLORS.map((entry) => [entry.name, entry.rgb]))
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 3)
    rows[rowOffset] = 0
    for (let x = 0; x < width; x += 1) {
      const cell = Math.floor(y / cellSize) * 3 + Math.floor(x / cellSize)
      const rgb = byName.get(order[cell])
      if (rgb === undefined) throw new TypeError(`deepseekeyes: unknown probe color ${order[cell]}`)
      const pixel = rowOffset + 1 + x * 3
      rows[pixel] = rgb[0]
      rows[pixel + 1] = rgb[1]
      rows[pixel + 2] = rgb[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export function shuffledProbeOrder(nextInt = randomInt) {
  const names = PROBE_COLORS.map((entry) => entry.name)
  for (let index = names.length - 1; index > 0; index -= 1) {
    const swap = nextInt(index + 1)
    ;[names[index], names[swap]] = [names[swap], names[index]]
  }
  return names
}

function probePrompt() {
  return `This image is a 3 by 3 grid with one solid color per cell. Read cells left-to-right, top-to-bottom. Return only JSON: {"cells":[nine labels]}. Each label must be one of: red, green, blue, yellow, cyan, magenta, black, white, gray. Do not infer the order from this text; inspect the image.`
}

/** One-time, per-route operational proof that the selected provider really consumes pixels. */
export class VisionProbe {
  constructor(ctx, { enabled = true, nextInt = randomInt, logger = console } = {}) {
    this.ctx = ctx
    this.enabled = enabled
    this.nextInt = nextInt
    this.logger = logger
    this.validated = new Map()
  }

  clear() {
    this.validated.clear()
  }

  async ensure(route, signal) {
    if (!this.enabled) return { validation: 'metadata-only', usage: emptyUsage() }
    const key = `${route.provider}\u0000${route.model}`
    const existing = this.validated.get(key)
    if (existing !== undefined) return existing
    const pending = this.run(route, signal).then(
      (result) => {
        if (this.validated.get(key) === pending) {
          this.validated.set(key, Promise.resolve({
            validation: result.validation,
            usage: emptyUsage(),
          }))
        }
        return result
      },
      (error) => {
        if (this.validated.get(key) === pending) this.validated.delete(key)
        throw error
      },
    )
    this.validated.set(key, pending)
    return pending
  }

  async run(route, signal) {
    const order = shuffledProbeOrder(this.nextInt)
    const data = createProbePng(order)
    const attachment = await this.ctx.attachments.saveImage({
      data,
      mediaType: 'image/png',
      name: 'deepseekeyes-vision-probe.png',
    })
    const result = await collectStream(this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: 'You are a visual capability verifier. Follow the user output format exactly.',
      messages: [pluginUserMessage([
        { type: 'image', attachment },
        { type: 'text', text: probePrompt() },
      ], 'DeepSeekEyes 视觉能力检测')],
      temperature: 0,
      maxTokens: 256,
      signal,
    }))
    const parsed = parseJsonObject(result.text, 'vision capability probe', { allowWrapper: true })
    const cells = Array.isArray(parsed.cells) ? parsed.cells.map((value) => String(value).toLowerCase()) : []
    if (cells.length !== order.length || cells.some((value, index) => value !== order[index])) {
      throw new DeepSeekEyesError(
        `provider ${route.provider}/${route.model} declared image input but failed the randomized pixel probe`,
        'VISION_PROBE_FAILED',
      )
    }
    this.logger.info?.(`deepseekeyes: active pixel probe passed for ${route.provider}/${route.model}`)
    return { validation: 'metadata+active-grid-probe', usage: result.usage }
  }
}

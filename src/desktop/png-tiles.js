import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { DeepSeekEyesError } from '../error.js'

export const DEFAULT_DESKTOP_ATTACHMENT_LIMIT = 4_750_000
export const DEFAULT_DESKTOP_MAX_DIMENSION = 2_000
export const DEFAULT_DESKTOP_MAX_PIXELS = 40_000_000
export const DEFAULT_DESKTOP_MAX_TILES = 20
export const DEFAULT_DESKTOP_MESSAGE_LIMIT = 100 * 1024 * 1024

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const COLOR_CHANNELS = new Map([[0, 1], [2, 3], [4, 2], [6, 4]])
const PRESERVED_ANCILLARY = new Set(['cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'pHYs'])

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

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([name, data])
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(payload))
  return Buffer.concat([length, payload, checksum])
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

/** Decode the non-interlaced 8-bit PNGs produced by Windows and macOS screenshot APIs. */
export function decodeDesktopPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new DeepSeekEyesError('desktop screenshot is not a PNG', 'DESKTOP_SCREENSHOT_INVALID')
  }
  let offset = 8
  let header
  const compressed = []
  const ancillary = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) {
      throw new DeepSeekEyesError('desktop PNG contains a truncated chunk', 'DESKTOP_SCREENSHOT_INVALID')
    }
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      compressed.push(data)
    } else if (PRESERVED_ANCILLARY.has(type)) {
      ancillary.push(Buffer.from(buffer.subarray(offset, end)))
    }
    offset = end
    if (type === 'IEND') break
  }
  const channels = COLOR_CHANNELS.get(header?.colorType)
  if (header === undefined || header.width <= 0 || header.height <= 0 || header.bitDepth !== 8
    || channels === undefined || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new DeepSeekEyesError(
      'desktop PNG must be non-interlaced 8-bit grayscale, RGB, grayscale-alpha, or RGBA',
      'DESKTOP_SCREENSHOT_FORMAT_UNSUPPORTED',
    )
  }
  const packed = inflateSync(Buffer.concat(compressed))
  const stride = header.width * channels
  if (packed.length !== header.height * (stride + 1)) {
    throw new DeepSeekEyesError('desktop PNG scanline size is invalid', 'DESKTOP_SCREENSHOT_INVALID')
  }
  const pixels = Buffer.alloc(stride * header.height)
  for (let y = 0; y < header.height; y += 1) {
    const source = y * (stride + 1)
    const target = y * stride
    const filter = packed[source]
    if (filter > 4) throw new DeepSeekEyesError('desktop PNG uses an unknown filter', 'DESKTOP_SCREENSHOT_INVALID')
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source + 1 + x]
      const left = x >= channels ? pixels[target + x - channels] : 0
      const up = y > 0 ? pixels[target - stride + x] : 0
      const upperLeft = y > 0 && x >= channels ? pixels[target - stride + x - channels] : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft)
      pixels[target + x] = (raw + predictor) & 0xff
    }
  }
  return { ...header, channels, ancillary, pixels }
}

function encodeTile(tile) {
  const rowBytes = tile.width * tile.channels
  const filtered = Buffer.alloc(tile.height * (rowBytes + 1))
  for (let y = 0; y < tile.height; y += 1) {
    const output = y * (rowBytes + 1)
    filtered[output] = 0
    tile.pixels.copy(filtered, output + 1, y * rowBytes, (y + 1) * rowBytes)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(tile.width, 0)
  ihdr.writeUInt32BE(tile.height, 4)
  ihdr[8] = 8
  ihdr[9] = tile.colorType
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    ...tile.ancillary,
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Encode exact packed screenshot pixels as a standards-valid PNG. */
export function encodeDesktopPngPixels({ width, height, colorType = 6, pixels, ancillary = [] }) {
  const channels = COLOR_CHANNELS.get(colorType)
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || channels === undefined || !Buffer.isBuffer(pixels) || pixels.length !== width * height * channels) {
    throw new TypeError('desktop PNG pixels do not match width, height, and color type')
  }
  return encodeTile({ width, height, colorType, channels, pixels, ancillary })
}

function crop(tile, x, y, width, height) {
  const rowBytes = width * tile.channels
  const sourceStride = tile.width * tile.channels
  const pixels = Buffer.alloc(rowBytes * height)
  for (let row = 0; row < height; row += 1) {
    const sourceStart = (y + row) * sourceStride + x * tile.channels
    tile.pixels.copy(pixels, row * rowBytes, sourceStart, sourceStart + rowBytes)
  }
  return {
    ...tile,
    x: tile.x + x,
    y: tile.y + y,
    width,
    height,
    pixels,
  }
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`desktop PNG ${name} must be a positive safe integer`)
  }
  return value
}

function tileLimits(input) {
  const options = typeof input === 'number' ? { maxBytes: input } : input ?? {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('desktop PNG tile limits must be a byte limit or options object')
  }
  const limits = {
    maxBytes: positiveInteger(
      options.maxBytes,
      DEFAULT_DESKTOP_ATTACHMENT_LIMIT,
      'per-image byte limit',
    ),
    maxDimension: positiveInteger(
      options.maxDimension,
      DEFAULT_DESKTOP_MAX_DIMENSION,
      'per-side pixel limit',
    ),
    maxPixels: positiveInteger(
      options.maxPixels,
      DEFAULT_DESKTOP_MAX_PIXELS,
      'decoded-pixel limit',
    ),
    maxTiles: positiveInteger(
      options.maxTiles,
      DEFAULT_DESKTOP_MAX_TILES,
      'image-count limit',
    ),
    maxTotalBytes: positiveInteger(
      options.maxTotalBytes,
      DEFAULT_DESKTOP_MESSAGE_LIMIT,
      'aggregate image-byte limit',
    ),
  }
  if (limits.maxBytes < 64 * 1024) {
    throw new RangeError('desktop PNG attachment limit must be an integer of at least 65536 bytes')
  }
  return limits
}

function fitTile(tile, limits, output) {
  const data = encodeTile(tile)
  if (data.length <= limits.maxBytes
    && tile.width <= limits.maxDimension
    && tile.height <= limits.maxDimension
    && tile.width * tile.height <= limits.maxPixels) {
    output.push({
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      data,
      pixelSha256: createHash('sha256').update(tile.pixels).digest('hex'),
    })
    return
  }
  if (tile.width <= 1 && tile.height <= 1) {
    throw new DeepSeekEyesError('one desktop PNG pixel exceeds the attachment limit', 'DESKTOP_SCREENSHOT_LIMIT')
  }
  if (tile.width >= tile.height && tile.width > 1) {
    const firstWidth = Math.floor(tile.width / 2)
    fitTile(crop(tile, 0, 0, firstWidth, tile.height), limits, output)
    fitTile(crop(tile, firstWidth, 0, tile.width - firstWidth, tile.height), limits, output)
    return
  }
  const firstHeight = Math.floor(tile.height / 2)
  fitTile(crop(tile, 0, 0, tile.width, firstHeight), limits, output)
  fitTile(crop(tile, 0, firstHeight, tile.width, tile.height - firstHeight), limits, output)
}

/** Recompress without pixel loss, then split against every Host image-admission limit. */
export function losslessDesktopPngTiles(buffer, options = DEFAULT_DESKTOP_ATTACHMENT_LIMIT) {
  const limits = tileLimits(options)
  const decoded = decodeDesktopPng(buffer)
  const root = { ...decoded, x: 0, y: 0 }
  const tiles = []
  fitTile(root, limits, tiles)
  if (tiles.length > limits.maxTiles) {
    throw new DeepSeekEyesError(
      `desktop screenshot requires ${tiles.length} lossless tiles but the Host accepts ${limits.maxTiles}`,
      'DESKTOP_SCREENSHOT_TILE_COUNT_LIMIT',
    )
  }
  const totalBytes = tiles.reduce((sum, tile) => sum + tile.data.length, 0)
  if (totalBytes > limits.maxTotalBytes) {
    throw new DeepSeekEyesError(
      `desktop screenshot lossless tiles require ${totalBytes} bytes but the Host accepts ${limits.maxTotalBytes}`,
      'DESKTOP_SCREENSHOT_TOTAL_BYTES_LIMIT',
    )
  }
  return {
    width: decoded.width,
    height: decoded.height,
    colorType: decoded.colorType,
    channels: decoded.channels,
    sourceSha256: createHash('sha256').update(buffer).digest('hex'),
    sourcePixelSha256: createHash('sha256').update(decoded.pixels).digest('hex'),
    limits,
    tiles,
  }
}

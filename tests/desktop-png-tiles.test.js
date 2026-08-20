import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  decodeDesktopPng,
  encodeDesktopPngPixels,
  losslessDesktopPngTiles,
} from '../src/desktop/index.js'

test('oversized desktop PNGs are delivered as bounded lossless tiles with every pixel preserved', () => {
  const width = 400
  const height = 300
  const pixels = Buffer.alloc(width * height * 4)
  let value = 0x12345678
  for (let index = 0; index < pixels.length; index += 1) {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    pixels[index] = value & 0xff
  }
  const source = encodeDesktopPngPixels({ width, height, colorType: 6, pixels })
  assert.ok(source.length > 65_536)
  const result = losslessDesktopPngTiles(source, 65_536)
  assert.ok(result.tiles.length > 1)
  assert.equal(result.sourcePixelSha256, createHash('sha256').update(pixels).digest('hex'))
  assert.ok(result.tiles.every(tile => tile.data.length <= 65_536))

  const rebuilt = Buffer.alloc(pixels.length)
  for (const tile of result.tiles) {
    const decoded = decodeDesktopPng(tile.data)
    assert.equal(decoded.width, tile.width)
    assert.equal(decoded.height, tile.height)
    assert.equal(createHash('sha256').update(decoded.pixels).digest('hex'), tile.pixelSha256)
    for (let row = 0; row < tile.height; row += 1) {
      const sourceStart = row * tile.width * 4
      const targetStart = ((tile.y + row) * width + tile.x) * 4
      decoded.pixels.copy(rebuilt, targetStart, sourceStart, sourceStart + tile.width * 4)
    }
  }
  assert.deepEqual(rebuilt, pixels)
})

test('small desktop PNGs stay one lossless image after deterministic recompression', () => {
  const width = 2
  const height = 2
  const pixels = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ])
  const result = losslessDesktopPngTiles(encodeDesktopPngPixels({ width, height, pixels }))
  assert.equal(result.tiles.length, 1)
  assert.deepEqual(decodeDesktopPng(result.tiles[0].data).pixels, pixels)
})

test('compressible ultra-wide screenshots still split at the Host per-side pixel limit', () => {
  const width = 5_120
  const height = 2
  const pixels = Buffer.alloc(width * height * 4, 0x7f)
  const source = encodeDesktopPngPixels({ width, height, pixels })
  assert.ok(source.length < 65_536, 'the regression requires bytes alone not to trigger tiling')

  const result = losslessDesktopPngTiles(source)
  assert.ok(result.tiles.length > 1)
  assert.ok(result.tiles.every(tile => tile.width <= 2_000 && tile.height <= 2_000))

  const rebuilt = Buffer.alloc(pixels.length)
  for (const tile of result.tiles) {
    const decoded = decodeDesktopPng(tile.data)
    for (let row = 0; row < tile.height; row += 1) {
      const sourceStart = row * tile.width * 4
      const targetStart = ((tile.y + row) * width + tile.x) * 4
      decoded.pixels.copy(rebuilt, targetStart, sourceStart, sourceStart + tile.width * 4)
    }
  }
  assert.deepEqual(rebuilt, pixels)
})

test('desktop tiling also honors Host decoded-pixel and aggregate image limits', () => {
  const width = 100
  const height = 60
  const pixels = Buffer.alloc(width * height * 4, 0x33)
  const source = encodeDesktopPngPixels({ width, height, pixels })
  const result = losslessDesktopPngTiles(source, {
    maxBytes: 65_536,
    maxDimension: 1_000,
    maxPixels: 1_500,
    maxTiles: 8,
    maxTotalBytes: 512 * 1024,
  })
  assert.ok(result.tiles.length > 1)
  assert.ok(result.tiles.every(tile => tile.width * tile.height <= 1_500))
  assert.ok(result.tiles.reduce((sum, tile) => sum + tile.data.length, 0) <= 512 * 1024)
})

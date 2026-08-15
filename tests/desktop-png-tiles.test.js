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

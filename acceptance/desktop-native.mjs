import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolveConfig } from '../src/config.js'
import {
  DEFAULT_DESKTOP_ATTACHMENT_LIMIT,
  DesktopSession,
  parseDesktopArgs,
  renderDesktopResult,
} from '../src/desktop/index.js'

if (!['darwin', 'win32'].includes(process.platform)) {
  console.log(`desktop native acceptance: SKIP (${process.platform} has no 0.3 native driver)`)
  process.exit(0)
}

const config = resolveConfig({
  desktopComputerUse: true,
  desktopArtifactsDir: false,
  desktopSettleMs: 0,
  desktopMaxWindows: 10,
}, process.env)
const saved = []
const ctx = {
  attachments: {
    async saveImage(input) {
      assert.ok(input.data.length <= DEFAULT_DESKTOP_ATTACHMENT_LIMIT)
      const attachmentId = `sha256:${createHash('sha256').update(input.data).digest('hex')}`
      const ref = {
        attachmentId,
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: input.width,
        height: input.height,
        name: input.name,
      }
      saved.push(ref)
      return ref
    },
  },
}
const result = await new DesktopSession(ctx, config, { sessionId: 'native-acceptance' })
  .execute(parseDesktopArgs({ action: 'observe' }))
assert.equal(result.platform, process.platform)
assert.ok(result.screenshot.bytes > 0)
assert.equal(result.capabilities?.screenshot, true)
assert.ok(Array.isArray(result.windows))
assert.ok(Number(result.screen?.width) > 0)
assert.ok(Number(result.screen?.height) > 0)
assert.equal(saved.length, result.screenshot.tileCount)
assert.equal(renderDesktopResult(result).filter(block => block.type === 'image').length, saved.length)
console.log(JSON.stringify({
  result: 'DESKTOP_NATIVE_OBSERVE_OK',
  platform: result.platform,
  screenshotBytes: result.screenshot.bytes,
  screenshotSha256: result.screenshot.sha256,
  pixelSha256: result.screenshot.pixelSha256,
  delivery: result.screenshot.delivery,
  tileCount: result.screenshot.tileCount,
  tileBytes: result.screenshot.tiles.map(tile => tile.bytes),
  screen: result.screen,
  windowCount: result.windows.length,
  capabilities: result.capabilities,
}))

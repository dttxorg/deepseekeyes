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
  console.log(`desktop native acceptance: SKIP (${process.platform} has no 0.5 native driver)`)
  process.exit(0)
}

const config = resolveConfig({
  desktopComputerUse: true,
  desktopArtifactsDir: false,
  desktopSettleMs: 0,
  desktopMaxWindows: 10,
  desktopSemantic: true,
  desktopMaxElements: 100,
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
const session = new DesktopSession(ctx, config, { sessionId: 'native-acceptance' })
const result = await session.execute(parseDesktopArgs({ action: 'observe', scope: 'desktop' }))
assert.equal(result.platform, process.platform)
assert.ok(result.screenshot.bytes > 0)
assert.equal(result.capabilities?.screenshot, true)
assert.ok(Array.isArray(result.windows))
assert.ok(Number(result.screen?.width) > 0)
assert.ok(Number(result.screen?.height) > 0)
assert.equal(saved.length, result.screenshot.tileCount)
assert.equal(renderDesktopResult(result).filter(block => block.type === 'image').length, saved.length)
assert.equal(result.observationScope.type, 'desktop')
assert.equal(result.stateDelta.initial, true)
assert.ok(Array.isArray(result.elements))

const target = result.windows.find(window =>
  window.width > 0
  && window.height > 0
  && window.width * window.height < result.screen.width * result.screen.height)
  ?? result.windows.find(window => window.width > 0 && window.height > 0)
let windowResult
if (target !== undefined) {
  windowResult = await session.execute(parseDesktopArgs({
    action: 'observe',
    stateId: result.stateId,
    scope: 'window',
    windowRef: target.ref,
  }))
  assert.equal(windowResult.observationScope.type, 'window')
  assert.equal(windowResult.observationScope.window.ref, target.ref)
  assert.equal(windowResult.screen.width, windowResult.screenshot.width)
  assert.equal(windowResult.screen.height, windowResult.screenshot.height)
  assert.ok(windowResult.screen.width > 0)
  assert.ok(windowResult.screen.height > 0)
  assert.ok(Array.isArray(windowResult.elements))
  assert.equal(windowResult.stateDelta.fromStateId, result.stateId)
  assert.equal(renderDesktopResult(windowResult).filter(block => block.type === 'image').length, windowResult.screenshot.tileCount)
}
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
  semanticElementCount: result.elements.length,
  windowScoped: windowResult === undefined ? 'skipped-no-window' : {
    ref: windowResult.observationScope.window.ref,
    screen: windowResult.screen,
    screenshotBytes: windowResult.screenshot.bytes,
    screenshotSha256: windowResult.screenshot.sha256,
    elementCount: windowResult.elements.length,
    elementTotal: windowResult.elementTotal,
    elementsTruncated: windowResult.elementsTruncated,
  },
  capabilities: result.capabilities,
}))

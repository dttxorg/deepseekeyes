import assert from 'node:assert/strict'
import test from 'node:test'
import {
  messagesHaveImages,
  replaceImagesWithEvidence,
  uniqueImageBlocks,
} from '../src/content.js'
import { userMessage } from './_helpers.js'

test('nested tool-result images are discovered and replaced without mutating history', () => {
  const ref = { attachmentId: 'image-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
  const messages = [userMessage([{
    type: 'tool-result',
    toolCallId: 'call-1',
    content: [{ type: 'image', attachment: ref }],
  }])]
  assert.equal(messagesHaveImages(messages), true)
  assert.equal(uniqueImageBlocks(messages).length, 1)
  const replaced = replaceImagesWithEvidence(messages, new Map([['image-1', 'evidence']]))
  assert.equal(replaced[0].content[0].content[0].type, 'text')
  assert.equal(replaced[0].content[0].content[0].text, 'evidence')
  assert.equal(messages[0].content[0].content[0].type, 'image')
})

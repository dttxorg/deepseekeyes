import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BROWSER_HISTORY_PREFIX,
  messagesHaveImages,
  messagesNeedHistoryCompaction,
  replaceImagesWithEvidence,
  rewriteMessagesForBridge,
  uniqueImageBlocks,
} from '../src/content.js'
import { renderPreservedImageReference } from '../src/protocol.js'
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

test('compact Surface markers obey recent limits including the zero setting', () => {
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
  const assistant = text => ({
    id: `assistant-${text}`,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseekeyes', model: 'fixture' },
  })
  const messages = [
    userMessage([{ type: 'text', text: marker('a') }, { type: 'text', text: `${BROWSER_HISTORY_PREFIX}{"stateId":"one"}` }]),
    assistant('one'),
    userMessage([{ type: 'text', text: marker('b') }, { type: 'text', text: `${BROWSER_HISTORY_PREFIX}{"stateId":"two"}` }]),
    assistant('two'),
    userMessage([{ type: 'text', text: 'plain follow-up' }]),
  ]
  assert.equal(messagesNeedHistoryCompaction(messages), true)

  const one = JSON.stringify(rewriteMessagesForBridge(messages, new Map(), new Map(), {
    historyImageLimit: 1,
    browserHistoryLimit: 1,
  }))
  assert.equal(one.includes('a'.repeat(64)), false)
  assert.equal(one.includes('b'.repeat(64)), true)
  assert.equal(one.includes('stateId\\\":\\\"one'), false)
  assert.equal(one.includes('stateId\\\":\\\"two'), true)

  const zero = JSON.stringify(rewriteMessagesForBridge(messages, new Map(), new Map(), {
    historyImageLimit: 0,
    browserHistoryLimit: 0,
  }))
  assert.equal(zero.includes('a'.repeat(64)), false)
  assert.equal(zero.includes('b'.repeat(64)), false)
  assert.equal(zero.includes('stateId'), false)
})

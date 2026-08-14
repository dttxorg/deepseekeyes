import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseClarificationRequest,
  parseJsonObject,
  validateBaseEvidence,
} from '../src/protocol.js'
import { validBaseEvidence } from './_helpers.js'

test('JSON extraction accepts a fenced object but validates the complete evidence schema', () => {
  const value = parseJsonObject(`\`\`\`json\n${JSON.stringify(validBaseEvidence())}\n\`\`\``)
  assert.equal(validateBaseEvidence(value).summary, 'A test image')
  assert.throws(() => validateBaseEvidence({ ...value, ocr: undefined }), /ocr/)
})

test('clarification protocol accepts only a whole, known-image control response', () => {
  const hash = 'a'.repeat(64)
  const text = `<deepseekeyes-request>{"imageSha256":"${hash}","question":"Read row 3","region":{"x":0,"y":0,"width":1,"height":0.5}}</deepseekeyes-request>`
  const parsed = parseClarificationRequest(text, new Set([hash]))
  assert.equal(parsed.question, 'Read row 3')
  assert.throws(
    () => parseClarificationRequest(`prefix ${text}`, new Set([hash])),
    /malformed or mixed/,
  )
  assert.throws(() => parseClarificationRequest(text, new Set()), /unknown image hash/)
})

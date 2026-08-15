import assert from 'node:assert/strict'
import test from 'node:test'
import {
  baseEvidencePrompt,
  parseClarificationRequest,
  parseJsonObject,
  preservedImageReferences,
  renderPreservedImageReference,
  validateBaseEvidence,
  validateTargetEvidence,
} from '../src/protocol.js'
import { BASE_EVIDENCE_SCHEMA } from '../src/evidence-schema.js'
import { userMessage } from './_helpers.js'
import { validBaseEvidence, validTargetEvidence } from './_helpers.js'

test('JSON extraction accepts a fenced object but validates the complete evidence schema', () => {
  const value = parseJsonObject(`\`\`\`json\n${JSON.stringify(validBaseEvidence())}\n\`\`\``)
  assert.equal(validateBaseEvidence(value).summary, 'A test image')
  assert.throws(() => validateBaseEvidence({ ...value, ocr: undefined }), /ocr/)
})

test('canonical JSON Schema drives prompts and rejects every invalid nested field', () => {
  const source = {
    mediaType: 'image/png', width: 100, height: 100, bytes: 42, sha256: 'a'.repeat(64),
  }
  assert.match(baseEvidencePrompt(source), new RegExp(BASE_EVIDENCE_SCHEMA.title))

  const nested = validBaseEvidence({
    ocr: [{ text: 'exact', bbox: [0, 0, 0.5, 0.5], confidence: 0.9 }],
    objects: [{ name: 'button', bbox: [0.5, 0.5, 0.5, 0.5], attributes: ['blue'] }],
  })
  assert.equal(validateBaseEvidence(nested), nested)
  assert.throws(
    () => validateBaseEvidence({
      ...nested,
      ocr: [{ ...nested.ocr[0], hiddenGuess: 'secret' }],
    }),
    /unexpected property hiddenGuess/,
  )
  assert.throws(
    () => validateBaseEvidence({
      ...nested,
      objects: [{ ...nested.objects[0], attributes: ['blue', 7] }],
    }),
    /must be string/,
  )
  assert.throws(
    () => validateBaseEvidence({
      ...nested,
      ocr: [{ ...nested.ocr[0], bbox: [0.8, 0, 0.3, 0.5] }],
    }),
    /normalizedBox/,
  )
  assert.throws(
    () => validateTargetEvidence(validTargetEvidence({
      observations: [{ fact: 'visible', bbox: [0, 0, 1, 1], confidence: 1.1 }],
    })),
    /must be <= 1/,
  )
  assert.throws(
    () => parseJsonObject(`prefix ${JSON.stringify(validBaseEvidence())}`, 'strict evidence'),
    /not one valid JSON object/,
  )
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

test('preserved image pointers are bounded and recover only validated attachment records', () => {
  const hash = 'a'.repeat(64)
  const text = renderPreservedImageReference({
    source: {
      sha256: hash,
      attachmentId: `sha256:${hash}`,
      mediaType: 'image/png',
      bytes: 123,
      width: 640,
      height: 360,
    },
    evidence: { summary: `  ${'detail '.repeat(100)}  ` },
  }, 80)
  const references = preservedImageReferences([userMessage([{ type: 'text', text }])])
  assert.equal(references.length, 1)
  assert.equal(references[0].imageSha256, hash)
  assert.equal(references[0].attachment.attachmentId, `sha256:${hash}`)
  assert.ok(references[0].summary.length <= 80)
  assert.deepEqual(preservedImageReferences([
    userMessage([{ type: 'text', text: '[DeepSeekEyes preserved image]\n{"version":1}' }]),
  ]), [])
})

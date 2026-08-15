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
import { BASE_EVIDENCE_SCHEMA, normalizeEvidenceCoordinates } from '../src/evidence-schema.js'
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
  const prompt = baseEvidencePrompt(source)
  assert.match(prompt, new RegExp(BASE_EVIDENCE_SCHEMA.title))
  assert.match(prompt, /bounded overview/i)
  assert.match(prompt, /targeted reread/i)
  assert.ok(prompt.length < 2_500, `visual prompt compatibility budget exceeded: ${prompt.length}`)
  assert.match(prompt, /use \[\] for an empty list/i)
  assert.doesNotMatch(prompt, /Transcribe every visible word without paraphrasing/)

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

test('visual evidence alone may unwrap one JSON object while control messages remain strict', () => {
  const evidence = validBaseEvidence()
  assert.deepEqual(
    parseJsonObject(`Here is the requested object:\n${JSON.stringify(evidence)}`, 'vision', {
      allowWrapper: true,
    }),
    evidence,
  )
  assert.throws(
    () => parseJsonObject(
      `${JSON.stringify(evidence)}\n${JSON.stringify(evidence)}`,
      'vision',
      { allowWrapper: true },
    ),
    /not one valid JSON object/,
  )
  assert.throws(
    () => parseJsonObject(`Here is the requested object:\n${JSON.stringify(evidence)}`, 'control'),
    /not one valid JSON object/,
  )
})

test('coordinate normalization preserves strict Schema and records original bbox values', () => {
  const source = { width: 1720, height: 1440 }
  const qwen = normalizeEvidenceCoordinates('base', validBaseEvidence({
    ocr: [{ text: 'Error 132', bbox: [100, 200, 600, 260], confidence: 0.98 }],
  }), source, { provider: 'opencode-go', model: 'qwen3.7-plus' })
  assert.deepEqual(qwen.value.ocr[0].bbox, [0.1, 0.2, 0.5, 0.06])
  assert.equal(qwen.audit.transformedCount, 1)
  assert.equal(qwen.audit.convention, 'qwen-1000-xyxy')
  assert.deepEqual(qwen.audit.transforms[0], {
    path: '/ocr/0/bbox',
    convention: 'qwen-1000-xyxy',
    original: [100, 200, 600, 260],
    normalized: [0.1, 0.2, 0.5, 0.06],
  })
  assert.equal(validateBaseEvidence(qwen.value), qwen.value)

  const pixelXywh = normalizeEvidenceCoordinates('target', validTargetEvidence({
    observations: [{ fact: 'visible', bbox: [172, 144, 344, 72], confidence: 0.95 }],
  }), source, { provider: 'opencode-go', model: 'minimax-m3' })
  assert.deepEqual(pixelXywh.value.observations[0].bbox, [0.1, 0.1, 0.2, 0.05])
  assert.equal(pixelXywh.audit.convention, 'pixel-xywh')
  assert.equal(validateTargetEvidence(pixelXywh.value), pixelXywh.value)

  const normalizedXyxy = normalizeEvidenceCoordinates('base', validBaseEvidence({
    objects: [{ name: 'dialog', bbox: [0.8, 0.2, 0.95, 0.4], attributes: [] }],
  }), source, { provider: 'generic', model: 'vision' })
  assert.deepEqual(normalizedXyxy.value.objects[0].bbox, [0.8, 0.2, 0.15, 0.2])
  assert.equal(normalizedXyxy.audit.convention, 'normalized-xyxy')
  assert.equal(validateBaseEvidence(normalizedXyxy.value), normalizedXyxy.value)

  const pixelXyxy = normalizeEvidenceCoordinates('target', validTargetEvidence({
    observations: [{ fact: 'bottom-right', bbox: [800, 700, 900, 900], confidence: 0.9 }],
  }), { width: 1_000, height: 1_000 }, { provider: 'generic', model: 'vision' })
  assert.deepEqual(pixelXyxy.value.observations[0].bbox, [0.8, 0.7, 0.1, 0.2])
  assert.equal(pixelXyxy.audit.convention, 'pixel-xyxy')
  assert.equal(validateTargetEvidence(pixelXyxy.value), pixelXyxy.value)
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

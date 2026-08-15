import Ajv from 'ajv'
import schemaDocument from '../schemas/visual-evidence.schema.json' with { type: 'json' }
import { DeepSeekEyesError } from './error.js'

export const BASE_SCHEMA_VERSION = 'deepseekeyes.evidence.v1'
export const TARGET_SCHEMA_VERSION = 'deepseekeyes.target.v1'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function referencedDefinitions(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) referencedDefinitions(entry, found)
    return found
  }
  if (value === null || typeof value !== 'object') return found
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$ref' && typeof entry === 'string') {
      const match = /^#\/definitions\/([^/]+)$/.exec(entry)
      if (match !== null && !found.has(match[1])) {
        found.add(match[1])
        referencedDefinitions(schemaDocument.definitions[match[1]], found)
      }
      continue
    }
    referencedDefinitions(entry, found)
  }
  return found
}

function schemaVariant(name, title) {
  const definition = clone(schemaDocument.definitions[name])
  const references = [...referencedDefinitions(definition)]
  return deepFreeze({
    $schema: schemaDocument.$schema,
    title,
    ...definition,
    definitions: Object.fromEntries(
      references.map(reference => [reference, clone(schemaDocument.definitions[reference])]),
    ),
  })
}

export const VISUAL_EVIDENCE_SCHEMA = deepFreeze(clone(schemaDocument))
export const BASE_EVIDENCE_SCHEMA = schemaVariant('baseEvidence', 'DeepSeekEyes base visual evidence')
export const TARGET_EVIDENCE_SCHEMA = schemaVariant('targetEvidence', 'DeepSeekEyes targeted visual evidence')

const BOX_EPSILON = 0.000001
const COORDINATE_PRECISION = 1_000_000_000

function roundCoordinate(value) {
  const rounded = Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION
  return Object.is(rounded, -0) ? 0 : rounded
}

function finiteBox(value) {
  return Array.isArray(value)
    && value.length === 4
    && value.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
}

function normalizedXywh(value) {
  return finiteBox(value)
    && value.every(entry => entry <= 1)
    && value[0] + value[2] <= 1 + BOX_EPSILON
    && value[1] + value[3] <= 1 + BOX_EPSILON
}

function normalizedXyxy(value) {
  return finiteBox(value)
    && value.every(entry => entry <= 1)
    && value[2] >= value[0]
    && value[3] >= value[1]
}

function pixelPossibilities(value, width, height) {
  if (!finiteBox(value) || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return { xywh: false, xyxy: false }
  }
  return {
    xywh: value[0] <= width && value[1] <= height
      && value[0] + value[2] <= width + BOX_EPSILON
      && value[1] + value[3] <= height + BOX_EPSILON,
    xyxy: value[0] <= width && value[1] <= height
      && value[2] >= value[0] && value[3] >= value[1]
      && value[2] <= width + BOX_EPSILON && value[3] <= height + BOX_EPSILON,
  }
}

function qwenRoute(route) {
  return /qwen/i.test(`${route?.provider ?? ''}/${route?.model ?? ''}`)
}

function qwenThousandXyxy(value) {
  return finiteBox(value)
    && value.some(entry => entry > 1)
    && value.every(entry => entry <= 1_000)
    && value[2] >= value[0]
    && value[3] >= value[1]
}

function jsonPointer(path) {
  return `/${path.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function findBoxes(value, path = [], found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findBoxes(entry, [...path, index], found))
    return found
  }
  if (value === null || typeof value !== 'object') return found
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'bbox' && Array.isArray(entry)) {
      found.push({ owner: value, key, path: [...path, key], value: entry })
      continue
    }
    findBoxes(entry, [...path, key], found)
  }
  return found
}

function normalizedBox(value, convention, source) {
  const [x, y, third, fourth] = value
  let result
  if (convention === 'normalized-xyxy') {
    result = [x, y, third - x, fourth - y]
  } else if (convention === 'qwen-1000-xyxy') {
    result = [x / 1_000, y / 1_000, (third - x) / 1_000, (fourth - y) / 1_000]
  } else if (convention === 'pixel-xyxy') {
    result = [x / source.width, y / source.height, (third - x) / source.width, (fourth - y) / source.height]
  } else if (convention === 'pixel-xywh') {
    result = [x / source.width, y / source.height, third / source.width, fourth / source.height]
  } else {
    return value
  }
  return result.map(roundCoordinate)
}

/**
 * Deterministically translate common model bbox conventions into the canonical
 * normalized [x,y,width,height] representation before strict Schema validation.
 * The returned audit keeps every original coordinate without changing image bytes.
 */
export function normalizeEvidenceCoordinates(kind, value, source, route = {}) {
  if (!['base', 'target'].includes(kind)) {
    throw new TypeError(`deepseekeyes: unknown evidence schema kind ${kind}`)
  }
  const normalized = clone(value)
  const boxes = findBoxes(normalized)
  const width = source?.width
  const height = source?.height
  const prefersQwenCoordinates = qwenRoute(route)

  const pixelCandidates = boxes
    .filter(entry => finiteBox(entry.value) && entry.value.some(number => number > 1))
    .map(entry => pixelPossibilities(entry.value, width, height))
  const onlyXyxy = pixelCandidates.some(candidate => candidate.xyxy && !candidate.xywh)
  const onlyXywh = pixelCandidates.some(candidate => candidate.xywh && !candidate.xyxy)
  const ambiguousPixelConvention = onlyXyxy && !onlyXywh ? 'pixel-xyxy' : 'pixel-xywh'
  const transforms = []

  for (const entry of boxes) {
    const original = [...entry.value]
    let convention
    if (normalizedXywh(original)) {
      continue
    } else if (normalizedXyxy(original)) {
      convention = 'normalized-xyxy'
    } else if (prefersQwenCoordinates && qwenThousandXyxy(original)) {
      convention = 'qwen-1000-xyxy'
    } else {
      const possible = pixelPossibilities(original, width, height)
      if (possible.xywh && possible.xyxy) convention = ambiguousPixelConvention
      else if (possible.xywh) convention = 'pixel-xywh'
      else if (possible.xyxy) convention = 'pixel-xyxy'
    }
    if (convention === undefined) continue
    const replacement = normalizedBox(original, convention, source)
    entry.owner[entry.key] = replacement
    transforms.push(Object.freeze({
      path: jsonPointer(entry.path),
      convention,
      original: Object.freeze(original),
      normalized: Object.freeze([...replacement]),
    }))
  }

  const conventions = [...new Set(transforms.map(transform => transform.convention))]
  const audit = Object.freeze({
    transformedCount: transforms.length,
    convention: conventions.length === 0
      ? 'normalized-xywh'
      : conventions.length === 1 ? conventions[0] : 'mixed',
    transforms: Object.freeze(transforms),
  })
  return Object.freeze({ value: normalized, audit })
}

const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true })
ajv.addKeyword({
  keyword: 'normalizedBox',
  type: 'array',
  schemaType: 'boolean',
  errors: false,
  validate(enabled, value) {
    if (!enabled || !Array.isArray(value) || value.length !== 4) return true
    return value[0] + value[2] <= 1.000001 && value[1] + value[3] <= 1.000001
  },
})

const validators = Object.freeze({
  base: ajv.compile(BASE_EVIDENCE_SCHEMA),
  target: ajv.compile(TARGET_EVIDENCE_SCHEMA),
})

function formattedErrors(errors) {
  return (errors ?? []).map((error) => {
    const path = error.instancePath === '' ? '/' : error.instancePath
    const detail = error.keyword === 'additionalProperties'
      ? ` unexpected property ${error.params.additionalProperty}`
      : ''
    return `${path} ${error.message ?? error.keyword}${detail}`
  }).join('; ')
}

export function validateEvidence(kind, value) {
  const validate = validators[kind]
  if (validate === undefined) throw new TypeError(`deepseekeyes: unknown evidence schema kind ${kind}`)
  if (!validate(value)) {
    throw new DeepSeekEyesError(
      `${kind} visual evidence failed strict JSON Schema validation: ${formattedErrors(validate.errors)}`,
      'INVALID_VISION_EVIDENCE',
      { schema: kind, errors: clone(validate.errors ?? []) },
    )
  }
  return value
}

/** Minified schema injected into the visual prompt from the canonical source. */
export function evidenceSchemaPrompt(kind) {
  if (kind === 'base') return JSON.stringify(BASE_EVIDENCE_SCHEMA)
  if (kind === 'target') return JSON.stringify(TARGET_EVIDENCE_SCHEMA)
  throw new TypeError(`deepseekeyes: unknown evidence schema kind ${kind}`)
}

const promptStrings = Object.freeze({
  summary: 'literal overview',
  text: 'exact visible text',
  id: 'r1',
  description: 'visible contents',
  name: 'visible object',
  fact: 'literal observed fact',
  answer: 'direct evidence-only answer',
  relations: 'spatial or logical relationship',
  quantitativeFacts: 'visible count, value, axis, unit or dimension',
  uncertainties: 'remaining visual uncertainty',
  attributes: 'literal visible attribute',
})

function resolvedPromptSchema(schema) {
  if (schema?.$ref === undefined) return schema
  const match = /^#\/definitions\/([^/]+)$/.exec(schema.$ref)
  if (match === null) throw new TypeError(`deepseekeyes: unsupported prompt schema reference ${schema.$ref}`)
  return schemaDocument.definitions[match[1]]
}

function promptExample(schema, field) {
  const resolved = resolvedPromptSchema(schema)
  if (resolved.const !== undefined) return resolved.const
  if (resolved.normalizedBox === true || field === 'bbox') return [0, 0, 1, 1]
  if (resolved.type === 'object') {
    return Object.fromEntries((resolved.required ?? []).map(key => [
      key,
      promptExample(resolved.properties[key], key),
    ]))
  }
  if (resolved.type === 'array') return [promptExample(resolved.items, field)]
  if (resolved.type === 'number') return field === 'confidence' ? 0.9 : 0
  if (resolved.type === 'string') return promptStrings[field] ?? 'literal visible value'
  throw new TypeError(`deepseekeyes: unsupported prompt schema node for ${field}`)
}

/** Compact example generated from the same canonical Schema used by Ajv. */
export function evidenceExamplePrompt(kind) {
  const name = kind === 'base' ? 'baseEvidence' : kind === 'target' ? 'targetEvidence' : undefined
  if (name === undefined) throw new TypeError(`deepseekeyes: unknown evidence schema kind ${kind}`)
  return JSON.stringify(promptExample(schemaDocument.definitions[name], name))
}

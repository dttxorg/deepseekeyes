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

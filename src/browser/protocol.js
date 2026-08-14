import { createHash } from 'node:crypto'

export const BROWSER_ACTIONS = Object.freeze([
  'open',
  'observe',
  'click',
  'type',
  'press',
  'select',
  'check',
  'uncheck',
  'scroll',
  'wait',
  'assert',
  'back',
  'forward',
  'reload',
  'report',
  'close',
])

export const ASSERTION_KINDS = Object.freeze([
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'checked',
  'unchecked',
  'text_contains',
  'text_equals',
  'value_equals',
  'url_contains',
  'url_equals',
  'title_contains',
  'title_equals',
  'count_equals',
])

export const WAIT_KINDS = Object.freeze([
  'timeout',
  'networkidle',
  'text',
  'url',
  'visible',
  'hidden',
])

const TARGET_FIELDS = ['ref', 'selector', 'role', 'name', 'text', 'x', 'y']
const SEMANTIC_TARGET_FIELDS = ['ref', 'selector', 'role', 'name', 'text']
const STATEFUL_ACTIONS = new Set([
  'click', 'type', 'press', 'select', 'check', 'uncheck', 'scroll',
  'assert', 'back', 'forward', 'reload',
])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`deepseekeyes browser: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value, field) {
  if (value === undefined) return undefined
  return requireString(value, field)
}

function optionalFinite(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`deepseekeyes browser: ${field} must be a finite number`)
  }
  return value
}

function optionalBoolean(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new TypeError(`deepseekeyes browser: ${field} must be boolean`)
  return value
}

function hasTarget(args) {
  return TARGET_FIELDS.some((field) => args[field] !== undefined)
}

function hasSemanticTarget(args) {
  return SEMANTIC_TARGET_FIELDS.some((field) => args[field] !== undefined)
}

function hasCoordinateTarget(args) {
  return args.x !== undefined || args.y !== undefined
}

function validateCoordinateTarget(args) {
  if (!hasCoordinateTarget(args)) return
  if ((args.x === undefined) !== (args.y === undefined)) {
    throw new TypeError('deepseekeyes browser: coordinate targets require both x and y')
  }
  if (args.x < 0 || args.y < 0) {
    throw new RangeError('deepseekeyes browser: coordinate targets must be non-negative')
  }
  if (hasSemanticTarget(args)) {
    throw new TypeError('deepseekeyes browser: coordinate and semantic targets cannot be combined')
  }
}

function requireTarget(args, action) {
  if (!hasTarget(args)) {
    throw new TypeError(`deepseekeyes browser: ${action} requires ref, selector, role/name, text, or x/y`)
  }
}

function requireSemanticTarget(args, action) {
  if (!hasSemanticTarget(args)) {
    throw new TypeError(`deepseekeyes browser: ${action} requires ref, selector, role/name, or text`)
  }
}

function validateUrl(value) {
  const url = requireString(value, 'url')
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new TypeError(`deepseekeyes browser: url is invalid: ${error.message}`)
  }
  if (!['http:', 'https:', 'file:', 'about:'].includes(parsed.protocol)) {
    throw new TypeError(`deepseekeyes browser: unsupported URL protocol ${parsed.protocol}`)
  }
  return parsed.href
}

export function browserActionNeedsState(action) {
  return STATEFUL_ACTIONS.has(action)
}

/** Validate the model-facing browser action object and normalize scalar fields. */
export function parseBrowserArgs(input) {
  if (!isPlainObject(input)) throw new TypeError('deepseekeyes browser: arguments must be an object')
  const action = requireString(input.action, 'action').toLowerCase()
  if (!BROWSER_ACTIONS.includes(action)) {
    throw new TypeError(`deepseekeyes browser: unsupported action ${action}`)
  }
  const args = {
    action,
    stateId: optionalString(input.stateId, 'stateId'),
    ref: optionalString(input.ref, 'ref'),
    selector: optionalString(input.selector, 'selector'),
    role: optionalString(input.role, 'role'),
    name: optionalString(input.name, 'name'),
    text: optionalString(input.text, 'text'),
    value: input.value === undefined ? undefined : String(input.value),
    key: optionalString(input.key, 'key'),
    expected: input.expected,
    assertion: optionalString(input.assertion, 'assertion')?.toLowerCase(),
    waitFor: optionalString(input.waitFor, 'waitFor')?.toLowerCase(),
    button: optionalString(input.button, 'button')?.toLowerCase(),
    x: optionalFinite(input.x, 'x'),
    y: optionalFinite(input.y, 'y'),
    deltaX: optionalFinite(input.deltaX, 'deltaX'),
    deltaY: optionalFinite(input.deltaY, 'deltaY'),
    timeoutMs: optionalFinite(input.timeoutMs, 'timeoutMs'),
    exact: optionalBoolean(input.exact, 'exact'),
    submit: optionalBoolean(input.submit, 'submit'),
    secret: optionalBoolean(input.secret, 'secret'),
    reportName: optionalString(input.reportName, 'reportName'),
  }

  validateCoordinateTarget(args)

  if (args.timeoutMs !== undefined && (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 0 || args.timeoutMs > 120_000)) {
    throw new RangeError('deepseekeyes browser: timeoutMs must be an integer from 0 through 120000')
  }
  if (browserActionNeedsState(action) && args.stateId === undefined) {
    throw new TypeError(`deepseekeyes browser: ${action} requires the latest stateId`)
  }
  if (action === 'open') args.url = validateUrl(input.url)
  if (['click', 'type'].includes(action)) requireTarget(args, action)
  if (['select', 'check', 'uncheck'].includes(action)) requireSemanticTarget(args, action)
  if (action === 'press' && hasCoordinateTarget(args)) {
    throw new TypeError('deepseekeyes browser: press does not accept a coordinate target')
  }
  if (action === 'type' && args.value === undefined) {
    throw new TypeError('deepseekeyes browser: type requires value')
  }
  if (action === 'select' && args.value === undefined) {
    throw new TypeError('deepseekeyes browser: select requires value')
  }
  if (action === 'press' && args.key === undefined) {
    throw new TypeError('deepseekeyes browser: press requires key')
  }
  if (args.button !== undefined && !['left', 'right', 'middle'].includes(args.button)) {
    throw new TypeError('deepseekeyes browser: button must be left, right, or middle')
  }
  if (action === 'wait') {
    args.waitFor ??= 'timeout'
    if (!WAIT_KINDS.includes(args.waitFor)) throw new TypeError(`deepseekeyes browser: unknown waitFor ${args.waitFor}`)
    if (['visible', 'hidden'].includes(args.waitFor)) requireSemanticTarget(args, action)
    if (['text', 'url'].includes(args.waitFor) && args.expected === undefined) {
      throw new TypeError(`deepseekeyes browser: waitFor ${args.waitFor} requires expected`)
    }
  }
  if (action === 'assert') {
    if (!ASSERTION_KINDS.includes(args.assertion)) {
      throw new TypeError(`deepseekeyes browser: assertion must be one of ${ASSERTION_KINDS.join(', ')}`)
    }
    if (!args.assertion.startsWith('url_') && !args.assertion.startsWith('title_')) {
      requireSemanticTarget(args, action)
    }
    if (['text_contains', 'text_equals', 'value_equals', 'url_contains', 'url_equals', 'title_contains', 'title_equals', 'count_equals'].includes(args.assertion)
      && args.expected === undefined) {
      throw new TypeError(`deepseekeyes browser: assertion ${args.assertion} requires expected`)
    }
    if (args.assertion === 'count_equals' && (!Number.isInteger(args.expected) || args.expected < 0)) {
      throw new TypeError('deepseekeyes browser: count_equals expected must be a non-negative integer')
    }
  }
  return Object.freeze(args)
}

/** Keep reports useful without persisting form values or secrets. */
export function reportableBrowserArgs(args) {
  const output = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || key === 'secret') continue
    if (key === 'value') {
      const rendered = String(value)
      output.valueLength = rendered.length
      output.valueSha256 = createHash('sha256').update(rendered).digest('hex')
      continue
    }
    output[key] = value
  }
  return output
}

export const BROWSER_TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: [...BROWSER_ACTIONS] },
    url: { type: 'string' },
    stateId: { type: 'string' },
    ref: { type: 'string' },
    selector: { type: 'string' },
    role: { type: 'string' },
    name: { type: 'string' },
    text: { type: 'string' },
    value: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    key: { type: 'string' },
    expected: {},
    assertion: { type: 'string', enum: [...ASSERTION_KINDS] },
    waitFor: { type: 'string', enum: [...WAIT_KINDS] },
    button: { type: 'string', enum: ['left', 'right', 'middle'] },
    x: { type: 'number' },
    y: { type: 'number' },
    deltaX: { type: 'number' },
    deltaY: { type: 'number' },
    timeoutMs: { type: 'integer' },
    exact: { type: 'boolean' },
    submit: { type: 'boolean' },
    secret: { type: 'boolean' },
    reportName: { type: 'string' },
  },
})

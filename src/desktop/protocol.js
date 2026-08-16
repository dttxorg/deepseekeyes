import { createHash } from 'node:crypto'

export const DESKTOP_ACTIONS = Object.freeze([
  'observe',
  'click',
  'double_click',
  'right_click',
  'move_cursor',
  'drag',
  'type',
  'key',
  'scroll',
  'invoke',
  'set_value',
  'perform_action',
  'launch',
  'focus',
  'move_window',
  'resize_window',
  'close_window',
  'wait',
  'assert',
  'report',
  'close',
])

export const DESKTOP_SCOPES = Object.freeze(['desktop', 'window'])

export const DESKTOP_ASSERTION_KINDS = Object.freeze([
  'window_exists',
  'window_title_contains',
  'element_exists',
  'element_visible',
  'element_hidden',
  'element_enabled',
  'element_disabled',
  'element_focused',
  'element_value_equals',
  'element_name_contains',
  'screen_changed',
  'screen_unchanged',
  'visual',
])

const STATEFUL_ACTIONS = new Set([
  'click', 'double_click', 'right_click', 'move_cursor', 'drag', 'type', 'key',
  'scroll', 'invoke', 'set_value', 'perform_action', 'move_window',
  'resize_window', 'close_window', 'wait', 'assert', 'report',
])

const ELEMENT_ASSERTIONS = new Set([
  'element_exists', 'element_visible', 'element_hidden', 'element_enabled',
  'element_disabled', 'element_focused', 'element_value_equals', 'element_name_contains',
])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`deepseekeyes computer: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value, field) {
  return value === undefined ? undefined : requireString(value, field)
}

function optionalNumber(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`deepseekeyes computer: ${field} must be a finite number`)
  }
  return value
}

function optionalBoolean(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new TypeError(`deepseekeyes computer: ${field} must be boolean`)
  return value
}

function optionalStringArray(value, field) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
    throw new TypeError(`deepseekeyes computer: ${field} must be an array of strings`)
  }
  return value.map(entry => entry.trim())
}

function hasWindowTarget(args) {
  return args.windowRef !== undefined || args.application !== undefined || args.title !== undefined
}

function requireWindowTarget(args, action) {
  if (!hasWindowTarget(args)) {
    throw new TypeError(`deepseekeyes computer: ${action} requires windowRef, application, or title`)
  }
}

function hasCoordinatePair(args, first = 'x', second = 'y') {
  return args[first] !== undefined || args[second] !== undefined
}

function requireCoordinatePair(args, first, second, action) {
  if (args[first] === undefined || args[second] === undefined) {
    throw new TypeError(`deepseekeyes computer: ${action} requires ${first} and ${second}`)
  }
  if (args[first] < 0 || args[second] < 0) {
    throw new RangeError(`deepseekeyes computer: ${first} and ${second} must be non-negative`)
  }
}

function requireElement(args, action) {
  if (args.elementRef === undefined) {
    throw new TypeError(`deepseekeyes computer: ${action} requires elementRef`)
  }
}

export function desktopActionNeedsState(action) {
  return STATEFUL_ACTIONS.has(action)
}

/** Validate one model-facing native desktop action and return a normalized copy. */
export function parseDesktopArgs(input) {
  if (!isPlainObject(input)) throw new TypeError('deepseekeyes computer: arguments must be an object')
  const action = requireString(input.action, 'action').toLowerCase()
  if (!DESKTOP_ACTIONS.includes(action)) {
    throw new TypeError(`deepseekeyes computer: unsupported action ${action}`)
  }
  const args = {
    action,
    stateId: optionalString(input.stateId, 'stateId'),
    scope: optionalString(input.scope, 'scope')?.toLowerCase(),
    x: optionalNumber(input.x, 'x'),
    y: optionalNumber(input.y, 'y'),
    endX: optionalNumber(input.endX, 'endX'),
    endY: optionalNumber(input.endY, 'endY'),
    deltaX: optionalNumber(input.deltaX, 'deltaX'),
    deltaY: optionalNumber(input.deltaY, 'deltaY'),
    width: optionalNumber(input.width, 'width'),
    height: optionalNumber(input.height, 'height'),
    text: input.text === undefined ? undefined : String(input.text),
    value: input.value === undefined ? undefined : String(input.value),
    key: optionalString(input.key, 'key'),
    application: optionalString(input.application, 'application'),
    title: optionalString(input.title, 'title'),
    windowRef: optionalString(input.windowRef, 'windowRef'),
    elementRef: optionalString(input.elementRef, 'elementRef'),
    actionName: optionalString(input.actionName, 'actionName'),
    arguments: optionalStringArray(input.arguments, 'arguments'),
    secret: optionalBoolean(input.secret, 'secret'),
    includeScreenshot: optionalBoolean(input.includeScreenshot, 'includeScreenshot'),
    durationMs: optionalNumber(input.durationMs, 'durationMs'),
    timeoutMs: optionalNumber(input.timeoutMs, 'timeoutMs'),
    reportName: optionalString(input.reportName, 'reportName'),
    assertion: optionalString(input.assertion, 'assertion')?.toLowerCase(),
    passed: optionalBoolean(input.passed, 'passed'),
    expected: input.expected === undefined ? undefined : String(input.expected),
    actual: input.actual === undefined ? undefined : String(input.actual),
  }

  if (args.scope !== undefined && !DESKTOP_SCOPES.includes(args.scope)) {
    throw new TypeError(`deepseekeyes computer: scope must be one of ${DESKTOP_SCOPES.join(', ')}`)
  }
  if (desktopActionNeedsState(action) && args.stateId === undefined) {
    throw new TypeError(
      `deepseekeyes computer: ${action} requires stateId from the latest computer result; `
      + 'call observe and retry with that stateId',
    )
  }
  if ((args.windowRef !== undefined || args.elementRef !== undefined)
    && args.stateId === undefined
    && action !== 'observe') {
    throw new TypeError(
      'deepseekeyes computer: windowRef and elementRef require stateId from the same latest computer result',
    )
  }
  if (args.durationMs !== undefined
    && (!Number.isInteger(args.durationMs) || args.durationMs < 0 || args.durationMs > 120_000)) {
    throw new RangeError('deepseekeyes computer: durationMs must be an integer from 0 through 120000')
  }
  if (args.timeoutMs !== undefined
    && (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1_000 || args.timeoutMs > 120_000)) {
    throw new RangeError('deepseekeyes computer: timeoutMs must be an integer from 1000 through 120000')
  }

  if (['click', 'double_click', 'right_click'].includes(action)) {
    if (args.elementRef === undefined) requireCoordinatePair(args, 'x', 'y', action)
    if (args.elementRef !== undefined && hasCoordinatePair(args)) {
      throw new TypeError(`deepseekeyes computer: ${action} accepts elementRef or x/y, not both`)
    }
  }
  if (action === 'move_cursor') requireCoordinatePair(args, 'x', 'y', action)
  if (action === 'drag') {
    requireCoordinatePair(args, 'x', 'y', action)
    requireCoordinatePair(args, 'endX', 'endY', action)
  }
  if (action === 'type' && args.text === undefined) {
    throw new TypeError('deepseekeyes computer: type requires text')
  }
  if (action === 'key' && args.key === undefined) {
    throw new TypeError('deepseekeyes computer: key requires key')
  }
  if (action === 'scroll' && args.deltaX === undefined && args.deltaY === undefined) {
    throw new TypeError('deepseekeyes computer: scroll requires deltaX or deltaY')
  }
  if (action === 'invoke') requireElement(args, action)
  if (action === 'set_value') {
    requireElement(args, action)
    if (args.value === undefined) throw new TypeError('deepseekeyes computer: set_value requires value')
  }
  if (action === 'perform_action') {
    requireElement(args, action)
    if (args.actionName === undefined) throw new TypeError('deepseekeyes computer: perform_action requires actionName')
  }
  if (action === 'launch' && args.application === undefined) {
    throw new TypeError('deepseekeyes computer: launch requires application')
  }
  if (['focus', 'close_window'].includes(action)) requireWindowTarget(args, action)
  if (action === 'move_window') {
    requireWindowTarget(args, action)
    requireCoordinatePair(args, 'x', 'y', action)
  }
  if (action === 'resize_window') {
    requireWindowTarget(args, action)
    if (args.width === undefined || args.height === undefined || args.width <= 0 || args.height <= 0) {
      throw new RangeError('deepseekeyes computer: resize_window requires positive width and height')
    }
  }
  if (action === 'wait') args.durationMs ??= 500
  if (action === 'assert') {
    if (!DESKTOP_ASSERTION_KINDS.includes(args.assertion)) {
      throw new TypeError(`deepseekeyes computer: assertion must be one of ${DESKTOP_ASSERTION_KINDS.join(', ')}`)
    }
    if (ELEMENT_ASSERTIONS.has(args.assertion)) requireElement(args, action)
    if (['window_exists', 'window_title_contains'].includes(args.assertion)) requireWindowTarget(args, action)
    if (['window_title_contains', 'element_value_equals', 'element_name_contains'].includes(args.assertion)
      && args.expected === undefined) {
      throw new TypeError(`deepseekeyes computer: assertion ${args.assertion} requires expected`)
    }
    if (args.assertion === 'visual' && args.passed === undefined) {
      throw new TypeError('deepseekeyes computer: visual assertion requires passed')
    }
  }
  return Object.freeze(args)
}

/** Remove typed or assigned text and launch arguments from persisted action reports. */
export function reportableDesktopArgs(args) {
  const output = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || key === 'secret') continue
    if (key === 'text' || key === 'value') {
      const rendered = String(value)
      output[`${key}Length`] = rendered.length
      output[`${key}Sha256`] = createHash('sha256').update(rendered).digest('hex')
      continue
    }
    if (key === 'arguments') {
      const rendered = JSON.stringify(value)
      output.argumentCount = value.length
      output.argumentsSha256 = createHash('sha256').update(rendered).digest('hex')
      continue
    }
    output[key] = value
  }
  return output
}

export const DESKTOP_TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: [...DESKTOP_ACTIONS] },
    stateId: { type: 'string' },
    scope: { type: 'string', enum: [...DESKTOP_SCOPES] },
    x: { type: 'number', minimum: 0 },
    y: { type: 'number', minimum: 0 },
    endX: { type: 'number', minimum: 0 },
    endY: { type: 'number', minimum: 0 },
    deltaX: { type: 'number' },
    deltaY: { type: 'number' },
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
    text: { type: 'string' },
    value: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    key: { type: 'string' },
    application: { type: 'string' },
    title: { type: 'string' },
    windowRef: { type: 'string' },
    elementRef: { type: 'string' },
    actionName: { type: 'string' },
    arguments: { type: 'array', items: { type: 'string' } },
    secret: { type: 'boolean' },
    includeScreenshot: { type: 'boolean' },
    durationMs: { type: 'integer', minimum: 0, maximum: 120_000 },
    timeoutMs: { type: 'integer', minimum: 1_000, maximum: 120_000 },
    reportName: { type: 'string' },
    assertion: { type: 'string', enum: [...DESKTOP_ASSERTION_KINDS] },
    passed: { type: 'boolean' },
    expected: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    actual: { type: 'string' },
  },
})

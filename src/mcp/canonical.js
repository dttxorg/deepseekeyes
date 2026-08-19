import { createHash } from 'node:crypto'

function jsonScalar(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: 'bytes', base64: Buffer.from(value).toString('base64') }
  }
  return undefined
}

/**
 * Convert arbitrary tool-boundary data into deterministic, JSON-safe data.
 * MCP values are JSON by contract; the defensive conversions keep hashing and
 * auditing available when a faulty server returns a non-JSON JavaScript value.
 */
export function canonicalValue(input) {
  const seen = new WeakSet()
  const visit = (value) => {
    const scalar = jsonScalar(value)
    if (scalar !== undefined || value === null) return scalar
    if (typeof value === 'undefined') return '[undefined]'
    if (typeof value === 'function') return '[function]'
    if (typeof value === 'symbol') return String(value)
    if (typeof value !== 'object') return String(value)
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    try {
      if (Array.isArray(value)) return value.map(visit)
      const output = {}
      for (const key of Object.keys(value).sort()) {
        // Assignment to `__proto__` invokes Object.prototype's legacy setter
        // instead of creating an own JSON field. Define every canonical field
        // as data so all valid JSON keys are preserved without touching either
        // the source or destination object's prototype.
        Object.defineProperty(output, key, {
          value: visit(value[key]),
          enumerable: true,
          configurable: true,
          writable: true,
        })
      }
      return output
    } finally {
      seen.delete(value)
    }
  }
  return visit(input)
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function hashValue(value) {
  return sha256Text(canonicalJson(value))
}

export const HASH_UNAVAILABLE = 'hash-unavailable'

export const DEFAULT_SAFE_HASH_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxStringChars: 1024 * 1024,
  maxBinaryBytes: 4 * 1024 * 1024,
})

function safeHashLimit(value, fallback, field, { zero = false } = {}) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    throw new RangeError(`${field} must be ${zero ? 'a non-negative' : 'a positive'} safe integer`)
  }
  return value
}

function safeHashLimits(input) {
  const source = input ?? {}
  return {
    maxDepth: safeHashLimit(source.maxDepth, DEFAULT_SAFE_HASH_LIMITS.maxDepth, 'maxDepth', { zero: true }),
    maxNodes: safeHashLimit(source.maxNodes, DEFAULT_SAFE_HASH_LIMITS.maxNodes, 'maxNodes'),
    maxStringChars: safeHashLimit(
      source.maxStringChars,
      DEFAULT_SAFE_HASH_LIMITS.maxStringChars,
      'maxStringChars',
    ),
    maxBinaryBytes: safeHashLimit(
      source.maxBinaryBytes,
      DEFAULT_SAFE_HASH_LIMITS.maxBinaryBytes,
      'maxBinaryBytes',
    ),
  }
}

function unavailableHash() {
  throw new RangeError(HASH_UNAVAILABLE)
}

function updateMarker(hash, marker) {
  hash.update(`${marker.length}:`)
  hash.update(marker)
}

/**
 * Hash untrusted call metadata without recursive canonicalization. Any depth,
 * size, getter or Proxy failure returns a fixed sentinel instead of escaping
 * into presentation/audit code. Normal objects remain deterministic because
 * own enumerable string keys are sorted before traversal.
 */
export function safeHashValue(value, options = {}) {
  try {
    const limits = safeHashLimits(options)
    const stats = { nodes: 0, stringChars: 0, binaryBytes: 0 }
    const hash = createHash('sha256')
    const ancestors = new WeakSet()
    const stack = [{ kind: 'value', value, depth: 0 }]

    const updateString = (kind, text) => {
      stats.stringChars += text.length
      if (stats.stringChars > limits.maxStringChars) unavailableHash()
      updateMarker(hash, kind)
      // JSON quoting makes unpaired UTF-16 code units unambiguous while the
      // aggregate bound prevents this temporary representation from growing.
      hash.update(JSON.stringify(text))
    }

    while (stack.length > 0) {
      const entry = stack.pop()
      if (entry.kind === 'end') {
        updateMarker(hash, entry.marker)
        ancestors.delete(entry.value)
        continue
      }
      if (entry.kind === 'property') {
        updateString('key', entry.key)
        stack.push({ kind: 'value', value: entry.object[entry.key], depth: entry.depth })
        continue
      }
      if (entry.kind === 'array-item') {
        updateMarker(hash, `index:${entry.index}`)
        if (!Object.hasOwn(entry.array, entry.index)) {
          updateMarker(hash, 'hole')
        } else {
          stack.push({ kind: 'value', value: entry.array[entry.index], depth: entry.depth })
        }
        continue
      }

      if (entry.depth > limits.maxDepth) unavailableHash()
      stats.nodes += 1
      if (stats.nodes > limits.maxNodes) unavailableHash()
      const current = entry.value
      if (current === null) {
        updateMarker(hash, 'null')
        continue
      }
      const type = typeof current
      if (type === 'string') {
        updateString('string', current)
        continue
      }
      if (type === 'boolean') {
        updateMarker(hash, current ? 'boolean:true' : 'boolean:false')
        continue
      }
      if (type === 'number') {
        updateMarker(hash, `number:${Number.isFinite(current) ? (Object.is(current, -0) ? '0' : current) : String(current)}`)
        continue
      }
      if (type === 'bigint') {
        updateString('bigint', current.toString())
        continue
      }
      if (type === 'undefined') {
        updateMarker(hash, 'undefined')
        continue
      }
      if (type === 'function') {
        updateMarker(hash, 'function')
        continue
      }
      if (type === 'symbol') {
        updateString('symbol', String(current))
        continue
      }
      if (Buffer.isBuffer(current) || current instanceof Uint8Array) {
        stats.binaryBytes += current.byteLength
        if (stats.binaryBytes > limits.maxBinaryBytes) unavailableHash()
        updateMarker(hash, `binary:${current.byteLength}`)
        hash.update(current)
        continue
      }
      if (current instanceof Date) {
        updateString('date', current.toISOString())
        continue
      }
      if (ancestors.has(current)) {
        updateMarker(hash, 'circular')
        continue
      }
      ancestors.add(current)

      if (Array.isArray(current)) {
        if (current.length > limits.maxNodes - stats.nodes) unavailableHash()
        if (stack.length + current.length + 1 > limits.maxNodes * 2) unavailableHash()
        updateMarker(hash, `array:${current.length}`)
        stack.push({ kind: 'end', marker: 'array:end', value: current })
        for (let index = current.length - 1; index >= 0; index -= 1) {
          stack.push({ kind: 'array-item', array: current, index, depth: entry.depth + 1 })
        }
        continue
      }

      const keys = Object.keys(current).sort()
      if (keys.length > limits.maxNodes - stats.nodes) unavailableHash()
      if (stack.length + keys.length + 1 > limits.maxNodes * 2) unavailableHash()
      updateMarker(hash, `object:${keys.length}`)
      stack.push({ kind: 'end', marker: 'object:end', value: current })
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        stack.push({ kind: 'property', object: current, key: keys[index], depth: entry.depth + 1 })
      }
    }
    return hash.digest('hex')
  } catch {
    return HASH_UNAVAILABLE
  }
}

/** Return sorted argument keys without allowing revoked/throwing Proxies out. */
export function safeObjectKeys(value, { maxKeys = 256, maxKeyChars = 8_192 } = {}) {
  try {
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1
      || !Number.isSafeInteger(maxKeyChars) || maxKeyChars < 1
      || value === null || typeof value !== 'object' || Array.isArray(value)) return Object.freeze([])
    const keys = Object.keys(value).sort()
    if (keys.length > maxKeys) return Object.freeze([])
    let characters = 0
    for (const key of keys) {
      characters += key.length
      if (characters > maxKeyChars) return Object.freeze([])
    }
    return Object.freeze(keys)
  } catch {
    return Object.freeze([])
  }
}

function untrustedErrorMessage(error) {
  try {
    if (error instanceof Error || typeof error?.message === 'string') return String(error.message)
    return String(error)
  } catch {
    return 'unknown error'
  }
}

export function hashErrorMessage(error) {
  return safeHashValue(untrustedErrorMessage(error))
}

export function boundedUnicode(text, maximum) {
  if (text.length <= maximum) return { text, truncated: false }
  if (maximum <= 1) return { text: '…'.slice(0, maximum), truncated: true }
  let prefix = text.slice(0, maximum - 1)
  const finalCode = prefix.charCodeAt(prefix.length - 1)
  if (finalCode >= 0xD800 && finalCode <= 0xDBFF) prefix = prefix.slice(0, -1)
  return { text: `${prefix}…`, truncated: true }
}

const SENSITIVE_ASSIGNMENT_KEY = [
  'access[_-]?token',
  'refresh[_-]?token',
  'id[_-]?token',
  'auth[_-]?token',
  'api[_-]?key',
  'apikey',
  'client[_-]?secret',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
].join('|')

const SENSITIVE_ASSIGNMENT = new RegExp(
  `((?:["']?\\b(?:${SENSITIVE_ASSIGNMENT_KEY})\\b["']?)\\s*[:=]\\s*)`
    + `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;&}]+)`,
  'gi',
)

// An Authorization value can be a multi-parameter scheme such as Digest, not
// just one Basic/Bearer token. Prefer a complete quoted value; otherwise redact
// the rest of that header line so trailing nonce/response parameters cannot
// escape the boundary.
const AUTHORIZATION_HEADER = /(\b(?:proxy-)?authorization\b["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]+)/gi
const API_KEY_HEADER = /(\bx-api-key\b["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi
const COOKIE_HEADER = /(\b(?:set-cookie|cookie)\b["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]+)/gi
const URL_USERINFO = /\b(https?:\/\/)[^@\s/?#]+@(?=(?:\[[^\]]+\]|[^/\s?#]+))/gi

const COMMON_TOKEN_PREFIXES = [
  /\b(?:sk[-_](?:[A-Za-z0-9._-]{8,})|rk_live_[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9_-]{8,}|pypi-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_-]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9_-]{8,}|hvs\.[A-Za-z0-9_-]{8,})\b/gi,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bSG\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bya29\.[A-Za-z0-9._-]{8,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
]

function quotedRedaction(value) {
  if (value.startsWith('"')) return '"[REDACTED]"'
  if (value.startsWith("'")) return "'[REDACTED]'"
  return '[REDACTED]'
}

function authorizationRedaction(value) {
  const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
  const unquoted = quote === '' ? value : value.slice(1, value.endsWith(quote) ? -1 : undefined)
  const scheme = /^(Bearer|Basic)\s+/i.exec(unquoted)?.[1]
  if (scheme === undefined) return quotedRedaction(value)
  return `${quote}${scheme} [REDACTED]${quote}`
}

/**
 * Remove credentials from untrusted transport text without erasing ordinary
 * words such as "token budget" or "password authentication". Header names,
 * assignment keys, error codes and non-sensitive paths remain useful to the
 * local operator.
 */
export function redactSensitiveText(value) {
  let text = String(value)
  text = text.replace(URL_USERINFO, '$1[REDACTED]@')
  text = text.replace(COOKIE_HEADER, (_match, prefix, secret) => `${prefix}${quotedRedaction(secret)}`)
  text = text.replace(AUTHORIZATION_HEADER, (_match, prefix, secret) => `${prefix}${authorizationRedaction(secret)}`)
  text = text.replace(API_KEY_HEADER, (_match, prefix, secret) => `${prefix}${quotedRedaction(secret)}`)
  text = text.replace(
    /\b(Bearer\s+)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z0-9._~+/=-]{4,})/gi,
    (_match, prefix, secret) => `${prefix}${quotedRedaction(secret)}`,
  )
  text = text.replace(
    /\b(Basic\s+)(?!(?:authentication|authorization|challenge|scheme)\b)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z0-9+/]{8,}={0,2})/gi,
    (_match, prefix, secret) => `${prefix}${quotedRedaction(secret)}`,
  )
  text = text.replace(
    SENSITIVE_ASSIGNMENT,
    (_match, prefix, secret) => `${prefix}${quotedRedaction(secret)}`,
  )
  for (const pattern of COMMON_TOKEN_PREFIXES) text = text.replace(pattern, '[REDACTED_TOKEN]')
  return text
}

export function safeError(error, maximum = 500) {
  const untrusted = untrustedErrorMessage(error)
  const redacted = redactSensitiveText(untrusted)
    .replace(/\s+/g, ' ')
    .trim()
  const requestedMaximum = Number.isFinite(Number(maximum)) ? Math.trunc(Number(maximum)) : 500
  const boundedMaximum = Math.max(0, Math.min(500, requestedMaximum))
  return boundedUnicode(redacted, boundedMaximum).text
}

/** Keep machine-readable codes useful while applying the same secret boundary. */
export function safeErrorCode(error, fallback, maximum = 100) {
  let untrustedCode
  try {
    untrustedCode = error?.code
  } catch {
    return fallback
  }
  if (typeof untrustedCode !== 'string' || untrustedCode.trim() === '') return fallback
  const requestedMaximum = Number.isFinite(Number(maximum)) ? Math.trunc(Number(maximum)) : 100
  const code = safeError(untrustedCode, Math.max(0, Math.min(100, requestedMaximum)))
  return code === '' ? fallback : code
}

import { homedir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from './canonical.js'
import { mcpArgsContainInlineCredentials } from './credential-policy.js'
import { mcpHttpUrlUsesSecureTransport } from './url-policy.js'
import { normalizeMcpOAuthAuthMethod } from './oauth.js'

export { mcpArgsContainInlineCredentials } from './credential-policy.js'

export const DEFAULT_MCP_MAX_TOOLS = 16
export const DEFAULT_MCP_MAX_SCHEMA_TOKENS = 12_000
export const DEFAULT_MCP_MAX_RESULT_CHARS = 20_000
export const DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS = 30_000
export const DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN = 64
export const DEFAULT_MCP_AUDIT_LIMIT = 200
export const MCP_RISK_POLICIES = Object.freeze(['allow', 'read-only'])
export const DEFAULT_MCP_RISK_POLICY = 'allow'
export const MCP_SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
export const MCP_TRANSPORTS = Object.freeze(['stdio', 'streamable-http'])
const MCP_PUBLIC_SERVER_FIELDS = new Set([
  'id', 'name', 'enabled', 'transport', 'command', 'args', 'cwd', 'url',
  'env', 'headers', 'toolsEnabled', 'resourcesEnabled', 'promptsEnabled', 'riskPolicy',
  'allowedTools', 'denyTools', 'allowedResources', 'denyResources',
  'allowedPrompts', 'denyPrompts', 'timeoutMs', 'oauth',
])
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const CREDENTIAL_QUERY_PATTERN = /(?:api[-_]?key|authorization|credential|password|secret|signature|token)/i

function objectValue(value, field, fallback = {}) {
  const resolved = value ?? fallback
  if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new TypeError(`deepseekeyes: ${field} must be an object`)
  }
  return resolved
}

function stringValue(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new TypeError(`deepseekeyes: ${field} must be a non-empty string`)
    return undefined
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`deepseekeyes: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function booleanValue(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`deepseekeyes: ${field} must be boolean`)
  return value
}

function integerValue(value, field, fallback, minimum, maximum, { zero = false } = {}) {
  const resolved = value ?? fallback
  if (zero && resolved === 0) return 0
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    const zeroText = zero ? '0 for unlimited or ' : ''
    throw new RangeError(`deepseekeyes: ${field} must be ${zeroText}an integer from ${minimum} through ${maximum}`)
  }
  return resolved
}

function stringList(value, field, strict = false) {
  if (value === undefined || value === null || value === '') return Object.freeze([])
  if (strict && !Array.isArray(value)) throw new TypeError(`deepseekeyes: ${field} must be a string array`)
  const entries = Array.isArray(value) ? value : String(value).split(/[\n,]+/)
  const output = []
  const seen = new Set()
  for (const entry of entries) {
    const normalized = stringValue(entry, field, { required: true })
    if (strict && seen.has(normalized)) throw new TypeError(`deepseekeyes: ${field} contains duplicate value ${normalized}`)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      output.push(normalized)
    }
  }
  return Object.freeze(output)
}

function credentialReference(value, field, strict = false) {
  if (strict && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError(`deepseekeyes: ${field} must contain only an env reference`)
  }
  if (strict && (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'env'))) {
    throw new TypeError(`deepseekeyes: ${field} must contain only an env reference`)
  }
  const candidate = typeof value === 'string' ? value : objectValue(value, field).env
  const env = stringValue(candidate, `${field}.env`, { required: true })
  if (!ENVIRONMENT_NAME_PATTERN.test(env)) {
    throw new TypeError(`deepseekeyes: ${field}.env must be an environment variable name`)
  }
  return Object.freeze({ env })
}

function credentialMap(value, field, { strict = false, keyPattern = undefined, keyDescription = undefined } = {}) {
  const output = {}
  for (const [key, reference] of Object.entries(objectValue(value, field))) {
    const normalizedKey = stringValue(key, `${field} key`, { required: true })
    if (keyPattern !== undefined && !keyPattern.test(normalizedKey)) {
      throw new TypeError(`deepseekeyes: ${field} key ${normalizedKey} must be ${keyDescription}`)
    }
    output[normalizedKey] = credentialReference(reference, `${field}.${normalizedKey}`, strict)
  }
  return Object.freeze(output)
}

function oauthValue(value, field, strict = false) {
  const source = objectValue(value, field, {})
  if (strict) {
    for (const key of Object.keys(source)) {
      if (!['enabled', 'clientId', 'clientSecret', 'scope', 'authMethod'].includes(key)) {
        throw new TypeError(`deepseekeyes: ${field} has unknown field ${key}`)
      }
    }
  }
  const enabled = booleanValue(source.enabled, `${field}.enabled`, false)
  if (!enabled) return Object.freeze({ enabled: false })
  const clientId = credentialReference(source.clientId, `${field}.clientId`, strict)
  const clientSecret = credentialReference(source.clientSecret, `${field}.clientSecret`, strict)
  const scope = stringValue(source.scope, `${field}.scope`)
  const authMethod = normalizeMcpOAuthAuthMethod(source.authMethod, `${field}.authMethod`)
  return Object.freeze({
    enabled: true,
    clientId,
    clientSecret,
    ...(scope === undefined ? {} : { scope }),
    ...(authMethod === undefined ? {} : { authMethod }),
  })
}

function reconnectValue(value, field) {
  const input = objectValue(value, field)
  return Object.freeze({
    enabled: booleanValue(input.enabled, `${field}.enabled`, true),
    initialDelayMs: integerValue(input.initialDelayMs, `${field}.initialDelayMs`, 500, 10, 3_600_000),
    maxDelayMs: integerValue(input.maxDelayMs, `${field}.maxDelayMs`, 30_000, 10, 3_600_000),
    maxAttempts: integerValue(input.maxAttempts, `${field}.maxAttempts`, 10, 1, 10_000),
  })
}

export function normalizeMcpServer(input, index = 0, defaults = {}) {
  const source = objectValue(input, `mcpServers[${index}]`)
  const strict = defaults.strict === true
  if (strict) {
    for (const key of Object.keys(source)) {
      if (!MCP_PUBLIC_SERVER_FIELDS.has(key)) {
        throw new TypeError(`deepseekeyes: mcpServers[${index}] has unknown field ${key}`)
      }
    }
  }
  const id = stringValue(source.id ?? source.serverName, `mcpServers[${index}].id`, { required: true })
  if (!MCP_SERVER_ID_PATTERN.test(id)) {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].id must match ${MCP_SERVER_ID_PATTERN}`)
  }
  const name = stringValue(source.name, `mcpServers[${index}].name`, { required: strict }) ?? id
  const transport = stringValue(source.transport, `mcpServers[${index}].transport`, { required: true }).toLowerCase()
  if (!MCP_TRANSPORTS.includes(transport)) {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].transport must be one of ${MCP_TRANSPORTS.join(', ')}`)
  }
  const explicitTimeout = source.timeoutMs ?? source.toolCallTimeoutMs
  const resolvedTimeout = integerValue(
    explicitTimeout,
    `mcpServers[${index}].timeoutMs`,
    defaults.toolCallTimeoutMs ?? DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
    100,
    3_600_000,
  )
  const common = {
    id,
    name,
    enabled: booleanValue(source.enabled, `mcpServers[${index}].enabled`, true),
    toolsEnabled: booleanValue(source.toolsEnabled, `mcpServers[${index}].toolsEnabled`, true),
    resourcesEnabled: booleanValue(source.resourcesEnabled, `mcpServers[${index}].resourcesEnabled`, false),
    promptsEnabled: booleanValue(source.promptsEnabled, `mcpServers[${index}].promptsEnabled`, false),
    riskPolicy: stringValue(source.riskPolicy, `mcpServers[${index}].riskPolicy`) ?? DEFAULT_MCP_RISK_POLICY,
    transport,
    allowedTools: stringList(source.allowedTools ?? source.allowlist, `mcpServers[${index}].allowedTools`, strict),
    denyTools: stringList(source.denyTools ?? source.deniedTools ?? source.denylist, `mcpServers[${index}].denyTools`, strict),
    allowedResources: stringList(source.allowedResources, `mcpServers[${index}].allowedResources`, strict),
    denyResources: stringList(source.denyResources, `mcpServers[${index}].denyResources`, strict),
    allowedPrompts: stringList(source.allowedPrompts, `mcpServers[${index}].allowedPrompts`, strict),
    denyPrompts: stringList(source.denyPrompts, `mcpServers[${index}].denyPrompts`, strict),
    ...(!strict || explicitTimeout !== undefined ? { timeoutMs: resolvedTimeout } : {}),
    ...(strict ? {} : {
      failOnStartupError: booleanValue(source.failOnStartupError, `mcpServers[${index}].failOnStartupError`, false),
      reconnect: reconnectValue(source.reconnect, `mcpServers[${index}].reconnect`),
    }),
  }
  if (!MCP_RISK_POLICIES.includes(common.riskPolicy)) {
    throw new TypeError(
      `deepseekeyes: mcpServers[${index}].riskPolicy must be one of ${MCP_RISK_POLICIES.join(', ')}`,
    )
  }
  if (strict) {
    for (const [allowField, denyField] of [
      ['allowedTools', 'denyTools'],
      ['allowedResources', 'denyResources'],
      ['allowedPrompts', 'denyPrompts'],
    ]) {
      const denied = new Set(common[denyField])
      const overlap = common[allowField].find(value => denied.has(value))
      if (overlap !== undefined) {
        throw new TypeError(
          `deepseekeyes: mcpServers[${index}].${overlap} cannot appear in both ${allowField} and ${denyField}`,
        )
      }
    }
  }
  if (transport === 'stdio') {
    const args = source.args ?? []
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].args must be an array of strings`)
    }
    if (strict && mcpArgsContainInlineCredentials(args)) {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].args credentials must use env references`)
    }
    if (strict && source.url !== undefined && source.url !== null && source.url !== '') {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].url is only valid for streamable-http`)
    }
    if (strict && source.headers !== undefined && Object.keys(objectValue(source.headers, `mcpServers[${index}].headers`)).length > 0) {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].headers is only valid for streamable-http`)
    }
    if (strict && source.oauth !== undefined && oauthValue(source.oauth, `mcpServers[${index}].oauth`, strict).enabled) {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].oauth is only valid for streamable-http`)
    }
    return Object.freeze({
      ...common,
      command: stringValue(source.command, `mcpServers[${index}].command`, { required: true }),
      args: Object.freeze([...args]),
      cwd: stringValue(source.cwd, `mcpServers[${index}].cwd`),
      env: credentialMap(source.env, `mcpServers[${index}].env`, {
        strict,
        ...(strict ? { keyPattern: ENVIRONMENT_NAME_PATTERN, keyDescription: 'an environment variable name' } : {}),
      }),
      oauth: Object.freeze({ enabled: false }),
    })
  }
  const urlText = stringValue(source.url, `mcpServers[${index}].url`, { required: true })
  let url
  try {
    url = new URL(urlText)
  } catch {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].url must be a valid http(s) URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].url must use http or https`)
  }
  if (!mcpHttpUrlUsesSecureTransport(url)) {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].url must use https unless the hostname is explicit loopback`)
  }
  if (url.username || url.password) {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].url must not contain credentials`)
  }
  if (strict) {
    for (const key of url.searchParams.keys()) {
      if (CREDENTIAL_QUERY_PATTERN.test(key)) {
        throw new TypeError(`deepseekeyes: mcpServers[${index}].url credentials must use header env references`)
      }
    }
    if (source.command !== undefined && source.command !== null && source.command !== '') {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].command is only valid for stdio`)
    }
    if (source.cwd !== undefined && source.cwd !== null && source.cwd !== '') {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].cwd is only valid for stdio`)
    }
    if (source.args !== undefined && (!Array.isArray(source.args) || source.args.length > 0)) {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].args is only valid for stdio`)
    }
    if (source.env !== undefined && Object.keys(objectValue(source.env, `mcpServers[${index}].env`)).length > 0) {
      throw new TypeError(`deepseekeyes: mcpServers[${index}].env is only valid for stdio`)
    }
  }
  const oauth = oauthValue(source.oauth, `mcpServers[${index}].oauth`, strict)
  if (oauth.enabled && Object.keys(source.headers ?? {}).some(key => key.toLowerCase() === 'authorization')) {
    throw new TypeError(`deepseekeyes: mcpServers[${index}].oauth cannot be combined with an Authorization header`)
  }
  return Object.freeze({
    ...common,
    url: url.toString(),
    headers: credentialMap(source.headers, `mcpServers[${index}].headers`, {
      strict,
      ...(strict ? { keyPattern: HTTP_HEADER_NAME_PATTERN, keyDescription: 'a valid HTTP header name' } : {}),
    }),
    oauth,
  })
}

/** Normalize the MCP subset independently so callers can reuse it before config.js is wired. */
export function normalizeMcpConfig(input = {}, { home = homedir(), strict = false } = {}) {
  const source = objectValue(input, 'MCP config')
  const toolCallTimeoutMs = integerValue(
    source.mcpToolCallTimeoutMs,
    'mcpToolCallTimeoutMs',
    DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
    100,
    3_600_000,
  )
  const rawServers = source.mcpServers ?? []
  if (!Array.isArray(rawServers)) throw new TypeError('deepseekeyes: mcpServers must be an array')
  const servers = rawServers.map((server, index) => normalizeMcpServer(server, index, { toolCallTimeoutMs, strict }))
  const identities = new Set()
  const names = new Set()
  for (const server of servers) {
    const identity = strict ? server.id.toLowerCase() : server.id
    const displayName = strict ? server.name.toLocaleLowerCase('en-US') : server.name
    if (identities.has(identity)) throw new TypeError(`deepseekeyes: duplicate MCP server id ${server.id}`)
    if (names.has(displayName)) throw new TypeError(`deepseekeyes: duplicate MCP server name ${server.name}`)
    identities.add(identity)
    names.add(displayName)
  }
  const artifactInput = source.mcpArtifactDir
  let artifactDir
  if (artifactInput !== false && !(Object.hasOwn(source, 'mcpArtifactDir') && artifactInput === undefined)) {
    artifactDir = stringValue(artifactInput, 'mcpArtifactDir')
      ?? join(home, '.dsh', 'deepseekeyes', 'mcp-artifacts')
  }
  return Object.freeze({
    providerId: stringValue(source.providerId, 'providerId') ?? 'deepseekeyes',
    mcpEnabled: booleanValue(source.mcpEnabled, 'mcpEnabled', false),
    mcpServers: Object.freeze(servers),
    mcpMaxTools: integerValue(source.mcpMaxTools, 'mcpMaxTools', DEFAULT_MCP_MAX_TOOLS, 1, 1_000, { zero: true }),
    mcpMaxSchemaTokens: integerValue(
      source.mcpMaxSchemaTokens,
      'mcpMaxSchemaTokens',
      DEFAULT_MCP_MAX_SCHEMA_TOKENS,
      256,
      10_000_000,
      { zero: true },
    ),
    mcpMaxResultChars: integerValue(
      source.mcpMaxResultChars,
      'mcpMaxResultChars',
      DEFAULT_MCP_MAX_RESULT_CHARS,
      256,
      10_000_000,
    ),
    mcpMaxExternalCallsPerRun: integerValue(
      source.mcpMaxExternalCallsPerRun,
      'mcpMaxExternalCallsPerRun',
      DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN,
      1,
      10_000,
      { zero: true },
    ),
    mcpToolCallTimeoutMs: toolCallTimeoutMs,
    mcpAudit: booleanValue(source.mcpAudit, 'mcpAudit', true),
    mcpAuditLimit: integerValue(source.mcpAuditLimit, 'mcpAuditLimit', DEFAULT_MCP_AUDIT_LIMIT, 1, 10_000),
    mcpArtifactDir: artifactDir,
  })
}

export function mcpConnectionFingerprint(server) {
  const {
    allowedTools: _allowedTools,
    denyTools: _denyTools,
    allowedResources: _allowedResources,
    denyResources: _denyResources,
    allowedPrompts: _allowedPrompts,
    denyPrompts: _denyPrompts,
    name: _name,
    ...connection
  } = server
  return canonicalJson(connection)
}

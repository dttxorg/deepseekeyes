import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MCP_MAX_RESULT_CHARS,
  DEFAULT_MCP_MAX_SCHEMA_TOKENS,
  DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN,
  DEFAULT_MCP_MAX_TOOLS,
  DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
  MCP_SERVER_ID_PATTERN,
  MCP_TRANSPORTS,
} from './mcp/config.js'
import { mcpArgsContainInlineCredentials } from './mcp/credential-policy.js'
import { mcpHttpUrlUsesSecureTransport } from './mcp/url-policy.js'

export {
  DEFAULT_MCP_MAX_RESULT_CHARS,
  DEFAULT_MCP_MAX_SCHEMA_TOKENS,
  DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN,
  DEFAULT_MCP_MAX_TOOLS,
  DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
  MCP_TRANSPORTS,
} from './mcp/config.js'

export const DEFAULT_PROVIDER_ID = 'deepseekeyes'
export const DEFAULT_UPSTREAM_PROVIDER = 'deepseek-official'
export const DEFAULT_MAX_CLARIFICATIONS = 3
export const UNLIMITED_TOKEN_BUDGET = 0
export const DEFAULT_BASE_MAX_TOKENS = 16_384
export const DEFAULT_TARGET_MAX_TOKENS = 8_192
export const DEFAULT_AUTOMATION_CONTEXT_MAX_TOKENS = 32_768
export const DEFAULT_AUTOMATION_MAX_CALLS_PER_TURN = 32
export const DEFAULT_VISION_FAILOVER_ATTEMPTS = 2
export const DEFAULT_VISION_HEALTH_TTL_MS = 60_000
export const DEFAULT_VISION_FAILURE_COOLDOWN_MS = 30_000
export const DEFAULT_VISION_ATTEMPT_LIMIT = 1_000
export const DEFAULT_HISTORY_IMAGE_LIMIT = 8
export const DEFAULT_HISTORY_SUMMARY_CHARS = 320
export const DEFAULT_BROWSER_HISTORY_LIMIT = 8
export const DEFAULT_BROWSER_TIMEOUT_MS = 15_000
export const DEFAULT_BROWSER_SETTLE_MS = 300
export const DEFAULT_BROWSER_VIEWPORT_WIDTH = 1440
export const DEFAULT_BROWSER_VIEWPORT_HEIGHT = 900
export const DEFAULT_BROWSER_MAX_ELEMENTS = 200
export const DEFAULT_BROWSER_MAX_TEXT_CHARS = 20_000
export const DEFAULT_DESKTOP_HISTORY_LIMIT = 8
export const DESKTOP_VISUAL_MODES = Object.freeze(['auto', 'always', 'manual'])
export const DEFAULT_DESKTOP_VISUAL_MODE = 'auto'
export const DEFAULT_DESKTOP_TIMEOUT_MS = 30_000
export const DEFAULT_DESKTOP_SETTLE_MS = 300
export const DEFAULT_DESKTOP_MAX_WINDOWS = 50
export const DEFAULT_DESKTOP_MAX_ELEMENTS = 200
export const DEFAULT_DESKTOP_MAC_DISPLAY = 1
const MCP_SERVER_FIELDS = new Set([
  'id',
  'name',
  'enabled',
  'transport',
  'command',
  'args',
  'cwd',
  'url',
  'env',
  'headers',
  'toolsEnabled',
  'resourcesEnabled',
  'promptsEnabled',
  'allowedTools',
  'denyTools',
  'allowedResources',
  'denyResources',
  'allowedPrompts',
  'denyPrompts',
  'timeoutMs',
])
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const CREDENTIAL_QUERY_PATTERN = /(?:api[-_]?key|authorization|credential|password|secret|signature|token)/i

function optionalString(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`deepseekeyes: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requiredString(value, field, fallback) {
  const resolved = optionalString(value ?? fallback, field)
  if (resolved === undefined) {
    throw new TypeError(`deepseekeyes: ${field} must be a non-empty string`)
  }
  return resolved
}

function booleanValue(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`deepseekeyes: ${field} must be boolean`)
  return value
}

function choiceValue(value, field, fallback, choices) {
  const resolved = optionalString(value ?? fallback, field)?.toLowerCase()
  if (!choices.includes(resolved)) {
    throw new TypeError(`deepseekeyes: ${field} must be one of ${choices.join(', ')}`)
  }
  return resolved
}

function environmentBoolean(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  throw new TypeError(`deepseekeyes: ${field} environment value must be true or false`)
}

function environmentInteger(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim()
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new TypeError(`deepseekeyes: ${field} environment value must be a non-negative integer`)
  }
  const resolved = Number(normalized)
  if (!Number.isSafeInteger(resolved)) {
    throw new RangeError(`deepseekeyes: ${field} environment value exceeds the safe integer range`)
  }
  return resolved
}

function integerValue(value, field, fallback, minimum, maximum) {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(
      `deepseekeyes: ${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return resolved
}

function integerOrUnlimitedValue(value, field, fallback, minimum, maximum) {
  const resolved = value ?? fallback
  if (resolved === UNLIMITED_TOKEN_BUDGET) return UNLIMITED_TOKEN_BUDGET
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(
      `deepseekeyes: ${field} must be 0 for unlimited or an integer from ${minimum} through ${maximum}`,
    )
  }
  return resolved
}

function tokenBudgetValue(value, field, fallback, minimum) {
  const resolved = value ?? fallback
  if (resolved === UNLIMITED_TOKEN_BUDGET) return UNLIMITED_TOKEN_BUDGET
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw new RangeError(
      `deepseekeyes: ${field} must be 0 for provider-managed output or a safe integer of at least ${minimum}`,
    )
  }
  return resolved
}

function automationContextBudgetValue(value, field, fallback) {
  const resolved = value ?? fallback
  if (resolved === UNLIMITED_TOKEN_BUDGET) return UNLIMITED_TOKEN_BUDGET
  if (!Number.isSafeInteger(resolved) || resolved < 4_096) {
    throw new RangeError(
      `deepseekeyes: ${field} must be 0 for unlimited context or a safe integer of at least 4096`,
    )
  }
  return resolved
}

function plainObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`deepseekeyes: ${field} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`deepseekeyes: ${field} must be a plain serializable object`)
  }
  return value
}

function stringList(value, field, unique = false) {
  if (value === undefined || value === null) return Object.freeze([])
  if (!Array.isArray(value)) {
    throw new TypeError(`deepseekeyes: ${field} must be a string array`)
  }
  const result = []
  const seen = new Set()
  for (let index = 0; index < value.length; index += 1) {
    const entry = requiredString(value[index], `${field}[${index}]`)
    if (unique && seen.has(entry)) {
      throw new TypeError(`deepseekeyes: ${field} contains duplicate value ${entry}`)
    }
    seen.add(entry)
    result.push(entry)
  }
  return Object.freeze(result)
}

function environmentReference(value, field) {
  const source = plainObject(value, field)
  const keys = Object.keys(source)
  if (keys.length !== 1 || keys[0] !== 'env') {
    throw new TypeError(`deepseekeyes: ${field} must contain only an env reference`)
  }
  const env = requiredString(source.env, `${field}.env`)
  if (!ENVIRONMENT_NAME_PATTERN.test(env)) {
    throw new TypeError(`deepseekeyes: ${field}.env must be an environment variable name`)
  }
  return Object.freeze({ env })
}

function environmentReferenceMap(value, field, keyPattern, keyDescription) {
  if (value === undefined || value === null) return Object.freeze({})
  const source = plainObject(value, field)
  const result = Object.create(null)
  for (const [key, reference] of Object.entries(source)) {
    if (!keyPattern.test(key)) {
      throw new TypeError(`deepseekeyes: ${field} key ${key} must be ${keyDescription}`)
    }
    result[key] = environmentReference(reference, `${field}.${key}`)
  }
  return Object.freeze(result)
}

function validateHttpUrl(value, field) {
  const input = requiredString(value, field)
  let parsed
  try {
    parsed = new URL(input)
  } catch {
    throw new TypeError(`deepseekeyes: ${field} must be a valid HTTP(S) URL`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError(`deepseekeyes: ${field} must use http or https`)
  }
  if (!mcpHttpUrlUsesSecureTransport(parsed)) {
    throw new TypeError(`deepseekeyes: ${field} must use https unless the hostname is explicit loopback`)
  }
  if (parsed.username || parsed.password) {
    throw new TypeError(`deepseekeyes: ${field} cannot contain inline credentials`)
  }
  for (const key of parsed.searchParams.keys()) {
    if (CREDENTIAL_QUERY_PATTERN.test(key)) {
      throw new TypeError(`deepseekeyes: ${field} credentials must use header env references`)
    }
  }
  return input
}

function resolveMcpServer(value, index) {
  const field = `mcpServers[${index}]`
  const source = plainObject(value, field)
  for (const key of Object.keys(source)) {
    if (!MCP_SERVER_FIELDS.has(key)) {
      throw new TypeError(`deepseekeyes: ${field} has unknown field ${key}`)
    }
  }

  const id = requiredString(source.id, `${field}.id`)
  if (!MCP_SERVER_ID_PATTERN.test(id)) {
    throw new TypeError(
      `deepseekeyes: ${field}.id must use 1-32 letters, numbers, underscores, or hyphens`,
    )
  }
  const name = requiredString(source.name, `${field}.name`)
  const transport = choiceValue(source.transport, `${field}.transport`, undefined, MCP_TRANSPORTS)
  const enabled = booleanValue(source.enabled, `${field}.enabled`, true)
  const toolsEnabled = booleanValue(source.toolsEnabled, `${field}.toolsEnabled`, true)
  const resourcesEnabled = booleanValue(source.resourcesEnabled, `${field}.resourcesEnabled`, false)
  const promptsEnabled = booleanValue(source.promptsEnabled, `${field}.promptsEnabled`, false)
  const allowedTools = stringList(source.allowedTools, `${field}.allowedTools`, true)
  const denyTools = stringList(source.denyTools, `${field}.denyTools`, true)
  const allowedResources = stringList(source.allowedResources, `${field}.allowedResources`, true)
  const denyResources = stringList(source.denyResources, `${field}.denyResources`, true)
  const allowedPrompts = stringList(source.allowedPrompts, `${field}.allowedPrompts`, true)
  const denyPrompts = stringList(source.denyPrompts, `${field}.denyPrompts`, true)
  for (const [allowField, denyField, allowed, deniedValues] of [
    ['allowedTools', 'denyTools', allowedTools, denyTools],
    ['allowedResources', 'denyResources', allowedResources, denyResources],
    ['allowedPrompts', 'denyPrompts', allowedPrompts, denyPrompts],
  ]) {
    const denied = new Set(deniedValues)
    for (const value of allowed) {
      if (denied.has(value)) {
        throw new TypeError(
          `deepseekeyes: ${field}.${value} cannot appear in both ${allowField} and ${denyField}`,
        )
      }
    }
  }

  const timeoutMs = source.timeoutMs === undefined
    ? undefined
    : integerValue(source.timeoutMs, `${field}.timeoutMs`, undefined, 100, 3_600_000)
  const common = {
    id,
    name,
    enabled,
    toolsEnabled,
    resourcesEnabled,
    promptsEnabled,
    transport,
    allowedTools,
    denyTools,
    allowedResources,
    denyResources,
    allowedPrompts,
    denyPrompts,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }

  if (transport === 'stdio') {
    const command = requiredString(source.command, `${field}.command`)
    if (source.url !== undefined && source.url !== null && source.url !== '') {
      throw new TypeError(`deepseekeyes: ${field}.url is only valid for streamable-http`)
    }
    if (source.headers !== undefined && Object.keys(plainObject(source.headers, `${field}.headers`)).length > 0) {
      throw new TypeError(`deepseekeyes: ${field}.headers is only valid for streamable-http`)
    }
    const args = stringList(source.args, `${field}.args`)
    if (mcpArgsContainInlineCredentials(args)) {
      throw new TypeError(`deepseekeyes: ${field}.args credentials must use env references`)
    }
    const cwd = optionalString(source.cwd, `${field}.cwd`)
    const env = environmentReferenceMap(
      source.env,
      `${field}.env`,
      ENVIRONMENT_NAME_PATTERN,
      'an environment variable name',
    )
    return Object.freeze({
      ...common,
      command,
      args,
      ...(cwd === undefined ? {} : { cwd }),
      env,
      headers: Object.freeze({}),
    })
  }

  if (source.command !== undefined && source.command !== null && source.command !== '') {
    throw new TypeError(`deepseekeyes: ${field}.command is only valid for stdio`)
  }
  if (source.cwd !== undefined && source.cwd !== null && source.cwd !== '') {
    throw new TypeError(`deepseekeyes: ${field}.cwd is only valid for stdio`)
  }
  if (source.args !== undefined && (!Array.isArray(source.args) || source.args.length > 0)) {
    throw new TypeError(`deepseekeyes: ${field}.args is only valid for stdio`)
  }
  if (source.env !== undefined && Object.keys(plainObject(source.env, `${field}.env`)).length > 0) {
    throw new TypeError(`deepseekeyes: ${field}.env is only valid for stdio`)
  }
  const url = validateHttpUrl(source.url, `${field}.url`)
  const headers = environmentReferenceMap(
    source.headers,
    `${field}.headers`,
    HTTP_HEADER_NAME_PATTERN,
    'a valid HTTP header name',
  )
  return Object.freeze({
    ...common,
    url,
    args: Object.freeze([]),
    env: Object.freeze({}),
    headers,
  })
}

function mcpServersValue(value) {
  if (value === undefined || value === null) return Object.freeze([])
  if (!Array.isArray(value)) {
    throw new TypeError('deepseekeyes: mcpServers must be a serializable server array')
  }
  const servers = value.map(resolveMcpServer)
  const ids = new Set()
  const names = new Set()
  for (const server of servers) {
    const normalizedId = server.id.toLowerCase()
    const normalizedName = server.name.toLocaleLowerCase('en-US')
    if (ids.has(normalizedId)) {
      throw new TypeError(`deepseekeyes: mcpServers id must be unique: ${server.id}`)
    }
    if (names.has(normalizedName)) {
      throw new TypeError(`deepseekeyes: mcpServers name must be unique: ${server.name}`)
    }
    ids.add(normalizedId)
    names.add(normalizedName)
  }
  return Object.freeze(servers)
}

function routePriorityValue(value, providerId) {
  if (value === undefined || value === null || value === '') {
    return { text: undefined, routes: Object.freeze([]) }
  }
  const entries = Array.isArray(value)
    ? value
    : String(value).split(/[\n,]+/).map(entry => entry.trim()).filter(Boolean)
  const routes = []
  const seen = new Set()
  for (const entry of entries) {
    let provider
    let model
    if (typeof entry === 'string') {
      const separator = entry.indexOf('/')
      if (separator <= 0 || separator === entry.length - 1) {
        throw new TypeError('deepseekeyes: visionRoutePriority entries must use provider/model')
      }
      provider = entry.slice(0, separator).trim()
      model = entry.slice(separator + 1).trim()
    } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      provider = requiredString(entry.provider, 'visionRoutePriority.provider')
      model = requiredString(entry.model, 'visionRoutePriority.model')
    } else {
      throw new TypeError('deepseekeyes: visionRoutePriority must be a string or route array')
    }
    if (provider === providerId) {
      throw new TypeError('deepseekeyes: visionRoutePriority cannot reference the virtual provider')
    }
    const key = `${provider}\0${model}`
    if (seen.has(key)) continue
    seen.add(key)
    routes.push(Object.freeze({ provider, model }))
  }
  return {
    text: routes.map(route => `${route.provider}/${route.model}`).join('\n'),
    routes: Object.freeze(routes),
  }
}

/** Resolve and validate the plugin configuration. */
export function resolveConfig(input = {}, environment = process.env, home = homedir()) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('deepseekeyes: config must be an object')
  }
  const providerId = requiredString(input.providerId, 'providerId', DEFAULT_PROVIDER_ID)
  const upstreamProvider = requiredString(
    input.upstreamProvider ?? environment.DEEPSEEKEYES_UPSTREAM_PROVIDER,
    'upstreamProvider',
    DEFAULT_UPSTREAM_PROVIDER,
  )
  const upstreamModel = optionalString(
    input.upstreamModel ?? environment.DEEPSEEKEYES_UPSTREAM_MODEL,
    'upstreamModel',
  )
  const visionProvider = optionalString(
    input.visionProvider ?? environment.DEEPSEEKEYES_VISION_PROVIDER,
    'visionProvider',
  )
  const visionModel = optionalString(
    input.visionModel ?? environment.DEEPSEEKEYES_VISION_MODEL,
    'visionModel',
  )
  if (visionModel !== undefined && visionProvider === undefined) {
    throw new TypeError('deepseekeyes: visionModel requires visionProvider')
  }
  if (providerId === upstreamProvider) {
    throw new TypeError('deepseekeyes: providerId and upstreamProvider must differ')
  }
  const priority = routePriorityValue(
    input.visionRoutePriority ?? environment.DEEPSEEKEYES_VISION_ROUTE_PRIORITY,
    providerId,
  )

  // Harness itself resolves an unset DSH_HOME to ~/.dsh. Match that behavior so
  // plugin evidence never splits into an unrelated ~/.deepseekeyes tree.
  const dshBase = optionalString(environment.DSH_HOME, 'DSH_HOME') ?? join(home, '.dsh')
  const configuredCacheDir = input.cacheDir ?? environment.DEEPSEEKEYES_CACHE_DIR
  let cacheDir
  if (configuredCacheDir === false) {
    cacheDir = undefined
  } else if (configuredCacheDir !== undefined) {
    cacheDir = requiredString(configuredCacheDir, 'cacheDir')
  } else {
    cacheDir = join(dshBase, 'deepseekeyes', 'evidence')
  }

  const configuredUsageStatsPath = input.usageStatsPath ?? environment.DEEPSEEKEYES_USAGE_STATS_PATH
  let usageStatsPath
  if (configuredUsageStatsPath === false || (configuredUsageStatsPath === undefined && configuredCacheDir === false)) {
    usageStatsPath = undefined
  } else if (configuredUsageStatsPath !== undefined) {
    usageStatsPath = requiredString(configuredUsageStatsPath, 'usageStatsPath')
  } else {
    usageStatsPath = join(dshBase, 'deepseekeyes', 'usage-stats.json')
  }

  const configuredVisionAttemptLogPath = input.visionAttemptLogPath
    ?? environment.DEEPSEEKEYES_VISION_ATTEMPT_LOG_PATH
  let visionAttemptLogPath
  if (configuredVisionAttemptLogPath === false
    || (configuredVisionAttemptLogPath === undefined && configuredCacheDir === false)) {
    visionAttemptLogPath = undefined
  } else if (configuredVisionAttemptLogPath !== undefined) {
    visionAttemptLogPath = requiredString(configuredVisionAttemptLogPath, 'visionAttemptLogPath')
  } else {
    visionAttemptLogPath = join(dshBase, 'deepseekeyes', 'vision-attempts.json')
  }

  const configuredBrowserArtifactsDir = input.browserArtifactsDir
    ?? environment.DEEPSEEKEYES_BROWSER_ARTIFACTS_DIR
  let browserArtifactsDir
  if (configuredBrowserArtifactsDir === false) {
    browserArtifactsDir = undefined
  } else if (configuredBrowserArtifactsDir !== undefined) {
    browserArtifactsDir = requiredString(configuredBrowserArtifactsDir, 'browserArtifactsDir')
  } else {
    browserArtifactsDir = join(dshBase, 'deepseekeyes', 'browser-runs')
  }

  const configuredDesktopArtifactsDir = input.desktopArtifactsDir
    ?? environment.DEEPSEEKEYES_DESKTOP_ARTIFACTS_DIR
  let desktopArtifactsDir
  if (configuredDesktopArtifactsDir === false) {
    desktopArtifactsDir = undefined
  } else if (configuredDesktopArtifactsDir !== undefined) {
    desktopArtifactsDir = requiredString(configuredDesktopArtifactsDir, 'desktopArtifactsDir')
  } else {
    desktopArtifactsDir = join(dshBase, 'deepseekeyes', 'desktop-runs')
  }

  const configuredMcpArtifactDir = input.mcpArtifactDir
    ?? environment.DEEPSEEKEYES_MCP_ARTIFACT_DIR
  let mcpArtifactDir
  if (configuredMcpArtifactDir === false) {
    mcpArtifactDir = undefined
  } else if (configuredMcpArtifactDir !== undefined) {
    mcpArtifactDir = requiredString(configuredMcpArtifactDir, 'mcpArtifactDir')
  } else {
    mcpArtifactDir = join(dshBase, 'deepseekeyes', 'mcp-artifacts')
  }

  return Object.freeze({
    providerId,
    displayName: requiredString(input.displayName, 'displayName', 'DeepSeekEyes'),
    upstreamProvider,
    upstreamModel,
    visionProvider,
    visionModel,
    visionRoutePriority: priority.text,
    visionPriorityRoutes: priority.routes,
    autoDetectVision: booleanValue(input.autoDetectVision, 'autoDetectVision', true),
    activeProbe: booleanValue(input.activeProbe, 'activeProbe', true),
    visionHealthCheck: booleanValue(input.visionHealthCheck, 'visionHealthCheck', true),
    visionFailoverAttempts: integerValue(
      input.visionFailoverAttempts,
      'visionFailoverAttempts',
      DEFAULT_VISION_FAILOVER_ATTEMPTS,
      0,
      8,
    ),
    visionHealthTtlMs: integerValue(
      input.visionHealthTtlMs,
      'visionHealthTtlMs',
      DEFAULT_VISION_HEALTH_TTL_MS,
      1_000,
      3_600_000,
    ),
    visionFailureCooldownMs: integerValue(
      input.visionFailureCooldownMs,
      'visionFailureCooldownMs',
      DEFAULT_VISION_FAILURE_COOLDOWN_MS,
      0,
      3_600_000,
    ),
    visionAttemptLog: booleanValue(input.visionAttemptLog, 'visionAttemptLog', true),
    visionAttemptLogPath,
    visionAttemptLimit: integerValue(
      input.visionAttemptLimit,
      'visionAttemptLimit',
      DEFAULT_VISION_ATTEMPT_LIMIT,
      10,
      10_000,
    ),
    persistentEvidence: booleanValue(input.persistentEvidence, 'persistentEvidence', true),
    usageStats: booleanValue(
      input.usageStats
        ?? environmentBoolean(environment.DEEPSEEKEYES_USAGE_STATS, 'DEEPSEEKEYES_USAGE_STATS'),
      'usageStats',
      true,
    ),
    usageStatsPath,
    cacheDir,
    maxClarifications: integerValue(
      input.maxClarifications,
      'maxClarifications',
      DEFAULT_MAX_CLARIFICATIONS,
      0,
      8,
    ),
    baseMaxTokens: tokenBudgetValue(
      input.baseMaxTokens,
      'baseMaxTokens',
      DEFAULT_BASE_MAX_TOKENS,
      512,
    ),
    targetMaxTokens: tokenBudgetValue(
      input.targetMaxTokens,
      'targetMaxTokens',
      DEFAULT_TARGET_MAX_TOKENS,
      256,
    ),
    automationContextMaxTokens: automationContextBudgetValue(
      input.automationContextMaxTokens,
      'automationContextMaxTokens',
      DEFAULT_AUTOMATION_CONTEXT_MAX_TOKENS,
    ),
    automationMaxCallsPerTurn: integerValue(
      input.automationMaxCallsPerTurn,
      'automationMaxCallsPerTurn',
      DEFAULT_AUTOMATION_MAX_CALLS_PER_TURN,
      0,
      10_000,
    ),
    historyImageLimit: integerValue(
      input.historyImageLimit,
      'historyImageLimit',
      DEFAULT_HISTORY_IMAGE_LIMIT,
      0,
      32,
    ),
    historySummaryChars: integerValue(
      input.historySummaryChars,
      'historySummaryChars',
      DEFAULT_HISTORY_SUMMARY_CHARS,
      64,
      2_000,
    ),
    browserHistoryLimit: integerValue(
      input.browserHistoryLimit,
      'browserHistoryLimit',
      DEFAULT_BROWSER_HISTORY_LIMIT,
      0,
      32,
    ),
    browserComputerUse: booleanValue(
      input.browserComputerUse
        ?? environmentBoolean(environment.DEEPSEEKEYES_BROWSER_ENABLED, 'DEEPSEEKEYES_BROWSER_ENABLED'),
      'browserComputerUse',
      false,
    ),
    browserHeadless: booleanValue(
      input.browserHeadless
        ?? environmentBoolean(environment.DEEPSEEKEYES_BROWSER_HEADLESS, 'DEEPSEEKEYES_BROWSER_HEADLESS'),
      'browserHeadless',
      false,
    ),
    browserChannel: optionalString(
      input.browserChannel ?? environment.DEEPSEEKEYES_BROWSER_CHANNEL,
      'browserChannel',
    ),
    browserExecutablePath: optionalString(
      input.browserExecutablePath ?? environment.DEEPSEEKEYES_BROWSER_EXECUTABLE_PATH,
      'browserExecutablePath',
    ),
    browserArtifactsDir,
    browserLocale: requiredString(input.browserLocale, 'browserLocale', 'zh-CN'),
    browserTimeoutMs: integerValue(
      input.browserTimeoutMs,
      'browserTimeoutMs',
      DEFAULT_BROWSER_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    browserSettleMs: integerValue(
      input.browserSettleMs,
      'browserSettleMs',
      DEFAULT_BROWSER_SETTLE_MS,
      0,
      10_000,
    ),
    browserViewportWidth: integerValue(
      input.browserViewportWidth,
      'browserViewportWidth',
      DEFAULT_BROWSER_VIEWPORT_WIDTH,
      320,
      3840,
    ),
    browserViewportHeight: integerValue(
      input.browserViewportHeight,
      'browserViewportHeight',
      DEFAULT_BROWSER_VIEWPORT_HEIGHT,
      240,
      2160,
    ),
    browserMaxElements: integerValue(
      input.browserMaxElements,
      'browserMaxElements',
      DEFAULT_BROWSER_MAX_ELEMENTS,
      20,
      500,
    ),
    browserMaxTextChars: integerValue(
      input.browserMaxTextChars,
      'browserMaxTextChars',
      DEFAULT_BROWSER_MAX_TEXT_CHARS,
      1_000,
      100_000,
    ),
    desktopHistoryLimit: integerValue(
      input.desktopHistoryLimit,
      'desktopHistoryLimit',
      DEFAULT_DESKTOP_HISTORY_LIMIT,
      0,
      32,
    ),
    desktopComputerUse: booleanValue(
      input.desktopComputerUse
        ?? environmentBoolean(environment.DEEPSEEKEYES_DESKTOP_ENABLED, 'DEEPSEEKEYES_DESKTOP_ENABLED'),
      'desktopComputerUse',
      false,
    ),
    desktopVisualMode: choiceValue(
      input.desktopVisualMode ?? environment.DEEPSEEKEYES_DESKTOP_VISUAL_MODE,
      'desktopVisualMode',
      DEFAULT_DESKTOP_VISUAL_MODE,
      DESKTOP_VISUAL_MODES,
    ),
    desktopTimeoutMs: integerValue(
      input.desktopTimeoutMs,
      'desktopTimeoutMs',
      DEFAULT_DESKTOP_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    desktopSettleMs: integerValue(
      input.desktopSettleMs,
      'desktopSettleMs',
      DEFAULT_DESKTOP_SETTLE_MS,
      0,
      10_000,
    ),
    desktopMaxWindows: integerValue(
      input.desktopMaxWindows,
      'desktopMaxWindows',
      DEFAULT_DESKTOP_MAX_WINDOWS,
      1,
      200,
    ),
    desktopSemantic: booleanValue(
      input.desktopSemantic
        ?? environmentBoolean(environment.DEEPSEEKEYES_DESKTOP_SEMANTIC, 'DEEPSEEKEYES_DESKTOP_SEMANTIC'),
      'desktopSemantic',
      true,
    ),
    desktopMaxElements: integerValue(
      input.desktopMaxElements,
      'desktopMaxElements',
      DEFAULT_DESKTOP_MAX_ELEMENTS,
      20,
      500,
    ),
    desktopMacDisplay: integerValue(
      input.desktopMacDisplay,
      'desktopMacDisplay',
      DEFAULT_DESKTOP_MAC_DISPLAY,
      1,
      32,
    ),
    desktopWindowsPowerShell: optionalString(
      input.desktopWindowsPowerShell ?? environment.DEEPSEEKEYES_DESKTOP_WINDOWS_POWERSHELL,
      'desktopWindowsPowerShell',
    ),
    desktopArtifactsDir,
    mcpEnabled: booleanValue(
      input.mcpEnabled
        ?? environmentBoolean(environment.DEEPSEEKEYES_MCP_ENABLED, 'DEEPSEEKEYES_MCP_ENABLED'),
      'mcpEnabled',
      false,
    ),
    mcpServers: mcpServersValue(input.mcpServers),
    mcpMaxTools: integerOrUnlimitedValue(
      input.mcpMaxTools
        ?? environmentInteger(environment.DEEPSEEKEYES_MCP_MAX_TOOLS, 'DEEPSEEKEYES_MCP_MAX_TOOLS'),
      'mcpMaxTools',
      DEFAULT_MCP_MAX_TOOLS,
      1,
      1_000,
    ),
    mcpMaxSchemaTokens: integerOrUnlimitedValue(
      input.mcpMaxSchemaTokens
        ?? environmentInteger(
          environment.DEEPSEEKEYES_MCP_MAX_SCHEMA_TOKENS,
          'DEEPSEEKEYES_MCP_MAX_SCHEMA_TOKENS',
        ),
      'mcpMaxSchemaTokens',
      DEFAULT_MCP_MAX_SCHEMA_TOKENS,
      256,
      10_000_000,
    ),
    mcpMaxResultChars: integerValue(
      input.mcpMaxResultChars
        ?? environmentInteger(
          environment.DEEPSEEKEYES_MCP_MAX_RESULT_CHARS,
          'DEEPSEEKEYES_MCP_MAX_RESULT_CHARS',
        ),
      'mcpMaxResultChars',
      DEFAULT_MCP_MAX_RESULT_CHARS,
      256,
      10_000_000,
    ),
    mcpMaxExternalCallsPerRun: integerOrUnlimitedValue(
      input.mcpMaxExternalCallsPerRun
        ?? environmentInteger(
          environment.DEEPSEEKEYES_MCP_MAX_EXTERNAL_CALLS_PER_RUN,
          'DEEPSEEKEYES_MCP_MAX_EXTERNAL_CALLS_PER_RUN',
        ),
      'mcpMaxExternalCallsPerRun',
      DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN,
      1,
      10_000,
    ),
    mcpToolCallTimeoutMs: integerValue(
      input.mcpToolCallTimeoutMs
        ?? environmentInteger(
          environment.DEEPSEEKEYES_MCP_TOOL_CALL_TIMEOUT_MS,
          'DEEPSEEKEYES_MCP_TOOL_CALL_TIMEOUT_MS',
        ),
      'mcpToolCallTimeoutMs',
      DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
      100,
      3_600_000,
    ),
    mcpAudit: booleanValue(
      input.mcpAudit
        ?? environmentBoolean(environment.DEEPSEEKEYES_MCP_AUDIT, 'DEEPSEEKEYES_MCP_AUDIT'),
      'mcpAudit',
      true,
    ),
    mcpArtifactDir,
  })
}

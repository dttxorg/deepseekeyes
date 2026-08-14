import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_PROVIDER_ID = 'deepseekeyes'
export const DEFAULT_UPSTREAM_PROVIDER = 'deepseek-official'
export const DEFAULT_MAX_CLARIFICATIONS = 3
export const DEFAULT_BASE_MAX_TOKENS = 8192
export const DEFAULT_TARGET_MAX_TOKENS = 4096

function optionalString(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`deepseekeyes: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requiredString(value, field, fallback) {
  return optionalString(value ?? fallback, field)
}

function booleanValue(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`deepseekeyes: ${field} must be boolean`)
  return value
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

  const configuredCacheDir = input.cacheDir ?? environment.DEEPSEEKEYES_CACHE_DIR
  let cacheDir
  if (configuredCacheDir === false) {
    cacheDir = undefined
  } else if (configuredCacheDir !== undefined) {
    cacheDir = requiredString(configuredCacheDir, 'cacheDir')
  } else {
    const base = optionalString(environment.DSH_HOME, 'DSH_HOME') ?? join(home, '.deepseekeyes')
    cacheDir = join(base, 'deepseekeyes', 'evidence')
  }

  return Object.freeze({
    providerId,
    displayName: requiredString(input.displayName, 'displayName', 'DeepSeekEyes'),
    upstreamProvider,
    upstreamModel,
    visionProvider,
    visionModel,
    autoDetectVision: booleanValue(input.autoDetectVision, 'autoDetectVision', true),
    activeProbe: booleanValue(input.activeProbe, 'activeProbe', true),
    persistentEvidence: booleanValue(input.persistentEvidence, 'persistentEvidence', true),
    cacheDir,
    maxClarifications: integerValue(
      input.maxClarifications,
      'maxClarifications',
      DEFAULT_MAX_CLARIFICATIONS,
      0,
      8,
    ),
    baseMaxTokens: integerValue(
      input.baseMaxTokens,
      'baseMaxTokens',
      DEFAULT_BASE_MAX_TOKENS,
      512,
      32768,
    ),
    targetMaxTokens: integerValue(
      input.targetMaxTokens,
      'targetMaxTokens',
      DEFAULT_TARGET_MAX_TOKENS,
      256,
      16384,
    ),
  })
}

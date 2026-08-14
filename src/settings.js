import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_BASE_MAX_TOKENS,
  DEFAULT_MAX_CLARIFICATIONS,
  DEFAULT_TARGET_MAX_TOKENS,
  DEFAULT_UPSTREAM_PROVIDER,
  resolveConfig,
} from './config.js'

export const SETTINGS_NAMESPACE = 'deepseekeyes'

/** Fields owned by the live Harness settings section. */
export const SETTINGS_FIELDS = Object.freeze([
  'upstreamProvider',
  'visionProvider',
  'visionModel',
  'autoDetectVision',
  'activeProbe',
  'persistentEvidence',
  'maxClarifications',
  'baseMaxTokens',
  'targetMaxTokens',
])

/** Schemastery schema serialized by Harness and consumed by the native settings client. */
export const SettingsConfig = z.object({
  upstreamProvider: z.string().default(DEFAULT_UPSTREAM_PROVIDER),
  visionProvider: z.string(),
  visionModel: z.string(),
  autoDetectVision: z.boolean().default(true),
  activeProbe: z.boolean().default(true),
  persistentEvidence: z.boolean().default(true),
  maxClarifications: z.number().step(1).min(0).max(8).default(DEFAULT_MAX_CLARIFICATIONS),
  baseMaxTokens: z.number().step(1).min(512).max(32768).default(DEFAULT_BASE_MAX_TOKENS),
  targetMaxTokens: z.number().step(1).min(256).max(16384).default(DEFAULT_TARGET_MAX_TOKENS),
})

/** Detach only settings-owned values from a resolved plugin configuration. */
export function settingsBase(config) {
  return Object.fromEntries(
    SETTINGS_FIELDS.flatMap((field) => config[field] === undefined ? [] : [[field, config[field]]]),
  )
}

/** Overlay a resolved settings section without allowing it to replace plugin identity/path fields. */
export function settingsInput(rawConfig, section) {
  const fixed = {
    ...(rawConfig.providerId === undefined ? {} : { providerId: rawConfig.providerId }),
    ...(rawConfig.displayName === undefined ? {} : { displayName: rawConfig.displayName }),
    ...(rawConfig.cacheDir === undefined ? {} : { cacheDir: rawConfig.cacheDir }),
  }
  return { ...rawConfig, ...section, ...fixed }
}

/** Validate a candidate section with the exact same cross-field rules as runtime routing. */
export function validateSettings(section, rawConfig = {}, environment = process.env) {
  return resolveConfig(settingsInput(rawConfig, section), environment)
}

/**
 * Register the live settings section when Harness exposes ctx.settings.
 * The bridge keeps its 0.1 entry configuration as the composition base, while
 * GUI values form the normal persisted user layer and take effect immediately.
 */
export function installHarnessSettings(ctx, state, rawConfig = {}) {
  const install = (settingsCtx) => {
    const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsConfig, {
      base: settingsBase(state.config),
      applies: 'live',
      validate: value => validateSettings(value, rawConfig),
    })
    state.reconfigure(settingsInput(rawConfig, scope.get()))
    const unwatch = scope.watch((next) => {
      state.reconfigure(settingsInput(rawConfig, next))
    })
    if (typeof settingsCtx.effect === 'function') {
      settingsCtx.effect(() => unwatch, 'deepseekeyes: live settings watch')
    }
    return scope
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], settingsCtx => { install(settingsCtx) })
    return undefined
  }
  if (ctx.settings?.register !== undefined) return install(ctx)
  return undefined
}

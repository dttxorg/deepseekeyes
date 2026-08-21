import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_BASE_MAX_TOKENS,
  DEFAULT_AUTOMATION_CONTEXT_MAX_TOKENS,
  DEFAULT_AUTOMATION_MAX_CALLS_PER_TURN,
  DEFAULT_BROWSER_MAX_ELEMENTS,
  DEFAULT_BROWSER_MAX_TEXT_CHARS,
  DEFAULT_BROWSER_HISTORY_LIMIT,
  DEFAULT_BROWSER_SETTLE_MS,
  DEFAULT_BROWSER_TIMEOUT_MS,
  DEFAULT_BROWSER_VIEWPORT_HEIGHT,
  DEFAULT_BROWSER_VIEWPORT_WIDTH,
  DEFAULT_DESKTOP_HISTORY_LIMIT,
  DEFAULT_DESKTOP_VISUAL_MODE,
  DEFAULT_DESKTOP_MAC_DISPLAY,
  DEFAULT_DESKTOP_MAX_ELEMENTS,
  DEFAULT_DESKTOP_MAX_WINDOWS,
  DEFAULT_DESKTOP_SETTLE_MS,
  DEFAULT_DESKTOP_TIMEOUT_MS,
  DEFAULT_MAX_CLARIFICATIONS,
  DEFAULT_MCP_MAX_RESULT_CHARS,
  DEFAULT_MCP_MAX_SCHEMA_TOKENS,
  DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN,
  DEFAULT_MCP_MAX_TOOLS,
  DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_HISTORY_IMAGE_LIMIT,
  DEFAULT_HISTORY_SUMMARY_CHARS,
  DEFAULT_TARGET_MAX_TOKENS,
  DEFAULT_UPSTREAM_PROVIDER,
  DEFAULT_VISION_ATTEMPT_LIMIT,
  DEFAULT_VISION_FAILOVER_ATTEMPTS,
  DEFAULT_VISION_FAILURE_COOLDOWN_MS,
  DEFAULT_VISION_HEALTH_TTL_MS,
  resolveConfig,
} from './config.js'

export const SETTINGS_NAMESPACE = 'deepseekeyes'

/** Fields owned by the live Harness settings section. */
export const SETTINGS_FIELDS = Object.freeze([
  'upstreamProvider',
  'upstreamModel',
  'visionProvider',
  'visionModel',
  'visionRoutePriority',
  'autoDetectVision',
  'activeProbe',
  'visionHealthCheck',
  'visionFailoverAttempts',
  'visionHealthTtlMs',
  'visionFailureCooldownMs',
  'visionAttemptLog',
  'visionAttemptLimit',
  'persistentEvidence',
  'usageStats',
  'maxClarifications',
  'baseMaxTokens',
  'targetMaxTokens',
  'automationContextMaxTokens',
  'automationMaxCallsPerTurn',
  'historyImageLimit',
  'historySummaryChars',
  'browserHistoryLimit',
  'browserComputerUse',
  'browserHeadless',
  'browserChannel',
  'browserExecutablePath',
  'browserLocale',
  'browserTimeoutMs',
  'browserSettleMs',
  'browserViewportWidth',
  'browserViewportHeight',
  'browserMaxElements',
  'browserMaxTextChars',
  'desktopHistoryLimit',
  'desktopComputerUse',
  'desktopVisualMode',
  'desktopTimeoutMs',
  'desktopSettleMs',
  'desktopMaxWindows',
  'desktopSemantic',
  'desktopMaxElements',
  'desktopMacDisplay',
  'desktopWindowsPowerShell',
  'desktopArtifactsDir',
  'mcpEnabled',
  'mcpServers',
  'mcpMaxTools',
  'mcpMaxSchemaTokens',
  'mcpMaxResultChars',
  'mcpMaxExternalCallsPerRun',
  'mcpToolCallTimeoutMs',
  'mcpAudit',
  'mcpArtifactDir',
])

export const McpCredentialEnvRefConfig = z.object({
  env: z.string(),
})

export const McpOAuthConfig = z.object({
  enabled: z.boolean().default(false),
  clientId: McpCredentialEnvRefConfig,
  clientSecret: McpCredentialEnvRefConfig,
  scope: z.string(),
  authMethod: z.union([
    z.const('client_secret_basic'),
    z.const('client_secret_post'),
  ]),
})

export const McpServerConfig = z.object({
  id: z.string().required(),
  name: z.string().required(),
  enabled: z.boolean().default(true),
  toolsEnabled: z.boolean().default(true),
  resourcesEnabled: z.boolean().default(false),
  promptsEnabled: z.boolean().default(false),
  transport: z.union([
    z.const('stdio'),
    z.const('streamable-http'),
  ]).default('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  url: z.string(),
  env: z.dict(McpCredentialEnvRefConfig).default({}),
  headers: z.dict(McpCredentialEnvRefConfig).default({}),
  allowedTools: z.array(z.string()).default([]),
  denyTools: z.array(z.string()).default([]),
  allowedResources: z.array(z.string()).default([]),
  denyResources: z.array(z.string()).default([]),
  allowedPrompts: z.array(z.string()).default([]),
  denyPrompts: z.array(z.string()).default([]),
  timeoutMs: z.number().step(1).min(100).max(3_600_000),
  oauth: McpOAuthConfig,
})

/** Schemastery schema serialized by Harness and consumed by the native settings client. */
export const SettingsConfig = z.object({
  upstreamProvider: z.string().default(DEFAULT_UPSTREAM_PROVIDER),
  upstreamModel: z.string(),
  visionProvider: z.string(),
  visionModel: z.string(),
  visionRoutePriority: z.string(),
  autoDetectVision: z.boolean().default(true),
  activeProbe: z.boolean().default(true),
  visionHealthCheck: z.boolean().default(true),
  visionFailoverAttempts: z.number().step(1).min(0).max(8).default(DEFAULT_VISION_FAILOVER_ATTEMPTS),
  visionHealthTtlMs: z.number().step(1).min(1_000).max(3_600_000).default(DEFAULT_VISION_HEALTH_TTL_MS),
  visionFailureCooldownMs: z.number().step(1).min(0).max(3_600_000).default(DEFAULT_VISION_FAILURE_COOLDOWN_MS),
  visionAttemptLog: z.boolean().default(true),
  visionAttemptLimit: z.number().step(1).min(10).max(10_000).default(DEFAULT_VISION_ATTEMPT_LIMIT),
  persistentEvidence: z.boolean().default(true),
  usageStats: z.boolean().default(true),
  maxClarifications: z.number().step(1).min(0).max(8).default(DEFAULT_MAX_CLARIFICATIONS),
  baseMaxTokens: z.number().step(1).min(0).default(DEFAULT_BASE_MAX_TOKENS),
  targetMaxTokens: z.number().step(1).min(0).default(DEFAULT_TARGET_MAX_TOKENS),
  automationContextMaxTokens: z.number().step(1).min(0).default(DEFAULT_AUTOMATION_CONTEXT_MAX_TOKENS),
  automationMaxCallsPerTurn: z.number().step(1).min(0).max(10_000).default(DEFAULT_AUTOMATION_MAX_CALLS_PER_TURN),
  historyImageLimit: z.number().step(1).min(0).max(32).default(DEFAULT_HISTORY_IMAGE_LIMIT),
  historySummaryChars: z.number().step(1).min(64).max(2_000).default(DEFAULT_HISTORY_SUMMARY_CHARS),
  browserHistoryLimit: z.number().step(1).min(0).max(32).default(DEFAULT_BROWSER_HISTORY_LIMIT),
  browserComputerUse: z.boolean().default(false),
  browserHeadless: z.boolean().default(false),
  browserChannel: z.string(),
  browserExecutablePath: z.string(),
  browserLocale: z.string().default('zh-CN'),
  browserTimeoutMs: z.number().step(1).min(1_000).max(120_000).default(DEFAULT_BROWSER_TIMEOUT_MS),
  browserSettleMs: z.number().step(1).min(0).max(10_000).default(DEFAULT_BROWSER_SETTLE_MS),
  browserViewportWidth: z.number().step(1).min(320).max(3_840).default(DEFAULT_BROWSER_VIEWPORT_WIDTH),
  browserViewportHeight: z.number().step(1).min(240).max(2_160).default(DEFAULT_BROWSER_VIEWPORT_HEIGHT),
  browserMaxElements: z.number().step(1).min(20).max(500).default(DEFAULT_BROWSER_MAX_ELEMENTS),
  browserMaxTextChars: z.number().step(1).min(1_000).max(100_000).default(DEFAULT_BROWSER_MAX_TEXT_CHARS),
  desktopHistoryLimit: z.number().step(1).min(0).max(32).default(DEFAULT_DESKTOP_HISTORY_LIMIT),
  desktopComputerUse: z.boolean().default(false),
  desktopVisualMode: z.union([
    z.const('auto'),
    z.const('always'),
    z.const('manual'),
  ]).default(DEFAULT_DESKTOP_VISUAL_MODE),
  desktopTimeoutMs: z.number().step(1).min(1_000).max(120_000).default(DEFAULT_DESKTOP_TIMEOUT_MS),
  desktopSettleMs: z.number().step(1).min(0).max(10_000).default(DEFAULT_DESKTOP_SETTLE_MS),
  desktopMaxWindows: z.number().step(1).min(1).max(200).default(DEFAULT_DESKTOP_MAX_WINDOWS),
  desktopSemantic: z.boolean().default(true),
  desktopMaxElements: z.number().step(1).min(20).max(500).default(DEFAULT_DESKTOP_MAX_ELEMENTS),
  desktopMacDisplay: z.number().step(1).min(1).max(32).default(DEFAULT_DESKTOP_MAC_DISPLAY),
  desktopWindowsPowerShell: z.string(),
  desktopArtifactsDir: z.string(),
  mcpEnabled: z.boolean().default(false),
  mcpServers: z.array(McpServerConfig).default([]),
  mcpMaxTools: z.number().step(1).min(0).max(1_000).default(DEFAULT_MCP_MAX_TOOLS),
  mcpMaxSchemaTokens: z.number().step(1).min(0).max(10_000_000).default(DEFAULT_MCP_MAX_SCHEMA_TOKENS),
  mcpMaxResultChars: z.number().step(1).min(256).max(10_000_000).default(DEFAULT_MCP_MAX_RESULT_CHARS),
  mcpMaxExternalCallsPerRun: z.number().step(1).min(0).max(10_000).default(DEFAULT_MCP_MAX_EXTERNAL_CALLS_PER_RUN),
  mcpToolCallTimeoutMs: z.number().step(1).min(100).max(3_600_000).default(DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS),
  mcpAudit: z.boolean().default(true),
  mcpArtifactDir: z.union([z.string(), z.const(false)]),
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
    ...(rawConfig.usageStatsPath === undefined ? {} : { usageStatsPath: rawConfig.usageStatsPath }),
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

import { mcpArgsContainInlineCredentials } from './mcp/credential-policy.js'
import { mcpHttpUrlUsesSecureTransport } from './mcp/url-policy.js'

const SETTINGS_FIELDS = Object.freeze([
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
  'mcpToolCallTimeoutMs',
  'mcpAudit',
  'mcpArtifactDir',
])

const OPTIONAL_ROUTE_FIELDS = new Set([
  'upstreamModel',
  'visionProvider',
  'visionModel',
  'visionRoutePriority',
  'browserChannel',
  'browserExecutablePath',
  'desktopWindowsPowerShell',
  'desktopArtifactsDir',
  'mcpArtifactDir',
])

const MCP_SERVER_ID = /^[A-Za-z0-9_-]{1,32}$/
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HTTP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const CREDENTIAL_QUERY = /(?:api[-_]?key|authorization|credential|password|secret|signature|token)/i

function normalizedStringList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))]
}

function normalizedReferenceMap(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([key, reference]) => typeof key === 'string'
      && typeof reference === 'object' && reference !== null && !Array.isArray(reference)
      && typeof reference.env === 'string')
    .map(([key, reference]) => [key.trim(), { env: reference.env.trim() }])
    .filter(([key]) => key !== ''))
}

export function createMcpServerDraft(index = 1) {
  return {
    id: `server-${index}`,
    name: `MCP Server ${index}`,
    enabled: true,
    transport: 'stdio',
    command: '',
    args: [],
    cwd: '',
    url: '',
    env: {},
    headers: {},
    allowedTools: [],
    denyTools: [],
    timeoutMs: undefined,
  }
}

export function nextMcpReferenceEntry(value = {}, { header = false } = {}) {
  const entries = Object.entries(value ?? {})
  const keys = new Set(entries.map(([key]) => key))
  const environments = new Set(entries.map(([, reference]) => reference?.env))
  const baseKey = header ? 'Authorization' : 'TOKEN'
  const baseEnv = header ? 'MCP_AUTHORIZATION' : 'MCP_TOKEN'
  let suffix = 1
  while (true) {
    const key = suffix === 1 ? baseKey : `${baseKey}${header ? '-' : '_'}${suffix}`
    const env = suffix === 1 ? baseEnv : `${baseEnv}_${suffix}`
    if (!keys.has(key) && !environments.has(env)) return { key, reference: { env } }
    suffix += 1
  }
}

const MCP_GLOB_SPECIAL = /[.+^${}()|[\]\\]/g

function mcpSelectorExpression(selector) {
  return new RegExp(`^${String(selector).replace(MCP_GLOB_SPECIAL, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

function mcpToolSelectorNames(server, tool) {
  const rawName = String(tool?.name ?? tool?.rawName ?? tool?.publicName ?? '')
  const publicName = String(tool?.publicName ?? rawName)
  return new Set([
    rawName,
    publicName,
    `${server.id}/${rawName}`,
    `${server.name}/${rawName}`,
    `${server.id}/${publicName}`,
    `${server.name}/${publicName}`,
  ])
}

export function mcpToolMatchesSelector(server, tool, selector) {
  const expression = mcpSelectorExpression(selector)
  return [...mcpToolSelectorNames(server, tool)].some(name => expression.test(name))
}

export function mcpToolAllowedInDraft(server, tool) {
  if (server.denyTools.some(selector => mcpToolMatchesSelector(server, tool, selector))) return false
  return server.allowedTools.some(selector => mcpToolMatchesSelector(server, tool, selector))
}

export function updateMcpToolSelection(server, tool, selected) {
  const rawName = String(tool?.name ?? tool?.rawName ?? tool?.publicName ?? '')
  const exactNames = mcpToolSelectorNames(server, tool)
  const isExactToolSelector = selector => !/[?*]/.test(selector) && exactNames.has(selector)
  if (!selected) {
    const allowedTools = server.allowedTools.filter(selector => !isExactToolSelector(selector))
    const denyTools = server.denyTools.some(selector => mcpToolMatchesSelector(server, tool, selector))
      ? server.denyTools
      : [...server.denyTools, rawName]
    return { ...server, allowedTools, denyTools }
  }

  const denyTools = server.denyTools.filter(selector => !isExactToolSelector(selector))
  const allowedTools = server.allowedTools.some(selector => mcpToolMatchesSelector(server, tool, selector))
    ? server.allowedTools
    : [...server.allowedTools, rawName]
  return { ...server, allowedTools, denyTools }
}

export function normalizeMcpServer(value = {}, index = 0) {
  const fallback = createMcpServerDraft(index + 1)
  return {
    id: typeof value.id === 'string' ? value.id.trim() : fallback.id,
    name: typeof value.name === 'string' ? value.name.trim() : fallback.name,
    enabled: value.enabled !== false,
    transport: value.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: typeof value.command === 'string' ? value.command.trim() : '',
    args: normalizedStringList(value.args),
    cwd: typeof value.cwd === 'string' ? value.cwd.trim() : '',
    url: typeof value.url === 'string' ? value.url.trim() : '',
    env: normalizedReferenceMap(value.env),
    headers: normalizedReferenceMap(value.headers),
    allowedTools: normalizedStringList(value.allowedTools),
    denyTools: normalizedStringList(value.denyTools),
    timeoutMs: Number.isInteger(value.timeoutMs) ? value.timeoutMs : undefined,
  }
}

export function valueAt(root, path) {
  let current = root
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = current[segment]
  }
  return current
}

export function normalizeSettingsDraft(value = {}) {
  return {
    upstreamProvider: typeof value.upstreamProvider === 'string' ? value.upstreamProvider : 'deepseek-official',
    upstreamModel: typeof value.upstreamModel === 'string' ? value.upstreamModel : '',
    visionProvider: typeof value.visionProvider === 'string' ? value.visionProvider : '',
    visionModel: typeof value.visionModel === 'string' ? value.visionModel : '',
    visionRoutePriority: typeof value.visionRoutePriority === 'string' ? value.visionRoutePriority : '',
    autoDetectVision: value.autoDetectVision !== false,
    activeProbe: value.activeProbe !== false,
    visionHealthCheck: value.visionHealthCheck !== false,
    visionFailoverAttempts: Number.isInteger(value.visionFailoverAttempts) ? value.visionFailoverAttempts : 2,
    visionHealthTtlMs: Number.isInteger(value.visionHealthTtlMs) ? value.visionHealthTtlMs : 60_000,
    visionFailureCooldownMs: Number.isInteger(value.visionFailureCooldownMs) ? value.visionFailureCooldownMs : 30_000,
    visionAttemptLog: value.visionAttemptLog !== false,
    visionAttemptLimit: Number.isInteger(value.visionAttemptLimit) ? value.visionAttemptLimit : 1_000,
    persistentEvidence: value.persistentEvidence !== false,
    usageStats: value.usageStats !== false,
    maxClarifications: Number.isInteger(value.maxClarifications) ? value.maxClarifications : 3,
    baseMaxTokens: Number.isSafeInteger(value.baseMaxTokens) ? value.baseMaxTokens : 16_384,
    targetMaxTokens: Number.isSafeInteger(value.targetMaxTokens) ? value.targetMaxTokens : 8_192,
    automationContextMaxTokens: Number.isSafeInteger(value.automationContextMaxTokens)
      ? value.automationContextMaxTokens
      : 32_768,
    automationMaxCallsPerTurn: Number.isInteger(value.automationMaxCallsPerTurn)
      ? value.automationMaxCallsPerTurn
      : 32,
    historyImageLimit: Number.isInteger(value.historyImageLimit) ? value.historyImageLimit : 8,
    historySummaryChars: Number.isInteger(value.historySummaryChars) ? value.historySummaryChars : 320,
    browserHistoryLimit: Number.isInteger(value.browserHistoryLimit) ? value.browserHistoryLimit : 8,
    browserComputerUse: value.browserComputerUse === true,
    browserHeadless: value.browserHeadless === true,
    browserChannel: typeof value.browserChannel === 'string' ? value.browserChannel : '',
    browserExecutablePath: typeof value.browserExecutablePath === 'string' ? value.browserExecutablePath : '',
    browserLocale: typeof value.browserLocale === 'string' ? value.browserLocale : 'zh-CN',
    browserTimeoutMs: Number.isInteger(value.browserTimeoutMs) ? value.browserTimeoutMs : 15_000,
    browserSettleMs: Number.isInteger(value.browserSettleMs) ? value.browserSettleMs : 300,
    browserViewportWidth: Number.isInteger(value.browserViewportWidth) ? value.browserViewportWidth : 1_440,
    browserViewportHeight: Number.isInteger(value.browserViewportHeight) ? value.browserViewportHeight : 900,
    browserMaxElements: Number.isInteger(value.browserMaxElements) ? value.browserMaxElements : 200,
    browserMaxTextChars: Number.isInteger(value.browserMaxTextChars) ? value.browserMaxTextChars : 20_000,
    desktopHistoryLimit: Number.isInteger(value.desktopHistoryLimit) ? value.desktopHistoryLimit : 8,
    desktopComputerUse: value.desktopComputerUse === true,
    desktopVisualMode: ['auto', 'always', 'manual'].includes(value.desktopVisualMode)
      ? value.desktopVisualMode
      : 'auto',
    desktopTimeoutMs: Number.isInteger(value.desktopTimeoutMs) ? value.desktopTimeoutMs : 30_000,
    desktopSettleMs: Number.isInteger(value.desktopSettleMs) ? value.desktopSettleMs : 300,
    desktopMaxWindows: Number.isInteger(value.desktopMaxWindows) ? value.desktopMaxWindows : 50,
    desktopSemantic: value.desktopSemantic !== false,
    desktopMaxElements: Number.isInteger(value.desktopMaxElements) ? value.desktopMaxElements : 200,
    desktopMacDisplay: Number.isInteger(value.desktopMacDisplay) ? value.desktopMacDisplay : 1,
    desktopWindowsPowerShell: typeof value.desktopWindowsPowerShell === 'string' ? value.desktopWindowsPowerShell : '',
    desktopArtifactsDir: typeof value.desktopArtifactsDir === 'string' ? value.desktopArtifactsDir : '',
    mcpEnabled: value.mcpEnabled === true,
    mcpServers: Array.isArray(value.mcpServers)
      ? value.mcpServers.map((server, index) => normalizeMcpServer(server, index))
      : [],
    mcpMaxTools: Number.isInteger(value.mcpMaxTools) ? value.mcpMaxTools : 16,
    mcpMaxSchemaTokens: Number.isInteger(value.mcpMaxSchemaTokens) ? value.mcpMaxSchemaTokens : 12_000,
    mcpMaxResultChars: Number.isInteger(value.mcpMaxResultChars) ? value.mcpMaxResultChars : 20_000,
    mcpToolCallTimeoutMs: Number.isInteger(value.mcpToolCallTimeoutMs) ? value.mcpToolCallTimeoutMs : 30_000,
    mcpAudit: value.mcpAudit !== false,
    mcpArtifactDir: value.mcpArtifactDir === false
      ? false
      : typeof value.mcpArtifactDir === 'string' ? value.mcpArtifactDir : '',
  }
}

export function settingsPathOps(currentValue, draft) {
  const current = normalizeSettingsDraft(currentValue)
  const ops = []
  for (const field of SETTINGS_FIELDS) {
    const next = draft[field]
    if (OPTIONAL_ROUTE_FIELDS.has(field) && (next === undefined || next === '')) {
      if (currentValue?.[field] !== undefined && currentValue[field] !== '') {
        ops.push({ op: 'unset', path: [field] })
      }
      continue
    }
    if (JSON.stringify(current[field]) !== JSON.stringify(next)) {
      ops.push({ op: 'set', path: [field], value: next })
    }
  }
  return ops
}

export function settingsDraftFailure(draft, providerId = 'deepseekeyes', upstreamNativeVision = false) {
  if (typeof draft.upstreamProvider !== 'string' || draft.upstreamProvider.trim() === '') {
    return 'upstreamRequired'
  }
  if (draft.upstreamProvider === providerId) return 'recursiveUpstream'
  if (draft.visionModel !== '' && draft.visionProvider === '') return 'visionProviderRequired'
  if (!upstreamNativeVision
    && !draft.autoDetectVision
    && draft.visionProvider === ''
    && draft.visionRoutePriority.trim() === '') {
    return 'visionRouteRequired'
  }
  if (draft.visionRoutePriority !== '') {
    const entries = draft.visionRoutePriority.split(/[\n,]+/).map(entry => entry.trim()).filter(Boolean)
    if (entries.some(entry => entry.indexOf('/') <= 0 || entry.endsWith('/'))) return 'visionRoutePriorityFormat'
  }
  if (typeof draft.browserLocale !== 'string' || draft.browserLocale.trim() === '') return 'browserLocaleRequired'
  if (!['auto', 'always', 'manual'].includes(draft.desktopVisualMode)) return 'desktopVisualModeInvalid'
  if (!Array.isArray(draft.mcpServers)) return 'mcpServersInvalid'
  const serverIds = new Set()
  const serverNames = new Set()
  for (const server of draft.mcpServers) {
    if (typeof server.id !== 'string' || !MCP_SERVER_ID.test(server.id)) return 'mcpServerIdInvalid'
    const normalizedId = server.id.toLowerCase()
    if (serverIds.has(normalizedId)) return 'mcpServerIdDuplicate'
    serverIds.add(normalizedId)
    if (typeof server.name !== 'string' || server.name.trim() === '') return 'mcpServerNameRequired'
    const normalizedName = server.name.trim().toLocaleLowerCase('en-US')
    if (serverNames.has(normalizedName)) return 'mcpServerNameDuplicate'
    serverNames.add(normalizedName)
    if (!['stdio', 'streamable-http'].includes(server.transport)) return 'mcpServerTransportInvalid'
    if (server.transport === 'stdio' && (typeof server.command !== 'string' || server.command.trim() === '')) {
      return 'mcpServerCommandRequired'
    }
    if (!Array.isArray(server.args) || server.args.some(argument => typeof argument !== 'string')) {
      return 'mcpServerArgsInvalid'
    }
    if (server.transport === 'stdio' && mcpArgsContainInlineCredentials(server.args)) {
      return 'mcpServerArgsCredential'
    }
    if (server.transport === 'stdio'
      && ((typeof server.url === 'string' && server.url !== '') || Object.keys(server.headers ?? {}).length > 0)) {
      return 'mcpServerTransportFields'
    }
    if (server.transport === 'streamable-http') {
      if ((typeof server.command === 'string' && server.command !== '')
        || (typeof server.cwd === 'string' && server.cwd !== '')
        || server.args.length > 0 || Object.keys(server.env ?? {}).length > 0) {
        return 'mcpServerTransportFields'
      }
      try {
        const url = new URL(server.url)
        if (!['http:', 'https:'].includes(url.protocol)) return 'mcpServerUrlInvalid'
        if (!mcpHttpUrlUsesSecureTransport(url)) return 'mcpServerUrlHttpsRequired'
        if (url.username !== '' || url.password !== ''
          || [...url.searchParams.keys()].some(key => CREDENTIAL_QUERY.test(key))) {
          return 'mcpServerUrlCredential'
        }
      } catch {
        return 'mcpServerUrlInvalid'
      }
    }
    if (server.timeoutMs !== undefined
      && (!Number.isInteger(server.timeoutMs) || server.timeoutMs < 100 || server.timeoutMs > 3_600_000)) {
      return 'mcpServerTimeoutMsRange'
    }
    if (typeof server.env !== 'object' || server.env === null || Array.isArray(server.env)
      || Object.entries(server.env).some(([key, reference]) => !ENVIRONMENT_NAME.test(key)
        || typeof reference !== 'object' || reference === null
        || typeof reference.env !== 'string' || !ENVIRONMENT_NAME.test(reference.env))) {
      return 'mcpServerEnvInvalid'
    }
    if (typeof server.headers !== 'object' || server.headers === null || Array.isArray(server.headers)
      || Object.entries(server.headers).some(([key, reference]) => !HTTP_HEADER_NAME.test(key)
        || typeof reference !== 'object' || reference === null
        || typeof reference.env !== 'string' || !ENVIRONMENT_NAME.test(reference.env))) {
      return 'mcpServerHeadersInvalid'
    }
    if (!Array.isArray(server.allowedTools) || !Array.isArray(server.denyTools)) return 'mcpServerToolsInvalid'
    const denied = new Set(server.denyTools)
    if (server.allowedTools.some(tool => denied.has(tool))) return 'mcpServerToolsConflict'
  }
  const tokenRanges = [
    ['baseMaxTokens', 512],
    ['targetMaxTokens', 256],
    ['automationContextMaxTokens', 4_096],
    ['mcpMaxSchemaTokens', 256],
  ]
  for (const [field, minimum] of tokenRanges) {
    if (draft[field] !== 0 && (!Number.isSafeInteger(draft[field]) || draft[field] < minimum)) {
      return `${field}Range`
    }
  }
  const ranges = [
    ['maxClarifications', 0, 8],
    ['automationMaxCallsPerTurn', 0, 10_000],
    ['visionFailoverAttempts', 0, 8],
    ['visionHealthTtlMs', 1_000, 3_600_000],
    ['visionFailureCooldownMs', 0, 3_600_000],
    ['visionAttemptLimit', 10, 10_000],
    ['historyImageLimit', 0, 32],
    ['historySummaryChars', 64, 2_000],
    ['browserHistoryLimit', 0, 32],
    ['browserTimeoutMs', 1_000, 120_000],
    ['browserSettleMs', 0, 10_000],
    ['browserViewportWidth', 320, 3_840],
    ['browserViewportHeight', 240, 2_160],
    ['browserMaxElements', 20, 500],
    ['browserMaxTextChars', 1_000, 100_000],
    ['desktopHistoryLimit', 0, 32],
    ['desktopTimeoutMs', 1_000, 120_000],
    ['desktopSettleMs', 0, 10_000],
    ['desktopMaxWindows', 1, 200],
    ['desktopMaxElements', 20, 500],
    ['desktopMacDisplay', 1, 32],
    ['mcpMaxTools', 0, 1_000],
    ['mcpMaxResultChars', 256, 10_000_000],
    ['mcpToolCallTimeoutMs', 100, 3_600_000],
  ]
  for (const [field, minimum, maximum] of ranges) {
    if (!Number.isInteger(draft[field]) || draft[field] < minimum || draft[field] > maximum) {
      return `${field}Range`
    }
  }
  return undefined
}

export function providerSettingsTarget(providers, provider) {
  const row = providers.find(candidate => candidate.provider === provider)
  if (row?.settingsNs !== 'llm-pi-ai') return undefined
  return { ns: row.settingsNs, path: [...row.settingsPath] }
}

export function providerDeclaresVision(namespaces, target) {
  if (target === undefined) return false
  const namespace = namespaces.find(candidate => candidate.ns === target.ns)
  const profile = valueAt(namespace?.value, target.path)
  const input = profile?.defaultInput
  return Array.isArray(input) && input.includes('text') && input.includes('image')
}

export function providerVisionMutation(namespaces, target, enabled) {
  if (target === undefined) return undefined
  const namespace = namespaces.find(candidate => candidate.ns === target.ns)
  if (namespace === undefined) return undefined
  return {
    ns: target.ns,
    expectedRevision: namespace.revision,
    ops: [{
      op: 'set',
      path: [...target.path, 'defaultInput'],
      value: enabled ? ['text', 'image'] : ['text'],
    }],
  }
}

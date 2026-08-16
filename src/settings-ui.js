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
])

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

export function settingsDraftFailure(draft, providerId = 'deepseekeyes') {
  if (typeof draft.upstreamProvider !== 'string' || draft.upstreamProvider.trim() === '') {
    return 'upstreamRequired'
  }
  if (draft.upstreamProvider === providerId) return 'recursiveUpstream'
  if (draft.visionModel !== '' && draft.visionProvider === '') return 'visionProviderRequired'
  if (!draft.autoDetectVision && draft.visionProvider === '' && draft.visionRoutePriority.trim() === '') {
    return 'visionRouteRequired'
  }
  if (draft.visionRoutePriority !== '') {
    const entries = draft.visionRoutePriority.split(/[\n,]+/).map(entry => entry.trim()).filter(Boolean)
    if (entries.some(entry => entry.indexOf('/') <= 0 || entry.endsWith('/'))) return 'visionRoutePriorityFormat'
  }
  if (typeof draft.browserLocale !== 'string' || draft.browserLocale.trim() === '') return 'browserLocaleRequired'
  if (!['auto', 'always', 'manual'].includes(draft.desktopVisualMode)) return 'desktopVisualModeInvalid'
  const tokenRanges = [
    ['baseMaxTokens', 512],
    ['targetMaxTokens', 256],
  ]
  for (const [field, minimum] of tokenRanges) {
    if (draft[field] !== 0 && (!Number.isSafeInteger(draft[field]) || draft[field] < minimum)) {
      return `${field}Range`
    }
  }
  const ranges = [
    ['maxClarifications', 0, 8],
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

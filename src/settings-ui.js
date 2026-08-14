const SETTINGS_FIELDS = Object.freeze([
  'upstreamProvider',
  'upstreamModel',
  'visionProvider',
  'visionModel',
  'autoDetectVision',
  'activeProbe',
  'persistentEvidence',
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
])

const OPTIONAL_ROUTE_FIELDS = new Set([
  'upstreamModel',
  'visionProvider',
  'visionModel',
  'browserChannel',
  'browserExecutablePath',
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
    autoDetectVision: value.autoDetectVision !== false,
    activeProbe: value.activeProbe !== false,
    persistentEvidence: value.persistentEvidence !== false,
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
  if (!draft.autoDetectVision && draft.visionProvider === '') return 'visionRouteRequired'
  if (typeof draft.browserLocale !== 'string' || draft.browserLocale.trim() === '') return 'browserLocaleRequired'
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
    ['historyImageLimit', 0, 32],
    ['historySummaryChars', 64, 2_000],
    ['browserHistoryLimit', 0, 32],
    ['browserTimeoutMs', 1_000, 120_000],
    ['browserSettleMs', 0, 10_000],
    ['browserViewportWidth', 320, 3_840],
    ['browserViewportHeight', 240, 2_160],
    ['browserMaxElements', 20, 500],
    ['browserMaxTextChars', 1_000, 100_000],
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

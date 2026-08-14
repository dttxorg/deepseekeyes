const SETTINGS_FIELDS = Object.freeze([
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

const OPTIONAL_ROUTE_FIELDS = new Set(['visionProvider', 'visionModel'])

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
    visionProvider: typeof value.visionProvider === 'string' ? value.visionProvider : '',
    visionModel: typeof value.visionModel === 'string' ? value.visionModel : '',
    autoDetectVision: value.autoDetectVision !== false,
    activeProbe: value.activeProbe !== false,
    persistentEvidence: value.persistentEvidence !== false,
    maxClarifications: Number.isInteger(value.maxClarifications) ? value.maxClarifications : 3,
    baseMaxTokens: Number.isInteger(value.baseMaxTokens) ? value.baseMaxTokens : 8192,
    targetMaxTokens: Number.isInteger(value.targetMaxTokens) ? value.targetMaxTokens : 4096,
  }
}

export function settingsPathOps(currentValue, draft) {
  const current = normalizeSettingsDraft(currentValue)
  const ops = []
  for (const field of SETTINGS_FIELDS) {
    const next = draft[field]
    if (OPTIONAL_ROUTE_FIELDS.has(field) && (next === undefined || next === '')) {
      if (currentValue?.[field] !== undefined) ops.push({ op: 'unset', path: [field] })
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
  const ranges = [
    ['maxClarifications', 0, 8],
    ['baseMaxTokens', 512, 32768],
    ['targetMaxTokens', 256, 16384],
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

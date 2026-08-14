import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeSettingsDraft,
  providerDeclaresVision,
  providerSettingsTarget,
  providerVisionMutation,
  settingsDraftFailure,
  settingsPathOps,
} from '../src/settings-ui.js'

test('GUI draft emits minimal live settings mutations and validates routing constraints', () => {
  const current = normalizeSettingsDraft({
    upstreamProvider: 'text-a',
    visionProvider: 'eyes',
    visionModel: 'vision-a',
  })
  const draft = { ...current, visionProvider: '', visionModel: '', maxClarifications: 5 }
  assert.deepEqual(settingsPathOps(current, draft), [
    { op: 'unset', path: ['visionProvider'] },
    { op: 'unset', path: ['visionModel'] },
    { op: 'set', path: ['maxClarifications'], value: 5 },
  ])
  assert.equal(settingsDraftFailure({ ...draft, autoDetectVision: false }), 'visionRouteRequired')
  assert.equal(settingsDraftFailure({ ...draft, upstreamProvider: 'deepseekeyes' }), 'recursiveUpstream')
  assert.equal(settingsDraftFailure({ ...current, baseMaxTokens: 500 }), 'baseMaxTokensRange')
  assert.equal(settingsDraftFailure(current), undefined)
})

test('custom gateway vision switch addresses only llm-pi-ai defaultInput and preserves sibling fields', () => {
  const providers = [{
    provider: 'custom-gateway',
    displayName: 'Custom Gateway',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'custom-gateway'],
    active: true,
  }]
  const namespaces = [{
    ns: 'llm-pi-ai',
    revision: 7,
    value: {
      providers: {
        'custom-gateway': {
          api: 'openai-completions',
          baseURL: 'https://gateway.invalid/v1',
          models: [{ id: 'vision-model', contextWindow: 65536 }],
          defaultInput: ['text'],
        },
      },
    },
  }]
  const target = providerSettingsTarget(providers, 'custom-gateway')
  assert.deepEqual(target, { ns: 'llm-pi-ai', path: ['providers', 'custom-gateway'] })
  assert.equal(providerDeclaresVision(namespaces, target), false)
  assert.deepEqual(providerVisionMutation(namespaces, target, true), {
    ns: 'llm-pi-ai',
    expectedRevision: 7,
    ops: [{
      op: 'set',
      path: ['providers', 'custom-gateway', 'defaultInput'],
      value: ['text', 'image'],
    }],
  })
  assert.equal(namespaces[0].value.providers['custom-gateway'].baseURL, 'https://gateway.invalid/v1')
  assert.deepEqual(namespaces[0].value.providers['custom-gateway'].models, [{ id: 'vision-model', contextWindow: 65536 }])
})

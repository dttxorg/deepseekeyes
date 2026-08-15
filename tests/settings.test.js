import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../dsh/index.js'
import {
  SettingsConfig,
  SETTINGS_NAMESPACE,
  settingsBase,
  settingsInput,
  validateSettings,
} from '../src/settings.js'
import { mockContext } from './_helpers.js'
import { textStream } from '../src/stream.js'

class FakeSettings {
  constructor() {
    this.registration = undefined
  }

  register(namespace, schema, options = {}) {
    let current = schema(options.base ?? {})
    options.validate?.(current)
    const watchers = new Set()
    const scope = {
      get: () => current,
      watch: (callback) => {
        watchers.add(callback)
        return () => watchers.delete(callback)
      },
      commit: (user) => {
        const previous = current
        const candidate = schema({ ...(options.base ?? {}), ...user })
        options.validate?.(candidate)
        current = candidate
        for (const watcher of watchers) watcher(current, previous)
      },
    }
    this.registration = { namespace, schema, options, scope }
    return scope
  }
}

function settingsContext() {
  const ctx = mockContext()
  ctx.settings = new FakeSettings()
  ctx.inject = (services, callback) => {
    if (services.includes('settings')) callback(ctx)
  }
  ctx.llm.directory = []
  ctx.llm.registerConfigurableProviders = function register(entries) {
    this.directory.push(...structuredClone(entries))
    return () => { this.directory = [] }
  }
  ctx.llm.listConfigurableProviders = function list() {
    return structuredClone(this.directory)
  }
  return ctx
}

test('Harness settings schema is serializable and keeps plugin identity outside the user layer', () => {
  const json = SettingsConfig.toJSON()
  assert.equal(typeof json, 'object')
  assert.match(JSON.stringify(json), /upstreamProvider/)
  assert.match(JSON.stringify(json), /upstreamModel/)
  assert.match(JSON.stringify(json), /maxClarifications/)
  assert.match(JSON.stringify(json), /browserComputerUse/)
  assert.match(JSON.stringify(json), /browserViewportWidth/)
  assert.match(JSON.stringify(json), /desktopComputerUse/)
  assert.match(JSON.stringify(json), /desktopWindowsPowerShell/)

  const base = settingsBase(validateSettings({ activeProbe: false }, { cacheDir: false }, {}))
  assert.equal(base.upstreamProvider, 'deepseek-official')
  assert.equal(base.upstreamModel, undefined)
  assert.equal(base.activeProbe, false)
  assert.equal(base.baseMaxTokens, 16_384)
  assert.equal(base.targetMaxTokens, 8_192)
  assert.equal(base.historyImageLimit, 8)
  assert.equal(base.historySummaryChars, 320)
  assert.equal(base.browserHistoryLimit, 8)
  assert.equal(base.browserComputerUse, false)
  assert.equal(base.desktopHistoryLimit, 8)
  assert.equal(base.desktopComputerUse, false)
  assert.equal(base.desktopTimeoutMs, 15_000)
  assert.equal(base.desktopMacDisplay, 1)
  assert.equal('cacheDir' in base, false)
  assert.equal('providerId' in base, false)

  const merged = settingsInput(
    { providerId: 'fixed-eyes', displayName: 'Fixed', cacheDir: false },
    { providerId: 'wrong', upstreamProvider: 'custom-text' },
  )
  assert.equal(merged.providerId, 'fixed-eyes')
  assert.equal(merged.displayName, 'Fixed')
  assert.equal(merged.cacheDir, false)
  assert.equal(merged.upstreamProvider, 'custom-text')
})

test('native settings registration exposes the namespace and reconfigures routing live', async () => {
  const ctx = settingsContext()
  let defaultCalls = 0
  let alternateCalls = 0
  const alternateModels = []
  ctx.llm.addProvider(
    'deepseek-official',
    [{ id: 'deepseek-model', inputModalities: ['text'] }],
    () => { defaultCalls += 1; return textStream('default') },
  )
  ctx.llm.addProvider(
    'alternate-deepseek',
    [
      { id: 'alternate-model-a', name: 'Alternate A', inputModalities: ['text'] },
      { id: 'alternate-model-b', name: 'Alternate B', inputModalities: ['text'] },
    ],
    (options) => {
      alternateCalls += 1
      alternateModels.push(options.model)
      return textStream('alternate')
    },
  )
  ctx.llm.addProvider(
    'configured-eye',
    [{ id: 'vision-model', inputModalities: ['text', 'image'] }],
    () => textStream('{}'),
  )

  const state = apply(ctx, { activeProbe: false, cacheDir: false })
  assert.equal(ctx.settings.registration.namespace, SETTINGS_NAMESPACE)
  assert.deepEqual(ctx.llm.listConfigurableProviders(), [{
    provider: 'deepseekeyes',
    displayName: 'DeepSeekEyes',
    settingsNs: 'deepseekeyes',
    settingsPath: [],
  }])

  ctx.settings.registration.scope.commit({
    upstreamProvider: 'alternate-deepseek',
    upstreamModel: 'alternate-model-b',
    visionProvider: 'configured-eye',
    visionModel: 'vision-model',
    activeProbe: false,
    baseMaxTokens: 0,
    targetMaxTokens: 131_072,
    historyImageLimit: 4,
    historySummaryChars: 256,
    browserHistoryLimit: 3,
    browserHeadless: true,
    desktopComputerUse: true,
    desktopHistoryLimit: 2,
    desktopTimeoutMs: 20_000,
    desktopSettleMs: 450,
    desktopMaxWindows: 25,
    desktopMacDisplay: 2,
    desktopWindowsPowerShell: 'C:\\Windows\\powershell.exe',
  })

  assert.equal(state.config.upstreamProvider, 'alternate-deepseek')
  assert.equal(state.config.upstreamModel, 'alternate-model-b')
  assert.equal(state.config.visionProvider, 'configured-eye')
  assert.equal(state.config.visionModel, 'vision-model')
  assert.equal(state.config.activeProbe, false)
  assert.equal(state.config.baseMaxTokens, 0)
  assert.equal(state.config.targetMaxTokens, 131_072)
  assert.equal(state.config.historyImageLimit, 4)
  assert.equal(state.config.historySummaryChars, 256)
  assert.equal(state.config.browserHistoryLimit, 3)
  assert.equal(state.config.browserHeadless, true)
  assert.equal(state.config.desktopComputerUse, true)
  assert.equal(state.config.desktopHistoryLimit, 2)
  assert.equal(state.config.desktopTimeoutMs, 20_000)
  assert.equal(state.config.desktopSettleMs, 450)
  assert.equal(state.config.desktopMaxWindows, 25)
  assert.equal(state.config.desktopMacDisplay, 2)
  assert.equal(state.config.desktopWindowsPowerShell, 'C:\\Windows\\powershell.exe')
  assert.ok(ctx.tools.get('computer'))
  const models = await ctx.llm.listModels('deepseekeyes')
  assert.deepEqual(models.map(model => model.id), ['alternate-model-b'])
  assert.equal(models[0].name, 'Alternate B · vision-model Eyes')
  assert.equal(models[0].description, 'Vision: configured-eye/vision-model · Final: alternate-deepseek/alternate-model-b')

  const chunks = []
  for await (const chunk of ctx.llm.stream({
    provider: 'deepseekeyes',
    model: 'alternate-model-b',
    messages: [],
  })) chunks.push(chunk)
  assert.equal(defaultCalls, 0)
  assert.equal(alternateCalls, 1)
  assert.deepEqual(alternateModels, ['alternate-model-b'])

  await assert.rejects(
    ctx.llm.resolveModelInfo('deepseekeyes', 'alternate-model-a'),
    (error) => error.code === 'UPSTREAM_MODEL_LOCKED',
  )

  assert.throws(
    () => ctx.settings.registration.scope.commit({ visionModel: 'vision-without-provider' }),
    /requires visionProvider/,
  )
})

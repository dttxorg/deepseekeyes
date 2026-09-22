import assert from 'node:assert/strict'
import test from 'node:test'
import { JevClient } from '../src/jev/client.js'
import { JevControlManager } from '../src/jev/index.js'

test('JevClient sends bounded semantic candidates and normalizes the decision', async () => {
  let request
  const client = new JevClient({
    environment: { TYPESAFE_API_KEY: 'fixture-key' },
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body)
      return new Response(JSON.stringify({
        model: 'jev-latest',
        usage: { input_tokens: 12 },
        answers: {
          target: { choice: 'i2', confidence: 0.91 },
          action: { choice: 'click_element' },
          done: { noul: 0.04 },
          risk: { noul: 0.01 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const result = await client.decide({
    goal: 'open the settings page',
    surface: 'browser',
    app: 'Chromium',
    context: 'page text',
    candidates: [
      { index: 1, ref: 'e1', role: 'link', label: 'Home' },
      { index: 2, ref: 'e2', role: 'link', label: 'Settings' },
    ],
  })
  assert.equal(result.action, 'click_element')
  assert.equal(result.targetRef, 'e2')
  assert.equal(result.confidence, 0.91)
  assert.equal(request.state.candidates.length, 2)
  assert.equal(request.questions.target.criteria.i2, 'link: Settings')
})

test('JevControlManager previews and executes only newest-state semantic actions', async () => {
  const calls = []
  const browser = {
    async execute(args) {
      calls.push(args)
      if (args.action === 'observe') return { ok: true, stateId: 's1', url: 'https://example.test', elements: [{ ref: 'e1', role: 'button', name: 'Continue' }] }
      return { ok: true, stateId: 's2', actionResult: { performed: true }, elements: [{ ref: 'e2', role: 'button', name: 'Done' }] }
    },
  }
  const client = {
    async decide() {
      return { action: 'click_element', targetRef: 'e1', targetLabel: 'Continue', operationConfidence: 0.99, done: 0.1, risk: 0.01, confidence: 0.9 }
    },
  }
  const manager = new JevControlManager({}, {
    providerId: 'deepseekeyes',
    jevEnabled: true,
    jevMaxSteps: 1,
    jevEndpoint: 'https://example.test',
    jevModel: 'jev-latest',
    jevApiKeyEnv: 'TYPESAFE_API_KEY',
    jevDecisionTimeoutMs: 1_000,
  }, { browser, client })
  const preview = await manager.execute({ surface: 'browser', goal: 'continue', execute: false }, {})
  assert.equal(preview.status, 'dry_run')
  assert.deepEqual(preview.plannedAction, { action: 'click', stateId: 's1', ref: 'e1' })
  assert.equal(calls.length, 1)
  const executed = await manager.execute({ surface: 'browser', goal: 'continue', execute: true }, {})
  assert.equal(executed.status, 'max_steps')
  assert.deepEqual(calls.at(-1), { action: 'click', stateId: 's1', ref: 'e1' })
})

test('JevControlManager gates low-confidence decisions before mutation', async () => {
  const calls = []
  const browser = { async execute(args) { calls.push(args); return { stateId: 's1', elements: [{ ref: 'e1', role: 'button', name: 'Delete' }] } } }
  const client = { async decide() { return { action: 'click_element', targetRef: 'e1', confidence: 0.2, operationConfidence: 0.99, risk: 0 } } }
  const manager = new JevControlManager({}, {
    providerId: 'deepseekeyes', jevEnabled: true, jevMaxSteps: 1,
    jevEndpoint: 'https://example.test', jevModel: 'jev-latest',
    jevApiKeyEnv: 'TYPESAFE_API_KEY', jevDecisionTimeoutMs: 1_000,
  }, { browser, client })
  const result = await manager.execute({ surface: 'browser', goal: 'delete', execute: true }, {})
  assert.equal(result.code, 'JEV_LOW_TARGET_CONFIDENCE')
  assert.equal(calls.length, 1)
})

test('Jev dry run never opens a URL or launches an application', async () => {
  const controller = { execute() { throw new Error('unexpected mutation') } }
  const manager = new JevControlManager({}, { jevEnabled: true }, { browser: controller, desktop: controller })
  for (const input of [{ surface: 'browser', url: 'https://example.test' }, { surface: 'desktop', application: 'Calculator' }]) {
    assert.equal((await manager.execute({ ...input, goal: 'preview', confirmed: true })).status, 'dry_run')
  }
})

test('Jev settings survive Harness schema and live enablement changes', async () => {
  const { SettingsConfig, settingsBase, validateSettings } = await import('../src/settings.js')
  const { applyJevControl } = await import('../src/jev/index.js')
  const config = validateSettings({ jevEnabled: true, jevMaxSteps: 2 }, {}, {})
  const section = SettingsConfig(settingsBase(config))
  assert.equal(section.jevEnabled, true)
  assert.equal(section.jevMaxSteps, 2)
  let registered = 0
  const ctx = { tools: { register() { registered++; return () => { registered-- } } } }
  const manager = applyJevControl(ctx, { ...config, jevEnabled: false })
  assert.equal(registered, 0)
  manager.reconfigure(config)
  assert.equal(registered, 1)
  manager.reconfigure({ ...config, jevEnabled: false })
  assert.equal(registered, 0)
})

test('Jev projection excludes values, screenshots, URLs and unrelated window data', async () => {
  const manager = new JevControlManager({}, { jevEnabled: true, jevMaxSteps: 1 }, {
    browser: { async execute() { return { stateId: 's1', url: 'SECRET_URL', screenshot: 'SECRET_IMAGE', windows: ['SECRET_WINDOW'], elements: [{ ref: 'e1', name: 'Username', value: 'SECRET_VALUE' }, { ref: 'e2', type: 'password', name: 'SECRET_PASSWORD' }] } } },
    client: { async decide(input) { assert.doesNotMatch(JSON.stringify(input), /SECRET_/); return { action: 'blocked' } } },
  })
  assert.equal((await manager.execute({ surface: 'browser', goal: 'view' })).status, 'blocked')
})

test('Jev redacts free-text goal and context before external dispatch', async () => {
  let request
  const client = new JevClient({ environment: { TYPESAFE_API_KEY: 'fixture-key' }, fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body)
    return new Response(JSON.stringify({ answers: { action: { choice: 'blocked', confidence: 1 }, risk: { noul: 1 } } }), { status: 200 })
  } })
  await client.decide({ goal: 'use Bearer ts_SECRET123456789 npm_abcd12345678 alice@example.com', surface: 'browser', app: 'x', context: 'Bearer ts_SECRET123456789', candidates: [] })
  assert.doesNotMatch(JSON.stringify(request), /SECRET123456789|abcd12345678|alice@example.com/)
})

test('Jev never sends a native key to the ambient foreground window', async () => {
  const calls = []
  const manager = new JevControlManager({}, { jevEnabled: true, jevMaxSteps: 1 }, {
    desktop: { async execute(args) { calls.push(args); return { ok: true, stateId: 's1', observationScope: { type: 'window', window: { ref: 'w1' } }, elements: [{ ref: 'e1', name: 'Send', enabled: true, visible: true, focused: true }] } } },
    client: { async decide() { return { action: 'press_key', targetRef: 'e1', confidence: 1, operationConfidence: 1, risk: 0 } } },
  })
  const result = await manager.execute({ surface: 'desktop', goal: 'send', execute: true, key: 'ArrowDown' }, {})
  assert.equal(result.code, 'JEV_ACTION_UNSUPPORTED')
  assert.equal(calls.filter(call => call.action === 'key').length, 0)
})

test('Jev rejects typing into a non-editable semantic control before mutation', async () => {
  const calls = []
  const manager = new JevControlManager({}, { jevEnabled: true, jevMaxSteps: 1 }, {
    browser: { async execute(args) { calls.push(args); return { ok: true, stateId: 's1', elements: [{ ref: 'e1', role: 'button', name: 'Send', editable: false, enabled: true, visible: true }] } } },
    client: { async decide() { return { action: 'type_text', targetRef: 'e1', confidence: 1, operationConfidence: 1, risk: 0 } } },
  })
  const result = await manager.execute({ surface: 'browser', goal: 'type', execute: true, text: 'hello', sensitive: false }, {})
  assert.equal(result.code, 'JEV_TARGET_NOT_EDITABLE')
  assert.equal(calls.length, 1)
})

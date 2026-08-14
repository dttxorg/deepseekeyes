import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('prebuilt Harness web bundle registers the native DeepSeekEyes settings card', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let record
  const window = {
    __ModuleLoader__: {
      load(value) { record = value },
    },
  }
  vm.runInNewContext(source, { window })
  assert.equal(record.id, 'deepseekeyes')

  const react = {
    useCallback: value => value,
    useEffect() {},
    useMemo: value => value(),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const runtime = { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null }
  const client = record.factory((id) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return runtime
    throw new Error(`unexpected client dependency ${id}`)
  })
  assert.deepEqual([...client.inject], ['slots', 'locale', 'connection', 'remote', 'settingsScope'])

  let registered
  let localeNamespace
  const scope = { getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {} }
  const api = {}
  const ctx = {
    get(name) {
      assert.equal(name, 'connection')
      return { api }
    },
    settingsScope: { bind: spec => { assert.equal(spec.namespace, 'deepseekeyes'); return scope } },
    effect(install) { install() },
    locale: { register(ns) { localeNamespace = ns; return () => {} } },
    slots: {
      inject(name, install) {
        assert.equal(name, 'settings.plugin.item')
        install()
      },
      register(options, component) {
        registered = { options, component }
        return () => {}
      },
    },
  }
  client.apply(ctx)
  assert.equal(localeNamespace, 'deepseekeyes.settings')
  assert.equal(registered.options.name, 'settings.plugin.item')
  assert.equal(registered.options.id, 'deepseekeyes')
  assert.equal(registered.options.locale, 'deepseekeyes.settings')
  assert.equal(registered.options.inject().scope, scope)
  assert.equal(registered.options.inject().api, api)
  assert.equal(typeof registered.component, 'function')
})

test('settings card inherits Harness theme tokens and top-aligns side-by-side fields', async () => {
  const source = await readFile(new URL('../client/index.jsx', import.meta.url), 'utf8')
  for (const token of [
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-border-l2',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-button-primary-fill',
  ]) assert.ok(source.includes(token), `missing Harness theme token ${token}`)
  assert.match(source, /field: \{[^}]*alignContent: 'start'/)
  assert.match(source, /grid: \{[^}]*alignItems: 'start'/)
  assert.match(source, /input: \{[^}]*height: 36/)
})

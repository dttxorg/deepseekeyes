import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('prebuilt Harness web bundle registers the native DeepSeekEyes settings card', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  let record
  const window = {
    __ModuleLoader__: {
      load(value) { record = value },
    },
  }
  vm.runInNewContext(source, { window })
  assert.equal(record.id, manifest.name)

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
  const rpc = {}
  const ctx = {
    get(name) {
      assert.equal(name, 'connection')
      return { api, rpc }
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
  assert.equal(registered.options.inject().usageRpc, rpc)
  assert.equal(typeof registered.component, 'function')
})

test('settings card inherits Harness theme tokens and top-aligns side-by-side fields', async () => {
  const source = await readFile(new URL('../client/index.jsx', import.meta.url), 'utf8')
  for (const token of [
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-border-l2',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-button-primary-fill',
  ]) assert.ok(source.includes(token), `missing Harness theme token ${token}`)
  assert.match(source, /field: \{[^}]*alignContent: 'start'/)
  assert.match(source, /grid: \{[^}]*alignItems: 'start'/)
  assert.match(source, /input: \{[^}]*height: 36/)
  assert.match(source, /card: \{[^}]*background: 'var\(--dsw-alias-bg-layer-3/)
  assert.match(source, /最终回答 Provider/)
  assert.match(source, /最终回答模型/)
  assert.match(source, /后台读图模型/)
  assert.match(source, /当前路由：图片 → \{vision\} 读图 → \{final\} 最终回答/)
  assert.match(source, /id="deepseekeyes-upstream-model"/)
  assert.match(source, /推荐 · 16,384/)
  assert.match(source, /不限制 · 由 Provider 决定/)
  assert.match(source, /id="deepseekeyes-browser-channel"/)
  assert.match(source, /Computer Use 0\.5/)
  assert.match(source, /id="deepseekeyes-desktop-timeout"/)
  assert.match(source, /id="deepseekeyes-desktop-elements"/)
  assert.match(source, /读取系统无障碍语义控件/)
  assert.match(source, /Windows \/ macOS 桌面 Computer Use/)
  assert.match(source, /Token 消耗统计/)
  assert.match(source, /usage\.snapshot/)
  assert.match(source, /精确额外 Token/)
  assert.doesNotMatch(source, /id="deepseekeyes-base-tokens"[^>]*max=/)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('prebuilt Harness web bundle registers the native DeepSeekEyes settings card', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(source, /function nextMcpReferenceEntry/)
  assert.match(source, /function updateMcpToolSelection/)
  assert.match(source, /setMcpRuntimeRefreshRevision/)
  assert.match(source, /Remote Streamable HTTP servers must use HTTPS/)
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
  const runtime = {
    Fragment: Symbol('Fragment'),
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  }
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

  scope.getSnapshot = () => ({ status: 'ready', value: {}, writable: true, revision: 1 })
  const card = registered.component({ ...registered.options.inject(), t: key => key })
  const [header, body] = card.props.children
  assert.equal(card.type, 'li')
  assert.equal(header.type, 'button')
  assert.equal(header.props['aria-expanded'], false)
  assert.equal(header.props['aria-controls'], 'deepseekeyes-settings-body')
  assert.equal(header.props['aria-label'], `expand: title v${manifest.version}`)
  assert.equal(body, null)
  const headText = header.props.children[0]
  const titleRow = headText.props.children[0]
  const version = titleRow.props.children[1]
  assert.equal(version.props.children.join(''), `v${manifest.version}`)
  assert.equal(version.props['aria-label'], `version: ${manifest.version}`)
  const chevron = header.props.children.at(-1)
  assert.equal(chevron.type, 'svg')
  assert.equal(chevron.props['data-deepseekeyes-chevron'], '')
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
  assert.match(source, /自动化 Token 保护/)
  assert.match(source, /id="deepseekeyes-automation-context-tokens"/)
  assert.match(source, /id="deepseekeyes-automation-max-calls"/)
  assert.match(source, /推荐 · 32,768/)
  assert.match(source, /id="deepseekeyes-desktop-timeout"/)
  assert.match(source, /id="deepseekeyes-desktop-elements"/)
  assert.match(source, /读取系统无障碍语义控件/)
  assert.match(source, /Windows \/ macOS 桌面 Computer Use/)
  assert.match(source, /Token 消耗统计/)
  assert.match(source, /usage\.snapshot/)
  assert.match(source, /精确额外 Token/)
  assert.match(source, /Computer Use DeepSeek Token/)
  assert.match(source, /估算避免重放输入/)
  assert.match(source, /MCP 应用与工具/)
  assert.match(source, /启用 MCP 应用执行层/)
  assert.match(source, /新 Server 默认不暴露任何工具/)
  assert.match(source, /Streamable HTTP/)
  assert.match(source, /这里只保存环境变量名，不保存 Token/)
  assert.match(source, /远程 Streamable HTTP Server 必须使用 HTTPS/)
  assert.match(source, /nextMcpReferenceEntry\(value, \{ header \}\)/)
  assert.doesNotMatch(source, /key = `\$\{baseKey\}-\$\{suffix\+\+\}`/)
  assert.match(source, /mcpToolAllowedInDraft\(server, tool\)/)
  assert.match(source, /updateMcpToolSelection\(server, tool, allowed\)/)
  assert.match(source, /tool\.exposed \? 'mcpToolExposed' : tool\.riskPolicyAllowed === false \? 'mcpToolRiskBlocked' : tool\.allowed \? 'mcpToolAllowedNotExposed'/)
  assert.match(source, /id="deepseekeyes-mcp-max-tools"/)
  assert.match(source, /id="deepseekeyes-mcp-schema-budget"/)
  assert.match(source, /id="deepseekeyes-mcp-result-chars"/)
  assert.match(source, /id="deepseekeyes-mcp-external-calls"/)
  assert.match(source, /id="deepseekeyes-mcp-call-timeout"/)
  assert.match(source, /'\/deepseekeyes\/mcp'/)
  assert.match(source, /method === 'snapshot' \? 'mcp\.status'/)
  assert.match(source, /mcp\.snapshot|callMcpRpc\(rpc, 'snapshot'/)
  assert.match(source, /useEffect\(\(\) => \{ void loadRuntime\(\) \}, \[loadRuntime, refreshRevision\]\)/)
  assert.match(source, /setMcpRuntimeRefreshRevision\(current => current \+ 1\)/)
  assert.match(source, /refreshRevision=\{mcpRuntimeRefreshRevision\}/)
  assert.match(source, /<McpServerEditor\s+key=\{index\}/)
  assert.doesNotMatch(source, /key=\{`\$\{index\}:\$\{server\.id\}`\}/)
  assert.match(source, /usageMcpSubsetHint/)
  assert.match(source, /usage\.value\.totals\.derived\.mcpTokens/)
  assert.match(source, /usage\.value\.totals\.mcpExternalCalls/)
  assert.match(source, /function McpSettingsSection[\s\S]*?return \(\s*<details style=\{styles\.details\}>/)
  assert.doesNotMatch(source, /function McpSettingsSection[\s\S]*?return \(\s*<details[^>]* open>/)
  assert.match(source, /const \[open, setOpen\] = useState\(false\)/)
  assert.match(source, /aria-expanded=\{open\}/)
  assert.match(source, /aria-controls="deepseekeyes-settings-body"/)
  assert.match(source, /data-deepseekeyes-chevron/)
  assert.match(source, /chevronOpen: \{ transform: 'rotate\(180deg\)' \}/)
  assert.match(source, /const PLUGIN_VERSION = __DEEPSEEKEYES_VERSION__/)
  assert.match(source, />v\{PLUGIN_VERSION\}<\/span>/)
  assert.match(source, /\{open \? \(\s*<div id="deepseekeyes-settings-body"/)
  assert.doesNotMatch(source, /<li style=\{styles\.card\}>\s*<details open>/)
  assert.doesNotMatch(source, /id="deepseekeyes-base-tokens"[^>]*max=/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMcpServerDraft,
  mcpToolAllowedInDraft,
  mcpToolMatchesSelector,
  nextMcpReferenceEntry,
  normalizeMcpServer,
  normalizeSettingsDraft,
  providerDeclaresVision,
  providerSettingsTarget,
  providerVisionMutation,
  settingsDraftFailure,
  settingsPathOps,
  updateMcpToolSelection,
} from '../src/settings-ui.js'

test('GUI draft emits minimal live settings mutations and validates routing constraints', () => {
  const current = normalizeSettingsDraft({
    upstreamProvider: 'text-a',
    upstreamModel: 'reasoner-a',
    visionProvider: 'eyes',
    visionModel: 'vision-a',
  })
  assert.equal(current.usageStats, true)
  const draft = { ...current, upstreamModel: '', visionProvider: '', visionModel: '', maxClarifications: 5 }
  assert.deepEqual(settingsPathOps(current, draft), [
    { op: 'unset', path: ['upstreamModel'] },
    { op: 'unset', path: ['visionProvider'] },
    { op: 'unset', path: ['visionModel'] },
    { op: 'set', path: ['maxClarifications'], value: 5 },
  ])
  assert.equal(settingsDraftFailure({ ...draft, autoDetectVision: false }), 'visionRouteRequired')
  assert.equal(settingsDraftFailure({ ...draft, autoDetectVision: false }, 'deepseekeyes', true), undefined)
  assert.equal(settingsDraftFailure({ ...draft, upstreamProvider: 'deepseekeyes' }), 'recursiveUpstream')
  assert.equal(settingsDraftFailure({ ...current, baseMaxTokens: 500 }), 'baseMaxTokensRange')
  assert.equal(settingsDraftFailure({ ...current, baseMaxTokens: 0, targetMaxTokens: 0 }), undefined)
  assert.equal(settingsDraftFailure({ ...current, baseMaxTokens: 1_000_000 }), undefined)
  assert.equal(settingsDraftFailure({ ...current, browserViewportWidth: 319 }), 'browserViewportWidthRange')
  assert.equal(settingsDraftFailure({ ...current, historyImageLimit: 33 }), 'historyImageLimitRange')
  assert.equal(settingsDraftFailure({ ...current, historySummaryChars: 63 }), 'historySummaryCharsRange')
  assert.equal(settingsDraftFailure({ ...current, browserHistoryLimit: -1 }), 'browserHistoryLimitRange')
  assert.equal(settingsDraftFailure({ ...current, desktopHistoryLimit: 33 }), 'desktopHistoryLimitRange')
  assert.equal(settingsDraftFailure({ ...current, desktopTimeoutMs: 999 }), 'desktopTimeoutMsRange')
  assert.equal(settingsDraftFailure({ ...current, desktopMaxWindows: 201 }), 'desktopMaxWindowsRange')
  assert.equal(settingsDraftFailure({ ...current, desktopMaxElements: 19 }), 'desktopMaxElementsRange')
  assert.equal(settingsDraftFailure({ ...current, desktopMacDisplay: 0 }), 'desktopMacDisplayRange')
  assert.equal(settingsDraftFailure({ ...current, desktopVisualMode: 'sometimes' }), 'desktopVisualModeInvalid')
  assert.equal(settingsDraftFailure(current), undefined)
  assert.equal(current.desktopTimeoutMs, 30_000)
  assert.equal(current.desktopSemantic, true)
  assert.equal(current.desktopVisualMode, 'auto')
  assert.equal(current.desktopMaxElements, 200)
})

test('MCP settings default off, expose no tools, and emit minimal nested server mutations', () => {
  const defaults = normalizeSettingsDraft({ upstreamProvider: 'text-a' })
  assert.equal(defaults.mcpEnabled, false)
  assert.deepEqual(defaults.mcpServers, [])
  assert.equal(defaults.mcpMaxTools, 16)
  assert.equal(defaults.mcpMaxSchemaTokens, 12_000)
  assert.equal(defaults.mcpMaxResultChars, 20_000)
  assert.equal(defaults.mcpMaxExternalCallsPerRun, 64)
  assert.equal(defaults.mcpToolCallTimeoutMs, 30_000)
  assert.equal(defaults.mcpAudit, true)

  const server = {
    ...createMcpServerDraft(1),
    id: 'github',
    name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: { env: 'GH_TOKEN' } },
  }
  assert.deepEqual(server.allowedTools, [])
  assert.equal(server.timeoutMs, undefined)
  const current = normalizeSettingsDraft({ upstreamProvider: 'text-a' })
  const draft = { ...current, mcpEnabled: true, mcpServers: [server] }
  assert.deepEqual(settingsPathOps(current, draft), [
    { op: 'set', path: ['mcpEnabled'], value: true },
    { op: 'set', path: ['mcpServers'], value: [server] },
  ])
  assert.equal(settingsDraftFailure(draft), undefined)
})

test('MCP settings normalize credential references and reject unsafe or expensive invalid drafts', () => {
  const normalized = normalizeMcpServer({
    id: 'remote',
    name: 'Remote',
    transport: 'streamable-http',
    url: 'https://mcp.example.invalid/mcp',
    headers: {
      Authorization: { env: 'REMOTE_AUTHORIZATION' },
    },
    allowedTools: ['search', 'search', ''],
  })
  assert.deepEqual(normalized.env, {})
  assert.deepEqual(normalized.headers, { Authorization: { env: 'REMOTE_AUTHORIZATION' } })
  assert.deepEqual(normalized.allowedTools, ['search'])
  const local = normalizeMcpServer({
    id: 'local',
    name: 'Local',
    transport: 'stdio',
    command: 'node',
    env: {
      TOKEN: { env: 'LOCAL_TOKEN' },
      PLAINTEXT: 'secret',
    },
  })
  assert.deepEqual(local.env, { TOKEN: { env: 'LOCAL_TOKEN' } })

  const base = normalizeSettingsDraft({
    upstreamProvider: 'text-a',
    mcpServers: [normalized],
  })
  assert.equal(settingsDraftFailure(base), undefined)
  assert.equal(settingsDraftFailure({ ...base, mcpMaxSchemaTokens: 0 }), undefined)
  assert.equal(settingsDraftFailure({ ...base, mcpMaxSchemaTokens: 255 }), 'mcpMaxSchemaTokensRange')
  assert.equal(settingsDraftFailure({ ...base, mcpMaxTools: 1_001 }), 'mcpMaxToolsRange')
  assert.equal(settingsDraftFailure({ ...base, mcpMaxExternalCallsPerRun: 10_001 }), 'mcpMaxExternalCallsPerRunRange')
  assert.equal(settingsDraftFailure({ ...base, mcpMaxExternalCallsPerRun: 0 }), undefined)
  assert.equal(settingsDraftFailure({ ...base, mcpToolCallTimeoutMs: 99 }), 'mcpToolCallTimeoutMsRange')
  assert.equal(settingsDraftFailure({
    ...base,
    mcpServers: [{ ...normalized, id: 'server.id' }],
  }), 'mcpServerIdInvalid')
  assert.equal(settingsDraftFailure({
    ...base,
    mcpServers: [normalized, { ...normalized, id: 'REMOTE', name: 'Other' }],
  }), 'mcpServerIdDuplicate')
  assert.equal(settingsDraftFailure({ ...base, mcpServers: [{ ...normalized, url: 'file:///tmp/mcp' }] }), 'mcpServerUrlInvalid')
  assert.equal(settingsDraftFailure({
    ...base,
    mcpServers: [{ ...normalized, url: 'http://mcp.example.invalid/mcp', headers: {} }],
  }), 'mcpServerUrlHttpsRequired')
  assert.equal(settingsDraftFailure({
    ...base,
    mcpServers: [{ ...normalized, url: 'http://mcp.example.invalid/mcp' }],
  }), 'mcpServerUrlHttpsRequired')
  for (const url of [
    'http://localhost:3210/mcp',
    'http://fixture.localhost:3210/mcp',
    'http://127.77.4.3:3210/mcp',
    'http://[::1]:3210/mcp',
  ]) {
    assert.equal(settingsDraftFailure({
      ...base,
      mcpServers: [{ ...normalized, url }],
    }), undefined, url)
  }
  assert.equal(settingsDraftFailure({
    ...base,
    mcpServers: [{ ...normalized, url: 'https://user:secret@mcp.example.invalid/mcp' }],
  }), 'mcpServerUrlCredential')
  assert.equal(settingsDraftFailure({
    ...base,
    mcpServers: [{ ...normalized, allowedTools: ['search'], denyTools: ['search'] }],
  }), 'mcpServerToolsConflict')

  const localDraft = normalizeSettingsDraft({
    upstreamProvider: 'text-a',
    mcpServers: [{
      id: 'local',
      name: 'Local',
      transport: 'stdio',
      command: 'node',
    }],
  })
  for (const args of [
    ['--header', 'Authorization: Basic dXNlcjpwYXNz'],
    ['--header=Authorization: Bearer plaintext'],
    ['-H', 'Cookie: session=plaintext'],
    ['--auth', 'plaintext'],
    ['--oauth-token=plaintext'],
    ['--pass', 'plaintext'],
    ['--client_secret', 'plaintext'],
    ['--api_key=plaintext'],
    ['--access_token', 'plaintext'],
    ['password=plaintext'],
  ]) {
    assert.equal(
      settingsDraftFailure({
        ...localDraft,
        mcpServers: [{ ...localDraft.mcpServers[0], args }],
      }),
      'mcpServerArgsCredential',
      JSON.stringify(args),
    )
  }
  for (const args of [
    ['--header', 'Accept: application/json'],
    ['--auth-type', 'none'],
    ['--token-limit', '4096'],
    ['--token_limit', '4096'],
    ['/workspace/my-secret-project'],
  ]) {
    assert.equal(
      settingsDraftFailure({
        ...localDraft,
        mcpServers: [{ ...localDraft.mcpServers[0], args }],
      }),
      undefined,
      JSON.stringify(args),
    )
  }

  const persisted = normalizeSettingsDraft({
    upstreamProvider: 'text-a',
    mcpArtifactDir: '/tmp/mcp-artifacts',
  })
  assert.deepEqual(settingsPathOps(persisted, { ...persisted, mcpArtifactDir: false }), [
    { op: 'set', path: ['mcpArtifactDir'], value: false },
  ])
})

test('MCP reference defaults use valid unique environment identifiers', () => {
  assert.deepEqual(nextMcpReferenceEntry({}), {
    key: 'TOKEN',
    reference: { env: 'MCP_TOKEN' },
  })
  assert.deepEqual(nextMcpReferenceEntry({
    TOKEN: { env: 'MCP_TOKEN' },
  }), {
    key: 'TOKEN_2',
    reference: { env: 'MCP_TOKEN_2' },
  })
  assert.deepEqual(nextMcpReferenceEntry({
    TOKEN: { env: 'MCP_TOKEN' },
    TOKEN_2: { env: 'MCP_TOKEN_3' },
  }), {
    key: 'TOKEN_4',
    reference: { env: 'MCP_TOKEN_4' },
  })
  assert.deepEqual(nextMcpReferenceEntry({
    Authorization: { env: 'MCP_AUTHORIZATION' },
  }, { header: true }), {
    key: 'Authorization-2',
    reference: { env: 'MCP_AUTHORIZATION_2' },
  })
})

test('MCP tool checkbox policy understands globs and writes exact deny exceptions', () => {
  const tool = { name: 'read_issue', publicName: 'mcp__fixture__read_issue', allowed: true, exposed: true }
  const sibling = { name: 'read_project', publicName: 'mcp__fixture__read_project', allowed: true, exposed: true }
  const wildcard = {
    id: 'fixture',
    name: 'Fixture App',
    allowedTools: ['*'],
    denyTools: [],
  }
  assert.equal(mcpToolAllowedInDraft(wildcard, tool), true)
  const disabled = updateMcpToolSelection(wildcard, tool, false)
  assert.deepEqual(disabled.allowedTools, ['*'])
  assert.deepEqual(disabled.denyTools, ['read_issue'])
  assert.equal(mcpToolAllowedInDraft(disabled, tool), false)
  assert.equal(mcpToolAllowedInDraft(disabled, sibling), true)
  const enabled = updateMcpToolSelection(disabled, tool, true)
  assert.deepEqual(enabled.allowedTools, ['*'])
  assert.deepEqual(enabled.denyTools, [])
  assert.equal(mcpToolAllowedInDraft(enabled, tool), true)

  const qualified = { ...wildcard, allowedTools: ['fixture/read_*'] }
  assert.equal(mcpToolMatchesSelector(qualified, tool, 'fixture/read_*'), true)
  assert.equal(mcpToolAllowedInDraft(qualified, tool), true)
  assert.equal(mcpToolAllowedInDraft(qualified, { ...tool, name: 'write_issue' }), false)
  const qualifiedDisabled = updateMcpToolSelection(qualified, tool, false)
  assert.deepEqual(qualifiedDisabled, {
    ...qualified,
    denyTools: ['read_issue'],
  })

  const closed = { ...wildcard, allowedTools: [], denyTools: [] }
  const exact = updateMcpToolSelection(closed, tool, true)
  assert.deepEqual(exact.allowedTools, ['read_issue'])
  assert.deepEqual(exact.denyTools, [])
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

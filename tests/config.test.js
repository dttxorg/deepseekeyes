import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'

test('configuration resolves Harness defaults and a private evidence path', () => {
  const config = resolveConfig({}, {}, '/test-home')
  assert.equal(config.providerId, 'deepseekeyes')
  assert.equal(config.upstreamProvider, 'deepseek-official')
  assert.equal(config.upstreamModel, undefined)
  assert.equal(config.visionProvider, undefined)
  assert.equal(config.activeProbe, true)
  assert.equal(config.baseMaxTokens, 16_384)
  assert.equal(config.targetMaxTokens, 8_192)
  assert.equal(config.automationContextMaxTokens, 32_768)
  assert.equal(config.automationMaxCallsPerTurn, 32)
  assert.equal(config.historyImageLimit, 8)
  assert.equal(config.historySummaryChars, 320)
  assert.equal(config.browserHistoryLimit, 8)
  assert.equal(config.browserComputerUse, false)
  assert.equal(config.mcpEnabled, false)
  assert.deepEqual(config.mcpServers, [])
  assert.equal(config.mcpMaxTools, 16)
  assert.equal(config.mcpMaxSchemaTokens, 12_000)
  assert.equal(config.mcpMaxResultChars, 20_000)
  assert.equal(config.mcpToolCallTimeoutMs, 30_000)
  assert.equal(config.mcpAudit, true)
  assert.equal(config.cacheDir, join('/test-home', '.dsh', 'deepseekeyes', 'evidence'))
  assert.equal(config.usageStats, true)
  assert.equal(config.usageStatsPath, join('/test-home', '.dsh', 'deepseekeyes', 'usage-stats.json'))
  assert.equal(config.visionAttemptLogPath, join('/test-home', '.dsh', 'deepseekeyes', 'vision-attempts.json'))
  assert.equal(config.browserArtifactsDir, join('/test-home', '.dsh', 'deepseekeyes', 'browser-runs'))
  assert.equal(config.desktopArtifactsDir, join('/test-home', '.dsh', 'deepseekeyes', 'desktop-runs'))
  assert.equal(config.mcpArtifactDir, join('/test-home', '.dsh', 'deepseekeyes', 'mcp-artifacts'))
})

test('Streamable HTTP requires TLS except for explicit loopback hosts', () => {
  const server = url => ({
    id: 'web',
    name: 'Web',
    transport: 'streamable-http',
    url,
    headers: { Authorization: { env: 'MCP_AUTHORIZATION' } },
  })
  for (const url of [
    'http://localhost:3000/mcp',
    'http://worker.localhost:3000/mcp',
    'http://127.99.1.2:3000/mcp',
    'http://[::1]:3000/mcp',
    'https://mcp.example.test/mcp',
  ]) {
    assert.doesNotThrow(() => resolveConfig({ mcpServers: [server(url)] }, {}, '/tmp'), url)
  }
  for (const url of [
    'http://mcp.example.test/mcp',
    'http://10.0.0.5/mcp',
    'http://0.0.0.0/mcp',
    'http://localhost.example.test/mcp',
  ]) {
    assert.throws(
      () => resolveConfig({ mcpServers: [server(url)] }, {}, '/tmp'),
      /must use https unless the hostname is explicit loopback/,
      url,
    )
  }
})

test('configuration rejects common inline stdio credential option aliases', () => {
  const server = args => ({
    id: 'local',
    name: 'Local',
    transport: 'stdio',
    command: 'node',
    args,
  })
  for (const args of [
    ['--oauth-token=plaintext'],
    ['--pass', 'plaintext'],
    ['--client_secret', 'plaintext'],
    ['--api_key=plaintext'],
    ['--access_token', 'plaintext'],
  ]) {
    assert.throws(
      () => resolveConfig({ mcpServers: [server(args)] }, {}, '/tmp'),
      /credentials must use env references/,
      JSON.stringify(args),
    )
  }
  assert.doesNotThrow(() => resolveConfig({
    mcpServers: [server(['--auth-type', 'none', '--token_limit', '4096'])],
  }, {}, '/tmp'))
})

test('visual token budgets accept large custom values and provider-managed output', () => {
  const unlimited = resolveConfig({ baseMaxTokens: 0, targetMaxTokens: 0 }, {}, '/tmp')
  assert.equal(unlimited.baseMaxTokens, 0)
  assert.equal(unlimited.targetMaxTokens, 0)
  const custom = resolveConfig({ baseMaxTokens: 1_000_000, targetMaxTokens: 131_072 }, {}, '/tmp')
  assert.equal(custom.baseMaxTokens, 1_000_000)
  assert.equal(custom.targetMaxTokens, 131_072)
  assert.throws(() => resolveConfig({ baseMaxTokens: 511 }, {}, '/tmp'), /0 for provider-managed output/)
  assert.throws(() => resolveConfig({ targetMaxTokens: 255 }, {}, '/tmp'), /0 for provider-managed output/)
})

test('automation spend guard supports a recommended bound, custom values, and explicit unlimited mode', () => {
  const unlimited = resolveConfig({
    automationContextMaxTokens: 0,
    automationMaxCallsPerTurn: 0,
  }, {}, '/tmp')
  assert.equal(unlimited.automationContextMaxTokens, 0)
  assert.equal(unlimited.automationMaxCallsPerTurn, 0)

  const custom = resolveConfig({
    automationContextMaxTokens: 250_000,
    automationMaxCallsPerTurn: 96,
  }, {}, '/tmp')
  assert.equal(custom.automationContextMaxTokens, 250_000)
  assert.equal(custom.automationMaxCallsPerTurn, 96)
  assert.throws(() => resolveConfig({ automationContextMaxTokens: 4_095 }, {}, '/tmp'), /at least 4096/)
  assert.throws(() => resolveConfig({ automationMaxCallsPerTurn: 10_001 }, {}, '/tmp'), /0 through 10000/)
})

test('configuration accepts environment-selected Harness vision route', () => {
  const config = resolveConfig({}, {
    DSH_HOME: '/dsh-home',
    DEEPSEEKEYES_UPSTREAM_MODEL: 'deepseek-v4-pro',
    DEEPSEEKEYES_VISION_PROVIDER: 'configured-provider',
    DEEPSEEKEYES_VISION_MODEL: 'vision-1',
  }, '/unused')
  assert.equal(config.visionProvider, 'configured-provider')
  assert.equal(config.visionModel, 'vision-1')
  assert.equal(config.upstreamModel, 'deepseek-v4-pro')
  assert.equal(config.cacheDir, join('/dsh-home', 'deepseekeyes', 'evidence'))
  assert.equal(config.usageStatsPath, join('/dsh-home', 'deepseekeyes', 'usage-stats.json'))
})

test('configuration normalizes ordered visual fallback routes and health controls', () => {
  const config = resolveConfig({
    visionRoutePriority: 'eyes-a/model/one, eyes-b/model-two\neyes-a/model/one',
    visionFailoverAttempts: 4,
    visionHealthTtlMs: 120_000,
    visionFailureCooldownMs: 45_000,
    visionAttemptLimit: 250,
    cacheDir: false,
  }, {}, '/tmp')
  assert.equal(config.visionRoutePriority, 'eyes-a/model/one\neyes-b/model-two')
  assert.deepEqual(config.visionPriorityRoutes, [
    { provider: 'eyes-a', model: 'model/one' },
    { provider: 'eyes-b', model: 'model-two' },
  ])
  assert.equal(config.visionFailoverAttempts, 4)
  assert.equal(config.visionHealthTtlMs, 120_000)
  assert.equal(config.visionFailureCooldownMs, 45_000)
  assert.equal(config.visionAttemptLimit, 250)
  assert.throws(
    () => resolveConfig({ visionRoutePriority: 'missing-separator', cacheDir: false }, {}, '/tmp'),
    /provider\/model/,
  )
})

test('usage statistics can be disabled or kept memory-only', () => {
  const memoryOnly = resolveConfig({ cacheDir: false }, {}, '/tmp')
  assert.equal(memoryOnly.usageStats, true)
  assert.equal(memoryOnly.usageStatsPath, undefined)
  const disabled = resolveConfig({}, { DEEPSEEKEYES_USAGE_STATS: 'false' }, '/tmp')
  assert.equal(disabled.usageStats, false)
  const explicit = resolveConfig({ cacheDir: false, usageStatsPath: '/usage/stats.json' }, {}, '/tmp')
  assert.equal(explicit.usageStatsPath, '/usage/stats.json')
})

test('configuration rejects a model without a provider and recursive upstream id', () => {
  assert.throws(() => resolveConfig({ visionModel: 'x' }, {}, '/tmp'), /requires visionProvider/)
  assert.throws(
    () => resolveConfig({ providerId: 'same', upstreamProvider: 'same' }, {}, '/tmp'),
    /must differ/,
  )
})

test('configuration bounds visual clarification rounds', () => {
  assert.throws(() => resolveConfig({ maxClarifications: 9 }, {}, '/tmp'), /0 through 8/)
  assert.equal(resolveConfig({ maxClarifications: 0 }, {}, '/tmp').maxClarifications, 0)
})

test('configuration bounds retained visual history independently from original attachments', () => {
  const config = resolveConfig({
    historyImageLimit: 0,
    historySummaryChars: 2_000,
    browserHistoryLimit: 32,
  }, {}, '/tmp')
  assert.equal(config.historyImageLimit, 0)
  assert.equal(config.historySummaryChars, 2_000)
  assert.equal(config.browserHistoryLimit, 32)
  assert.throws(() => resolveConfig({ historyImageLimit: 33 }, {}, '/tmp'), /0 through 32/)
  assert.throws(() => resolveConfig({ historySummaryChars: 63 }, {}, '/tmp'), /64 through 2000/)
})

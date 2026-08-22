import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import {
  McpServerConfig,
  SettingsConfig,
  settingsBase,
  validateSettings,
} from '../src/settings.js'

const stdioServer = {
  id: 'local-files',
  name: 'Local Files',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
  env: {
    MCP_LOG_LEVEL: { env: 'DEEPSEEKEYES_TEST_MCP_LOG_LEVEL' },
  },
  allowedTools: ['read_file', 'list_directory'],
  denyTools: ['delete_file'],
  timeoutMs: 45_000,
}

const httpServer = {
  id: 'remote-github',
  name: 'Remote GitHub',
  enabled: false,
  transport: 'streamable-http',
  url: 'https://mcp.example.test/v1',
  headers: {
    Authorization: { env: 'DEEPSEEKEYES_TEST_GITHUB_AUTHORIZATION' },
  },
}

test('MCP defaults are disabled, bounded, serializable, and stored under DSH_HOME', () => {
  const config = resolveConfig({}, {}, '/test-home')
  assert.equal(config.mcpEnabled, false)
  assert.deepEqual(config.mcpServers, [])
  assert.equal(config.mcpMaxTools, 16)
  assert.equal(config.mcpMaxSchemaTokens, 12_000)
  assert.equal(config.mcpMaxResultChars, 20_000)
  assert.equal(config.mcpMaxExternalCallsPerRun, 64)
  assert.equal(config.mcpToolCallTimeoutMs, 30_000)
  assert.equal(config.mcpAudit, true)
  assert.equal(
    config.mcpArtifactDir,
    join('/test-home', '.dsh', 'deepseekeyes', 'mcp-artifacts'),
  )
  assert.equal(Object.isFrozen(config.mcpServers), true)
  assert.doesNotThrow(() => JSON.stringify(config.mcpServers))
})

test('MCP scalar environment overrides are validated without accepting server definitions', () => {
  const config = resolveConfig({}, {
    DSH_HOME: '/dsh-home',
    DEEPSEEKEYES_MCP_ENABLED: 'true',
    DEEPSEEKEYES_MCP_MAX_TOOLS: '32',
    DEEPSEEKEYES_MCP_MAX_SCHEMA_TOKENS: '65536',
    DEEPSEEKEYES_MCP_MAX_RESULT_CHARS: '250000',
    DEEPSEEKEYES_MCP_MAX_EXTERNAL_CALLS_PER_RUN: '48',
    DEEPSEEKEYES_MCP_TOOL_CALL_TIMEOUT_MS: '90000',
    DEEPSEEKEYES_MCP_AUDIT: 'false',
    DEEPSEEKEYES_MCP_ARTIFACT_DIR: '/private/mcp-artifacts',
    DEEPSEEKEYES_MCP_SERVERS: '[{"url":"https://ignored.example"}]',
  }, '/unused')
  assert.equal(config.mcpEnabled, true)
  assert.equal(config.mcpMaxTools, 32)
  assert.equal(config.mcpMaxSchemaTokens, 65_536)
  assert.equal(config.mcpMaxResultChars, 250_000)
  assert.equal(config.mcpMaxExternalCallsPerRun, 48)
  assert.equal(config.mcpToolCallTimeoutMs, 90_000)
  assert.equal(config.mcpAudit, false)
  assert.equal(config.mcpArtifactDir, '/private/mcp-artifacts')
  assert.deepEqual(config.mcpServers, [])

  assert.throws(
    () => resolveConfig({}, { DEEPSEEKEYES_MCP_MAX_TOOLS: '1e2' }, '/tmp'),
    /non-negative integer/,
  )
  assert.throws(
    () => resolveConfig({}, { DEEPSEEKEYES_MCP_MAX_SCHEMA_TOKENS: '255' }, '/tmp'),
    /256 through 1000000/,
  )

  const unlimited = resolveConfig({
    mcpMaxTools: 0,
    mcpMaxSchemaTokens: 0,
    mcpMaxExternalCallsPerRun: 0,
  }, {}, '/tmp')
  assert.equal(unlimited.mcpMaxTools, 0)
  assert.equal(unlimited.mcpMaxSchemaTokens, 0)
  assert.equal(unlimited.mcpMaxExternalCallsPerRun, 0)
  assert.throws(() => resolveConfig({ mcpMaxTools: 1_001 }, {}, '/tmp'), /1 through 1000/)
  assert.throws(
    () => resolveConfig({ mcpMaxResultChars: 10_000_001 }, {}, '/tmp'),
    /256 through 10000000/,
  )
  assert.throws(
    () => resolveConfig({ mcpToolCallTimeoutMs: 99 }, {}, '/tmp'),
    /100 through 3600000/,
  )
})

test('MCP stdio and Streamable HTTP servers resolve into deeply immutable allowlisted config', () => {
  const config = resolveConfig({
    mcpEnabled: true,
    mcpServers: [stdioServer, httpServer],
    mcpMaxTools: 64,
    mcpMaxSchemaTokens: 200_000,
    mcpMaxResultChars: 1_000_000,
    mcpMaxExternalCallsPerRun: 128,
    mcpToolCallTimeoutMs: 120_000,
    mcpAudit: false,
    mcpArtifactDir: false,
  }, {}, '/tmp')

  assert.equal(config.mcpServers.length, 2)
  assert.equal(config.mcpServers[0].riskPolicy, 'allow')
  assert.deepEqual(config.mcpServers[0].allowedTools, ['read_file', 'list_directory'])
  assert.deepEqual(config.mcpServers[0].denyTools, ['delete_file'])
  assert.deepEqual(config.mcpServers[0].env.MCP_LOG_LEVEL, {
    env: 'DEEPSEEKEYES_TEST_MCP_LOG_LEVEL',
  })
  assert.deepEqual(config.mcpServers[0].headers, {})
  assert.equal(config.mcpServers[1].enabled, false)
  assert.deepEqual(config.mcpServers[1].allowedTools, [])
  assert.deepEqual(config.mcpServers[1].denyTools, [])
  assert.deepEqual(config.mcpServers[1].headers.Authorization, {
    env: 'DEEPSEEKEYES_TEST_GITHUB_AUTHORIZATION',
  })
  assert.equal(config.mcpArtifactDir, undefined)
  assert.equal(config.mcpMaxExternalCallsPerRun, 128)
  assert.equal(Object.isFrozen(config.mcpServers), true)
  assert.equal(Object.isFrozen(config.mcpServers[0]), true)
  assert.equal(Object.isFrozen(config.mcpServers[0].allowedTools), true)
  assert.equal(Object.isFrozen(config.mcpServers[0].env), true)
  assert.equal(Object.isFrozen(config.mcpServers[0].env.MCP_LOG_LEVEL), true)
  assert.equal(Object.isFrozen(config.mcpServers[1].headers.Authorization), true)
})

test('MCP server riskPolicy is strict and defaults to allow', () => {
  const base = { id: 'fixture', name: 'Fixture', transport: 'stdio', command: 'node' }
  assert.equal(resolveConfig({ mcpServers: [base] }, {}, '/tmp').mcpServers[0].riskPolicy, 'allow')
  assert.equal(resolveConfig({ mcpServers: [{ ...base, riskPolicy: 'read-only' }] }, {}, '/tmp').mcpServers[0].riskPolicy, 'read-only')
  assert.throws(
    () => resolveConfig({ mcpServers: [{ ...base, riskPolicy: 'prompt' }] }, {}, '/tmp'),
    /riskPolicy must be one of allow, read-only/,
  )
})

test('MCP server validation rejects ambiguous transports, duplicates, plaintext credentials, and unsafe overlap', () => {
  assert.throws(
    () => resolveConfig({ mcpServers: JSON.stringify([stdioServer]) }, {}, '/tmp'),
    /serializable server array/,
  )
  assert.throws(
    () => resolveConfig({ mcpServers: [{ ...stdioServer, transport: 'http' }] }, {}, '/tmp'),
    /must be one of stdio, streamable-http/,
  )
  assert.throws(
    () => resolveConfig({ mcpServers: [{ ...stdioServer, command: undefined }] }, {}, '/tmp'),
    /command must be a non-empty string/,
  )
  assert.throws(
    () => resolveConfig({ mcpServers: [{ ...httpServer, url: 'ftp:\/\/example.test' }] }, {}, '/tmp'),
    /must use http or https/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [stdioServer, { ...httpServer, id: 'LOCAL-FILES' }],
    }, {}, '/tmp'),
    /id must be unique/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [stdioServer, { ...httpServer, name: 'local files' }],
    }, {}, '/tmp'),
    /name must be unique/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [{ ...stdioServer, env: { GITHUB_TOKEN: 'ghp_plaintext' } }],
    }, {}, '/tmp'),
    /must be an object/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [{ ...httpServer, headers: { Authorization: { value: 'Bearer plaintext' } } }],
    }, {}, '/tmp'),
    /only an env reference/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [{ ...httpServer, headers: { Authorization: 'TOKEN_ENV_NAME' } }],
    }, {}, '/tmp'),
    /must be an object/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [{ ...httpServer, url: 'https:\/\/example.test/mcp?access_token=plaintext' }],
    }, {}, '/tmp'),
    /credentials must use header env references/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [{ ...stdioServer, args: ['--token=plaintext'] }],
    }, {}, '/tmp'),
    /credentials must use env references/,
  )
  for (const args of [
    ['--header', 'Authorization: Basic dXNlcjpwYXNz'],
    ['--header=Authorization: Bearer plaintext'],
    ['-H', 'Cookie: session=plaintext'],
    ['--auth', 'plaintext'],
    ['password=plaintext'],
  ]) {
    assert.throws(
      () => resolveConfig({ mcpServers: [{ ...stdioServer, args }] }, {}, '/tmp'),
      /credentials must use env references/,
      JSON.stringify(args),
    )
  }
  for (const args of [
    ['--header', 'Accept: application/json'],
    ['--auth-type', 'none'],
    ['--token-limit', '4096'],
    ['/workspace/my-secret-project'],
  ]) {
    assert.doesNotThrow(
      () => resolveConfig({ mcpServers: [{ ...stdioServer, args }] }, {}, '/tmp'),
      JSON.stringify(args),
    )
  }
  assert.throws(
    () => resolveConfig({
      mcpServers: [{
        ...stdioServer,
        allowedTools: ['read_file'],
        denyTools: ['read_file'],
      }],
    }, {}, '/tmp'),
    /both allowedTools and denyTools/,
  )
  assert.throws(
    () => resolveConfig({
      mcpServers: [{ ...stdioServer, token: 'plaintext' }],
    }, {}, '/tmp'),
    /unknown field token/,
  )
})

test('Harness MCP settings use real nested arrays and retain runtime validation', () => {
  const json = SettingsConfig.toJSON()
  const serialized = JSON.stringify(json)
  assert.match(serialized, /mcpServers/)
  assert.match(serialized, /streamable-http/)
  assert.match(serialized, /allowedTools/)
  assert.match(serialized, /mcpMaxSchemaTokens/)
  assert.match(serialized, /mcpMaxExternalCallsPerRun/)
  assert.match(JSON.stringify(McpServerConfig.toJSON()), /"type":"object"/)

  const section = SettingsConfig({
    mcpEnabled: true,
    mcpServers: [stdioServer, httpServer],
    mcpMaxTools: 24,
    mcpMaxSchemaTokens: 50_000,
    mcpMaxResultChars: 75_000,
    mcpMaxExternalCallsPerRun: 12,
    mcpToolCallTimeoutMs: 60_000,
    mcpAudit: false,
    mcpArtifactDir: '/settings/mcp-artifacts',
  })
  assert.equal(Array.isArray(section.mcpServers), true)
  assert.equal(section.mcpServers[0].transport, 'stdio')
  const resolved = validateSettings(section, { cacheDir: false }, {})
  assert.equal(resolved.mcpEnabled, true)
  assert.equal(resolved.mcpServers.length, 2)
  assert.equal(resolved.mcpMaxTools, 24)
  assert.equal(resolved.mcpMaxSchemaTokens, 50_000)
  assert.equal(resolved.mcpMaxResultChars, 75_000)
  assert.equal(resolved.mcpMaxExternalCallsPerRun, 12)
  assert.equal(resolved.mcpToolCallTimeoutMs, 60_000)
  assert.equal(resolved.mcpAudit, false)
  assert.equal(resolved.mcpArtifactDir, '/settings/mcp-artifacts')

  const base = settingsBase(resolved)
  assert.equal(base.mcpEnabled, true)
  assert.equal(Array.isArray(base.mcpServers), true)
  assert.equal(base.mcpArtifactDir, '/settings/mcp-artifacts')

  const memoryOnly = SettingsConfig({ mcpArtifactDir: false })
  assert.equal(memoryOnly.mcpArtifactDir, false)
  assert.equal(validateSettings(memoryOnly, { cacheDir: false }, {}).mcpArtifactDir, undefined)
})

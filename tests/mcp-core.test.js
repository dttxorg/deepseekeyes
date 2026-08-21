import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  admitMcpResult,
  boundMcpResult,
  canonicalJson,
  canonicalValue,
  classifyToolRisk,
  estimateMcpResultTokens,
  estimateToolSchemaTokens,
  HASH_UNAVAILABLE,
  hashValue,
  loadHostDshMcpClient,
  loadHostMcpSdk,
  loadHostDshTools,
  MCP_RESULT_OUTPUT,
  mcpArgsContainInlineCredentials,
  mcpAuditSummary,
  normalizeMcpConfig,
  publicMcpToolName,
  renderMcpResult,
  redactSensitiveText,
  saveMcpResultImages,
  safeError,
  safeHashValue,
  toolDefinitionTokenSurface,
  toolPolicyDecision,
} from '../src/mcp/index.js'

test('MCP runtime anchors DSH core imports to the managed Host fallback despite a profile shadow', async () => {
  const home = await mkdtemp(join(tmpdir(), 'deepseekeyes-host-runtime-'))
  const writeModule = async (root, name, source) => {
    const directory = join(root, ...name.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name,
      version: '0.1.0-rc.8',
      type: 'module',
      main: './index.js',
    }))
    await writeFile(join(directory, 'index.js'), source)
  }
  try {
    const hostModules = join(home, 'profiles', 'node_modules')
    const profileModules = join(home, 'profiles', 'web', 'node_modules')
    await writeModule(
      hostModules,
      '@deepseek-ai/dsh-tools',
      'export const identity = "host"; export function renderToolsSdk() {} export function renderToolsSdkPy() {}',
    )
    await writeModule(
      hostModules,
      '@deepseek-ai/dsh-mcp-client',
      'export const identity = "host"; export function apply() {}',
    )
    await writeModule(
      profileModules,
      '@deepseek-ai/dsh-tools',
      'export const identity = "profile-shadow"; export function renderToolsSdk() {} export function renderToolsSdkPy() {}',
    )
    await writeModule(
      profileModules,
      '@deepseek-ai/dsh-mcp-client',
      'export const identity = "profile-shadow"; export function apply() {}',
    )
    let profileLoaderCalls = 0
    const ctx = {
      dshHomePath: (...segments) => join(home, ...segments),
      loader: {
        import() {
          profileLoaderCalls += 1
          throw new Error('the profile-scoped Loader must not resolve DSH Core')
        },
      },
    }
    assert.equal((await loadHostDshTools(ctx)).identity, 'host')
    assert.equal((await loadHostDshMcpClient(ctx)).identity, 'host')
    assert.equal(profileLoaderCalls, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('MCP runtime fails closed when the DSH Host path service is unavailable', async () => {
  await assert.rejects(
    loadHostDshTools({ loader: { import: () => import('@deepseek-ai/dsh-tools') } }),
    error => error?.code === 'MCP_HOST_UNAVAILABLE',
  )
})

test('MCP Content plane resolves all protocol SDK exports from the active Host client dependency', async () => {
  const home = await mkdtemp(join(tmpdir(), 'deepseekeyes-host-sdk-'))
  try {
    const modules = join(home, 'profiles', 'node_modules', '@deepseek-ai')
    await mkdir(modules, { recursive: true })
    const hostClient = new URL('../node_modules/@deepseek-ai/dsh-mcp-client', import.meta.url)
    await symlink(hostClient, join(modules, 'dsh-mcp-client'), 'dir')
    const sdk = await loadHostMcpSdk({ dshHomePath: (...segments) => join(home, ...segments) })
    assert.equal(typeof sdk.Client, 'function')
    assert.equal(typeof sdk.StdioClientTransport, 'function')
    assert.equal(typeof sdk.StreamableHTTPClientTransport, 'function')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

function server(overrides = {}) {
  return normalizeMcpConfig({
    mcpServers: [{
      id: 'github',
      transport: 'stdio',
      command: 'node',
      allowedTools: ['read_*'],
      denyTools: ['read_secret'],
      ...overrides,
    }],
  }).mcpServers[0]
}

class BatchAttachmentFixture {
  constructor(limitOverrides = {}) {
    this.imageLimits = {
      maxImageBytes: 1024,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 2048,
      maxImagePixels: 1_000_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      ...limitOverrides,
    }
    this.batchCalls = 0
    this.saved = []
    this.validated = []
  }

  async validateImage(input) {
    this.validated.push(input)
  }

  async saveImage(input) {
    this.saved.push(input)
    return {
      attachmentId: `fixture:${this.saved.length}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      name: input.name,
    }
  }

  // Mirrors the authoritative admission/commit order of Harness
  // AttachmentStore.saveImages().
  async saveImages(inputs) {
    this.batchCalls += 1
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw Object.assign(new Error('too many images'), { code: 'TOO_MANY_IMAGES' })
    }
    if (inputs.reduce((sum, input) => sum + input.data.byteLength, 0) > maxMessageImageBytes) {
      throw Object.assign(new Error('image batch too large'), { code: 'IMAGES_TOO_LARGE' })
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw Object.assign(new Error('unsupported image type'), { code: 'UNSUPPORTED_IMAGE_TYPE' })
      }
    }
    for (const input of inputs) await this.validateImage(input)
    const refs = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }
}

test('canonical MCP values preserve prototype-named JSON keys without prototype mutation', () => {
  const sourceText = '{"__proto__":{"polluted":true},"ok":1}'
  const source = JSON.parse(sourceText)
  const sourcePrototype = Object.getPrototypeOf(source)
  const objectPrototypeDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'polluted')

  const canonical = canonicalValue(source)

  assert.equal(Object.getPrototypeOf(source), sourcePrototype)
  assert.equal(Object.getPrototypeOf(canonical), Object.prototype)
  assert.equal(Object.hasOwn(canonical, '__proto__'), true)
  assert.deepEqual(canonical, source)
  assert.equal(canonicalJson(source), sourceText)
  assert.notEqual(hashValue(source), hashValue({ ok: 1 }))
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'polluted'), objectPrototypeDescriptor)
  assert.equal({}.polluted, undefined)

  const namedKeys = JSON.parse('{"prototype":{"kept":2},"constructor":{"kept":1},"__proto__":{"kept":3}}')
  assert.equal(
    canonicalJson(namedKeys),
    '{"__proto__":{"kept":3},"constructor":{"kept":1},"prototype":{"kept":2}}',
  )
})

test('canonical MCP values represent cycles deterministically', () => {
  const source = { label: 'root' }
  source.self = source

  assert.equal(canonicalJson(source), '{"label":"root","self":"[circular]"}')
  assert.equal(canonicalJson(source), canonicalJson(source))
  assert.equal(hashValue(source), hashValue(source))
  assert.equal(Object.getPrototypeOf(source), Object.prototype)
})

test('bounded safe hashes are deterministic and never recurse through hostile call metadata', () => {
  assert.match(safeHashValue({ b: 2, a: 1 }), /^[a-f0-9]{64}$/)
  assert.equal(safeHashValue({ b: 2, a: 1 }), safeHashValue({ a: 1, b: 2 }))

  const cycle = { label: 'cycle' }
  cycle.self = cycle
  assert.match(safeHashValue(cycle), /^[a-f0-9]{64}$/)
  assert.equal(safeHashValue(cycle), safeHashValue(cycle))

  let deep = { leaf: true }
  for (let index = 0; index < 20_000; index += 1) deep = { child: deep }
  assert.doesNotThrow(() => safeHashValue(deep))
  assert.equal(safeHashValue(deep), HASH_UNAVAILABLE)

  assert.equal(safeHashValue([1, 2, 3], { maxNodes: 3 }), HASH_UNAVAILABLE)
  assert.equal(safeHashValue({ text: '12345' }, { maxStringChars: 4 }), HASH_UNAVAILABLE)
  assert.equal(safeHashValue(Buffer.from([1, 2, 3]), { maxBinaryBytes: 2 }), HASH_UNAVAILABLE)

  const getter = {}
  Object.defineProperty(getter, 'token', {
    enumerable: true,
    get() { throw new Error('getter leaked plaintext-secret') },
  })
  assert.equal(safeHashValue(getter), HASH_UNAVAILABLE)

  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  assert.doesNotThrow(() => safeHashValue(revoked.proxy))
  assert.equal(safeHashValue(revoked.proxy), HASH_UNAVAILABLE)
})

test('MCP safe errors redact credential syntax while retaining useful diagnostics', () => {
  const credentials = [
    'bearer-secret-123',
    'dXNlcjpwYXNzd29yZA==',
    'proxy-secret-456',
    'session-secret-789',
    'csrf-secret-012',
    'x-api-secret-345',
    'json-token-678',
    'plain-secret-901',
    'password-secret-234',
    'api-key-secret-567',
    'sk-proj-abcdefghijklmnopqrstuvwxyz',
    'npm_abcdefghijklmnopqrstuvwxyz',
    'ghp_abcdefghijklmnopqrstuvwxyz',
    'github_pat_abcdefghijklmnopqrstuvwxyz',
    'glpat-abcdefghijklmnopqrstuvwxyz',
    `xox${'b'}-1234567890-abcdefghijklmnopqrstuvwxyz`,
    'hf_abcdefghijklmnopqrstuvwxyz',
    'whsec_abcdefghijklmnopqrstuvwxyz',
    'AKIAABCDEFGHIJKLMNOP',
    'SG.abcdefghijklmnop.abcdefghijklmnopqrstuvwxyz',
    'ya29.abcdefghijklmnopqrstuvwxyz',
    'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    'digest-response-secret',
    'url-password-secret',
  ]
  const message = [
    '[E_MCP_CONNECT] transport failed for /srv/deepseekeyes/mcp.sock',
    `Authorization: Bearer ${credentials[0]}`,
    `Proxy-Authorization: Basic ${credentials[1]}`,
    `Cookie: session=${credentials[3]}; csrf=${credentials[4]}`,
    `X-API-Key: ${credentials[5]}`,
    `body={"token":"${credentials[6]}","client_secret":"${credentials[7]}"}`,
    `password='${credentials[8]}' api-key=${credentials[9]}`,
    `tokens=${credentials.slice(10).join(',')}`,
    `Authorization: Digest username="fixture", realm="mcp", nonce="nonce", response="${credentials[22]}"`,
    `upstream=https://fixture:${credentials[23]}@example.test/mcp`,
  ].join('\n')

  const result = safeError(Object.assign(new Error(message), { code: 'E_MCP_CONNECT' }))
  assert.ok(result.length <= 500)
  assert.match(result, /\[E_MCP_CONNECT\]/)
  assert.match(result, /\/srv\/deepseekeyes\/mcp\.sock/)
  assert.match(result, /Authorization: Bearer \[REDACTED\]/)
  assert.match(result, /Cookie: \[REDACTED\]/)
  for (const credential of credentials) assert.equal(result.includes(credential), false, credential)
  assert.equal(safeError({ message: 'Bearer plain-object-secret', code: 'E_OBJECT' }), 'Bearer [REDACTED]')
})

test('MCP safe errors redact complete Digest headers and URL userinfo', () => {
  const digestSecret = 'digest-response-secret'
  const urlSecret = 'url-password-secret'
  const result = redactSensitiveText([
    `Authorization: Digest username="fixture", realm="mcp", nonce="nonce", response="${digestSecret}"`,
    `upstream=https://fixture:${urlSecret}@example.test/mcp`,
  ].join('\n'))

  assert.equal(result.includes(digestSecret), false)
  assert.equal(result.includes(urlSecret), false)
  assert.match(result, /^Authorization: \[REDACTED\]$/m)
  assert.match(result, /https:\/\/\[REDACTED\]@example\.test\/mcp/)
})

test('MCP safe errors preserve ordinary auth vocabulary and enforce a Unicode-safe hard cap', () => {
  const ordinary = '[E_SCHEMA] /srv/token-cache: token budget=8192; password authentication failed; secret-name=development-secret; api-key-name=SERVICE_API_KEY; Basic authentication required'
  assert.equal(safeError(new Error(ordinary)), ordinary)

  const bounded = safeError(new Error(`${'x'.repeat(498)}\ud83d\ude80${'y'.repeat(50)}`), 900)
  assert.ok(bounded.length <= 500)
  assert.ok(bounded.length >= 499)
  assert.equal(bounded.endsWith('…'), true)
  assert.equal(/[\uD800-\uDBFF]…$/.test(bounded), false)
})

test('MCP policy defaults closed, supports qualified globs, and lets deny win', () => {
  const closed = server({ allowedTools: [] })
  assert.deepEqual(toolPolicyDecision(closed, { name: 'read_issue' }), {
    allowed: false,
    reason: 'not-allowlisted',
  })
  const configured = server()
  assert.equal(toolPolicyDecision(configured, { name: 'read_issue' }).allowed, true)
  assert.deepEqual(toolPolicyDecision(configured, { name: 'read_secret' }), {
    allowed: false,
    reason: 'denylist',
    selector: 'read_secret',
  })
  assert.equal(toolPolicyDecision(server({ allowedTools: ['github/write_*'] }), { name: 'write_issue' }).allowed, true)
})

test('MCP public names match the DSH contract and registered-definition schema estimates are deterministic', () => {
  assert.equal(publicMcpToolName('git', 'search'), 'mcp__git__search')
  const lossy = publicMcpToolName('git', 'name with spaces and a very long suffix'.repeat(3))
  assert.match(lossy, /^mcp__git__name_with_spaces/)
  assert.equal(lossy.length, 64)
  assert.match(lossy, /_[a-f0-9]{12}$/)
  const definition = {
    name: 'mcp__git__search',
    description: 'Search\n\n[DeepSeekEyes MCP: Git; risk=read; bounded result]',
    parameters: { type: 'object' },
    output: MCP_RESULT_OUTPUT,
    execute() {},
  }
  assert.deepEqual(toolDefinitionTokenSurface(definition), {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: MCP_RESULT_OUTPUT.schema,
  })
  assert.equal(estimateToolSchemaTokens(definition), estimateToolSchemaTokens(structuredClone({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: { schema: MCP_RESULT_OUTPUT.schema },
  })))
  assert.ok(estimateToolSchemaTokens(definition) > 8)
})

test('MCP annotations conservatively classify missing metadata as unknown-write', () => {
  assert.equal(classifyToolRisk(undefined).risk, 'unknown-write')
  assert.equal(classifyToolRisk({ readOnlyHint: true }).risk, 'read')
  assert.equal(classifyToolRisk({ readOnlyHint: false, idempotentHint: true }).risk, 'write')
  assert.equal(classifyToolRisk({ readOnlyHint: true, destructiveHint: true }).risk, 'destructive')
})

test('strict MCP normalization is the single plaintext and transport boundary', () => {
  const strict = value => normalizeMcpConfig({ mcpServers: [value] }, { strict: true })
  const base = { id: 'fixture', name: 'Fixture', transport: 'stdio', command: 'node' }
  assert.doesNotThrow(() => strict({ ...base, env: { TOKEN: { env: 'FIXTURE_TOKEN' } } }))
  assert.throws(() => strict({ ...base, env: { TOKEN: 'plaintext-or-reference' } }), /env reference/)
  assert.throws(() => strict({ ...base, unknown: true }), /unknown field/)
  assert.throws(() => strict({ ...base, name: undefined }), /name must be/)
  assert.throws(() => strict({ ...base, url: 'https://example.test/mcp' }), /only valid for streamable-http/)
  assert.throws(() => strict({ ...base, args: ['--api-key=plaintext'] }), /credentials must use env references/)
  assert.throws(() => strict({ ...base, allowedTools: ['read'], denyTools: ['read'] }), /both allowedTools and denyTools/)
  assert.throws(() => strict({
    id: 'web',
    name: 'Web',
    transport: 'streamable-http',
    url: 'https://example.test/mcp?token=plaintext',
  }), /credentials must use header env references/)
  assert.doesNotThrow(() => strict({
    id: 'loopback-web',
    name: 'Loopback Web',
    transport: 'streamable-http',
    url: 'http://127.8.4.2:4567/mcp',
    headers: { Authorization: { env: 'MCP_AUTHORIZATION' } },
  }))
  assert.throws(() => strict({
    id: 'insecure-web',
    name: 'Insecure Web',
    transport: 'streamable-http',
    url: 'http://mcp.example.test/mcp',
  }), /must use https unless the hostname is explicit loopback/)
  assert.throws(() => strict({
    id: 'insecure-auth-web',
    name: 'Insecure Auth Web',
    transport: 'streamable-http',
    url: 'http://mcp.example.test/mcp',
    headers: { Authorization: { env: 'MCP_AUTHORIZATION' } },
  }), /must use https unless the hostname is explicit loopback/)
  assert.throws(() => normalizeMcpConfig({
    mcpServers: [base, { ...base, id: 'FIXTURE', name: 'Other' }],
  }, { strict: true }), /duplicate MCP server id/)
})

test('strict MCP argv rejects inline auth and sensitive headers without blocking ordinary options', () => {
  const strict = args => normalizeMcpConfig({
    mcpServers: [{
      id: 'fixture',
      name: 'Fixture',
      transport: 'stdio',
      command: 'node',
      args,
    }],
  }, { strict: true })
  const rejected = [
    ['--header', 'Authorization: Basic dXNlcjpwYXNz'],
    ['--header=Authorization: Bearer plaintext'],
    ['--header:Authorization: Basic dXNlcjpwYXNz'],
    ['-H', 'Cookie: session=plaintext'],
    ['--header', 'X-API-Key: plaintext'],
    ['-HAuthorization: Bearer plaintext'],
    ['--auth', 'plaintext'],
    ['--auth:plaintext'],
    ['--auth-token', 'plaintext'],
    ['--oauth-token=plaintext'],
    ['--oauth_token', 'plaintext'],
    ['--pass=plaintext'],
    ['--client_secret', 'plaintext'],
    ['--api-key', 'plaintext'],
    ['--api_key=plaintext'],
    ['--access_token', 'plaintext'],
    ['--cookie=session=plaintext'],
    ['Basic not-a-payload'],
    ['Bearer plaintext'],
    ['secret: plaintext'],
    ['token=plaintext'],
    ['-uuser:password'],
    ['/auth:plaintext'],
    ['password=plaintext'],
    ['auth=plaintext'],
    ['https://example.test/mcp?token=plaintext'],
    ['github_pat_1234567890'],
  ]
  for (const args of rejected) {
    assert.equal(mcpArgsContainInlineCredentials(args), true, JSON.stringify(args))
    assert.throws(() => strict(args), /credentials must use env references/, JSON.stringify(args))
  }

  const allowed = [
    ['--header', 'Accept: application/json'],
    ['-H', 'Content-Type: application/json'],
    ['--auth-type', 'none'],
    ['--auth-timeout', '5000'],
    ['--token-limit', '4096'],
    ['--token_limit', '4096'],
    ['--password-policy', 'strict'],
    ['--secret-name', 'development-secret'],
    ['--api-key-name', 'SERVICE_API_KEY'],
    ['-update'],
    ['/workspace/my-secret-project'],
    ['@scope/auth-server'],
    ['--header', 'X-Feature-Token-Limit: 100'],
    ['--header=X-Mode: Basic'],
  ]
  for (const args of allowed) {
    assert.equal(mcpArgsContainInlineCredentials(args), false, JSON.stringify(args))
    assert.doesNotThrow(() => strict(args), JSON.stringify(args))
  }
})

test('bounded MCP results spill an exact hash-addressed artifact without exposing full text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-mcp-result-'))
  const source = { content: [{ type: 'text', text: `start-${'x'.repeat(512_000)}-end` }] }
  const result = await boundMcpResult(source, {
    maxChars: 80,
    artifactDir: directory,
    serverId: 'fixture',
    toolName: 'large_result',
  })
  assert.equal(result.truncated, true)
  assert.ok(result.preview.length <= 80)
  assert.equal(result.preview.includes('-end'), false)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.ok(result.artifact.path.startsWith(directory))
  assert.deepEqual(JSON.parse(await readFile(result.artifact.path, 'utf8')), {
    content: [{ text: `start-${'x'.repeat(512_000)}-end`, type: 'text' }],
  })
  const artifactStat = await stat(result.artifact.path)
  assert.equal(artifactStat.isFile(), true)
  // Node's mode bits on Windows are synthesized and do not describe NTFS
  // ACLs. POSIX runners can verify the exact 0600 contract; Windows files
  // inherit the ACL of DSH_HOME (or the explicitly configured artifactDir).
  if (process.platform !== 'win32') assert.equal(artifactStat.mode & 0o077, 0)
})

test('artifact fallback preserves EISDIR and always removes its temporary file', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'deepseekeyes-mcp-result-eisdir-'))
  const serverDir = join(artifactDir, 'fixture')
  const source = { content: [{ type: 'text', text: `start-${'x'.repeat(1_000)}-end` }] }
  const targetName = `large_result-${hashValue(source)}.json`
  const target = join(serverDir, targetName)
  await mkdir(join(target, 'keep'), { recursive: true })

  await assert.rejects(
    boundMcpResult(source, {
      maxChars: 80,
      artifactDir,
      serverId: 'fixture',
      toolName: 'large_result',
    }),
    error => error.code === 'EISDIR',
  )

  assert.equal((await stat(target)).isDirectory(), true)
  assert.deepEqual(await readdir(target), ['keep'])
  assert.deepEqual(await readdir(serverDir), [targetName])
})

test('raw MCP admission is iterative and rejects depth before canonicalization or artifact writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseekeyes-mcp-depth-'))
  let source = { leaf: true }
  for (let index = 0; index < 20_000; index += 1) source = { child: source }

  await assert.rejects(
    boundMcpResult(source, { artifactDir: directory, maxChars: 80 }),
    error => error.code === 'MCP_RESULT_DEPTH_LIMIT' && !/call stack/i.test(error.message),
  )
  assert.deepEqual(await readdir(directory), [])
})

test('raw MCP admission enforces node, block and aggregate string limits with stable codes', async () => {
  await assert.rejects(
    boundMcpResult([1, 2, 3, 4, 5], { resultLimits: { maxNodes: 5 } }),
    error => error.code === 'MCP_RESULT_NODE_LIMIT',
  )
  await assert.rejects(
    boundMcpResult({ content: [{ type: 'text' }, { type: 'text' }] }, {
      resultLimits: { maxBlocks: 1 },
    }),
    error => error.code === 'MCP_RESULT_BLOCK_LIMIT',
  )
  await assert.rejects(
    boundMcpResult({ content: [{ type: 'text', text: '12345' }] }, {
      resultLimits: { maxStringChars: 22 },
    }),
    error => error.code === 'MCP_RESULT_STRING_LIMIT',
  )
})

test('raw MCP image byte and count admission fails atomically before decode or attachment writes', async () => {
  const attachments = new BatchAttachmentFixture({
    maxImageBytes: 1_024,
    maxImagesPerMessage: 8,
    maxMessageImageBytes: 2_048,
  })
  const image = { type: 'image', mimeType: 'image/png', data: Buffer.from([1, 2, 3, 4]).toString('base64') }

  await assert.rejects(
    saveMcpResultImages({ attachments }, { content: [image] }, {
      resultLimits: { maxEncodedImageBytes: 7 },
    }),
    error => error.code === 'MCP_RESULT_IMAGE_ENCODED_LIMIT',
  )
  await assert.rejects(
    saveMcpResultImages({ attachments }, { content: [image] }, {
      resultLimits: { maxDecodedImageBytes: 3 },
    }),
    error => error.code === 'MCP_RESULT_IMAGE_DECODED_LIMIT',
  )
  await assert.rejects(
    saveMcpResultImages({ attachments }, { content: [image, image] }, {
      resultLimits: { maxImages: 1 },
    }),
    error => error.code === 'MCP_RESULT_IMAGE_COUNT_LIMIT',
  )
  assert.equal(attachments.batchCalls, 0)
  assert.equal(attachments.validated.length, 0)
  assert.equal(attachments.saved.length, 0)
})

test('raw MCP results pass exact normal admission boundaries', async () => {
  const source = { content: [{ type: 'image', mimeType: 'image/png', data: 'AQID' }] }
  const result = admitMcpResult(source, {
    resultLimits: {
      maxDepth: 3,
      maxNodes: 6,
      maxBlocks: 1,
      maxStringChars: 37,
      maxImages: 1,
      maxEncodedImageBytes: 4,
      maxDecodedImageBytes: 3,
    },
  })
  assert.deepEqual(result.stats, {
    nodes: 6,
    blocks: 1,
    stringChars: 37,
    images: 1,
    encodedImageBytes: 4,
    decodedImageBytes: 3,
    binaryBytes: 0,
  })
})

test('memory-only MCP projections never claim omitted blocks were saved to an artifact', async () => {
  const result = await boundMcpResult({
    content: [
      { type: 'image', mimeType: 'image/png', data: 'AQID' },
      { type: 'audio', mimeType: 'audio/wav', data: 'AQID' },
      { type: 'resource', resource: { uri: 'fixture://one', text: 'resource' } },
    ],
  }, { maxChars: 1_000, artifactDir: false })
  assert.equal(result.artifact, undefined)
  assert.doesNotMatch(result.preview, /preserved in artifact|full artifact/i)
  assert.match(result.preview, /artifact storage is disabled/)
})

test('MCP result token accounting mirrors the exact rendered text and attachment structure', () => {
  const result = {
    schemaVersion: 'deepseekeyes.mcp-result.v1',
    preview: 'visual result',
    truncated: false,
    sha256: 'a'.repeat(64),
    bytes: 321,
    images: [{
      attachmentId: `sha256:${'b'.repeat(64)}`,
      mediaType: 'image/png',
      bytes: 123,
      width: 64,
      height: 32,
      name: 'fixture.png',
    }],
  }
  const rendered = renderMcpResult({}, result)
  const expected = 8 + rendered.reduce((tokens, block) => tokens + (
    block.type === 'text'
      ? Math.ceil(block.text.length / 4) + 4
      : Math.ceil(JSON.stringify(block).length / 4) + 4
  ), 0)
  const visibleCharacters = rendered.reduce((total, block) => total + (
    block.type === 'text' ? block.text.length : JSON.stringify(block).length
  ), 0)
  assert.deepEqual(rendered, MCP_RESULT_OUTPUT.render({}, result))
  assert.equal(estimateMcpResultTokens(result), expected)
  assert.ok(estimateMcpResultTokens(result) >= Math.ceil(visibleCharacters / 4) + 12)
  assert.ok(estimateMcpResultTokens(result) > Math.ceil((result.preview.length + 24) / 4) + 12)
})

test('MCP image results use one Harness batch call and preserve source order and bytes', async () => {
  const attachments = new BatchAttachmentFixture()
  const first = Buffer.from([0x00, 0x11, 0x7f, 0xff])
  const second = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01])
  const images = await saveMcpResultImages({ attachments }, {
    content: [
      { type: 'text', text: 'before' },
      { type: 'image', mimeType: 'image/png', data: first.toString('base64') },
      { type: 'text', text: 'between' },
      { type: 'image', mimeType: 'image/jpeg', data: second.toString('base64') },
    ],
  }, { serverId: 'fixture/server', toolName: 'look now' })

  assert.equal(attachments.batchCalls, 1)
  assert.equal(attachments.saved.length, 2)
  assert.deepEqual(attachments.saved.map(input => Buffer.from(input.data)), [first, second])
  assert.deepEqual(attachments.saved.map(input => input.name), [
    'fixture_server-look_now-1',
    'fixture_server-look_now-2',
  ])
  assert.deepEqual(images.map(image => image.attachmentId), ['fixture:1', 'fixture:2'])
})

test('Harness batch rejection writes no partial MCP image attachments', async () => {
  const attachments = new BatchAttachmentFixture({ maxMessageImageBytes: 3 })
  await assert.rejects(
    saveMcpResultImages({ attachments }, {
      content: [
        { type: 'image', mimeType: 'image/png', data: Buffer.from([1, 2]).toString('base64') },
        { type: 'image', mimeType: 'image/png', data: Buffer.from([3, 4]).toString('base64') },
      ],
    }, { serverId: 'fixture', toolName: 'batch' }),
    error => error.code === 'IMAGES_TOO_LARGE',
  )
  assert.equal(attachments.batchCalls, 1)
  assert.equal(attachments.validated.length, 0)
  assert.equal(attachments.saved.length, 0)
})

test('legacy saveImage hosts decode and validate the whole bounded batch before writing', async () => {
  const saved = []
  const attachments = {
    imageLimits: {
      maxImageBytes: 16,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 16,
      mediaTypes: ['image/png'],
    },
    async saveImage(input) {
      saved.push(input)
      return { attachmentId: `legacy:${saved.length}` }
    },
  }
  await assert.rejects(
    saveMcpResultImages({ attachments }, {
      content: [
        { type: 'image', mimeType: 'image/png', data: Buffer.from([1]).toString('base64') },
        { type: 'image', mimeType: 'image/png', data: 'not-base64' },
      ],
    }),
    error => error.code === 'INVALID_IMAGE_BASE64',
  )
  assert.equal(saved.length, 0)
})

test('MCP audit contains hashes and risk but no arguments or result payload', () => {
  const event = mcpAuditSummary({
    id: 'audit-1',
    server: { id: 'fixture', name: 'Fixture' },
    tool: { rawName: 'write', publicName: 'mcp__fixture__write' },
    args: { token: 'sensitive-value' },
    result: { sha256: 'a'.repeat(64), bytes: 42, truncated: false },
    durationMs: 8.4,
  })
  assert.equal(event.risk, 'unknown-write')
  assert.equal(event.durationMs, 8)
  assert.match(event.argsSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(event).includes('sensitive-value'), false)
})

test('MCP audit errors retain only code and a correlation hash', () => {
  const event = mcpAuditSummary({
    id: 'audit-error',
    server: { id: 'fixture', name: 'Fixture' },
    tool: { rawName: 'read', publicName: 'mcp__fixture__read' },
    args: {},
    error: Object.assign(new Error(
      '[E_UPSTREAM] /srv/mcp failed; Authorization: Bearer audit-secret-123\nX-API-Key: audit-key-456',
    ), { code: 'E_UPSTREAM Bearer code-secret-789' }),
    durationMs: 2,
  })
  assert.equal(event.error.code, 'E_UPSTREAM Bearer [REDACTED]')
  assert.match(event.error.messageSha256, /^[a-f0-9]{64}$/)
  assert.equal(Object.hasOwn(event.error, 'message'), false)
  assert.equal(JSON.stringify(event).includes('/srv/mcp'), false)
  assert.equal(JSON.stringify(event).includes('audit-secret-123'), false)
  assert.equal(JSON.stringify(event).includes('audit-key-456'), false)
  assert.equal(JSON.stringify(event).includes('code-secret-789'), false)
})

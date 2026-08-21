import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const DSH_RC_VERSION = '0.1.0-rc.8'
const DSH_HOST_RANGE = '>=0.1.0-rc.6 <0.2.0'
const CORDIS_VERSION = '4.0.1'
const DSH_DEVELOPMENT_RUNTIME = [
  ['@deepseek-ai/cordis', CORDIS_VERSION],
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-tools',
].map(value => Array.isArray(value) ? value : [value, DSH_RC_VERSION])
const DSH_HOST_MODULES = ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-tools']
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
const required = [
  'dsh/index.js',
  'bin/deepseekeyes.js',
  'src/index.js',
  'src/cli.js',
  'src/evidence-schema.js',
  'src/vision-attempts.js',
  'src/settings.js',
  'src/mcp/index.js',
  'src/mcp/content-adapter.js',
  'src/mcp/host-runtime.js',
  'src/mcp/manager.js',
  'src/mcp/official-adapter.js',
  'src/browser/index.js',
  'src/desktop/index.js',
  'src/desktop/helpers/macos.jxa',
  'src/desktop/helpers/windows.ps1',
  'lib/client.js',
  'cordis.patch.yml',
  'README.md',
  'README.zh-CN.md',
  'schemas/visual-evidence.schema.json',
  'evals/cases.json',
  'evals/results/fixture-oracle-v0.4.0.json',
  'docs/architecture.md',
  'docs/data-retention.md',
  'docs/releasing.md',
  'SECURITY.md',
  'TROUBLESHOOTING.md',
  'LICENSE',
]

if (manifest.name !== '@dttxorg/deepseekeyes') throw new Error('package name must be @dttxorg/deepseekeyes')
if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error('package version must be a stable semantic version')
}
if (manifest.bin?.deepseekeyes !== './bin/deepseekeyes.js') throw new Error('missing deepseekeyes CLI binary')
if (manifest.dependencies?.ajv !== '8.20.0') throw new Error('strict JSON Schema validator must pin ajv 8.20.0')
if (manifest.dependencies?.['playwright-core'] !== '1.61.1') {
  throw new Error('browser computer use must pin playwright-core 1.61.1')
}
for (const dependency of DSH_HOST_MODULES) {
  if (manifest.dependencies?.[dependency] !== undefined) {
    throw new Error(`${dependency} must be loaded from the DSH Host, not bundled as a runtime dependency`)
  }
  if (manifest.peerDependencies?.[dependency] !== DSH_HOST_RANGE
    || manifest.peerDependenciesMeta?.[dependency]?.optional !== true) {
    throw new Error(`${dependency} must declare optional Host peer ${DSH_HOST_RANGE}`)
  }
}
for (const [dependency, version] of DSH_DEVELOPMENT_RUNTIME) {
  if (manifest.devDependencies?.[dependency] !== version
    || lock.packages?.['']?.devDependencies?.[dependency] !== version
    || lock.packages?.[`node_modules/${dependency}`]?.version !== version) {
    throw new Error(`source verification must pin development dependency ${dependency} ${version}`)
  }
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh.bundle.patch')
if (manifest.exports?.['.'] !== './dsh/index.js') throw new Error('package root must export dsh/index.js')
if (manifest.exports?.['./client'] !== './lib/client.js') throw new Error('package client export must point to lib/client.js')
if (manifest.exports?.['./schema'] !== './schemas/visual-evidence.schema.json') throw new Error('package schema export is missing')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('missing dsh.client web declaration')
for (const path of required) await access(new URL(path, root))

const hostRuntimeSource = await readFile(new URL('src/mcp/host-runtime.js', root), 'utf8')
for (const marker of [
  "dshHomePath('profiles')",
  'createRequire(join(profilesDirectory',
  'await realpath(packageLink)',
  'await realpath(requireFromHostFallback.resolve(specifier))',
]) {
  if (!hostRuntimeSource.includes(marker)) {
    throw new Error(`Host-managed MCP runtime is missing anchor marker ${marker}`)
  }
}
if (hostRuntimeSource.includes('ctx.loader.import(') || hostRuntimeSource.includes('return import(specifier)')) {
  throw new Error('MCP runtime must not resolve DSH Core through a profile Loader or bare import fallback')
}

const clientSource = await readFile(new URL('lib/client.js', root), 'utf8')
const clientPrefix = `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}`
if (!clientSource.startsWith(clientPrefix)) {
  throw new Error(`client bundle must register the scoped package id ${manifest.name}`)
}
if (!clientSource.includes(`var PLUGIN_VERSION = ${JSON.stringify(manifest.version)};`)) {
  throw new Error(`client bundle version must match package version ${manifest.version}`)
}

const evidenceSchema = JSON.parse(await readFile(new URL('schemas/visual-evidence.schema.json', root), 'utf8'))
if (evidenceSchema.definitions?.baseEvidence?.additionalProperties !== false
  || evidenceSchema.definitions?.targetEvidence?.additionalProperties !== false) {
  throw new Error('base and target evidence schemas must reject additional properties')
}

const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
if (!/id:\s*deepseekeyes/.test(patch)
  || !/name:\s*["']?@dttxorg\/deepseekeyes["']?/.test(patch)) {
  throw new Error('cordis.patch.yml does not mount the scoped @dttxorg/deepseekeyes package')
}

const toolsManifest = JSON.parse(await readFile(
  new URL('node_modules/@deepseek-ai/dsh-tools/package.json', root),
  'utf8',
))
if (toolsManifest.version !== DSH_RC_VERSION) {
  throw new Error(`installed dsh-tools ${toolsManifest.version}; expected ${DSH_RC_VERSION}`)
}
const tools = await import('@deepseek-ai/dsh-tools')
if (typeof tools.renderToolsSdk !== 'function' || typeof tools.renderToolsSdkPy !== 'function') {
  throw new Error('installed dsh-tools must export renderToolsSdk and renderToolsSdkPy')
}
const mcpClient = await import('@deepseek-ai/dsh-mcp-client')
if (typeof mcpClient.apply !== 'function') {
  throw new Error('installed dsh-mcp-client and its runtime dependency closure must be importable')
}
const clientRequire = (await import('node:module')).createRequire(import.meta.url)
const importClientDependency = specifier => import(pathToFileURL(clientRequire.resolve(specifier)).href)
const [mcpSdkClient, mcpSdkStdio, mcpSdkHttp] = await Promise.all([
  importClientDependency('@modelcontextprotocol/sdk/client/index.js'),
  importClientDependency('@modelcontextprotocol/sdk/client/stdio.js'),
  importClientDependency('@modelcontextprotocol/sdk/client/streamableHttp.js'),
])
if (typeof mcpSdkClient.Client !== 'function'
  || typeof mcpSdkStdio.StdioClientTransport !== 'function'
  || typeof mcpSdkHttp.StreamableHTTPClientTransport !== 'function') {
  throw new Error('installed dsh-mcp-client protocol SDK must expose Resources/Prompts transports')
}

console.log('package verification: OK')

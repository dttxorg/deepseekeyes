import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { NPM_PACKAGE, runCli } from '../src/cli.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function captureIo() {
  const output = []
  const errors = []
  return {
    output,
    errors,
    io: {
      out(value) { output.push(String(value)) },
      error(value) { errors.push(String(value)) },
    },
  }
}

async function writeFixturePackage(profileDirectory) {
  const root = join(profileDirectory, 'node_modules', '@dttxorg', 'deepseekeyes')
  const required = [
    'dsh/index.js',
    'lib/client.js',
    'src/mcp/index.js',
    'src/mcp/content-adapter.js',
    'src/mcp/host-runtime.js',
    'src/mcp/manager.js',
    'src/mcp/official-adapter.js',
    'src/desktop/helpers/macos.jxa',
    'src/desktop/helpers/windows.ps1',
    'cordis.patch.yml',
  ]
  for (const relative of required) {
    const file = join(root, relative)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '')
  }
  await writeFile(
    join(root, 'lib', 'client.js'),
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(NPM_PACKAGE)}, factory: () => ({}) });\n`,
  )
  await mkdir(join(root, 'schemas'), { recursive: true })
  await writeFile(join(root, 'schemas', 'visual-evidence.schema.json'), JSON.stringify({
    $id: 'fixture://visual-evidence',
    definitions: {
      baseEvidence: { additionalProperties: false },
      targetEvidence: { additionalProperties: false },
    },
  }))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: NPM_PACKAGE,
    version: '0.6.0',
    peerDependencies: {
      '@deepseek-ai/dsh-mcp-client': '>=0.1.0-rc.6 <0.2.0',
      '@deepseek-ai/dsh-tools': '>=0.1.0-rc.6 <0.2.0',
    },
    peerDependenciesMeta: {
      '@deepseek-ai/dsh-mcp-client': { optional: true },
      '@deepseek-ai/dsh-tools': { optional: true },
    },
    exports: { './package.json': './package.json' },
  }))
}

async function writeRuntimePackage(root, name, version, source) {
  const directory = join(root, ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name,
    version,
    type: 'module',
    main: './index.js',
  }))
  await writeFile(join(directory, 'index.js'), source)
}

async function writeHostRuntimeFixture(dshHome, profileDirectory) {
  const hostModules = join(dshHome, 'profiles', 'node_modules')
  const profileModules = join(profileDirectory, 'node_modules')
  await writeRuntimePackage(
    hostModules,
    '@deepseek-ai/dsh-tools',
    '0.1.0-rc.8',
    'export function renderToolsSdk() {} export function renderToolsSdkPy() {}',
  )
  await writeRuntimePackage(
    hostModules,
    '@deepseek-ai/dsh-mcp-client',
    '0.1.0-rc.8',
    'export function apply() {}',
  )
  const sdkRoot = join(hostModules, '@modelcontextprotocol', 'sdk')
  await mkdir(join(sdkRoot, 'client'), { recursive: true })
  await writeFile(join(sdkRoot, 'package.json'), JSON.stringify({
    name: '@modelcontextprotocol/sdk',
    version: '1.12.0',
    type: 'module',
    exports: { './client/*': './client/*' },
  }))
  await writeFile(join(sdkRoot, 'client', 'index.js'), 'export class Client {}')
  await writeFile(join(sdkRoot, 'client', 'stdio.js'), 'export class StdioClientTransport {}')
  await writeFile(join(sdkRoot, 'client', 'streamableHttp.js'), 'export class StreamableHTTPClientTransport {}')
  await writeRuntimePackage(
    profileModules,
    '@deepseek-ai/dsh-tools',
    '9.9.9-shadow',
    'export const profileShadow = true',
  )
  await writeRuntimePackage(
    profileModules,
    '@deepseek-ai/dsh-mcp-client',
    '9.9.9-shadow',
    'export const profileShadow = true',
  )
}

async function writeProfile(dshHome, { bom = false } = {}) {
  const profileDirectory = join(dshHome, 'profiles', 'web')
  await mkdir(profileDirectory, { recursive: true })
  await writeFixturePackage(profileDirectory)
  await writeHostRuntimeFixture(dshHome, profileDirectory)
  const manifest = JSON.stringify({ dependencies: { [NPM_PACKAGE]: '0.4.0' } })
  await writeFile(join(profileDirectory, 'package.json'), `${bom ? '\uFEFF' : ''}${manifest}`)
}

test('install and upgrade expose argument-safe one-line dry runs', async () => {
  for (const command of ['install', 'upgrade']) {
    const captured = captureIo()
    const status = await runCli([
      command,
      '--profile',
      'qa profile',
      '--version',
      '0.4.0',
      '--dry-run',
    ], captured.io)
    assert.equal(status, 0)
    assert.deepEqual(captured.errors, [])
    assert.equal(captured.output.length, 1)
    assert.match(captured.output[0], new RegExp(`^DEEPSEEKEYES_${command.toUpperCase()}=`))
    assert.match(captured.output[0], /dsh(?:\.cmd)? plugin/)
    assert.match(captured.output[0], /--profile "qa profile" add @dttxorg\/deepseekeyes@0\.4\.0$/)
  }
})

test('upgrade prefers an installed dsh binary instead of nesting npm exec', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-cli-direct-'))
  try {
    const captured = captureIo()
    const calls = []
    captured.io.run = async (executable, args, environment) => {
      calls.push({ executable, args, dshHome: environment.DSH_HOME })
      return 0
    }
    const status = await runCli([
      'upgrade', '--profile', 'web', '--version', '0.6.1', '--dsh-home', dshHome,
    ], captured.io)
    assert.equal(status, 0)
    assert.equal(calls.length, 1)
    assert.match(calls[0].executable, /^dsh(?:\.cmd)?$/)
    assert.deepEqual(calls[0].args, [
      'plugin', '--profile', 'web', 'add', '@dttxorg/deepseekeyes@0.6.1',
    ])
    assert.equal(calls[0].dshHome, dshHome)
    assert.equal(captured.output.some(line => line.includes('npx')), false)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('install falls back to one non-nested npx dsh invocation only when dsh is absent', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-cli-fallback-'))
  try {
    const captured = captureIo()
    const calls = []
    captured.io.run = async (executable, args) => {
      calls.push({ executable, args })
      if (calls.length === 1) throw Object.assign(new Error('missing dsh'), { code: 'ENOENT' })
      return 0
    }
    const status = await runCli([
      'install', '--profile', 'web', '--version', '0.6.1', '--dsh-home', dshHome,
    ], captured.io)
    assert.equal(status, 0)
    assert.equal(calls.length, 2)
    assert.match(calls[0].executable, /^dsh(?:\.cmd)?$/)
    assert.match(calls[1].executable, /^npx(?:\.cmd)?$/)
    assert.deepEqual(calls[1].args, [
      '-y', '--package=@deepseek-ai/dsh', 'dsh', 'plugin',
      '--profile', 'web', 'add', '@dttxorg/deepseekeyes@0.6.1',
    ])
    assert.equal(captured.output.some(line => line.startsWith('DEEPSEEKEYES_INSTALL_FALLBACK=')), true)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('doctor validates the release tree and emits machine-readable JSON', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-doctor-root-'))
  try {
    const captured = captureIo()
    const status = await runCli([
      'doctor',
      '--package-root',
      repositoryRoot,
      '--dsh-home',
      dshHome,
      '--json',
    ], captured.io)
    assert.equal(status, 0)
    assert.deepEqual(captured.errors, [])
    const report = JSON.parse(captured.output.join('\n'))
    assert.equal(report.passed, true)
    assert.equal(report.packageRoot, repositoryRoot)
    assert.equal(report.checks.find(entry => entry.id === 'strict-evidence-schema')?.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'client-module-id')?.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'official-mcp-client')?.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'official-dsh-tools-resolvable')?.detail.includes('hostManaged=true'), true)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('doctor resolves an installed scoped profile package', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-doctor-profile-'))
  try {
    await writeProfile(dshHome)
    const captured = captureIo()
    const status = await runCli(['doctor', '--dsh-home', dshHome, '--json'], captured.io)
    assert.equal(status, 0)
    const report = JSON.parse(captured.output.join('\n'))
    assert.equal(report.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'profile-manifest')?.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'scoped-package-installed')?.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'package-identity')?.passed, true)
    assert.equal(report.checks.find(entry => entry.id === 'official-mcp-client')?.passed, true)
    assert.match(
      report.checks.find(entry => entry.id === 'official-dsh-tools-resolvable')?.detail ?? '',
      /host-fallback=verified/,
    )
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('doctor fails closed when the managed DSH Host fallback is missing', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-doctor-host-fallback-'))
  try {
    await writeProfile(dshHome)
    await rm(join(
      dshHome,
      'profiles',
      'node_modules',
      '@deepseek-ai',
      'dsh-tools',
    ), { recursive: true, force: true })
    const captured = captureIo()
    const status = await runCli(['doctor', '--dsh-home', dshHome, '--json'], captured.io)
    assert.equal(status, 1)
    const report = JSON.parse(captured.output.join('\n'))
    const runtime = report.checks.find(entry => entry.id === 'official-dsh-tools-resolvable')
    assert.equal(report.passed, false)
    assert.equal(runtime?.passed, false)
    assert.match(runtime?.detail ?? '', /managed module fallback/)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('doctor fails closed when the Host runtime bridge is missing from an installed package', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-doctor-host-runtime-'))
  try {
    await writeProfile(dshHome)
    const hostRuntime = join(
      dshHome,
      'profiles',
      'web',
      'node_modules',
      '@dttxorg',
      'deepseekeyes',
      'src',
      'mcp',
      'host-runtime.js',
    )
    await rm(hostRuntime)
    const captured = captureIo()
    const status = await runCli(['doctor', '--dsh-home', dshHome, '--json'], captured.io)
    assert.equal(status, 1)
    const report = JSON.parse(captured.output.join('\n'))
    const fileCheck = report.checks.find(entry => entry.id === 'file:src/mcp/host-runtime.js')
    assert.equal(report.passed, false)
    assert.equal(fileCheck?.passed, false)
    assert.equal(fileCheck?.detail, 'src/mcp/host-runtime.js missing')
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('doctor fails a profile manifest with UTF-8 BOM and reports the exact cause', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'deepseekeyes-doctor-bom-'))
  try {
    await writeProfile(dshHome, { bom: true })
    const captured = captureIo()
    const status = await runCli(['doctor', '--dsh-home', dshHome, '--json'], captured.io)
    assert.equal(status, 1)
    const report = JSON.parse(captured.output.join('\n'))
    const manifest = report.checks.find(entry => entry.id === 'profile-manifest')
    assert.equal(report.passed, false)
    assert.equal(manifest.passed, false)
    assert.match(manifest.detail, /contains UTF-8 BOM/)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

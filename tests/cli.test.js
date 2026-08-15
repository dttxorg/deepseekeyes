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
    version: '0.4.0',
    exports: { './package.json': './package.json' },
  }))
}

async function writeProfile(dshHome, { bom = false } = {}) {
  const profileDirectory = join(dshHome, 'profiles', 'web')
  await mkdir(profileDirectory, { recursive: true })
  await writeFixturePackage(profileDirectory)
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
    assert.match(captured.output[0], /--profile "qa profile" add @dttxorg\/deepseekeyes@0\.4\.0$/)
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

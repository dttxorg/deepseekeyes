import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const required = [
  'dsh/index.js',
  'bin/deepseekeyes.js',
  'src/index.js',
  'src/cli.js',
  'src/evidence-schema.js',
  'src/vision-attempts.js',
  'src/settings.js',
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
if (manifest.version !== '0.5.1') throw new Error('release version must be 0.5.1')
if (manifest.bin?.deepseekeyes !== './bin/deepseekeyes.js') throw new Error('missing deepseekeyes CLI binary')
if (manifest.dependencies?.ajv !== '8.20.0') throw new Error('strict JSON Schema validator must pin ajv 8.20.0')
if (manifest.dependencies?.['playwright-core'] !== '1.61.1') {
  throw new Error('browser computer use must pin playwright-core 1.61.1')
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh.bundle.patch')
if (manifest.exports?.['.'] !== './dsh/index.js') throw new Error('package root must export dsh/index.js')
if (manifest.exports?.['./client'] !== './lib/client.js') throw new Error('package client export must point to lib/client.js')
if (manifest.exports?.['./schema'] !== './schemas/visual-evidence.schema.json') throw new Error('package schema export is missing')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('missing dsh.client web declaration')
for (const path of required) await access(new URL(path, root))

const clientSource = await readFile(new URL('lib/client.js', root), 'utf8')
const clientPrefix = `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}`
if (!clientSource.startsWith(clientPrefix)) {
  throw new Error(`client bundle must register the scoped package id ${manifest.name}`)
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

console.log('package verification: OK')

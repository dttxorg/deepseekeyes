import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const required = [
  'dsh/index.js',
  'src/index.js',
  'src/settings.js',
  'src/browser/index.js',
  'src/desktop/index.js',
  'src/desktop/helpers/macos.jxa',
  'src/desktop/helpers/windows.ps1',
  'lib/client.js',
  'cordis.patch.yml',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
]

if (manifest.name !== 'deepseekeyes') throw new Error('package name must be deepseekeyes')
if (manifest.version !== '0.3.0') throw new Error('release version must be 0.3.0')
if (manifest.dependencies?.['playwright-core'] !== '1.61.1') {
  throw new Error('browser computer use must pin playwright-core 1.61.1')
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh.bundle.patch')
if (manifest.exports?.['.'] !== './dsh/index.js') throw new Error('package root must export dsh/index.js')
if (manifest.exports?.['./client'] !== './lib/client.js') throw new Error('package client export must point to lib/client.js')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('missing dsh.client web declaration')
for (const path of required) await access(new URL(path, root))

const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
if (!/id:\s*deepseekeyes/.test(patch) || !/name:\s*deepseekeyes/.test(patch)) {
  throw new Error('cordis.patch.yml does not mount deepseekeyes')
}

console.log('package verification: OK')

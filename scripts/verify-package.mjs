import { access, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const required = [
  'dsh/index.js',
  'src/index.js',
  'cordis.patch.yml',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
]

if (manifest.name !== 'deepseekeyes') throw new Error('package name must be deepseekeyes')
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh.bundle.patch')
if (manifest.exports?.['.'] !== './dsh/index.js') throw new Error('package root must export dsh/index.js')
for (const path of required) await access(new URL(path, root))

const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
if (!/id:\s*deepseekeyes/.test(patch) || !/name:\s*deepseekeyes/.test(patch)) {
  throw new Error('cordis.patch.yml does not mount deepseekeyes')
}

console.log('package verification: OK')

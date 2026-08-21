import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const packageRoot = resolve(import.meta.dirname, '..')

test('client build entry uses CommonJS and explicit cross-platform paths', async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  const script = await readFile(resolve(packageRoot, 'scripts', 'build-client.cjs'), 'utf8')

  assert.equal(manifest.scripts['build:client'], 'node scripts/build-client.cjs')
  assert.match(script, /require\(['"]esbuild['"]\)/)
  assert.match(script, /path\.resolve\(__dirname, ['"]\.\.['"]\)/)
  assert.match(script, /absWorkingDir: projectRoot/)
  assert.match(script, /entryPoints: \[path\.join\(projectRoot,/)
  assert.match(script, /outfile: path\.join\(projectRoot,/)
  assert.doesNotMatch(script, /from ['"]esbuild['"]/)
})

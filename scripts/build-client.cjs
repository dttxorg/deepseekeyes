'use strict'

const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { build } = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

async function main() {
  const manifestPath = path.join(projectRoot, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const id = manifest.name
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('package.json must declare a client module name')
  const version = manifest.version
  if (typeof version !== 'string' || version.length === 0) throw new TypeError('package.json must declare a client version')

  await build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, 'client', 'index.jsx')],
    outfile: path.join(projectRoot, 'lib', 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    external: ['react', 'react/jsx-runtime'],
    define: {
      __DEEPSEEKEYES_VERSION__: JSON.stringify(version),
    },
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: {
      js: 'return module.exports; } });',
    },
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const id = manifest.name
if (typeof id !== 'string' || id.length === 0) throw new TypeError('package.json must declare a client module name')
const version = manifest.version
if (typeof version !== 'string' || version.length === 0) throw new TypeError('package.json must declare a client version')
await build({
  entryPoints: ['client/index.jsx'],
  outfile: 'lib/client.js',
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

import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadHostDshMcpClient, loadHostDshTools } from './mcp/host-runtime.js'

export const NPM_PACKAGE = '@dttxorg/deepseekeyes'
export const DSH_PACKAGE = '@deepseek-ai/dsh'
export const MINIMUM_NODE = Object.freeze([22, 19, 0])
const DSH_HOST_RANGE = '>=0.1.0-rc.6 <0.2.0'

function parsedVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value)
  return match === null ? [0, 0, 0] : match.slice(1).map(Number)
}

function versionAtLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

function dshHostVersionCompatible(value) {
  const match = /^0\.1\.(\d+)(?:-rc\.(\d+))?$/.exec(String(value))
  if (match === null) return false
  const patch = Number(match[1])
  if (patch > 0 || match[2] === undefined) return true
  return Number(match[2]) >= 6
}

function parseArguments(argv) {
  const command = argv[0]
  const options = { profile: 'web', version: 'latest', json: false, dryRun: false }
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]
    if (['--profile', '--version', '--package-root', '--dsh-home'].includes(value)) {
      const next = argv[index + 1]
      if (next === undefined) throw new TypeError(`${value} requires a value`)
      options[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next
      index += 1
    } else if (value === '--json') options.json = true
    else if (value === '--dry-run') options.dryRun = true
    else if (value === '--help' || value === '-h') options.help = true
    else throw new TypeError(`unknown option ${value}`)
  }
  return { command, options }
}

export function cliUsage() {
  return `DeepSeekEyes — auditable vision, MCP and Computer Use runtime for DeepSeek Harness

Usage:
  deepseekeyes install [--profile web] [--version latest] [--dry-run]
  deepseekeyes upgrade [--profile web] [--version latest] [--dry-run]
  deepseekeyes doctor [--profile web] [--dsh-home PATH] [--package-root PATH] [--json]

One-line commands:
  npx -y @dttxorg/deepseekeyes@latest install
  npx -y @dttxorg/deepseekeyes@latest upgrade
  npx -y @dttxorg/deepseekeyes@latest doctor
`
}

function commandLine(executable, args) {
  return [executable, ...args].map(value => /[\s"']/u.test(value) ? JSON.stringify(value) : value).join(' ')
}

async function run(executable, args, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit', env: environment, shell: false })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal !== null) reject(new Error(`command terminated by ${signal}`))
      else resolvePromise(code ?? 1)
    })
  })
}

async function profileManifest(dshHome, profile) {
  const profileDirectory = join(dshHome, 'profiles', profile)
  const file = join(profileDirectory, 'package.json')
  const raw = await readFile(file)
  const bom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
  const manifest = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
  return { profileDirectory, file, manifest, bom }
}

function installedSpec(manifest) {
  return manifest.dependencies?.[NPM_PACKAGE]
    ?? manifest.devDependencies?.[NPM_PACKAGE]
    ?? manifest.optionalDependencies?.[NPM_PACKAGE]
}

function legacyInstalled(manifest) {
  return manifest.dependencies?.deepseekeyes !== undefined
    || manifest.devDependencies?.deepseekeyes !== undefined
    || manifest.optionalDependencies?.deepseekeyes !== undefined
}

async function installOrUpgrade(command, options, io) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const dshArgs = [
    '-y',
    `--package=${DSH_PACKAGE}`,
    'dsh',
    'plugin',
    '--profile',
    options.profile,
    'add',
    `${NPM_PACKAGE}@${options.version}`,
  ]
  io.out(`DEEPSEEKEYES_${command.toUpperCase()}=${commandLine(npx, dshArgs)}`)
  if (options.dryRun) return 0
  const environment = {
    ...process.env,
    ...(options.dshHome === undefined ? {} : { DSH_HOME: resolve(options.dshHome) }),
  }
  const code = await run(npx, dshArgs, environment)
  if (code !== 0) return code

  const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  try {
    const profile = await profileManifest(dshHome, options.profile)
    if (legacyInstalled(profile.manifest)) {
      const removeArgs = [
        '-y', `--package=${DSH_PACKAGE}`, 'dsh',
        'plugin', '--profile', options.profile, 'remove', 'deepseekeyes',
      ]
      io.out(`DEEPSEEKEYES_MIGRATE=${commandLine(npx, removeArgs)}`)
      const removeCode = await run(npx, removeArgs, environment)
      if (removeCode !== 0) return removeCode
    }
  } catch {
    // The DSH command owns profile creation and reports its own installation errors.
  }
  io.out(`DEEPSEEKEYES_${command.toUpperCase()}_OK profile=${options.profile} version=${options.version}`)
  io.out('Restart dsh web once to load the installed bundle.')
  return 0
}

function check(id, passed, detail, severity = 'required') {
  return { id, passed, detail, severity }
}

async function packageRootFromProfile(profileDirectory) {
  try {
    const require = createRequire(join(profileDirectory, 'package.json'))
    return dirname(require.resolve(`${NPM_PACKAGE}/package.json`))
  } catch {
    return join(profileDirectory, 'node_modules', '@dttxorg', 'deepseekeyes')
  }
}

async function doctor(options, io) {
  const checks = []
  const nodeVersion = parsedVersion(process.versions.node)
  checks.push(check(
    'node-version',
    versionAtLeast(nodeVersion, MINIMUM_NODE),
    `Node ${process.versions.node}; required >= ${MINIMUM_NODE.join('.')}`,
  ))

  const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  let packageRoot = options.packageRoot === undefined
    ? undefined
    : resolve(options.packageRoot)
  let profile
  if (packageRoot === undefined) {
    try {
      profile = await profileManifest(dshHome, options.profile)
      checks.push(check('profile-manifest', !profile.bom, `${profile.file}${profile.bom ? ' contains UTF-8 BOM' : ' parses without BOM'}`))
      const spec = installedSpec(profile.manifest)
      checks.push(check('scoped-package-installed', typeof spec === 'string', `${NPM_PACKAGE} ${spec ?? 'missing'}`))
      packageRoot = await packageRootFromProfile(profile.profileDirectory)
    } catch (error) {
      checks.push(check('profile-manifest', false, `${join(dshHome, 'profiles', options.profile, 'package.json')}: ${error.message}`))
    }
  } else {
    checks.push(check('profile-manifest', true, 'skipped by explicit --package-root', 'informational'))
  }

  if (packageRoot !== undefined) {
    let manifest
    try {
      manifest = JSON.parse((await readFile(join(packageRoot, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''))
      checks.push(check('package-identity', manifest.name === NPM_PACKAGE, `${manifest.name}@${manifest.version}`))
    } catch (error) {
      checks.push(check('package-identity', false, `${packageRoot}: ${error.message}`))
    }
    for (const relative of [
      'dsh/index.js',
      'lib/client.js',
      'schemas/visual-evidence.schema.json',
      'src/mcp/index.js',
      'src/mcp/host-runtime.js',
      'src/mcp/manager.js',
      'src/mcp/official-adapter.js',
      'src/desktop/helpers/macos.jxa',
      'src/desktop/helpers/windows.ps1',
      'cordis.patch.yml',
    ]) {
      try {
        await access(join(packageRoot, relative))
        checks.push(check(`file:${relative}`, true, relative))
      } catch {
        checks.push(check(`file:${relative}`, false, `${relative} missing`))
      }
    }
    if (manifest !== undefined) {
      const expected = DSH_HOST_RANGE
      const actual = manifest.peerDependencies?.['@deepseek-ai/dsh-mcp-client']
      const mcpHostManaged = manifest.dependencies?.['@deepseek-ai/dsh-mcp-client'] === undefined
        && manifest.peerDependenciesMeta?.['@deepseek-ai/dsh-mcp-client']?.optional === true
      checks.push(check(
        'official-mcp-client',
        actual === expected && mcpHostManaged,
        `@deepseek-ai/dsh-mcp-client hostPeer=${actual ?? 'missing'}; expected=${expected}; hostManaged=${mcpHostManaged}`,
      ))
      const declaredTools = manifest.peerDependencies?.['@deepseek-ai/dsh-tools']
      const toolsHostManaged = manifest.dependencies?.['@deepseek-ai/dsh-tools'] === undefined
        && manifest.peerDependenciesMeta?.['@deepseek-ai/dsh-tools']?.optional === true
      checks.push(check(
        'official-dsh-tools-declared',
        declaredTools === expected && toolsHostManaged,
        `@deepseek-ai/dsh-tools hostPeer=${declaredTools ?? 'missing'}; expected=${expected}; hostManaged=${toolsHostManaged}`,
      ))
      if (actual === expected && declaredTools === expected && mcpHostManaged && toolsHostManaged) {
        let sourceTree = false
        try {
          await access(join(packageRoot, 'scripts', 'verify-package.mjs'))
          sourceTree = true
        } catch {}
        try {
          let tools
          let mcpClient
          let toolsManifest
          let clientManifest
          let origin
          if (sourceTree) {
            const packageRequire = createRequire(join(packageRoot, 'package.json'))
            toolsManifest = JSON.parse(await readFile(
              packageRequire.resolve('@deepseek-ai/dsh-tools/package.json'),
              'utf8',
            ))
            clientManifest = JSON.parse(await readFile(
              packageRequire.resolve('@deepseek-ai/dsh-mcp-client/package.json'),
              'utf8',
            ))
            tools = await import(pathToFileURL(packageRequire.resolve('@deepseek-ai/dsh-tools')).href)
            mcpClient = await import(pathToFileURL(packageRequire.resolve('@deepseek-ai/dsh-mcp-client')).href)
            origin = 'source-dev-dependencies'
          } else {
            const hostContext = { dshHomePath: (...segments) => join(dshHome, ...segments) }
            ;[tools, mcpClient] = await Promise.all([
              loadHostDshTools(hostContext),
              loadHostDshMcpClient(hostContext),
            ])
            toolsManifest = JSON.parse(await readFile(join(
              dshHome,
              'profiles',
              'node_modules',
              '@deepseek-ai',
              'dsh-tools',
              'package.json',
            ), 'utf8'))
            clientManifest = JSON.parse(await readFile(join(
              dshHome,
              'profiles',
              'node_modules',
              '@deepseek-ai',
              'dsh-mcp-client',
              'package.json',
            ), 'utf8'))
            origin = 'host-fallback'
          }
          const exportsReady = typeof tools.renderToolsSdk === 'function'
            && typeof tools.renderToolsSdkPy === 'function'
            && typeof mcpClient.apply === 'function'
          if (!dshHostVersionCompatible(toolsManifest.version)
            || !dshHostVersionCompatible(clientManifest.version)
            || !exportsReady) {
            throw new Error(
              `runtime tools=${toolsManifest.version}; client=${clientManifest.version}; expected=${expected}; exports=${exportsReady}`,
            )
          }
          checks.push(check(
            'official-dsh-tools-resolvable',
            true,
            `hostManaged=true; ${origin}=verified; runtime imports are anchored to the managed Host fallback`,
          ))
        } catch (error) {
          checks.push(check('official-dsh-tools-resolvable', false, error.message))
        }
      } else {
        checks.push(check(
          'official-dsh-tools-resolvable',
          false,
          'official MCP runtime must remain Host-managed to preserve DSH service and scheduler identity',
        ))
      }
    }
    try {
      const schema = JSON.parse(await readFile(join(packageRoot, 'schemas', 'visual-evidence.schema.json'), 'utf8'))
      const passed = schema.definitions?.baseEvidence?.additionalProperties === false
        && schema.definitions?.targetEvidence?.additionalProperties === false
      checks.push(check('strict-evidence-schema', passed, `${schema.$id ?? 'schema'}; base/target strict=${passed}`))
    } catch (error) {
      checks.push(check('strict-evidence-schema', false, error.message))
    }
    try {
      const source = await readFile(join(packageRoot, 'lib', 'client.js'), 'utf8')
      const match = /^window\.__ModuleLoader__\.load\(\{ id: ("(?:[^"\\]|\\.)*")/.exec(source)
      const actual = match === null ? undefined : JSON.parse(match[1])
      const expected = manifest?.name ?? NPM_PACKAGE
      checks.push(check(
        'client-module-id',
        actual === expected,
        `registered=${actual ?? 'missing'}; expected=${expected}`,
      ))
    } catch (error) {
      checks.push(check('client-module-id', false, error.message))
    }
  }

  const attemptsFile = join(dshHome, 'deepseekeyes', 'vision-attempts.json')
  try {
    const attempts = JSON.parse(await readFile(attemptsFile, 'utf8'))
    const fileStat = await stat(attemptsFile)
    const privateMode = process.platform === 'win32' || (fileStat.mode & 0o077) === 0
    checks.push(check(
      'vision-attempt-log',
      attempts.schemaVersion === 1 && Array.isArray(attempts.attempts) && privateMode,
      `${attemptsFile}; attempts=${attempts.attempts?.length ?? 0}; private=${privateMode}`,
      'informational',
    ))
  } catch (error) {
    checks.push(check('vision-attempt-log', true, `${attemptsFile}; no record yet (${error.code ?? error.name})`, 'informational'))
  }

  const failed = checks.filter(item => item.severity === 'required' && !item.passed)
  const report = {
    schemaVersion: 1,
    command: 'doctor',
    profile: options.profile,
    dshHome,
    packageRoot,
    passed: failed.length === 0,
    checks,
  }
  if (options.json) io.out(JSON.stringify(report, null, 2))
  else {
    for (const item of checks) io.out(`${item.passed ? 'PASS' : 'FAIL'} ${item.id}: ${item.detail}`)
    io.out(`DOCTOR_RESULT=${report.passed ? 'PASS' : 'FAIL'} required_failures=${failed.length}`)
  }
  return report.passed ? 0 : 1
}

export async function runCli(argv, io = { out: value => console.log(value), error: value => console.error(value) }) {
  try {
    const { command, options } = parseArguments(argv)
    if (options.help || command === undefined || command === 'help') {
      io.out(cliUsage())
      return command === undefined ? 64 : 0
    }
    if (command === 'install' || command === 'upgrade') return installOrUpgrade(command, options, io)
    if (command === 'doctor') return doctor(options, io)
    throw new TypeError(`unknown command ${command}`)
  } catch (error) {
    io.error(`DEEPSEEKEYES_CLI_ERROR=${error.message}`)
    return 1
  }
}

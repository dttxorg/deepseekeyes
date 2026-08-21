import { realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DeepSeekEyesError } from '../error.js'

const HOST_PACKAGES = new Set([
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-tools',
])

function hostPathService(ctx) {
  const service = typeof ctx?.get === 'function'
    ? ctx.get('dshHomePath')
    : ctx?.dshHomePath
  if (typeof service !== 'function') {
    throw new DeepSeekEyesError(
      'The active DSH Host path service is unavailable',
      'MCP_HOST_UNAVAILABLE',
    )
  }
  return service
}

function inside(root, path) {
  const value = relative(root, path)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}

export async function resolveHostModulePath(ctx, specifier) {
  if (!HOST_PACKAGES.has(specifier)) {
    throw new TypeError(`deepseekeyes: unsupported Host module ${specifier}`)
  }
  const dshHomePath = hostPathService(ctx)
  try {
    // DSH owns this flat fallback and points each package at the running DSH
    // installation. Resolve from its parent instead of the current profile,
    // whose node_modules may contain a second Core brought by another plugin.
    const profilesDirectory = dshHomePath('profiles')
    const packageLink = join(profilesDirectory, 'node_modules', ...specifier.split('/'))
    const packageRoot = await realpath(packageLink)
    const requireFromHostFallback = createRequire(join(profilesDirectory, 'package.json'))
    const entry = await realpath(requireFromHostFallback.resolve(specifier))
    if (!inside(packageRoot, entry)) throw new Error('resolved entry escaped the managed Host package')
    return entry
  } catch (cause) {
    throw new DeepSeekEyesError(
      `The active DSH Host does not provide ${specifier} through its managed module fallback`,
      'MCP_HOST_UNAVAILABLE',
      { cause },
    )
  }
}

async function importHostModule(ctx, specifier) {
  const entry = await resolveHostModulePath(ctx, specifier)
  return import(pathToFileURL(entry).href)
}

export async function loadHostDshTools(ctx) {
  const tools = await importHostModule(ctx, '@deepseek-ai/dsh-tools')
  if (typeof tools?.renderToolsSdk !== 'function' || typeof tools?.renderToolsSdkPy !== 'function') {
    throw new DeepSeekEyesError(
      'The active DSH Host does not expose the required dsh-tools SDK renderers',
      'MCP_HOST_TOOLS_INVALID',
    )
  }
  return tools
}

export async function loadHostDshMcpClient(ctx) {
  const client = await importHostModule(ctx, '@deepseek-ai/dsh-mcp-client')
  if (typeof client?.apply !== 'function') {
    throw new DeepSeekEyesError(
      'The active DSH Host does not expose the official MCP client apply() entrypoint',
      'MCP_CLIENT_INVALID',
    )
  }
  return client
}

/**
 * Load the protocol SDK owned by the active DSH MCP Client installation.
 *
 * DeepSeekEyes intentionally does not bundle another SDK copy: Tools continue
 * through the official Host client, while the optional Resources/Prompts plane
 * resolves the exact transitive SDK beside that Host package.
 */
export async function loadHostMcpSdk(ctx) {
  const hostClientEntry = await resolveHostModulePath(ctx, '@deepseek-ai/dsh-mcp-client')
  try {
    const requireFromHostClient = createRequire(hostClientEntry)
    const [client, stdio, http] = await Promise.all([
      import(pathToFileURL(requireFromHostClient.resolve('@modelcontextprotocol/sdk/client/index.js')).href),
      import(pathToFileURL(requireFromHostClient.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href),
      import(pathToFileURL(requireFromHostClient.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href),
    ])
    if (typeof client?.Client !== 'function'
      || typeof stdio?.StdioClientTransport !== 'function'
      || typeof http?.StreamableHTTPClientTransport !== 'function') {
      throw new Error('required MCP SDK client exports are missing')
    }
    return Object.freeze({
      Client: client.Client,
      StdioClientTransport: stdio.StdioClientTransport,
      StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    })
  } catch (cause) {
    throw new DeepSeekEyesError(
      'The active DSH MCP client does not expose its managed protocol SDK',
      'MCP_HOST_SDK_INVALID',
      { cause },
    )
  }
}

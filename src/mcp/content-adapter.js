import { DeepSeekEyesError } from '../error.js'
import { boundedUnicode, safeError, safeErrorCode } from './canonical.js'
import { loadHostMcpSdk } from './host-runtime.js'
import { materializeDshMcpConfig } from './official-adapter.js'
import { isMcpOAuthEnabled, McpOAuthSessionRegistry } from './oauth.js'

export const DEFAULT_MCP_CONTENT_CATALOG_LIMITS = Object.freeze({
  maxEntries: 256,
  maxPages: 256,
  maxStringChars: 1_000_000,
  maxBytes: 4_000_000,
})

const CONTENT_TEXT_LIMIT = 100_000

function positiveInteger(value, fallback, field) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${field} must be a positive safe integer`)
  return value
}

export function normalizeMcpContentCatalogLimits(input = {}) {
  return Object.freeze({
    maxEntries: positiveInteger(input.maxEntries, DEFAULT_MCP_CONTENT_CATALOG_LIMITS.maxEntries, 'maxEntries'),
    maxPages: positiveInteger(input.maxPages, DEFAULT_MCP_CONTENT_CATALOG_LIMITS.maxPages, 'maxPages'),
    maxStringChars: positiveInteger(
      input.maxStringChars,
      DEFAULT_MCP_CONTENT_CATALOG_LIMITS.maxStringChars,
      'maxStringChars',
    ),
    maxBytes: positiveInteger(input.maxBytes, DEFAULT_MCP_CONTENT_CATALOG_LIMITS.maxBytes, 'maxBytes'),
  })
}

function contentError(message, code, cause) {
  return new DeepSeekEyesError(message, code, cause === undefined ? undefined : { cause })
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function optionalText(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function finiteSize(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function publicAnnotations(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const output = {}
  if (Array.isArray(value.audience)) {
    const audience = value.audience.filter(item => item === 'user' || item === 'assistant')
    if (audience.length > 0) output.audience = audience
  }
  if (typeof value.priority === 'number' && Number.isFinite(value.priority)) output.priority = value.priority
  if (typeof value.lastModified === 'string') output.lastModified = value.lastModified
  return Object.keys(output).length === 0 ? undefined : Object.freeze(output)
}

function normalizedResource(value, template = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw contentError('MCP resource catalog contains a non-object entry', 'MCP_CONTENT_CATALOG_INVALID')
  }
  const identity = template ? text(value.uriTemplate) : text(value.uri)
  if (identity === '') {
    throw contentError(
      `MCP resource ${template ? 'template' : 'catalog'} entry has no ${template ? 'uriTemplate' : 'uri'}`,
      'MCP_CONTENT_CATALOG_INVALID',
    )
  }
  return Object.freeze({
    ...(template ? { uriTemplate: identity } : { uri: identity }),
    name: text(value.name, identity),
    ...(optionalText(value.title) === undefined ? {} : { title: value.title }),
    ...(optionalText(value.description) === undefined ? {} : { description: value.description }),
    ...(optionalText(value.mimeType) === undefined ? {} : { mimeType: value.mimeType }),
    ...(finiteSize(value.size) === undefined ? {} : { size: value.size }),
    ...(publicAnnotations(value.annotations) === undefined ? {} : { annotations: publicAnnotations(value.annotations) }),
  })
}

function normalizedPrompt(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || text(value.name) === '') {
    throw contentError('MCP prompt catalog contains an invalid entry', 'MCP_CONTENT_CATALOG_INVALID')
  }
  const args = value.arguments === undefined ? [] : value.arguments
  if (!Array.isArray(args)) throw contentError('MCP prompt arguments must be an array', 'MCP_CONTENT_CATALOG_INVALID')
  return Object.freeze({
    name: value.name,
    ...(optionalText(value.title) === undefined ? {} : { title: value.title }),
    ...(optionalText(value.description) === undefined ? {} : { description: value.description }),
    arguments: Object.freeze(args.map(argument => {
      if (argument === null || typeof argument !== 'object' || text(argument.name) === '') {
        throw contentError('MCP prompt argument has no name', 'MCP_CONTENT_CATALOG_INVALID')
      }
      return Object.freeze({
        name: argument.name,
        ...(optionalText(argument.description) === undefined ? {} : { description: argument.description }),
        required: argument.required === true,
      })
    })),
  })
}

class ContentCatalogBudget {
  constructor(limits) {
    this.limits = limits
    this.entries = 0
    this.stringChars = 0
    this.bytes = 0
  }

  add(value) {
    this.entries += 1
    if (this.entries > this.limits.maxEntries) {
      throw contentError('MCP content catalog exceeds the entry limit', 'MCP_CONTENT_CATALOG_ENTRY_LIMIT')
    }
    const serialized = JSON.stringify(value)
    this.stringChars += serialized.length
    this.bytes += Buffer.byteLength(serialized)
    if (this.stringChars > this.limits.maxStringChars) {
      throw contentError('MCP content catalog exceeds the character limit', 'MCP_CONTENT_CATALOG_CHAR_LIMIT')
    }
    if (this.bytes > this.limits.maxBytes) {
      throw contentError('MCP content catalog exceeds the byte limit', 'MCP_CONTENT_CATALOG_BYTE_LIMIT')
    }
  }
}

async function drainPages(request, field, normalize, limits, budget) {
  const values = []
  let cursor
  const cursors = new Set()
  for (let page = 0; page < limits.maxPages; page += 1) {
    const response = await request(cursor)
    const entries = response?.[field]
    if (!Array.isArray(entries)) {
      throw contentError(`MCP ${field} response is not an array`, 'MCP_CONTENT_CATALOG_INVALID')
    }
    for (const entry of entries) {
      const value = normalize(entry)
      budget.add(value)
      values.push(value)
    }
    const next = optionalText(response.nextCursor)
    if (next === undefined) return values
    if (cursors.has(next)) throw contentError('MCP content catalog repeats a cursor', 'MCP_CONTENT_CURSOR_LOOP')
    cursors.add(next)
    cursor = next
  }
  throw contentError('MCP content catalog exceeds the page limit', 'MCP_CONTENT_PAGE_LIMIT')
}

function transportFor(sdk, server, environment, oauth) {
  const config = materializeDshMcpConfig(server, environment)
  if (config.transport === 'stdio') {
    return new sdk.StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      stderr: 'pipe',
    })
  }
  return new sdk.StreamableHTTPClientTransport(
    new URL(config.url),
    {
      requestInit: { headers: config.headers },
      ...(oauth === undefined ? {} : { authProvider: oauth.provider }),
    },
  )
}

function operationOptions(exec, timeoutMs) {
  return {
    signal: exec?.signal,
    timeout: timeoutMs,
  }
}

/** Dedicated, opt-in MCP protocol plane for Resources and Prompts. */
export class McpContentAdapter {
  constructor(ctx, server, options = {}) {
    this.ctx = ctx
    this.server = server
    this.environment = options.environment ?? process.env
    this.loadSdk = options.loadSdk ?? (() => loadHostMcpSdk(ctx))
    this.catalogLimits = normalizeMcpContentCatalogLimits(options.catalogLimits)
    this.onChanged = options.onChanged
    this.onOAuthEvent = options.onOAuthEvent
    this.oauthSessions = options.oauthSessions ?? new McpOAuthSessionRegistry({ now: options.now })
    this.oauth = isMcpOAuthEnabled(server)
      ? this.oauthSessions.get(server, this.environment, { onEvent: event => this.onOAuthEvent?.(event) })
      : undefined
    this.client = undefined
    this.cleanupClient = undefined
    this.transport = undefined
    this.status = 'idle'
    this.lastError = undefined
    this.resources = []
    this.resourceTemplates = []
    this.prompts = []
    this.capabilities = Object.freeze({ resources: false, prompts: false })
  }

  state() {
    return Object.freeze({
      connected: this.status === 'connected',
      status: this.status,
      capabilities: this.capabilities,
      resourceCount: this.resources.length,
      resourceTemplateCount: this.resourceTemplates.length,
      promptCount: this.prompts.length,
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
      ...(this.oauth === undefined ? {} : { oauth: this.oauth.health() }),
    })
  }

  updateServer(server) {
    this.server = server
  }

  notify(reason) {
    this.onChanged?.(this.catalog(), Object.freeze({ ...this.state(), reason }))
  }

  catalog() {
    return Object.freeze({
      resources: Object.freeze([...this.resources]),
      resourceTemplates: Object.freeze([...this.resourceTemplates]),
      prompts: Object.freeze([...this.prompts]),
    })
  }

  assertConnected() {
    if (this.client === undefined || this.status !== 'connected') {
      throw contentError(`MCP content plane for ${this.server.id} is not connected`, 'MCP_CONTENT_UNAVAILABLE')
    }
  }

  async start() {
    if (this.client !== undefined && this.status === 'connected') return this
    if (this.cleanupClient !== undefined) {
      throw contentError(
        `MCP content plane ${this.server.id} has unresolved transport cleanup`,
        'MCP_CONTENT_CLOSE_FAILED',
      )
    }
    this.status = 'connecting'
    let client
    try {
      const sdk = await this.loadSdk()
      this.oauth?.credentials()
      client = new sdk.Client(
        { name: 'deepseekeyes-content', version: '0.8.2' },
        { capabilities: {} },
      )
      const transport = transportFor(sdk, this.server, this.environment, this.oauth)
      if (this.oauth !== undefined) {
        transport.onerror = error => {
          this.oauth.recordError(error, 'content-transport-error')
          this.lastError = Object.freeze({ code: safeErrorCode(error, 'MCP_OAUTH_FAILED'), message: safeError(error) })
          this.notify('oauth-error')
        }
      }
      client.onclose = () => {
        if (this.client !== client) return
        this.status = 'disconnected'
        this.client = undefined
        this.transport = undefined
        this.notify('transport-closed')
      }
      await client.connect(transport)
      this.client = client
      this.transport = transport
      // `refresh()` intentionally rejects every non-live state. Mark the
      // transport connected before catalog discovery so startup exercises the
      // same guarded path as a later manual refresh.
      this.status = 'connected'
      const capabilities = client.getServerCapabilities?.() ?? {}
      this.capabilities = Object.freeze({
        resources: capabilities.resources !== undefined,
        prompts: capabilities.prompts !== undefined,
      })
      if (this.server.resourcesEnabled && !this.capabilities.resources) {
        throw contentError(`MCP server ${this.server.id} does not advertise Resources`, 'MCP_RESOURCES_UNSUPPORTED')
      }
      if (this.server.promptsEnabled && !this.capabilities.prompts) {
        throw contentError(`MCP server ${this.server.id} does not advertise Prompts`, 'MCP_PROMPTS_UNSUPPORTED')
      }
      await this.refresh()
      this.oauth?.markConnected()
      this.lastError = undefined
      this.notify('connected')
      return this
    } catch (cause) {
      this.status = 'error'
      this.lastError = Object.freeze({
        code: safeErrorCode(cause, 'MCP_CONTENT_CONNECT_FAILED'),
        message: safeError(cause),
      })
      this.oauth?.recordError(cause, 'content-connect-error')
      // Detach before closing so the transport's onclose notification cannot
      // overwrite this terminal startup error with `disconnected`.
      this.client = undefined
      this.transport = undefined
      try {
        await client?.close?.()
      } catch {
        this.cleanupClient = client
      }
      throw contentError(
        `MCP content plane ${this.server.id} failed: ${this.lastError.message}`,
        this.lastError.code,
        cause,
      )
    }
  }

  async refresh(exec = {}) {
    this.assertConnected()
    const budget = new ContentCatalogBudget(this.catalogLimits)
    const options = operationOptions(exec, this.server.timeoutMs)
    const resources = this.server.resourcesEnabled
      ? await drainPages(
          cursor => this.client.listResources(cursor === undefined ? {} : { cursor }, options),
          'resources',
          value => normalizedResource(value, false),
          this.catalogLimits,
          budget,
        )
      : []
    const resourceTemplates = this.server.resourcesEnabled
      ? await drainPages(
          cursor => this.client.listResourceTemplates(cursor === undefined ? {} : { cursor }, options),
          'resourceTemplates',
          value => normalizedResource(value, true),
          this.catalogLimits,
          budget,
        ).catch(error => {
          // Templates are optional even when the Resources capability exists.
          if (/method not found|not supported/i.test(safeError(error))) return []
          throw error
        })
      : []
    const prompts = this.server.promptsEnabled
      ? await drainPages(
          cursor => this.client.listPrompts(cursor === undefined ? {} : { cursor }, options),
          'prompts',
          normalizedPrompt,
          this.catalogLimits,
          budget,
        )
      : []
    this.resources = resources
    this.resourceTemplates = resourceTemplates
    this.prompts = prompts
    this.notify('refreshed')
    return this.catalog()
  }

  async readResource(uri, exec = {}) {
    this.assertConnected()
    if (!this.server.resourcesEnabled) throw contentError('MCP Resources are disabled for this server', 'MCP_RESOURCES_DISABLED')
    return this.client.readResource({ uri }, operationOptions(exec, this.server.timeoutMs))
  }

  async getPrompt(name, args = {}, exec = {}) {
    this.assertConnected()
    if (!this.server.promptsEnabled) throw contentError('MCP Prompts are disabled for this server', 'MCP_PROMPTS_DISABLED')
    return this.client.getPrompt(
      { name, ...(Object.keys(args).length === 0 ? {} : { arguments: args }) },
      operationOptions(exec, this.server.timeoutMs),
    )
  }

  async close() {
    const client = this.client ?? this.cleanupClient
    this.client = undefined
    this.cleanupClient = undefined
    this.transport = undefined
    this.resources = []
    this.resourceTemplates = []
    this.prompts = []
    this.status = 'closing'
    try {
      if (client !== undefined) await client.close()
    } catch (cause) {
      this.cleanupClient = client
      this.status = 'cleanup-failed'
      this.lastError = Object.freeze({
        code: safeErrorCode(cause, 'MCP_CONTENT_CLOSE_FAILED'),
        message: safeError(cause),
      })
      this.notify('cleanup-failed')
      throw contentError(
        `MCP content plane ${this.server.id} cleanup failed: ${this.lastError.message}`,
        this.lastError.code,
        cause,
      )
    }
    this.status = 'closed'
    this.lastError = undefined
    this.notify('closed')
  }
}

export function createMcpContentAdapterFactory(ctx, options = {}) {
  return {
    create(server, hooks = {}) {
      return new McpContentAdapter(ctx, server, { ...options, ...hooks })
    },
  }
}

function resourceContentBlock(value) {
  const uri = text(value?.uri, 'unknown')
  const mimeType = optionalText(value?.mimeType)
  if (typeof value?.text === 'string') {
    return {
      type: 'text',
      text: `[MCP resource ${uri}${mimeType === undefined ? '' : `; ${mimeType}`}]\n${value.text}`,
    }
  }
  if (typeof value?.blob === 'string' && mimeType?.startsWith('image/')) {
    return { type: 'image', data: value.blob, mimeType }
  }
  if (typeof value?.blob === 'string' && mimeType?.startsWith('audio/')) {
    return { type: 'audio', data: value.blob, mimeType }
  }
  if (typeof value?.blob === 'string') {
    return {
      type: 'resource',
      resource: { uri, ...(mimeType === undefined ? {} : { mimeType }), blob: value.blob },
    }
  }
  return { type: 'text', text: `[MCP resource ${uri} has no readable text/blob content]` }
}

export function mcpResourceResult(response) {
  if (!Array.isArray(response?.contents)) {
    throw contentError('MCP resources/read response has no contents array', 'MCP_RESOURCE_RESULT_INVALID')
  }
  return { content: response.contents.map(resourceContentBlock) }
}

function promptBlock(role, value) {
  const prefix = `[MCP prompt ${role}]\n`
  if (value?.type === 'text' && typeof value.text === 'string') return { type: 'text', text: `${prefix}${value.text}` }
  if (value?.type === 'image' && typeof value.data === 'string' && typeof value.mimeType === 'string') {
    return [
      { type: 'text', text: prefix.trimEnd() },
      { type: 'image', data: value.data, mimeType: value.mimeType },
    ]
  }
  if (value?.type === 'audio' && typeof value.data === 'string' && typeof value.mimeType === 'string') {
    return [
      { type: 'text', text: prefix.trimEnd() },
      { type: 'audio', data: value.data, mimeType: value.mimeType },
    ]
  }
  if (value?.type === 'resource_link' && typeof value.uri === 'string' && typeof value.name === 'string') {
    return [
      { type: 'text', text: prefix.trimEnd() },
      { type: 'resource_link', ...value },
    ]
  }
  if (value?.type === 'resource' && value.resource !== undefined) {
    return [
      { type: 'text', text: prefix.trimEnd() },
      resourceContentBlock(value.resource),
    ]
  }
  return { type: 'text', text: `${prefix}[unsupported prompt content: ${text(value?.type, 'unknown')}]` }
}

export function mcpPromptResult(response) {
  if (!Array.isArray(response?.messages)) {
    throw contentError('MCP prompts/get response has no messages array', 'MCP_PROMPT_RESULT_INVALID')
  }
  const content = []
  if (typeof response.description === 'string') {
    content.push({ type: 'text', text: `[MCP prompt description]\n${boundedUnicode(response.description, CONTENT_TEXT_LIMIT).text}` })
  }
  for (const message of response.messages) {
    const block = promptBlock(text(message?.role, 'user'), message?.content)
    content.push(...(Array.isArray(block) ? block : [block]))
  }
  return { content }
}

import { DeepSeekEyesError } from '../error.js'
import { randomUUID } from 'node:crypto'
import { boundedUnicode, hashValue, safeError } from './canonical.js'
import { loadHostDshMcpClient, loadHostMcpSdk } from './host-runtime.js'
import { normalizeToolAnnotations, publicMcpToolName } from './policy.js'
import { isMcpOAuthEnabled, McpOAuthSessionRegistry } from './oauth.js'

export const DEFAULT_MCP_CATALOG_LIMITS = Object.freeze({
  maxTools: 256,
  maxSchemaChars: 1_000_000,
  maxSchemaBytes: 4_000_000,
  maxSchemaDepth: 64,
  maxSchemaNodes: 100_000,
})

const MCP_CLEANUP_ERROR_INPUT_MAX_CHARS = 2_000
const MCP_ADAPTER_ERROR_CODE_INPUT_MAX_CHARS = 256

function boundedAdapterError(error) {
  let raw
  try {
    const message = error?.message
    raw = typeof message === 'string' ? message : String(error)
  } catch {
    raw = 'unknown error'
  }
  // Bound transport-controlled text before credential regexes scan it.
  return safeError(boundedUnicode(raw, MCP_CLEANUP_ERROR_INPUT_MAX_CHARS).text)
}

function boundedAdapterErrorCode(error, fallback) {
  let raw
  try {
    raw = error?.code
  } catch {
    return fallback
  }
  if (typeof raw !== 'string') return fallback
  const bounded = boundedUnicode(raw, MCP_ADAPTER_ERROR_CODE_INPUT_MAX_CHARS).text
  if (bounded.trim() === '') return fallback
  const code = safeError(bounded, 100)
  return code === '' ? fallback : code
}

function adapterErrorState(error, fallbackCode, fallbackMessage, { preserveCode = true } = {}) {
  return Object.freeze({
    code: preserveCode ? boundedAdapterErrorCode(error, fallbackCode) : fallbackCode,
    message: boundedAdapterError(error) || fallbackMessage,
  })
}

function errorFromState(state) {
  return new DeepSeekEyesError(state.message, state.code)
}

function positiveLimit(value, fallback, field) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`deepseekeyes: ${field} must be a positive safe integer`)
  }
  return resolved
}

export function normalizeMcpCatalogLimits(value = {}) {
  return Object.freeze({
    maxTools: positiveLimit(value.maxTools, DEFAULT_MCP_CATALOG_LIMITS.maxTools, 'MCP catalog maxTools'),
    maxSchemaChars: positiveLimit(
      value.maxSchemaChars,
      DEFAULT_MCP_CATALOG_LIMITS.maxSchemaChars,
      'MCP catalog maxSchemaChars',
    ),
    maxSchemaBytes: positiveLimit(
      value.maxSchemaBytes,
      DEFAULT_MCP_CATALOG_LIMITS.maxSchemaBytes,
      'MCP catalog maxSchemaBytes',
    ),
    maxSchemaDepth: positiveLimit(
      value.maxSchemaDepth,
      DEFAULT_MCP_CATALOG_LIMITS.maxSchemaDepth,
      'MCP catalog maxSchemaDepth',
    ),
    maxSchemaNodes: positiveLimit(
      value.maxSchemaNodes,
      DEFAULT_MCP_CATALOG_LIMITS.maxSchemaNodes,
      'MCP catalog maxSchemaNodes',
    ),
  })
}

function catalogError(message, code) {
  const error = new DeepSeekEyesError(message, code)
  error.status = 'catalog-rejected'
  return error
}

function objectEntries(value) {
  return (function* entries() {
    for (const key in value) {
      if (Object.hasOwn(value, key)) yield [key, value[key]]
    }
  })()
}

function arrayEntries(value) {
  return (function* entries() {
    for (let index = 0; index < value.length; index += 1) yield [String(index), value[index]]
  })()
}

/**
 * Incrementally measure a JSON-like tool schema without JSON.stringify(),
 * recursive calls, or an unbounded key array. The official Host Client drains
 * and validates every tools/list page before it calls this registry, so this
 * boundary cannot cap bytes already received from one page or an unbounded
 * cursor chain. It does ensure the persistent capture, sorting, model schema,
 * and manager never retain or traverse an unbounded catalog generation.
 */
function measureCatalogValue(value, limits, initial) {
  const usage = { ...initial }
  const ancestors = new WeakSet()
  const stack = [{ kind: 'value', value, depth: 0 }]
  const add = (chars, bytes = chars) => {
    usage.chars += chars
    usage.bytes += bytes
    if (usage.chars > limits.maxSchemaChars) {
      throw catalogError(
        `MCP tool catalog exceeds ${limits.maxSchemaChars} schema characters`,
        'MCP_CATALOG_SCHEMA_CHARS_LIMIT',
      )
    }
    if (usage.bytes > limits.maxSchemaBytes) {
      throw catalogError(
        `MCP tool catalog exceeds ${limits.maxSchemaBytes} schema bytes`,
        'MCP_CATALOG_SCHEMA_BYTES_LIMIT',
      )
    }
  }
  const node = () => {
    usage.nodes += 1
    if (usage.nodes > limits.maxSchemaNodes) {
      throw catalogError(
        `MCP tool catalog exceeds ${limits.maxSchemaNodes} schema nodes`,
        'MCP_CATALOG_SCHEMA_NODES_LIMIT',
      )
    }
  }
  const addString = value => {
    add(2)
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
        || code === 0x0a || code === 0x0c || code === 0x0d) {
        add(2)
      } else if (code < 0x20) {
        add(6)
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          add(2, 4)
          index += 1
        } else {
          add(6)
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        add(6)
      } else {
        add(1, code < 0x80 ? 1 : code < 0x800 ? 2 : 3)
      }
    }
  }

  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame.kind === 'container') {
      const next = frame.iterator.next()
      if (next.done) {
        add(1)
        ancestors.delete(frame.value)
        continue
      }
      if (!frame.first) add(1)
      frame.first = false
      if (!frame.array) {
        addString(next.value[0])
        add(1)
      }
      stack.push(frame)
      stack.push({ kind: 'value', value: next.value[1], depth: frame.depth + 1 })
      continue
    }

    node()
    const current = frame.value
    if (current === null || current === undefined) {
      add(4)
      continue
    }
    if (typeof current === 'string') {
      addString(current)
      continue
    }
    if (typeof current === 'number') {
      const text = Number.isFinite(current) ? String(current) : 'null'
      add(text.length)
      continue
    }
    if (typeof current === 'boolean') {
      add(current ? 4 : 5)
      continue
    }
    if (typeof current !== 'object') {
      throw catalogError('MCP tool catalog contains a non-JSON schema value', 'MCP_CATALOG_SCHEMA_INVALID')
    }
    if (frame.depth > limits.maxSchemaDepth) {
      throw catalogError(
        `MCP tool catalog exceeds schema depth ${limits.maxSchemaDepth}`,
        'MCP_CATALOG_SCHEMA_DEPTH_LIMIT',
      )
    }
    if (ancestors.has(current)) {
      throw catalogError('MCP tool catalog contains a cyclic schema', 'MCP_CATALOG_SCHEMA_INVALID')
    }
    ancestors.add(current)
    const array = Array.isArray(current)
    add(1)
    stack.push({
      kind: 'container',
      value: current,
      array,
      iterator: array ? arrayEntries(current) : objectEntries(current),
      first: true,
      depth: frame.depth,
    })
  }
  return usage
}

export class McpCatalogBudget {
  constructor(limits = {}) {
    this.limits = normalizeMcpCatalogLimits(limits)
    this.reset()
  }

  reset() {
    this.usage = { tools: 0, chars: 0, bytes: 0, nodes: 0 }
  }

  admit(surface) {
    if (this.usage.tools >= this.limits.maxTools) {
      throw catalogError(
        `MCP tool catalog exceeds ${this.limits.maxTools} tools`,
        'MCP_CATALOG_TOOL_LIMIT',
      )
    }
    const before = { ...this.usage }
    const measured = measureCatalogValue(surface, this.limits, this.usage)
    measured.tools += 1
    this.usage = measured
    return Object.freeze({
      tools: 1,
      chars: measured.chars - before.chars,
      bytes: measured.bytes - before.bytes,
      nodes: measured.nodes - before.nodes,
    })
  }

  release(cost) {
    if (cost === undefined) return
    this.usage = {
      tools: Math.max(0, this.usage.tools - cost.tools),
      chars: Math.max(0, this.usage.chars - cost.chars),
      bytes: Math.max(0, this.usage.bytes - cost.bytes),
      nodes: Math.max(0, this.usage.nodes - cost.nodes),
    }
  }
}

function resolveCredential(reference, environment, field) {
  const envName = typeof reference === 'string' ? reference : reference?.env
  const value = environment[envName]
  if (typeof value !== 'string' || value === '') {
    throw new DeepSeekEyesError(
      `MCP credential reference ${field} requires environment variable ${envName}`,
      'MCP_CREDENTIAL_MISSING',
    )
  }
  return value
}

export function materializeDshMcpConfig(server, environment = process.env) {
  const common = {
    serverName: server.id,
    transport: server.transport,
    toolCallTimeoutMs: server.timeoutMs,
    // The manager needs a trustworthy health result instead of the official
    // plugin's intentionally degraded-but-active startup mode.
    failOnStartupError: true,
    reconnect: server.reconnect,
  }
  if (server.transport === 'stdio') {
    return {
      ...common,
      command: server.command,
      args: [...server.args],
      env: Object.fromEntries(Object.entries(server.env).map(([key, reference]) => [
        key,
        resolveCredential(reference, environment, `env.${key}`),
      ])),
      cwd: server.cwd ?? process.cwd(),
    }
  }
  return {
    ...common,
    url: server.url,
    headers: Object.fromEntries(Object.entries(server.headers).map(([key, reference]) => [
      key,
      resolveCredential(reference, environment, `headers.${key}`),
    ])),
  }
}

function inferredRawName(serverId, publicName) {
  const prefix = `mcp__${serverId}__`
  return publicName.startsWith(prefix) ? publicName.slice(prefix.length) : publicName
}

// A public DSH tool name is sanitized and may include a hash, so it cannot
// recover protocol names such as `read.file`. When an allow/deny selector uses
// a character that the public-name contract normalizes, the independent
// tools/list metadata pass is required even outside read-only risk mode.
function requiresRawNameMetadata(server) {
  return [...(server.allowedTools ?? []), ...(server.denyTools ?? [])]
    .some(selector => {
      const value = String(selector)
      if (value.startsWith(`mcp__${server.id}__`)) return false
      const qualifiedPrefix = [`${server.id}/`, `${server.name}/`].find(prefix => value.startsWith(prefix))
      const raw = qualifiedPrefix === undefined ? value : value.slice(qualifiedPrefix.length)
      const publicPrefixLength = `mcp__${server.id}__`.length
      const maxUnhashedRawLength = Math.max(0, 64 - publicPrefixLength)
      // The ordinary `*` allowlist and short alphanumeric names are fully
      // recoverable from the Host public name. Metadata is required only when
      // the raw selector can be transformed (punctuation), truncated/hashed
      // (long names), or wildcard-matched against such a transformed name.
      return /[^A-Za-z0-9_*-]/.test(raw)
        || raw.length > maxUnhashedRawLength
        || (/[?*]/.test(raw) && raw !== '*')
    })
}

function catalogToolFingerprint(tool) {
  return hashValue({
    rawName: tool.rawName ?? tool.name,
    publicName: tool.publicName,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? null,
  })
}

class CaptureRegistry {
  constructor(server, onToolsChanged, limits) {
    this.server = server
    this.onToolsChanged = onToolsChanged
    this.budget = new McpCatalogBudget(limits)
    this.definitions = new Map()
    this.costs = new Map()
    this.metadata = new Map()
    this.pending = false
    this.accepting = true
    this.error = undefined
  }

  notify() {
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      this.onToolsChanged?.(this.list(), { error: this.error })
    })
  }

  clear() {
    this.definitions.clear()
    this.costs.clear()
    this.metadata.clear()
    this.budget.reset()
    this.notify()
  }

  clearMetadata() {
    this.metadata.clear()
  }

  setMetadata(entries, { notify = true } = {}) {
    const expected = new Map([...this.definitions.values()].map(definition => {
      return [definition.name, hashValue({
        name: definition.name,
        description: definition.description ?? '',
        inputSchema: definition.parameters ?? {},
      })]
    }))
    if (expected.size !== entries.size || [...expected].some(([rawName, fingerprint]) => {
      return entries.get(rawName)?.fingerprint !== fingerprint
    })) {
      throw new DeepSeekEyesError(
        `MCP server ${this.server.id} risk metadata does not match the active tool catalog`,
        'MCP_RISK_METADATA_MISMATCH',
      )
    }
    this.metadata = new Map(entries)
    if (notify) this.notify()
  }

  suspend() {
    this.accepting = false
    this.error = undefined
    this.clear()
  }

  resume() {
    this.accepting = true
    this.error = undefined
    this.clear()
  }

  rejectGeneration(error) {
    this.error = error
    this.clear()
  }

  register(definition) {
    if (!this.accepting) {
      throw catalogError('MCP tool capture is closed', 'MCP_ADAPTER_CLOSED')
    }
    if (this.error !== undefined && this.definitions.size === 0) this.error = undefined
    if (this.definitions.has(definition.name)) {
      const error = catalogError(`duplicate MCP tool ${definition.name}`, 'MCP_CATALOG_DUPLICATE_TOOL')
      this.rejectGeneration(error)
      throw error
    }
    let cost
    try {
      cost = this.budget.admit({
        name: definition.name,
        description: definition.description ?? '',
        parameters: definition.parameters ?? {},
        outputSchema: definition.output?.schema ?? null,
      })
    } catch (error) {
      const failure = error instanceof DeepSeekEyesError
        ? error
        : catalogError('MCP tool catalog contains an unreadable schema', 'MCP_CATALOG_SCHEMA_INVALID')
      this.rejectGeneration(failure)
      throw failure
    }
    this.definitions.set(definition.name, definition)
    this.costs.set(definition.name, cost)
    this.notify()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.definitions.get(definition.name) === definition) {
        this.definitions.delete(definition.name)
        this.budget.release(this.costs.get(definition.name))
        this.costs.delete(definition.name)
      }
      this.notify()
    }
  }

  list() {
    return [...this.definitions.values()].map(definition => {
      const publicName = definition.name
      const metadata = this.metadata.get(publicName)
      const rawName = metadata?.rawName ?? inferredRawName(this.server.id, publicName)
      return {
        name: rawName,
        rawName,
        publicName,
        description: definition.description ?? '',
        inputSchema: definition.parameters ?? {},
        outputSchema: definition.output?.schema,
        annotations: metadata?.annotations ?? normalizeToolAnnotations(definition.annotations),
        definition,
      }
    }).sort((left, right) => left.publicName.localeCompare(right.publicName))
  }
}

export class DshMcpClientAdapter {
  constructor(ctx, server, options = {}) {
    this.ctx = ctx
    this.server = server
    this.wrapperName = options.wrapperName ?? this.server.id
    this.loadPlugin = options.loadPlugin ?? (() => loadHostDshMcpClient(ctx))
    this.loadSdk = options.loadSdk ?? (() => loadHostMcpSdk(ctx))
    this.environment = options.environment ?? process.env
    this.onToolsChanged = options.onToolsChanged
    this.onProbeCleanupFailure = options.onProbeCleanupFailure
    this.catalogLimits = normalizeMcpCatalogLimits(options.mcpCatalogLimits)
    this.capture = new CaptureRegistry(server, (tools, state) => this.captureChanged(tools, state), this.catalogLimits)
    this.fiber = undefined
    this.connected = false
    this.status = 'idle'
    this.lastError = undefined
    this.closed = false
    this.startedOnce = false
    this.suppressNotifications = 0
    this.pendingNotification = undefined
    this.lastToolCount = 0
    this.catalogGeneration = 0
    this.refreshing = undefined
    this.riskMetadataGeneration = 0
    this.riskMetadataInFlight = undefined
    this.metadataCleanupFailure = undefined
    this.probeCleanupFailures = new Map()
    this.probeCleanupRetry = undefined
    this.probeCleanupHandle = Object.freeze({
      close: () => this.retryProbeCleanup(),
    })
  }

  metadataRequired() {
    return this.server.riskPolicy === 'read-only' || requiresRawNameMetadata(this.server)
  }

  connectionState() {
    const probeCleanup = [...this.probeCleanupFailures.values()].at(-1)
    const status = probeCleanup === undefined ? this.status : 'cleanup-failed'
    return Object.freeze({
      connected: status === 'connected'
        ? true
        : status === 'unknown' || status === 'connecting' ? undefined : false,
      status,
      toolCount: this.capture.definitions.size,
      probeCleanupFailures: this.probeCleanupFailures.size,
      ...(probeCleanup?.lastError === undefined && this.lastError === undefined ? {} : {
        error: probeCleanup?.lastError ?? this.lastError,
      }),
      ...(this.metadataCleanupFailure?.lastError === undefined ? {} : {
        metadataCleanupFailure: this.metadataCleanupFailure.lastError,
      }),
      reconnect: Object.freeze({ ...this.server.reconnect }),
    })
  }

  notify(tools, reason) {
    const connection = Object.freeze({
      ...this.connectionState(),
      reason,
    })
    if (this.suppressNotifications > 0) {
      this.pendingNotification = { tools, connection }
      return
    }
    this.onToolsChanged?.(
      tools.map(tool => ({ ...tool, catalogGeneration: this.catalogGeneration })),
      connection,
    )
  }

  captureChanged(tools, captureState = {}) {
    this.catalogGeneration += 1
    const previousCount = this.lastToolCount
    this.lastToolCount = tools.length
    let reason = 'tools-changed'
    if (captureState.error !== undefined) {
      this.status = 'catalog-rejected'
      this.connected = false
      this.lastError = adapterErrorState(
        captureState.error,
        'MCP_CATALOG_SCHEMA_INVALID',
        'MCP tool catalog was rejected',
      )
      reason = 'catalog-rejected'
    } else if (this.closed || !this.capture.accepting) {
      this.status = this.lastError?.code === 'MCP_ADAPTER_CLOSE_FAILED' ? 'cleanup-failed' : 'closed'
      this.connected = false
      reason = this.status
    } else if (this.startedOnce && previousCount > 0 && tools.length === 0) {
      // Empty is a valid MCP catalog, but the Host Client exposes the same unregister
      // signal when its reconnect budget is exhausted. Mark it unknown and
      // fail closed until a real uncached probe distinguishes the two cases.
      this.status = 'unknown'
      this.connected = false
      this.lastError = undefined
      reason = 'tools-empty-unverified'
    } else if (this.startedOnce && tools.length > 0) {
      // A new non-empty generation can only be registered after a successful
      // tools/list on the current official-client transport.
      this.status = 'connected'
      this.connected = true
      this.lastError = undefined
    }
    if (this.metadataRequired()) {
      if (!this.startedOnce || tools.length === 0 || captureState.error !== undefined || this.closed || !this.capture.accepting) {
        this.capture.clearMetadata()
        this.riskMetadataGeneration += 1
      } else {
        this.capture.clearMetadata()
        const generation = ++this.riskMetadataGeneration
        // Do not publish the inferred catalog as healthy while the required
        // raw-name/annotation pass is in flight. The manager must withdraw
        // schemas until the replacement metadata has been verified.
        this.status = 'unknown'
        this.connected = false
        this.lastError = undefined
        this.notify(this.capture.list(), 'risk-metadata-pending')
        void this.refreshRiskMetadata(tools, generation).catch(() => {})
        return
      }
    }
    this.notify(tools, reason)
  }

  flushNotification(reason) {
    const tools = this.capture.list()
    this.pendingNotification = undefined
    this.notify(tools, reason)
  }

  async start() {
    if (this.closed) throw new DeepSeekEyesError('MCP adapter is closed', 'MCP_ADAPTER_CLOSED')
    if (this.fiber !== undefined) return this
    if (typeof this.ctx.plugin !== 'function') {
      throw new DeepSeekEyesError('DSH Cordis ctx.plugin is required for MCP', 'MCP_HOST_UNAVAILABLE')
    }
    const plugin = await this.loadPlugin()
    if (typeof plugin.apply !== 'function') {
      throw new DeepSeekEyesError('The installed DSH MCP client has no apply() entrypoint', 'MCP_CLIENT_INVALID')
    }
    const capture = this.capture
    const officialConfig = materializeDshMcpConfig(this.server, this.environment)
    const wrapper = {
      name: `deepseekeyes-mcp-${this.wrapperName}`,
      inject: plugin.inject ?? ['tools'],
      apply(child) {
        return plugin.apply(child.extend({ tools: capture }), officialConfig)
      },
    }
    this.status = 'connecting'
    this.capture.resume()
    try {
      this.fiber = this.ctx.plugin(wrapper)
      await this.fiber
    } catch (error) {
      const captured = this.capture.error
      const failureState = adapterErrorState(
        captured ?? error,
        captured === undefined ? 'MCP_CONNECT_FAILED' : 'MCP_CATALOG_SCHEMA_INVALID',
        captured === undefined ? 'MCP adapter startup failed' : 'MCP tool catalog was rejected',
        { preserveCode: captured !== undefined },
      )
      const failure = errorFromState(failureState)
      this.status = this.capture.error === undefined ? 'error' : 'catalog-rejected'
      this.connected = false
      this.startedOnce = true
      this.lastError = failureState
      this.notify(this.capture.list(), 'startup-failed')
      throw failure
    }
    this.status = 'connected'
    this.connected = true
    this.startedOnce = true
    if (this.metadataRequired()) {
      // rc.8's Host bridge may sanitize protocol names and drop MCP
      // ToolAnnotations. Read-only mode must not guess, and an explicit
      // allow/deny selector containing sanitized characters cannot match an
      // inferred name. Obtain the protocol metadata through one short-lived,
      // SDK-owned tools/list pass before publishing the active capture. The
      // call transport remains the Host-managed bridge; this side channel
      // carries metadata and raw names only.
      const generation = ++this.riskMetadataGeneration
      await this.refreshRiskMetadata(this.capture.list(), generation)
    }
    this.lastToolCount = this.capture.definitions.size
    this.lastError = undefined
    this.notify(this.capture.list(), 'connected')
    return this
  }

  async readRiskAnnotations() {
    await this.retryMetadataCleanup()
    const sdk = await this.loadSdk()
    const config = materializeDshMcpConfig(this.server, this.environment)
    const client = new sdk.Client(
      { name: 'deepseekeyes-mcp-risk-metadata', version: '0.8.2' },
      { capabilities: {} },
    )
    const transport = this.server.transport === 'stdio'
      ? new sdk.StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...config.env },
          cwd: config.cwd,
        })
      : new sdk.StreamableHTTPClientTransport(
          new URL(config.url),
          { requestInit: { headers: config.headers } },
        )
    let operationError
    try {
      await client.connect(transport)
      const metadata = new Map()
      const budget = new McpCatalogBudget(this.catalogLimits)
      let cursor
      const cursors = new Set()
      let complete = false
      for (let page = 0; page < this.catalogLimits.maxTools; page += 1) {
        const response = await client.request(
          { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
          sdk.ListToolsResultSchema,
          { timeout: this.server.timeoutMs },
        )
        for (const tool of response.tools) {
          const rawName = String(tool.name)
          const publicName = publicMcpToolName(this.server.id, rawName)
          budget.admit({
            name: publicName,
            description: tool.description ?? '',
            parameters: tool.inputSchema ?? {},
            outputSchema: tool.outputSchema ?? null,
          })
          if (metadata.has(publicName)) {
            throw new DeepSeekEyesError(
              `MCP server ${this.server.id} risk metadata contains duplicate public tool ${publicName}`,
              'MCP_CATALOG_DUPLICATE_TOOL',
            )
          }
          metadata.set(publicName, {
            rawName,
            // Retain only the bounded boolean risk surface consumed by the
            // manager. Protocol annotation extensions (for example an
            // unbounded title) never enter the long-lived capture.
            annotations: normalizeToolAnnotations(tool.annotations),
            fingerprint: hashValue({
              name: publicName,
              description: tool.description ?? '',
              inputSchema: tool.inputSchema ?? {},
            }),
          })
        }
        const next = typeof response.nextCursor === 'string' && response.nextCursor !== ''
          ? response.nextCursor
          : undefined
        if (next === undefined) {
          complete = true
          break
        }
        if (cursors.has(next)) {
          throw new DeepSeekEyesError('MCP risk metadata tools/list repeated a cursor', 'MCP_CATALOG_CURSOR_LOOP')
        }
        cursors.add(next)
        cursor = next
      }
      if (!complete) {
        throw new DeepSeekEyesError('MCP risk metadata tools/list exceeded the page limit', 'MCP_CATALOG_PAGE_LIMIT')
      }
      return metadata
    } catch (error) {
      operationError = error
      throw error
    } finally {
      try {
        await client.close()
        this.metadataCleanupFailure = undefined
      } catch (closeError) {
        this.metadataCleanupFailure = {
          client,
          lastError: Object.freeze({
            code: boundedAdapterErrorCode(closeError, 'MCP_RISK_METADATA_CLEANUP_FAILED'),
            message: boundedAdapterError(closeError) || 'MCP risk metadata cleanup failed',
          }),
        }
        if (operationError === undefined) {
          throw new DeepSeekEyesError(
            'MCP risk metadata cleanup failed',
            'MCP_RISK_METADATA_CLEANUP_FAILED',
            { cause: closeError },
          )
        }
        throw new DeepSeekEyesError(
          'MCP risk metadata request and cleanup both failed',
          'MCP_RISK_METADATA_CLEANUP_FAILED',
          { cause: closeError },
        )
      }
    }
  }

  async retryMetadataCleanup() {
    const failure = this.metadataCleanupFailure
    if (failure === undefined) return true
    try {
      await failure.client?.close?.()
      if (this.metadataCleanupFailure === failure) this.metadataCleanupFailure = undefined
      return true
    } catch (error) {
      const detail = adapterErrorState(
        error,
        'MCP_RISK_METADATA_CLEANUP_FAILED',
        'MCP risk metadata cleanup failed',
      )
      failure.lastError = Object.freeze({ code: detail.code, message: detail.message })
      throw new DeepSeekEyesError(detail.message, 'MCP_RISK_METADATA_CLEANUP_FAILED', { cause: error })
    }
  }

  updateServer(server) {
    if (this.server === server) return
    this.server = server
    if (this.closed || !this.metadataRequired()) return
    this.capture.clearMetadata()
    const generation = ++this.riskMetadataGeneration
    this.status = 'unknown'
    this.connected = false
    this.lastError = undefined
    this.notify(this.capture.list(), 'risk-metadata-pending')
    void this.refreshRiskMetadata(this.capture.list(), generation).catch(() => {})
  }

  async refreshRiskMetadata(tools, generation) {
    if (this.riskMetadataInFlight !== undefined) {
      try {
        await this.riskMetadataInFlight
      } catch {}
      if (generation !== this.riskMetadataGeneration) return
    }
    const run = (async () => {
      try {
        const metadata = await this.readRiskAnnotations()
        if (generation !== this.riskMetadataGeneration || this.closed) return
        // The active Host capture may have changed while the independent
        // metadata connection was draining. setMetadata validates names and
        // schema fingerprints before making the hints visible.
        this.capture.setMetadata(metadata, { notify: false })
        this.status = 'connected'
        this.connected = true
        this.lastError = undefined
        this.notify(this.capture.list(), 'risk-metadata-ready')
      } catch (error) {
        if (generation !== this.riskMetadataGeneration || this.closed) return
        this.capture.clearMetadata()
        this.status = 'unknown'
        this.connected = false
        this.lastError = adapterErrorState(
          error,
          'MCP_RISK_METADATA_FAILED',
          'MCP read-only risk metadata could not be verified',
        )
        this.notify(this.capture.list(), 'risk-metadata-failed')
        throw error
      }
    })()
    this.riskMetadataInFlight = run
    try {
      await run
    } finally {
      if (this.riskMetadataInFlight === run) this.riskMetadataInFlight = undefined
    }
  }

  async listTools() {
    return this.capture.list().map(tool => ({ ...tool, catalogGeneration: this.catalogGeneration }))
  }

  /**
   * Establish a separate, short-lived official-client connection and drain its
   * real tools/list response. This is deliberately not a capture-cache read.
   * The probe namespace is unique so it can coexist with the active supervised
   * connection while preserving the original public names in the returned view.
   */
  async probe() {
    // Never create another child transport while an earlier probe fiber is
    // still awaiting cleanup. A retry either drains the retained adapters or
    // fails before allocating any new process/connection.
    if (this.probeCleanupFailures.size > 0) await this.retryProbeCleanup()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const probeId = `probe_${this.server.id.slice(0, 13)}_${suffix}`
    const probeServer = Object.freeze({ ...this.server, id: probeId })
    const probe = new DshMcpClientAdapter(this.ctx, probeServer, {
      loadPlugin: this.loadPlugin,
      loadSdk: this.loadSdk,
      wrapperName: probeId,
      environment: this.environment,
      mcpCatalogLimits: this.catalogLimits,
    })
    probe.probeKey = probeId
    try {
      await probe.start()
      return (await probe.listTools()).map(tool => ({
        ...tool,
        publicName: publicMcpToolName(this.server.id, tool.rawName),
      }))
    } finally {
      try {
        await probe.close()
      } catch (error) {
        throw this.recordProbeCleanupFailure(probe, error)
      }
    }
  }

  recordProbeCleanupFailure(probe, error) {
    const detail = adapterErrorState(
      error,
      'MCP_ADAPTER_CLOSE_FAILED',
      'unknown error',
      { preserveCode: false },
    )
    const failure = new DeepSeekEyesError(
      `MCP server ${this.server.id} probe transport cleanup failed: ${detail.message}`,
      'MCP_ADAPTER_CLOSE_FAILED',
    )
    this.probeCleanupFailures.set(probe.probeKey ?? probe.server.id, {
      adapter: probe,
      lastError: Object.freeze({ code: failure.code, message: failure.message }),
    })
    try {
      this.onProbeCleanupFailure?.(this.probeCleanupHandle, failure)
    } catch {}
    return failure
  }

  async retryProbeCleanup() {
    if (this.probeCleanupRetry !== undefined) return this.probeCleanupRetry
    this.probeCleanupRetry = (async () => {
      let lastFailure
      for (const [probeId, retained] of [...this.probeCleanupFailures]) {
        try {
          await retained.adapter.close()
          if (this.probeCleanupFailures.get(probeId) === retained) {
            this.probeCleanupFailures.delete(probeId)
          }
        } catch (error) {
          const detail = adapterErrorState(
            error,
            'MCP_ADAPTER_CLOSE_FAILED',
            'unknown error',
            { preserveCode: false },
          )
          const failure = new DeepSeekEyesError(
            `MCP server ${this.server.id} probe transport cleanup retry failed: ${detail.message}`,
            'MCP_ADAPTER_CLOSE_FAILED',
          )
          retained.lastError = Object.freeze({ code: failure.code, message: failure.message })
          lastFailure = failure
        }
      }
      if (lastFailure !== undefined) throw lastFailure
      return true
    })()
    try {
      return await this.probeCleanupRetry
    } finally {
      this.probeCleanupRetry = undefined
    }
  }

  reconcileProbe(tools) {
    if (this.status !== 'unknown') return this.connectionState()
    const active = this.capture.list().map(tool => tool.rawName).sort()
    const probed = tools.map(tool => String(tool.rawName ?? tool.name ?? '')).sort()
    const matches = active.length === probed.length && active.every((name, index) => name === probed[index])
    if (matches) {
      this.status = 'connected'
      this.connected = true
      this.lastError = undefined
      this.notify(this.capture.list(), active.length === 0 ? 'probe-confirmed-zero' : 'probe-confirmed')
    } else {
      this.status = 'disconnected'
      this.connected = false
      const failure = new DeepSeekEyesError(
        `MCP server ${this.server.id} live catalog does not match the active transport capture`,
        'MCP_CONNECTION_UNHEALTHY',
      )
      this.lastError = adapterErrorState(
        failure,
        'MCP_CONNECTION_UNHEALTHY',
        'MCP connection is unhealthy',
      )
      this.notify(this.capture.list(), 'probe-mismatch')
    }
    return this.connectionState()
  }

  /**
   * Force a new official-client generation. Normal outages are already handled
   * by that client's bounded exponential reconnect supervisor; this operation
   * is the explicit UI refresh and therefore tears down, reconnects, and performs
   * a fresh tools/list before returning.
   */
  async refresh() {
    if (this.refreshing !== undefined) return this.refreshing
    this.refreshing = (async () => {
      this.suppressNotifications += 1
      try {
        await this.disposeFiber({ permanent: false })
        await this.start()
        if (this.status !== 'connected') {
          throw new DeepSeekEyesError(
            `MCP server ${this.server.id} did not reconnect during refresh`,
            'MCP_CONNECT_FAILED',
          )
        }
        return this.capture.list()
      } finally {
        this.suppressNotifications -= 1
        this.flushNotification(this.connected ? 'refreshed' : 'refresh-failed')
      }
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = undefined
    }
  }

  async callTool(tool, args, exec = {}) {
    const publicName = tool.publicName ?? tool.name
    const definition = this.capture.definitions.get(publicName)
    // A Host catalog callback and the manager's serialized catalog update are
    // separated by microtasks. Refuse a stale tool object here instead of
    // looking up the same public name and accidentally executing the newer
    // generation (for example an old read hint dispatching a new write tool).
    if (definition === undefined
      || (tool.definition !== undefined && definition !== tool.definition)
      || (tool.catalogGeneration !== undefined && tool.catalogGeneration !== this.catalogGeneration)) {
      const error = new DeepSeekEyesError(`MCP tool ${publicName} is no longer available`, 'MCP_TOOL_UNAVAILABLE')
      error.beforeTransport = true
      throw error
    }
    return definition.execute(args, {
      ...exec,
      signal: exec.signal ?? new AbortController().signal,
    })
  }

  async close() {
    // Enter the terminal state before the first await. A metadata refresh can
    // be started by a Host catalog callback while close is waiting for another
    // child/probe cleanup; marking the adapter closed and suspending capture
    // first prevents that late refresh from allocating a new client after the
    // close snapshot was taken.
    if (!this.closed) {
      this.closed = true
      this.status = 'closed'
      this.connected = false
      this.riskMetadataGeneration += 1
      this.capture.suspend()
      this.notify([], 'closed')
    }
    let metadataInFlightFailure
    const metadataRun = this.riskMetadataInFlight
    if (metadataRun !== undefined) {
      try {
        await metadataRun
      } catch (error) {
        metadataInFlightFailure = error
      }
    }
    let probeFailure
    try {
      await this.retryProbeCleanup()
    } catch (error) {
      probeFailure = error
    }
    let metadataFailure
    try {
      await this.retryMetadataCleanup()
    } catch (error) {
      metadataFailure = error
    }
    let runtimeFailure
    try {
      await this.disposeFiber({ permanent: true })
    } catch (error) {
      runtimeFailure = error
    }
    if (runtimeFailure !== undefined) throw runtimeFailure
    if (probeFailure !== undefined) throw probeFailure
    if (metadataFailure !== undefined) throw metadataFailure
    if (metadataInFlightFailure !== undefined && this.metadataCleanupFailure !== undefined) {
      throw metadataInFlightFailure
    }
  }

  async disposeFiber({ permanent }) {
    const fiber = this.fiber
    if (permanent) this.closed = true
    this.status = permanent ? 'closed' : 'connecting'
    this.connected = false
    this.capture.suspend()
    this.notify([], permanent ? 'closed' : 'refresh-dispose')
    try {
      await fiber?.dispose?.()
      this.fiber = undefined
      this.lastError = undefined
      if (!permanent) this.capture.resume()
    } catch (error) {
      const detail = adapterErrorState(
        error,
        'MCP_ADAPTER_CLOSE_FAILED',
        'unknown error',
        { preserveCode: false },
      )
      const failure = new DeepSeekEyesError(
        `MCP server ${this.server.id} transport cleanup failed: ${detail.message}`,
        'MCP_ADAPTER_CLOSE_FAILED',
      )
      this.status = 'cleanup-failed'
      this.lastError = Object.freeze({ code: failure.code, message: failure.message })
      this.notify([], 'cleanup-failed')
      throw failure
    } finally {
      this.lastToolCount = 0
    }
  }
}

/**
 * Streamable HTTP adapter for the optional OAuth client-credentials flow.
 * The DSH rc.8 bridge predates MCP OAuth and only accepts static headers, so
 * this path uses the exact SDK resolved from that same Host package and gives
 * it one process-local OAuth provider. Tools and Content therefore share the
 * provider's bearer token and refresh behavior without changing stdio or
 * non-OAuth HTTP servers.
 */
export class McpOAuthClientAdapter {
  constructor(ctx, server, options = {}) {
    this.ctx = ctx
    this.server = server
    this.environment = options.environment ?? process.env
    this.loadSdk = options.loadSdk ?? (() => loadHostMcpSdk(ctx))
    this.onToolsChanged = options.onToolsChanged
    this.onOAuthEvent = options.onOAuthEvent
    this.catalogLimits = normalizeMcpCatalogLimits(options.mcpCatalogLimits)
    this.oauthSessions = options.oauthSessions ?? new McpOAuthSessionRegistry({ now: options.now })
    this.oauth = this.oauthSessions.get(server, this.environment, { onEvent: event => this.onOAuthEvent?.(event) })
    this.client = undefined
    this.transport = undefined
    this.tools = []
    this.status = 'idle'
    this.lastError = undefined
    this.closed = false
    this.startedOnce = false
    this.refreshing = undefined
    this.catalogGeneration = 0
    this.onclose = () => {
      if (this.closed) return
      this.status = 'disconnected'
      this.client = undefined
      this.transport = undefined
      this.notify('transport-closed')
    }
  }

  connectionState() {
    return Object.freeze({
      connected: this.status === 'connected'
        ? true
        : this.status === 'connecting' ? undefined : false,
      status: this.status,
      toolCount: this.tools.length,
      oauth: this.oauth.health(),
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
      reconnect: Object.freeze({ ...this.server.reconnect }),
    })
  }

  updateServer(server) {
    this.server = server
  }

  notify(reason) {
    this.onToolsChanged?.(this.tools, Object.freeze({ ...this.connectionState(), reason }))
  }

  async start() {
    if (this.closed) throw new DeepSeekEyesError('MCP OAuth adapter is closed', 'MCP_ADAPTER_CLOSED')
    if (this.client !== undefined && this.status === 'connected') return this
    this.status = 'connecting'
    try {
      // Fail before opening a network connection when the configured env refs
      // are absent; the error contains only the variable names.
      this.oauth.credentials()
      const sdk = await this.loadSdk()
      const config = materializeDshMcpConfig(this.server, this.environment)
      const client = new sdk.Client(
        { name: 'deepseekeyes-mcp-oauth', version: '0.8.2' },
        { capabilities: {} },
      )
      this.client = client
      // Streamable HTTP servers may change their tool catalog after the
      // connection is established. Register the protocol-level notification
      // before connecting so the first notification cannot race catalog
      // discovery. The SDK owns schema validation; the adapter only starts a
      // bounded refresh and reports a redacted failure through health/audit.
      if (sdk.ToolListChangedNotificationSchema !== undefined
        && typeof client.setNotificationHandler === 'function') {
        client.setNotificationHandler(sdk.ToolListChangedNotificationSchema, () => {
          void this.refresh().catch(error => {
            this.lastError = adapterErrorState(error, 'MCP_OAUTH_CATALOG_REFRESH_FAILED', 'MCP OAuth tool catalog refresh failed')
            this.oauth.recordError(error, 'catalog-refresh-error')
            this.notify('catalog-refresh-error')
          })
        })
      }
      this.transport = new sdk.StreamableHTTPClientTransport(
        new URL(config.url),
        {
          authProvider: this.oauth.provider,
          requestInit: { headers: config.headers },
        },
      )
      this.client.onclose = this.onclose
      this.transport.onerror = error => {
        this.oauth.recordError(error, 'transport-error')
        this.lastError = adapterErrorState(error, 'MCP_OAUTH_FAILED', 'MCP OAuth transport failed')
        this.notify('oauth-error')
      }
      await this.client.connect(this.transport)
      this.status = 'connected'
      this.startedOnce = true
      await this.refresh()
      this.oauth.markConnected()
      this.lastError = undefined
      this.notify('connected')
      return this
    } catch (error) {
      this.status = 'error'
      this.startedOnce = true
      this.lastError = adapterErrorState(error, 'MCP_OAUTH_CONNECT_FAILED', 'MCP OAuth connection failed')
      this.oauth.recordError(error, 'connect-error')
      this.notify('startup-failed')
      try {
        await this.client?.close?.()
      } catch {}
      this.client = undefined
      this.transport = undefined
      this.status = 'error'
      throw new DeepSeekEyesError(
        `MCP OAuth server ${this.server.id} failed: ${this.lastError.message}`,
        this.lastError.code,
        { cause: error },
      )
    }
  }

  async readTools() {
    if (this.client === undefined) throw new DeepSeekEyesError('MCP OAuth transport is not connected', 'MCP_CONNECTION_UNHEALTHY')
    const sdk = await this.loadSdk()
    const budget = new McpCatalogBudget(this.catalogLimits)
    const output = []
    let cursor
    const cursors = new Set()
    let complete = false
    for (let page = 0; page < this.catalogLimits.maxTools; page += 1) {
      const response = await this.client.request(
        { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
        sdk.ListToolsResultSchema,
        { timeout: this.server.timeoutMs },
      )
      for (const tool of response.tools) {
        const rawName = String(tool.name)
        const publicName = publicMcpToolName(this.server.id, rawName)
        const annotations = normalizeToolAnnotations(tool.annotations)
        budget.admit({
          name: publicName,
          description: tool.description ?? '',
          parameters: tool.inputSchema ?? {},
          outputSchema: tool.outputSchema ?? null,
        })
        output.push(Object.freeze({
          name: rawName,
          rawName,
          publicName,
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: tool.inputSchema ?? {},
          outputSchema: tool.outputSchema,
          annotations,
          catalogFingerprint: catalogToolFingerprint({
            rawName,
            publicName,
            description: typeof tool.description === 'string' ? tool.description : '',
            inputSchema: tool.inputSchema ?? {},
            outputSchema: tool.outputSchema,
            annotations,
          }),
        }))
      }
      const next = typeof response.nextCursor === 'string' && response.nextCursor !== ''
        ? response.nextCursor
        : undefined
      if (next === undefined) {
        complete = true
        break
      }
      if (cursors.has(next)) throw new DeepSeekEyesError('MCP OAuth tools/list repeated a cursor', 'MCP_CATALOG_CURSOR_LOOP')
      cursors.add(next)
      cursor = next
    }
    if (!complete) {
      throw new DeepSeekEyesError('MCP OAuth tools/list exceeded the page limit', 'MCP_CATALOG_PAGE_LIMIT')
    }
    const names = new Set()
    for (const tool of output) {
      if (names.has(tool.publicName)) throw new DeepSeekEyesError(`MCP OAuth server ${this.server.id} listed duplicate tool ${tool.publicName}`, 'MCP_CATALOG_DUPLICATE_TOOL')
      names.add(tool.publicName)
    }
    return output.sort((left, right) => left.publicName.localeCompare(right.publicName))
  }

  async refresh() {
    if (this.refreshing !== undefined) return this.refreshing
    this.refreshing = (async () => {
      const next = await this.readTools()
      const hadTools = this.tools.length > 0
      this.catalogGeneration += 1
      this.tools = next.map(tool => ({ ...tool, catalogGeneration: this.catalogGeneration }))
      if (this.startedOnce && hadTools && next.length === 0) this.status = 'unknown'
      else this.status = 'connected'
      this.lastError = undefined
      this.notify('tools-refreshed')
      return this.tools
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = undefined
    }
  }

  async listTools() {
    return [...this.tools]
  }

  async callTool(tool, args, exec = {}) {
    const current = this.tools.find(entry => entry.publicName === (tool.publicName ?? tool.name))
    if (this.client === undefined || this.status !== 'connected') {
      throw new DeepSeekEyesError(`MCP OAuth server ${this.server.id} is not connected`, 'MCP_CONNECTION_UNHEALTHY')
    }
    const sameCatalogTool = current !== undefined && (
      (typeof tool.catalogFingerprint === 'string' && tool.catalogFingerprint === current.catalogFingerprint)
      || (tool.catalogFingerprint === undefined && tool.catalogGeneration === current.catalogGeneration)
    )
    if (!sameCatalogTool) {
      const error = new DeepSeekEyesError(`MCP OAuth tool ${tool.publicName ?? tool.name} is no longer available`, 'MCP_TOOL_UNAVAILABLE')
      error.beforeTransport = true
      throw error
    }
    const sdk = await this.loadSdk()
    // Loading the Host SDK yields to catalog notifications. Re-resolve the
    // identity after that boundary so a concurrent refresh cannot dispatch an
    // old definition through the new OAuth transport generation.
    const latest = this.tools.find(entry => entry.publicName === (tool.publicName ?? tool.name))
    const latestMatches = latest !== undefined && (
      (typeof tool.catalogFingerprint === 'string' && tool.catalogFingerprint === latest.catalogFingerprint)
      || (tool.catalogFingerprint === undefined && tool.catalogGeneration === latest.catalogGeneration)
    )
    if (this.client === undefined || this.status !== 'connected' || !latestMatches) {
      const error = new DeepSeekEyesError(`MCP OAuth tool ${tool.publicName ?? tool.name} is no longer available`, 'MCP_TOOL_UNAVAILABLE')
      error.beforeTransport = true
      throw error
    }
    try {
      return await this.client.request(
        {
          method: 'tools/call',
          params: { name: tool.rawName ?? tool.name, arguments: args ?? {} },
        },
        sdk.CallToolResultSchema,
        { signal: exec.signal, timeout: this.server.timeoutMs },
      )
    } catch (error) {
      this.lastError = adapterErrorState(error, 'MCP_OAUTH_TOOL_CALL_FAILED', 'MCP OAuth tool call failed')
      this.oauth.recordError(error, 'tool-error')
      this.notify('oauth-tool-error')
      throw error
    }
  }

  async probe() {
    const probe = new McpOAuthClientAdapter(this.ctx, this.server, {
      environment: this.environment,
      loadSdk: this.loadSdk,
      mcpCatalogLimits: this.catalogLimits,
      oauthSessions: this.oauthSessions,
      onOAuthEvent: this.onOAuthEvent,
    })
    try {
      await probe.start()
      return await probe.listTools()
    } finally {
      await probe.close()
    }
  }

  reconcileProbe(tools) {
    if (this.status !== 'unknown') return this.connectionState()
    const current = this.tools.map(tool => tool.rawName).sort()
    const live = tools.map(tool => tool.rawName ?? tool.name).sort()
    if (current.length === live.length && current.every((name, index) => name === live[index])) {
      this.status = 'connected'
      this.lastError = undefined
    } else {
      this.status = 'disconnected'
      this.lastError = adapterErrorState(
        new DeepSeekEyesError(`MCP OAuth server ${this.server.id} catalog changed during probe`, 'MCP_CONNECTION_UNHEALTHY'),
        'MCP_CONNECTION_UNHEALTHY',
        'MCP OAuth connection is unhealthy',
      )
    }
    this.notify('probe-reconciled')
    return this.connectionState()
  }

  async close() {
    this.closed = true
    const client = this.client
    this.client = undefined
    this.transport = undefined
    this.tools = []
    this.status = 'closed'
    try {
      await client?.close?.()
    } catch (error) {
      this.status = 'cleanup-failed'
      this.lastError = adapterErrorState(error, 'MCP_ADAPTER_CLOSE_FAILED', 'MCP OAuth transport cleanup failed')
      this.notify('cleanup-failed')
      throw new DeepSeekEyesError(this.lastError.message, this.lastError.code, { cause: error })
    }
    this.notify('closed')
  }
}

export function createDshMcpClientAdapterFactory(ctx, options = {}) {
  return {
    create(server, hooks = {}) {
      if (isMcpOAuthEnabled(server)) {
        return new McpOAuthClientAdapter(ctx, server, { ...options, ...hooks })
      }
      return new DshMcpClientAdapter(ctx, server, { ...options, ...hooks })
    },
  }
}

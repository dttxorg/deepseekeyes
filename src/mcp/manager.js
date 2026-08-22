import { randomUUID } from 'node:crypto'
import { MCP_CONTEXT_PREFIX, pluginUserMessage } from '../content.js'
import { DeepSeekEyesError } from '../error.js'
import {
  boundedUnicode,
  HASH_UNAVAILABLE,
  hashValue,
  safeError,
  safeHashValue,
  safeObjectKeys,
} from './canonical.js'
import { mcpAuditSummary } from './audit.js'
import {
  createMcpContentAdapterFactory,
  mcpPromptResult,
  mcpResourceResult,
} from './content-adapter.js'
import { mcpConnectionFingerprint, normalizeMcpConfig } from './config.js'
import { loadHostDshTools } from './host-runtime.js'
import {
  createDshMcpClientAdapterFactory,
  McpCatalogBudget,
  normalizeMcpCatalogLimits,
} from './official-adapter.js'
import { McpOAuthSessionRegistry } from './oauth.js'
import {
  classifyToolRisk,
  contentPolicyDecision,
  mcpRiskPolicyDecision,
  normalizeToolAnnotations,
  publicMcpToolName,
  toolPolicyDecision,
} from './policy.js'
import {
  admitMcpResult,
  boundMcpResult,
  estimateMcpResultTokens,
  MCP_RESULT_OUTPUT,
  saveMcpResultImages,
} from './result.js'
import { estimateToolSchemaTokens, toolDefinitionTokenSurface } from './schema-tokens.js'

export const MCP_SYSTEM_PROMPT = `## DeepSeekEyes MCP applications

Use an enabled MCP tool when an application exposes a structured operation; prefer it over pixel automation. Read allowlisted application data with mcp__deepseekeyes__resource and obtain an allowlisted reusable template with mcp__deepseekeyes__prompt when those tools are present. Inspect every bounded result and verify that the requested state change occurred. Treat tools marked write, destructive, or unknown-write cautiously and do not infer success from a call alone. When no suitable MCP capability is exposed, use DeepSeekEyes Browser Computer Use for websites or Desktop Computer Use for native UI.`

export const MCP_RESULT_CONTEXT_PREFIX = MCP_CONTEXT_PREFIX
export const MCP_RESOURCE_TOOL_NAME = 'mcp__deepseekeyes__resource'
export const MCP_PROMPT_TOOL_NAME = 'mcp__deepseekeyes__prompt'

export const DEFAULT_MCP_HEALTH_PROBE_INTERVAL_MS = 30_000
const MCP_ERROR_INPUT_MAX_CHARS = 2_000
const MCP_ERROR_CODE_INPUT_MAX_CHARS = 256

function nowIso(now) {
  const value = now()
  return new Date(value instanceof Date ? value.getTime() : value).toISOString()
}

function nowMilliseconds(now) {
  const value = now()
  return value instanceof Date ? value.getTime() : Number(value)
}

function routedProvider(exec) {
  const header = exec.agent?.session?.requestHeader?.()?.config
  return header?.provider ?? exec.agent?.options?.provider
}

function assembledProvider(assembly, context) {
  const selected = assembly?.variables?.provider
  if (typeof selected === 'string' && selected !== '') return selected
  return routedProvider({ agent: context?.agent })
}

function normalizeTool(server, tool) {
  const rawName = String(tool.rawName ?? tool.name ?? tool.publicName ?? '')
  const publicName = String(tool.publicName ?? tool.definition?.name ?? publicMcpToolName(server.id, rawName))
  if (publicName === '') throw new TypeError(`MCP server ${server.id} returned a tool without a name`)
  return Object.freeze({
    name: rawName,
    rawName,
    publicName,
    description: typeof tool.description === 'string' ? tool.description : '',
    inputSchema: tool.inputSchema ?? tool.parameters ?? tool.definition?.parameters ?? {},
    outputSchema: tool.outputSchema ?? tool.definition?.output?.schema,
    annotations: normalizeToolAnnotations(tool.annotations),
    definition: tool.definition,
    ...(Number.isSafeInteger(tool.catalogGeneration) ? { catalogGeneration: tool.catalogGeneration } : {}),
    ...(typeof tool.catalogFingerprint === 'string' ? { catalogFingerprint: tool.catalogFingerprint } : {}),
  })
}

function adapterCreate(factory, server, hooks) {
  if (typeof factory === 'function') return factory(server, hooks)
  if (typeof factory?.create === 'function') return factory.create(server, hooks)
  throw new TypeError('deepseekeyes: MCP adapterFactory must be a function or expose create()')
}

function boundedSafeError(error, maximum = 500) {
  let raw
  try {
    const message = error?.message
    raw = typeof message === 'string' ? message : String(error)
  } catch {
    raw = 'unknown error'
  }
  // Bound hostile transport text before any multi-pass credential regex runs.
  return safeError(boundedUnicode(raw, MCP_ERROR_INPUT_MAX_CHARS).text, maximum)
}

function boundedSafeErrorCode(error, fallback, maximum = 100) {
  let raw
  try {
    raw = error?.code
  } catch {
    return fallback
  }
  if (typeof raw !== 'string') return fallback
  const bounded = boundedUnicode(raw, MCP_ERROR_CODE_INPUT_MAX_CHARS).text
  if (bounded.trim() === '') return fallback
  const code = safeError(bounded, maximum)
  return code === '' ? fallback : code
}

function isBeforeTransportError(error) {
  try {
    return error?.beforeTransport === true
  } catch {
    return false
  }
}

function publicCallInput(args) {
  try {
    const input = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {}
    const argsSha256 = safeHashValue(input)
    return {
      keys: argsSha256 === HASH_UNAVAILABLE ? [] : safeObjectKeys(input),
      argsSha256,
    }
  } catch {
    return { keys: [], argsSha256: HASH_UNAVAILABLE }
  }
}

function managedMcpError(error, publicName, fallbackCode) {
  // `error` is transport-controlled: even instanceof, message, code and String()
  // may throw through a Proxy or accessor. The canonical readers contain each
  // property operation, redact and bound the result before this error enters
  // ToolRuntime or the persistent audit path.
  const message = boundedSafeError(error) || 'MCP operation failed'
  const upstreamCode = boundedSafeErrorCode(error, '')
  const admissionCodes = new Set([
    'TOO_MANY_IMAGES',
    'IMAGES_TOO_LARGE',
    'IMAGE_TOO_LARGE',
    'UNSUPPORTED_IMAGE_TYPE',
    'INVALID_IMAGE_BASE64',
  ])
  const code = admissionCodes.has(upstreamCode) || upstreamCode.startsWith('MCP_RESULT_')
    ? upstreamCode
    : fallbackCode
  return new DeepSeekEyesError(`MCP tool ${publicName} failed: ${message}`, code)
}

function genericToolOutput() {
  return {
    ...MCP_RESULT_OUTPUT,
    // Ensure each definition owns its renderer object. Some registries attach
    // validation caches to output definitions.
    schema: structuredClone(MCP_RESULT_OUTPUT.schema),
  }
}

function managedMcpContext(publicName, { result, errorCode } = {}) {
  const imageCount = result?.images?.length ?? 0
  const status = result === undefined ? 'error' : 'success'
  return pluginUserMessage([
    {
      type: 'text',
      text: `${MCP_RESULT_CONTEXT_PREFIX}${JSON.stringify({
        schemaVersion: 'deepseekeyes.mcp-context.v1',
        tool: publicName,
        status,
        ...(result === undefined
          ? {
              errorCode,
              errorSha256: safeHashValue({ tool: publicName, status, errorCode }),
            }
          : { resultSha256: result.sha256 }),
        imageCount,
      })}`,
    },
    ...(result?.images ?? []).map(attachment => ({ type: 'image', attachment })),
  ], `MCP ${publicName} ${status} context${imageCount === 0 ? '' : ` with ${imageCount} image(s)`}.`, 'mcp-context')
}

async function renderFilteredToolsSdk(ctx, scope, hiddenNames, loadDshTools) {
  const schemas = ctx.tools.sdkSchemas(scope).filter(schema => !hiddenNames.has(schema.name))
  const runtime = typeof ctx.get === 'function' ? ctx.get('codeRuntime') : ctx.codeRuntime
  const tools = await loadDshTools(ctx)
  if (runtime?.language === 'typescript') return tools.renderToolsSdk(schemas)
  if (runtime?.language === 'python') return tools.renderToolsSdkPy(schemas)
  throw new DeepSeekEyesError(
    `MCP provider isolation cannot render Code Mode language ${runtime?.language ?? 'unknown'}`,
    'MCP_CODE_MODE_ISOLATION_FAILED',
  )
}

function uriTemplateExpression(template) {
  const escaped = String(template).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\\\{[^}]+\\\}/g, '.*')}$`)
}

function resourceCatalogEntry(runtime, uri) {
  const direct = runtime.contentCatalog.resources.find(entry => entry.uri === uri)
  if (direct !== undefined) return direct
  return runtime.contentCatalog.resourceTemplates.find(entry => {
    try {
      return uriTemplateExpression(entry.uriTemplate).test(uri)
    } catch {
      return false
    }
  })
}

function contentAuditTool(publicName, rawName) {
  return Object.freeze({
    rawName,
    publicName,
    annotations: Object.freeze({ readOnlyHint: true }),
  })
}

export class McpManager {
  constructor(ctx, config = {}, options = {}) {
    this.ctx = ctx
    this.config = normalizeMcpConfig(config, options)
    this.oauthSessions = options.oauthSessions ?? new McpOAuthSessionRegistry({ now: options.now })
    const adapterOptions = { ...options, oauthSessions: this.oauthSessions }
    this.adapterFactory = options.adapterFactory ?? createDshMcpClientAdapterFactory(ctx, adapterOptions)
    this.contentAdapterFactory = options.contentAdapterFactory ?? createMcpContentAdapterFactory(ctx, adapterOptions)
    this.loadDshTools = options.loadDshTools ?? loadHostDshTools
    this.logger = options.logger ?? ctx.logger ?? console
    this.now = options.now ?? Date.now
    this.authorize = options.authorize
    this.onAudit = options.onAudit
    this.usageTracker = options.usageTracker
    this.catalogLimits = normalizeMcpCatalogLimits(options.mcpCatalogLimits)
    this.healthProbeIntervalMs = options.healthProbeIntervalMs ?? DEFAULT_MCP_HEALTH_PROBE_INTERVAL_MS
    if (!Number.isSafeInteger(this.healthProbeIntervalMs) || this.healthProbeIntervalMs < 0) {
      throw new RangeError('deepseekeyes: healthProbeIntervalMs must be a non-negative safe integer')
    }
    this.runtimes = new Map()
    this.cleanupFailures = new Map()
    this.contentCleanupFailures = new Map()
    this.exposed = new Map()
    this.contentExposed = new Map()
    this.audit = []
    this.started = false
    this.exposureSuspended = false
    this.updatedAt = nowIso(this.now)
    this.queue = Promise.resolve()
    this.disposePrompt = undefined
    this.disposeAssemblyFilter = undefined
    this.healthInFlight = undefined
    this.externalCallsByCodeRun = new Map()
  }

  enqueue(work) {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => {})
    return run
  }

  async start() {
    return this.enqueue(async () => {
      if (this.started) return this.snapshot()
      this.exposureSuspended = false
      this.started = true
      if (this.config.mcpEnabled) {
        await Promise.all(this.config.mcpServers.filter(server => server.enabled).map(async server => {
          if (!await this.retryServerCleanup(server.id)) return
          await this.connect(server)
        }))
      }
      this.syncExposure()
      return this.snapshot()
    })
  }

  async createAdapter(server, hooks) {
    return adapterCreate(this.adapterFactory, server, hooks)
  }

  async createContentAdapter(server, hooks) {
    return adapterCreate(this.contentAdapterFactory, server, hooks)
  }

  runtimeFailure(runtime, error, fallbackCode = 'MCP_CONNECT_FAILED') {
    runtime.status = 'error'
    runtime.healthy = false
    runtime.tools = new Map()
    runtime.lastCheckedAt = nowIso(this.now)
    runtime.lastProbeAtMs = nowMilliseconds(this.now)
    runtime.toolsLastCheckedAt = runtime.lastCheckedAt
    runtime.toolsLastProbeAtMs = runtime.lastProbeAtMs
    runtime.lastError = {
      code: boundedSafeErrorCode(error, fallbackCode),
      message: boundedSafeError(error),
    }
    this.touch()
    return runtime.lastError
  }

  recordCleanupFailure(server, adapter, phase, error) {
    const lastError = {
      code: boundedSafeErrorCode(error, 'MCP_ADAPTER_CLOSE_FAILED'),
      message: boundedSafeError(error),
    }
    this.cleanupFailures.set(server.id, {
      server,
      adapter,
      phase,
      at: nowIso(this.now),
      lastError,
    })
    this.logger.warn?.(`deepseekeyes: MCP server ${server.id} ${phase} cleanup failed: ${lastError.message}`)
    this.touch()
    return lastError
  }

  recordContentCleanupFailure(server, adapter, phase, error) {
    const lastError = {
      code: boundedSafeErrorCode(error, 'MCP_CONTENT_CLOSE_FAILED'),
      message: boundedSafeError(error),
    }
    this.contentCleanupFailures.set(server.id, {
      server,
      adapter,
      phase,
      at: nowIso(this.now),
      lastError,
    })
    this.logger.warn?.(`deepseekeyes: MCP Content server ${server.id} ${phase} cleanup failed: ${lastError.message}`)
    this.touch()
    return lastError
  }

  async retryCleanup(serverId) {
    const failure = this.cleanupFailures.get(serverId)
    if (failure === undefined) return true
    try {
      await failure.adapter?.close?.()
      if (this.cleanupFailures.get(serverId) === failure) this.cleanupFailures.delete(serverId)
      this.touch()
      return true
    } catch (error) {
      this.recordCleanupFailure(failure.server, failure.adapter, 'retry', error)
      return false
    }
  }

  async retryContentCleanup(serverId) {
    const failure = this.contentCleanupFailures.get(serverId)
    if (failure === undefined) return true
    try {
      await failure.adapter?.close?.()
      if (this.contentCleanupFailures.get(serverId) === failure) this.contentCleanupFailures.delete(serverId)
      this.touch()
      return true
    } catch (error) {
      this.recordContentCleanupFailure(failure.server, failure.adapter, 'retry', error)
      return false
    }
  }

  async retryServerCleanup(serverId) {
    const toolsClean = await this.retryCleanup(serverId)
    const contentClean = await this.retryContentCleanup(serverId)
    return toolsClean && contentClean
  }

  async connect(server) {
    const runtime = {
      server,
      status: server.toolsEnabled ? 'connecting' : 'disabled',
      healthy: false,
      tools: new Map(),
      schemaTokensEstimated: new Map(),
      contentStatus: server.resourcesEnabled || server.promptsEnabled ? 'connecting' : 'disabled',
      contentHealthy: false,
      contentCatalog: Object.freeze({ resources: [], resourceTemplates: [], prompts: [] }),
      startedAt: nowIso(this.now),
      lastCheckedAt: nowIso(this.now),
    }
    this.runtimes.set(server.id, runtime)
    this.touch()
    if (server.toolsEnabled) {
      try {
        const adapter = await this.createAdapter(server, {
          onOAuthEvent: event => this.recordOAuthAudit(server, event),
          onProbeCleanupFailure: (cleanupAdapter, error) => {
            this.recordCleanupFailure(server, cleanupAdapter, 'probe', error)
            const current = this.runtimes.get(server.id)
            if (current !== runtime) return
            runtime.status = 'degraded'
            runtime.healthy = false
            runtime.lastCheckedAt = nowIso(this.now)
            runtime.lastProbeAtMs = nowMilliseconds(this.now)
            runtime.toolsLastCheckedAt = runtime.lastCheckedAt
            runtime.toolsLastProbeAtMs = runtime.lastProbeAtMs
            runtime.lastError = {
              code: boundedSafeErrorCode(error, 'MCP_ADAPTER_CLOSE_FAILED'),
              message: boundedSafeError(error),
            }
            this.syncExposure()
          },
          onToolsChanged: (tools, connection = {}) => {
            void this.enqueue(async () => {
              const current = this.runtimes.get(server.id)
              if (current !== runtime) return
              try {
                this.setRuntimeTools(runtime, tools)
              } catch (error) {
                const failure = this.runtimeFailure(runtime, error, 'MCP_CATALOG_REJECTED')
                this.logger.warn?.(`deepseekeyes: MCP server ${server.id} catalog rejected: ${failure.message}`)
                this.syncExposure()
                return
              }
              const connected = connection.connected === true
              if (connection.oauth !== undefined) runtime.oauth = connection.oauth
              const explicitFailure = connection.connected === false
                || connection.status === 'catalog-rejected'
                || connection.status === 'cleanup-failed'
                || connection.status === 'disconnected'
              runtime.status = connected
                ? 'connected'
                : explicitFailure && connection.status === 'catalog-rejected' ? 'error'
                  : runtime.status === 'error' && connection.reason === 'closed' ? 'error' : 'degraded'
              runtime.healthy = connected
              runtime.lastCheckedAt = nowIso(this.now)
              runtime.toolsLastCheckedAt = runtime.lastCheckedAt
              if (connected) {
                runtime.lastProbeAtMs = nowMilliseconds(this.now)
                runtime.toolsLastProbeAtMs = runtime.lastProbeAtMs
                runtime.lastConnectedAt = runtime.lastCheckedAt
                runtime.lastError = undefined
              } else if (connection.reason !== 'closed') {
                runtime.lastProbeAtMs = undefined
                runtime.toolsLastProbeAtMs = undefined
                runtime.lastError = connection.error === undefined
                  ? {
                      code: 'MCP_CONNECTION_UNHEALTHY',
                      message: connection.status === 'unknown'
                        ? 'The empty MCP tool generation requires a live probe before it is considered healthy.'
                        : 'The MCP transport is not connected.',
                    }
                  : {
                      code: boundedSafeErrorCode(connection.error, 'MCP_CONNECTION_UNHEALTHY'),
                      message: boundedSafeError(connection.error),
                    }
              }
              this.syncExposure()
            })
          },
        })
        runtime.adapter = adapter
        await adapter.start?.()
        this.setRuntimeTools(runtime, await adapter.listTools())
        const connection = adapter.connectionState?.()
        if (connection?.connected === false) {
          throw new DeepSeekEyesError(
            `MCP server ${server.id} did not establish a live transport`,
            'MCP_CONNECT_FAILED',
          )
        }
        runtime.status = 'connected'
        runtime.healthy = true
        runtime.lastConnectedAt = nowIso(this.now)
        runtime.lastCheckedAt = runtime.lastConnectedAt
        runtime.lastProbeAtMs = nowMilliseconds(this.now)
        runtime.toolsLastCheckedAt = runtime.lastCheckedAt
        runtime.toolsLastProbeAtMs = runtime.lastProbeAtMs
        runtime.lastError = undefined
        if (connection?.oauth !== undefined) runtime.oauth = connection.oauth
      } catch (error) {
        this.runtimeFailure(runtime, error)
        this.logger.warn?.(`deepseekeyes: MCP Tools server ${server.id} failed: ${runtime.lastError.message}`)
        await runtime.adapter?.close?.().catch(closeError => {
          this.recordCleanupFailure(server, runtime.adapter, 'failed-connect', closeError)
        })
      }
    }
    if (server.resourcesEnabled || server.promptsEnabled) {
      try {
        const contentAdapter = await this.createContentAdapter(server, {
          onOAuthEvent: event => this.recordOAuthAudit(server, event),
          onChanged: (catalog, state = {}) => {
            void this.enqueue(async () => {
              if (this.runtimes.get(server.id) !== runtime) return
              runtime.contentCatalog = catalog
              runtime.contentStatus = state.status ?? runtime.contentStatus
              runtime.contentHealthy = state.connected === true
              runtime.contentLastError = state.error
              if (state.oauth !== undefined) runtime.oauth = state.oauth
              runtime.contentLastCheckedAt = nowIso(this.now)
              if (state.connected === true) {
                runtime.contentLastProbeAtMs = nowMilliseconds(this.now)
                runtime.contentLastConnectedAt = runtime.contentLastCheckedAt
              }
              this.syncExposure()
            })
          },
        })
        runtime.contentAdapter = contentAdapter
        await contentAdapter.start()
        runtime.contentCatalog = contentAdapter.catalog()
        runtime.contentStatus = 'connected'
        runtime.contentHealthy = true
        runtime.contentLastError = undefined
        if (contentAdapter.state?.().oauth !== undefined) runtime.oauth = contentAdapter.state().oauth
        runtime.contentLastConnectedAt = nowIso(this.now)
        runtime.contentLastCheckedAt = runtime.contentLastConnectedAt
        runtime.contentLastProbeAtMs = nowMilliseconds(this.now)
      } catch (error) {
        const lastError = {
          code: boundedSafeErrorCode(error, 'MCP_CONTENT_CONNECT_FAILED'),
          message: boundedSafeError(error),
        }
        this.logger.warn?.(`deepseekeyes: MCP Content server ${server.id} failed: ${lastError.message}`)
        await runtime.contentAdapter?.close?.().catch(closeError => {
          this.recordContentCleanupFailure(server, runtime.contentAdapter, 'failed-connect', closeError)
        })
        runtime.contentStatus = 'error'
        runtime.contentHealthy = false
        runtime.contentLastError = lastError
        runtime.contentLastCheckedAt = nowIso(this.now)
        runtime.contentLastProbeAtMs = nowMilliseconds(this.now)
      }
    }
    this.touch()
    this.syncExposure()
    return runtime
  }

  setRuntimeTools(runtime, tools) {
    if (!Array.isArray(tools)) throw new TypeError(`MCP server ${runtime.server.id} listTools() must return an array`)
    const budget = new McpCatalogBudget(this.catalogLimits)
    const normalized = new Map()
    for (const entry of tools) {
      const tool = normalizeTool(runtime.server, entry)
      budget.admit({
        name: tool.publicName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema ?? null,
      })
      if (normalized.has(tool.publicName)) {
        throw new DeepSeekEyesError(
          `MCP server ${runtime.server.id} listed duplicate tool ${tool.publicName}`,
          'MCP_CATALOG_DUPLICATE_TOOL',
        )
      }
      normalized.set(tool.publicName, tool)
    }
    runtime.tools = normalized
    this.touch()
  }

  assertRoute(exec) {
    if (exec?.agent === undefined) {
      throw new DeepSeekEyesError(
        'MCP application tools require a DeepSeekEyes agent scope; agentless execution is denied',
        'MCP_REQUIRES_DEEPSEEKEYES',
      )
    }
    const provider = routedProvider(exec)
    const expected = this.config.providerId ?? 'deepseekeyes'
    if (provider !== expected) {
      throw new DeepSeekEyesError(
        `MCP application tools require the ${expected} virtual provider; active provider is ${provider ?? 'unknown'}`,
        'MCP_REQUIRES_DEEPSEEKEYES',
      )
    }
  }

  exposureCandidates() {
    if (this.exposureSuspended) return []
    const output = []
    let usedTools = 0
    let usedTokens = 0
    const seen = new Set()
    for (const server of this.config.mcpServers) {
      const runtime = this.runtimes.get(server.id)
      if (!this.config.mcpEnabled || !server.enabled || !server.toolsEnabled || runtime?.status !== 'connected') continue
      for (const tool of [...runtime.tools.values()].sort((left, right) => left.publicName.localeCompare(right.publicName))) {
        const candidate = this.createManagedCandidate(server, runtime, tool)
        runtime.schemaTokensEstimated.set(tool.publicName, candidate.schemaTokensEstimated)
        const policy = toolPolicyDecision(server, tool)
        if (!policy.allowed) continue
        const riskPolicy = mcpRiskPolicyDecision(server, classifyToolRisk(tool.annotations))
        if (!riskPolicy.allowed) {
          runtime.blocked ??= new Map()
          runtime.blocked.set(tool.publicName, `risk-policy-${riskPolicy.reason}`)
          continue
        }
        let blockedReason
        if (seen.has(tool.publicName)) blockedReason = 'duplicate-public-name'
        else if (this.config.mcpMaxTools !== 0 && usedTools >= this.config.mcpMaxTools) blockedReason = 'max-tools'
        else if (
          this.config.mcpMaxSchemaTokens !== 0
          && usedTokens + candidate.schemaTokensEstimated > this.config.mcpMaxSchemaTokens
        ) blockedReason = 'schema-token-budget'
        if (blockedReason === undefined) {
          usedTools += 1
          usedTokens += candidate.schemaTokensEstimated
          seen.add(tool.publicName)
          output.push(candidate)
        } else {
          runtime.blocked ??= new Map()
          runtime.blocked.set(tool.publicName, blockedReason)
        }
      }
    }
    return output
  }

  syncExposure() {
    for (const runtime of this.runtimes.values()) {
      runtime.blocked = new Map()
      runtime.schemaTokensEstimated = new Map()
    }
    const candidates = this.exposureCandidates()
    const next = new Map(candidates.map(candidate => {
      const fingerprint = hashValue({
        schema: toolDefinitionTokenSurface(candidate.definition),
        timeoutMs: candidate.definition.timeoutMs,
      })
      return [candidate.tool.publicName, { ...candidate, fingerprint }]
    }))
    for (const [name, current] of this.exposed) {
      if (next.get(name)?.fingerprint === current.fingerprint) {
        next.get(name).dispose = current.dispose
        continue
      }
      current.dispose?.()
      this.exposed.delete(name)
    }
    for (const [name, candidate] of next) {
      if (candidate.dispose !== undefined) continue
      try {
        candidate.dispose = this.ctx.tools.register(candidate.definition)
      } catch (error) {
        candidate.runtime.blocked.set(name, 'registry-conflict')
        this.logger.warn?.(`deepseekeyes: MCP tool ${name} registration failed: ${boundedSafeError(error)}`)
        next.delete(name)
      }
    }
    this.exposed = next
    this.syncContentExposure()
    this.syncPrompt()
    this.touch()
  }

  contentAvailability() {
    const resources = []
    const prompts = []
    for (const server of this.config.mcpServers) {
      const runtime = this.runtimes.get(server.id)
      if (!this.config.mcpEnabled || !server.enabled || runtime?.contentStatus !== 'connected') continue
      if (server.resourcesEnabled) {
        for (const resource of runtime.contentCatalog.resources) {
          if (contentPolicyDecision(server, 'resource', resource.uri).allowed) {
            resources.push({ server, runtime, resource, template: false })
          }
        }
        for (const resource of runtime.contentCatalog.resourceTemplates) {
          if (contentPolicyDecision(server, 'resource', resource.uriTemplate).allowed) {
            resources.push({ server, runtime, resource, template: true })
          }
        }
      }
      if (server.promptsEnabled) {
        for (const prompt of runtime.contentCatalog.prompts) {
          if (contentPolicyDecision(server, 'prompt', prompt.name).allowed) {
            prompts.push({ server, runtime, prompt })
          }
        }
      }
    }
    return { resources, prompts }
  }

  createContentDefinition(kind) {
    if (kind === 'resource') {
      return {
        name: MCP_RESOURCE_TOOL_NAME,
        description: 'Read one explicitly allowlisted MCP Resource by server ID and URI. The result is bounded, audited, and image content is delivered through DeepSeekEyes attachments.',
        parameters: {
          type: 'object',
          properties: {
            serverId: { type: 'string', description: 'Configured MCP Server ID.' },
            uri: { type: 'string', description: 'Exact resource URI discovered in the MCP catalog, or a URI matching an allowlisted template.' },
          },
          required: ['serverId', 'uri'],
          additionalProperties: false,
        },
        output: genericToolOutput(),
        timeoutMs: this.config.mcpToolCallTimeoutMs + 15_000,
        execute: (args, exec) => this.executeContent('resource', args, exec),
        presentCall: args => ({
          card: 'generic',
          title: `MCP Resource · ${String(args?.serverId ?? '')}`,
          kind: 'read',
          rawInput: publicCallInput(args),
        }),
      }
    }
    return {
      name: MCP_PROMPT_TOOL_NAME,
      description: 'Get one explicitly allowlisted MCP Prompt by server ID and name. Pass only arguments declared by the discovered prompt catalog.',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: 'Configured MCP Server ID.' },
          name: { type: 'string', description: 'Exact allowlisted prompt name from the MCP catalog.' },
          arguments: { type: 'object', description: 'Prompt arguments keyed by argument name.', additionalProperties: { type: 'string' } },
        },
        required: ['serverId', 'name'],
        additionalProperties: false,
      },
      output: genericToolOutput(),
      timeoutMs: this.config.mcpToolCallTimeoutMs + 15_000,
      execute: (args, exec) => this.executeContent('prompt', args, exec),
      presentCall: args => ({
        card: 'generic',
        title: `MCP Prompt · ${String(args?.serverId ?? '')}`,
        kind: 'read',
        rawInput: publicCallInput(args),
      }),
    }
  }

  syncContentExposure() {
    const availability = this.exposureSuspended
      ? { resources: [], prompts: [] }
      : this.contentAvailability()
    const candidates = []
    if (availability.resources.length > 0) candidates.push(this.createContentDefinition('resource'))
    if (availability.prompts.length > 0) candidates.push(this.createContentDefinition('prompt'))

    let usedTools = this.exposed.size
    let usedTokens = [...this.exposed.values()].reduce(
      (total, candidate) => total + candidate.schemaTokensEstimated,
      0,
    )
    const next = new Map()
    for (const definition of candidates) {
      const schemaTokensEstimated = estimateToolSchemaTokens(definition)
      if (this.config.mcpMaxTools !== 0 && usedTools >= this.config.mcpMaxTools) continue
      if (this.config.mcpMaxSchemaTokens !== 0
        && usedTokens + schemaTokensEstimated > this.config.mcpMaxSchemaTokens) continue
      usedTools += 1
      usedTokens += schemaTokensEstimated
      const fingerprint = hashValue({
        schema: toolDefinitionTokenSurface(definition),
        timeoutMs: definition.timeoutMs,
      })
      next.set(definition.name, { definition, schemaTokensEstimated, fingerprint })
    }
    for (const [name, current] of this.contentExposed) {
      if (next.get(name)?.fingerprint === current.fingerprint) {
        next.get(name).dispose = current.dispose
        continue
      }
      current.dispose?.()
    }
    for (const [name, candidate] of next) {
      if (candidate.dispose !== undefined) continue
      try {
        candidate.dispose = this.ctx.tools.register(candidate.definition)
      } catch (error) {
        this.logger.warn?.(`deepseekeyes: MCP content tool ${name} registration failed: ${boundedSafeError(error)}`)
        next.delete(name)
      }
    }
    this.contentExposed = next
  }

  createManagedCandidate(server, runtime, tool) {
    const candidate = { server, runtime, tool }
    const definition = this.createManagedDefinition(candidate)
    return {
      ...candidate,
      definition,
      schemaTokensEstimated: estimateToolSchemaTokens(definition),
    }
  }

  createManagedDefinition(candidate) {
    const { server, tool } = candidate
    const risk = classifyToolRisk(tool.annotations)
    return {
      name: tool.publicName,
      description: `${tool.description}${tool.description ? '\n\n' : ''}[DeepSeekEyes MCP: ${server.name}; risk=${risk.risk}; bounded result]`,
      parameters: tool.inputSchema,
      output: genericToolOutput(),
      timeoutMs: server.timeoutMs + 15_000,
      execute: (args, exec) => this.executeManaged(server.id, tool.publicName, args, exec),
      presentCall(args) {
        return {
          card: 'generic',
          title: `${server.name} · ${tool.rawName}`,
          kind: risk.risk === 'read' ? 'read' : 'edit',
          rawInput: publicCallInput(args),
        }
      },
    }
  }

  async consumeCodeRunExternalCall(exec, publicName, rejectBeforeCall) {
    const maximum = this.config.mcpMaxExternalCallsPerRun
    if (maximum === 0 || exec.parent === undefined) return false
    const parent = exec.parent
    if (!this.externalCallsByCodeRun.has(parent)) {
      this.externalCallsByCodeRun.set(parent, 0)
      exec.signal?.addEventListener?.('abort', () => {
        this.externalCallsByCodeRun.delete(parent)
      }, { once: true })
    }
    const used = this.externalCallsByCodeRun.get(parent) ?? 0
    if (used >= maximum) {
      const sessionId = exec.agent?.id ?? exec.agent?.session?.id
      try {
        await this.usageTracker?.recordMcpLimitStop?.(sessionId)
      } catch (error) {
        this.logger.warn?.(`deepseekeyes: MCP limit accounting failed: ${boundedSafeError(error)}`)
      }
      rejectBeforeCall(
        `MCP Code Mode run reached the configured ${maximum} external calls before ${publicName}; increase mcpMaxExternalCallsPerRun or set it to 0 for unlimited`,
        'MCP_EXTERNAL_CALL_LIMIT_REACHED',
      )
    }
    this.externalCallsByCodeRun.set(parent, used + 1)
    return true
  }

  releaseCodeRunExternalCall(exec) {
    const parent = exec.parent
    if (parent === undefined) return
    const used = this.externalCallsByCodeRun.get(parent)
    if (used === undefined) return
    if (used <= 1) this.externalCallsByCodeRun.delete(parent)
    else this.externalCallsByCodeRun.set(parent, used - 1)
  }

  async executeManaged(serverId, publicName, args, exec = {}) {
    this.assertRoute(exec)
    if (exec.parent !== undefined && typeof exec.deferContext !== 'function') {
      throw new DeepSeekEyesError(
        `MCP Code Mode result ${publicName} cannot be delivered without the Host context channel`,
        'MCP_RESULT_CONTEXT_UNAVAILABLE',
      )
    }
    let contextDeferred = false
    const deferContext = value => {
      if (exec.parent === undefined || contextDeferred) return
      contextDeferred = true
      exec.deferContext(managedMcpContext(publicName, value))
    }
    const rejectBeforeCall = (message, code) => {
      const error = new DeepSeekEyesError(message, code)
      deferContext({ errorCode: code })
      throw error
    }
    // Resolve the live runtime immediately before every asynchronous boundary.
    // Settings/reconnect work revokes schemas synchronously, but an invocation
    // that already entered this function can otherwise resume with a stale
    // server/tool pair after an await and reach the external transport.
    const resolveCurrentCall = () => {
      const liveRuntime = this.runtimes.get(serverId)
      const liveServer = liveRuntime?.server
      const liveTool = liveRuntime?.tools.get(publicName)
      if (
        !this.config.mcpEnabled
        || !liveServer?.enabled
        || liveRuntime?.status !== 'connected'
        || liveTool === undefined
      ) {
        rejectBeforeCall(`MCP tool ${publicName} is not currently available`, 'MCP_TOOL_UNAVAILABLE')
      }
      const liveClassification = classifyToolRisk(liveTool.annotations)
      const liveRiskPolicy = mcpRiskPolicyDecision(liveServer, liveClassification)
      if (!liveRiskPolicy.allowed) {
        rejectBeforeCall(
          `MCP tool ${publicName} is blocked by the ${liveRiskPolicy.policy} risk policy`,
          'MCP_TOOL_RISK_BLOCKED',
        )
      }
      // The identity check prevents a catalog refresh from allowing an old
      // definition to call after its replacement has been exposed.
      if (
        !toolPolicyDecision(liveServer, liveTool).allowed
        || this.exposed.get(publicName)?.tool !== liveTool
      ) {
        rejectBeforeCall(`MCP tool ${publicName} is not allowed by current settings`, 'MCP_TOOL_NOT_ALLOWED')
      }
      return {
        runtime: liveRuntime,
        server: liveServer,
        tool: liveTool,
        classification: liveClassification,
      }
    }
    let active = resolveCurrentCall()
    if (this.authorize !== undefined) {
      let allowed
      try {
        allowed = await this.authorize({
          server: active.server,
          tool: active.tool,
          classification: active.classification,
          args,
          exec,
        })
      } catch (error) {
        const failure = managedMcpError(error, publicName, 'MCP_TOOL_NOT_APPROVED')
        deferContext({ errorCode: failure.code })
        throw failure
      }
      if (!allowed) rejectBeforeCall(`MCP tool ${publicName} was not approved`, 'MCP_TOOL_NOT_APPROVED')
      active = resolveCurrentCall()
    }
    const externalCallCounted = await this.consumeCodeRunExternalCall(exec, publicName, rejectBeforeCall)
    // consumeCodeRunExternalCall is asynchronous even when it only increments
    // an in-memory counter. Re-check after it yields and immediately before the
    // transport call so a queued reconfigure/reconnect cannot race past policy.
    try {
      active = resolveCurrentCall()
    } catch (error) {
      // The final preflight is still before transport. A concurrent lifecycle
      // change must not burn the caller's Code Mode budget when it revokes the
      // invocation during the asynchronous counter boundary.
      if (externalCallCounted) this.releaseCodeRunExternalCall(exec)
      throw error
    }
    const started = Date.now()
    let bounded
    let failure
    let transportDispatched = false
    let failureCode = 'MCP_TOOL_CALL_FAILED'
    try {
      transportDispatched = true
      const raw = typeof active.runtime.adapter.callTool === 'function'
        ? await active.runtime.adapter.callTool(active.tool, args, exec)
        : await active.tool.definition.execute(args, exec)
      failureCode = 'MCP_TOOL_RESULT_FAILED'
      const admission = admitMcpResult(raw)
      const images = await saveMcpResultImages(this.ctx, raw, {
        serverId,
        toolName: active.tool.rawName,
        admission,
      })
      bounded = await boundMcpResult(raw, {
        maxChars: this.config.mcpMaxResultChars,
        artifactDir: this.config.mcpArtifactDir,
        serverId,
        toolName: active.tool.rawName,
        images,
        admission,
      })
      // Code Mode renders only the outer run_code text. Ferry a compact marker
      // for every MCP sub-call so the next model request retains MCP budgets,
      // usage attribution and call guards; image results additionally carry
      // immutable Harness attachment references into the visual bridge.
      deferContext({ result: bounded })
      // Code Mode already receives the original image attachments through the
      // trusted deferred MCP context above. Return a JSON-only binding value so
      // DSH rc.8's generic image ferry does not add a second copy; rc.6 keeps
      // using the same explicit context and therefore remains compatible.
      return exec.parent !== undefined && bounded.images?.length > 0
        ? { ...bounded, images: [] }
        : bounded
    } catch (error) {
      if (isBeforeTransportError(error)) {
        transportDispatched = false
        if (externalCallCounted) this.releaseCodeRunExternalCall(exec)
        failure = error
        deferContext({ errorCode: error.code ?? 'MCP_TOOL_UNAVAILABLE' })
        throw error
      }
      failure = managedMcpError(error, publicName, failureCode)
      deferContext({ errorCode: failure.code })
      throw failure
    } finally {
      const sessionId = exec.agent?.id ?? exec.agent?.session?.id
      if (transportDispatched && this.usageTracker?.recordMcpExternalCall !== undefined) {
        const resultTokens = bounded === undefined
          ? 0
          : estimateMcpResultTokens(bounded)
        try {
          await this.usageTracker.recordMcpExternalCall(sessionId, { resultTokens })
        } catch (error) {
          this.logger.warn?.(`deepseekeyes: MCP usage accounting failed: ${boundedSafeError(error)}`)
        }
      }
      if (this.config.mcpAudit) {
        try {
          const event = mcpAuditSummary({
            id: randomUUID(),
            at: nowIso(this.now),
            server: active.server,
            tool: active.tool,
            args,
            result: bounded,
            error: failure,
            durationMs: Date.now() - started,
          })
          this.audit.push(event)
          this.audit = this.audit.slice(-this.config.mcpAuditLimit)
          await this.onAudit?.(event)
        } catch (error) {
          try {
            this.logger.warn?.(`deepseekeyes: MCP audit failed without affecting the tool result: ${boundedSafeError(error)}`)
          } catch {}
        }
      }
    }
  }

  async executeContent(kind, args, exec = {}) {
    this.assertRoute(exec)
    const publicName = kind === 'resource' ? MCP_RESOURCE_TOOL_NAME : MCP_PROMPT_TOOL_NAME
    if (exec.parent !== undefined && typeof exec.deferContext !== 'function') {
      throw new DeepSeekEyesError(
        `MCP Code Mode result ${publicName} cannot be delivered without the Host context channel`,
        'MCP_RESULT_CONTEXT_UNAVAILABLE',
      )
    }
    let contextDeferred = false
    const deferContext = value => {
      if (exec.parent === undefined || contextDeferred) return
      contextDeferred = true
      exec.deferContext(managedMcpContext(publicName, value))
    }
    const rejectBeforeCall = (message, code) => {
      deferContext({ errorCode: code })
      throw new DeepSeekEyesError(message, code)
    }
    const serverId = typeof args?.serverId === 'string' ? args.serverId : ''
    const identity = kind === 'resource'
      ? typeof args?.uri === 'string' ? args.uri : ''
      : typeof args?.name === 'string' ? args.name : ''
    if (serverId === '' || identity === '') {
      rejectBeforeCall(`MCP ${kind} requires a non-empty serverId and ${kind === 'resource' ? 'uri' : 'name'}`, 'MCP_CONTENT_INPUT_INVALID')
    }
    const auditTool = contentAuditTool(publicName, kind)
    const classification = classifyToolRisk(auditTool.annotations)

    // Resolve the current Content generation at every asynchronous boundary.
    // An approval hook or the Code Mode quota check can yield while settings
    // reconfiguration revokes an allowlist, replaces a transport, or clears
    // the exposed generic Resource/Prompt tool. Never dispatch through the
    // runtime and catalog captured before that lifecycle change.
    const resolveCurrentContentCall = () => {
      const liveRuntime = this.runtimes.get(serverId)
      const liveServer = liveRuntime?.server
      if (!this.config.mcpEnabled || !liveServer?.enabled || liveRuntime?.contentStatus !== 'connected') {
        rejectBeforeCall(`MCP ${kind} ${identity} is not currently available`, 'MCP_CONTENT_UNAVAILABLE')
      }
      let liveCatalogEntry
      if (kind === 'resource') {
        if (!liveServer.resourcesEnabled || !this.contentExposed.has(publicName)) {
          rejectBeforeCall(`MCP Resource ${identity} is disabled`, 'MCP_RESOURCES_DISABLED')
        }
        liveCatalogEntry = resourceCatalogEntry(liveRuntime, identity)
        if (liveCatalogEntry === undefined) {
          rejectBeforeCall(`MCP Resource ${identity} is not present in the discovered catalog`, 'MCP_RESOURCE_UNKNOWN')
        }
        const direct = contentPolicyDecision(liveServer, 'resource', identity)
        const templateIdentity = liveCatalogEntry.uriTemplate
        const template = templateIdentity === undefined
          ? undefined
          : contentPolicyDecision(liveServer, 'resource', templateIdentity)
        if (direct.reason === 'denylist' || template?.reason === 'denylist'
          || (!direct.allowed && template?.allowed !== true)) {
          rejectBeforeCall(`MCP Resource ${identity} is not allowed by current settings`, 'MCP_RESOURCE_NOT_ALLOWED')
        }
      } else {
        if (!liveServer.promptsEnabled || !this.contentExposed.has(publicName)) {
          rejectBeforeCall(`MCP Prompt ${identity} is disabled`, 'MCP_PROMPTS_DISABLED')
        }
        liveCatalogEntry = liveRuntime.contentCatalog.prompts.find(prompt => prompt.name === identity)
        if (liveCatalogEntry === undefined) {
          rejectBeforeCall(`MCP Prompt ${identity} is not present in the discovered catalog`, 'MCP_PROMPT_UNKNOWN')
        }
        if (!contentPolicyDecision(liveServer, 'prompt', identity).allowed) {
          rejectBeforeCall(`MCP Prompt ${identity} is not allowed by current settings`, 'MCP_PROMPT_NOT_ALLOWED')
        }
        const promptArgs = args?.arguments ?? {}
        if (promptArgs === null || typeof promptArgs !== 'object' || Array.isArray(promptArgs)) {
          rejectBeforeCall('MCP Prompt arguments must be an object', 'MCP_CONTENT_INPUT_INVALID')
        }
        const declared = new Map(liveCatalogEntry.arguments.map(argument => [argument.name, argument]))
        for (const [name, value] of Object.entries(promptArgs)) {
          if (!declared.has(name) || typeof value !== 'string') {
            rejectBeforeCall(`MCP Prompt argument ${name} is not a declared string argument`, 'MCP_PROMPT_ARGUMENT_INVALID')
          }
        }
        const missing = liveCatalogEntry.arguments.find(argument => argument.required && !Object.hasOwn(promptArgs, argument.name))
        if (missing !== undefined) {
          rejectBeforeCall(`MCP Prompt argument ${missing.name} is required`, 'MCP_PROMPT_ARGUMENT_REQUIRED')
        }
      }
      return { runtime: liveRuntime, server: liveServer, catalogEntry: liveCatalogEntry }
    }

    let active = resolveCurrentContentCall()
    if (this.authorize !== undefined) {
      let allowed
      try {
        allowed = await this.authorize({ server: active.server, tool: auditTool, classification, args, exec })
      } catch (error) {
        const failure = managedMcpError(error, publicName, 'MCP_TOOL_NOT_APPROVED')
        deferContext({ errorCode: failure.code })
        throw failure
      }
      if (!allowed) rejectBeforeCall(`MCP ${kind} ${identity} was not approved`, 'MCP_TOOL_NOT_APPROVED')
      active = resolveCurrentContentCall()
    }
    const externalCallCounted = await this.consumeCodeRunExternalCall(exec, publicName, rejectBeforeCall)
    // consumeCodeRunExternalCall yields even for an in-memory counter. Recheck
    // once more so a queued lifecycle change cannot consume quota and then
    // dispatch a revoked Resource/Prompt through its old adapter.
    try {
      active = resolveCurrentContentCall()
    } catch (error) {
      if (externalCallCounted) this.releaseCodeRunExternalCall(exec)
      throw error
    }

    const started = Date.now()
    let bounded
    let failure
    let failureCode = kind === 'resource' ? 'MCP_RESOURCE_READ_FAILED' : 'MCP_PROMPT_GET_FAILED'
    try {
      const response = kind === 'resource'
        ? await active.runtime.contentAdapter.readResource(identity, exec)
        : await active.runtime.contentAdapter.getPrompt(identity, args.arguments ?? {}, exec)
      const raw = kind === 'resource' ? mcpResourceResult(response) : mcpPromptResult(response)
      failureCode = 'MCP_CONTENT_RESULT_FAILED'
      const admission = admitMcpResult(raw)
      const images = await saveMcpResultImages(this.ctx, raw, {
        serverId,
        toolName: `${kind}-${identity}`,
        admission,
      })
      bounded = await boundMcpResult(raw, {
        maxChars: this.config.mcpMaxResultChars,
        artifactDir: this.config.mcpArtifactDir,
        serverId,
        toolName: `${kind}-${identity}`,
        images,
        admission,
      })
      deferContext({ result: bounded })
      return exec.parent !== undefined && bounded.images?.length > 0
        ? { ...bounded, images: [] }
        : bounded
    } catch (error) {
      failure = managedMcpError(error, publicName, failureCode)
      deferContext({ errorCode: failure.code })
      throw failure
    } finally {
      const sessionId = exec.agent?.id ?? exec.agent?.session?.id
      if (this.usageTracker?.recordMcpExternalCall !== undefined) {
        try {
          await this.usageTracker.recordMcpExternalCall(sessionId, {
            resultTokens: bounded === undefined ? 0 : estimateMcpResultTokens(bounded),
          })
        } catch (error) {
          this.logger.warn?.(`deepseekeyes: MCP usage accounting failed: ${boundedSafeError(error)}`)
        }
      }
      if (this.config.mcpAudit) {
        try {
          const event = mcpAuditSummary({
            id: randomUUID(),
            at: nowIso(this.now),
            server: active.server,
            tool: auditTool,
            args,
            result: bounded,
            error: failure,
            durationMs: Date.now() - started,
          })
          this.audit.push(event)
          this.audit = this.audit.slice(-this.config.mcpAuditLimit)
          await this.onAudit?.(event)
        } catch (error) {
          this.logger.warn?.(`deepseekeyes: MCP audit failed without affecting the content result: ${boundedSafeError(error)}`)
        }
      }
    }
  }

  syncPrompt() {
    const active = this.config.mcpEnabled && (this.exposed.size > 0 || this.contentExposed.size > 0)
    if (active && this.disposePrompt === undefined && this.ctx.systemPrompt !== undefined) {
      this.disposePrompt = this.ctx.systemPrompt.section({
        name: 'deepseekeyes:mcp-applications',
        order: 130,
        text: MCP_SYSTEM_PROMPT,
      })
      if (typeof this.ctx.on === 'function') {
        // ToolRuntime registrations are process-global so the manager can hot-swap
        // generations without racing agent creation. The authoritative model-facing
        // boundary is SystemPrompt assembly: after every scoped selector has run,
        // remove this manager's schemas and guidance unless the selected provider is
        // the DeepSeekEyes virtual provider. This also covers a provider switch inside
        // one long-lived agent and subject-less diagnostic assembly.
        this.disposeAssemblyFilter = this.ctx.on(
          'system-prompt/assemble',
          async (assembly, context, next) => {
            const resolved = await next()
            if (assembledProvider(resolved, context) === this.config.providerId) return resolved
            const names = new Set([...this.exposed.keys(), ...this.contentExposed.keys()])
            const sections = []
            for (const section of resolved.sections) {
              if (section.name === 'deepseekeyes:mcp-applications') continue
              if (section.name === 'tools:sdk' && section.text !== '') {
                sections.push({
                  ...section,
                  text: await renderFilteredToolsSdk(
                    this.ctx,
                    context?.scope,
                    names,
                    this.loadDshTools,
                  ),
                })
              } else {
                sections.push(section)
              }
            }
            return {
              ...resolved,
              sections,
              tools: resolved.tools.filter(tool => !names.has(tool.name)),
            }
          },
        )
      }
    } else if (!active && this.disposePrompt !== undefined) {
      this.disposeAssemblyFilter?.()
      this.disposeAssemblyFilter = undefined
      this.disposePrompt()
      this.disposePrompt = undefined
    }
  }

  async closeRuntime(runtime) {
    runtime.status = 'closing'
    runtime.healthy = false
    runtime.contentStatus = 'closing'
    runtime.contentHealthy = false
    runtime.tools = new Map()
    if (this.runtimes.get(runtime.server.id) === runtime) this.runtimes.delete(runtime.server.id)
    // Revoke model-facing schemas and guidance before awaiting transport
    // cleanup. A broken close must never keep an application tool callable.
    this.syncExposure()
    let closed = true
    try {
      await runtime.contentAdapter?.close?.()
      const failure = this.contentCleanupFailures.get(runtime.server.id)
      if (failure?.adapter === runtime.contentAdapter) this.contentCleanupFailures.delete(runtime.server.id)
    } catch (error) {
      closed = false
      this.recordContentCleanupFailure(runtime.server, runtime.contentAdapter, 'runtime', error)
    }
    try {
      await runtime.adapter?.close?.()
      const failure = this.cleanupFailures.get(runtime.server.id)
      if (failure?.adapter === runtime.adapter) this.cleanupFailures.delete(runtime.server.id)
      this.touch()
      return closed
    } catch (error) {
      this.recordCleanupFailure(runtime.server, runtime.adapter, 'runtime', error)
      return false
    }
  }

  reconfigure(config) {
    return this.enqueue(async () => {
      const next = normalizeMcpConfig(config)
      const previous = this.config
      this.config = next
      if (!this.started) return this.snapshot()
      this.exposureSuspended = true
      this.syncExposure()
      try {
        const nextById = new Map(next.mcpServers.map(server => [server.id, server]))
        const blockedReplacement = new Set()
        for (const runtime of [...this.runtimes.values()]) {
          const replacement = nextById.get(runtime.server.id)
          if (!next.mcpEnabled || !replacement?.enabled) {
            await this.closeRuntime(runtime)
            continue
          }
          if (mcpConnectionFingerprint(runtime.server) !== mcpConnectionFingerprint(replacement)) {
            const closed = await this.closeRuntime(runtime)
            if (closed) await this.connect(replacement)
            else blockedReplacement.add(runtime.server.id)
          } else {
            runtime.server = replacement
            runtime.adapter?.updateServer?.(replacement)
            runtime.contentAdapter?.updateServer?.(replacement)
            const connection = runtime.adapter?.connectionState?.()
            // `connectionState()` is the public transport health contract, but
            // the official DSH adapters also expose a live status field. During
            // risk-metadata refresh the adapter deliberately reports
            // `unknown`/`connecting` while a stale catalog is withdrawn. A
            // policy-only reconfigure must not return a connected snapshot (or
            // re-expose that stale schema) during that window, even if a custom
            // adapter's connectionState still reports connected.
            const adapterStatus = runtime.adapter?.status
            const connectionStatus = typeof connection?.status === 'string' ? connection.status : undefined
            // Custom adapters may legitimately omit both optional health
            // projections. In that case retain the already-connected runtime
            // state instead of treating a policy-only update as a disconnect.
            const connectionUnhealthy = connection?.connected === false
              || (connectionStatus !== undefined && connectionStatus !== 'connected')
            const adapterUnhealthy = connectionUnhealthy
              || (typeof adapterStatus === 'string' && adapterStatus !== 'connected')
            if (adapterUnhealthy) {
              const failureStatus = connectionStatus ?? adapterStatus
              runtime.status = failureStatus === 'error'
                || failureStatus === 'catalog-rejected'
                || failureStatus === 'cleanup-failed'
                ? 'error'
                : 'degraded'
              runtime.healthy = false
              runtime.lastError = connection?.error === undefined && connection?.metadataCleanupFailure === undefined
                ? {
                    code: 'MCP_CONNECTION_UNHEALTHY',
                    message: 'The MCP transport is not connected while policy metadata is being verified.',
                  }
                : {
                    code: boundedSafeErrorCode(
                      connection.error ?? connection.metadataCleanupFailure,
                      'MCP_CONNECTION_UNHEALTHY',
                    ),
                    message: boundedSafeError(
                      connection.error ?? connection.metadataCleanupFailure,
                    ),
                  }
            }
          }
        }
        if (next.mcpEnabled) {
          for (const server of next.mcpServers) {
            if (!server.enabled || this.runtimes.has(server.id) || blockedReplacement.has(server.id)) continue
            if (!await this.retryServerCleanup(server.id)) continue
            await this.connect(server)
          }
        }
        if (previous.mcpEnabled !== next.mcpEnabled) this.touch()
      } finally {
        this.exposureSuspended = false
        this.syncExposure()
      }
      return this.snapshot()
    })
  }

  reconnect(serverId) {
    return this.enqueue(async () => {
      const server = this.config.mcpServers.find(entry => entry.id === String(serverId))
      if (server === undefined) throw new DeepSeekEyesError(`Unknown MCP server ${serverId}`, 'MCP_SERVER_UNKNOWN')
      const current = this.runtimes.get(server.id)
      let cleaned = current === undefined || await this.closeRuntime(current)
      if (cleaned) cleaned = await this.retryServerCleanup(server.id)
      if (cleaned && this.config.mcpEnabled && server.enabled) await this.connect(server)
      this.syncExposure()
      return this.snapshot()
    })
  }

  toolsHealthProjection(server, runtime) {
    const tools = runtime === undefined ? [] : [...runtime.tools.values()]
    return {
      enabled: server.toolsEnabled,
      ok: !server.toolsEnabled || runtime?.healthy === true,
      status: server.toolsEnabled ? runtime?.status ?? 'idle' : 'disabled',
      latencyMs: runtime?.toolsLatencyMs ?? 0,
      toolCount: tools.length,
      schemaTokensEstimated: tools.reduce(
        (total, tool) => total + this.createManagedCandidate(server, runtime, tool).schemaTokensEstimated,
        0,
      ),
      ...(runtime?.lastError === undefined ? {} : { error: { ...runtime.lastError } }),
    }
  }

  contentHealthProjection(server, runtime) {
    const catalog = runtime?.contentCatalog ?? { resources: [], resourceTemplates: [], prompts: [] }
    const enabled = server.resourcesEnabled || server.promptsEnabled
    return {
      enabled,
      ok: !enabled || runtime?.contentHealthy === true,
      status: enabled ? runtime?.contentStatus ?? 'idle' : 'disabled',
      latencyMs: runtime?.contentLatencyMs ?? 0,
      resourceCount: catalog.resources.length,
      resourceTemplateCount: catalog.resourceTemplates.length,
      promptCount: catalog.prompts.length,
      ...(runtime?.contentLastError === undefined ? {} : { error: { ...runtime.contentLastError } }),
    }
  }

  async probeToolsPlane(server) {
    const started = Date.now()
    const active = this.runtimes.get(server.id)
    let adapter
    let result
    try {
      if (this.cleanupFailures.has(server.id)) {
        throw new DeepSeekEyesError(
          `MCP server ${server.id} has an unresolved Tools transport cleanup failure`,
          'MCP_ADAPTER_CLOSE_FAILED',
        )
      }
      adapter = active?.adapter ?? await this.createAdapter(server, {})
      let tools
      if (typeof adapter.probe === 'function') {
        tools = await adapter.probe()
      } else {
        // A custom adapter without a dedicated probe must still establish a
        // fresh transport. Reading listTools() from the active capture is not
        // a health check.
        if (active?.adapter === adapter) adapter = await this.createAdapter(server, {})
        await adapter.start?.()
        tools = await adapter.listTools()
      }
      if (!Array.isArray(tools)) throw new TypeError(`MCP server ${server.id} listTools() must return an array`)
      const checkedAt = nowIso(this.now)
      const checkedAtMs = nowMilliseconds(this.now)
      if (active !== undefined) {
        active.lastCheckedAt = checkedAt
        active.lastProbeAtMs = checkedAtMs
        active.toolsLastCheckedAt = checkedAt
        active.toolsLastProbeAtMs = checkedAtMs
        active.toolsLatencyMs = Date.now() - started
        active.adapter.reconcileProbe?.(tools)
        const live = active.adapter.connectionState?.()
        active.healthy = live === undefined || live.connected === true
        active.status = active.healthy ? 'connected' : 'degraded'
        if (active.healthy) active.lastError = undefined
        else if (live?.error !== undefined) {
          active.lastError = {
            code: boundedSafeErrorCode(live.error, 'MCP_CONNECTION_UNHEALTHY'),
            message: boundedSafeError(live.error),
          }
        }
        this.syncExposure()
      }
      const probeRuntime = { server, tools: new Map() }
      this.setRuntimeTools(probeRuntime, tools)
      const normalizedTools = [...probeRuntime.tools.values()]
      result = {
        enabled: true,
        ok: true,
        status: active === undefined || active.healthy ? 'connected' : 'reachable',
        latencyMs: Date.now() - started,
        toolCount: tools.length,
        schemaTokensEstimated: normalizedTools.reduce(
          (total, tool) => total + this.createManagedCandidate(server, undefined, tool).schemaTokensEstimated,
          0,
        ),
      }
    } catch (error) {
      const lastError = {
        code: boundedSafeErrorCode(error, 'MCP_CONNECT_FAILED'),
        message: boundedSafeError(error),
      }
      if (active !== undefined) {
        const checkedAt = nowIso(this.now)
        active.status = 'degraded'
        active.healthy = false
        active.lastCheckedAt = checkedAt
        active.lastProbeAtMs = nowMilliseconds(this.now)
        active.toolsLastCheckedAt = checkedAt
        active.toolsLastProbeAtMs = active.lastProbeAtMs
        active.toolsLatencyMs = Date.now() - started
        active.lastError = lastError
        this.syncExposure()
      }
      result = {
        enabled: true,
        ok: false,
        status: 'error',
        latencyMs: Date.now() - started,
        toolCount: 0,
        schemaTokensEstimated: 0,
        error: lastError,
      }
    }
    if (adapter !== active?.adapter) {
      try {
        await adapter?.close?.()
      } catch (error) {
        const lastError = this.recordCleanupFailure(server, adapter, 'probe', error)
        if (active !== undefined) {
          active.status = 'degraded'
          active.healthy = false
          active.lastError = lastError
          this.syncExposure()
        }
        result = { ...result, ok: false, status: 'error', error: lastError }
      }
    }
    return result
  }

  async probeContentPlane(server) {
    const started = Date.now()
    const active = this.runtimes.get(server.id)
    let adapter
    let result
    try {
      if (this.contentCleanupFailures.has(server.id)) {
        throw new DeepSeekEyesError(
          `MCP server ${server.id} has an unresolved Content transport cleanup failure`,
          'MCP_CONTENT_CLOSE_FAILED',
        )
      }
      adapter = await this.createContentAdapter(server, {})
      await adapter.start()
      const catalog = adapter.catalog()
      const checkedAt = nowIso(this.now)
      const checkedAtMs = nowMilliseconds(this.now)
      if (active !== undefined) {
        active.contentCatalog = catalog
        active.contentStatus = 'connected'
        active.contentHealthy = true
        active.contentLastError = undefined
        active.contentLastConnectedAt = checkedAt
        active.contentLastCheckedAt = checkedAt
        active.contentLastProbeAtMs = checkedAtMs
        active.lastProbeAtMs = checkedAtMs
        active.contentLatencyMs = Date.now() - started
        this.syncExposure()
      }
      result = {
        enabled: true,
        ok: true,
        status: 'connected',
        latencyMs: Date.now() - started,
        resourceCount: catalog.resources.length,
        resourceTemplateCount: catalog.resourceTemplates.length,
        promptCount: catalog.prompts.length,
      }
    } catch (error) {
      const lastError = {
        code: boundedSafeErrorCode(error, 'MCP_CONTENT_CONNECT_FAILED'),
        message: boundedSafeError(error),
      }
      if (active !== undefined) {
        const checkedAt = nowIso(this.now)
        active.contentStatus = 'error'
        active.contentHealthy = false
        active.contentLastError = lastError
        active.contentLastCheckedAt = checkedAt
        active.contentLastProbeAtMs = nowMilliseconds(this.now)
        active.lastProbeAtMs = active.contentLastProbeAtMs
        active.contentLatencyMs = Date.now() - started
        this.syncExposure()
      }
      result = {
        enabled: true,
        ok: false,
        status: 'error',
        latencyMs: Date.now() - started,
        resourceCount: 0,
        resourceTemplateCount: 0,
        promptCount: 0,
        error: lastError,
      }
    }
    try {
      await adapter?.close?.()
    } catch (error) {
      const lastError = this.recordContentCleanupFailure(server, adapter, 'probe', error)
      if (active !== undefined) {
        active.contentStatus = 'error'
        active.contentHealthy = false
        active.contentLastError = lastError
        this.syncExposure()
      }
      result = { ...result, ok: false, status: 'error', error: lastError }
    }
    return result
  }

  testConnection(serverId, options = {}) {
    return this.enqueue(async () => {
      const server = this.config.mcpServers.find(entry => entry.id === String(serverId))
      if (server === undefined) throw new DeepSeekEyesError(`Unknown MCP server ${serverId}`, 'MCP_SERVER_UNKNOWN')
      const started = Date.now()
      const active = this.runtimes.get(server.id)
      const probeTools = options.probeTools !== false
      const probeContent = options.probeContent !== false
      const tools = !server.toolsEnabled
        ? this.toolsHealthProjection(server, active)
        : probeTools ? await this.probeToolsPlane(server) : this.toolsHealthProjection(server, active)
      const contentEnabled = server.resourcesEnabled || server.promptsEnabled
      const content = !contentEnabled
        ? this.contentHealthProjection(server, active)
        : probeContent ? await this.probeContentPlane(server) : this.contentHealthProjection(server, active)
      const enabled = [tools, content].filter(plane => plane.enabled)
      const ok = enabled.every(plane => plane.ok)
      const status = enabled.length === 0
        ? 'idle'
        : ok ? 'connected'
          : enabled.some(plane => plane.ok) ? 'degraded' : 'error'
      const runtime = this.runtimes.get(server.id)
      if (runtime !== undefined) runtime.latencyMs = Date.now() - started
      const error = enabled.find(plane => !plane.ok)?.error
      return {
        ok,
        serverId: server.id,
        status,
        latencyMs: Date.now() - started,
        toolCount: tools.toolCount,
        resourceCount: content.resourceCount,
        resourceTemplateCount: content.resourceTemplateCount,
        promptCount: content.promptCount,
        schemaTokensEstimated: tools.schemaTokensEstimated,
        tools,
        content,
        ...(error === undefined ? {} : { error }),
      }
    })
  }

  listTools(serverId, { refresh = false } = {}) {
    return this.enqueue(async () => {
      const runtime = this.runtimes.get(String(serverId))
      if (runtime === undefined) return []
      if (refresh && runtime.adapter !== undefined) {
        runtime.status = 'connecting'
        runtime.healthy = false
        this.syncExposure()
        try {
          if (typeof runtime.adapter.refresh !== 'function') {
            throw new DeepSeekEyesError(
              `MCP adapter for ${runtime.server.id} does not support a live transport refresh`,
              'MCP_REFRESH_UNSUPPORTED',
            )
          }
          this.setRuntimeTools(runtime, await runtime.adapter.refresh())
          const connection = runtime.adapter.connectionState?.()
          if (connection?.connected === false) {
            throw new DeepSeekEyesError(
              `MCP server ${runtime.server.id} refresh did not establish a live transport`,
              'MCP_CONNECT_FAILED',
            )
          }
          runtime.status = 'connected'
          runtime.healthy = true
          runtime.lastConnectedAt = nowIso(this.now)
          runtime.lastCheckedAt = runtime.lastConnectedAt
          runtime.lastProbeAtMs = nowMilliseconds(this.now)
          runtime.toolsLastCheckedAt = runtime.lastCheckedAt
          runtime.toolsLastProbeAtMs = runtime.lastProbeAtMs
          runtime.lastError = undefined
          this.syncExposure()
        } catch (error) {
          runtime.status = 'error'
          runtime.healthy = false
          runtime.lastCheckedAt = nowIso(this.now)
          runtime.lastProbeAtMs = nowMilliseconds(this.now)
          runtime.toolsLastCheckedAt = runtime.lastCheckedAt
          runtime.toolsLastProbeAtMs = runtime.lastProbeAtMs
          runtime.lastError = {
            code: boundedSafeErrorCode(error, 'MCP_REFRESH_FAILED'),
            message: boundedSafeError(error),
          }
          this.syncExposure()
          throw new DeepSeekEyesError(runtime.lastError.message, runtime.lastError.code)
        }
      }
      return this.toolSummaries(runtime.server, runtime)
    })
  }

  listContent(serverId, { refresh = false } = {}) {
    return this.enqueue(async () => {
      const runtime = this.runtimes.get(String(serverId))
      if (runtime === undefined) return { resources: [], resourceTemplates: [], prompts: [] }
      if (refresh) {
        if (runtime.contentAdapter === undefined) {
          throw new DeepSeekEyesError(
            `MCP Content plane for ${runtime.server.id} is not enabled`,
            'MCP_CONTENT_DISABLED',
          )
        }
        runtime.contentStatus = 'connecting'
        runtime.contentHealthy = false
        this.syncExposure()
        try {
          runtime.contentCatalog = await runtime.contentAdapter.refresh()
          runtime.contentStatus = 'connected'
          runtime.contentHealthy = true
          runtime.contentLastError = undefined
          runtime.contentLastConnectedAt = nowIso(this.now)
          runtime.contentLastCheckedAt = runtime.contentLastConnectedAt
          runtime.contentLastProbeAtMs = nowMilliseconds(this.now)
          this.syncExposure()
        } catch (error) {
          runtime.contentStatus = 'error'
          runtime.contentHealthy = false
          runtime.contentLastError = {
            code: boundedSafeErrorCode(error, 'MCP_CONTENT_REFRESH_FAILED'),
            message: boundedSafeError(error),
          }
          runtime.contentLastCheckedAt = nowIso(this.now)
          runtime.contentLastProbeAtMs = nowMilliseconds(this.now)
          this.syncExposure()
          throw new DeepSeekEyesError(runtime.contentLastError.message, runtime.contentLastError.code)
        }
      }
      return this.contentSummaries(runtime.server, runtime)
    })
  }

  contentSummaries(server, runtime) {
    const catalog = runtime?.contentCatalog ?? { resources: [], resourceTemplates: [], prompts: [] }
    return {
      resources: catalog.resources.map(resource => ({
        ...resource,
        allowed: contentPolicyDecision(server, 'resource', resource.uri).allowed,
      })),
      resourceTemplates: catalog.resourceTemplates.map(resource => ({
        ...resource,
        allowed: contentPolicyDecision(server, 'resource', resource.uriTemplate).allowed,
      })),
      prompts: catalog.prompts.map(prompt => ({
        ...prompt,
        allowed: contentPolicyDecision(server, 'prompt', prompt.name).allowed,
      })),
    }
  }

  toolSummaries(server, runtime) {
    return [...(runtime?.tools.values() ?? [])].map(tool => {
      const policy = toolPolicyDecision(server, tool)
      const classification = classifyToolRisk(tool.annotations)
      const riskPolicy = mcpRiskPolicyDecision(server, classification)
      const exposed = this.exposed.has(tool.publicName)
      return {
        name: tool.rawName,
        publicName: tool.publicName,
        description: tool.description,
        allowed: policy.allowed,
        exposed,
        ...(runtime?.blocked?.get(tool.publicName) === undefined ? {} : {
          blockedReason: runtime.blocked.get(tool.publicName),
        }),
        risk: classification.risk,
        requiresApproval: classification.requiresApproval,
        riskPolicy: riskPolicy.policy,
        riskPolicyAllowed: riskPolicy.allowed,
        schemaTokensEstimated: runtime?.schemaTokensEstimated?.get(tool.publicName)
          ?? this.createManagedCandidate(server, runtime, tool).schemaTokensEstimated,
      }
    }).sort((left, right) => left.publicName.localeCompare(right.publicName))
  }

  /**
   * Return health backed by a recent real transport operation. Settings-page
   * polling shares one in-flight probe batch and reuses a fresh result briefly,
   * so a stdio server is not respawned on every UI tick.
   */
  health() {
    if (this.healthInFlight !== undefined) return this.healthInFlight
    if (!this.config.mcpEnabled) return Promise.resolve(this.snapshot())
    const checkedAt = nowMilliseconds(this.now)
    const due = this.config.mcpServers.flatMap(server => {
      if (!server.enabled) return []
      const runtime = this.runtimes.get(server.id)
      const toolsDue = server.toolsEnabled && (
        runtime?.toolsLastProbeAtMs === undefined
        || checkedAt - runtime.toolsLastProbeAtMs >= this.healthProbeIntervalMs
      )
      const contentDue = (server.resourcesEnabled || server.promptsEnabled) && (
        runtime?.contentLastProbeAtMs === undefined
        || checkedAt - runtime.contentLastProbeAtMs >= this.healthProbeIntervalMs
      )
      return toolsDue || contentDue ? [{ server, toolsDue, contentDue }] : []
    })
    if (due.length === 0) return Promise.resolve(this.snapshot())
    const run = Promise.all(due.map(({ server, toolsDue, contentDue }) => this.testConnection(server.id, {
      probeTools: toolsDue,
      probeContent: contentDue,
    })))
      .then(() => this.snapshot())
    const settled = run.then(
      value => {
        if (this.healthInFlight === settled) this.healthInFlight = undefined
        return value
      },
      error => {
        if (this.healthInFlight === settled) this.healthInFlight = undefined
        throw error
      },
    )
    this.healthInFlight = settled
    return settled
  }

  snapshot() {
    const servers = this.config.mcpServers.map(server => {
      const runtime = this.runtimes.get(server.id)
      const cleanupFailure = this.cleanupFailures.get(server.id)
      const contentCleanupFailure = this.contentCleanupFailures.get(server.id)
      const tools = this.toolSummaries(server, runtime)
      const exposedTools = tools.filter(tool => tool.exposed)
      const enabledPlaneStates = [
        ...(server.toolsEnabled ? [runtime?.status ?? 'idle'] : []),
        ...(server.resourcesEnabled || server.promptsEnabled ? [runtime?.contentStatus ?? 'idle'] : []),
      ]
      const status = !this.config.mcpEnabled || !server.enabled
        ? 'disabled'
        : (cleanupFailure !== undefined || contentCleanupFailure !== undefined) && runtime === undefined ? 'error'
          : enabledPlaneStates.length === 0 ? 'idle'
            : enabledPlaneStates.every(value => value === 'connected') ? 'connected'
              : enabledPlaneStates.some(value => value === 'connected') ? 'degraded'
                : enabledPlaneStates.includes('error') ? 'error'
                  : enabledPlaneStates.includes('connecting') ? 'connecting' : 'degraded'
      const lastError = runtime?.lastError
        ?? runtime?.contentLastError
        ?? cleanupFailure?.lastError
        ?? contentCleanupFailure?.lastError
      const content = runtime?.contentCatalog ?? { resources: [], resourceTemplates: [], prompts: [] }
      return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        riskPolicy: server.riskPolicy,
        status,
        healthy: status === 'connected',
        toolsEnabled: server.toolsEnabled,
        resourcesEnabled: server.resourcesEnabled,
        promptsEnabled: server.promptsEnabled,
        toolsStatus: server.toolsEnabled ? runtime?.status ?? 'idle' : 'disabled',
        toolsHealthy: server.toolsEnabled ? runtime?.healthy === true : false,
        contentStatus: server.resourcesEnabled || server.promptsEnabled
          ? runtime?.contentStatus ?? 'idle'
          : 'disabled',
        contentHealthy: runtime?.contentHealthy === true,
        ...(runtime?.latencyMs === undefined ? {} : { latencyMs: runtime.latencyMs }),
        ...(runtime?.toolsLatencyMs === undefined ? {} : { toolsLatencyMs: runtime.toolsLatencyMs }),
        ...(runtime?.contentLatencyMs === undefined ? {} : { contentLatencyMs: runtime.contentLatencyMs }),
        toolCount: tools.length,
        exposedToolCount: exposedTools.length,
        resourceCount: content.resources.length,
        resourceTemplateCount: content.resourceTemplates.length,
        promptCount: content.prompts.length,
        schemaTokensEstimated: exposedTools.reduce((total, tool) => total + tool.schemaTokensEstimated, 0),
        ...(runtime?.lastConnectedAt === undefined ? {} : { lastConnectedAt: runtime.lastConnectedAt }),
        ...(runtime?.lastCheckedAt === undefined ? {} : { lastCheckedAt: runtime.lastCheckedAt }),
        ...(runtime?.toolsLastCheckedAt === undefined ? {} : { toolsLastCheckedAt: runtime.toolsLastCheckedAt }),
        ...(runtime?.contentLastCheckedAt === undefined ? {} : { contentLastCheckedAt: runtime.contentLastCheckedAt }),
        ...(lastError === undefined ? {} : { lastError: { ...lastError } }),
        ...(runtime?.lastError === undefined ? {} : { toolsLastError: { ...runtime.lastError } }),
        ...(runtime?.contentLastError === undefined ? {} : { contentLastError: { ...runtime.contentLastError } }),
        ...(runtime?.oauth === undefined ? {} : { oauth: { ...runtime.oauth } }),
        tools,
        resources: content.resources.map(resource => ({
          ...resource,
          allowed: contentPolicyDecision(server, 'resource', resource.uri).allowed,
        })),
        resourceTemplates: content.resourceTemplates.map(resource => ({
          ...resource,
          allowed: contentPolicyDecision(server, 'resource', resource.uriTemplate).allowed,
        })),
        prompts: content.prompts.map(prompt => ({
          ...prompt,
          allowed: contentPolicyDecision(server, 'prompt', prompt.name).allowed,
        })),
      }
    })
    const enabledServers = servers.filter(server => server.enabled)
    return {
      enabled: this.config.mcpEnabled,
      updatedAt: this.updatedAt,
      summary: {
        configuredServers: servers.length,
        enabledServers: enabledServers.length,
        connectedServers: servers.filter(server => server.status === 'connected').length,
        exposedTools: this.exposed.size,
        exposedContentTools: this.contentExposed.size,
        exposedSchemas: this.exposed.size + this.contentExposed.size,
        cleanupFailures: this.cleanupFailures.size + this.contentCleanupFailures.size,
        schemaTokensEstimated: servers.reduce((total, server) => total + server.schemaTokensEstimated, 0)
          + [...this.contentExposed.values()].reduce((total, entry) => total + entry.schemaTokensEstimated, 0),
        schemaTokenEstimate: servers.reduce((total, server) => total + server.schemaTokensEstimated, 0)
          + [...this.contentExposed.values()].reduce((total, entry) => total + entry.schemaTokensEstimated, 0),
      },
      limits: {
        maxTools: this.config.mcpMaxTools,
        maxSchemaTokens: this.config.mcpMaxSchemaTokens,
        maxResultChars: this.config.mcpMaxResultChars,
        maxExternalCallsPerRun: this.config.mcpMaxExternalCallsPerRun,
        toolCallTimeoutMs: this.config.mcpToolCallTimeoutMs,
      },
      servers,
      cleanupErrors: [
        ...[...this.cleanupFailures.values()].map(failure => ({
          serverId: failure.server.id,
          plane: 'tools',
          phase: failure.phase,
          at: failure.at,
          error: { ...failure.lastError },
        })),
        ...[...this.contentCleanupFailures.values()].map(failure => ({
          serverId: failure.server.id,
          plane: 'content',
          phase: failure.phase,
          at: failure.at,
          error: { ...failure.lastError },
        })),
      ].sort((left, right) => left.serverId.localeCompare(right.serverId) || left.plane.localeCompare(right.plane)),
      audit: this.config.mcpAudit ? [...this.audit] : [],
    }
  }

  touch() {
    this.updatedAt = nowIso(this.now)
  }

  recordOAuthAudit(server, event = {}) {
    if (!this.config.mcpAudit) return
    const record = Object.freeze({
      id: randomUUID(),
      at: typeof event.at === 'string' ? event.at : nowIso(this.now),
      serverId: server.id,
      serverName: server.name,
      plane: 'oauth',
      event: typeof event.type === 'string' ? event.type : 'oauth-event',
      status: event.error === undefined ? 'success' : 'error',
      ...(event.error === undefined ? {} : {
        error: {
          code: boundedSafeErrorCode(event.error, 'MCP_OAUTH_FAILED'),
          message: boundedSafeError(event.error),
        },
      }),
    })
    this.audit.push(record)
    this.audit = this.audit.slice(-this.config.mcpAuditLimit)
    void Promise.resolve(this.onAudit?.(record)).catch(error => {
      this.logger.warn?.(`deepseekeyes: MCP OAuth audit failed: ${boundedSafeError(error)}`)
    })
  }

  stop() {
    return this.enqueue(async () => {
      this.exposureSuspended = true
      this.syncExposure()
      try {
        const runtimes = [...this.runtimes.values()]
        for (const runtime of runtimes) await this.closeRuntime(runtime)
        const failedServerIds = new Set([
          ...this.cleanupFailures.keys(),
          ...this.contentCleanupFailures.keys(),
        ])
        for (const serverId of failedServerIds) await this.retryServerCleanup(serverId)
      } finally {
        this.externalCallsByCodeRun.clear()
        this.started = false
        this.exposureSuspended = false
        this.syncExposure()
        this.touch()
      }
      return this.snapshot()
    })
  }
}

/** Register lifecycle-managed MCP tools and return the live control surface. */
export function applyMcpRuntime(ctx, config, options = {}) {
  const manager = new McpManager(ctx, config, options)
  const install = async () => {
    await manager.start()
    return () => manager.stop()
  }
  if (typeof ctx.effect === 'function') ctx.effect(install, 'deepseekeyes: MCP applications')
  else void manager.start()
  return manager
}

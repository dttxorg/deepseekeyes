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
import { mcpConnectionFingerprint, normalizeMcpConfig } from './config.js'
import { loadHostDshTools } from './host-runtime.js'
import {
  createDshMcpClientAdapterFactory,
  McpCatalogBudget,
  normalizeMcpCatalogLimits,
} from './official-adapter.js'
import { classifyToolRisk, publicMcpToolName, toolPolicyDecision } from './policy.js'
import {
  admitMcpResult,
  boundMcpResult,
  estimateMcpResultTokens,
  MCP_RESULT_OUTPUT,
  saveMcpResultImages,
} from './result.js'
import { estimateToolSchemaTokens, toolDefinitionTokenSurface } from './schema-tokens.js'

export const MCP_SYSTEM_PROMPT = `## DeepSeekEyes MCP applications

Use an enabled MCP tool when an application exposes a structured operation; prefer it over pixel automation. Inspect the bounded result and verify that the requested state change occurred. Treat tools marked write, destructive, or unknown-write cautiously and do not infer success from a call alone. When no suitable MCP tool is exposed, use DeepSeekEyes Browser Computer Use for websites or Desktop Computer Use for native UI.`

export const MCP_RESULT_CONTEXT_PREFIX = MCP_CONTEXT_PREFIX

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
    annotations: tool.annotations,
    definition: tool.definition,
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

export class McpManager {
  constructor(ctx, config = {}, options = {}) {
    this.ctx = ctx
    this.config = normalizeMcpConfig(config, options)
    this.adapterFactory = options.adapterFactory ?? createDshMcpClientAdapterFactory(ctx, options)
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
    this.exposed = new Map()
    this.audit = []
    this.started = false
    this.exposureSuspended = false
    this.updatedAt = nowIso(this.now)
    this.queue = Promise.resolve()
    this.disposePrompt = undefined
    this.disposeAssemblyFilter = undefined
    this.healthInFlight = undefined
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
          if (this.cleanupFailures.has(server.id) && !await this.retryCleanup(server.id)) return
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

  runtimeFailure(runtime, error, fallbackCode = 'MCP_CONNECT_FAILED') {
    runtime.status = 'error'
    runtime.healthy = false
    runtime.tools = new Map()
    runtime.lastCheckedAt = nowIso(this.now)
    runtime.lastProbeAtMs = nowMilliseconds(this.now)
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

  async connect(server) {
    const runtime = {
      server,
      status: 'connecting',
      healthy: false,
      tools: new Map(),
      schemaTokensEstimated: new Map(),
      startedAt: nowIso(this.now),
      lastCheckedAt: nowIso(this.now),
    }
    this.runtimes.set(server.id, runtime)
    this.touch()
    try {
      const adapter = await this.createAdapter(server, {
        onProbeCleanupFailure: (cleanupAdapter, error) => {
          this.recordCleanupFailure(server, cleanupAdapter, 'probe', error)
          const current = this.runtimes.get(server.id)
          if (current !== runtime) return
          runtime.status = 'degraded'
          runtime.healthy = false
          runtime.lastCheckedAt = nowIso(this.now)
          runtime.lastProbeAtMs = nowMilliseconds(this.now)
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
            if (connected) {
              runtime.lastProbeAtMs = nowMilliseconds(this.now)
              runtime.lastConnectedAt = runtime.lastCheckedAt
              runtime.lastError = undefined
            } else if (connection.reason !== 'closed') {
              runtime.lastProbeAtMs = undefined
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
      runtime.lastError = undefined
    } catch (error) {
      this.runtimeFailure(runtime, error)
      this.logger.warn?.(`deepseekeyes: MCP server ${server.id} failed: ${runtime.lastError.message}`)
      await runtime.adapter?.close?.().catch(closeError => {
        this.recordCleanupFailure(server, runtime.adapter, 'failed-connect', closeError)
      })
    }
    this.touch()
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
      if (!this.config.mcpEnabled || !server.enabled || runtime?.status !== 'connected') continue
      for (const tool of [...runtime.tools.values()].sort((left, right) => left.publicName.localeCompare(right.publicName))) {
        const candidate = this.createManagedCandidate(server, runtime, tool)
        runtime.schemaTokensEstimated.set(tool.publicName, candidate.schemaTokensEstimated)
        const policy = toolPolicyDecision(server, tool)
        if (!policy.allowed) continue
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
    this.syncPrompt()
    this.touch()
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
    const runtime = this.runtimes.get(serverId)
    const server = runtime?.server
    const tool = runtime?.tools.get(publicName)
    if (!this.config.mcpEnabled || !server?.enabled || runtime?.status !== 'connected' || tool === undefined) {
      rejectBeforeCall(`MCP tool ${publicName} is not currently available`, 'MCP_TOOL_UNAVAILABLE')
    }
    if (!toolPolicyDecision(server, tool).allowed || !this.exposed.has(publicName)) {
      rejectBeforeCall(`MCP tool ${publicName} is not allowed by current settings`, 'MCP_TOOL_NOT_ALLOWED')
    }
    const classification = classifyToolRisk(tool.annotations)
    if (this.authorize !== undefined) {
      let allowed
      try {
        allowed = await this.authorize({ server, tool, classification, args, exec })
      } catch (error) {
        const failure = managedMcpError(error, publicName, 'MCP_TOOL_NOT_APPROVED')
        deferContext({ errorCode: failure.code })
        throw failure
      }
      if (!allowed) rejectBeforeCall(`MCP tool ${publicName} was not approved`, 'MCP_TOOL_NOT_APPROVED')
    }
    const started = Date.now()
    let bounded
    let failure
    let failureCode = 'MCP_TOOL_CALL_FAILED'
    try {
      const raw = typeof runtime.adapter.callTool === 'function'
        ? await runtime.adapter.callTool(tool, args, exec)
        : await tool.definition.execute(args, exec)
      failureCode = 'MCP_TOOL_RESULT_FAILED'
      const admission = admitMcpResult(raw)
      const images = await saveMcpResultImages(this.ctx, raw, {
        serverId,
        toolName: tool.rawName,
        admission,
      })
      bounded = await boundMcpResult(raw, {
        maxChars: this.config.mcpMaxResultChars,
        artifactDir: this.config.mcpArtifactDir,
        serverId,
        toolName: tool.rawName,
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
      failure = managedMcpError(error, publicName, failureCode)
      deferContext({ errorCode: failure.code })
      throw failure
    } finally {
      const sessionId = exec.agent?.id ?? exec.agent?.session?.id
      if (this.usageTracker?.recordMcpExternalCall !== undefined) {
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
            server,
            tool,
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

  syncPrompt() {
    const active = this.config.mcpEnabled && this.exposed.size > 0
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
            const names = new Set(this.exposed.keys())
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
    runtime.tools = new Map()
    if (this.runtimes.get(runtime.server.id) === runtime) this.runtimes.delete(runtime.server.id)
    // Revoke model-facing schemas and guidance before awaiting transport
    // cleanup. A broken close must never keep an application tool callable.
    this.syncExposure()
    try {
      await runtime.adapter?.close?.()
      const failure = this.cleanupFailures.get(runtime.server.id)
      if (failure?.adapter === runtime.adapter) this.cleanupFailures.delete(runtime.server.id)
      this.touch()
      return true
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
          }
        }
        if (next.mcpEnabled) {
          for (const server of next.mcpServers) {
            if (!server.enabled || this.runtimes.has(server.id) || blockedReplacement.has(server.id)) continue
            if (this.cleanupFailures.has(server.id) && !await this.retryCleanup(server.id)) continue
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
      if (cleaned && this.cleanupFailures.has(server.id)) cleaned = await this.retryCleanup(server.id)
      if (cleaned && this.config.mcpEnabled && server.enabled) await this.connect(server)
      this.syncExposure()
      return this.snapshot()
    })
  }

  testConnection(serverId) {
    return this.enqueue(async () => {
      const server = this.config.mcpServers.find(entry => entry.id === String(serverId))
      if (server === undefined) throw new DeepSeekEyesError(`Unknown MCP server ${serverId}`, 'MCP_SERVER_UNKNOWN')
      const started = Date.now()
      let adapter
      try {
        if (this.cleanupFailures.has(server.id)) {
          throw new DeepSeekEyesError(
            `MCP server ${server.id} has an unresolved transport cleanup failure`,
            'MCP_ADAPTER_CLOSE_FAILED',
          )
        }
        const active = this.runtimes.get(server.id)
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
        if (active !== undefined) {
          active.lastCheckedAt = nowIso(this.now)
          active.lastProbeAtMs = nowMilliseconds(this.now)
          active.latencyMs = Date.now() - started
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
        return {
          ok: true,
          serverId: server.id,
          status: active === undefined || active.healthy ? 'connected' : 'reachable',
          latencyMs: Date.now() - started,
          toolCount: tools.length,
          schemaTokensEstimated: normalizedTools.reduce(
            (total, tool) => total + this.createManagedCandidate(server, undefined, tool).schemaTokensEstimated,
            0,
          ),
        }
      } catch (error) {
        const active = this.runtimes.get(server.id)
        if (active !== undefined) {
          active.status = 'degraded'
          active.healthy = false
          active.lastCheckedAt = nowIso(this.now)
          active.lastProbeAtMs = nowMilliseconds(this.now)
          active.latencyMs = Date.now() - started
          active.lastError = {
            code: boundedSafeErrorCode(error, 'MCP_CONNECT_FAILED'),
            message: boundedSafeError(error),
          }
          this.syncExposure()
        }
        return {
          ok: false,
          serverId: server.id,
          status: 'error',
          latencyMs: Date.now() - started,
          error: {
            code: boundedSafeErrorCode(error, 'MCP_CONNECT_FAILED'),
            message: boundedSafeError(error),
          },
        }
      } finally {
        const active = this.runtimes.get(server.id)
        if (adapter !== active?.adapter) {
          await adapter?.close?.().catch(error => {
            this.recordCleanupFailure(server, adapter, 'probe', error)
          })
        }
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
          runtime.lastError = undefined
          this.syncExposure()
        } catch (error) {
          runtime.status = 'error'
          runtime.healthy = false
          runtime.lastCheckedAt = nowIso(this.now)
          runtime.lastProbeAtMs = nowMilliseconds(this.now)
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

  toolSummaries(server, runtime) {
    return [...(runtime?.tools.values() ?? [])].map(tool => {
      const policy = toolPolicyDecision(server, tool)
      const classification = classifyToolRisk(tool.annotations)
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
    const due = this.config.mcpServers.filter(server => {
      if (!server.enabled) return false
      const runtime = this.runtimes.get(server.id)
      return runtime?.lastProbeAtMs === undefined
        || checkedAt - runtime.lastProbeAtMs >= this.healthProbeIntervalMs
    })
    if (due.length === 0) return Promise.resolve(this.snapshot())
    const run = Promise.all(due.map(server => this.testConnection(server.id)))
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
      const tools = this.toolSummaries(server, runtime)
      const exposedTools = tools.filter(tool => tool.exposed)
      const status = !this.config.mcpEnabled || !server.enabled
        ? 'disabled'
        : runtime?.status ?? (cleanupFailure === undefined ? 'idle' : 'error')
      const lastError = runtime?.lastError ?? cleanupFailure?.lastError
      return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        status,
        healthy: status === 'connected' && runtime?.healthy === true,
        ...(runtime?.latencyMs === undefined ? {} : { latencyMs: runtime.latencyMs }),
        toolCount: tools.length,
        exposedToolCount: exposedTools.length,
        schemaTokensEstimated: exposedTools.reduce((total, tool) => total + tool.schemaTokensEstimated, 0),
        ...(runtime?.lastConnectedAt === undefined ? {} : { lastConnectedAt: runtime.lastConnectedAt }),
        ...(runtime?.lastCheckedAt === undefined ? {} : { lastCheckedAt: runtime.lastCheckedAt }),
        ...(lastError === undefined ? {} : { lastError: { ...lastError } }),
        tools,
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
        cleanupFailures: this.cleanupFailures.size,
        schemaTokensEstimated: servers.reduce((total, server) => total + server.schemaTokensEstimated, 0),
        schemaTokenEstimate: servers.reduce((total, server) => total + server.schemaTokensEstimated, 0),
      },
      limits: {
        maxTools: this.config.mcpMaxTools,
        maxSchemaTokens: this.config.mcpMaxSchemaTokens,
        maxResultChars: this.config.mcpMaxResultChars,
        toolCallTimeoutMs: this.config.mcpToolCallTimeoutMs,
      },
      servers,
      cleanupErrors: [...this.cleanupFailures.values()].map(failure => ({
        serverId: failure.server.id,
        phase: failure.phase,
        at: failure.at,
        error: { ...failure.lastError },
      })).sort((left, right) => left.serverId.localeCompare(right.serverId)),
      audit: this.config.mcpAudit ? [...this.audit] : [],
    }
  }

  touch() {
    this.updatedAt = nowIso(this.now)
  }

  stop() {
    return this.enqueue(async () => {
      this.exposureSuspended = true
      this.syncExposure()
      try {
        const runtimes = [...this.runtimes.values()]
        for (const runtime of runtimes) await this.closeRuntime(runtime)
        for (const serverId of [...this.cleanupFailures.keys()]) await this.retryCleanup(serverId)
      } finally {
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

import { EvidenceCache } from '../src/cache.js'
import { applyBrowserComputerUse } from '../src/browser/index.js'
import { applyDesktopComputerUse } from '../src/desktop/index.js'
import {
  activeDesktopImageAttachmentKeys,
  activeImageBlocks,
  attachmentKey,
  historicalImageBlocks,
  messagesHaveImages,
  messagesNeedHistoryCompaction,
  pluginUserMessage,
  rewriteMessagesForBridge,
} from '../src/content.js'
import { resolveConfig } from '../src/config.js'
import { DeepSeekEyesError, errorMessage } from '../src/error.js'
import { VisionProbe } from '../src/probe.js'
import {
  clarificationInstruction,
  parseClarificationRequest,
  renderBaseEvidence,
  renderPreservedImageReference,
  renderTargetEvidence,
} from '../src/protocol.js'
import { applyLookTool } from '../src/look.js'
import { compactSessionHistory, shadowSessionImages } from '../src/session.js'
import { installHarnessSettings, SETTINGS_NAMESPACE } from '../src/settings.js'
import { addUsage, emptyUsage, replayWithUsage } from '../src/stream.js'
import { collectFinalWithBudget, fitOutputBudget } from '../src/token-safety.js'
import { estimateInjectedTextTokens, UsageTracker } from '../src/usage.js'
import { installUsageRpc } from '../src/usage-rpc.js'
import { EvidenceManager, VisionRouter } from '../src/vision.js'
import { VisionAttemptTracker } from '../src/vision-attempts.js'

export const name = 'deepseekeyes'
export const inject = ['llm', 'attachments', 'tools', 'systemPrompt', 'agents']

function appendSystem(system, addition) {
  return `${system ?? ''}${system === undefined || system === '' ? '' : '\n\n'}--- DeepSeekEyes private visual protocol ---\n${addition}`
}

function visionWrappedModel(info, config, route) {
  return {
    ...info,
    provider: config.providerId,
    name: `${info.name ?? info.id} · ${route.name ?? route.model} Eyes`,
    description: `Vision: ${route.provider}/${route.model} · Final: ${config.upstreamProvider}/${info.id}`,
    inputModalities: ['text', 'image'],
  }
}

function lockedUpstreamModel(config, requestedModel) {
  if (config.upstreamModel !== undefined
    && requestedModel !== undefined
    && requestedModel !== config.upstreamModel) {
    throw new DeepSeekEyesError(
      `DeepSeekEyes is locked to final model ${config.upstreamProvider}/${config.upstreamModel}; requested ${requestedModel}`,
      'UPSTREAM_MODEL_LOCKED',
    )
  }
  return config.upstreamModel ?? requestedModel
}

function createRuntime(ctx, rawConfig, logger) {
  const config = resolveConfig(rawConfig)
  const visionAttempts = new VisionAttemptTracker({
    enabled: config.visionAttemptLog,
    file: config.visionAttemptLogPath,
    limit: config.visionAttemptLimit,
    logger,
  })
  const router = new VisionRouter(ctx, config, logger, visionAttempts)
  const cache = new EvidenceCache({
    directory: config.cacheDir,
    persistent: config.persistentEvidence,
    logger,
  })
  const probe = new VisionProbe(ctx, { enabled: config.activeProbe, logger })
  const evidenceManager = new EvidenceManager(ctx, config, cache, probe)
  return Object.freeze({ config, router, cache, probe, evidenceManager, visionAttempts })
}

function attachmentSha256(block) {
  const match = /^sha256:([0-9a-f]{64})$/.exec(String(block?.attachment?.attachmentId ?? ''))
  return match?.[1]
}

async function* forwardText(ctx, options, logger) {
  const info = await ctx.llm.resolveModelInfo(options.provider, options.model, options.signal)
  const fitted = fitOutputBudget(options, info, logger)
  if (!fitted.changed) {
    yield* ctx.llm.stream(options)
    return
  }
  const guarded = await collectFinalWithBudget(ctx, options, info, logger)
  yield* replayWithUsage(guarded.result.chunks, guarded.result.usage)
}

function usageHasTokens(usage) {
  return usage !== undefined && Object.values(usage).some(value => typeof value === 'number' && value > 0)
}

async function recordEvidenceUsage(tracker, sessionId, result, category) {
  if (result.cacheHit) {
    await tracker.recordCacheHit(sessionId)
  }
  const probeUsage = result.usageBreakdown?.probe
  const modelUsage = result.usageBreakdown?.model ?? result.usage
  if (usageHasTokens(probeUsage)) {
    await tracker.recordCall(sessionId, 'visionProbe', result.usageBreakdown.probe)
  }
  if (!result.cacheHit || usageHasTokens(modelUsage)) {
    await tracker.recordCall(sessionId, category, modelUsage)
  }
}

function desktopVisualFallbackEligible(error, signal) {
  return !signal?.aborted && ![
    'ATTACHMENT_READ_FAILED',
    'ABORTED',
    'AbortError',
    'EVIDENCE_PERSIST_FAILED',
    'VISION_STATE_MISMATCH',
    'UNKNOWN_PRESERVED_IMAGE',
  ].includes(error?.code)
}

function boundedVisualFailure(error, maximum = 500) {
  const text = errorMessage(error)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|npm)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

function renderDesktopVisualFallback(source, error) {
  const attempts = (error?.attempts ?? []).map(attempt => ({
    provider: attempt.provider,
    model: attempt.model,
    phase: attempt.phase,
    status: attempt.status,
    ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
  }))
  return `[DeepSeekEyes desktop visual fallback]
source_sha256: ${source.sha256}
attachment_id: ${source.attachmentId}
original: ${source.mediaType}, ${source.width}x${source.height}, ${source.bytes} bytes
visual_status: unavailable-after-bounded-recovery
failure_code: ${error?.code ?? 'VISION_ROUTE_ERROR'}
failure_summary: ${boundedVisualFailure(error)}
route_attempts: ${JSON.stringify(attempts)}
continuation: Continue from the adjacent DeepSeekEyes desktop state, actionResult, windows, accessibility elements, stateDelta and screenshot metadata. Pixels were preserved but were not decoded in this step; request a later targeted reread only when a pixel-only fact is required.`
}

async function* bridgeStream(ctx, runtime, options, lookManager, usageTracker, logger) {
  const { config, router, evidenceManager } = runtime
  const upstreamModel = lockedUpstreamModel(config, options.model)
  const upstreamOptions = {
    ...options,
    provider: config.upstreamProvider,
    ...(upstreamModel === undefined ? {} : { model: upstreamModel }),
  }
  if (!messagesHaveImages(options.messages)) {
    const needsCompaction = messagesNeedHistoryCompaction(options.messages)
    if (needsCompaction) {
      compactSessionHistory(ctx, options.sessionId, {
        historyImageLimit: config.historyImageLimit,
        browserHistoryLimit: config.browserHistoryLimit,
        desktopHistoryLimit: config.desktopHistoryLimit,
      }, logger)
    }
    const messages = needsCompaction
      ? rewriteMessagesForBridge(
          options.messages,
          new Map(),
          new Map(),
          {
            historyImageLimit: config.historyImageLimit,
            browserHistoryLimit: config.browserHistoryLimit,
            desktopHistoryLimit: config.desktopHistoryLimit,
          },
        )
      : options.messages
    yield* forwardText(ctx, { ...upstreamOptions, messages }, logger)
    return
  }

  const activeBlocks = activeImageBlocks(options.messages)
  const desktopImageKeys = activeDesktopImageAttachmentKeys(options.messages)
  const historicalBlocks = historicalImageBlocks(options.messages)
  let route
  const totalUsage = emptyUsage()
  await usageTracker.recordVisualTurn(options.sessionId)
  const baseRecords = []
  let desktopFallbackCount = 0
  const activeEvidence = new Map()
  const historicalEvidence = new Map()
  const preservedByAttachment = new Map()
  const preservedEntries = []
  const blockByHash = new Map()
  const baseByHash = new Map()
  const baseByAttachment = new Map()
  let desktopVisualFailure

  const preserveDesktopFallback = async (block, key, error) => {
    const reference = await evidenceManager.referenceFor(block, options.signal)
    const summary = 'Desktop pixels remain preserved; bounded visual recovery failed, so the adjacent semantic state was forwarded.'
    activeEvidence.set(key, renderDesktopVisualFallback(reference.source, error))
    desktopFallbackCount += 1
    preservedByAttachment.set(
      key,
      renderPreservedImageReference({ source: reference.source, summary }, config.historySummaryChars),
    )
    preservedEntries.push({
      imageSha256: reference.source.sha256,
      attachment: block.attachment,
      summary,
    })
    blockByHash.set(reference.source.sha256, block)
  }

  for (const block of activeBlocks) {
    const key = attachmentKey(block.attachment)
    if (desktopVisualFailure !== undefined && desktopImageKeys.has(key)) {
      await preserveDesktopFallback(block, key, desktopVisualFailure)
      continue
    }
    let result
    try {
      result = await router.run('base', {
        sessionId: options.sessionId,
        imageSha256: attachmentSha256(block),
        preferred: route,
      }, candidate => evidenceManager.baseFor(block, candidate, options.signal), options.signal)
    } catch (error) {
      addUsage(totalUsage, error?.usage)
      await recordEvidenceUsage(usageTracker, options.sessionId, {
        cacheHit: false,
        usage: error?.usage ?? emptyUsage(),
        usageBreakdown: error?.usageBreakdown,
      }, 'visionBase')
      if (!desktopImageKeys.has(key) || !desktopVisualFallbackEligible(error, options.signal)) throw error
      desktopVisualFailure = error
      await preserveDesktopFallback(block, key, error)
      logger.warn?.(
        `deepseekeyes: desktop screenshot visual recovery failed; forwarding semantic state (${error?.code ?? 'VISION_ROUTE_ERROR'})`,
      )
      continue
    }
    route = result.route
    addUsage(totalUsage, result.usage)
    await recordEvidenceUsage(usageTracker, options.sessionId, result, 'visionBase')
    baseRecords.push(result.record)
    activeEvidence.set(key, renderBaseEvidence(result.record))
    preservedByAttachment.set(
      key,
      renderPreservedImageReference(result.record, config.historySummaryChars),
    )
    preservedEntries.push({
      imageSha256: result.record.source.sha256,
      attachment: block.attachment,
      summary: result.record.evidence.summary,
    })
    blockByHash.set(result.record.source.sha256, block)
    baseByHash.set(result.record.source.sha256, result.record)
    baseByAttachment.set(key, result.record)
  }

  const recentHistoryKeys = new Set((config.historyImageLimit === 0
    ? []
    : historicalBlocks.slice(-config.historyImageLimit))
    .map(block => attachmentKey(block.attachment)))
  for (const block of historicalBlocks) {
    const key = attachmentKey(block.attachment)
    let record = baseByAttachment.get(key)
    let source
    if (record !== undefined) {
      source = record.source
    } else {
      const reference = await evidenceManager.referenceFor(block, options.signal)
      source = reference.source
      record = reference.record
      if (record !== undefined) baseByAttachment.set(key, record)
    }
    const preserved = renderPreservedImageReference(
      record ?? { source, summary: 'Visual evidence is preserved and available for an on-demand reread.' },
      config.historySummaryChars,
    )
    preservedByAttachment.set(key, preserved)
    historicalEvidence.set(key, recentHistoryKeys.has(key) ? preserved : '')
    preservedEntries.push({
      imageSha256: source.sha256,
      attachment: block.attachment,
      ...(record?.evidence?.summary === undefined ? {} : { summary: record.evidence.summary }),
    })
    if (recentHistoryKeys.has(key)) {
      blockByHash.set(source.sha256, block)
      if (record !== undefined) baseByHash.set(source.sha256, record)
    }
  }

  const shadowed = shadowSessionImages(
    ctx,
    options.sessionId,
    preservedByAttachment,
    logger,
  )
  lookManager?.remember(shadowed.agent, preservedEntries)
  compactSessionHistory(ctx, options.sessionId, {
    historyImageLimit: config.historyImageLimit,
    browserHistoryLimit: config.browserHistoryLimit,
    desktopHistoryLimit: config.desktopHistoryLimit,
  }, logger)

  let messages = rewriteMessagesForBridge(
    options.messages,
    activeEvidence,
    historicalEvidence,
    {
      historyImageLimit: config.historyImageLimit,
      browserHistoryLimit: config.browserHistoryLimit,
      desktopHistoryLimit: config.desktopHistoryLimit,
    },
  )

  let injectedEvidenceTokens = 0
  for (const text of activeEvidence.values()) injectedEvidenceTokens += estimateInjectedTextTokens(text)
  for (const text of historicalEvidence.values()) injectedEvidenceTokens += estimateInjectedTextTokens(text)

  if (baseRecords.length === 0) {
    if (desktopFallbackCount === 0) {
      await usageTracker.recordBridgeEstimate(options.sessionId, injectedEvidenceTokens)
      yield* forwardText(ctx, { ...upstreamOptions, messages }, logger)
      return
    }
    const upstreamInfo = await ctx.llm.resolveModelInfo(
      config.upstreamProvider,
      upstreamModel,
      options.signal,
    )
    const guarded = await collectFinalWithBudget(ctx, {
      ...upstreamOptions,
      messages,
    }, upstreamInfo, logger)
    addUsage(totalUsage, guarded.result.usage)
    await usageTracker.recordCall(options.sessionId, 'upstreamFinal', guarded.result.usage)
    await usageTracker.recordBridgeEstimate(options.sessionId, injectedEvidenceTokens)
    yield* replayWithUsage(guarded.result.chunks, totalUsage)
    return
  }

  const allowedHashes = new Set(baseByHash.keys())
  const catalogRecords = [
    ...baseRecords,
    ...[...baseByHash.values()]
      .filter(record => !baseRecords.some(base => base.source.sha256 === record.source.sha256))
      .map(record => ({ ...record, summary: record.evidence.summary.slice(0, config.historySummaryChars) })),
  ]
  const system = appendSystem(options.system, clarificationInstruction(catalogRecords))
  const injectedSystemTokens = Math.max(
    0,
    estimateInjectedTextTokens(system) - estimateInjectedTextTokens(options.system ?? ''),
  )
  let injectedTargetTokens = 0
  const upstreamInfo = await ctx.llm.resolveModelInfo(
    config.upstreamProvider,
    upstreamModel,
    options.signal,
  )

  for (let clarificationCount = 0; ; clarificationCount += 1) {
    const guarded = await collectFinalWithBudget(ctx, {
      ...upstreamOptions,
      messages,
      system,
    }, upstreamInfo, logger)
    const upstream = guarded.result
    addUsage(totalUsage, upstream.usage)
    const request = parseClarificationRequest(upstream.text, allowedHashes)
    const bridgeEstimate = injectedEvidenceTokens + injectedSystemTokens + injectedTargetTokens
    if (request === undefined) {
      await usageTracker.recordCall(options.sessionId, 'upstreamFinal', upstream.usage)
      await usageTracker.recordBridgeEstimate(options.sessionId, bridgeEstimate)
      yield* replayWithUsage(upstream.chunks, totalUsage)
      return
    }
    await usageTracker.recordCall(options.sessionId, 'upstreamClarification', upstream.usage)
    await usageTracker.recordBridgeEstimate(options.sessionId, bridgeEstimate)
    if (clarificationCount >= config.maxClarifications) {
      throw new DeepSeekEyesError(
        `DeepSeek requested more than ${config.maxClarifications} visual clarification rounds`,
        'VISION_CLARIFICATION_LIMIT',
      )
    }
    const block = blockByHash.get(request.imageSha256)
    let baseRecord = baseByHash.get(request.imageSha256)
    if (block === undefined) {
      throw new DeepSeekEyesError('clarification request lost its original image reference', 'VISION_STATE_MISMATCH')
    }
    if (baseRecord === undefined) {
      const base = await router.run('base', {
        sessionId: options.sessionId,
        imageSha256: request.imageSha256,
        preferred: route,
      }, candidate => evidenceManager.baseFor(block, candidate, options.signal), options.signal)
      route = base.route
      addUsage(totalUsage, base.usage)
      await recordEvidenceUsage(usageTracker, options.sessionId, base, 'visionBase')
      baseRecord = base.record
      baseByHash.set(request.imageSha256, baseRecord)
    }
    const targeted = await router.run('target', {
      sessionId: options.sessionId,
      imageSha256: request.imageSha256,
      preferred: baseRecord.vision,
    }, candidate => evidenceManager.targetFor(
      block,
      baseRecord,
      request,
      candidate,
      options.signal,
    ), options.signal)
    route = targeted.route
    addUsage(totalUsage, targeted.usage)
    await recordEvidenceUsage(usageTracker, options.sessionId, targeted, 'visionTarget')
    const targetedText = renderTargetEvidence(targeted.record)
    injectedTargetTokens += estimateInjectedTextTokens(targetedText, { message: true })
    messages = [
      ...messages,
      pluginUserMessage(
        [{ type: 'text', text: targetedText }],
        'DeepSeekEyes 已补充视觉细节',
      ),
    ]
  }
}

/** Build the live-reconfigurable plain-object LLM adapter used by the out-of-tree DSH plugin. */
export function createDeepSeekEyesAdapter(ctx, rawConfig = {}) {
  const logger = ctx.logger ?? console
  let runtime = createRuntime(ctx, rawConfig, logger)
  const usage = new UsageTracker({
    enabled: runtime.config.usageStats,
    file: runtime.config.usageStatsPath,
    logger,
  })
  let lastCatalogFailure

  const state = {
    get config() { return runtime.config },
    get router() { return runtime.router },
    get cache() { return runtime.cache },
    get probe() { return runtime.probe },
    get evidenceManager() { return runtime.evidenceManager },
    get visionAttempts() { return runtime.visionAttempts },
    usage,
    reconfigure(nextConfig) {
      const next = createRuntime(ctx, nextConfig, logger)
      if (next.config.providerId !== runtime.config.providerId) {
        throw new TypeError('deepseekeyes: providerId is fixed for the lifetime of the registered adapter')
      }
      runtime = next
      state.usage.setEnabled(runtime.config.usageStats)
      state.browser?.reconfigure(runtime.config)
      state.desktop?.reconfigure(runtime.config)
      lastCatalogFailure = undefined
      return runtime.config
    },
    invalidate() {
      runtime.router.invalidate()
      runtime.probe.clear()
      lastCatalogFailure = undefined
    },
  }

  state.adapter = {
    providerInfo(provider) {
      return { id: provider, name: runtime.config.displayName }
    },
    providerRetryPolicy() {
      return undefined
    },
    async listModels() {
      const current = runtime
      let route
      try {
        route = await current.router.resolve()
        lastCatalogFailure = undefined
      } catch (error) {
        const message = errorMessage(error)
        if (message !== lastCatalogFailure) {
          logger.warn?.(`deepseekeyes: virtual model catalog is empty: ${message}`)
          lastCatalogFailure = message
        }
        return []
      }
      const models = await ctx.llm.listModels(current.config.upstreamProvider)
      return models
        .filter(model => !model.inputModalities?.includes('image'))
        .filter(model => current.config.upstreamModel === undefined
          || model.id === current.config.upstreamModel)
        .map(model => visionWrappedModel(model, current.config, route))
    },
    async resolveModel(_provider, model, signal) {
      const current = runtime
      const route = await current.router.resolve(signal)
      const upstreamModel = lockedUpstreamModel(current.config, model)
      const info = await ctx.llm.resolveModelInfo(current.config.upstreamProvider, upstreamModel, signal)
      if (info.inputModalities?.includes('image')) {
        throw new DeepSeekEyesError(
          `upstream model ${current.config.upstreamProvider}/${model} already accepts images and does not need DeepSeekEyes`,
          'UPSTREAM_ALREADY_MULTIMODAL',
        )
      }
      return visionWrappedModel(info, current.config, route)
    },
    stream(options) {
      return bridgeStream(ctx, runtime, options, state.look, state.usage, logger)
    },
  }

  return state
}

export function apply(ctx, rawConfig = {}) {
  const state = createDeepSeekEyesAdapter(ctx, rawConfig)
  ctx.llm.registerAdapter([state.config.providerId], state.adapter)
  state.look = applyLookTool(ctx, state)
  state.browser = applyBrowserComputerUse(ctx, state.config)
  state.desktop = applyDesktopComputerUse(ctx, state.config)

  if (typeof ctx.llm.registerConfigurableProviders === 'function') {
    ctx.llm.registerConfigurableProviders([{
      provider: state.config.providerId,
      displayName: state.config.displayName,
      settingsNs: SETTINGS_NAMESPACE,
      settingsPath: [],
    }])
  }
  installHarnessSettings(ctx, state, rawConfig)
  installUsageRpc(ctx, state.usage)

  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', () => {
      state.invalidate()
    })
  }
  return state
}

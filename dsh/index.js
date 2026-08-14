import { EvidenceCache } from '../src/cache.js'
import { applyBrowserComputerUse } from '../src/browser/index.js'
import {
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
import { EvidenceManager, VisionRouter } from '../src/vision.js'

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
  const router = new VisionRouter(ctx, config, logger)
  const cache = new EvidenceCache({
    directory: config.cacheDir,
    persistent: config.persistentEvidence,
    logger,
  })
  const probe = new VisionProbe(ctx, { enabled: config.activeProbe, logger })
  const evidenceManager = new EvidenceManager(ctx, config, cache, probe)
  return Object.freeze({ config, router, cache, probe, evidenceManager })
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

async function* bridgeStream(ctx, runtime, options, lookManager, logger) {
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
          },
        )
      : options.messages
    yield* forwardText(ctx, { ...upstreamOptions, messages }, logger)
    return
  }

  const activeBlocks = activeImageBlocks(options.messages)
  const historicalBlocks = historicalImageBlocks(options.messages)
  let route = activeBlocks.length === 0 ? undefined : await router.resolve(options.signal)
  const totalUsage = emptyUsage()
  const baseRecords = []
  const activeEvidence = new Map()
  const historicalEvidence = new Map()
  const preservedByAttachment = new Map()
  const preservedEntries = []
  const blockByHash = new Map()
  const baseByHash = new Map()
  const baseByAttachment = new Map()

  for (const block of activeBlocks) {
    const result = await evidenceManager.baseFor(block, route, options.signal)
    addUsage(totalUsage, result.usage)
    baseRecords.push(result.record)
    const key = attachmentKey(block.attachment)
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
  }, logger)

  let messages = rewriteMessagesForBridge(
    options.messages,
    activeEvidence,
    historicalEvidence,
    {
      historyImageLimit: config.historyImageLimit,
      browserHistoryLimit: config.browserHistoryLimit,
    },
  )

  if (activeBlocks.length === 0) {
    yield* forwardText(ctx, { ...upstreamOptions, messages }, logger)
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
    if (request === undefined) {
      yield* replayWithUsage(upstream.chunks, totalUsage)
      return
    }
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
    if (route === undefined) route = await router.resolve(options.signal)
    if (baseRecord === undefined) {
      const base = await evidenceManager.baseFor(block, route, options.signal)
      addUsage(totalUsage, base.usage)
      baseRecord = base.record
      baseByHash.set(request.imageSha256, baseRecord)
    }
    const targeted = await evidenceManager.targetFor(block, baseRecord, request, route, options.signal)
    addUsage(totalUsage, targeted.usage)
    messages = [
      ...messages,
      pluginUserMessage(
        [{ type: 'text', text: renderTargetEvidence(targeted.record) }],
        'DeepSeekEyes 已补充视觉细节',
      ),
    ]
  }
}

/** Build the live-reconfigurable plain-object LLM adapter used by the out-of-tree DSH plugin. */
export function createDeepSeekEyesAdapter(ctx, rawConfig = {}) {
  const logger = ctx.logger ?? console
  let runtime = createRuntime(ctx, rawConfig, logger)
  let lastCatalogFailure

  const state = {
    get config() { return runtime.config },
    get router() { return runtime.router },
    get cache() { return runtime.cache },
    get probe() { return runtime.probe },
    get evidenceManager() { return runtime.evidenceManager },
    reconfigure(nextConfig) {
      const next = createRuntime(ctx, nextConfig, logger)
      if (next.config.providerId !== runtime.config.providerId) {
        throw new TypeError('deepseekeyes: providerId is fixed for the lifetime of the registered adapter')
      }
      runtime = next
      state.browser?.reconfigure(runtime.config)
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
      return bridgeStream(ctx, runtime, options, state.look, logger)
    },
  }

  return state
}

export function apply(ctx, rawConfig = {}) {
  const state = createDeepSeekEyesAdapter(ctx, rawConfig)
  ctx.llm.registerAdapter([state.config.providerId], state.adapter)
  state.look = applyLookTool(ctx, state)
  state.browser = applyBrowserComputerUse(ctx, state.config)

  if (typeof ctx.llm.registerConfigurableProviders === 'function') {
    ctx.llm.registerConfigurableProviders([{
      provider: state.config.providerId,
      displayName: state.config.displayName,
      settingsNs: SETTINGS_NAMESPACE,
      settingsPath: [],
    }])
  }
  installHarnessSettings(ctx, state, rawConfig)

  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', () => {
      state.invalidate()
    })
  }
  return state
}

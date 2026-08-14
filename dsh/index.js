import { EvidenceCache } from '../src/cache.js'
import {
  attachmentKey,
  messagesHaveImages,
  pluginUserMessage,
  replaceImagesWithEvidence,
  uniqueImageBlocks,
} from '../src/content.js'
import { resolveConfig } from '../src/config.js'
import { DeepSeekEyesError, errorMessage } from '../src/error.js'
import { VisionProbe } from '../src/probe.js'
import {
  clarificationInstruction,
  parseClarificationRequest,
  renderBaseEvidence,
  renderTargetEvidence,
} from '../src/protocol.js'
import { installHarnessSettings, SETTINGS_NAMESPACE } from '../src/settings.js'
import { addUsage, collectStream, emptyUsage, replayWithUsage } from '../src/stream.js'
import { EvidenceManager, VisionRouter } from '../src/vision.js'

export const name = 'deepseekeyes'
export const inject = ['llm', 'attachments']

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

async function* bridgeStream(ctx, runtime, options) {
  const { config, router, evidenceManager } = runtime
  const upstreamModel = lockedUpstreamModel(config, options.model)
  const upstreamOptions = {
    ...options,
    provider: config.upstreamProvider,
    ...(upstreamModel === undefined ? {} : { model: upstreamModel }),
  }
  if (!messagesHaveImages(options.messages)) {
    yield* ctx.llm.stream(upstreamOptions)
    return
  }

  const route = await router.resolve(options.signal)
  const totalUsage = emptyUsage()
  const baseRecords = []
  const evidenceByAttachment = new Map()
  const blockByHash = new Map()
  const baseByHash = new Map()

  for (const block of uniqueImageBlocks(options.messages)) {
    const result = await evidenceManager.baseFor(block, route, options.signal)
    addUsage(totalUsage, result.usage)
    baseRecords.push(result.record)
    evidenceByAttachment.set(attachmentKey(block.attachment), renderBaseEvidence(result.record))
    blockByHash.set(result.record.source.sha256, block)
    baseByHash.set(result.record.source.sha256, result.record)
  }

  let messages = replaceImagesWithEvidence(options.messages, evidenceByAttachment)
  const allowedHashes = new Set(baseByHash.keys())
  const system = appendSystem(options.system, clarificationInstruction(baseRecords))

  for (let clarificationCount = 0; ; clarificationCount += 1) {
    const upstream = await collectStream(ctx.llm.stream({
      ...upstreamOptions,
      messages,
      system,
    }))
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
    const baseRecord = baseByHash.get(request.imageSha256)
    if (block === undefined || baseRecord === undefined) {
      throw new DeepSeekEyesError('clarification request lost its original image reference', 'VISION_STATE_MISMATCH')
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
      return bridgeStream(ctx, runtime, options)
    },
  }

  return state
}

export function apply(ctx, rawConfig = {}) {
  const state = createDeepSeekEyesAdapter(ctx, rawConfig)
  ctx.llm.registerAdapter([state.config.providerId], state.adapter)

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

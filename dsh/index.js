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
import { addUsage, collectStream, emptyUsage, replayWithUsage } from '../src/stream.js'
import { EvidenceManager, VisionRouter } from '../src/vision.js'

export const name = 'deepseekeyes'
export const inject = ['llm', 'attachments']

function appendSystem(system, addition) {
  return `${system ?? ''}${system === undefined || system === '' ? '' : '\n\n'}--- DeepSeekEyes private visual protocol ---\n${addition}`
}

function visionWrappedModel(info, config) {
  return {
    ...info,
    provider: config.providerId,
    name: `${info.name ?? info.id} + Eyes`,
    description: 'DeepSeek text reasoning with a verified Harness multimodal model as its visual evidence source',
    inputModalities: ['text', 'image'],
  }
}

async function* bridgeStream(ctx, config, router, evidenceManager, options) {
  if (!messagesHaveImages(options.messages)) {
    yield* ctx.llm.stream({ ...options, provider: config.upstreamProvider })
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
      ...options,
      provider: config.upstreamProvider,
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

/** Build the plain-object LLM adapter used by the out-of-tree DSH plugin. */
export function createDeepSeekEyesAdapter(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger ?? console
  const router = new VisionRouter(ctx, config, logger)
  const cache = new EvidenceCache({
    directory: config.cacheDir,
    persistent: config.persistentEvidence,
    logger,
  })
  const probe = new VisionProbe(ctx, { enabled: config.activeProbe, logger })
  const evidenceManager = new EvidenceManager(ctx, config, cache, probe)
  let lastCatalogFailure

  const adapter = {
    providerInfo(provider) {
      return { id: provider, name: config.displayName }
    },
    providerRetryPolicy() {
      return undefined
    },
    async listModels() {
      try {
        await router.resolve()
        lastCatalogFailure = undefined
      } catch (error) {
        const message = errorMessage(error)
        if (message !== lastCatalogFailure) {
          logger.warn?.(`deepseekeyes: virtual model catalog is empty: ${message}`)
          lastCatalogFailure = message
        }
        return []
      }
      const models = await ctx.llm.listModels(config.upstreamProvider)
      return models
        .filter((model) => !model.inputModalities?.includes('image'))
        .map((model) => visionWrappedModel(model, config))
    },
    async resolveModel(_provider, model, signal) {
      await router.resolve(signal)
      const info = await ctx.llm.resolveModelInfo(config.upstreamProvider, model, signal)
      if (info.inputModalities?.includes('image')) {
        throw new DeepSeekEyesError(
          `upstream model ${config.upstreamProvider}/${model} already accepts images and does not need DeepSeekEyes`,
          'UPSTREAM_ALREADY_MULTIMODAL',
        )
      }
      return visionWrappedModel(info, config)
    },
    stream(options) {
      return bridgeStream(ctx, config, router, evidenceManager, options)
    },
  }

  return { adapter, config, router, cache, probe, evidenceManager }
}

export function apply(ctx, rawConfig = {}) {
  const state = createDeepSeekEyesAdapter(ctx, rawConfig)
  ctx.llm.registerAdapter([state.config.providerId], state.adapter)
  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', () => {
      state.router.invalidate()
      state.probe.clear()
    })
  }
}

import { createHash } from 'node:crypto'
import { pluginUserMessage } from './content.js'
import { DeepSeekEyesError, errorMessage } from './error.js'
import {
  baseEvidencePrompt,
  evidenceCacheKey,
  parseJsonObject,
  targetEvidencePrompt,
  validateBaseEvidence,
  validateTargetEvidence,
} from './protocol.js'
import { addUsage, collectStream, emptyUsage } from './stream.js'

function acceptsVisionPrompt(info) {
  return Array.isArray(info?.inputModalities)
    && info.inputModalities.includes('text')
    && info.inputModalities.includes('image')
}

/** Resolve an existing Harness provider/model that explicitly declares image input. */
export class VisionRouter {
  constructor(ctx, config, logger = console) {
    this.ctx = ctx
    this.config = config
    this.logger = logger
    this.pending = undefined
  }

  invalidate() {
    this.pending = undefined
  }

  resolve(signal) {
    if (this.pending === undefined) {
      this.pending = this.find(signal).catch((error) => {
        this.pending = undefined
        throw error
      })
    }
    return this.pending
  }

  async exact(provider, model, signal) {
    if (provider === this.config.providerId) {
      throw new DeepSeekEyesError('the DeepSeekEyes virtual provider cannot be its own eye', 'VISION_ROUTE_RECURSION')
    }
    const info = await this.ctx.llm.resolveModelInfo(provider, model, signal)
    if (!acceptsVisionPrompt(info)) {
      throw new DeepSeekEyesError(
        `configured eye ${provider}/${model} does not explicitly declare both text and image input`,
        'VISION_MODEL_NOT_MULTIMODAL',
      )
    }
    return Object.freeze({ provider, model, name: info.name ?? model, inputModalities: [...info.inputModalities] })
  }

  async firstOnProvider(provider, signal) {
    if (provider === this.config.providerId) {
      throw new DeepSeekEyesError('the DeepSeekEyes virtual provider cannot be its own eye', 'VISION_ROUTE_RECURSION')
    }
    const models = await this.ctx.llm.listModels(provider)
    for (const model of models) {
      if (!acceptsVisionPrompt(model)) continue
      return this.exact(provider, model.id, signal)
    }
    throw new DeepSeekEyesError(
      `provider ${provider} has no configured model that declares image input`,
      'NO_VISION_MODEL',
    )
  }

  async find(signal) {
    if (this.config.visionProvider !== undefined) {
      const route = await (this.config.visionModel === undefined
        ? this.firstOnProvider(this.config.visionProvider, signal)
        : this.exact(this.config.visionProvider, this.config.visionModel, signal))
      this.logger.info?.(`deepseekeyes: selected configured visual route ${route.provider}/${route.model}`)
      return route
    }
    if (!this.config.autoDetectVision) {
      throw new DeepSeekEyesError(
        'no visual provider/model is configured and automatic detection is disabled',
        'NO_VISION_MODEL',
      )
    }
    const failures = []
    for (const provider of this.ctx.llm.listProviders()) {
      if (provider.id === this.config.providerId) continue
      try {
        const models = await this.ctx.llm.listModels(provider.id)
        for (const model of models) {
          if (!acceptsVisionPrompt(model)) continue
          const route = await this.exact(provider.id, model.id, signal)
          this.logger.info?.(`deepseekeyes: auto-selected visual route ${route.provider}/${route.model}`)
          return route
        }
      } catch (error) {
        failures.push(`${provider.id}: ${errorMessage(error)}`)
      }
    }
    throw new DeepSeekEyesError(
      `no configured Harness model explicitly declares image input${
        failures.length === 0 ? '' : `; inspected providers: ${failures.join(' | ')}`
      }`,
      'NO_VISION_MODEL',
    )
  }
}

/** Re-read and hash the immutable bytes behind one Harness image block. */
export async function readImageSource(ctx, block, signal) {
  const stored = await ctx.attachments.readImage(block.attachment, signal)
  if (!(stored?.data instanceof Uint8Array)) {
    throw new DeepSeekEyesError('attachment store returned no verified image bytes', 'ATTACHMENT_READ_FAILED')
  }
  const data = Buffer.from(stored.data)
  const ref = stored.ref ?? block.attachment
  return Object.freeze({
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: data.byteLength,
    width: ref.width,
    height: ref.height,
    sha256: createHash('sha256').update(data).digest('hex'),
  })
}

function baseRecordLooksUsable(record, source, route) {
  return record?.kind === 'base'
    && record.source?.sha256 === source.sha256
    && record.vision?.provider === route.provider
    && record.vision?.model === route.model
    && record.evidence?.schemaVersion === 'deepseekeyes.evidence.v1'
}

function targetRecordLooksUsable(record, source, route, question) {
  return record?.kind === 'target'
    && record.source?.sha256 === source.sha256
    && record.vision?.provider === route.provider
    && record.vision?.model === route.model
    && record.question === question
    && record.evidence?.schemaVersion === 'deepseekeyes.target.v1'
}

/** Produces append-only base and clarification records from original image references. */
export class EvidenceManager {
  constructor(ctx, config, cache, probe) {
    this.ctx = ctx
    this.config = config
    this.cache = cache
    this.probe = probe
  }

  async baseFor(block, route, signal) {
    const source = await readImageSource(this.ctx, block, signal)
    const key = evidenceCacheKey('base', source.sha256, route)
    const totalUsage = emptyUsage()
    const proof = await this.probe.ensure(route, signal)
    addUsage(totalUsage, proof.usage)
    const cached = await this.cache.read(key)
    if (baseRecordLooksUsable(cached, source, route)) {
      try {
        validateBaseEvidence(cached.evidence)
        return { record: cached, usage: totalUsage }
      } catch {
        // Regenerate a structurally incomplete record under the same immutable key.
      }
    }

    const result = await collectStream(this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: 'You are the visual evidence component of DeepSeekEyes. Observe pixels literally and return strict JSON.',
      messages: [pluginUserMessage([
        { type: 'image', attachment: block.attachment },
        { type: 'text', text: baseEvidencePrompt(source) },
      ], 'DeepSeekEyes 基础视觉读取')],
      temperature: 0,
      maxTokens: this.config.baseMaxTokens,
      signal,
    }))
    addUsage(totalUsage, result.usage)
    const evidence = validateBaseEvidence(parseJsonObject(result.text, 'base visual evidence'))
    const record = await this.cache.write(key, {
      recordVersion: 1,
      kind: 'base',
      createdAt: new Date().toISOString(),
      source,
      vision: {
        provider: route.provider,
        model: route.model,
        validation: proof.validation,
      },
      evidence,
    })
    return { record, usage: totalUsage }
  }

  async targetFor(block, baseRecord, request, route, signal) {
    const discriminator = JSON.stringify({ question: request.question, region: request.region })
    const key = evidenceCacheKey('target', baseRecord.source.sha256, route, discriminator)
    const cached = await this.cache.read(key)
    if (targetRecordLooksUsable(cached, baseRecord.source, route, request.question)) {
      try {
        validateTargetEvidence(cached.evidence)
        return { record: cached, usage: emptyUsage() }
      } catch {
        // Regenerate a structurally incomplete record under the same immutable key.
      }
    }
    const result = await collectStream(this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: 'You are the visual clarification component of DeepSeekEyes. Re-read the original pixels and return strict JSON.',
      messages: [pluginUserMessage([
        { type: 'image', attachment: block.attachment },
        { type: 'text', text: targetEvidencePrompt(baseRecord.source, request) },
      ], 'DeepSeekEyes 视觉细节核对')],
      temperature: 0,
      maxTokens: this.config.targetMaxTokens,
      signal,
    }))
    const evidence = validateTargetEvidence(parseJsonObject(result.text, 'target visual evidence'))
    const record = await this.cache.write(key, {
      recordVersion: 1,
      kind: 'target',
      createdAt: new Date().toISOString(),
      source: baseRecord.source,
      vision: {
        provider: route.provider,
        model: route.model,
        validation: baseRecord.vision.validation,
      },
      question: request.question,
      ...(request.region === undefined ? {} : { region: request.region }),
      evidence,
    })
    return { record, usage: result.usage }
  }
}

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

function routeKey(route) {
  return `${route.provider}\0${route.model}`
}

function failureCode(error) {
  if (typeof error?.code === 'string' && error.code !== '') return error.code
  if (typeof error?.name === 'string' && error.name !== '') return error.name
  return 'VISION_ROUTE_ERROR'
}

function failoverEligible(error, signal) {
  if (signal?.aborted) return false
  return ![
    'ATTACHMENT_READ_FAILED',
    'EVIDENCE_PERSIST_FAILED',
    'VISION_STATE_MISMATCH',
    'UNKNOWN_PRESERVED_IMAGE',
  ].includes(failureCode(error))
}

function publicAttempts(attempts) {
  return attempts.map(attempt => ({
    timestamp: attempt.timestamp,
    provider: attempt.provider,
    model: attempt.model,
    priority: attempt.priority,
    failoverIndex: attempt.failoverIndex,
    phase: attempt.phase,
    status: attempt.status,
    durationMs: attempt.durationMs,
    ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
  }))
}

function resultWithAttempts(result, route, attempts) {
  const routeAttempts = publicAttempts(attempts)
  if (result?.record === undefined) return { ...result, route, routeAttempts }
  return {
    ...result,
    route,
    routeAttempts,
    record: {
      ...structuredClone(result.record),
      vision: {
        ...structuredClone(result.record.vision),
        attempts: routeAttempts,
      },
    },
  }
}

/** Resolve ordered Harness vision routes, health-check them and execute bounded failover. */
export class VisionRouter {
  constructor(ctx, config, logger = console, attempts) {
    this.ctx = ctx
    this.config = config
    this.logger = logger
    this.attempts = attempts
    this.pending = undefined
    this.metadata = new Map()
    this.health = new Map()
  }

  invalidate() {
    this.pending = undefined
    this.metadata.clear()
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
    const key = routeKey({ provider, model })
    const cached = this.metadata.get(key)
    if (this.config.visionHealthCheck && cached?.expiresAt > Date.now()) return cached.route
    const info = await this.ctx.llm.resolveModelInfo(provider, model, signal)
    if (!acceptsVisionPrompt(info)) {
      throw new DeepSeekEyesError(
        `configured eye ${provider}/${model} does not explicitly declare both text and image input`,
        'VISION_MODEL_NOT_MULTIMODAL',
      )
    }
    const route = Object.freeze({
      provider,
      model,
      name: info.name ?? model,
      inputModalities: [...info.inputModalities],
    })
    if (this.config.visionHealthCheck) {
      this.metadata.set(key, { route, expiresAt: Date.now() + this.config.visionHealthTtlMs })
    }
    return route
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

  async routeSeeds(signal, preferred) {
    const seeds = []
    const seen = new Set()
    const add = (provider, model, source) => {
      if (provider === undefined || provider === this.config.providerId) return
      const key = `${provider}\0${model ?? '*'}`
      if (seen.has(key)) return
      seen.add(key)
      seeds.push(Object.freeze({ provider, model, source, priority: seeds.length }))
    }
    add(preferred?.provider, preferred?.model, 'preferred')
    add(this.config.visionProvider, this.config.visionModel, 'configured')
    for (const route of this.config.visionPriorityRoutes) add(route.provider, route.model, 'priority')
    if (this.config.autoDetectVision) {
      for (const provider of this.ctx.llm.listProviders()) {
        if (provider.id === this.config.providerId) continue
        try {
          const models = await this.ctx.llm.listModels(provider.id)
          for (const model of models) {
            if (acceptsVisionPrompt(model)) add(provider.id, model.id, 'auto')
          }
        } catch (error) {
          this.logger.warn?.(`deepseekeyes: visual provider scan failed for ${provider.id}: ${errorMessage(error)}`)
        }
      }
    }
    if (seeds.length === 0 && !this.config.autoDetectVision) {
      throw new DeepSeekEyesError(
        'no visual route is configured and automatic detection is disabled',
        'NO_VISION_MODEL',
      )
    }
    return seeds
  }

  routeFromSeed(seed, signal) {
    return seed.model === undefined
      ? this.firstOnProvider(seed.provider, signal)
      : this.exact(seed.provider, seed.model, signal)
  }

  isCircuitOpen(route, now = Date.now()) {
    return (this.health.get(routeKey(route))?.openUntil ?? 0) > now
  }

  markSuccess(route) {
    const key = routeKey(route)
    const previous = this.health.get(key) ?? { failures: 0, successes: 0, consecutiveFailures: 0 }
    this.health.set(key, {
      ...previous,
      successes: previous.successes + 1,
      consecutiveFailures: 0,
      lastSuccessAt: new Date().toISOString(),
      openUntil: 0,
    })
  }

  markFailure(route) {
    const key = routeKey(route)
    const previous = this.health.get(key) ?? { failures: 0, successes: 0, consecutiveFailures: 0 }
    this.health.set(key, {
      ...previous,
      failures: previous.failures + 1,
      consecutiveFailures: previous.consecutiveFailures + 1,
      lastFailureAt: new Date().toISOString(),
      openUntil: Date.now() + this.config.visionFailureCooldownMs,
    })
    this.pending = undefined
  }

  healthSnapshot() {
    return [...this.health.entries()].map(([key, value]) => {
      const [provider, model] = key.split('\0')
      return { provider, model, ...structuredClone(value), circuitOpen: value.openUntil > Date.now() }
    })
  }

  async find(signal) {
    const seeds = await this.routeSeeds(signal)
    const failures = []
    for (const seed of seeds) {
      try {
        const route = await this.routeFromSeed(seed, signal)
        if (this.isCircuitOpen(route)) continue
        this.logger.info?.(`deepseekeyes: selected visual route ${route.provider}/${route.model}`)
        return route
      } catch (error) {
        failures.push({ seed, error })
      }
    }
    if (failures.length === 1 && seeds.length === 1) throw failures[0].error
    throw new DeepSeekEyesError(
      `no configured Harness model explicitly declares image input${
        failures.length === 0
          ? ''
          : `; inspected routes: ${failures.map(({ seed, error }) => `${seed.provider}/${seed.model ?? '*'}: ${errorMessage(error)}`).join(' | ')}`
      }`,
      'NO_VISION_MODEL',
    )
  }

  async recordAttempt(input) {
    const attempt = { timestamp: new Date().toISOString(), ...input }
    return this.attempts === undefined ? attempt : this.attempts.record(attempt)
  }

  /** Execute one visual operation through ordered routes with bounded failover. */
  async run(operation, context, callback, signal) {
    const seeds = await this.routeSeeds(signal, context?.preferred)
    const attempts = []
    const attemptedRoutes = new Set()
    const maximum = 1 + this.config.visionFailoverAttempts
    let failoverIndex = 0
    let lastError
    let openFallback

    for (const seed of seeds) {
      if (failoverIndex >= maximum) break
      const started = Date.now()
      let route
      try {
        route = await this.routeFromSeed(seed, signal)
      } catch (error) {
        lastError = error
        attempts.push(await this.recordAttempt({
          operation,
          provider: seed.provider,
          model: seed.model ?? '*',
          priority: seed.priority,
          failoverIndex,
          phase: 'health',
          status: 'failed',
          durationMs: Date.now() - started,
          errorCode: failureCode(error),
          sessionId: context?.sessionId,
          imageSha256: context?.imageSha256,
        }))
        failoverIndex += 1
        if (!failoverEligible(error, signal)) throw error
        continue
      }

      const key = routeKey(route)
      if (attemptedRoutes.has(key)) continue
      attemptedRoutes.add(key)
      if (this.isCircuitOpen(route)) {
        openFallback ??= { seed, route }
        attempts.push(await this.recordAttempt({
          operation,
          provider: route.provider,
          model: route.model,
          priority: seed.priority,
          failoverIndex,
          phase: 'circuit',
          status: 'skipped-open-circuit',
          durationMs: Date.now() - started,
          sessionId: context?.sessionId,
          imageSha256: context?.imageSha256,
        }))
        continue
      }

      try {
        const result = await callback(route)
        this.markSuccess(route)
        attempts.push(await this.recordAttempt({
          operation,
          provider: route.provider,
          model: route.model,
          priority: seed.priority,
          failoverIndex,
          phase: 'operation',
          status: result?.cacheHit ? 'cache-hit' : 'success',
          durationMs: Date.now() - started,
          sessionId: context?.sessionId,
          imageSha256: context?.imageSha256,
        }))
        return resultWithAttempts(result, route, attempts)
      } catch (error) {
        lastError = error
        this.markFailure(route)
        attempts.push(await this.recordAttempt({
          operation,
          provider: route.provider,
          model: route.model,
          priority: seed.priority,
          failoverIndex,
          phase: 'operation',
          status: 'failed',
          durationMs: Date.now() - started,
          errorCode: failureCode(error),
          sessionId: context?.sessionId,
          imageSha256: context?.imageSha256,
        }))
        failoverIndex += 1
        if (!failoverEligible(error, signal)) throw error
        this.logger.warn?.(
          `deepseekeyes: ${operation} failed on ${route.provider}/${route.model}; trying next visual route`,
        )
      }
    }

    if (failoverIndex < maximum && openFallback !== undefined) {
      const { seed, route } = openFallback
      const started = Date.now()
      try {
        const result = await callback(route)
        this.markSuccess(route)
        attempts.push(await this.recordAttempt({
          operation,
          provider: route.provider,
          model: route.model,
          priority: seed.priority,
          failoverIndex,
          phase: 'operation',
          status: result?.cacheHit ? 'cache-hit' : 'success',
          durationMs: Date.now() - started,
          sessionId: context?.sessionId,
          imageSha256: context?.imageSha256,
        }))
        return resultWithAttempts(result, route, attempts)
      } catch (error) {
        lastError = error
        this.markFailure(route)
        attempts.push(await this.recordAttempt({
          operation,
          provider: route.provider,
          model: route.model,
          priority: seed.priority,
          failoverIndex,
          phase: 'operation',
          status: 'failed',
          durationMs: Date.now() - started,
          errorCode: failureCode(error),
          sessionId: context?.sessionId,
          imageSha256: context?.imageSha256,
        }))
        failoverIndex += 1
      }
    }

    const failedAttempts = attempts.filter(attempt => attempt.status === 'failed')
    if (failedAttempts.length === 1 && lastError !== undefined) {
      lastError.attempts = publicAttempts(attempts)
      throw lastError
    }
    const exhausted = new DeepSeekEyesError(
      `visual route failover exhausted after ${failoverIndex} failed attempt(s)`,
      'VISION_FAILOVER_EXHAUSTED',
      { cause: lastError },
    )
    exhausted.attempts = publicAttempts(attempts)
    throw exhausted
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
    ...(ref.name === undefined ? {} : { name: ref.name }),
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

function tokenBudget(maxTokens) {
  return maxTokens === 0 ? {} : { maxTokens }
}

/** Produces append-only base and clarification records from original image references. */
export class EvidenceManager {
  constructor(ctx, config, cache, probe) {
    this.ctx = ctx
    this.config = config
    this.cache = cache
    this.probe = probe
    this.baseBySha = new Map()
    this.baseByAttachment = new Map()
  }

  rememberBase(record) {
    this.baseBySha.set(record.source.sha256, record)
    this.baseByAttachment.set(record.source.attachmentId, record)
    return record
  }

  knownBase(imageSha256) {
    const record = this.baseBySha.get(imageSha256)
    return record === undefined ? undefined : structuredClone(record)
  }

  async referenceFor(block, signal) {
    const source = await readImageSource(this.ctx, block, signal)
    const record = this.baseBySha.get(source.sha256)
      ?? this.baseByAttachment.get(source.attachmentId)
    return {
      source,
      ...(record === undefined ? {} : { record: structuredClone(record) }),
    }
  }

  async cachedBaseFor(block, route, signal) {
    const source = await readImageSource(this.ctx, block, signal)
    const key = evidenceCacheKey('base', source.sha256, route)
    const cached = await this.cache.read(key)
    if (!baseRecordLooksUsable(cached, source, route)) return { source }
    try {
      validateBaseEvidence(cached.evidence)
      return { source, record: structuredClone(this.rememberBase(cached)) }
    } catch {
      return { source }
    }
  }

  async baseFor(block, route, signal) {
    const source = await readImageSource(this.ctx, block, signal)
    const key = evidenceCacheKey('base', source.sha256, route)
    const totalUsage = emptyUsage()
    const cached = await this.cache.read(key)
    if (baseRecordLooksUsable(cached, source, route)) {
      try {
        validateBaseEvidence(cached.evidence)
        return {
          record: structuredClone(this.rememberBase(cached)),
          usage: totalUsage,
          cacheHit: true,
          usageBreakdown: { probe: emptyUsage(), model: emptyUsage() },
        }
      } catch {
        // Regenerate a structurally incomplete record under the same immutable key.
      }
    }

    const proof = await this.probe.ensure(route, signal)
    addUsage(totalUsage, proof.usage)

    const result = await collectStream(this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: 'You are the visual evidence component of DeepSeekEyes. Observe pixels literally and return strict JSON.',
      messages: [pluginUserMessage([
        { type: 'image', attachment: block.attachment },
        { type: 'text', text: baseEvidencePrompt(source) },
      ], 'DeepSeekEyes 基础视觉读取')],
      temperature: 0,
      ...tokenBudget(this.config.baseMaxTokens),
      signal,
    }))
    addUsage(totalUsage, result.usage)
    const evidence = validateBaseEvidence(parseJsonObject(result.text, 'base visual evidence'))
    const record = this.rememberBase(await this.cache.write(key, {
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
    }))
    return {
      record,
      usage: totalUsage,
      cacheHit: false,
      usageBreakdown: { probe: proof.usage, model: result.usage },
    }
  }

  async targetFor(block, baseRecord, request, route, signal) {
    const discriminator = JSON.stringify({ question: request.question, region: request.region })
    const key = evidenceCacheKey('target', baseRecord.source.sha256, route, discriminator)
    const cached = await this.cache.read(key)
    if (targetRecordLooksUsable(cached, baseRecord.source, route, request.question)) {
      try {
        validateTargetEvidence(cached.evidence)
        return {
          record: cached,
          usage: emptyUsage(),
          cacheHit: true,
          usageBreakdown: { probe: emptyUsage(), model: emptyUsage() },
        }
      } catch {
        // Regenerate a structurally incomplete record under the same immutable key.
      }
    }
    const proof = await this.probe.ensure(route, signal)
    const result = await collectStream(this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: 'You are the visual clarification component of DeepSeekEyes. Re-read the original pixels and return strict JSON.',
      messages: [pluginUserMessage([
        { type: 'image', attachment: block.attachment },
        { type: 'text', text: targetEvidencePrompt(baseRecord.source, request) },
      ], 'DeepSeekEyes 视觉细节核对')],
      temperature: 0,
      ...tokenBudget(this.config.targetMaxTokens),
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
        validation: proof.validation,
      },
      question: request.question,
      ...(request.region === undefined ? {} : { region: request.region }),
      evidence,
    })
    const usage = emptyUsage()
    addUsage(usage, proof.usage)
    addUsage(usage, result.usage)
    return {
      record,
      usage,
      cacheHit: false,
      usageBreakdown: { probe: proof.usage, model: result.usage },
    }
  }
}

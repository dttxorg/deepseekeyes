import { DeepSeekEyesError } from './error.js'
import { preservedImageReferences } from './protocol.js'
import { addUsage, emptyUsage } from './stream.js'
import { estimateInjectedTextTokens } from './usage.js'

export const LOOK_TOOL_NAME = 'deepseekeyes_look'

export const LOOK_TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['imageSha256', 'question'],
  properties: {
    imageSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    question: { type: 'string', minLength: 1, maxLength: 2000 },
    region: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      },
    },
  },
})

function parseRegion(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('deepseekeyes look: region must be an object')
  }
  const region = Object.fromEntries(['x', 'y', 'width', 'height'].map(field => [field, value[field]]))
  if (!Object.values(region).every(number => typeof number === 'number' && Number.isFinite(number))
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) {
    throw new RangeError('deepseekeyes look: region must fit normalized image coordinates')
  }
  return region
}

function parseArgs(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('deepseekeyes look: arguments must be an object')
  }
  if (typeof input.imageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.imageSha256)) {
    throw new TypeError('deepseekeyes look: imageSha256 must be a lowercase SHA-256 digest')
  }
  if (typeof input.question !== 'string' || input.question.trim() === '' || input.question.length > 2000) {
    throw new TypeError('deepseekeyes look: question must contain 1 to 2000 characters')
  }
  const region = parseRegion(input.region)
  return {
    imageSha256: input.imageSha256,
    question: input.question.trim(),
    ...(region === undefined ? {} : { region }),
  }
}

function referencesFrom(agent) {
  return preservedImageReferences(agent?.session?.deriveMessages?.() ?? [])
}

function usageHasTokens(usage) {
  return usage !== undefined && Object.values(usage).some(value => typeof value === 'number' && value > 0)
}

async function recordEvidenceUsage(tracker, sessionId, result, category) {
  if (result.cacheHit) {
    await tracker.recordCacheHit(sessionId)
    return
  }
  if (usageHasTokens(result.usageBreakdown?.probe)) {
    await tracker.recordCall(sessionId, 'visionProbe', result.usageBreakdown.probe)
  }
  await tracker.recordCall(sessionId, category, result.usageBreakdown?.model ?? result.usage)
}

export const LOOK_SYSTEM_PROMPT = `## DeepSeekEyes preserved images

Some earlier image blocks may appear as compact "[DeepSeekEyes preserved image]" records. The original attachment bytes are still available. For a normal text task, do not call a visual model. Only when the current request needs a visual fact missing from the compact summary, call deepseekeyes_look with that record's imageSha256 and one precise question. Ask for one detail at a time and use a normalized region when it reduces visual work.`

export class LookToolManager {
  constructor(ctx, state) {
    this.ctx = ctx
    this.state = state
    this.references = new Map()
    this.disposers = new Map()
  }

  sessionKey(agent) {
    return String(agent?.id ?? '')
  }

  remember(agent, entries) {
    if (agent === undefined) return
    const key = this.sessionKey(agent)
    const found = this.references.get(key) ?? new Map()
    for (const entry of entries) found.set(entry.imageSha256, structuredClone(entry))
    this.references.set(key, found)
    this.ensureInstalled(agent)
  }

  reference(agent, imageSha256) {
    const key = this.sessionKey(agent)
    let found = this.references.get(key)
    if (found?.has(imageSha256)) return found.get(imageSha256)
    found = new Map(referencesFrom(agent).map(entry => [entry.imageSha256, entry]))
    this.references.set(key, found)
    return found.get(imageSha256)
  }

  async execute(input, exec = {}) {
    const request = parseArgs(input)
    const reference = this.reference(exec.agent, request.imageSha256)
    if (reference === undefined) {
      throw new DeepSeekEyesError('requested image hash is not preserved in this session', 'UNKNOWN_PRESERVED_IMAGE')
    }
    const route = await this.state.router.resolve(exec.signal)
    const sessionId = this.sessionKey(exec.agent)
    await this.state.usage.recordLookCall(sessionId)
    const block = { type: 'image', attachment: reference.attachment }
    const totalUsage = emptyUsage()
    let baseRecord = this.state.evidenceManager.knownBase(request.imageSha256)
    if (baseRecord === undefined) {
      const base = await this.state.evidenceManager.baseFor(block, route, exec.signal)
      addUsage(totalUsage, base.usage)
      await recordEvidenceUsage(this.state.usage, sessionId, base, 'visionBase')
      baseRecord = base.record
    }
    if (baseRecord.source.sha256 !== request.imageSha256) {
      throw new DeepSeekEyesError('preserved attachment bytes no longer match the requested hash', 'VISION_STATE_MISMATCH')
    }
    const target = await this.state.evidenceManager.targetFor(block, baseRecord, request, route, exec.signal)
    addUsage(totalUsage, target.usage)
    await recordEvidenceUsage(this.state.usage, sessionId, target, 'visionTarget')
    const value = {
      imageSha256: request.imageSha256,
      question: request.question,
      ...(request.region === undefined ? {} : { region: request.region }),
      vision: { provider: route.provider, model: route.model },
      evidence: target.record.evidence,
      usage: totalUsage,
    }
    await this.state.usage.recordBridgeEstimate(
      sessionId,
      estimateInjectedTextTokens(`[DeepSeekEyes on-demand visual evidence]\n${JSON.stringify(value)}`, { message: true }),
    )
    return value
  }

  ensureInstalled(agent) {
    const key = this.sessionKey(agent)
    if (key === '' || this.disposers.has(key)) return
    const scoped = agent.ctx ?? this.ctx
    const disposeTool = scoped.tools.register({
      name: LOOK_TOOL_NAME,
      description: 'Re-read one original image preserved by DeepSeekEyes and return exact evidence for one precise visual question.',
      parameters: LOOK_TOOL_PARAMETERS,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: `[DeepSeekEyes on-demand visual evidence]\n${JSON.stringify(value)}`,
        }],
      },
      timeoutMs: 180_000,
      execute: (args, exec) => this.execute(args, exec),
      presentCall(args) {
        return {
          card: 'generic',
          title: 'DeepSeekEyes Look',
          kind: 'read',
          rawInput: {
            imageSha256: args?.imageSha256,
            question: args?.question,
            ...(args?.region === undefined ? {} : { region: args.region }),
          },
        }
      },
    })
    const disposePrompt = scoped.systemPrompt?.section?.({
      name: 'deepseekeyes:preserved-images',
      order: 126,
      text: LOOK_SYSTEM_PROMPT,
    })
    this.disposers.set(key, () => {
      disposePrompt?.()
      disposeTool?.()
    })
  }

  dispose(sessionId) {
    const key = String(sessionId)
    this.references.delete(key)
    this.disposers.get(key)?.()
    this.disposers.delete(key)
  }

  disposeAll() {
    for (const dispose of this.disposers.values()) dispose()
    this.disposers.clear()
    this.references.clear()
  }
}

export function applyLookTool(ctx, state) {
  const manager = new LookToolManager(ctx, state)
  if (typeof ctx.on === 'function') ctx.on('session/disposed', session => manager.dispose(session.id))
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => manager.disposeAll(), 'deepseekeyes: preserved-image look tools')
  }
  return manager
}

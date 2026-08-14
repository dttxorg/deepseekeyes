import { DeepSeekEyesError, errorMessage } from './error.js'
import { collectStream } from './stream.js'

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

function estimateBlocks(blocks) {
  let tokens = 0
  for (const block of blocks ?? []) {
    if (block?.type === 'text' || block?.type === 'reasoning') {
      tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
    } else if (block?.type === 'tool-call') {
      tokens += Math.ceil(block.name.length / CHARS_PER_TOKEN)
        + Math.ceil(block.arguments.length / CHARS_PER_TOKEN)
        + BLOCK_OVERHEAD
    } else if (block?.type === 'tool-result') {
      tokens += estimateBlocks(block.content) + BLOCK_OVERHEAD
    } else {
      tokens += Math.ceil(JSON.stringify(block ?? null).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
    }
  }
  return tokens
}

/** Mirrors Harness' fixed request-pressure heuristic for proactive output fitting. */
export function estimateRequestTokens(options) {
  const messageTokens = (options.messages ?? []).reduce(
    (total, message) => total + estimateBlocks(message.content) + ROLE_OVERHEAD,
    0,
  )
  const systemTokens = options.system === undefined
    ? 0
    : Math.ceil(options.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
  const toolTokens = options.tools === undefined || options.tools.length === 0
    ? 0
    : Math.ceil(JSON.stringify(options.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
  return messageTokens + systemTokens + toolTokens
}

export function contextSafetyMargin(contextWindow) {
  return Math.min(8_192, Math.max(256, Math.ceil(contextWindow * 0.01)))
}

export function fitOutputBudget(options, modelInfo, logger = console) {
  const contextWindow = modelInfo?.context?.contextWindow
  const requested = options.maxTokens ?? modelInfo?.defaultMaxTokens
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0
    || !Number.isSafeInteger(requested) || requested <= 0) {
    return { options, changed: false }
  }
  const estimatedInputTokens = estimateRequestTokens(options)
  const margin = contextSafetyMargin(contextWindow)
  const available = Math.max(1, contextWindow - estimatedInputTokens - margin)
  if (requested <= available) return { options, changed: false, estimatedInputTokens, available, margin }
  logger.warn?.(
    `deepseekeyes: capped final maxTokens ${requested} -> ${available} to fit contextWindow=${contextWindow} `
    + `(estimatedInput=${estimatedInputTokens}, safety=${margin})`,
  )
  return {
    options: { ...options, maxTokens: available },
    changed: true,
    requested,
    applied: available,
    estimatedInputTokens,
    available,
    margin,
  }
}

/** Parse OpenAI-compatible context-overflow diagnostics without depending on one provider code. */
export function parseContextOverflow(error) {
  const message = errorMessage(error)
  const match = /maximum context length is\s*(\d+)\s*tokens[\s\S]*?requested\s*(\d+)\s*tokens\s*\(\s*(\d+)\s*in the messages,\s*(\d+)\s*in the completion\s*\)/i.exec(message)
  if (match === null) return undefined
  return {
    contextWindow: Number(match[1]),
    requestedTotal: Number(match[2]),
    inputTokens: Number(match[3]),
    completionTokens: Number(match[4]),
  }
}

/** One exact provider-overflow retry; rejected requests have emitted no successful usage. */
export async function collectFinalWithBudget(ctx, options, modelInfo, logger = console) {
  const fitted = fitOutputBudget(options, modelInfo, logger)
  try {
    return { result: await collectStream(ctx.llm.stream(fitted.options)), budget: fitted, retries: 0 }
  } catch (error) {
    const overflow = parseContextOverflow(error)
    if (overflow === undefined) throw error
    const margin = contextSafetyMargin(overflow.contextWindow)
    const retryMaxTokens = overflow.contextWindow - overflow.inputTokens - margin
    const previousMaxTokens = fitted.options.maxTokens ?? overflow.completionTokens
    if (!Number.isSafeInteger(retryMaxTokens) || retryMaxTokens <= 0 || retryMaxTokens >= previousMaxTokens) {
      throw new DeepSeekEyesError(
        `final model input leaves no safe output capacity: ${errorMessage(error)}`,
        'FINAL_CONTEXT_EXHAUSTED',
        { cause: error },
      )
    }
    logger.warn?.(
      `deepseekeyes: provider reported exact context pressure; retrying final maxTokens `
      + `${previousMaxTokens} -> ${retryMaxTokens} (input=${overflow.inputTokens}, context=${overflow.contextWindow})`,
    )
    const retryOptions = { ...fitted.options, maxTokens: retryMaxTokens }
    return {
      result: await collectStream(ctx.llm.stream(retryOptions)),
      budget: {
        ...fitted,
        exactOverflow: overflow,
        applied: retryMaxTokens,
        options: retryOptions,
      },
      retries: 1,
    }
  }
}

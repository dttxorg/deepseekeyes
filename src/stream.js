import { DeepSeekEyesError } from './error.js'

export function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0 }
}

export function addUsage(total, next) {
  if (next === undefined) return total
  for (const field of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
  ]) {
    if (typeof next[field] === 'number') total[field] = (total[field] ?? 0) + next[field]
  }
  return total
}

function textFromChunks(chunks) {
  const completed = []
  const deltas = new Map()
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      deltas.set(chunk.index, `${deltas.get(chunk.index) ?? ''}${chunk.text}`)
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      completed.push([chunk.index, chunk.block.text])
    }
  }
  if (completed.length > 0) {
    return completed.sort((left, right) => left[0] - right[0]).map((entry) => entry[1]).join('')
  }
  return [...deltas.entries()].sort((left, right) => left[0] - right[0]).map((entry) => entry[1]).join('')
}

/** Buffer one nested model call and convert terminal stream failures to exceptions. */
export async function collectStream(stream) {
  const chunks = []
  const usage = emptyUsage()
  let finish
  try {
    for await (const chunk of stream) {
      chunks.push(chunk)
      if (chunk.type === 'usage') addUsage(usage, chunk.usage)
      if (chunk.type === 'finish') finish = chunk
    }
  } catch (error) {
    if (error !== null && typeof error === 'object') error.usage = structuredClone(usage)
    throw error
  }
  if (finish === undefined) {
    const error = new DeepSeekEyesError('a nested model stream ended without a finish chunk', 'INCOMPLETE_STREAM')
    error.usage = structuredClone(usage)
    throw error
  }
  if (finish.reason?.kind === 'error' || finish.reason?.kind === 'aborted') {
    const failure = finish.reason.failure ?? {}
    const error = new DeepSeekEyesError(
      `nested ${finish.reason.kind} from model provider: ${failure.message ?? 'unknown failure'}`,
      failure.code ?? (finish.reason.kind === 'aborted' ? 'ABORTED' : 'VISION_MODEL_FAILED'),
    )
    error.usage = structuredClone(usage)
    throw error
  }
  return { chunks, usage, finish, text: textFromChunks(chunks) }
}

/** Replay only the final model response while reporting all hidden-call usage. */
export async function* replayWithUsage(chunks, totalUsage) {
  let finish
  for (const chunk of chunks) {
    if (chunk.type === 'usage') continue
    if (chunk.type === 'finish') {
      finish = chunk
      continue
    }
    yield chunk
  }
  yield { type: 'usage', usage: totalUsage }
  if (finish === undefined) {
    throw new DeepSeekEyesError('final model response has no finish chunk', 'INCOMPLETE_STREAM')
  }
  yield finish
}

/** Small deterministic stream used by tests and local examples. */
export function textStream(text, usage = { inputTokens: 1, outputTokens: 1 }) {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

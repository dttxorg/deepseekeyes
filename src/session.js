import {
  attachmentKey,
  contentHasImage,
  messageHistoryMarkers,
  rewriteMessageForStorage,
  rewriteMessageForRetention,
  uniqueImageBlocks,
} from './content.js'

function liveAgent(ctx, sessionId) {
  if (sessionId === undefined) return undefined
  return ctx.agents?.get?.(sessionId) ?? ctx.agents?.get?.(String(sessionId))
}

function messageOf(event) {
  if (event?.type === 'user/message') return event.data
  if (event?.type === 'assistant/message' || event?.type === 'tool/result') return event.data?.message
  return undefined
}

function replacementData(event, message) {
  if (event.type === 'user/message') return message
  return { ...event.data, message }
}

function tail(values, limit) {
  return limit === 0 ? [] : values.slice(-limit)
}

/**
 * Shadow image-bearing surface nodes with compact attachment pointers.
 *
 * The append-only event log and attachment bytes are untouched; only future
 * model derivation changes. This makes native text-model selection possible
 * after Eyes has preserved every image reference.
 */
export function shadowSessionImages(ctx, sessionId, preservedByAttachment, logger = console) {
  const agent = liveAgent(ctx, sessionId)
  const session = agent?.session
  if (session?.surface?.nodes === undefined || !Array.isArray(session.events)) {
    return { agent, shadowed: 0, skipped: 0 }
  }

  let shadowed = 0
  let skipped = 0
  for (const seq of [...session.surface.nodes]) {
    const event = session.events[seq]
    const message = messageOf(event)
    if (message === undefined || !contentHasImage(message.content)) continue
    const blocks = uniqueImageBlocks([message])
    if (!blocks.every(block => preservedByAttachment.has(attachmentKey(block.attachment)))) {
      skipped += 1
      continue
    }
    try {
      const replacement = rewriteMessageForStorage(message, preservedByAttachment)
      session.append(event.type, replacementData(event, replacement), {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      shadowed += 1
    } catch (error) {
      logger.warn?.(`deepseekeyes: session image shadow failed at surface seq ${seq}: ${String(error)}`)
      skipped += 1
    }
  }
  return { agent, shadowed, skipped }
}

/** Keep only the configured recent compact image/browser records on the model Surface. */
export function compactSessionHistory(
  ctx,
  sessionId,
  { historyImageLimit = 8, browserHistoryLimit = 8 } = {},
  logger = console,
) {
  const agent = liveAgent(ctx, sessionId)
  const session = agent?.session
  if (session?.surface?.nodes === undefined || !Array.isArray(session.events)) {
    return { agent, compacted: 0, skipped: 0 }
  }

  const preserved = new Map()
  const browser = new Map()
  for (const seq of session.surface.nodes) {
    const markers = messageHistoryMarkers(messageOf(session.events[seq]))
    for (const text of markers.preserved) {
      preserved.delete(text)
      preserved.set(text, text)
    }
    for (const text of markers.browser) {
      browser.delete(text)
      browser.set(text, text)
    }
  }
  const preservedRetention = new Set(tail([...preserved.values()], historyImageLimit))
  const browserRetention = new Set(tail([...browser.values()], browserHistoryLimit))

  let compacted = 0
  let skipped = 0
  for (const seq of [...session.surface.nodes]) {
    const event = session.events[seq]
    // Assistant replacements must belong to the currently open step. Preserved
    // pixels originate from user prompts and tool results, so keep this rewrite scoped.
    if (event?.type !== 'user/message' && event?.type !== 'tool/result') continue
    const message = messageOf(event)
    const markers = messageHistoryMarkers(message)
    if (markers.preserved.length === 0 && markers.browser.length === 0) continue
    const replacement = rewriteMessageForRetention(message, {
      preservedRetention,
      browserRetention,
    })
    if (JSON.stringify(replacement.content) === JSON.stringify(message.content)) continue
    try {
      session.append(event.type, replacementData(event, replacement), {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      compacted += 1
    } catch (error) {
      logger.warn?.(`deepseekeyes: session history compaction failed at surface seq ${seq}: ${String(error)}`)
      skipped += 1
    }
  }
  return { agent, compacted, skipped }
}

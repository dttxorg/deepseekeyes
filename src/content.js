import { randomUUID } from 'node:crypto'
import { PRESERVED_IMAGE_PREFIX } from './protocol.js'

export const BROWSER_STATE_PREFIX = '[DeepSeekEyes browser state]\n'
export const BROWSER_HISTORY_PREFIX = '[DeepSeekEyes browser history]\n'
export const DESKTOP_STATE_PREFIX = '[DeepSeekEyes desktop state]\n'
export const DESKTOP_HISTORY_PREFIX = '[DeepSeekEyes desktop history]\n'
export const MCP_CONTEXT_PREFIX = '[DeepSeekEyes MCP context]\n'

export function contentHasImage(content) {
  return Array.isArray(content) && content.some((block) =>
    block?.type === 'image'
      || (block?.type === 'tool-result' && contentHasImage(block.content)),
  )
}

export function messagesHaveImages(messages) {
  return Array.isArray(messages) && messages.some((message) => contentHasImage(message.content))
}

/** The current request segment begins after the most recent assistant response/tool call. */
export function activeMessageStart(messages) {
  if (!Array.isArray(messages)) return 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index + 1
  }
  return 0
}

export function attachmentKey(ref) {
  const id = ref?.attachmentId
  if (typeof id === 'string' && id.length > 0) return id
  return JSON.stringify(ref ?? null)
}

function collectBlocks(blocks, found) {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (block?.type === 'image') {
      const key = attachmentKey(block.attachment)
      if (!found.has(key)) found.set(key, block)
    } else if (block?.type === 'tool-result') {
      collectBlocks(block.content, found)
    }
  }
}

export function uniqueImageBlocks(messages) {
  const found = new Map()
  for (const message of messages ?? []) collectBlocks(message.content, found)
  return [...found.values()]
}

export function activeImageBlocks(messages) {
  return uniqueImageBlocks((messages ?? []).slice(activeMessageStart(messages)))
}

function containsDesktopState(blocks) {
  if (!Array.isArray(blocks)) return false
  return blocks.some(block =>
    (block?.type === 'text' && isDesktopStateText(block.text))
      || (block?.type === 'tool-result' && containsDesktopState(block.content)),
  )
}

function collectDesktopImageKeys(blocks, found) {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (block?.type !== 'tool-result') continue
    if (block.toolName === 'computer' && containsDesktopState(block.content)) {
      const images = new Map()
      collectBlocks(block.content, images)
      for (const key of images.keys()) found.add(key)
      continue
    }
    collectDesktopImageKeys(block.content, found)
  }
}

/** Image attachments emitted by the active native computer tool result only. */
export function activeDesktopImageAttachmentKeys(messages) {
  const found = new Set()
  for (const message of (messages ?? []).slice(activeMessageStart(messages))) {
    collectDesktopImageKeys(message.content, found)
  }
  return found
}

export function historicalImageBlocks(messages) {
  return uniqueImageBlocks((messages ?? []).slice(0, activeMessageStart(messages)))
}

function isBrowserStateText(text) {
  return text.startsWith(BROWSER_STATE_PREFIX) || text.startsWith(BROWSER_HISTORY_PREFIX)
}

function isDesktopStateText(text) {
  return text.startsWith(DESKTOP_STATE_PREFIX) || text.startsWith(DESKTOP_HISTORY_PREFIX)
}

function collectMarkerTexts(blocks, predicate, found) {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (block?.type === 'text' && predicate(block.text)) {
      // Delete first so a repeated reference is ordered by its latest occurrence.
      found.delete(block.text)
      found.set(block.text, block.text)
    } else if (block?.type === 'tool-result') {
      collectMarkerTexts(block.content, predicate, found)
    }
  }
}

function tail(values, limit) {
  return limit === 0 ? [] : values.slice(-limit)
}

export function messageHistoryMarkers(message) {
  const preserved = new Map()
  const browser = new Map()
  const desktop = new Map()
  collectMarkerTexts(message?.content, text => text.startsWith(PRESERVED_IMAGE_PREFIX), preserved)
  collectMarkerTexts(message?.content, isBrowserStateText, browser)
  collectMarkerTexts(message?.content, isDesktopStateText, desktop)
  return {
    preserved: [...preserved.values()],
    browser: [...browser.values()],
    desktop: [...desktop.values()],
  }
}

export function messagesNeedHistoryCompaction(messages) {
  return (messages ?? []).some((message) => {
    const markers = messageHistoryMarkers(message)
    return markers.preserved.length > 0 || markers.browser.length > 0 || markers.desktop.length > 0
  })
}

function compactDesktopStateText(text) {
  if (text.startsWith(DESKTOP_HISTORY_PREFIX)) return text
  if (!text.startsWith(DESKTOP_STATE_PREFIX)) return text
  try {
    const state = JSON.parse(text.slice(DESKTOP_STATE_PREFIX.length))
    const compact = {
      ok: state.ok,
      code: state.code,
      action: state.action,
      sequence: state.sequence,
      stateId: state.stateId,
      observedAt: state.observedAt,
      platform: state.platform,
      screen: state.screen,
      cursor: state.cursor,
      activeWindow: state.activeWindow,
      windowCount: state.windowCount,
      screenshotSha256: state.screenshot?.sha256,
      actionResult: state.actionResult,
    }
    return `${DESKTOP_HISTORY_PREFIX}${JSON.stringify(compact)}`
  } catch {
    return `${DESKTOP_HISTORY_PREFIX}${JSON.stringify({ unreadableState: true })}`
  }
}

function compactBrowserStateText(text) {
  if (text.startsWith(BROWSER_HISTORY_PREFIX)) return text
  if (!text.startsWith(BROWSER_STATE_PREFIX)) return text
  try {
    const state = JSON.parse(text.slice(BROWSER_STATE_PREFIX.length))
    const compact = {
      ok: state.ok,
      action: state.action,
      sequence: state.sequence,
      stateId: state.stateId,
      observedAt: state.observedAt,
      url: state.url,
      title: state.title,
      documentTextTruncated: state.documentTextTruncated,
      interactiveTotal: state.interactiveTotal,
      screenshotSha256: state.screenshot?.sha256,
      actionResult: state.actionResult,
      diagnosticCounts: {
        console: state.diagnostics?.consoleMessages?.length ?? 0,
        pageErrors: state.diagnostics?.pageErrors?.length ?? 0,
        requestFailures: state.diagnostics?.requestFailures?.length ?? 0,
      },
    }
    return `${BROWSER_HISTORY_PREFIX}${JSON.stringify(compact)}`
  } catch {
    return `${BROWSER_HISTORY_PREFIX}${JSON.stringify({ unreadableState: true })}`
  }
}

function replaceBlocks(blocks, evidenceByAttachment) {
  return blocks.flatMap((block) => {
    if (block?.type === 'image') {
      const evidence = evidenceByAttachment.get(attachmentKey(block.attachment))
      if (evidence === undefined) {
        throw new Error(`deepseekeyes: no evidence for attachment ${attachmentKey(block.attachment)}`)
      }
      return evidence === null ? [] : [{ type: 'text', text: evidence }]
    }
    if (block?.type === 'tool-result' && contentHasImage(block.content)) {
      return [{ ...block, content: replaceBlocks(block.content, evidenceByAttachment) }]
    }
    return [block]
  })
}

/** Copy wire messages while replacing every nested image with evidence text. */
export function replaceImagesWithEvidence(messages, evidenceByAttachment) {
  return messages.map((message) => {
    if (!contentHasImage(message.content)) return message
    return { ...message, content: replaceBlocks(message.content, evidenceByAttachment) }
  })
}

function bridgeBlocks(blocks, context) {
  return blocks.flatMap((block) => {
    if (block?.type === 'image') {
      const key = attachmentKey(block.attachment)
      if (!context.active) {
        const historical = context.historicalEvidence.get(key)
        return historical === undefined || historical === '' ? [] : [{ type: 'text', text: historical }]
      }
      const evidence = context.activeEvidence.get(key)
      if (evidence === undefined) throw new Error(`deepseekeyes: no active evidence for attachment ${key}`)
      return [{ type: 'text', text: evidence }]
    }
    if (block?.type === 'text' && block.text.startsWith(PRESERVED_IMAGE_PREFIX)) {
      if (!context.active && context.preservedRetention !== undefined
        && !context.preservedRetention.has(block.text)) return []
      return [block]
    }
    if (block?.type === 'text' && isBrowserStateText(block.text)) {
      if (context.browserMode === 'omit') return []
      return [{ ...block, text: context.browserMode === 'compact' ? compactBrowserStateText(block.text) : block.text }]
    }
    if (block?.type === 'text' && isDesktopStateText(block.text)) {
      if (context.desktopMode === 'omit') return []
      return [{ ...block, text: context.desktopMode === 'compact' ? compactDesktopStateText(block.text) : block.text }]
    }
    if (block?.type === 'tool-result') {
      return [{ ...block, content: bridgeBlocks(block.content, context) }]
    }
    return [block]
  })
}

/**
 * Build the model-facing copy for one bridge call.
 *
 * Only images introduced after the latest assistant message receive full evidence.
 * Historical pixels become bounded references, while stale browser and desktop
 * snapshots are reduced to the last few state summaries. Durable messages remain untouched.
 */
export function rewriteMessagesForBridge(
  messages,
  activeEvidence,
  historicalEvidence = new Map(),
  { historyImageLimit = 8, browserHistoryLimit = 8, desktopHistoryLimit = 8 } = {},
) {
  const start = activeMessageStart(messages)
  const historicalPreserved = new Map()
  const historicalBrowser = new Map()
  const historicalDesktop = new Map()
  for (let index = 0; index < start; index += 1) {
    const markers = messageHistoryMarkers(messages[index])
    for (const text of markers.preserved) {
      historicalPreserved.delete(text)
      historicalPreserved.set(text, text)
    }
    for (const text of markers.browser) {
      historicalBrowser.delete(text)
      historicalBrowser.set(text, text)
    }
    for (const text of markers.desktop) {
      historicalDesktop.delete(text)
      historicalDesktop.set(text, text)
    }
  }
  const preservedRetention = new Set(tail([...historicalPreserved.values()], historyImageLimit))
  const browserRetention = new Set(tail([...historicalBrowser.values()], browserHistoryLimit))
  const desktopRetention = new Set(tail([...historicalDesktop.values()], desktopHistoryLimit))
  return messages.map((message, index) => {
    const active = index >= start
    const markers = messageHistoryMarkers(message)
    const retainsBrowser = markers.browser.some(text => browserRetention.has(text))
    const retainsDesktop = markers.desktop.some(text => desktopRetention.has(text))
    const content = bridgeBlocks(message.content, {
      active,
      activeEvidence,
      historicalEvidence,
      preservedRetention,
      browserMode: active ? 'full' : retainsBrowser ? 'compact' : 'omit',
      desktopMode: active ? 'full' : retainsDesktop ? 'compact' : 'omit',
    })
    if (content.length === 0) {
      return { ...message, content: [{ type: 'text', text: '' }] }
    }
    return { ...message, content }
  })
}

/** Replace durable image blocks with compact pointers while retaining message identity/provenance. */
export function rewriteMessageForStorage(message, preservedByAttachment) {
  const content = bridgeBlocks(message.content, {
    active: true,
    activeEvidence: preservedByAttachment,
    historicalEvidence: new Map(),
    preservedRetention: undefined,
    browserMode: 'compact',
    desktopMode: 'compact',
  })
  return {
    ...message,
    content: content.length === 0 ? [{ type: 'text', text: '' }] : content,
  }
}

/** Remove old compact references from a durable Surface copy without touching the raw source event. */
export function rewriteMessageForRetention(
  message,
  { preservedRetention = new Set(), browserRetention = new Set(), desktopRetention = new Set() } = {},
) {
  const markers = messageHistoryMarkers(message)
  const content = bridgeBlocks(message.content, {
    active: false,
    activeEvidence: new Map(),
    historicalEvidence: new Map(),
    preservedRetention,
    browserMode: markers.browser.some(text => browserRetention.has(text)) ? 'compact' : 'omit',
    desktopMode: markers.desktop.some(text => desktopRetention.has(text)) ? 'compact' : 'omit',
  })
  return {
    ...message,
    content: content.length === 0 ? [{ type: 'text', text: '' }] : content,
  }
}

/** Create one ephemeral plugin-produced user message for an internal model call. */
export function pluginUserMessage(content, summary, form = 'notice') {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    source: {
      kind: 'plugin',
      plugin: 'deepseekeyes',
      form,
      summary: summary.slice(0, 120),
    },
  }
}

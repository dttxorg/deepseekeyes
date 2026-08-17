import { createHash } from 'node:crypto'
import {
  BROWSER_STATE_PREFIX,
  DESKTOP_STATE_PREFIX,
  activeMessageStart,
} from './content.js'
import { DeepSeekEyesError } from './error.js'
import { estimateRequestTokens } from './token-safety.js'

export const AUTOMATION_KINDS = Object.freeze(['browser', 'desktop'])

function blocksContainText(blocks, prefix) {
  if (!Array.isArray(blocks)) return false
  return blocks.some(block =>
    (block?.type === 'text' && block.text.startsWith(prefix))
      || (block?.type === 'tool-result' && blocksContainText(block.content, prefix)),
  )
}

function automationKindInBlocks(blocks) {
  if (!Array.isArray(blocks)) return undefined
  for (const block of blocks) {
    if (block?.type !== 'tool-result') continue
    if (block.toolName === 'computer' && blocksContainText(block.content, DESKTOP_STATE_PREFIX)) {
      return 'desktop'
    }
    if (block.toolName === 'browser' && blocksContainText(block.content, BROWSER_STATE_PREFIX)) {
      return 'browser'
    }
    const nested = automationKindInBlocks(block.content)
    if (nested !== undefined) return nested
  }
  return undefined
}

/** Identify only a current DeepSeekEyes Browser/Desktop tool result, never stale history text. */
export function activeAutomationKind(messages) {
  const start = activeMessageStart(messages)
  for (let index = start; index < (messages?.length ?? 0); index += 1) {
    const kind = automationKindInBlocks(messages[index]?.content)
    if (kind !== undefined) return kind
  }
  return undefined
}

function contentHasToolResult(content) {
  if (!Array.isArray(content)) return false
  return content.some(block => block?.type === 'tool-result'
    || (Array.isArray(block?.content) && contentHasToolResult(block.content)))
}

function isDirectUserTask(message) {
  return message?.role === 'user'
    && message.source?.kind !== 'plugin'
    && !contentHasToolResult(message.content)
}

export function latestAutomationTask(messages) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (!isDirectUserTask(messages[index])) continue
    return {
      index,
      id: String(messages[index].id ?? `user-message-${index}`),
      message: messages[index],
    }
  }
  return undefined
}

function messageHasToolCall(message) {
  return Array.isArray(message?.content) && message.content.some(block => block?.type === 'tool-call')
}

function messageHasToolResult(message) {
  return contentHasToolResult(message?.content)
}

/** Keep assistant tool calls atomic with their immediately following tool results. */
function messageGroups(messages, start) {
  const groups = []
  for (let index = start; index < messages.length; index += 1) {
    if (messageHasToolCall(messages[index])
      && index + 1 < messages.length
      && messageHasToolResult(messages[index + 1])) {
      groups.push([messages[index], messages[index + 1]])
      index += 1
    } else {
      groups.push([messages[index]])
    }
  }
  return groups
}

function compactNotice(taskId) {
  const digest = createHash('sha256').update(taskId).digest('hex').slice(0, 16)
  return {
    id: `deepseekeyes-automation-context-${digest}`,
    role: 'user',
    content: [{
      type: 'text',
      text: '[DeepSeekEyes automation context window]\nOlder task history remains preserved by DSH but is omitted from this model request. Continue from the retained user instruction and newest tool states.',
    }],
    source: {
      kind: 'plugin',
      plugin: 'deepseekeyes',
      form: 'notice',
      summary: 'Older automation history omitted by the configured context budget.',
    },
  }
}

function requestWithMessages(options, messages) {
  return { ...options, messages }
}

/**
 * Bound only the model-facing copy of an active automation request.
 *
 * The durable DSH task, event log, original screenshots and reports are untouched.
 * The newest direct user instruction is always retained, as is an atomic tail of
 * assistant tool calls and matching tool results. Zero delegates to the full Host
 * context for users who explicitly choose unlimited mode.
 */
export function boundAutomationContext(options, maximumTokens) {
  const beforeTokens = estimateRequestTokens(options)
  const task = latestAutomationTask(options.messages)
  const taskId = task?.id ?? `session:${String(options.sessionId ?? 'unknown')}`
  if (maximumTokens === 0 || beforeTokens <= maximumTokens) {
    return {
      options,
      taskId,
      changed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      savedTokens: 0,
      droppedMessages: 0,
      withinLimit: maximumTokens === 0 || beforeTokens <= maximumTokens,
    }
  }

  const messages = Array.isArray(options.messages) ? options.messages : []
  const taskIndex = task?.index ?? Math.max(0, activeMessageStart(messages) - 1)
  const taskMessage = messages[taskIndex]
  const notice = compactNotice(taskId)
  const fixed = taskMessage === undefined ? [notice] : [taskMessage, notice]
  const groups = messageGroups(messages, taskIndex + (taskMessage === undefined ? 0 : 1))
  const selected = []

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const candidate = [...groups[index], ...selected.flat()]
    const candidateMessages = [...fixed, ...candidate]
    const candidateTokens = estimateRequestTokens(requestWithMessages(options, candidateMessages))
    if (candidateTokens <= maximumTokens || selected.length === 0) {
      selected.unshift(groups[index])
      continue
    }
    break
  }

  const boundedMessages = [...fixed, ...selected.flat()]
  const boundedOptions = requestWithMessages(options, boundedMessages)
  const afterTokens = estimateRequestTokens(boundedOptions)
  return {
    options: boundedOptions,
    taskId,
    changed: true,
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, beforeTokens - afterTokens),
    droppedMessages: Math.max(0, messages.length - boundedMessages.length + 1),
    withinLimit: afterTokens <= maximumTokens,
  }
}

/** Per-session runaway guard reset by the next direct user instruction. */
export class AutomationTurnGuard {
  constructor() {
    this.turns = new Map()
  }

  state(sessionId, taskId) {
    const key = String(sessionId ?? 'unknown')
    let value = this.turns.get(key)
    const newTurn = value === undefined || value.taskId !== taskId
    if (newTurn) {
      value = { taskId, calls: 0 }
      this.turns.set(key, value)
    }
    return { key, value, newTurn }
  }

  assertAvailable(sessionId, taskId, maximumCalls) {
    const current = this.state(sessionId, taskId)
    if (maximumCalls !== 0 && current.value.calls >= maximumCalls) {
      throw new DeepSeekEyesError(
        `Computer Use reached the configured ${maximumCalls} model calls for this user instruction. Send a new instruction to continue, increase automationMaxCallsPerTurn, or set it to 0 for unlimited.`,
        'AUTOMATION_CALL_LIMIT',
      )
    }
    return current
  }

  begin(sessionId, taskId, maximumCalls) {
    const current = this.assertAvailable(sessionId, taskId, maximumCalls)
    const firstCall = current.value.calls === 0
    current.value.calls += 1
    return { newTurn: current.newTurn || firstCall, calls: current.value.calls }
  }

  clear(sessionId) {
    this.turns.delete(String(sessionId ?? 'unknown'))
  }

  clearAll() {
    this.turns.clear()
  }
}

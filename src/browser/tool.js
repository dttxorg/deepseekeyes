import { DeepSeekEyesError } from '../error.js'
import { BrowserSession } from './session.js'
import { BROWSER_TOOL_PARAMETERS, parseBrowserArgs, reportableBrowserArgs } from './protocol.js'
import { renderBrowserResult } from './session.js'

export const BROWSER_TOOL_NAME = 'browser'

function losslessJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function routedProvider(exec) {
  const header = exec.agent?.session?.requestHeader?.()?.config
  return header?.provider ?? exec.agent?.options?.provider
}

function assertDeepSeekEyesRoute(config, exec) {
  if (exec.agent === undefined) return
  const provider = routedProvider(exec)
  if (provider !== config.providerId) {
    throw new DeepSeekEyesError(
      `browser computer use requires the ${config.providerId} virtual provider; active provider is ${provider ?? 'unknown'}`,
      'BROWSER_REQUIRES_DEEPSEEKEYES',
    )
  }
}

function toolDescription() {
  return `Control one Chromium page and receive a fresh screenshot plus structured page state after every action. Start with action="open". Reuse only element refs from the latest result and pass that result's stateId to every mutating action. Prefer ref/role/selector targeting; use x/y only for canvas or visual-only controls. Actions: open, observe, click, type, press, select, check, uncheck, scroll, wait, assert, back, forward, reload, report, close. The screenshot is re-read by DeepSeekEyes in the same conversation.`
}

export class BrowserSessionManager {
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.options = options
    this.sessions = new Map()
  }

  sessionKey(exec) {
    return String(exec.agent?.id ?? 'direct')
  }

  getOrCreate(exec) {
    const key = this.sessionKey(exec)
    let session = this.sessions.get(key)
    if (session === undefined || session.closed) {
      session = new BrowserSession(this.ctx, this.config, {
        ...this.options,
        sessionId: key,
      })
      this.sessions.set(key, session)
    }
    return session
  }

  async execute(input, exec) {
    assertDeepSeekEyesRoute(this.config, exec)
    const args = parseBrowserArgs(input)
    const session = this.getOrCreate(exec)
    const result = await session.execute(args, exec.signal)
    if (args.action === 'close') this.sessions.delete(this.sessionKey(exec))
    return losslessJson(result)
  }

  async close(sessionId) {
    const key = String(sessionId)
    const session = this.sessions.get(key)
    this.sessions.delete(key)
    await session?.close()
  }

  async closeAll() {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(sessions.map(session => session.close()))
  }
}

export function createBrowserTool(manager, config) {
  return {
    name: BROWSER_TOOL_NAME,
    description: toolDescription(),
    parameters: BROWSER_TOOL_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderBrowserResult(value),
      presentationMeta: (args, value) => ({
        action: args.action,
        ok: value.ok,
        ...(value.url === undefined ? {} : { url: value.url }),
        ...(value.stateId === undefined ? {} : { stateId: value.stateId }),
      }),
    },
    timeoutMs: Math.max(135_000, config.browserTimeoutMs + 15_000),
    execute: (args, exec) => manager.execute(args, exec),
    presentCall(args) {
      const parsed = (() => {
        try { return reportableBrowserArgs(parseBrowserArgs(args)) } catch { return { action: args?.action } }
      })()
      return {
        card: 'generic',
        title: `Browser ${parsed.action ?? 'action'}`,
        kind: ['observe', 'assert', 'report'].includes(parsed.action) ? 'read' : 'edit',
        rawInput: parsed,
      }
    },
  }
}

export const BROWSER_SYSTEM_PROMPT = `## DeepSeekEyes Browser Computer Use

Use the browser tool for browser automation and testing. Begin with action="open". Every result contains a new screenshot, stateId, visible document text, and interactive element refs. For click/type/select/check actions, use a ref from the newest result and copy that exact stateId. Never reuse an older ref or stateId. Prefer semantic refs, roles, and selectors over coordinates. After each action, inspect the returned state and verify the observable change. Use action="assert" for test assertions and action="report" to persist the final evidence report. If visual evidence lacks a detail, use the DeepSeekEyes clarification protocol so the visual model rereads that same screenshot.`

/** Register the browser tool and lifecycle cleanup into a DSH plugin context. */
export function applyBrowserComputerUse(ctx, config, options = {}) {
  if (!config.browserComputerUse) return undefined
  const manager = new BrowserSessionManager(ctx, config, options)
  const registerTool = () => ctx.tools.register(createBrowserTool(manager, config))
  if (typeof ctx.effect === 'function') ctx.effect(registerTool, 'deepseekeyes: browser tool')
  else registerTool()
  if (ctx.systemPrompt !== undefined) {
    const registerPrompt = () => ctx.systemPrompt.section({
      name: 'deepseekeyes:browser-computer-use',
      order: 125,
      text: BROWSER_SYSTEM_PROMPT,
    })
    if (typeof ctx.effect === 'function') ctx.effect(registerPrompt, 'deepseekeyes: browser prompt')
    else registerPrompt()
  }
  if (typeof ctx.on === 'function') {
    ctx.on('session/disposed', session => { void manager.close(session.id) })
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => async () => manager.closeAll(), 'deepseekeyes: browser cleanup')
  }
  return manager
}

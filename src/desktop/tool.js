import { DeepSeekEyesError } from '../error.js'
import { DESKTOP_TOOL_PARAMETERS, parseDesktopArgs, reportableDesktopArgs } from './protocol.js'
import { DesktopSession, renderDesktopResult } from './session.js'

export const DESKTOP_TOOL_NAME = 'computer'

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
      `desktop computer use requires the ${config.providerId} virtual provider; active provider is ${provider ?? 'unknown'}`,
      'DESKTOP_REQUIRES_DEEPSEEKEYES',
    )
  }
}

function toolDescription() {
  return `Control native Windows or macOS applications with window-scoped screenshots and accessibility elements. Begin with action="observe"; when the target app is known, pass scope="window" plus application or title so the result contains only that window. Every result returns a fresh lossless PNG, semantic element refs, a state delta and stateId. Prefer elementRef actions over screenshot coordinates. Actions: observe, click, double_click, right_click, move_cursor, drag, type, key, scroll, invoke, set_value, perform_action, launch, focus, move_window, resize_window, close_window, wait, assert, report, close.`
}

export class DesktopSessionManager {
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.options = options
    this.sessions = new Map()
    this.onActivationChange = undefined
  }

  reconfigure(config) {
    const changed = JSON.stringify(Object.entries(this.config).filter(([key]) => key.startsWith('desktop')))
      !== JSON.stringify(Object.entries(config).filter(([key]) => key.startsWith('desktop')))
    this.config = config
    if (changed) this.closeAll()
    this.onActivationChange?.(config.desktopComputerUse, changed)
    return this.config
  }

  sessionKey(exec) {
    return String(exec.agent?.id ?? 'direct')
  }

  getOrCreate(exec) {
    const key = this.sessionKey(exec)
    let session = this.sessions.get(key)
    if (session === undefined || session.closed) {
      const driver = this.options.driverFactory?.(this.config, key)
      session = new DesktopSession(this.ctx, this.config, {
        ...this.options,
        ...(driver === undefined ? {} : { driver }),
        sessionId: key,
      })
      this.sessions.set(key, session)
    }
    return session
  }

  async execute(input, exec = {}) {
    if (!this.config.desktopComputerUse) {
      throw new DeepSeekEyesError('desktop computer use is disabled in DeepSeekEyes settings', 'DESKTOP_COMPUTER_USE_DISABLED')
    }
    assertDeepSeekEyesRoute(this.config, exec)
    const args = parseDesktopArgs(input)
    const session = this.getOrCreate(exec)
    const result = await session.execute(args, exec.signal)
    if (args.action === 'close') this.sessions.delete(this.sessionKey(exec))
    return losslessJson(result)
  }

  close(sessionId) {
    this.sessions.delete(String(sessionId))
  }

  closeAll() {
    this.sessions.clear()
  }
}

export function createDesktopTool(manager, config) {
  return {
    name: DESKTOP_TOOL_NAME,
    description: toolDescription(),
    parameters: DESKTOP_TOOL_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderDesktopResult(value),
      presentationMeta: (args, value) => ({
        action: args.action,
        ok: value.ok,
        platform: value.platform,
        ...(value.stateId === undefined ? {} : { stateId: value.stateId }),
      }),
    },
    timeoutMs: Math.max(135_000, config.desktopTimeoutMs + 15_000),
    execute: (args, exec) => manager.execute(args, exec),
    presentCall(args) {
      const parsed = (() => {
        try { return reportableDesktopArgs(parseDesktopArgs(args)) } catch { return { action: args?.action } }
      })()
      return {
        card: 'generic',
        title: `Computer ${parsed.action ?? 'action'}`,
        kind: ['observe', 'wait', 'assert', 'report'].includes(parsed.action) ? 'read' : 'edit',
        rawInput: parsed,
      }
    },
  }
}

export const DESKTOP_SYSTEM_PROMPT = `## DeepSeekEyes Desktop Computer Use 0.5

Use the computer tool for native Windows or macOS applications. When the task names an app or window, begin with action="observe", scope="window", and application/title; use a full desktop observation only for discovery. Every result contains a fresh lossless screenshot, stateId, window refs, accessibility element refs, and a stateDelta. Copy the newest stateId into later actions and use refs only from that state. Prefer elementRef with click, invoke, set_value, type, scroll, or perform_action; use screenshot pixel coordinates for canvas, games, and controls absent from the accessibility tree. Window-scoped coordinates are relative to the returned screenshot and the runtime maps them back to the desktop. After every action, inspect semantic changes and the screenshot. Prefer runtime assertions such as element_visible, element_value_equals, window_exists, or screen_changed; use visual only for pixel-only facts. Finish with report. Historical screenshots are compacted, typed/assigned values are hashed in reports, and oversized PNGs are delivered as coordinate-labelled lossless tiles.`

/** Register native desktop computer use only when explicitly enabled. */
export function applyDesktopComputerUse(ctx, config, options = {}) {
  const manager = new DesktopSessionManager(ctx, config, options)
  let disposeTool
  let disposePrompt
  const syncActivation = (enabled, refresh = false) => {
    if (refresh) {
      disposeTool?.()
      disposePrompt?.()
      disposeTool = undefined
      disposePrompt = undefined
    }
    if (enabled) {
      disposeTool ??= ctx.tools.register(createDesktopTool(manager, manager.config))
      if (ctx.systemPrompt !== undefined) {
        disposePrompt ??= ctx.systemPrompt.section({
          name: 'deepseekeyes:desktop-computer-use',
          order: 124,
          text: DESKTOP_SYSTEM_PROMPT,
        })
      }
      return
    }
    disposeTool?.()
    disposePrompt?.()
    disposeTool = undefined
    disposePrompt = undefined
  }
  manager.onActivationChange = syncActivation
  const install = () => {
    syncActivation(config.desktopComputerUse)
    return () => {
      syncActivation(false)
      manager.closeAll()
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(install, 'deepseekeyes: desktop computer use')
  else install()
  if (typeof ctx.on === 'function') {
    ctx.on('session/disposed', session => manager.close(session.id))
  }
  return manager
}

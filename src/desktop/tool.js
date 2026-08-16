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
  return `Control native Windows or macOS applications with window-scoped captures and accessibility elements. Launch directly with action="launch" and no stateId. Every result captures and preserves a fresh lossless PNG, then desktopVisualMode decides whether pixels enter the model. In auto mode, semantic states and successful mutations use a fast text path; set includeScreenshot=true only when current pixels are required. Copy the newest stateId into state-changing actions and ref-based mutations. Prefer elementRef actions; use screenshot coordinates when semanticStatus reports sparse accessibility. Actions: observe, click, double_click, right_click, move_cursor, drag, type, key, scroll, invoke, set_value, perform_action, launch, focus, move_window, resize_window, close_window, wait, assert, report, close.`
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
        ...(value.visualDelivery === undefined ? {} : {
          visualDelivered: value.visualDelivery.delivered,
          visualReason: value.visualDelivery.reason,
        }),
        ...(value.timings?.toolTotalMs === undefined ? {} : { toolTotalMs: value.timings.toolTotalMs }),
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

Use the computer tool for native Windows or macOS applications. Use action="launch" directly without observe or stateId; application may be a display name and, on macOS, a bundle ID or full .app path. Focus by application/title also works without stateId. To inspect an already-running app, begin with action="observe", scope="window", and application/title; use a full desktop observation only for discovery. Every result captures and preserves a fresh lossless screenshot and returns stateId, window refs, accessibility element refs, semanticStatus, stateDelta, timings, and visualDelivery. Copy the newest stateId into later state-changing actions and ref-based mutations; a read-only observe may reuse the current windowRef without stateId.

Treat visualDelivery as the routing contract. In the default auto mode, a complete semantic observation and successful mutations use the fast text path, so no visual model call occurs. First inspect actionResult, semantic elements and stateDelta. If they confirm the action and the next planned step is deterministic, issue that next tool call immediately without a visual reread or a long narration. Set includeScreenshot=true on the current action only when its resulting pixels are needed, or call observe with includeScreenshot=true for an explicit visual reread. Do not request pixels merely to reconfirm a successful semantic action. When visualDelivery.delivered=false, do not claim that pixels were inspected; the exact full screenshot is still preserved under its hash/artifact metadata. In always mode every result includes pixels; in manual mode only includeScreenshot=true does.

Prefer elementRef with click, invoke, set_value, type, scroll, or perform_action. When semanticStatus is sparse, empty, or disabled, use a delivered screenshot and pixel coordinates instead of repeatedly probing accessibility. Window-scoped coordinates are relative to the returned screenshot and the runtime maps them back to the desktop. Prefer runtime assertions such as element_visible, element_value_equals, window_exists, or screen_changed; use visual only for pixel-only facts. Finish with report. Historical screenshots are compacted, typed/assigned values are hashed in reports, and oversized PNGs are delivered as coordinate-labelled lossless tiles.`

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

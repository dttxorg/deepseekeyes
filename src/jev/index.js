import { DeepSeekEyesError } from '../error.js'
import { JevClient } from './client.js'

export const JEV_TOOL_NAME = 'jev'

export const JEV_TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['surface', 'goal'],
  properties: {
    surface: { type: 'string', enum: ['browser', 'desktop'] },
    goal: { type: 'string' },
    url: { type: 'string' },
    application: { type: 'string' },
    text: { type: 'string' },
    key: { type: 'string', enum: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'] },
    sensitive: { type: 'boolean' },
    confirmed: { type: 'boolean' },
    execute: { type: 'boolean' },
    maxSteps: { type: 'integer', minimum: 1, maximum: 30 },
    timeoutMs: { type: 'integer', minimum: 1_000, maximum: 120_000 },
  },
})

function routedProvider(exec) {
  const header = exec.agent?.session?.requestHeader?.()?.config
  return header?.provider ?? exec.agent?.options?.provider
}

function assertRoute(config, exec) {
  if (exec.agent === undefined) return
  const provider = routedProvider(exec)
  if (provider !== config.providerId) {
    throw new DeepSeekEyesError(
      `Jev control requires the ${config.providerId} virtual provider; active provider is ${provider ?? 'unknown'}`,
      'JEV_REQUIRES_DEEPSEEKEYES',
    )
  }
}

function candidatesFrom(result) {
  return (Array.isArray(result?.elements) ? result.elements : [])
    .filter(e => !(e.password || e.sensitive || /password|secure/i.test(`${e.role ?? ''} ${e.type ?? ''}`)))
    .filter(e => typeof (e.ref ?? e.elementRef) === 'string')
    .slice(0, 40).map((e, index) => ({
      index: index + 1, ref: e.ref ?? e.elementRef,
      role: String(e.role ?? e.type ?? 'element').slice(0, 80),
      label: String(e.name ?? e.label ?? '').slice(0, 180),
      editable: e.editable === true,
      enabled: e.enabled !== false && e.disabled !== true,
      visible: e.visible !== false,
      focused: e.focused === true,
      actions: Array.isArray(e.actions) ? e.actions.slice(0, 12).map(String) : [],
    }))
}

function compactContext(result) {
  // Deliberately allowlist structural fields: never serialize the raw desktop,
  // input values, URLs, headers, screenshots, or unrelated window inventory.
  return JSON.stringify({ stateId: result?.stateId, platform: result?.platform })
}

function probability(value) { return Number.isFinite(value) && value >= 0 && value <= 1 }
function decisionGate(decision, candidates, input) {
  if (!decision || typeof decision.action !== 'string') return 'JEV_INVALID_DECISION'
  if (['ask_user', 'blocked'].includes(decision.action)) return undefined
  if (!probability(decision.risk)) return 'JEV_RISK_UNKNOWN'
  if (!probability(decision.operationConfidence) || decision.operationConfidence < 0.55) return 'JEV_LOW_OPERATION_CONFIDENCE'
  if (['click_element', 'type_text', 'set_value', 'press_key'].includes(decision.action)) {
    const candidate = candidates.find(c => c.ref === decision.targetRef)
    if (!candidate) return 'JEV_TARGET_MISSING'
    if (!candidate.enabled || !candidate.visible) return 'JEV_TARGET_NOT_INTERACTABLE'
    if (['type_text', 'set_value'].includes(decision.action) && !candidate.editable) return 'JEV_TARGET_NOT_EDITABLE'
    if (decision.action === 'press_key' && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(input.key)) return 'JEV_KEY_BLOCKED'
    if (['type_text', 'set_value'].includes(decision.action) && input.sensitive !== false) return 'JEV_SENSITIVE_TEXT_CONFIRMATION'
    if (!probability(decision.confidence) || decision.confidence < 0.55) return 'JEV_LOW_TARGET_CONFIDENCE'
  }
  return undefined
}

function browserAction(decision, current, input) {
  const target = decision.targetRef === null ? {} : { ref: decision.targetRef }
  const base = { stateId: current.stateId }
  switch (decision.action) {
    case 'click_element': return { action: 'click', ...base, ...target }
    case 'type_text': return { action: 'type', ...base, ...target, value: input.text ?? '' }
    case 'set_value': return { action: 'type', ...base, ...target, value: input.text ?? '' }
    case 'press_key': return { action: 'press', ...base, ...target, key: input.key ?? 'Enter' }
    case 'scroll': return { action: 'scroll', ...base, deltaY: 600 }
    case 'wait': return { action: 'wait', ...base, timeoutMs: 500 }
    case 'back': return { action: 'back', ...base }
    case 'forward': return { action: 'forward', ...base }
    case 'reload': return { action: 'reload', ...base }
    default: return undefined
  }
}

function desktopAction(decision, current, input) {
  const target = decision.targetRef === null ? {} : { elementRef: decision.targetRef }
  const base = { stateId: current.stateId }
  switch (decision.action) {
    case 'click_element': return { action: 'click', ...base, ...target }
    case 'type_text': return { action: 'type', ...base, ...target, text: input.text ?? '' }
    case 'set_value': return { action: 'set_value', ...base, ...target, value: input.text ?? '' }
    case 'press_key': return undefined // Native key injection is global; Jev must not risk the foreground window.
    case 'scroll': {
      const windowRef = current.observationScope?.window?.ref
      return windowRef === undefined ? undefined : { action: 'scroll', ...base, windowRef, deltaY: 600 }
    }
    case 'wait': return { action: 'wait', ...base, durationMs: 500 }
    default: return undefined
  }
}

export class JevControlManager {
  constructor(ctx, config, { browser, desktop, client, usageTracker } = {}) {
    this.ctx = ctx
    this.config = config
    this.browser = browser
    this.desktop = desktop
    this.usageTracker = usageTracker
    this.client = client ?? new JevClient({
      endpoint: config.jevEndpoint,
      model: config.jevModel,
      apiKeyEnv: config.jevApiKeyEnv,
      timeoutMs: config.jevDecisionTimeoutMs,
    })
  }

  reconfigure(config) {
    const changed = JSON.stringify(this.config) !== JSON.stringify(config)
    this.config = config
    this.client = new JevClient({
      endpoint: config.jevEndpoint,
      model: config.jevModel,
      apiKeyEnv: config.jevApiKeyEnv,
      timeoutMs: config.jevDecisionTimeoutMs,
    })
    this.onActivationChange?.(config.jevEnabled, changed)
  }

  async execute(input, exec = {}) {
    const duration = input.timeoutMs ?? 120000
    if (!Number.isInteger(duration) || duration < 1000 || duration > 120000) throw new TypeError('Invalid Jev timeoutMs')
    const timeout = AbortSignal.timeout(duration)
    exec = { ...exec, signal: exec.signal ? AbortSignal.any([exec.signal, timeout]) : timeout }
    return this.run(input, exec)
  }

  async run(input, exec = {}) {
    exec.signal?.throwIfAborted()
    if (!this.config.jevEnabled) throw new DeepSeekEyesError('Jev control is disabled in DeepSeekEyes settings', 'JEV_DISABLED')
    assertRoute(this.config, exec)
    const surface = input.surface
    const controller = surface === 'browser' ? this.browser : surface === 'desktop' ? this.desktop : undefined
    if (controller === undefined) throw new DeepSeekEyesError(`Jev surface is unavailable: ${surface}`, 'JEV_SURFACE_UNAVAILABLE')
    if ((input.url || input.application) && input.confirmed !== true) {
      return { ok: false, status: 'needs_confirmation', code: 'JEV_NAVIGATION_CONFIRMATION_REQUIRED', steps: 0 }
    }
    if (input.execute !== true && (input.url || input.application)) {
      return { ok: true, status: 'dry_run', verified: false, steps: 0, plannedAction: input.url
        ? { action: 'open', url: input.url } : { action: 'launch', application: input.application } }
    }
    const initial = surface === 'browser'
      ? input.url ? await controller.execute({ action: 'open', url: input.url }, exec) : await controller.execute({ action: 'observe' }, exec)
      : input.application ? await controller.execute({ action: 'launch', application: input.application }, exec) : await controller.execute({ action: 'observe', scope: 'desktop' }, exec)
    let current = initial
    const trace = []
    const recentActions = []
    const maxSteps = input.maxSteps ?? this.config.jevMaxSteps
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30) throw new TypeError('Invalid Jev maxSteps')
    for (let step = 1; step <= maxSteps; step += 1) {
      exec.signal?.throwIfAborted()
      const candidates = candidatesFrom(current)
      const decision = await this.client.decide({
        goal: input.goal,
        surface,
        app: input.application ?? surface,
        context: compactContext(current),
        candidates,
        recentActions,
        signal: exec.signal,
      })
      if (this.usageTracker) {
        await this.usageTracker.recordCall(exec.sessionId ?? exec.agent?.session?.id, 'jevControl', {
          inputTokens: decision.usage?.input_tokens ?? decision.usage?.inputTokens,
          outputTokens: decision.usage?.output_tokens ?? decision.usage?.outputTokens,
        })
      }
      trace.push({ step, decision: { ...decision, usage: undefined }, candidates: candidates.length })
      const gate = decisionGate(decision, candidates, input)
      if (gate !== undefined) return { ok: false, status: 'escalate', code: gate, steps: step - 1, trace, result: current }
      if (decision.action === 'ask_user' || decision.action === 'blocked' || (decision.risk ?? 0) >= 0.5) {
        return {
          ok: true,
          status: decision.action === 'blocked' ? 'blocked' : 'needs_confirmation',
          verified: false,
          steps: step - 1,
          trace,
          result: current,
        }
      }
      if (decision.action === 'done' || (decision.done ?? 0) >= 0.9) {
        return { ok: true, status: 'done_unverified', verified: false, steps: step - 1, trace, result: current }
      }
      const action = surface === 'browser'
        ? browserAction(decision, current, input)
        : desktopAction(decision, current, input)
      if (action === undefined) {
        return { ok: false, status: 'escalate', code: 'JEV_ACTION_UNSUPPORTED', steps: step - 1, trace, result: current }
      }
      if ((decision.action === 'type_text' || decision.action === 'set_value')
        && (input.text === undefined || input.text === '')) {
        return { ok: false, status: 'needs_user', code: 'JEV_TEXT_SLOT_MISSING', steps: step - 1, trace, result: current }
      }
      if (input.execute !== true) {
        return { ok: true, status: 'dry_run', verified: false, steps: step - 1, trace, plannedAction: action, result: current }
      }
      exec.signal?.throwIfAborted()
      if (!this.config.jevEnabled) throw new DeepSeekEyesError('Jev disabled during decision', 'JEV_DISABLED')
      current = await controller.execute(action, exec)
      if (!Array.isArray(current?.elements) && input.execute === true) {
        current = await controller.execute({ action: 'observe', stateId: current?.stateId }, exec)
      }
      if (current?.ok === false) return { ok: false, status: 'action_failed', steps: step, trace, result: current }
      recentActions.push(`${decision.action} ${decision.targetLabel ?? ''}`.trim())
    }
    return { ok: true, status: 'max_steps', verified: false, steps: maxSteps, trace, result: current }
  }
}

export function createJevTool(manager, config) {
  return {
    name: JEV_TOOL_NAME,
    description: 'Use Jev to choose browser or native application actions from the latest semantic state. Defaults to dry-run; pass execute=true only after reviewing the planned action.',
    parameters: JEV_TOOL_PARAMETERS,
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: Math.max(135_000, config.jevDecisionTimeoutMs + 15_000),
    execute: async (args, exec) => {
      const out = await manager.execute(args, exec)
      return { ...out, result: out.result ? { ok: out.result.ok, stateId: out.result.stateId, elements: candidatesFrom(out.result) } : undefined }
    },
    presentCall(args) {
      return { card: 'generic', title: `Jev ${args?.surface ?? 'control'}`, kind: args?.execute === true ? 'edit' : 'read', rawInput: { surface: args?.surface, goal: args?.goal, execute: args?.execute === true } }
    },
  }
}

export const JEV_SYSTEM_PROMPT = `## DeepSeekEyes Jev control

Use the jev tool when a browser or native application task needs semantic action selection. Jev receives only bounded text and structured element candidates; it excludes raw screenshots, input values and configured credentials; selected visible labels are sent to Jev. The runtime executes only actions bound to the newest Browser/Desktop stateId and re-observes after every action. Call with execute=false to preview the next action. Use execute=true only after reviewing the planned action. A done response is a planner signal; verify the returned state before claiming that the goal changed.`

export function applyJevControl(ctx, config, options = {}) {
  const manager = new JevControlManager(ctx, config, options)
  let disposeTool
  let disposePrompt
  const sync = (enabled, refresh = false) => {
    if (refresh) {
      disposeTool?.()
      disposePrompt?.()
      disposeTool = undefined
      disposePrompt = undefined
    }
    if (enabled) {
      disposeTool ??= ctx.tools.register(createJevTool(manager, manager.config))
      if (ctx.systemPrompt !== undefined) disposePrompt ??= ctx.systemPrompt.section({ name: 'deepseekeyes:jev-control', order: 123, text: JEV_SYSTEM_PROMPT })
    } else {
      disposeTool?.()
      disposePrompt?.()
      disposeTool = undefined
      disposePrompt = undefined
    }
  }
  const install = () => {
    sync(config.jevEnabled)
    return async () => sync(false)
  }
  if (typeof ctx.effect === 'function') ctx.effect(install, 'deepseekeyes: Jev control')
  else install()
  manager.onActivationChange = sync
  return manager
}

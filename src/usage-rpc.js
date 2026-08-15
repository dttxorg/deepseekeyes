export const USAGE_RPC_CHANNEL = '/deepseekeyes'
export const USAGE_SNAPSHOT_ENDPOINT = 'usage.snapshot'
export const USAGE_RESET_ENDPOINT = 'usage.reset'

function ok(value) {
  return { ok: true, value }
}

function error(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** Local settings-page RPC handler; no model prompt, tool schema or conversation event is created. */
export function createUsageRpcHandler(tracker) {
  return async (endpoint, payload) => {
    if (endpoint === USAGE_SNAPSHOT_ENDPOINT) return ok(await tracker.snapshot())
    if (endpoint === USAGE_RESET_ENDPOINT) {
      if (payload?.confirm !== true) return error('bad-request', 'usage reset requires confirm=true')
      return ok(await tracker.reset())
    }
    return error('not-found', `unknown DeepSeekEyes usage endpoint ${endpoint}`)
  }
}

/** Register a loopback-only channel when the DSH web Connection service is present. */
export function installUsageRpc(ctx, tracker) {
  const install = connectionCtx => connectionCtx.connection.rpc.handle(
    USAGE_RPC_CHANNEL,
    createUsageRpcHandler(tracker),
    { authority: 'loopback' },
  )
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], install)
    return undefined
  }
  if (ctx.connection?.rpc?.handle !== undefined) return install(ctx)
  return undefined
}

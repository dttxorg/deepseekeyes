import { safeError, safeErrorCode } from './mcp/canonical.js'

export const USAGE_RPC_CHANNEL = '/deepseekeyes'
export const USAGE_SNAPSHOT_ENDPOINT = 'usage.snapshot'
export const USAGE_RESET_ENDPOINT = 'usage.reset'
export const MCP_STATUS_ENDPOINT = 'mcp.status'
export const MCP_TEST_ENDPOINT = 'mcp.test'
export const MCP_RECONNECT_ENDPOINT = 'mcp.reconnect'
export const MCP_TOOLS_ENDPOINT = 'mcp.tools'

function ok(value) {
  return { ok: true, value }
}

function error(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

function serverId(payload) {
  return typeof payload?.serverId === 'string' && payload.serverId.trim() !== ''
    ? payload.serverId.trim()
    : undefined
}

/** Local settings-page RPC handler; no model prompt, tool schema or conversation event is created. */
export function createUsageRpcHandler(tracker, mcp) {
  return async (endpoint, payload) => {
    if (endpoint === USAGE_SNAPSHOT_ENDPOINT) return ok(await tracker.snapshot())
    if (endpoint === USAGE_RESET_ENDPOINT) {
      if (payload?.confirm !== true) return error('bad-request', 'usage reset requires confirm=true')
      return ok(await tracker.reset())
    }
    if (endpoint === MCP_STATUS_ENDPOINT) {
      if (mcp === undefined) return error('mcp-unavailable', 'DeepSeekEyes MCP runtime is not installed')
      try {
        return ok(await (typeof mcp.health === 'function' ? mcp.health() : mcp.snapshot()))
      } catch (cause) {
        return error(safeErrorCode(cause, 'mcp-health-failed'), safeError(cause))
      }
    }
    if ([MCP_TEST_ENDPOINT, MCP_RECONNECT_ENDPOINT, MCP_TOOLS_ENDPOINT].includes(endpoint)) {
      if (mcp === undefined) return error('mcp-unavailable', 'DeepSeekEyes MCP runtime is not installed')
      const id = serverId(payload)
      if (id === undefined) return error('bad-request', `${endpoint} requires serverId`)
      try {
        if (endpoint === MCP_TEST_ENDPOINT) return ok(await mcp.testConnection(id))
        if (endpoint === MCP_RECONNECT_ENDPOINT) return ok(await mcp.reconnect(id))
        return ok(await mcp.listTools(id, { refresh: payload?.refresh === true }))
      } catch (cause) {
        return error(safeErrorCode(cause, 'mcp-operation-failed'), safeError(cause))
      }
    }
    return error('not-found', `unknown DeepSeekEyes usage endpoint ${endpoint}`)
  }
}

/** Register a loopback-only channel when the DSH web Connection service is present. */
export function installUsageRpc(ctx, tracker, mcp) {
  const install = connectionCtx => connectionCtx.connection.rpc.handle(
    USAGE_RPC_CHANNEL,
    createUsageRpcHandler(tracker, mcp),
    { authority: 'loopback' },
  )
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], install)
    return undefined
  }
  if (ctx.connection?.rpc?.handle !== undefined) return install(ctx)
  return undefined
}

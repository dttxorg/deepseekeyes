import { hashErrorMessage, safeErrorCode, safeHashValue } from './canonical.js'
import { classifyToolRisk } from './policy.js'

export function mcpAuditSummary({
  id,
  at = new Date().toISOString(),
  server,
  tool,
  args,
  result,
  error,
  durationMs,
}) {
  const classification = classifyToolRisk(tool.annotations)
  return Object.freeze({
    id,
    at,
    serverId: server.id,
    serverName: server.name,
    tool: tool.rawName ?? tool.name,
    publicName: tool.publicName,
    risk: classification.risk,
    openWorld: classification.openWorld,
    status: error === undefined ? 'success' : 'error',
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    argsSha256: safeHashValue(args ?? {}),
    ...(result?.sha256 === undefined ? {} : {
      resultSha256: result.sha256,
      resultBytes: result.bytes,
      resultTruncated: result.truncated,
    }),
    ...(error === undefined ? {} : {
      error: {
        code: safeErrorCode(error, 'MCP_TOOL_CALL_FAILED'),
        // Persistent audit records never retain untrusted transport text. The
        // loopback status RPC may show a bounded, redacted message to the local
        // operator, while this hash keeps failures correlatable without making
        // unknown credential formats part of the audit surface.
        messageSha256: hashErrorMessage(error),
      },
    }),
  })
}

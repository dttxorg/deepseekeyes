import { createHash } from 'node:crypto'

const GLOB_SPECIAL = /[.+^${}()|[\]\\]/g
const INVALID_PUBLIC_NAME_CHARS = /[^A-Za-z0-9_-]/g

export function publicMcpToolName(serverId, rawName) {
  const joined = `mcp__${serverId}__${rawName}`
  const normalized = joined.replace(INVALID_PUBLIC_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= 64) return normalized
  const hash = createHash('sha256').update(`${serverId}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, 51)}_${hash}`
}

function globExpression(pattern) {
  return new RegExp(`^${pattern.replace(GLOB_SPECIAL, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

function contentNames(server, identity) {
  return new Set([
    String(identity),
    `${server.id}/${identity}`,
    `${server.name}/${identity}`,
  ])
}

export function contentMatchesSelector(server, identity, selector) {
  const expression = globExpression(String(selector))
  return [...contentNames(server, identity)].some(name => expression.test(name))
}

/** Resources and Prompts use the same explicit allowlist and deny-wins model as Tools. */
export function contentPolicyDecision(server, kind, identity) {
  const allowField = kind === 'resource' ? 'allowedResources' : 'allowedPrompts'
  const denyField = kind === 'resource' ? 'denyResources' : 'denyPrompts'
  const deniedBy = server[denyField].find(selector => contentMatchesSelector(server, identity, selector))
  if (deniedBy !== undefined) return Object.freeze({ allowed: false, reason: 'denylist', selector: deniedBy })
  if (server[allowField].length === 0) return Object.freeze({ allowed: false, reason: 'not-allowlisted' })
  const allowedBy = server[allowField].find(selector => contentMatchesSelector(server, identity, selector))
  if (allowedBy === undefined) return Object.freeze({ allowed: false, reason: 'not-allowlisted' })
  return Object.freeze({ allowed: true, reason: 'allowlist', selector: allowedBy })
}

function toolNames(server, tool) {
  const rawName = String(tool.rawName ?? tool.name ?? tool.publicName ?? '')
  const publicName = String(tool.publicName ?? tool.name ?? rawName)
  return new Set([
    rawName,
    publicName,
    `${server.id}/${rawName}`,
    `${server.name}/${rawName}`,
    `${server.id}/${publicName}`,
    `${server.name}/${publicName}`,
  ])
}

export function toolMatchesSelector(server, tool, selector) {
  const expression = globExpression(String(selector))
  return [...toolNames(server, tool)].some(name => expression.test(name))
}

/** Deny wins and an empty allowlist intentionally exposes zero tools. */
export function toolPolicyDecision(server, tool) {
  const deniedBy = server.denyTools.find(selector => toolMatchesSelector(server, tool, selector))
  if (deniedBy !== undefined) return Object.freeze({ allowed: false, reason: 'denylist', selector: deniedBy })
  if (server.allowedTools.length === 0) return Object.freeze({ allowed: false, reason: 'not-allowlisted' })
  const allowedBy = server.allowedTools.find(selector => toolMatchesSelector(server, tool, selector))
  if (allowedBy === undefined) return Object.freeze({ allowed: false, reason: 'not-allowlisted' })
  return Object.freeze({ allowed: true, reason: 'allowlist', selector: allowedBy })
}

export function normalizeToolAnnotations(annotations) {
  const input = annotations !== null && typeof annotations === 'object' && !Array.isArray(annotations)
    ? annotations
    : {}
  const output = {}
  for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
    if (typeof input[key] === 'boolean') output[key] = input[key]
  }
  return Object.freeze(output)
}

/** Classify missing annotations conservatively without blocking an explicit allowlist. */
export function classifyToolRisk(annotations) {
  const normalized = normalizeToolAnnotations(annotations)
  let risk
  if (normalized.destructiveHint === true) risk = 'destructive'
  else if (normalized.readOnlyHint === true) risk = 'read'
  else if (normalized.readOnlyHint === false) risk = 'write'
  else risk = 'unknown-write'
  return Object.freeze({
    risk,
    requiresApproval: risk !== 'read',
    openWorld: normalized.openWorldHint === true,
    idempotent: normalized.idempotentHint === true,
    annotations: normalized,
  })
}

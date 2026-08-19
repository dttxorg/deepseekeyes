const DIRECT_CREDENTIAL_OPTIONS = new Set([
  '--access-token',
  '--access-key',
  '--api-key',
  '--apikey',
  '--api-token',
  '--auth',
  '--auth-token',
  '--authorization',
  '--app-secret',
  '--basic-auth',
  '--bearer',
  '--bearer-token',
  '--client-secret',
  '--consumer-secret',
  '--cookie',
  '--cookies',
  '--credential',
  '--credentials',
  '--oauth-token',
  '--oauth2-token',
  '--pass',
  '--passphrase',
  '--password',
  '--password-file',
  '--passwd',
  '--pat',
  '--personal-access-token',
  '--private-key',
  '--proxy-password',
  '--proxy-user',
  '--pwd',
  '--refresh-token',
  '--secret',
  '--secret-key',
  '--session-token',
  '--token',
  '--token-file',
  '--user',
  '--username',
])

const HEADER_OPTIONS = new Set([
  '--header',
  '--headers',
  '--http-header',
  '--proxy-header',
  '--request-header',
])

const SENSITIVE_HEADER_NAME = /^(?:authorization|proxy-authorization|cookie|set-cookie|api-key|x-api-key|x-auth-token|x-access-token|x-csrf-token|x-goog-api-key|x-amz-security-token)$/i
const INLINE_AUTH_SCHEME = /(?:^|[:=]\s*)(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{3,}/i
const INLINE_CREDENTIAL_ASSIGNMENT = /(?:^|[?&,\s{["'])(?:access[-_]?key|access[-_]?token|api[-_]?key|api[-_]?token|auth|authorization|client[-_]?secret|credential|cookie|oauth2?[-_]?token|pass|password|passwd|pat|private[-_]?key|refresh[-_]?token|secret|secret[-_]?key|session[-_]?token|token)["']?\s*[:=]\s*["']?\S+/i
const KNOWN_TOKEN_PREFIX = /(?:^|[^A-Za-z0-9])(?:github_pat_|ghp_|gho_|ghu_|ghs_|ghr_|npm_|sk-|sk_)[A-Za-z0-9_-]{8,}/i

function optionSeparator(argument) {
  const equals = argument.indexOf('=')
  const colon = argument.startsWith('--') ? argument.indexOf(':', 2) : -1
  if (equals < 0) return colon
  if (colon < 0) return equals
  return Math.min(equals, colon)
}

function optionName(argument) {
  const separator = optionSeparator(argument)
  const raw = (separator < 0 ? argument : argument.slice(0, separator)).toLowerCase()
  return raw.startsWith('--') ? `--${raw.slice(2).replaceAll('_', '-')}` : raw
}

function inlineOptionValue(argument) {
  const separator = optionSeparator(argument)
  return separator < 0 ? undefined : argument.slice(separator + 1)
}

function windowsCredentialOption(argument) {
  const match = /^\/([A-Za-z][A-Za-z0-9_-]*)(?::|=)(.*)$/.exec(argument)
  if (match === null) return false
  return DIRECT_CREDENTIAL_OPTIONS.has(`--${match[1].toLowerCase().replaceAll('_', '-')}`)
}

function headerOptionValue(argument, nextArgument) {
  if (argument === '-H') return nextArgument
  if (argument.startsWith('-H') && argument.length > 2) {
    return argument.slice(argument[2] === '=' ? 3 : 2)
  }
  const name = optionName(argument)
  if (!HEADER_OPTIONS.has(name)) return undefined
  return inlineOptionValue(argument) ?? nextArgument
}

function sensitiveHeaderValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  const trimmed = value.trim()
  const separator = trimmed.search(/[:=]/)
  if (separator > 0 && SENSITIVE_HEADER_NAME.test(trimmed.slice(0, separator).trim())) return true
  return INLINE_AUTH_SCHEME.test(trimmed)
    || INLINE_CREDENTIAL_ASSIGNMENT.test(trimmed)
    || KNOWN_TOKEN_PREFIX.test(trimmed)
}

function sensitiveStandaloneValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  const trimmed = value.trim()
  return INLINE_AUTH_SCHEME.test(trimmed)
    || INLINE_CREDENTIAL_ASSIGNMENT.test(trimmed)
    || KNOWN_TOKEN_PREFIX.test(trimmed)
}

/**
 * Detect credentials that would be persisted directly in a stdio argv list.
 * Environment-variable names belong in server.env and are never interpolated
 * here, so credential-bearing options are rejected even when their value looks
 * like a variable name.
 */
export function mcpArgsContainInlineCredentials(args) {
  if (!Array.isArray(args)) return false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (typeof argument !== 'string') continue
    const name = optionName(argument)
    if (DIRECT_CREDENTIAL_OPTIONS.has(name) || argument === '-u' || argument.startsWith('-u=')) {
      return true
    }
    if (/^-u[^\s:]+:.+$/.test(argument)) return true
    if (windowsCredentialOption(argument)) return true

    const header = headerOptionValue(argument, args[index + 1])
    if (header !== undefined && sensitiveHeaderValue(header)) return true
    if (sensitiveStandaloneValue(argument)) return true
  }
  return false
}

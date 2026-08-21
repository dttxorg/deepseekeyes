import { safeError, safeErrorCode } from './canonical.js'

const OAUTH_AUTH_METHODS = new Set(['client_secret_basic', 'client_secret_post'])

function stringValue(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`deepseekeyes: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function environmentValue(reference, environment, field) {
  const env = typeof reference === 'string' ? reference : reference?.env
  const value = environment?.[env]
  if (typeof value !== 'string' || value === '') {
    const error = new Error(`MCP OAuth ${field} requires environment variable ${env}`)
    error.code = 'MCP_OAUTH_CREDENTIAL_MISSING'
    throw error
  }
  return value
}

function safeTokenExpiry(expiresIn, now = Date.now) {
  if (expiresIn === undefined || expiresIn === null || expiresIn === '') return undefined
  const value = Number(expiresIn)
  return Number.isFinite(value) && value > 0 ? now() + Math.floor(value * 1_000) : undefined
}

function errorState(error, fallback = 'MCP_OAUTH_FAILED') {
  return Object.freeze({
    code: safeErrorCode(error, fallback),
    message: safeError(error),
  })
}

function cloneDiscoveryState(value) {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    return Object.freeze(structuredClone(value))
  } catch {
    return undefined
  }
}

/**
 * Process-local OAuth client-credentials session shared by a server's Tools
 * and Content planes. No client secret, access token, or discovery state is
 * written to settings, audit records, or disk.
 */
export class McpOAuthSession {
  constructor(server, environment = process.env, options = {}) {
    this.server = server
    this.environment = environment
    this.now = options.now ?? Date.now
    this.onEvent = options.onEvent
    this.tokensValue = undefined
    this.discoveryValue = undefined
    this.statusValue = 'idle'
    this.lastErrorValue = undefined
    this.lastEventAt = undefined
    this.provider = this.createProvider()
  }

  credentials() {
    return Object.freeze({
      clientId: environmentValue(this.server.oauth.clientId, this.environment, 'clientId'),
      clientSecret: environmentValue(this.server.oauth.clientSecret, this.environment, 'clientSecret'),
    })
  }

  emit(type, extra = {}) {
    this.lastEventAt = new Date(this.now()).toISOString()
    try {
      this.onEvent?.(Object.freeze({
        type,
        at: this.lastEventAt,
        serverId: this.server.id,
        ...(this.lastErrorValue === undefined ? {} : { error: this.lastErrorValue }),
        ...extra,
      }))
    } catch {
      // Health and authentication must not depend on an optional audit sink.
    }
  }

  createProvider() {
    const session = this
    return {
      // Client credentials is intentionally non-interactive. Interactive
      // authorization is a separate follow-up and remains disabled here.
      get redirectUrl() { return undefined },
      get clientMetadata() {
        return {
          redirect_uris: [],
          grant_types: ['client_credentials'],
          response_types: [],
          client_name: 'DeepSeekEyes',
          ...(session.server.oauth.scope === undefined ? {} : { scope: session.server.oauth.scope }),
        }
      },
      async clientInformation() {
        const credentials = session.credentials()
        return {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          ...(session.server.oauth.authMethod === undefined ? {} : {
            token_endpoint_auth_method: session.server.oauth.authMethod,
          }),
        }
      },
      async tokens() {
        if (session.tokensValue?.expiresAt !== undefined && session.tokensValue.expiresAt <= session.now()) {
          session.statusValue = 'expired'
          session.emit('token-expired')
          return undefined
        }
        return session.tokensValue?.tokens
      },
      async saveTokens(tokens) {
        if (tokens === null || typeof tokens !== 'object' || typeof tokens.access_token !== 'string' || tokens.access_token === '') {
          const error = new Error('OAuth token response did not contain access_token')
          error.code = 'MCP_OAUTH_TOKEN_INVALID'
          session.recordError(error, 'token-invalid')
          throw error
        }
        const expiresAt = safeTokenExpiry(tokens.expires_in, session.now)
        session.tokensValue = Object.freeze({
          // Keep only the fields the MCP SDK reads. The token remains process
          // local and is never returned by health or audit projections.
          tokens: Object.freeze({
            access_token: tokens.access_token,
            token_type: typeof tokens.token_type === 'string' ? tokens.token_type : 'Bearer',
            ...(tokens.expires_in === undefined ? {} : { expires_in: tokens.expires_in }),
            ...(typeof tokens.scope === 'string' ? { scope: tokens.scope } : {}),
          }),
          expiresAt,
        })
        session.statusValue = 'authenticated'
        session.lastErrorValue = undefined
        session.emit('token-acquired', expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt).toISOString() })
      },
      prepareTokenRequest(scope) {
        const params = new URLSearchParams({ grant_type: 'client_credentials' })
        const requestedScope = scope ?? session.server.oauth.scope
        if (requestedScope !== undefined && requestedScope !== '') params.set('scope', requestedScope)
        return params
      },
      async saveDiscoveryState(state) {
        session.discoveryValue = cloneDiscoveryState(state)
        session.statusValue = session.statusValue === 'authenticated' ? session.statusValue : 'discovering'
        session.emit('discovery-cached')
      },
      async discoveryState() {
        return session.discoveryValue
      },
      async invalidateCredentials(scope) {
        if (scope === 'tokens' || scope === 'client' || scope === 'all') session.tokensValue = undefined
        if (scope === 'discovery' || scope === 'all') session.discoveryValue = undefined
        session.statusValue = 'error'
        session.emit('credentials-invalidated', { scope })
      },
      async redirectToAuthorization() {
        const error = new Error('Interactive OAuth is not enabled; configure client credentials')
        error.code = 'MCP_OAUTH_INTERACTIVE_UNSUPPORTED'
        throw error
      },
      async codeVerifier() {
        const error = new Error('Interactive OAuth is not enabled for client credentials')
        error.code = 'MCP_OAUTH_INTERACTIVE_UNSUPPORTED'
        throw error
      },
      async state() { return undefined },
    }
  }

  recordError(error, type = 'auth-error') {
    this.lastErrorValue = errorState(error)
    this.statusValue = 'error'
    this.emit(type)
    return this.lastErrorValue
  }

  markConnected() {
    if (this.tokensValue?.expiresAt !== undefined && this.tokensValue.expiresAt <= this.now()) {
      this.statusValue = 'expired'
    } else if (this.tokensValue !== undefined) {
      this.statusValue = 'authenticated'
    } else {
      this.statusValue = 'connected'
    }
    this.lastErrorValue = undefined
    this.emit('connected')
  }

  health() {
    const expiresAt = this.tokensValue?.expiresAt
    const expired = expiresAt !== undefined && expiresAt <= this.now()
    if (expired) this.statusValue = 'expired'
    return Object.freeze({
      enabled: true,
      status: this.statusValue,
      authenticated: this.tokensValue !== undefined && !expired,
      ...(expiresAt === undefined ? {} : { tokenExpiresAt: new Date(expiresAt).toISOString() }),
      ...(this.discoveryValue === undefined ? {} : { discoveryCached: true }),
      ...(this.lastErrorValue === undefined ? {} : { lastError: this.lastErrorValue }),
      ...(this.lastEventAt === undefined ? {} : { lastEventAt: this.lastEventAt }),
    })
  }
}

export class McpOAuthSessionRegistry {
  constructor(options = {}) {
    this.options = options
    this.sessions = new Map()
  }

  key(server) {
    return JSON.stringify({
      id: server.id,
      url: server.url,
      oauth: server.oauth,
    })
  }

  get(server, environment = process.env, hooks = {}) {
    const key = this.key(server)
    const current = this.sessions.get(key)
    if (current !== undefined) return current
    const session = new McpOAuthSession(server, environment, {
      now: this.options.now,
      onEvent: hooks.onEvent,
    })
    this.sessions.set(key, session)
    return session
  }
}

export function isMcpOAuthEnabled(server) {
  return server?.transport === 'streamable-http' && server?.oauth?.enabled === true
}

export function normalizeMcpOAuthAuthMethod(value, field = 'oauth.authMethod') {
  const method = stringValue(value, field)
  if (method === undefined) return undefined
  if (!OAUTH_AUTH_METHODS.has(method)) {
    throw new TypeError(`deepseekeyes: ${field} must be client_secret_basic or client_secret_post`)
  }
  return method
}

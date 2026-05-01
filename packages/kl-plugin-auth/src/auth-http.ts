import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { compare } from 'bcryptjs'
import type {
  AuthContext,
  AuthIdentity,
  AuthIdentityPlugin,
  StandaloneHttpHandler,
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
  StandaloneHttpRequestContext,
} from 'kanban-lite/sdk'
import {
  AUTH_SESSIONS_FILE,
  AUTH_PLUGIN_SECRET_REDACTION,
  LOCAL_AUTH_COOKIE,
  LOCAL_AUTH_SESSION_TTL_MS,
  MOBILE_AUTH_CONTRACT,
  MOBILE_BOOTSTRAP_FILE,
  MOBILE_SESSIONS_FILE,
  createAuthIdentityOptionsSchema,
  getConfiguredApiToken,
  loadSessionsFromFile,
  persistSessionsToFile,
  normalizeOptionalRole,
  normalizeToken,
  normalizeConfiguredTokens,
  resolveAuthCapabilities,
  resolveLocalIdentity,
  safeTokenEquals,
  type AuthConfigSnapshot,
  type LocalAuthSession,
  type LocalAuthToken,
  type LocalAuthUser,
  type MobileAuthSession,
} from './auth-core'

export const LOCAL_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'local', provides: ['auth.identity'] },
  optionsSchema: createAuthIdentityOptionsSchema,
  async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
    return resolveLocalIdentity(context)
  },
}

export function getLocalUsers(options: StandaloneHttpPluginRegistrationOptions): LocalAuthUser[] {
  const users = resolveAuthCapabilities(options)['auth.identity'].options?.users
  if (!Array.isArray(users)) return []
  return users.flatMap((user) => {
    if (!user || typeof user !== 'object') return []
    const username = (user as { username?: unknown }).username
    const password = (user as { password?: unknown }).password
    const role = normalizeOptionalRole((user as { role?: unknown }).role)
    if (typeof username !== 'string' || username.length === 0 || typeof password !== 'string' || password.length === 0) {
      return []
    }
    const entry: LocalAuthUser = { username, password }
    if (role) entry.role = role
    return [entry]
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) return acc
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (!key) return acc
    acc[key] = decodeURIComponent(value)
    return acc
  }, {})
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function redirect(res: import('node:http').ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { Location: location })
  res.end()
}

function setCookie(
  res: import('node:http').ServerResponse,
  name: string,
  value: string,
  attributes: string[],
): void {
  const existing = res.getHeader('Set-Cookie')
  const next = `${name}=${encodeURIComponent(value)}; ${attributes.join('; ')}`
  if (!existing) {
    res.setHeader('Set-Cookie', next)
    return
  }
  res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, next] : [String(existing), next])
}

function clearCookie(res: import('node:http').ServerResponse, name: string): void {
  setCookie(res, name, '', ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'])
}

function normalizeReturnTo(rawValue: string | null | undefined): string {
  if (!rawValue || !rawValue.startsWith('/') || rawValue.startsWith('//')) return '/'
  if (rawValue.startsWith('/.well-known/')) return '/'
  return rawValue
}

function renderLoginPage(returnTo: string, error?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kanban Lite Login</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #111827; color: #f9fafb; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      form { width: min(420px, calc(100vw - 32px)); background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 24px; box-sizing: border-box; }
      h1 { margin: 0 0 8px; font-size: 1.5rem; }
      p { margin: 0 0 16px; color: #d1d5db; }
      label { display: block; margin: 12px 0 6px; font-weight: 600; }
      input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #4b5563; background: #111827; color: inherit; }
      button { margin-top: 16px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
      .error { margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; background: rgba(220, 38, 38, 0.2); color: #fecaca; }
    </style>
  </head>
  <body>
    <form method="post" action="/auth/login">
      <h1>Sign in</h1>
      <p>Authenticate to open this Kanban Lite workspace.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`
}

async function parseLoginBody(req: import('node:http').IncomingMessage & { _rawBody?: Buffer }): Promise<{ username: string; password: string; returnTo: string }> {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  const rawBody = req._rawBody?.toString('utf-8') ?? ''

  if (contentType.includes('application/json')) {
    const parsed = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {}
    return {
      username: typeof parsed.username === 'string' ? parsed.username : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      returnTo: normalizeReturnTo(typeof parsed.returnTo === 'string' ? parsed.returnTo : '/'),
    }
  }

  const params = new URLSearchParams(rawBody)
  return {
    username: params.get('username') ?? '',
    password: params.get('password') ?? '',
    returnTo: normalizeReturnTo(params.get('returnTo')),
  }
}

export const LOCAL_AUTH_PROVIDER_IDS = new Set(['local', 'kl-plugin-auth'])

export function buildMobileWorkspaceId(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot).replace(/\\/g, '/')
  const portable = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return 'workspace_' + crypto.createHash('sha256').update(portable).digest('hex').slice(0, 12)
}

export function normalizeMobileWorkspaceOrigin(value: string): string | null {
  try { return new URL(value.trim()).origin } catch { return null }
}

export function getMobileBearerToken(req: import('node:http').IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (typeof auth !== 'string') return null
  const m = auth.match(/^[Bb]earer\s+(.+)$/)
  return m ? m[1].trim() : null
}

export function isLocalAuthEnabled(options: StandaloneHttpPluginRegistrationOptions): boolean {
  const authCapabilities = resolveAuthCapabilities(options)
  return LOCAL_AUTH_PROVIDER_IDS.has(authCapabilities['auth.identity'].provider)
    || LOCAL_AUTH_PROVIDER_IDS.has(authCapabilities['auth.policy'].provider)
}

export function createStandaloneHttpPlugin(options: StandaloneHttpPluginRegistrationOptions): StandaloneHttpPlugin {
  const authCapabilities = resolveAuthCapabilities(options)
  const localAuthEnabled = isLocalAuthEnabled(options)
  const users = getLocalUsers(options)
  const sessionFilePath = path.join(options.kanbanDir, AUTH_SESSIONS_FILE)
  const sessionStore = loadSessionsFromFile(sessionFilePath)

  // Mobile session store (separate from browser sessions)
  const mobileSessionFilePath = path.join(options.kanbanDir, MOBILE_SESSIONS_FILE)
  const mobileSessionStore = new Map<string, MobileAuthSession>()
  try {
    if (fs.existsSync(mobileSessionFilePath)) {
      const raw = JSON.parse(fs.readFileSync(mobileSessionFilePath, 'utf-8')) as Record<string, MobileAuthSession>
      for (const [token, session] of Object.entries(raw)) {
        if (session && typeof session.username === 'string') mobileSessionStore.set(token, session)
      }
    }
  } catch { /* ignore corrupt file */ }

  function persistMobileSessions(): void {
    try {
      const data: Record<string, MobileAuthSession> = {}
      for (const [token, session] of mobileSessionStore) data[token] = session
      fs.writeFileSync(mobileSessionFilePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch { /* best-effort */ }
  }

  const identityOptions = authCapabilities['auth.identity'].options
  const explicitApiToken =
    typeof identityOptions?.apiToken === 'string' && identityOptions.apiToken.length > 0
      ? identityOptions.apiToken
      : null
  const configuredTokens: readonly LocalAuthToken[] = localAuthEnabled
    ? normalizeConfiguredTokens(identityOptions ?? null)
    : []
  const apiToken: string | null = (() => {
    if (!localAuthEnabled) return null
    if (explicitApiToken) return explicitApiToken
    const envToken = getConfiguredApiToken()
    if (envToken) return envToken
    // A named tokens array also satisfies the requirement — no global token needed.
    if (configuredTokens.length > 0) return null
    throw new Error(
      'kl-plugin-auth: auth.identity is configured but no API token is available. ' +
      'Set "apiToken" in auth.identity options, add entries to the "tokens" array, ' +
      'or set the KANBAN_LITE_TOKEN environment variable before starting the server.',
    )
  })()

  const getSessionIdentity = (request: StandaloneHttpRequestContext): AuthIdentity | null => {
    const sessionId = parseCookies(request.req.headers.cookie)[LOCAL_AUTH_COOKIE]
    if (!sessionId) return null
    const session = sessionStore.get(sessionId)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      sessionStore.delete(sessionId)
      persistSessionsToFile(sessionFilePath, sessionStore)
      return null
    }
    const user = users.find((u) => u.username === session.username)
    const identity: AuthIdentity = { subject: session.username }
    if (typeof user?.role === 'string' && user.role.length > 0) identity.roles = [user.role]
    return identity
  }

  const applyRequestIdentity = (request: StandaloneHttpRequestContext): AuthIdentity | null => {
    const authorization = request.req.headers.authorization
    const queryToken = request.url.searchParams.get('token')
    const requestToken = normalizeToken(
      typeof authorization === 'string' ? authorization : queryToken ?? undefined,
    )
    if (requestToken) {
      const tokenSource = queryToken && requestToken === normalizeToken(queryToken) ? 'query-param' : 'request-header'
      // Check global apiToken first (unrestricted access, backward compat).
      if (apiToken && safeTokenEquals(requestToken, apiToken)) {
        request.mergeAuthContext({
          token: requestToken,
          tokenSource,
          transport: 'http',
          identity: { subject: 'api-token' },
          actorHint: 'api-token',
        })
        return { subject: 'api-token' }
      }
      // Check named tokens array; tokens with a role carry role-based access.
      const matchedToken = configuredTokens.find((t) => safeTokenEquals(requestToken, t.token))
      if (matchedToken) {
        // Use 'named-token' subject when a role is set so RBAC policy checks
        // are not bypassed by the 'api-token' fast-path.
        const subject = matchedToken.role ? 'named-token' : 'api-token'
        const identity: AuthIdentity = { subject }
        if (matchedToken.role) identity.roles = [matchedToken.role]
        request.mergeAuthContext({
          token: requestToken,
          tokenSource,
          transport: 'http',
          identity,
          actorHint: subject,
        })
        return identity
      }
    }

    const sessionIdentity = getSessionIdentity(request)
    if (sessionIdentity) {
      request.mergeAuthContext({
        transport: 'http',
        tokenSource: 'cookie',
        identity: sessionIdentity,
        actorHint: sessionIdentity.subject,
      })
    }
    return sessionIdentity
  }

  return {
    manifest: { id: 'kl-plugin-auth-standalone', provides: ['standalone.http'] },
    registerMiddleware(): readonly StandaloneHttpHandler[] {
      if (!localAuthEnabled) return []
      return [
        async (request: StandaloneHttpRequestContext) => {
          const isPublicAuthRoute = request.pathname === '/auth/login'
            || request.pathname === '/auth/logout'
            || request.pathname.startsWith('/api/mobile/')
          const identity = applyRequestIdentity(request)
          if (identity || isPublicAuthRoute) return false

          if (request.isApiRequest) {
            sendJson(request.res, 401, { ok: false, error: 'Authentication required' })
            return true
          }

          if (request.isPageRequest) {
            const returnTo = normalizeReturnTo(`${request.pathname}${request.url.search}`)
            redirect(request.res, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
            return true
          }

          return false
        },
      ]
    },
    registerRoutes(): readonly StandaloneHttpHandler[] {
      if (!localAuthEnabled) return []
      return [
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('GET', '/auth/login')) return false
          const identity = applyRequestIdentity(request)
          const returnTo = normalizeReturnTo(request.url.searchParams.get('returnTo'))
          if (identity) {
            redirect(request.res, returnTo)
            return true
          }
          request.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          request.res.end(renderLoginPage(returnTo))
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('POST', '/auth/login')) return false
          const { username, password, returnTo } = await parseLoginBody(request.req)
          const user = users.find((candidate) => candidate.username === username)
          const passwordMatches = user ? await compare(password, user.password) : false

          if (!user || !passwordMatches) {
            request.res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
            request.res.end(renderLoginPage(returnTo, 'Invalid username or password.'))
            return true
          }

          const sessionId = crypto.randomBytes(24).toString('hex')
          sessionStore.set(sessionId, {
            username: user.username,
            expiresAt: Date.now() + LOCAL_AUTH_SESSION_TTL_MS,
          })
          persistSessionsToFile(sessionFilePath, sessionStore)
          setCookie(request.res, LOCAL_AUTH_COOKIE, sessionId, [
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            `Max-Age=${Math.floor(LOCAL_AUTH_SESSION_TTL_MS / 1000)}`,
          ])
          redirect(request.res, returnTo)
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('POST', '/auth/logout') && !request.route('GET', '/auth/logout')) return false
          const sessionId = parseCookies(request.req.headers.cookie)[LOCAL_AUTH_COOKIE]
          if (sessionId) {
            sessionStore.delete(sessionId)
            persistSessionsToFile(sessionFilePath, sessionStore)
          }
          clearCookie(request.res, LOCAL_AUTH_COOKIE)
          redirect(request.res, '/auth/login')
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('POST', '/api/mobile/session')) return false
          const rawBody = (request.req as import('node:http').IncomingMessage & { _rawBody?: Buffer })._rawBody?.toString('utf-8') ?? '{}'
          const body = (() => { try { return JSON.parse(rawBody) as Record<string, unknown> } catch { return {} } })()
          const rawOrigin = typeof body.workspaceOrigin === 'string' ? body.workspaceOrigin : ''
          const workspaceOrigin = normalizeMobileWorkspaceOrigin(rawOrigin)
          if (!workspaceOrigin) {
            sendJson(request.res, 400, { ok: false, error: 'workspaceOrigin is required' })
            return true
          }
          const bootstrapToken = typeof body.bootstrapToken === 'string' ? body.bootstrapToken.trim() : ''
          if (bootstrapToken) {
            const bootstrapFilePath = path.join(options.kanbanDir, MOBILE_BOOTSTRAP_FILE)
            let grants: Record<string, { username: string; workspaceOrigin: string; expiresAt: number }> = {}
            try {
              if (fs.existsSync(bootstrapFilePath)) {
                grants = JSON.parse(fs.readFileSync(bootstrapFilePath, 'utf-8')) as typeof grants
              }
            } catch { /* ignore */ }
            const grant = grants[bootstrapToken]
            if (!grant || grant.expiresAt < Date.now()) {
              sendJson(request.res, 401, { ok: false, error: 'ERR_MOBILE_AUTH_LINK_INVALID' })
              return true
            }
            const grantOrigin = normalizeMobileWorkspaceOrigin(grant.workspaceOrigin)
            if (grantOrigin !== workspaceOrigin) {
              sendJson(request.res, 403, { ok: false, error: 'Bootstrap token is not valid for the requested workspace.' })
              return true
            }
            delete grants[bootstrapToken]
            try { fs.writeFileSync(bootstrapFilePath, JSON.stringify(grants, null, 2), 'utf-8') } catch { /* ignore */ }
            const user = users.find((u) => u.username === grant.username)
            const roles = user?.role ? [user.role] : []
            const token = crypto.randomBytes(48).toString('hex')
            mobileSessionStore.set(token, { username: grant.username, roles, workspaceOrigin, expiresAt: null })
            persistMobileSessions()
            sendJson(request.res, 200, {
              ok: true,
              data: {
                session: { kind: 'local-mobile-session-v1', token },
                status: {
                  workspaceOrigin,
                  workspaceId: buildMobileWorkspaceId(options.workspaceRoot),
                  subject: grant.username,
                  roles,
                  expiresAt: null,
                  authentication: { ...MOBILE_AUTH_CONTRACT },
                },
              },
            })
            return true
          }
          const username = typeof body.username === 'string' ? body.username.trim() : ''
          const password = typeof body.password === 'string' ? body.password : ''
          if (!username || !password) {
            sendJson(request.res, 400, { ok: false, error: 'username and password are required' })
            return true
          }
          const user = users.find((u) => u.username === username)
          const valid = user ? await compare(password, user.password) : false
          if (!valid) {
            sendJson(request.res, 401, { ok: false, error: 'Invalid credentials.' })
            return true
          }
          const roles = user?.role ? [user.role] : []
          const token = crypto.randomBytes(48).toString('hex')
          mobileSessionStore.set(token, { username, roles, workspaceOrigin, expiresAt: null })
          persistMobileSessions()
          sendJson(request.res, 200, {
            ok: true,
            data: {
              session: { kind: 'local-mobile-session-v1', token },
              status: {
                workspaceOrigin,
                workspaceId: buildMobileWorkspaceId(options.workspaceRoot),
                subject: username,
                roles,
                expiresAt: null,
                authentication: { ...MOBILE_AUTH_CONTRACT },
              },
            },
          })
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('GET', '/api/mobile/session')) return false
          const bearerToken = getMobileBearerToken(request.req)
          if (!bearerToken) {
            sendJson(request.res, 401, { ok: false, error: 'Authentication required' })
            return true
          }
          const session = mobileSessionStore.get(bearerToken)
          if (!session || (session.expiresAt !== null && session.expiresAt < Date.now())) {
            if (session) { mobileSessionStore.delete(bearerToken); persistMobileSessions() }
            sendJson(request.res, 401, { ok: false, error: 'Authentication required' })
            return true
          }
          const rawOrigin = request.url.searchParams.get('workspaceOrigin') ?? ''
          const requestedOrigin = normalizeMobileWorkspaceOrigin(rawOrigin)
          if (!requestedOrigin) {
            sendJson(request.res, 400, { ok: false, error: 'workspaceOrigin query parameter is required' })
            return true
          }
          if (requestedOrigin !== session.workspaceOrigin) {
            sendJson(request.res, 403, { ok: false, error: 'Mobile session is not valid for the requested workspace.' })
            return true
          }
          sendJson(request.res, 200, {
            ok: true,
            data: {
              workspaceOrigin: session.workspaceOrigin,
              workspaceId: buildMobileWorkspaceId(options.workspaceRoot),
              subject: session.username,
              roles: session.roles,
              expiresAt: session.expiresAt !== null ? new Date(session.expiresAt).toISOString() : null,
              authentication: { ...MOBILE_AUTH_CONTRACT },
            },
          })
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('DELETE', '/api/mobile/session')) return false
          const bearerToken = getMobileBearerToken(request.req)
          if (!bearerToken || !mobileSessionStore.has(bearerToken)) {
            sendJson(request.res, 401, { ok: false, error: 'Authentication required' })
            return true
          }
          mobileSessionStore.delete(bearerToken)
          persistMobileSessions()
          sendJson(request.res, 200, { ok: true })
          return true
        },
      ]
    },
  }
}

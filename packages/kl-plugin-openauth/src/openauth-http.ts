import type * as http from 'node:http'
import { createClient } from '@openauthjs/openauth/client'
import { InvalidAuthorizationCodeError, InvalidRefreshTokenError } from '@openauthjs/openauth/error'
import type {
  StandaloneHttpHandler,
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
  StandaloneHttpRequestContext
} from 'kanban-lite/sdk'
import { createEmbeddedIssuer, type EmbeddedIssuerOptions } from './openauth-issuer'
import { subjects } from './openauth-subjects'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_COOKIE = 'oa_access_token'
const REFRESH_TOKEN_COOKIE = 'oa_refresh_token'
const PKCE_CHALLENGE_COOKIE = 'oa_pkce_challenge'
const AUTH_PREFIX = '/auth/openauth'

// ---------------------------------------------------------------------------
// HTTP helpers``
// ---------------------------------------------------------------------------

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key.length > 0) cookies[key] = decodeURIComponent(value)
  }
  return cookies
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

function redirect(res: http.ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { Location: location })
  res.end()
}

function setCookie(
  res: http.ServerResponse,
  name: string,
  value: string,
  attributes: string[]
): void {
  const encoded = encodeURIComponent(value)
  const cookie = `${name}=${encoded}; ${attributes.join('; ')}`
  const existing = res.getHeader('Set-Cookie')
  const all = existing
    ? Array.isArray(existing)
      ? [...existing, cookie]
      : [String(existing), cookie]
    : [cookie]
  res.setHeader('Set-Cookie', all)
}

function clearCookie(res: http.ServerResponse, name: string): void {
  setCookie(res, name, '', ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'])
}

function normalizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/'
  if (raw.startsWith('//')) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('/.well-known/')) return '/'
  return raw
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function setTokenCookies(
  res: http.ServerResponse,
  accessToken: string,
  refreshToken: string,
  expiresIn?: number
): void {
  const maxAge = expiresIn ?? 86400
  setCookie(res, ACCESS_TOKEN_COOKIE, accessToken, [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ])
  setCookie(res, REFRESH_TOKEN_COOKIE, refreshToken, [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=31536000' // 1 year (refresh tokens are long-lived)
  ])
}

function clearTokenCookies(res: http.ServerResponse): void {
  clearCookie(res, ACCESS_TOKEN_COOKIE)
  clearCookie(res, REFRESH_TOKEN_COOKIE)
  clearCookie(res, PKCE_CHALLENGE_COOKIE)
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OpenAuthHttpOptions {
  issuer: string
  clientId: string
  callbackPath?: string
  provider?: string
  roleMapping?: {
    claim?: string
    default?: string
  }
  /**
   * When set, an in-process OpenAuth issuer is mounted on the same server.
   * Requests for OpenAuth-internal paths (/.well-known/*, /authorize, /token,
   * /callback, /password, /google, etc.) are forwarded to this embedded issuer.
   * The `issuer` URL above must point at the same server origin.
   */
  embeddedIssuer?: EmbeddedIssuerOptions
}

function resolveHttpOptions(
  regOptions: StandaloneHttpPluginRegistrationOptions
): OpenAuthHttpOptions | null {
  const caps = regOptions.authCapabilities
  if (!caps) return null
  const opts = (caps['auth.identity'] as { options?: Record<string, unknown> } | undefined)
    ?.options
  if (!opts) return null
  const issuer = typeof opts.issuer === 'string' && opts.issuer.length > 0 ? opts.issuer : null
  const clientId =
    typeof opts.clientId === 'string' && opts.clientId.length > 0 ? opts.clientId : null
  if (!issuer || !clientId) return null
  return {
    issuer,
    clientId,
    callbackPath: typeof opts.callbackPath === 'string' ? opts.callbackPath : undefined,
    provider: typeof opts.provider === 'string' ? opts.provider : undefined,
    roleMapping: opts.roleMapping as OpenAuthHttpOptions['roleMapping'],
    embeddedIssuer: opts.embeddedIssuer as EmbeddedIssuerOptions | undefined,
  }
}

// ---------------------------------------------------------------------------
// Role extraction (mirrors identity module)
// ---------------------------------------------------------------------------

function extractRoles(
  properties: Record<string, unknown>,
  roleMapping: OpenAuthHttpOptions['roleMapping']
): string[] {
  const claimKey = roleMapping?.claim ?? 'role'
  const value = properties[claimKey]
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) return [value]
  return roleMapping?.default ? [roleMapping.default] : []
}

// ---------------------------------------------------------------------------
// Public auth routes (no token required)
// ---------------------------------------------------------------------------

const PUBLIC_AUTH_ROUTES = new Set([
  `${AUTH_PREFIX}/login`,
  `${AUTH_PREFIX}/authorize`,
  `${AUTH_PREFIX}/callback`
])

function isPublicAuthRoute(pathname: string): boolean {
  return PUBLIC_AUTH_ROUTES.has(pathname)
}

// ---------------------------------------------------------------------------
// createStandaloneHttpPlugin
// ---------------------------------------------------------------------------

export function createStandaloneHttpPlugin(
  httpOptions?: OpenAuthHttpOptions | StandaloneHttpPluginRegistrationOptions
): StandaloneHttpPlugin {
  // When called by the SDK, it passes StandaloneHttpPluginRegistrationOptions.
  // When called explicitly (e.g. in tests), it may receive OpenAuthHttpOptions.
  // Detect by checking for the `issuer` field which is unique to OpenAuthHttpOptions.
  const preResolvedOptions: OpenAuthHttpOptions | null =
    httpOptions != null && 'issuer' in httpOptions && typeof (httpOptions as OpenAuthHttpOptions).issuer === 'string'
      ? (httpOptions as OpenAuthHttpOptions)
      : null

  return {
    manifest: { id: 'openauth-http', provides: ['standalone.http'] as const },

    registerMiddleware(regOptions): readonly StandaloneHttpHandler[] {
      const opts = preResolvedOptions ?? resolveHttpOptions(regOptions)
      if (!opts) return []

      const handlers: StandaloneHttpHandler[] = []

      // -------------------------------------------------------------------
      // Embedded issuer proxy — runs first, before token verification.
      // Forwards OpenAuth-internal routes (/.well-known/*, /authorize,
      // /token, /callback, /password, /google, etc.) to the in-process
      // OpenAuth issuer. Falls through for anything the issuer returns 404.
      // -------------------------------------------------------------------
      if (opts.embeddedIssuer) {
        const issuer = createEmbeddedIssuer(opts.embeddedIssuer)
        handlers.push(async function embeddedIssuerProxy(request): Promise<boolean> {
          const { pathname } = request
          // Never intercept kanban-lite's own auth-client routes or API routes
          if (pathname.startsWith('/api/') || pathname.startsWith(AUTH_PREFIX)) return false
          const proto =
            (request.req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
          const host =
            (request.req.headers['x-forwarded-host'] as string | undefined) ??
            (request.req.headers.host as string | undefined) ??
            'localhost'
          return issuer.tryHandle(request.req, request.res, `${proto}://${host}`)
        })
      }

      handlers.push(
        async function openAuthMiddleware(request): Promise<boolean> {
          const { req, res, pathname } = request

          // Let public auth routes through regardless
          if (isPublicAuthRoute(pathname)) return false

          const cookies = parseCookies(req.headers.cookie)
          const accessToken = cookies[ACCESS_TOKEN_COOKIE]
          const refreshToken = cookies[REFRESH_TOKEN_COOKIE]

          // No tokens → redirect or 401
          if (!accessToken) {
            if (request.isApiRequest) {
              sendJson(res, 401, { ok: false, error: 'Authentication required' })
              return true
            }
            if (request.isPageRequest) {
              const returnTo = encodeURIComponent(normalizeReturnTo(pathname))
              redirect(res, `${AUTH_PREFIX}/login?returnTo=${returnTo}`)
              return true
            }
            return false
          }

          // Use OpenAuth client.verify(subjects, token, { refresh }) for SSR auth
          try {
            const client = createClient({ clientID: opts.clientId, issuer: opts.issuer })
            const verified = await client.verify(subjects, accessToken, {
              refresh: refreshToken || undefined
            })

            if (verified.err) {
              clearTokenCookies(res)
              if (request.isApiRequest) {
                sendJson(res, 401, { ok: false, error: 'Invalid or expired token' })
                return true
              }
              redirect(res, `${AUTH_PREFIX}/login?returnTo=${encodeURIComponent(normalizeReturnTo(pathname))}`)
              return true
            }

            // If tokens were refreshed, update the cookies
            if (verified.tokens) {
              setTokenCookies(
                res,
                verified.tokens.access,
                verified.tokens.refresh,
                verified.tokens.expiresIn
              )
            }

            // Set auth context for downstream handlers
            const props = verified.subject.properties as Record<string, unknown>
            const userID = props.userID ?? props.userId ?? props.id
            const subjectId =
              typeof userID === 'string' && userID.length > 0 ? userID : 'openauth-user'
            const roles = extractRoles(props, opts.roleMapping)

            request.mergeAuthContext({
              transport: 'http',
              tokenSource: 'cookie',
              token: accessToken,
              identity: {
                subject: subjectId,
                ...(roles.length > 0 ? { roles } : {})
              },
              actorHint: subjectId
            })

            return false
          } catch (err) {
            if (err instanceof InvalidRefreshTokenError) {
              clearTokenCookies(res)
              if (request.isApiRequest) {
                sendJson(res, 401, { ok: false, error: 'Session expired' })
                return true
              }
              redirect(res, `${AUTH_PREFIX}/login?returnTo=${encodeURIComponent(normalizeReturnTo(pathname))}`)
              return true
            }
            return false
          }
        }
      )

      return handlers
    },

    registerRoutes(regOptions): readonly StandaloneHttpHandler[] {
      const opts = preResolvedOptions ?? resolveHttpOptions(regOptions)
      if (!opts) return []

      const callbackPath = opts.callbackPath ?? `${AUTH_PREFIX}/callback`

      return [
        // -------------------------------------------------------------------
        // GET /auth/openauth/login — landing page
        // -------------------------------------------------------------------
        async function loginPage(request): Promise<boolean> {
          const params = request.route('GET', `${AUTH_PREFIX}/login`)
          if (!params) return false

          const cookies = parseCookies(request.req.headers.cookie)
          const returnTo = normalizeReturnTo(request.url.searchParams.get('returnTo'))

          // Already authenticated? Redirect.
          if (cookies[ACCESS_TOKEN_COOKIE]) {
            redirect(request.res, returnTo)
            return true
          }

          // If an error was forwarded here (e.g. role matrix denial), show it
          // before letting the user retry — do not silently redirect to authorize.
          const errorMsg = request.url.searchParams.get('error')
          if (errorMsg) {
            const safe = escapeHtml(decodeURIComponent(errorMsg))
            const retryUrl = escapeHtml(`${AUTH_PREFIX}/authorize?returnTo=${encodeURIComponent(returnTo)}`)
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Sign-in error</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f8f8}.card{background:#fff;border-radius:8px;padding:2rem 2.5rem;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:420px;text-align:center}h1{font-size:1.2rem;color:#c0392b;margin-bottom:.75rem}p{color:#444;margin-bottom:1.5rem;word-break:break-word}a.btn{display:inline-block;padding:.6rem 1.4rem;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;font-size:.95rem}</style></head><body><div class="card"><h1>Sign-in denied</h1><p>${safe}</p><a class="btn" href="${retryUrl}">Try again</a></div></body></html>`
            const payload = Buffer.from(html, 'utf8')
            request.res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': payload.byteLength })
            request.res.end(payload)
            return true
          }

          // Render the login landing page with a link to the authorize flow.
          const authorizeUrl = escapeHtml(`${AUTH_PREFIX}/authorize?returnTo=${encodeURIComponent(returnTo)}`)
          const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Sign In</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f8f8}.card{background:#fff;border-radius:8px;padding:2rem 2.5rem;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:420px;text-align:center}h1{font-size:1.2rem;margin-bottom:1.5rem}a.btn{display:inline-block;padding:.6rem 1.4rem;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;font-size:.95rem}</style></head><body><div class="card"><h1>Sign In</h1><a class="btn" href="${authorizeUrl}">Sign in with OpenAuth</a></div></body></html>`
          const payload = Buffer.from(html, 'utf8')
          request.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': payload.byteLength })
          request.res.end(payload)
          return true
        },

        // -------------------------------------------------------------------
        // GET /auth/openauth/authorize — start OAuth code flow (with PKCE)
        // -------------------------------------------------------------------
        async function authorizeRedirect(request): Promise<boolean> {
          const params = request.route('GET', `${AUTH_PREFIX}/authorize`)
          if (!params) return false

          const returnTo = normalizeReturnTo(request.url.searchParams.get('returnTo'))
          const proto = request.req.headers['x-forwarded-proto'] ?? 'http'
          const host =
            request.req.headers['x-forwarded-host'] ?? request.req.headers.host ?? 'localhost'
          const redirectUri = `${proto}://${host}${callbackPath}`

          try {
            // Verify the issuer is reachable before redirecting the browser
            const check = await fetch(opts.issuer + '/.well-known/oauth-authorization-server', {
              signal: AbortSignal.timeout(5000),
              redirect: 'manual',
            }).catch(() => null)
            if (!check || !check.ok) {
              throw new Error('Issuer unreachable')
            }

            const client = createClient({ clientID: opts.clientId, issuer: opts.issuer })

            // Use PKCE code flow as recommended by OpenAuth
            const authorizeOpts: { pkce: boolean; provider?: string } = { pkce: true }
            if (opts.provider) authorizeOpts.provider = opts.provider

            const { url, challenge } = await client.authorize(redirectUri, 'code', authorizeOpts)

            // Store PKCE challenge + returnTo in an HttpOnly cookie
            const state = JSON.stringify({ challenge, returnTo })
            setCookie(request.res, PKCE_CHALLENGE_COOKIE, state, [
              'Path=/',
              'HttpOnly',
              'SameSite=Lax',
              'Max-Age=600' // 10 minute expiry
            ])

            redirect(request.res, url)
            return true
          } catch {
            redirect(
              request.res,
              `${AUTH_PREFIX}/login?error=${encodeURIComponent('Failed to start authentication')}&returnTo=${encodeURIComponent(returnTo)}`
            )
            return true
          }
        },

        // -------------------------------------------------------------------
        // GET /auth/openauth/callback — exchange code for tokens
        // -------------------------------------------------------------------
        async function callbackHandler(request): Promise<boolean> {
          const params = request.route('GET', callbackPath)
          if (!params) return false

          const code = request.url.searchParams.get('code')
          const cookies = parseCookies(request.req.headers.cookie)
          const stateRaw = cookies[PKCE_CHALLENGE_COOKIE]

          // Parse stored PKCE challenge + returnTo
          let challenge: { state: string; verifier: string } | undefined
          let returnTo = '/'
          if (stateRaw) {
            try {
              const parsed = JSON.parse(stateRaw) as {
                challenge: { state: string; verifier: string }
                returnTo?: string
              }
              challenge = parsed.challenge
              returnTo = normalizeReturnTo(parsed.returnTo)
            } catch {
              /* malformed cookie */
            }
          }

          // Clear the PKCE cookie regardless of outcome
          clearCookie(request.res, PKCE_CHALLENGE_COOKIE)

          // OpenAuth returns ?error=...&error_description=... when success() throws
          // (e.g. role matrix denial). Forward the description as the login error.
          const oaError = request.url.searchParams.get('error')
          if (oaError) {
            const desc = request.url.searchParams.get('error_description')
            const msg = desc ? decodeURIComponent(desc.replace(/\+/g, ' ')) : 'Authentication failed'
            redirect(
              request.res,
              `${AUTH_PREFIX}/login?error=${encodeURIComponent(msg)}&returnTo=${encodeURIComponent(returnTo)}`
            )
            return true
          }

          if (!code) {
            redirect(
              request.res,
              `${AUTH_PREFIX}/login?error=${encodeURIComponent('Missing authorization code')}&returnTo=${encodeURIComponent(returnTo)}`
            )
            return true
          }

          try {
            const proto = request.req.headers['x-forwarded-proto'] ?? 'http'
            const host =
              request.req.headers['x-forwarded-host'] ?? request.req.headers.host ?? 'localhost'
            const redirectUri = `${proto}://${host}${callbackPath}`

            const client = createClient({ clientID: opts.clientId, issuer: opts.issuer })

            console.log(`[openauth-callback] exchanging code, issuer=${opts.issuer} redirectUri=${redirectUri} hasVerifier=${Boolean(challenge?.verifier)}`)
            // Exchange code for tokens using OpenAuth client.exchange()
            // Pass PKCE verifier if available
            const exchanged = await client.exchange(code, redirectUri, challenge?.verifier)
            console.log(`[openauth-callback] exchange done, err=${exchanged.err}`)

            if (exchanged.err) {
              const msg =
                exchanged.err instanceof InvalidAuthorizationCodeError
                  ? 'Invalid or expired authorization code'
                  : 'Token exchange failed'
              redirect(
                request.res,
                `${AUTH_PREFIX}/login?error=${encodeURIComponent(msg)}&returnTo=${encodeURIComponent(returnTo)}`
              )
              return true
            }

            // Store access + refresh tokens in HttpOnly cookies (SSR pattern)
            const { access, refresh, expiresIn } = exchanged.tokens
            setTokenCookies(request.res, access, refresh, expiresIn)

            redirect(request.res, returnTo)
            return true
          } catch {
            redirect(
              request.res,
              `${AUTH_PREFIX}/login?error=${encodeURIComponent('Authentication failed')}&returnTo=${encodeURIComponent(returnTo)}`
            )
            return true
          }
        },

        // -------------------------------------------------------------------
        // POST|GET /auth/openauth/logout — clear tokens
        // -------------------------------------------------------------------
        async function logoutHandler(request): Promise<boolean> {
          const postMatch = request.route('POST', `${AUTH_PREFIX}/logout`)
          const getMatch = request.route('GET', `${AUTH_PREFIX}/logout`)
          if (!postMatch && !getMatch) return false

          clearTokenCookies(request.res)
          redirect(request.res, `${AUTH_PREFIX}/login`)
          return true
        }
      ]
    }
  }
}

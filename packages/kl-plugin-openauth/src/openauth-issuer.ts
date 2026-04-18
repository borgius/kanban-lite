import type * as http from 'node:http'
import { issuer as createIssuer } from '@openauthjs/openauth'
import { GoogleProvider } from '@openauthjs/openauth/provider/google'
import { PasswordProvider, ScryptHasher } from '@openauthjs/openauth/provider/password'
import { PasswordUI } from '@openauthjs/openauth/ui/password'
import { Select } from '@openauthjs/openauth/ui/select'
import { MemoryStorage } from '@openauthjs/openauth/storage/memory'
import { Storage } from '@openauthjs/openauth/storage/storage'
import type { Theme } from '@openauthjs/openauth/ui/theme'
import { subjects } from './openauth-subjects'

// ---------------------------------------------------------------------------
// Issuer configuration types
// ---------------------------------------------------------------------------

/** Hash produced by OpenAuth's ScryptHasher — stored in `.kanban.json` passwordHash field. */
export type ScryptHasherResult = { hash: string; salt: string; N: number; r: number; p: number }

export interface EmbeddedIssuerUser {
  email: string
  /**
   * @deprecated Use `passwordHash` instead. Plain-text passwords are hashed at startup
   * but log a warning. Run `kl openauth add-user` to migrate.
   */
  password?: string
  /** Pre-hashed password created by `kl openauth add-user`. */
  passwordHash?: ScryptHasherResult
  role?: string
}

/**
 * Hash a plain-text password using OpenAuth's ScryptHasher.
 * Store the result in `.kanban.json` as `passwordHash` instead of plain text.
 */
export async function hashPassword(plain: string): Promise<ScryptHasherResult> {
  return ScryptHasher().hash(plain)
}

/** Returns true when `value` is a ScryptHasherResult object (not a plain-text string). */
export function isHashedPassword(value: unknown): value is ScryptHasherResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.hash === 'string' &&
    typeof v.salt === 'string' &&
    typeof v.N === 'number' &&
    typeof v.r === 'number' &&
    typeof v.p === 'number'
  )
}

export interface EmbeddedIssuerGoogleOptions {
  /** Google OAuth2 client ID. Use ${KL_GOOGLE_CLIENT_ID} (preferred) or ${GOOGLE_CLIENT_ID} in .kanban.json. */
  clientId: string
  /** Google OAuth2 client secret. Use ${KL_GOOGLE_CLIENT_SECRET} (preferred) or ${GOOGLE_CLIENT_SECRET} in .kanban.json. */
  clientSecret: string
  /**
   * Maps a Google email address to a kanban-lite role.
   * Keys are email addresses (case-insensitive); values are role names.
   *
   * When set, **only** emails present in this map are allowed to sign in.
   * Any Google account whose email is not listed will be denied.
   * When omitted, all Google accounts are allowed and receive the `"user"` role.
   *
   * Example: { "admin@example.com": "admin", "alice@example.com": "member" }
   */
  roleMatrix?: Record<string, string>
}

export interface EmbeddedIssuerOptions {
  mountPath?: string
  /** Password-based login. Set to true to enable with default settings. */
  password?: boolean | { users?: EmbeddedIssuerUser[] }
  /** Deprecated flat user list — still supported but prefer password.users */
  users?: EmbeddedIssuerUser[]
  /** Google OAuth2 provider. Requires clientId and clientSecret. */
  google?: EmbeddedIssuerGoogleOptions
  theme?: Partial<Theme> & { primary: string | { light: string; dark: string } }
  ttl?: {
    access?: number
    refresh?: number
  }
  allowAllClients?: boolean
  select?: Record<string, { display?: string; hide?: boolean }>
}

// ---------------------------------------------------------------------------
// Node ↔ Fetch adapters (Hono app uses Fetch API internally)
// ---------------------------------------------------------------------------

function readIncomingBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function nodeReqToRequest(req: http.IncomingMessage, baseUrl: string): Promise<Request> {
  const url = new URL(req.url ?? '/', baseUrl)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) headers.append(key, v)
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  // The standalone HTTP adapter pre-buffers the body onto req._rawBody before
  // invoking handlers. Use it when available to avoid re-reading an already-consumed
  // stream (which would hang indefinitely waiting for 'end' events that never fire).
  const pre = (req as { _rawBody?: Buffer })._rawBody
  const rawBody: Buffer | undefined = hasBody ? (pre ?? await readIncomingBody(req)) : undefined
  // Slice to a plain ArrayBuffer so TS is happy with BodyInit
  const body: ArrayBuffer | undefined = rawBody?.length
    ? rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength) as ArrayBuffer
    : undefined

  return new Request(url.toString(), {
    method: req.method ?? 'GET',
    headers,
    body,
  })
}

async function sendFetchResponse(
  fetchRes: Response,
  res: http.ServerResponse,
): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  fetchRes.headers.forEach((value, key) => {
    // Skip transfer-encoding — we'll set content-length from the buffered body
    if (key === 'transfer-encoding') return
    const existing = headers[key]
    if (existing) {
      headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      headers[key] = value
    }
  })
  // Buffer the entire response body before writing to avoid ReadableStream deadlocks
  const body = Buffer.from(await fetchRes.arrayBuffer())
  headers['content-length'] = String(body.byteLength)
  res.writeHead(fetchRes.status, headers)
  if (body.byteLength > 0) res.write(body)
  res.end()
}

// ---------------------------------------------------------------------------
// Singleton issuer app cache
// ---------------------------------------------------------------------------

let cachedApp: ReturnType<typeof createIssuer> | null = null
let cachedOptionsKey = ''

function buildOptionsKey(opts: EmbeddedIssuerOptions): string {
  const passwordUsers =
    opts.password && typeof opts.password === 'object'
      ? (opts.password.users ?? []).map(u => u.email).sort()
      : []
  return JSON.stringify({
    mountPath: opts.mountPath,
    users: opts.users?.map(u => u.email).sort(),
    passwordUsers,
    google: opts.google?.clientId,
    googleRoleMatrix: opts.google?.roleMatrix,
    theme: opts.theme,
    ttl: opts.ttl,
  })
}

// ---------------------------------------------------------------------------
// createEmbeddedIssuer
// ---------------------------------------------------------------------------

export function createEmbeddedIssuer(options: EmbeddedIssuerOptions): {
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse, baseUrl: string): Promise<void>
  tryHandle(req: http.IncomingMessage, res: http.ServerResponse, baseUrl: string): Promise<boolean>
} {
  // Resolve flat users list from either options.users (legacy) or options.password.users
  const flatUsers: EmbeddedIssuerUser[] = [
    ...(options.users ?? []),
    ...(options.password && typeof options.password === 'object'
      ? (options.password.users ?? [])
      : []),
  ]
  const usersByEmail = new Map<string, EmbeddedIssuerUser>()
  for (const u of flatUsers) usersByEmail.set(u.email.toLowerCase(), u)

  const enablePassword =
    options.password === true ||
    (typeof options.password === 'object') ||
    flatUsers.length > 0 ||
    (!options.google && !options.password)  // default: enable password when nothing else configured

  let initPromise: Promise<ReturnType<typeof createIssuer>> | null = null

  function getApp(): Promise<ReturnType<typeof createIssuer>> {
    const key = buildOptionsKey(options)
    if (cachedApp && cachedOptionsKey === key) return Promise.resolve(cachedApp)
    if (initPromise) return initPromise

    initPromise = (async () => {
      const storage = MemoryStorage()

      // Pre-seed hashed passwords so PasswordProvider can verify them without registration
      for (const user of flatUsers) {
        if (user.passwordHash) {
          await Storage.set(storage, ['email', user.email.toLowerCase(), 'password'], user.passwordHash)
        } else if (user.password) {
          console.warn(
            `[openauth-issuer] Plain-text password for "${user.email}" in embeddedIssuer config. ` +
              `Run \`kl openauth add-user --email ${user.email} --password <pass>\` to hash it.`,
          )
          const hashed = await ScryptHasher().hash(user.password)
          await Storage.set(storage, ['email', user.email.toLowerCase(), 'password'], hashed)
        }
      }

      const providers: Record<string, unknown> = {}

      if (enablePassword) {
        providers.password = PasswordProvider(
          PasswordUI({
            sendCode: async (email, code) => {
              // In embedded mode log the code — replace with real email delivery in production
              console.log(`[openauth-issuer] Verification code for ${email}: ${code}`)
            },
          }),
        )
      }

      if (options.google) {
        providers.google = GoogleProvider({
          clientID: options.google.clientId,
          clientSecret: options.google.clientSecret,
          scopes: ['openid', 'email', 'profile'],
        })
      }

      const app = createIssuer({
        subjects,
        storage,
        providers: providers as Parameters<typeof createIssuer>[0]['providers'],

        async success(ctx, value) {
          if (value.provider === 'password') {
            const email = (value as { email?: string }).email ?? ''
            const user = usersByEmail.get(email.toLowerCase())
            return ctx.subject('user', {
              userID: email,
              role: user?.role ?? 'user',
            })
          }

          if (value.provider === 'google') {
            // Fetch Google userinfo using the access token
            const access = (value as { tokenset?: { access?: string } }).tokenset?.access ?? ''
            const userinfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${access}` },
            }).then((r) => r.json() as Promise<{ email?: string; sub?: string }>)

            const googleEmail = (userinfo.email ?? '').toLowerCase()

            // If roleMatrix is configured it acts as both allowlist and role assignment:
            // emails not present are denied.
            const roleMatrix = options.google?.roleMatrix
            if (roleMatrix) {
              const role = roleMatrix[googleEmail] ?? roleMatrix[userinfo.email ?? '']
              if (role === undefined) {
                throw new Error(`[openauth-issuer] Google sign-in denied: ${googleEmail} is not in the role matrix.`)
              }
              return ctx.subject('user', {
                userID: userinfo.email ?? userinfo.sub ?? 'google-user',
                role,
              })
            }

            // No roleMatrix — allow all Google accounts with default role
            const role = 'user'

            return ctx.subject('user', {
              userID: userinfo.email ?? userinfo.sub ?? 'google-user',
              role,
            })
          }

          // Fallback for other providers
          const tokenset = (value as { tokenset?: { access?: string } }).tokenset
          return ctx.subject('user', {
            userID: tokenset?.access ?? 'unknown',
          })
        },

        ...(options.theme ? { theme: options.theme as Theme } : {}),
        ...(options.ttl ? { ttl: options.ttl } : {}),
        ...(options.allowAllClients !== false ? { allow: async () => true as const } : {}),
        ...(options.select ? { select: Select({ providers: options.select }) } : {}),
      })

      cachedApp = app
      cachedOptionsKey = key
      initPromise = null
      return app
    })()

    return initPromise
  }

  return {
    async handleRequest(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      baseUrl: string,
    ): Promise<void> {
      const app = await getApp()
      const fetchReq = await nodeReqToRequest(req, baseUrl)
      const fetchRes = await app.fetch(fetchReq)
      await sendFetchResponse(fetchRes, res)
    },

    async tryHandle(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      baseUrl: string,
    ): Promise<boolean> {
      const app = await getApp()
      const label = `[openauth-issuer] ${req.method} ${req.url}`
      console.log(`${label} — building request`)
      const fetchReq = await nodeReqToRequest(req, baseUrl)
      console.log(`${label} — calling app.fetch()`)
      const fetchRes = await app.fetch(fetchReq)
      console.log(`${label} — app.fetch() done, status=${fetchRes.status}`)
      if (fetchRes.status === 404) return false
      await sendFetchResponse(fetchRes, res)
      console.log(`${label} — response sent`)
      return true
    },
  }
}

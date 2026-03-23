import * as http from 'http'
import { AuthError, type AuthContext } from '../sdk/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'

export interface AuthErrorLike {
  category: string
  message: string
}

const REQUEST_AUTH_CONTEXT = Symbol.for('kanban-lite.request-auth-context')

interface IncomingMessageWithAuthContext extends http.IncomingMessage {
  [REQUEST_AUTH_CONTEXT]?: AuthContext
}

function cloneIdentity(auth: AuthContext | undefined): AuthContext['identity'] | undefined {
  return auth?.identity
    ? {
        subject: auth.identity.subject,
        ...(Array.isArray(auth.identity.roles) ? { roles: [...auth.identity.roles] } : {}),
      }
    : undefined
}

export function getRequestAuthContext(req: http.IncomingMessage): AuthContext {
  const auth = (req as IncomingMessageWithAuthContext)[REQUEST_AUTH_CONTEXT]
  return {
    ...(auth ?? {}),
    ...(cloneIdentity(auth) ? { identity: cloneIdentity(auth) } : {}),
  }
}

export function setRequestAuthContext(req: http.IncomingMessage, auth: AuthContext): AuthContext {
  const next: AuthContext = {
    ...auth,
    ...(auth.identity ? { identity: cloneIdentity(auth) } : {}),
    transport: auth.transport ?? 'http',
  }
  ;(req as IncomingMessageWithAuthContext)[REQUEST_AUTH_CONTEXT] = next
  return next
}

export function mergeRequestAuthContext(req: http.IncomingMessage, auth: Partial<AuthContext>): AuthContext {
  const current = getRequestAuthContext(req)
  return setRequestAuthContext(req, {
    ...current,
    ...auth,
    ...(auth.identity ? { identity: cloneIdentity(auth as AuthContext) } : current.identity ? { identity: cloneIdentity(current) } : {}),
    transport: auth.transport ?? current.transport ?? 'http',
  })
}

export function extractAuthContext(req: http.IncomingMessage): AuthContext {
  const requestAuth = getRequestAuthContext(req)
  const authorization = req.headers.authorization
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    return {
      ...requestAuth,
      token: authorization.slice(7),
      tokenSource: 'request-header',
      transport: 'http',
    }
  }
  return { ...requestAuth, transport: requestAuth.transport ?? 'http' }
}

export function getAuthStatus(sdk: KanbanSDK, req?: http.IncomingMessage) {
  const auth = sdk.getAuthStatus()
  const requestAuth = req ? extractAuthContext(req) : { transport: 'http' as const }
  return {
    ...auth,
    configured: auth.identityEnabled || auth.policyEnabled,
    tokenPresent: Boolean(requestAuth.token),
    tokenSource: requestAuth.tokenSource ?? null,
    transport: requestAuth.transport ?? 'http',
  }
}

export function getAuthErrorLike(err: unknown): AuthErrorLike | null {
  if (err instanceof AuthError) {
    return { category: err.category, message: err.message }
  }
  if (!err || typeof err !== 'object') return null
  const category = (err as { category?: unknown }).category
  if (typeof category !== 'string' || !category.startsWith('auth.')) return null
  const message = (err as { message?: unknown }).message
  return {
    category,
    message: typeof message === 'string' ? message : String(err),
  }
}

export function authErrorToHttpStatus(err: Pick<AuthErrorLike, 'category'>): number {
  if (err.category === 'auth.identity.missing' || err.category === 'auth.identity.invalid' || err.category === 'auth.identity.expired') return 401
  if (err.category === 'auth.policy.denied' || err.category === 'auth.policy.unknown') return 403
  return 500
}

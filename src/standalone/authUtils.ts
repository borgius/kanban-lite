import * as http from 'http'
import { AuthError, type AuthContext } from '../sdk/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'

export function extractAuthContext(req: http.IncomingMessage): AuthContext {
  const authorization = req.headers.authorization
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    return { token: authorization.slice(7), tokenSource: 'request-header', transport: 'http' }
  }
  return { transport: 'http' }
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

export function authErrorToHttpStatus(err: AuthError): number {
  if (err.category === 'auth.identity.missing' || err.category === 'auth.identity.invalid' || err.category === 'auth.identity.expired') return 401
  if (err.category === 'auth.policy.denied' || err.category === 'auth.policy.unknown') return 403
  return 500
}

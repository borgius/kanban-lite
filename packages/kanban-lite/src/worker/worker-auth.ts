export type CloudflareWorkerTokenSource = 'header' | 'cloudflare-access'

export interface CloudflareWorkerBearerToken {
  readonly token: string
  readonly source: CloudflareWorkerTokenSource
}

function normalizeBearerToken(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function normalizeAccessAssertion(value: string | null): string | null {
  const token = value?.trim()
  return token ? token : null
}

export function extractCloudflareWorkerBearerToken(headers: Headers): CloudflareWorkerBearerToken | null {
  const authorizationToken = normalizeBearerToken(headers.get('authorization'))
  if (authorizationToken) {
    return { token: authorizationToken, source: 'header' }
  }

  const accessToken = normalizeAccessAssertion(headers.get('cf-access-jwt-assertion'))
  return accessToken
    ? { token: accessToken, source: 'cloudflare-access' }
    : null
}

export function withCloudflareAccessAuthorizationFallback(headers: Headers): Headers {
  if (normalizeBearerToken(headers.get('authorization'))) {
    return headers
  }

  const accessToken = normalizeAccessAssertion(headers.get('cf-access-jwt-assertion'))
  if (!accessToken) {
    return headers
  }

  const next = new Headers(headers)
  next.set('authorization', `Bearer ${accessToken}`)
  return next
}

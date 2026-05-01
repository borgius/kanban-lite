import { describe, expect, it } from 'vitest'

import { extractCloudflareWorkerBearerToken, withCloudflareAccessAuthorizationFallback } from './worker-auth'

describe('Cloudflare Worker auth header normalization', () => {
  it('prefers Authorization bearer tokens over Cloudflare Access assertions', () => {
    const headers = new Headers({
      Authorization: 'Bearer primary-token',
      'CF-Access-Jwt-Assertion': 'access-token',
    })

    expect(extractCloudflareWorkerBearerToken(headers)).toEqual({
      token: 'primary-token',
      source: 'header',
    })
  })

  it('uses CF-Access-Jwt-Assertion as a bearer token fallback only when Authorization is absent', () => {
    const headers = new Headers({
      'CF-Access-Jwt-Assertion': 'access-token',
      'CF-Access-Authenticated-User-Email': 'user@example.com',
    })

    expect(extractCloudflareWorkerBearerToken(headers)).toEqual({
      token: 'access-token',
      source: 'cloudflare-access',
    })
    expect(Object.fromEntries(withCloudflareAccessAuthorizationFallback(headers).entries())).toMatchObject({
      authorization: 'Bearer access-token',
      'cf-access-authenticated-user-email': 'user@example.com',
    })
  })
})

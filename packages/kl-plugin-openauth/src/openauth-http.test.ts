import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @openauthjs/openauth/client (shared for middleware + route handlers)
// ---------------------------------------------------------------------------

const mockVerify = vi.fn()
const mockAuthorize = vi.fn()
const mockExchange = vi.fn()

vi.mock('@openauthjs/openauth/client', () => ({
  createClient: vi.fn(() => ({
    verify: mockVerify,
    authorize: mockAuthorize,
    exchange: mockExchange,
  })),
}))

vi.mock('@openauthjs/openauth/error', () => ({
  InvalidAuthorizationCodeError: class InvalidAuthorizationCodeError extends Error {
    constructor() { super('Invalid authorization code') }
  },
  InvalidRefreshTokenError: class InvalidRefreshTokenError extends Error {
    constructor() { super('Invalid refresh token') }
  },
}))

import { createStandaloneHttpPlugin } from './openauth-http'
import type { OpenAuthHttpOptions } from './openauth-http'

// ---------------------------------------------------------------------------
// Helpers: minimal StandaloneHttpRequestContext mock
// ---------------------------------------------------------------------------

const HTTP_OPTIONS: OpenAuthHttpOptions = {
  issuer: 'https://auth.example.com',
  clientId: 'test-client',
}

function mockRes() {
  const headers: Record<string, string | string[]> = {}
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
    getHeader: vi.fn((name: string) => headers[name]),
    setHeader: vi.fn((name: string, value: string | string[]) => { headers[name] = value }),
    _headers: headers,
  }
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  const res = mockRes()
  const url = new URL(overrides.url as string || 'http://localhost:4180/')
  return {
    req: {
      headers: {
        cookie: overrides.cookie as string || '',
        host: 'localhost:4180',
      },
    },
    res,
    url,
    pathname: url.pathname,
    method: (overrides.method as string) || 'GET',
    isApiRequest: overrides.isApiRequest ?? false,
    isPageRequest: overrides.isPageRequest ?? true,
    route: vi.fn((method: string, path: string) => {
      if (url.pathname === path && (overrides.method || 'GET') === method) return {}
      return null
    }),
    getAuthContext: vi.fn(() => ({})),
    setAuthContext: vi.fn(),
    mergeAuthContext: vi.fn(),
  }
}

function makeRegOptions(providerOptions?: Record<string, unknown>) {
  return {
    authCapabilities: providerOptions ? { providerOptions } : undefined,
  }
}

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

describe('createStandaloneHttpPlugin', () => {
  it('returns plugin with correct manifest', () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    expect(plugin.manifest.id).toBe('openauth-http')
    expect(plugin.manifest.provides).toContain('standalone.http')
  })

  it('has registerMiddleware function', () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    expect(typeof plugin.registerMiddleware).toBe('function')
  })

  it('has registerRoutes function', () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    expect(typeof plugin.registerRoutes).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

describe('openauth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty middleware array when options resolve to null', () => {
    const plugin = createStandaloneHttpPlugin()
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    expect(handlers).toHaveLength(0)
  })

  it('registers one middleware handler with valid options', () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    expect(handlers).toHaveLength(1)
  })

  it('passes through public auth routes without checking tokens', async () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    const request = makeRequest({ url: 'http://localhost:4180/auth/openauth/login' })

    const consumed = await handlers[0](request as never)
    expect(consumed).toBe(false)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns 401 JSON for API request with no token', async () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/api/boards',
      isApiRequest: true,
      isPageRequest: false,
    })

    const consumed = await handlers[0](request as never)
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({
      'Content-Type': 'application/json',
    }))
  })

  it('redirects page request to login when no token', async () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/boards',
      isPageRequest: true,
    })

    const consumed = await handlers[0](request as never)
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: expect.stringContaining('/auth/openauth/login'),
    }))
  })

  it('verifies token and sets auth context on success', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'alice', role: 'admin' } },
    })

    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/boards',
      cookie: 'oa_access_token=jwt123',
    })

    const consumed = await handlers[0](request as never)
    expect(consumed).toBe(false)
    expect(mockVerify).toHaveBeenCalledOnce()
    expect(request.mergeAuthContext).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'http',
      token: 'jwt123',
      identity: expect.objectContaining({
        subject: 'alice',
        roles: ['admin'],
      }),
    }))
  })

  it('clears cookies and returns 401 when verify returns error', async () => {
    mockVerify.mockResolvedValue({ err: new Error('expired') })

    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/api/boards',
      cookie: 'oa_access_token=expired-jwt',
      isApiRequest: true,
      isPageRequest: false,
    })

    const consumed = await handlers[0](request as never)
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({
      'Content-Type': 'application/json',
    }))
  })

  it('updates cookies when verify returns refreshed tokens', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'bob' } },
      tokens: { access: 'new-access', refresh: 'new-refresh', expiresIn: 3600 },
    })

    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerMiddleware!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/boards',
      cookie: 'oa_access_token=old-jwt; oa_refresh_token=old-refresh',
    })

    const consumed = await handlers[0](request as never)
    expect(consumed).toBe(false)
    // Check that Set-Cookie was set with new tokens
    expect(request.res.setHeader).toHaveBeenCalled()
    const setCookieCalls = request.res.setHeader.mock.calls.filter(
      (c: [string, unknown]) => c[0] === 'Set-Cookie',
    )
    expect(setCookieCalls.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('openauth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty routes array when options resolve to null', () => {
    const plugin = createStandaloneHttpPlugin()
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    expect(handlers).toHaveLength(0)
  })

  it('registers four route handlers', () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    expect(handlers).toHaveLength(4) // login, authorize, callback, logout
  })

  it('login page serves HTML when not authenticated', async () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/auth/openauth/login',
      method: 'GET',
    })

    // Find the login handler (handles GET /auth/openauth/login)
    let consumed = false
    for (const handler of handlers) {
      consumed = await handler(request as never)
      if (consumed) break
    }
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/html; charset=utf-8',
    }))
  })

  it('login page redirects when already authenticated', async () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/auth/openauth/login',
      method: 'GET',
      cookie: 'oa_access_token=jwt123',
    })

    let consumed = false
    for (const handler of handlers) {
      consumed = await handler(request as never)
      if (consumed) break
    }
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: '/',
    }))
  })

  it('authorize route starts PKCE flow and redirects', async () => {
    mockAuthorize.mockResolvedValue({
      url: 'https://auth.example.com/authorize?code_challenge=xyz',
      challenge: { state: 'abc', verifier: 'def' },
    })

    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/auth/openauth/authorize?returnTo=/boards',
      method: 'GET',
    })

    let consumed = false
    for (const handler of handlers) {
      consumed = await handler(request as never)
      if (consumed) break
    }
    expect(consumed).toBe(true)
    expect(mockAuthorize).toHaveBeenCalledOnce()
    expect(request.res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: 'https://auth.example.com/authorize?code_challenge=xyz',
    }))
  })

  it('callback route exchanges code for tokens', async () => {
    mockExchange.mockResolvedValue({
      tokens: { access: 'new-access', refresh: 'new-refresh', expiresIn: 3600 },
    })

    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    const challengeState = JSON.stringify({
      challenge: { state: 'abc', verifier: 'def' },
      returnTo: '/boards',
    })
    const request = makeRequest({
      url: `http://localhost:4180/auth/openauth/callback?code=auth-code-123`,
      method: 'GET',
      cookie: `oa_pkce_challenge=${encodeURIComponent(challengeState)}`,
    })

    let consumed = false
    for (const handler of handlers) {
      consumed = await handler(request as never)
      if (consumed) break
    }
    expect(consumed).toBe(true)
    expect(mockExchange).toHaveBeenCalledWith(
      'auth-code-123',
      expect.stringContaining('/auth/openauth/callback'),
      'def', // PKCE verifier
    )
    expect(request.res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: '/boards',
    }))
  })

  it('callback route redirects to login on exchange error', async () => {
    mockExchange.mockResolvedValue({ err: new Error('invalid code') })

    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/auth/openauth/callback?code=bad-code',
      method: 'GET',
    })

    let consumed = false
    for (const handler of handlers) {
      consumed = await handler(request as never)
      if (consumed) break
    }
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: expect.stringContaining('/auth/openauth/login'),
    }))
  })

  it('logout route clears cookies and redirects', async () => {
    const plugin = createStandaloneHttpPlugin(HTTP_OPTIONS)
    const handlers = plugin.registerRoutes!(makeRegOptions() as never)
    const request = makeRequest({
      url: 'http://localhost:4180/auth/openauth/logout',
      method: 'POST',
    })
    // logout handler matches both POST and GET
    request.route.mockImplementation((method: string, path: string) => {
      if (path === '/auth/openauth/logout') return {}
      return null
    })

    let consumed = false
    for (const handler of handlers) {
      consumed = await handler(request as never)
      if (consumed) break
    }
    expect(consumed).toBe(true)
    expect(request.res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: '/auth/openauth/login',
    }))
  })
})

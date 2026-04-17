import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @openauthjs/openauth/client before imports
// ---------------------------------------------------------------------------

const mockVerify = vi.fn()
const mockAuthorize = vi.fn()
const mockExchange = vi.fn()
const mockRefresh = vi.fn()

vi.mock('@openauthjs/openauth/client', () => ({
  createClient: vi.fn(() => ({
    verify: mockVerify,
    authorize: mockAuthorize,
    exchange: mockExchange,
    refresh: mockRefresh,
  })),
}))

vi.mock('@openauthjs/openauth/error', () => ({
  InvalidRefreshTokenError: class InvalidRefreshTokenError extends Error {
    constructor() { super('Invalid refresh token') }
  },
  InvalidAccessTokenError: class InvalidAccessTokenError extends Error {
    constructor() { super('Invalid access token') }
  },
  InvalidAuthorizationCodeError: class InvalidAuthorizationCodeError extends Error {
    constructor() { super('Invalid authorization code') }
  },
}))

import type { AuthContext, AuthIdentity } from 'kanban-lite/sdk'
import {
  resolveOpenAuthIdentity,
  resolveOpenAuthIdentityOptions,
  createOpenAuthIdentityPlugin,
  createOpenAuthIdentityOptionsSchema,
  OPENAUTH_IDENTITY_PLUGIN,
} from './openauth-identity'
import type { OpenAuthIdentityOptions } from './openauth-identity'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const OPTS: OpenAuthIdentityOptions = {
  issuer: 'https://auth.example.com',
  clientId: 'test-client',
  roleMapping: { claim: 'role', default: 'user' },
}

function makeContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return { transport: 'http', ...overrides } as AuthContext
}

// ---------------------------------------------------------------------------
// resolveOpenAuthIdentityOptions
// ---------------------------------------------------------------------------

describe('resolveOpenAuthIdentityOptions', () => {
  it('returns null for undefined input', () => {
    expect(resolveOpenAuthIdentityOptions(undefined)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(resolveOpenAuthIdentityOptions({})).toBeNull()
  })

  it('returns null when issuer is missing', () => {
    expect(resolveOpenAuthIdentityOptions({ clientId: 'x' })).toBeNull()
  })

  it('returns null when clientId is missing', () => {
    expect(resolveOpenAuthIdentityOptions({ issuer: 'https://a.com' })).toBeNull()
  })

  it('parses valid minimal options', () => {
    const result = resolveOpenAuthIdentityOptions({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
    })
    expect(result).toEqual({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
      roleMapping: { default: 'user' },
    })
  })

  it('parses full options with roleMapping', () => {
    const result = resolveOpenAuthIdentityOptions({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
      roleMapping: { claim: 'roles', default: 'viewer' },
    })
    expect(result).toMatchObject({
      roleMapping: { claim: 'roles', default: 'viewer' },
    })
  })
})

// ---------------------------------------------------------------------------
// resolveOpenAuthIdentity
// ---------------------------------------------------------------------------

describe('resolveOpenAuthIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for missing token', async () => {
    const result = await resolveOpenAuthIdentity(makeContext(), OPTS)
    expect(result).toBeNull()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns null for empty string token', async () => {
    const result = await resolveOpenAuthIdentity(makeContext({ token: '' }), OPTS)
    expect(result).toBeNull()
  })

  it('calls client.verify with subjects, token, and refresh option', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'alice', role: 'admin' } },
    })

    const ctx = makeContext({ token: 'access-jwt-123' })
    ;(ctx as Record<string, unknown>).refreshToken = 'refresh-jwt-456'

    const result = await resolveOpenAuthIdentity(ctx, OPTS)

    expect(mockVerify).toHaveBeenCalledOnce()
    // First arg: subjects schema (object), second: token string, third: options
    const [subjectsArg, tokenArg, optsArg] = mockVerify.mock.calls[0]
    expect(subjectsArg).toBeDefined()
    expect(tokenArg).toBe('access-jwt-123')
    expect(optsArg).toEqual({ refresh: 'refresh-jwt-456' })

    expect(result).toEqual({ subject: 'alice', roles: ['admin'] })
  })

  it('extracts userID from subject properties', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'bob-123' } },
    })

    const result = await resolveOpenAuthIdentity(makeContext({ token: 'tok' }), OPTS)
    expect(result?.subject).toBe('bob-123')
  })

  it('uses default role when claim is missing', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'carol' } },
    })

    const result = await resolveOpenAuthIdentity(
      makeContext({ token: 'tok' }),
      { ...OPTS, roleMapping: { default: 'viewer' } },
    )
    expect(result?.roles).toEqual(['viewer'])
  })

  it('extracts array of roles from subject', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'dave', role: ['manager', 'admin'] } },
    })

    const result = await resolveOpenAuthIdentity(makeContext({ token: 'tok' }), OPTS)
    expect(result?.roles).toEqual(['manager', 'admin'])
  })

  it('returns null when verify returns error', async () => {
    mockVerify.mockResolvedValue({ err: new Error('invalid') })

    const result = await resolveOpenAuthIdentity(makeContext({ token: 'bad' }), OPTS)
    expect(result).toBeNull()
  })

  it('returns null on verify exception', async () => {
    mockVerify.mockRejectedValue(new Error('network error'))

    const result = await resolveOpenAuthIdentity(makeContext({ token: 'tok' }), OPTS)
    expect(result).toBeNull()
  })

  it('falls back to "openauth-user" when no userID found', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: {} },
    })

    const result = await resolveOpenAuthIdentity(makeContext({ token: 'tok' }), OPTS)
    expect(result?.subject).toBe('openauth-user')
  })
})

// ---------------------------------------------------------------------------
// OPENAUTH_IDENTITY_PLUGIN
// ---------------------------------------------------------------------------

describe('OPENAUTH_IDENTITY_PLUGIN', () => {
  it('has correct manifest', () => {
    expect(OPENAUTH_IDENTITY_PLUGIN.manifest.id).toBe('openauth')
    expect(OPENAUTH_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })

  it('has resolveIdentity function', () => {
    expect(typeof OPENAUTH_IDENTITY_PLUGIN.resolveIdentity).toBe('function')
  })

  it('has optionsSchema function', () => {
    expect(typeof OPENAUTH_IDENTITY_PLUGIN.optionsSchema).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// createOpenAuthIdentityPlugin factory
// ---------------------------------------------------------------------------

describe('createOpenAuthIdentityPlugin', () => {
  it('creates a plugin with correct manifest', () => {
    const plugin = createOpenAuthIdentityPlugin({ issuer: 'https://a.com', clientId: 'c' })
    expect(plugin.manifest.id).toBe('openauth')
    expect(plugin.manifest.provides).toContain('auth.identity')
  })

  it('created plugin resolves identity with given options', async () => {
    mockVerify.mockResolvedValue({
      subject: { type: 'user', properties: { userID: 'test-user', role: 'admin' } },
    })

    const plugin = createOpenAuthIdentityPlugin({
      issuer: 'https://auth.example.com',
      clientId: 'my-client',
      roleMapping: { claim: 'role' },
    })
    const identity = await plugin.resolveIdentity(makeContext({ token: 'jwt-tok' }))
    expect(identity?.subject).toBe('test-user')
    expect(identity?.roles).toEqual(['admin'])
  })
})

// ---------------------------------------------------------------------------
// Options schema
// ---------------------------------------------------------------------------

describe('createOpenAuthIdentityOptionsSchema', () => {
  it('returns schema with required issuer and clientId', () => {
    const meta = createOpenAuthIdentityOptionsSchema()
    expect(meta.schema.required).toContain('issuer')
    expect(meta.schema.required).toContain('clientId')
  })

  it('has uiSchema', () => {
    const meta = createOpenAuthIdentityOptionsSchema()
    expect(meta.uiSchema).toBeDefined()
  })
})

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @openauthjs/openauth modules so plugin.ts can import cleanly
// ---------------------------------------------------------------------------

import { vi } from 'vitest'

vi.mock('@openauthjs/openauth/client', () => ({
  createClient: vi.fn(() => ({
    verify: vi.fn(),
    authorize: vi.fn(),
    exchange: vi.fn(),
  })),
}))

vi.mock('@openauthjs/openauth/error', () => ({
  InvalidRefreshTokenError: class InvalidRefreshTokenError extends Error {},
  InvalidAccessTokenError: class InvalidAccessTokenError extends Error {},
  InvalidAuthorizationCodeError: class InvalidAuthorizationCodeError extends Error {},
}))

import openAuthPluginPackage, {
  pluginManifest,
  authIdentityPlugins,
  createAuthIdentityPlugin,
  createStandaloneHttpPlugin,
  createEmbeddedIssuer,
  optionsSchemas,
  subjects,
} from './plugin'

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

describe('pluginManifest', () => {
  it('has correct id', () => {
    expect(pluginManifest.id).toBe('kl-plugin-openauth')
  })

  it('provides auth.identity capabilities and standalone.http integration', () => {
    expect(pluginManifest.capabilities['auth.identity']).toContain('openauth')
    expect(pluginManifest.integrations).toContain('standalone.http')
  })
})

// ---------------------------------------------------------------------------
// Keyed plugin collections
// ---------------------------------------------------------------------------

describe('authIdentityPlugins', () => {
  it('contains openauth identity plugin', () => {
    expect(authIdentityPlugins.openauth).toBeDefined()
    expect(authIdentityPlugins.openauth.manifest.id).toBe('openauth')
  })
})


describe('factory functions', () => {
  it('createAuthIdentityPlugin returns plugin', () => {
    const plugin = createAuthIdentityPlugin()
    expect(plugin.manifest.id).toBe('openauth')
    expect(typeof plugin.resolveIdentity).toBe('function')
  })

  it('createStandaloneHttpPlugin returns plugin', () => {
    const plugin = createStandaloneHttpPlugin()
    expect(plugin.manifest.id).toBe('openauth-http')
    expect(typeof plugin.registerMiddleware).toBe('function')
    expect(typeof plugin.registerRoutes).toBe('function')
  })

  it('createEmbeddedIssuer is exported', () => {
    expect(typeof createEmbeddedIssuer).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Options schemas
// ---------------------------------------------------------------------------

describe('optionsSchemas', () => {
  it('returns auth.identity schema', () => {
    const schemas = optionsSchemas()
    expect(schemas['auth.identity']).toBeDefined()
    expect(schemas['auth.identity'].schema).toBeDefined()
    expect(schemas['auth.identity'].uiSchema).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

describe('re-exports', () => {
  it('subjects schema is re-exported', () => {
    expect(subjects).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

describe('default export', () => {
  it('contains all expected keys', () => {
    expect(openAuthPluginPackage.pluginManifest).toBe(pluginManifest)
    expect(openAuthPluginPackage.authIdentityPlugins).toBe(authIdentityPlugins)
    expect(typeof openAuthPluginPackage.createAuthIdentityPlugin).toBe('function')
    expect(typeof openAuthPluginPackage.createStandaloneHttpPlugin).toBe('function')
    expect(typeof openAuthPluginPackage.createStandalonePlugin).toBe('function')
    expect(typeof openAuthPluginPackage.createEmbeddedIssuer).toBe('function')
    expect(typeof openAuthPluginPackage.optionsSchemas).toBe('function')
  })
})

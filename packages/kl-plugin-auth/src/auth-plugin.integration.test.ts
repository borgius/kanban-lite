/**
 * Integration tests for kl-plugin-auth demonstrating consumption from kanban-lite.
 *
 * These tests verify both the stable auth capability exports used by the current
 * kanban-lite loader and the new listener-only runtime helpers used by the SDK
 * before-event pipeline. They do NOT mock the auth logic — every assertion
 * exercises the actual plugin functions.
 */
import { DEFAULT_PLUGIN_SETTINGS_REDACTION, type BeforeEventPayload } from '../../kanban-lite/src/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_IDENTITY_PLUGIN,
  LOCAL_POLICY_PLUGIN,
  NOOP_IDENTITY_PLUGIN,
  NOOP_POLICY_PLUGIN,
  RBAC_IDENTITY_PLUGIN,
  RBAC_POLICY_PLUGIN,
  RBAC_USER_ACTIONS,
  RBAC_MANAGER_ACTIONS,
  RBAC_ADMIN_ACTIONS,
  RBAC_ROLE_MATRIX,
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthIdentityPlugin,
  createAuthPolicyPlugin,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  createRbacIdentityPlugin,
  createStandaloneHttpPlugin,
  type AuthContext,
  type AuthDecision,
  type AuthIdentity,
  type StandaloneHttpPluginRegistrationOptions,
} from './index'

type WorkspaceSdkExports = typeof import('../../kanban-lite/src/sdk')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthError, EventBus } = require('../../kanban-lite/dist/sdk/index.cjs') as Pick<WorkspaceSdkExports, 'AuthError' | 'EventBus'>

function makeBeforePayload(
  overrides: Partial<BeforeEventPayload<Record<string, unknown>>> = {},
): BeforeEventPayload<Record<string, unknown>> {
  return {
    event: 'card.create',
    input: { title: 'Test card' },
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Manifest shape – the shape kanban-lite validates in tryLoadBundledAuthCompatExports
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: manifest shape (kanban-lite loader contract)', () => {
  it('NOOP_IDENTITY_PLUGIN has id "noop" and provides auth.identity', () => {
    expect(NOOP_IDENTITY_PLUGIN.manifest.id).toBe('noop')
    expect(NOOP_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
    expect(typeof NOOP_IDENTITY_PLUGIN.resolveIdentity).toBe('function')
  })

  it('NOOP_POLICY_PLUGIN has id "noop" and provides auth.policy', () => {
    expect(NOOP_POLICY_PLUGIN.manifest.id).toBe('noop')
    expect(NOOP_POLICY_PLUGIN.manifest.provides).toContain('auth.policy')
    expect(typeof NOOP_POLICY_PLUGIN.checkPolicy).toBe('function')
  })

  it('RBAC_IDENTITY_PLUGIN has id "rbac" and provides auth.identity', () => {
    expect(RBAC_IDENTITY_PLUGIN.manifest.id).toBe('rbac')
    expect(RBAC_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
    expect(typeof RBAC_IDENTITY_PLUGIN.resolveIdentity).toBe('function')
  })

  it('RBAC_POLICY_PLUGIN has id "rbac" and provides auth.policy', () => {
    expect(RBAC_POLICY_PLUGIN.manifest.id).toBe('rbac')
    expect(RBAC_POLICY_PLUGIN.manifest.provides).toContain('auth.policy')
    expect(typeof RBAC_POLICY_PLUGIN.checkPolicy).toBe('function')
  })

  it('authIdentityPlugins map exposes noop and rbac providers', () => {
    expect(authIdentityPlugins['local']).toBe(LOCAL_IDENTITY_PLUGIN)
    expect(authIdentityPlugins['noop']).toBe(NOOP_IDENTITY_PLUGIN)
    expect(authIdentityPlugins['rbac']).toBe(RBAC_IDENTITY_PLUGIN)
  })

  it('authPolicyPlugins map exposes noop and rbac providers', () => {
    expect(authPolicyPlugins['local']).toBe(LOCAL_POLICY_PLUGIN)
    expect(authPolicyPlugins['noop']).toBe(NOOP_POLICY_PLUGIN)
    expect(authPolicyPlugins['rbac']).toBe(RBAC_POLICY_PLUGIN)
  })
})

// ---------------------------------------------------------------------------
// RBAC action sets – must mirror the sets that kanban-lite exports and uses
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: RBAC role action sets (kanban-lite action catalog)', () => {
  it('RBAC_USER_ACTIONS is a Set of strings covering card-interaction operations', () => {
    expect(RBAC_USER_ACTIONS).toBeInstanceOf(Set)
    expect(RBAC_USER_ACTIONS.has('form.submit')).toBe(true)
    expect(RBAC_USER_ACTIONS.has('comment.create')).toBe(true)
    expect(RBAC_USER_ACTIONS.has('attachment.add')).toBe(true)
    expect(RBAC_USER_ACTIONS.has('log.add')).toBe(true)
  })

  it('RBAC_MANAGER_ACTIONS is a superset of RBAC_USER_ACTIONS', () => {
    expect(RBAC_MANAGER_ACTIONS).toBeInstanceOf(Set)
    for (const action of RBAC_USER_ACTIONS) {
      expect(RBAC_MANAGER_ACTIONS.has(action)).toBe(true)
    }
    expect(RBAC_MANAGER_ACTIONS.has('card.create')).toBe(true)
    expect(RBAC_MANAGER_ACTIONS.has('card.update')).toBe(true)
    expect(RBAC_MANAGER_ACTIONS.has('card.move')).toBe(true)
  })

  it('RBAC_ADMIN_ACTIONS is a superset of RBAC_MANAGER_ACTIONS', () => {
    expect(RBAC_ADMIN_ACTIONS).toBeInstanceOf(Set)
    for (const action of RBAC_MANAGER_ACTIONS) {
      expect(RBAC_ADMIN_ACTIONS.has(action)).toBe(true)
    }
    expect(RBAC_ADMIN_ACTIONS.has('board.create')).toBe(true)
    expect(RBAC_ADMIN_ACTIONS.has('settings.update')).toBe(true)
    expect(RBAC_ADMIN_ACTIONS.has('storage.migrate')).toBe(true)
    expect(RBAC_ADMIN_ACTIONS.has('card.purgeDeleted')).toBe(true)
  })

  it('RBAC_ROLE_MATRIX maps all three roles', () => {
    expect(RBAC_ROLE_MATRIX.user).toBe(RBAC_USER_ACTIONS)
    expect(RBAC_ROLE_MATRIX.manager).toBe(RBAC_MANAGER_ACTIONS)
    expect(RBAC_ROLE_MATRIX.admin).toBe(RBAC_ADMIN_ACTIONS)
  })
})

// ---------------------------------------------------------------------------
// NOOP provider behaviour – kanban-lite open-access defaults
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: NOOP providers (kanban-lite open-access default)', () => {
  const ctx: AuthContext = { transport: 'http' }

  it('NOOP_IDENTITY_PLUGIN.resolveIdentity always returns null (anonymous)', async () => {
    const identity = await NOOP_IDENTITY_PLUGIN.resolveIdentity(ctx)
    expect(identity).toBeNull()
  })

  it('NOOP_IDENTITY_PLUGIN.resolveIdentity returns null even with a token', async () => {
    const identity = await NOOP_IDENTITY_PLUGIN.resolveIdentity({ ...ctx, token: 'some-token' })
    expect(identity).toBeNull()
  })

  it('NOOP_POLICY_PLUGIN.checkPolicy always allows (allow-all)', async () => {
    const decision = await NOOP_POLICY_PLUGIN.checkPolicy(null, 'card.delete', ctx)
    expect(decision.allowed).toBe(true)
  })

  it('NOOP_POLICY_PLUGIN.checkPolicy allows even destructive admin actions', async () => {
    const identity: AuthIdentity = { subject: 'alice', roles: [] }
    const decision = await NOOP_POLICY_PLUGIN.checkPolicy(identity, 'board.delete', ctx)
    expect(decision.allowed).toBe(true)
  })
})

describe('kl-plugin-auth: local providers', () => {
  it('LOCAL_IDENTITY_PLUGIN trusts pre-resolved identity from middleware', async () => {
    const identity = await LOCAL_IDENTITY_PLUGIN.resolveIdentity({
      transport: 'http',
      identity: { subject: 'alice', groups: ['ops'] },
    })
    expect(identity).toEqual({ subject: 'alice', groups: ['ops'] })
  })

  it('LOCAL_IDENTITY_PLUGIN resolves the shared API token from env', async () => {
    const previous = process.env.KANBAN_LITE_TOKEN
    process.env.KANBAN_LITE_TOKEN = 'kl-test-token'
    try {
      await expect(LOCAL_IDENTITY_PLUGIN.resolveIdentity({
        transport: 'cli',
        token: 'kl-test-token',
      })).resolves.toEqual({ subject: 'api-token' })
    } finally {
      if (previous === undefined) {
        delete process.env.KANBAN_LITE_TOKEN
      } else {
        process.env.KANBAN_LITE_TOKEN = previous
      }
    }
  })

  it('LOCAL_POLICY_PLUGIN requires an authenticated identity', async () => {
    await expect(LOCAL_POLICY_PLUGIN.checkPolicy(null, 'card.create', { transport: 'http' })).resolves.toMatchObject({
      allowed: false,
      reason: 'auth.identity.missing',
    })

    await expect(LOCAL_POLICY_PLUGIN.checkPolicy({ subject: 'alice' }, 'card.create', { transport: 'http' })).resolves.toMatchObject({
      allowed: true,
      actor: 'alice',
    })
  })
})

// ---------------------------------------------------------------------------
// RBAC identity provider – token lookup matches kanban-lite _authorizeAction path
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: RBAC identity provider', () => {
  it('RBAC_IDENTITY_PLUGIN (empty principals) resolves anonymous for any token', async () => {
    const identity = await RBAC_IDENTITY_PLUGIN.resolveIdentity({ token: 'any-token', transport: 'http' })
    expect(identity).toBeNull()
  })

  it('RBAC_IDENTITY_PLUGIN resolves anonymous when no token provided', async () => {
    const identity = await RBAC_IDENTITY_PLUGIN.resolveIdentity({ transport: 'http' })
    expect(identity).toBeNull()
  })

  it('createRbacIdentityPlugin resolves a registered principal', async () => {
    const principals = new Map([
      ['token-alice', { subject: 'alice', roles: ['user'], groups: ['ops'] }],
      ['token-bob', { subject: 'bob', roles: ['admin'] }],
    ])
    const plugin = createRbacIdentityPlugin(principals)
    expect(plugin.manifest.id).toBe('rbac')

    const alice = await plugin.resolveIdentity({ token: 'token-alice', transport: 'http' })
    expect(alice).not.toBeNull()
    expect(alice?.subject).toBe('alice')
    expect(alice?.roles).toEqual(['user'])
    expect(alice?.groups).toEqual(['ops'])

    const bob = await plugin.resolveIdentity({ token: 'Bearer token-bob', transport: 'http' })
    expect(bob?.subject).toBe('bob')
    expect(bob?.roles).toEqual(['admin'])
  })

  it('createRbacIdentityPlugin returns null for unknown token', async () => {
    const plugin = createRbacIdentityPlugin(new Map([['t1', { subject: 'x', roles: ['user'] }]]))
    const result = await plugin.resolveIdentity({ token: 'unknown', transport: 'http' })
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// RBAC policy provider – mirrors the _authorizeAction enforcement path in KanbanSDK
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: RBAC policy provider (mirrors KanbanSDK._authorizeAction)', () => {
  const ctx: AuthContext = { transport: 'http' }

  it('denies anonymous identity with reason auth.identity.missing', async () => {
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(null, 'card.create', ctx)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('auth.identity.missing')
  })

  it('allows user role to perform card-interaction actions', async () => {
    const identity: AuthIdentity = { subject: 'alice', roles: ['user'] }
    for (const action of ['form.submit', 'comment.create', 'attachment.add', 'log.add']) {
      const d = await RBAC_POLICY_PLUGIN.checkPolicy(identity, action, ctx)
      expect(d.allowed).toBe(true)
      expect(d.actor).toBe('alice')
    }
  })

  it('denies user role for manager-only actions', async () => {
    const identity: AuthIdentity = { subject: 'alice', roles: ['user'] }
    for (const action of ['card.create', 'card.update', 'card.move']) {
      const d = await RBAC_POLICY_PLUGIN.checkPolicy(identity, action, ctx)
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe('auth.policy.denied')
    }
  })

  it('allows manager role to perform card lifecycle actions', async () => {
    const identity: AuthIdentity = { subject: 'bob', roles: ['manager'] }
    for (const action of ['card.create', 'card.update', 'card.move', 'card.delete']) {
      const d = await RBAC_POLICY_PLUGIN.checkPolicy(identity, action, ctx)
      expect(d.allowed).toBe(true)
    }
  })

  it('denies manager role for admin-only actions', async () => {
    const identity: AuthIdentity = { subject: 'bob', roles: ['manager'] }
    const d = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'board.delete', ctx)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('auth.policy.denied')
  })

  it('allows admin role for all admin actions', async () => {
    const identity: AuthIdentity = { subject: 'carol', roles: ['admin'] }
    for (const action of ['board.create', 'board.delete', 'settings.update', 'storage.migrate', 'card.purgeDeleted']) {
      const d = await RBAC_POLICY_PLUGIN.checkPolicy(identity, action, ctx)
      expect(d.allowed).toBe(true)
    }
  })

  it('denies identity with no roles for any non-trivial action', async () => {
    const identity: AuthIdentity = { subject: 'ghost', roles: [] }
    const d = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'card.create', ctx)
    expect(d.allowed).toBe(false)
    expect(d.actor).toBe('ghost')
  })

  it('end-to-end: createRbacIdentityPlugin + RBAC_POLICY_PLUGIN simulates _authorizeAction', async () => {
    const principals = new Map([
      ['secret-admin', { subject: 'carol', roles: ['admin'] }],
    ])
    const identityPlugin = createRbacIdentityPlugin(principals)

    // Simulate kanban-lite's _authorizeAction for an authorized admin action
    const identity = await identityPlugin.resolveIdentity({ token: 'secret-admin', transport: 'http' })
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'board.delete', { transport: 'http' })
    expect(decision.allowed).toBe(true)
    expect(decision.actor).toBe('carol')
  })

  it('end-to-end: unknown token is denied at the policy layer', async () => {
    const principals = new Map([['tok', { subject: 'alice', roles: ['user'] }]])
    const identityPlugin = createRbacIdentityPlugin(principals)

    const identity = await identityPlugin.resolveIdentity({ token: 'WRONG', transport: 'http' })
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'card.create', { transport: 'http' })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('auth.identity.missing')
  })
})

// ---------------------------------------------------------------------------
// Listener-only runtime helpers – mirrors the SDK before-event contract
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: listener-only auth runtime helpers', () => {
  it('createNoopAuthListenerPlugin returns an event.listener plugin', () => {
    const plugin = createNoopAuthListenerPlugin()
    expect(plugin.manifest.id).toBe('noop-auth-listener')
    expect(plugin.manifest.provides).toContain('event.listener')
    expect(typeof plugin.register).toBe('function')
    expect(typeof plugin.unregister).toBe('function')
  })

  it('noop listener emits auth.allowed and preserves the original input', async () => {
    const bus = new EventBus()
    const plugin = createNoopAuthListenerPlugin({ getAuthContext: () => ({ transport: 'http' }) })
    const onAllowed = vi.fn()
    bus.on('auth.allowed', onAllowed)

    plugin.register(bus)
    const overrides = await bus.emitAsync('card.create', makeBeforePayload())

    expect(overrides).toEqual([])
    expect(onAllowed).toHaveBeenCalledTimes(1)

    plugin.unregister()
    expect(bus.listenerCount('card.create')).toBe(0)
  })

  it('listener factory can return plain-object overrides for approved mutations', async () => {
    const bus = new EventBus()
    const plugin = createAuthListenerPlugin(
      {
        manifest: { id: 'custom-identity', provides: ['auth.identity'] },
        async resolveIdentity(): Promise<AuthIdentity> {
          return { subject: 'alice', roles: ['admin'] }
        },
      },
      {
        manifest: { id: 'custom-policy', provides: ['auth.policy'] },
        async checkPolicy(identity, action): Promise<AuthDecision> {
          return { allowed: true, actor: identity?.subject, metadata: { action } }
        },
      },
      {
        id: 'custom-auth-listener',
        overrideInput: ({ identity }) => ({ approvedBy: identity?.subject ?? 'anonymous' }),
      },
    )

    plugin.register(bus)
    const overrides = await bus.emitAsync('card.create', makeBeforePayload())

    expect(overrides).toEqual([{ approvedBy: 'alice' }])
  })

  it('rbac listener throws AuthError with auth.identity.missing for anonymous protected actions', async () => {
    const bus = new EventBus()
    const plugin = createRbacAuthListenerPlugin(new Map([['secret-user', { subject: 'alice', roles: ['user'] }]]))

    plugin.register(bus)

    const promise = bus.emitAsync('card.create', makeBeforePayload())
    await expect(promise).rejects.toBeInstanceOf(AuthError)
    await expect(promise).rejects.toMatchObject({ category: 'auth.identity.missing' })
  })

  it('rbac listener throws AuthError with auth.policy.denied for insufficient roles', async () => {
    const bus = new EventBus()
    const plugin = createRbacAuthListenerPlugin(
      new Map([['secret-user', { subject: 'alice', roles: ['user'] }]]),
      { getAuthContext: () => ({ token: 'secret-user', transport: 'http' }) },
    )

    plugin.register(bus)

    const promise = bus.emitAsync('board.create', makeBeforePayload({
      event: 'board.create',
      input: { id: 'board-1', name: 'Test board' },
    }))
    await expect(promise).rejects.toBeInstanceOf(AuthError)
    await expect(promise).rejects.toMatchObject({ category: 'auth.policy.denied', actor: 'alice' })
  })
})

// ---------------------------------------------------------------------------
// createStandaloneHttpPlugin – startup token validation
// ---------------------------------------------------------------------------

function makeLocalAuthOptions(
  identityOptions: Record<string, unknown> = {},
): StandaloneHttpPluginRegistrationOptions {
  return {
    workspaceRoot: '/tmp/test-workspace',
    kanbanDir: '/tmp/test-workspace/.kanban',
    capabilities: {
      'card.storage': { provider: 'builtin' },
      'attachment.storage': { provider: 'builtin' },
    },
    authCapabilities: {
      'auth.identity': { provider: 'local', options: identityOptions },
      'auth.policy': { provider: 'local' },
    },
    webhookCapabilities: null,
  }
}

describe('createStandaloneHttpPlugin: startup API token validation', () => {
  it('throws when auth.identity is configured but no apiToken option and no env var', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    delete process.env.KANBAN_TOKEN
    try {
      expect(() => createStandaloneHttpPlugin(makeLocalAuthOptions())).toThrow(
        /auth\.identity is configured but no API token is available/,
      )
    } finally {
      if (savedToken !== undefined) process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt !== undefined) process.env.KANBAN_TOKEN = savedAlt
    }
  })

  it('throws when provider is "kl-plugin-auth" with no apiToken and no env var', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    delete process.env.KANBAN_TOKEN
    try {
      const opts: StandaloneHttpPluginRegistrationOptions = {
        workspaceRoot: '/tmp/test-workspace',
        kanbanDir: '/tmp/test-workspace/.kanban',
        capabilities: {
          'card.storage': { provider: 'builtin' },
          'attachment.storage': { provider: 'builtin' },
        },
        authCapabilities: {
          'auth.identity': { provider: 'kl-plugin-auth', options: { users: [] } },
          'auth.policy': { provider: 'kl-plugin-auth' },
        },
        webhookCapabilities: null,
      }
      expect(() => createStandaloneHttpPlugin(opts)).toThrow(
        /auth\.identity is configured but no API token is available/,
      )
    } finally {
      if (savedToken !== undefined) process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt !== undefined) process.env.KANBAN_TOKEN = savedAlt
    }
  })

  it('does not throw when provider is "kl-plugin-auth" with explicit apiToken', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    delete process.env.KANBAN_TOKEN
    try {
      const opts: StandaloneHttpPluginRegistrationOptions = {
        workspaceRoot: '/tmp/test-workspace',
        kanbanDir: '/tmp/test-workspace/.kanban',
        capabilities: {
          'card.storage': { provider: 'builtin' },
          'attachment.storage': { provider: 'builtin' },
        },
        authCapabilities: {
          'auth.identity': { provider: 'kl-plugin-auth', options: { apiToken: 'explicit-token' } },
          'auth.policy': { provider: 'kl-plugin-auth' },
        },
        webhookCapabilities: null,
      }
      expect(() => createStandaloneHttpPlugin(opts)).not.toThrow()
    } finally {
      if (savedToken !== undefined) process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt !== undefined) process.env.KANBAN_TOKEN = savedAlt
    }
  })

  it('does not throw when options.apiToken is explicitly set', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    delete process.env.KANBAN_TOKEN
    try {
      expect(() =>
        createStandaloneHttpPlugin(makeLocalAuthOptions({ apiToken: 'my-explicit-token' })),
      ).not.toThrow()
    } finally {
      if (savedToken !== undefined) process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt !== undefined) process.env.KANBAN_TOKEN = savedAlt
    }
  })

  it('does not throw when KANBAN_LITE_TOKEN env var is set', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    process.env.KANBAN_LITE_TOKEN = 'kl-env-token'
    try {
      expect(() => createStandaloneHttpPlugin(makeLocalAuthOptions())).not.toThrow()
    } finally {
      if (savedToken === undefined) delete process.env.KANBAN_LITE_TOKEN
      else process.env.KANBAN_LITE_TOKEN = savedToken
    }
  })

  it('does not throw when KANBAN_TOKEN env var is set', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    process.env.KANBAN_TOKEN = 'kl-legacy-env-token'
    try {
      expect(() => createStandaloneHttpPlugin(makeLocalAuthOptions())).not.toThrow()
    } finally {
      if (savedToken !== undefined) process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt === undefined) delete process.env.KANBAN_TOKEN
      else process.env.KANBAN_TOKEN = savedAlt
    }
  })

  it('does not check token when auth is not enabled (noop provider)', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    delete process.env.KANBAN_TOKEN
    try {
      const opts: StandaloneHttpPluginRegistrationOptions = {
        workspaceRoot: '/tmp/test-workspace',
        kanbanDir: '/tmp/test-workspace/.kanban',
        capabilities: {
          'card.storage': { provider: 'builtin' },
          'attachment.storage': { provider: 'builtin' },
        },
        authCapabilities: {
          'auth.identity': { provider: 'noop' },
          'auth.policy': { provider: 'noop' },
        },
        webhookCapabilities: null,
      }
      expect(() => createStandaloneHttpPlugin(opts)).not.toThrow()
    } finally {
      if (savedToken !== undefined) process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt !== undefined) process.env.KANBAN_TOKEN = savedAlt
    }
  })
})

// ---------------------------------------------------------------------------
// createAuthIdentityPlugin – options.apiToken takes precedence over env vars
// ---------------------------------------------------------------------------

describe('createAuthIdentityPlugin: apiToken option', () => {
  it('resolves api-token identity when options.apiToken matches the request token', async () => {
    const plugin = createAuthIdentityPlugin({ apiToken: 'my-pinned-token' })
    expect(plugin.manifest.id).toBe('kl-plugin-auth')
    expect(plugin.manifest.provides).toContain('auth.identity')

    const identity = await plugin.resolveIdentity({ token: 'my-pinned-token', transport: 'http' })
    expect(identity).not.toBeNull()
    expect(identity?.subject).toBe('api-token')
  })

  it('rejects wrong token even when env var matches', async () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    process.env.KANBAN_LITE_TOKEN = 'kl-env-token'
    try {
      const plugin = createAuthIdentityPlugin({ apiToken: 'pinned-only' })
      const identity = await plugin.resolveIdentity({ token: 'kl-env-token', transport: 'http' })
      expect(identity).toBeNull()
    } finally {
      if (savedToken === undefined) delete process.env.KANBAN_LITE_TOKEN
      else process.env.KANBAN_LITE_TOKEN = savedToken
    }
  })

  it('falls back to KANBAN_LITE_TOKEN when no options.apiToken is provided', async () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    process.env.KANBAN_LITE_TOKEN = 'kl-fallback-token'
    try {
      const plugin = createAuthIdentityPlugin()
      const identity = await plugin.resolveIdentity({ token: 'kl-fallback-token', transport: 'http' })
      expect(identity).not.toBeNull()
      expect(identity?.subject).toBe('api-token')
    } finally {
      if (savedToken === undefined) delete process.env.KANBAN_LITE_TOKEN
      else process.env.KANBAN_LITE_TOKEN = savedToken
    }
  })
})

describe('kl-plugin-auth: schema-driven options parity', () => {
  it('package exports and configurable factories share the same schema contract for shared plugin settings flows', () => {
    expect(authIdentityPlugins['kl-plugin-auth']?.optionsSchema?.()).toEqual(
      createAuthIdentityPlugin().optionsSchema?.(),
    )
    expect(authPolicyPlugins['kl-plugin-auth']?.optionsSchema?.()).toEqual(
      createAuthPolicyPlugin().optionsSchema?.(),
    )
  })

  it('auth.identity providers expose shared options schema metadata with secret annotations', () => {
    const schema = authIdentityPlugins['kl-plugin-auth']?.optionsSchema?.()

    expect(schema).toBeDefined()
    expect(schema?.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        apiToken: { type: 'string' },
        users: {
          type: 'array',
          items: {
            type: 'object',
            required: ['username', 'password'],
            properties: {
              username: { type: 'string' },
              password: { type: 'string' },
              role: { enum: ['user', 'manager', 'admin'] },
              groups: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    })
    expect(schema?.uiSchema).toMatchObject({
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'API access',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/apiToken',
              label: 'API token',
            },
          ],
        },
        {
          type: 'Group',
          label: 'Standalone local users',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/users',
              label: 'Local users',
              options: {
                elementLabelProp: 'username',
                detail: {
                  type: 'HorizontalLayout',
                  elements: [
                    { type: 'Control', scope: '#/properties/username', label: 'Username' },
                    { type: 'Control', scope: '#/properties/password', label: 'Password hash' },
                    { type: 'Control', scope: '#/properties/role', label: 'Role' },
                  ],
                },
              },
            },
          ],
        },
      ],
    })
    expect(schema?.secrets).toEqual([
      { path: 'apiToken', redaction: DEFAULT_PLUGIN_SETTINGS_REDACTION },
      { path: 'users.*.password', redaction: DEFAULT_PLUGIN_SETTINGS_REDACTION },
    ])
  })

  it('auth.policy providers expose editable permission-matrix schema metadata and no secrets', () => {
    const schema = authPolicyPlugins['kl-plugin-auth']?.optionsSchema?.()

    expect(schema).toBeDefined()
    expect(schema?.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        permissions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['subjectType', 'subject', 'actions'],
            properties: {
              subjectType: { enum: ['role', 'group'] },
              subject: { type: 'string' },
              actions: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    })
    expect(schema?.uiSchema).toMatchObject({
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Permission matrix',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/permissions',
              label: 'Permission rules',
              options: {
                elementLabelProp: 'subject',
                showSortButtons: true,
                detail: {
                  type: 'VerticalLayout',
                  elements: [
                    { type: 'Control', scope: '#/properties/subjectType', label: 'Subject type', options: { format: 'radio' } },
                    { type: 'Control', scope: '#/properties/subject', label: 'Subject' },
                    {
                      type: 'Control',
                      scope: '#/properties/actions',
                      label: 'Allowed actions',
                      options: { showSortButtons: true },
                      rule: {
                        effect: 'DISABLE',
                        condition: {
                          scope: '#/properties/subject',
                          schema: {
                            not: {
                              type: 'string',
                              minLength: 1,
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    })
    expect(schema?.secrets).toEqual([])
  })

  it('schema-shaped auth.identity options remain backward-compatible with real provider behavior', async () => {
    const plugin = createAuthIdentityPlugin({
      apiToken: 'schema-token',
      users: [{ username: 'alice', password: '$2b$12$existing-hash', role: 'admin', groups: ['ops'] }],
    })

    expect(plugin.optionsSchema?.().schema).toMatchObject({
      properties: {
        apiToken: { type: 'string' },
        users: { type: 'array' },
      },
    })

    await expect(plugin.resolveIdentity({ token: 'schema-token', transport: 'http' })).resolves.toEqual({
      subject: 'api-token',
    })
  })

  it('schema-shaped auth.policy options allow permission rules for roles and groups', async () => {
    const plugin = createAuthPolicyPlugin({
      permissions: [
        { subjectType: 'group', subject: 'auditors', actions: ['board.log.add'] },
        { subjectType: 'role', subject: 'admin', actions: ['settings.update'] },
      ],
    })

    expect(plugin.optionsSchema?.().schema).toMatchObject({
      properties: {
        permissions: { type: 'array' },
      },
    })

    await expect(plugin.checkPolicy({ subject: 'Ada', roles: ['admin'] }, 'settings.update', { transport: 'http' })).resolves.toMatchObject({
      allowed: true,
      actor: 'Ada',
    })
    await expect(plugin.checkPolicy({ subject: 'Bea', groups: ['auditors'] }, 'board.log.add', { transport: 'http' })).resolves.toMatchObject({
      allowed: true,
      actor: 'Bea',
    })
    await expect(plugin.checkPolicy({ subject: 'Ada', roles: ['auditor'] }, 'settings.update', { transport: 'http' })).resolves.toMatchObject({
      allowed: false,
      reason: 'auth.policy.denied',
      actor: 'Ada',
    })
  })

  it('legacy matrix-shaped auth.policy options remain backward-compatible with real provider behavior', async () => {
    const plugin = createAuthPolicyPlugin({
      matrix: {
        auditor: ['board.log.add'],
        admin: ['settings.update'],
      },
    })

    await expect(plugin.checkPolicy({ subject: 'Ada', roles: ['admin'] }, 'settings.update', { transport: 'http' })).resolves.toMatchObject({
      allowed: true,
      actor: 'Ada',
    })
    await expect(plugin.checkPolicy({ subject: 'Ada', roles: ['auditor'] }, 'settings.update', { transport: 'http' })).resolves.toMatchObject({
      allowed: false,
      reason: 'auth.policy.denied',
      actor: 'Ada',
    })
  })
})

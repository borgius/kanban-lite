/**
 * Integration tests for kl-auth-plugin demonstrating consumption from kanban-lite.
 *
 * These tests verify that the plugin's exported shape and behaviour satisfy the
 * contracts that kanban-lite's plugin loader (`tryLoadBundledAuthCompatExports`,
 * `loadExternalAuthIdentityPlugin`, `loadExternalAuthPolicyPlugin`) depends on
 * at runtime.  They do NOT mock the auth logic — every assertion exercises the
 * actual plugin functions.
 */
import { describe, expect, it } from 'vitest'
import {
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
  createRbacIdentityPlugin,
  type AuthContext,
  type AuthIdentity,
} from './index'

// ---------------------------------------------------------------------------
// Manifest shape – the shape kanban-lite validates in tryLoadBundledAuthCompatExports
// ---------------------------------------------------------------------------

describe('kl-auth-plugin: manifest shape (kanban-lite loader contract)', () => {
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
    expect(authIdentityPlugins['noop']).toBe(NOOP_IDENTITY_PLUGIN)
    expect(authIdentityPlugins['rbac']).toBe(RBAC_IDENTITY_PLUGIN)
  })

  it('authPolicyPlugins map exposes noop and rbac providers', () => {
    expect(authPolicyPlugins['noop']).toBe(NOOP_POLICY_PLUGIN)
    expect(authPolicyPlugins['rbac']).toBe(RBAC_POLICY_PLUGIN)
  })
})

// ---------------------------------------------------------------------------
// RBAC action sets – must mirror the sets that kanban-lite exports and uses
// ---------------------------------------------------------------------------

describe('kl-auth-plugin: RBAC role action sets (kanban-lite action catalog)', () => {
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

describe('kl-auth-plugin: NOOP providers (kanban-lite open-access default)', () => {
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

// ---------------------------------------------------------------------------
// RBAC identity provider – token lookup matches kanban-lite _authorizeAction path
// ---------------------------------------------------------------------------

describe('kl-auth-plugin: RBAC identity provider', () => {
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
      ['token-alice', { subject: 'alice', roles: ['user'] }],
      ['token-bob', { subject: 'bob', roles: ['admin'] }],
    ])
    const plugin = createRbacIdentityPlugin(principals)
    expect(plugin.manifest.id).toBe('rbac')

    const alice = await plugin.resolveIdentity({ token: 'token-alice', transport: 'http' })
    expect(alice).not.toBeNull()
    expect(alice?.subject).toBe('alice')
    expect(alice?.roles).toEqual(['user'])

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

describe('kl-auth-plugin: RBAC policy provider (mirrors KanbanSDK._authorizeAction)', () => {
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

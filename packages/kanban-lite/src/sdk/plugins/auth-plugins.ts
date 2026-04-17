import type { AuthContext, AuthDecision } from '../types'
import type { ProviderRef } from '../../shared/config'
import type { Card } from '../../shared/types'
import type { PluginSettingsOptionsSchemaFactory } from './plugin-settings'
import { loadExternalModule } from './plugin-loader'

// ---------------------------------------------------------------------------
// Auth plugin contracts
// ---------------------------------------------------------------------------

/**
 * Resolved identity returned by {@link AuthIdentityPlugin.resolveIdentity}.
 */
export interface AuthIdentity {
  /** Opaque caller identifier (e.g., user ID or client ID). */
  subject: string
  /** Optional list of roles or permission scopes. */
  roles?: string[]
  /** Optional group memberships resolved for the caller. */
  groups?: string[]
}

/** Plugin manifest scoped to auth capability namespaces. */
export interface AuthPluginManifest {
  readonly id: string
  readonly provides: readonly import('../../shared/config').AuthCapabilityNamespace[]
}

/**
 * Contract for `auth.identity` capability providers.
 */
export interface AuthIdentityPlugin {
  readonly manifest: AuthPluginManifest
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>
}

/**
 * Contract for `auth.policy` capability providers.
 */
export interface AuthPolicyPlugin {
  readonly manifest: AuthPluginManifest
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>
}

/** Normalized auth input passed to `auth.visibility` providers. */
export interface AuthVisibilityFilterInput {
  identity: AuthIdentity | null
  roles: readonly string[]
  auth: AuthContext
}

/**
 * Contract for `auth.visibility` capability providers.
 */
export interface AuthVisibilityPlugin {
  readonly manifest: AuthPluginManifest
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  filterVisibleCards(cards: readonly Card[], input: AuthVisibilityFilterInput): Promise<Card[]>
}

/** Module shape supported for external auth provider packages. */
export interface AuthPluginModule {
  readonly authIdentityPlugins?: Record<string, unknown>
  readonly authPolicyPlugins?: Record<string, unknown>
  readonly authVisibilityPlugins?: Record<string, unknown>
  readonly authIdentityPlugin?: unknown
  readonly authPolicyPlugin?: unknown
  readonly authVisibilityPlugin?: unknown
  readonly NOOP_IDENTITY_PLUGIN?: unknown
  readonly NOOP_POLICY_PLUGIN?: unknown
  readonly RBAC_IDENTITY_PLUGIN?: unknown
  readonly RBAC_POLICY_PLUGIN?: unknown
  readonly RBAC_USER_ACTIONS?: unknown
  readonly RBAC_MANAGER_ACTIONS?: unknown
  readonly RBAC_ADMIN_ACTIONS?: unknown
  readonly RBAC_ROLE_MATRIX?: unknown
  readonly createRbacIdentityPlugin?: unknown
  readonly createAuthPolicyPlugin?: ((options?: Record<string, unknown>, providerId?: string) => unknown) | unknown
  readonly createAuthIdentityPlugin?: ((options?: Record<string, unknown>, providerId?: string) => unknown) | unknown
  readonly createAuthVisibilityPlugin?: ((options?: Record<string, unknown>, providerId?: string) => unknown) | unknown
  readonly default?: unknown
}

// ---------------------------------------------------------------------------
// RBAC principal and role types
// ---------------------------------------------------------------------------

/**
 * Principal entry in the runtime-owned RBAC principal registry.
 */
export interface RbacPrincipalEntry {
  subject: string
  roles: string[]
  groups?: string[]
}

/**
 * Canonical role names for the shipped RBAC auth provider.
 */
export type RbacRole = 'user' | 'manager' | 'admin'

/**
 * Actions available to the `user` role.
 */
export const RBAC_USER_ACTIONS: ReadonlySet<string> = new Set([
  'card.checklist.show',
  'card.checklist.add',
  'card.checklist.edit',
  'card.checklist.delete',
  'card.checklist.check',
  'card.checklist.uncheck',
  'form.submit',
  'comment.create',
  'comment.update',
  'comment.delete',
  'attachment.add',
  'attachment.remove',
  'card.action.trigger',
  'log.add',
])

/**
 * Actions available to the `manager` role (includes all `user` actions).
 */
export const RBAC_MANAGER_ACTIONS: ReadonlySet<string> = new Set([
  ...RBAC_USER_ACTIONS,
  'card.create',
  'card.update',
  'card.move',
  'card.transfer',
  'card.delete',
  'board.action.trigger',
  'log.clear',
  'board.log.add',
])

/**
 * Actions available to the `admin` role (includes all `manager` and `user` actions).
 */
export const RBAC_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  ...RBAC_MANAGER_ACTIONS,
  'board.create',
  'board.update',
  'board.delete',
  'settings.update',
  'plugin-settings.read',
  'plugin-settings.update',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'label.set',
  'label.rename',
  'label.delete',
  'column.create',
  'column.update',
  'column.reorder',
  'column.setMinimized',
  'column.delete',
  'column.cleanup',
  'board.action.config.add',
  'board.action.config.remove',
  'board.log.clear',
  'board.setDefault',
  'storage.migrate',
  'card.purgeDeleted',
])

/**
 * Fixed RBAC role matrix keyed by {@link RbacRole}.
 */
export const RBAC_ROLE_MATRIX: Record<RbacRole, ReadonlySet<string>> = {
  user: RBAC_USER_ACTIONS,
  manager: RBAC_MANAGER_ACTIONS,
  admin: RBAC_ADMIN_ACTIONS,
}

/**
 * Maps short auth provider ids to the external auth identity package.
 */
export const AUTH_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['noop', 'kl-plugin-auth'],
  ['rbac', 'kl-plugin-auth'],
  ['local', 'kl-plugin-auth'],
  ['openauth', 'kl-plugin-openauth'],
])

/**
 * Maps short auth provider ids to the external auth policy package.
 */
export const AUTH_POLICY_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['noop', 'kl-plugin-rbac'],
  ['rbac', 'kl-plugin-rbac'],
  ['local', 'kl-plugin-rbac'],
  ['kl-plugin-auth', 'kl-plugin-rbac'],
  ['openauth', 'kl-plugin-openauth'],
])

export const BUILTIN_AUTH_PROVIDER_IDS: ReadonlySet<string> = new Set(['noop'])

// ---------------------------------------------------------------------------
// Fallback built-in implementations (used when kl-plugin-auth is not installed)
// ---------------------------------------------------------------------------

const FALLBACK_NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'noop', provides: ['auth.identity'] },
  async resolveIdentity(_context: AuthContext): Promise<AuthIdentity | null> {
    return null
  },
}

const FALLBACK_NOOP_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'noop', provides: ['auth.policy'] },
  async checkPolicy(_identity: AuthIdentity | null, _action: string, _context: AuthContext): Promise<AuthDecision> {
    return { allowed: true }
  },
}

function createFallbackRbacIdentityPlugin(
  principals: ReadonlyMap<string, RbacPrincipalEntry>,
): AuthIdentityPlugin {
  return {
    manifest: { id: 'rbac', provides: ['auth.identity'] },
    async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
      if (!context.token) return null
      const raw = context.token.startsWith('Bearer ') ? context.token.slice(7) : context.token
      const entry = principals.get(raw)
      if (!entry) return null
      return {
        subject: entry.subject,
        roles: [...entry.roles],
        ...(Array.isArray(entry.groups) ? { groups: [...entry.groups] } : {}),
      }
    },
  }
}

const FALLBACK_RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin = createFallbackRbacIdentityPlugin(new Map())

const FALLBACK_RBAC_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'rbac', provides: ['auth.policy'] },
  async checkPolicy(identity: AuthIdentity | null, action: string, _context: AuthContext): Promise<AuthDecision> {
    if (!identity) {
      return { allowed: false, reason: 'auth.identity.missing' }
    }
    const roles = identity.roles ?? []
    for (const role of roles) {
      const permitted = RBAC_ROLE_MATRIX[role as RbacRole]
      if (permitted?.has(action)) {
        return { allowed: true, actor: identity.subject }
      }
    }
    return { allowed: false, reason: 'auth.policy.denied', actor: identity.subject }
  },
}

// ---------------------------------------------------------------------------
// Bundled auth compat exports (loads from kl-plugin-auth when available)
// ---------------------------------------------------------------------------

interface BundledAuthCompatExports {
  NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin
  NOOP_POLICY_PLUGIN: AuthPolicyPlugin
  RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin
  RBAC_POLICY_PLUGIN: AuthPolicyPlugin
  RBAC_USER_ACTIONS: ReadonlySet<string>
  RBAC_MANAGER_ACTIONS: ReadonlySet<string>
  RBAC_ADMIN_ACTIONS: ReadonlySet<string>
  RBAC_ROLE_MATRIX: Record<RbacRole, ReadonlySet<string>>
  createRbacIdentityPlugin?: (principals: ReadonlyMap<string, RbacPrincipalEntry>) => AuthIdentityPlugin
}

function isValidRoleActionSet(value: unknown): value is ReadonlySet<string> {
  return value instanceof Set && [...value].every((entry) => typeof entry === 'string')
}

function isValidRbacRoleMatrix(value: unknown): value is Record<RbacRole, ReadonlySet<string>> {
  if (!value || typeof value !== 'object') return false
  const matrix = value as Partial<Record<RbacRole, unknown>>
  return isValidRoleActionSet(matrix.user)
    && isValidRoleActionSet(matrix.manager)
    && isValidRoleActionSet(matrix.admin)
}

function tryLoadBundledAuthCompatExports(): BundledAuthCompatExports | null {
  const authPackageName = 'kl-plugin-auth'
  const rbacPackageName = 'kl-plugin-rbac'
  try {
    const authMod = loadExternalModule(authPackageName) as AuthPluginModule
    const noopIdentity = authMod.NOOP_IDENTITY_PLUGIN
    const rbacIdentity = authMod.RBAC_IDENTITY_PLUGIN
    const userActions = authMod.RBAC_USER_ACTIONS
    const managerActions = authMod.RBAC_MANAGER_ACTIONS
    const adminActions = authMod.RBAC_ADMIN_ACTIONS
    const roleMatrix = authMod.RBAC_ROLE_MATRIX

    if (
      !isValidAuthIdentityPlugin(noopIdentity, 'noop')
      || !isValidAuthIdentityPlugin(rbacIdentity, 'rbac')
    ) {
      return null
    }

    let noopPolicy: unknown
    let rbacPolicy: unknown
    try {
      const rbacMod = loadExternalModule(rbacPackageName) as AuthPluginModule
      noopPolicy = rbacMod.NOOP_POLICY_PLUGIN
      rbacPolicy = rbacMod.RBAC_POLICY_PLUGIN
    } catch {
      // Fall back to auth module for policy (transition period)
      noopPolicy = authMod.NOOP_POLICY_PLUGIN
      rbacPolicy = authMod.RBAC_POLICY_PLUGIN
    }

    if (
      !isValidAuthPolicyPlugin(noopPolicy, 'noop')
      || !isValidAuthPolicyPlugin(rbacPolicy, 'rbac')
      || !isValidRoleActionSet(userActions)
      || !isValidRoleActionSet(managerActions)
      || !isValidRoleActionSet(adminActions)
      || !isValidRbacRoleMatrix(roleMatrix)
    ) {
      return null
    }

    return {
      NOOP_IDENTITY_PLUGIN: noopIdentity,
      NOOP_POLICY_PLUGIN: noopPolicy,
      RBAC_IDENTITY_PLUGIN: rbacIdentity,
      RBAC_POLICY_PLUGIN: rbacPolicy,
      RBAC_USER_ACTIONS: userActions,
      RBAC_MANAGER_ACTIONS: managerActions,
      RBAC_ADMIN_ACTIONS: adminActions,
      RBAC_ROLE_MATRIX: roleMatrix,
      createRbacIdentityPlugin: typeof authMod.createRbacIdentityPlugin === 'function'
        ? authMod.createRbacIdentityPlugin as (principals: ReadonlyMap<string, RbacPrincipalEntry>) => AuthIdentityPlugin
        : undefined,
    }
  } catch {
    return null
  }
}

export function getBundledAuthCompatExports(): BundledAuthCompatExports {
  const external = tryLoadBundledAuthCompatExports()
  if (external) return external
  return {
    NOOP_IDENTITY_PLUGIN: FALLBACK_NOOP_IDENTITY_PLUGIN,
    NOOP_POLICY_PLUGIN: FALLBACK_NOOP_POLICY_PLUGIN,
    RBAC_IDENTITY_PLUGIN: FALLBACK_RBAC_IDENTITY_PLUGIN,
    RBAC_POLICY_PLUGIN: FALLBACK_RBAC_POLICY_PLUGIN,
    RBAC_USER_ACTIONS,
    RBAC_MANAGER_ACTIONS,
    RBAC_ADMIN_ACTIONS,
    RBAC_ROLE_MATRIX,
    createRbacIdentityPlugin: createFallbackRbacIdentityPlugin,
  }
}

/** No-op identity provider resolved from `kl-plugin-auth` when available. */
export const NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = getBundledAuthCompatExports().NOOP_IDENTITY_PLUGIN

/** No-op policy provider resolved from `kl-plugin-auth` when available. */
export const NOOP_POLICY_PLUGIN: AuthPolicyPlugin = getBundledAuthCompatExports().NOOP_POLICY_PLUGIN

/** RBAC identity provider resolved from `kl-plugin-auth` when available. */
export const RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin = getBundledAuthCompatExports().RBAC_IDENTITY_PLUGIN

/** RBAC policy provider resolved from `kl-plugin-auth` when available. */
export const RBAC_POLICY_PLUGIN: AuthPolicyPlugin = getBundledAuthCompatExports().RBAC_POLICY_PLUGIN

/**
 * Creates a runtime-validated RBAC identity plugin backed by a host-supplied
 * principal registry.
 */
export function createRbacIdentityPlugin(
  principals: ReadonlyMap<string, RbacPrincipalEntry>,
): AuthIdentityPlugin {
  const externalFactory = getBundledAuthCompatExports().createRbacIdentityPlugin
  return externalFactory ? externalFactory(principals) : createFallbackRbacIdentityPlugin(principals)
}

// ---------------------------------------------------------------------------
// Plugin validators
// ---------------------------------------------------------------------------

export function isValidAuthIdentityPlugin(plugin: unknown, providerId: string): plugin is AuthIdentityPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AuthIdentityPlugin
  return typeof candidate.resolveIdentity === 'function'
    && typeof candidate.manifest?.id === 'string'
    && candidate.manifest.id === providerId
    && Array.isArray(candidate.manifest.provides)
    && candidate.manifest.provides.includes('auth.identity')
}

export function isValidAuthPolicyPlugin(plugin: unknown, providerId: string): plugin is AuthPolicyPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AuthPolicyPlugin
  return typeof candidate.checkPolicy === 'function'
    && typeof candidate.manifest?.id === 'string'
    && candidate.manifest.id === providerId
    && Array.isArray(candidate.manifest.provides)
    && candidate.manifest.provides.includes('auth.policy')
}

export function isValidAuthVisibilityPlugin(plugin: unknown, providerId: string): plugin is AuthVisibilityPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AuthVisibilityPlugin
  return typeof candidate.filterVisibleCards === 'function'
    && typeof candidate.manifest?.id === 'string'
    && candidate.manifest.id === providerId
    && Array.isArray(candidate.manifest.provides)
    && candidate.manifest.provides.includes('auth.visibility')
}

// ---------------------------------------------------------------------------
// Plugin selectors
// ---------------------------------------------------------------------------

export function selectAuthIdentityPlugin(mod: AuthPluginModule, providerId: string): AuthIdentityPlugin | null {
  const mapped = mod.authIdentityPlugins?.[providerId]
  if (isValidAuthIdentityPlugin(mapped, providerId)) return mapped
  const direct = mod.authIdentityPlugin ?? mod.default
  if (isValidAuthIdentityPlugin(direct, providerId)) return direct
  return null
}

export function selectAuthPolicyPlugin(mod: AuthPluginModule, providerId: string): AuthPolicyPlugin | null {
  const mapped = mod.authPolicyPlugins?.[providerId]
  if (isValidAuthPolicyPlugin(mapped, providerId)) return mapped
  const direct = mod.authPolicyPlugin ?? mod.default
  if (isValidAuthPolicyPlugin(direct, providerId)) return direct
  return null
}

export function selectAuthVisibilityPlugin(mod: AuthPluginModule, providerId: string): AuthVisibilityPlugin | null {
  const mapped = mod.authVisibilityPlugins?.[providerId]
  if (isValidAuthVisibilityPlugin(mapped, providerId)) return mapped
  const direct = mod.authVisibilityPlugin ?? mod.default
  if (isValidAuthVisibilityPlugin(direct, providerId)) return direct
  return null
}

// ---------------------------------------------------------------------------
// External plugin loaders
// ---------------------------------------------------------------------------

export function loadExternalAuthIdentityPlugin(packageName: string, providerId: string, options?: Record<string, unknown>): AuthIdentityPlugin {
  const mod = loadExternalModule(packageName) as AuthPluginModule

  if (options !== undefined && typeof mod.createAuthIdentityPlugin === 'function') {
    const created = (mod.createAuthIdentityPlugin as (opts?: Record<string, unknown>, providerId?: string) => unknown)(options, providerId)
    if (isValidAuthIdentityPlugin(created, providerId)) return created
  }

  const plugin = selectAuthIdentityPlugin(mod, providerId)
  if (!plugin) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid auth identity provider for "${providerId}". ` +
      `Expected authIdentityPlugins["${providerId}"] or authIdentityPlugin/default export with ` +
      `a manifest that provides 'auth.identity'.`
    )
  }
  return plugin
}

export function loadExternalAuthPolicyPlugin(packageName: string, providerId: string, options?: Record<string, unknown>): AuthPolicyPlugin {
  const mod = loadExternalModule(packageName) as AuthPluginModule

  if (options !== undefined && typeof mod.createAuthPolicyPlugin === 'function') {
    const created = (mod.createAuthPolicyPlugin as (opts?: Record<string, unknown>, providerId?: string) => unknown)(options, providerId)
    if (isValidAuthPolicyPlugin(created, providerId)) return created
  }

  const plugin = selectAuthPolicyPlugin(mod, providerId)
  if (!plugin) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid auth policy provider for "${providerId}". ` +
      `Expected authPolicyPlugins["${providerId}"] or authPolicyPlugin/default export with ` +
      `a manifest that provides 'auth.policy'.`
    )
  }
  return plugin
}

export function loadExternalAuthVisibilityPlugin(packageName: string, providerId: string, options?: Record<string, unknown>): AuthVisibilityPlugin {
  const mod = loadExternalModule(packageName) as AuthPluginModule

  if (options !== undefined && typeof mod.createAuthVisibilityPlugin === 'function') {
    const created = (mod.createAuthVisibilityPlugin as (opts?: Record<string, unknown>, providerId?: string) => unknown)(options, providerId)
    if (isValidAuthVisibilityPlugin(created, providerId)) return created
  }

  const plugin = selectAuthVisibilityPlugin(mod, providerId)
  if (!plugin) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid auth visibility provider for "${providerId}". ` +
      `Expected authVisibilityPlugins["${providerId}"] or authVisibilityPlugin/default export with ` +
      `a manifest that provides 'auth.visibility'.`
    )
  }
  return plugin
}

// ---------------------------------------------------------------------------
// Provider resolvers (entry points for resolveCapabilityBag)
// ---------------------------------------------------------------------------

export function resolveAuthIdentityPlugin(ref: ProviderRef): AuthIdentityPlugin {
  if (ref.provider === 'noop') return NOOP_IDENTITY_PLUGIN
  if (ref.provider === 'rbac') return RBAC_IDENTITY_PLUGIN
  const packageName = AUTH_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthIdentityPlugin(packageName, ref.provider, ref.options)
}

export function resolveAuthPolicyPlugin(ref: ProviderRef): AuthPolicyPlugin {
  if (ref.provider === 'noop') return NOOP_POLICY_PLUGIN
  if (ref.provider === 'rbac') return RBAC_POLICY_PLUGIN
  const packageName = AUTH_POLICY_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthPolicyPlugin(packageName, ref.provider, ref.options)
}

export function resolveAuthVisibilityPlugin(ref: ProviderRef): AuthVisibilityPlugin | null {
  if (ref.provider === 'none') return null
  const packageName = AUTH_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthVisibilityPlugin(packageName, ref.provider, ref.options)
}



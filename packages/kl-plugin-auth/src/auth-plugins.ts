import * as fs from 'node:fs'
import * as path from 'node:path'
import { compare } from 'bcryptjs'
import type {
  AuthContext,
  AuthDecision,
  AuthIdentity,
  AuthIdentityPlugin,
  AuthPolicyPlugin,
  BeforeEventListenerResponse,
  BeforeEventPayload,
  EventBus,
  RbacPrincipalEntry,
  RbacRole,
  SDKBeforeEventType,
  SDKEvent,
  SDKEventListener,
  SDKEventListenerPlugin,
  AuthErrorCategory,
  KanbanSDK,
} from 'kanban-lite/sdk'
import {
  RBAC_USER_ACTIONS,
  RBAC_MANAGER_ACTIONS,
  RBAC_ADMIN_ACTIONS,
  RBAC_ROLE_MATRIX,
  SDK_BEFORE_EVENT_NAMES,
} from './auth-rbac'
import {
  NOOP_IDENTITY_PLUGIN,
  NOOP_POLICY_PLUGIN,
  AuthListenerPluginOptions,
  checkPermissionMatrixPolicy,
  cloneIdentity,
  createResolvedKlauthPolicyOptionsSchema,
  createResolvedLocalAuthPolicyOptionsSchema,
  createResolvedRbacPolicyOptionsSchema,
  createAuthIdentityOptionsSchema,
  getConfiguredApiToken,
  normalizeToken,
  resolvePermissionMatrixEntries,
  safeTokenEquals,
  type AuthPluginOptionsSchemaFactory,
} from './auth-core'
import {
  LOCAL_IDENTITY_PLUGIN,
  LOCAL_POLICY_PLUGIN,
} from './auth-http'

export function createRbacIdentityPlugin(
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

export const RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  ...createRbacIdentityPlugin(new Map()),
  optionsSchema: createAuthIdentityOptionsSchema,
}

export const RBAC_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'rbac', provides: ['auth.policy'] },
  optionsSchema: createResolvedRbacPolicyOptionsSchema,
  async checkPolicy(identity: AuthIdentity | null, action: string, _context: AuthContext): Promise<AuthDecision> {
    if (!identity) {
      return { allowed: false, reason: 'auth.identity.missing' }
    }
    // Global API token resolves to subject 'api-token' with no roles; allow all actions.
    if (identity.subject === 'api-token') {
      return { allowed: true, actor: identity.subject }
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

/**
 * Default auth identity plugin exported under the package name.
 * Allows `"provider": "kl-plugin-auth"` in `.kanban.json` `plugins` config,
 * using the same local-auth identity behaviour.
 */
const KL_AUTH_DEFAULT_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'kl-plugin-auth', provides: ['auth.identity'] },
  optionsSchema: createAuthIdentityOptionsSchema,
  resolveIdentity: LOCAL_IDENTITY_PLUGIN.resolveIdentity,
}

/**
 * Factory for a configurable identity plugin for the `kl-plugin-auth` provider.
 *
 * When `options.apiToken` is provided it is used as the API token for
 * token-based identity resolution, taking precedence over the
 * `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` environment variables.  This lets
 * operators pin a known token directly in `.kanban.json` without relying on
 * auto-generated environment values.
 *
 * When `options.apiToken` is absent the plugin falls back to the standard
 * env-var lookup, preserving existing behaviour.
 *
 * @example
 * ```json
 * "auth.identity": {
 *   "provider": "kl-plugin-auth",
 *   "options": { "apiToken": "my-secret-token" }
 * }
 * ```
 */
export function createAuthIdentityPlugin(options?: Record<string, unknown>, providerId = 'kl-plugin-auth'): AuthIdentityPlugin {
  const explicitToken =
    typeof options?.apiToken === 'string' && options.apiToken.length > 0
      ? options.apiToken
      : null

  return {
    manifest: { id: providerId, provides: ['auth.identity'] },
    optionsSchema: createAuthIdentityOptionsSchema,
    async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
      if (context.identity) return cloneIdentity(context.identity)

      const token = normalizeToken(context.token)
      const configuredToken = explicitToken ?? getConfiguredApiToken()
      if (token && configuredToken && safeTokenEquals(token, configuredToken)) {
        return { subject: context.actorHint ?? 'api-token' }
      }

      if (context.actorHint) {
        return { subject: context.actorHint }
      }

      return null
    },
  }
}

/**
 * Default auth policy plugin exported under the package name.
 * Allows `"provider": "kl-plugin-auth"` in `.kanban.json` `plugins` config,
 * using the same local-auth policy behaviour.
 */
const KL_AUTH_DEFAULT_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'kl-plugin-auth', provides: ['auth.policy'] },
  optionsSchema: createResolvedKlauthPolicyOptionsSchema,
  checkPolicy: LOCAL_POLICY_PLUGIN.checkPolicy,
}

/**
 * Factory for a configurable auth policy plugin for `local`, `rbac`, and `kl-plugin-auth` providers.
 *
 * When `options.permissions` is provided it **overrides** the provider's default
 * policy behavior with an explicit per-role permission matrix. The shared
 * settings UI writes role-based rows and uses the live before-event catalog,
 * while legacy `options.matrix` role maps remain supported for backward
 * compatibility.
 *
 * When no explicit matrix is provided, `rbac` falls back to the fixed SDK role
 * matrix while `local` / `kl-plugin-auth` fall back to the existing
 * allow-authenticated local policy.
 *
 * @example
 * ```json
 * "auth.policy": {
 *   "provider": "kl-plugin-auth",
 *   "options": {
 *     "permissions": [
 *       { "role": "user", "actions": ["form.submit", "comment.create"] },
 *       { "role": "admin", "actions": ["board.log.add", "settings.update"] }
 *     ]
 *   }
 * }
 * ```
 */
export function createAuthPolicyPlugin(options?: Record<string, unknown>, providerId = 'kl-plugin-auth'): AuthPolicyPlugin {
  const permissionEntries = resolvePermissionMatrixEntries(options)
  const defaultCheckPolicy = providerId === 'rbac'
    ? RBAC_POLICY_PLUGIN.checkPolicy
    : LOCAL_POLICY_PLUGIN.checkPolicy
  const optionsSchema = providerId === 'rbac'
    ? createResolvedRbacPolicyOptionsSchema
    : providerId === 'local'
      ? createResolvedLocalAuthPolicyOptionsSchema
      : createResolvedKlauthPolicyOptionsSchema

  return {
    manifest: { id: providerId, provides: ['auth.policy'] },
    optionsSchema,
    async checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision> {
      // Global API token (apiToken in identity options) authenticates as subject 'api-token'
      // with no roles. Treat it as a supertoken: allow all actions when it is present.
      if (identity?.subject === 'api-token') {
        return { allowed: true, actor: identity.subject }
      }
      if (permissionEntries.length === 0) {
        return defaultCheckPolicy(identity, action, context)
      }
      return checkPermissionMatrixPolicy(identity, action, permissionEntries)
    },
  }
}

export const authIdentityPlugins: Record<string, AuthIdentityPlugin> = {
  local: LOCAL_IDENTITY_PLUGIN,
  noop: NOOP_IDENTITY_PLUGIN,
  rbac: RBAC_IDENTITY_PLUGIN,
  'kl-plugin-auth': KL_AUTH_DEFAULT_IDENTITY_PLUGIN,
}

export const authPolicyPlugins: Record<string, AuthPolicyPlugin> = {
  local: LOCAL_POLICY_PLUGIN,
  noop: NOOP_POLICY_PLUGIN,
  rbac: RBAC_POLICY_PLUGIN,
  'kl-plugin-auth': KL_AUTH_DEFAULT_POLICY_PLUGIN,
}

interface AuthErrorInstance extends Error {
  category: AuthErrorCategory
  actor?: string
}

type AuthErrorConstructor = new (
  category: AuthErrorCategory,
  message: string,
  actor?: string,
) => AuthErrorInstance

class AuthErrorCompat extends Error implements AuthErrorInstance {
  category: AuthErrorCategory
  actor?: string

  constructor(category: AuthErrorCategory, message: string, actor?: string) {
    super(message)
    this.name = 'AuthError'
    this.category = category
    this.actor = actor
  }
}

function getAuthErrorCtor(): AuthErrorConstructor {
  const candidates = [
    'kanban-lite/sdk',
    path.join(__dirname, '..', '..', 'kanban-lite', 'dist', 'sdk', 'index.cjs'),
  ]

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require(candidate) as { AuthError?: AuthErrorConstructor }
      if (typeof sdk.AuthError === 'function') {
        return sdk.AuthError
      }
    } catch {
      // Try the next candidate.
    }
  }

  return AuthErrorCompat
}

function isBeforeEventPayload(value: unknown): value is BeforeEventPayload<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return false
  const payload = value as BeforeEventPayload<Record<string, unknown>>
  return typeof payload.event === 'string'
    && SDK_BEFORE_EVENT_NAMES.includes(payload.event as SDKBeforeEventType)
    && typeof payload.input === 'object'
    && payload.input !== null
}

function toAuthErrorCategory(reason?: AuthErrorCategory, identity?: AuthIdentity | null): AuthErrorCategory {
  if (reason) return reason
  return identity ? 'auth.policy.denied' : 'auth.identity.missing'
}

function withAuthHints(
  context: AuthContext | undefined,
  payload: BeforeEventPayload<Record<string, unknown>>,
): AuthContext {
  const merged: AuthContext = { ...(context ?? {}) }
  const input = payload.input
  const setString = (
    key: 'actorHint' | 'boardId' | 'cardId' | 'fromBoardId' | 'toBoardId' | 'columnId' | 'labelName' | 'commentId' | 'attachment' | 'actionKey' | 'formId',
    value: unknown,
  ): void => {
    if (typeof value === 'string' && value.length > 0) merged[key] = value
  }

  setString('boardId', payload.boardId)
  setString('boardId', input.boardId)
  setString('cardId', input.cardId)
  setString('fromBoardId', input.fromBoardId)
  setString('toBoardId', input.toBoardId)
  setString('columnId', input.columnId)
  setString('commentId', input.commentId)
  setString('attachment', input.attachment)
  setString('actionKey', input.actionKey)
  setString('formId', input.formId)
  setString('labelName', input.labelName)

  if (!merged.columnId) setString('columnId', input.targetStatus)
  if (!merged.actionKey) setString('actionKey', input.action)
  if (!merged.actionKey) setString('actionKey', input.key)
  if (!merged.labelName) setString('labelName', input.name)
  if (!merged.labelName) setString('labelName', input.oldName)

  return merged
}

function emitAuthStatusEvent(
  bus: EventBus,
  type: 'auth.allowed' | 'auth.denied',
  action: string,
  actor?: string,
  boardId?: string,
  reason?: AuthErrorCategory,
): void {
  const payload: SDKEvent = {
    type,
    data: {
      action,
      actor,
      ...(reason ? { reason } : {}),
    },
    timestamp: new Date().toISOString(),
    actor,
    boardId,
  }
  bus.emit(type, payload)
}

/**
 * Listener-only auth runtime plugin backed by identity/policy capability providers.
 *
 * Registers across all SDK before-events, resolves identity from the active
 * scoped auth carrier exposed via `options.getAuthContext`,
 * evaluates authorization for `payload.event`, throws `AuthError` to veto denied
 * mutations, and may return a plain-object input override when `overrideInput`
 * is supplied.
 */
export class ProviderBackedAuthListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }

  private readonly subscriptions: Array<() => void> = []

  constructor(
    private readonly authIdentity: AuthIdentityPlugin,
    private readonly authPolicy: AuthPolicyPlugin,
    private readonly options: AuthListenerPluginOptions = {},
  ) {
    this.manifest = {
      id: options.id ?? `auth-listener:${authIdentity.manifest.id}:${authPolicy.manifest.id}`,
      provides: ['event.listener'],
    }
  }

  register(bus: EventBus): void {
    if (this.subscriptions.length > 0) return

    const listener = async (
      payload: BeforeEventPayload<Record<string, unknown>>,
    ): Promise<BeforeEventListenerResponse> => {
      if (!isBeforeEventPayload(payload)) return

      const context = withAuthHints(this.options.getAuthContext?.(), payload)
      const action = payload.event
      const identity = await this.authIdentity.resolveIdentity(context)
      const decision = await this.authPolicy.checkPolicy(identity, action, context)
      const actor = decision.actor ?? identity?.subject ?? payload.actor
      const boardId = payload.boardId ?? context.boardId

      if (!decision.allowed) {
        const reason = toAuthErrorCategory(decision.reason, identity)
        emitAuthStatusEvent(bus, 'auth.denied', action, actor, boardId, reason)
        const AuthError = getAuthErrorCtor()
        throw new AuthError(
          reason,
          `Action "${action}" denied${actor ? ` for "${actor}"` : ''}`,
          actor,
        )
      }

      emitAuthStatusEvent(bus, 'auth.allowed', action, actor, boardId)
      return this.options.overrideInput?.({ payload, identity, decision })
    }

    for (const event of SDK_BEFORE_EVENT_NAMES) {
      this.subscriptions.push(bus.on(event, listener as unknown as SDKEventListener))
    }
  }

  unregister(): void {
    while (this.subscriptions.length > 0) {
      this.subscriptions.pop()?.()
    }
  }
}

export function createAuthListenerPlugin(
  authIdentity: AuthIdentityPlugin,
  authPolicy: AuthPolicyPlugin,
  options?: AuthListenerPluginOptions,
): ProviderBackedAuthListenerPlugin {
  return new ProviderBackedAuthListenerPlugin(authIdentity, authPolicy, options)
}

export function createNoopAuthListenerPlugin(
  options?: Omit<AuthListenerPluginOptions, 'id'> & { id?: string },
): ProviderBackedAuthListenerPlugin {
  return createAuthListenerPlugin(NOOP_IDENTITY_PLUGIN, NOOP_POLICY_PLUGIN, {
    ...options,
    id: options?.id ?? 'noop-auth-listener',
  })
}

export function createRbacAuthListenerPlugin(
  principals: ReadonlyMap<string, RbacPrincipalEntry> = new Map(),
  options?: Omit<AuthListenerPluginOptions, 'id'> & { id?: string },
): ProviderBackedAuthListenerPlugin {
  return createAuthListenerPlugin(createRbacIdentityPlugin(principals), RBAC_POLICY_PLUGIN, {
    ...options,
    id: options?.id ?? 'rbac-auth-listener',
  })
}

export function createLocalAuthListenerPlugin(
  options?: Omit<AuthListenerPluginOptions, 'id'> & { id?: string },
): ProviderBackedAuthListenerPlugin {
  return createAuthListenerPlugin(LOCAL_IDENTITY_PLUGIN, LOCAL_POLICY_PLUGIN, {
    ...options,
    id: options?.id ?? 'local-auth-listener',
  })
}

export const authListenerPluginFactories = {
  local: createLocalAuthListenerPlugin,
  noop: createNoopAuthListenerPlugin,
  rbac: createRbacAuthListenerPlugin,
}

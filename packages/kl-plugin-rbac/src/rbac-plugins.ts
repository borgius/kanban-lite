import * as fs from 'node:fs'
import * as path from 'node:path'
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
} from 'kanban-lite/sdk'
import {
  RBAC_ROLE_MATRIX,
  SDK_BEFORE_EVENT_NAMES,
} from './rbac-actions'
import {
  NOOP_POLICY_PLUGIN,
  LOCAL_POLICY_PLUGIN,
  checkPermissionMatrixPolicy,
  resolvePermissionMatrixEntries,
  createResolvedRbacPluginPolicyOptionsSchema,
  createResolvedLocalAuthPolicyOptionsSchema,
  createResolvedRbacPolicyOptionsSchema,
  type AuthPluginOptionsSchemaFactory,
} from './rbac-core'

// ---------------------------------------------------------------------------
// RBAC identity plugin (resolves identity from bearer token → principal map)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RBAC policy plugin
// ---------------------------------------------------------------------------

export const RBAC_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'rbac', provides: ['auth.policy'] },
  optionsSchema: createResolvedRbacPolicyOptionsSchema,
  async checkPolicy(identity: AuthIdentity | null, action: string, _context: AuthContext): Promise<AuthDecision> {
    if (!identity) {
      return { allowed: false, reason: 'auth.identity.missing' }
    }
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

// ---------------------------------------------------------------------------
// Default kl-plugin-rbac policy plugin
// ---------------------------------------------------------------------------

const KL_RBAC_DEFAULT_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'kl-plugin-rbac', provides: ['auth.policy'] },
  optionsSchema: createResolvedRbacPluginPolicyOptionsSchema,
  checkPolicy: RBAC_POLICY_PLUGIN.checkPolicy,
}

// ---------------------------------------------------------------------------
// Configurable policy factory
// ---------------------------------------------------------------------------

export function createAuthPolicyPlugin(options?: Record<string, unknown>, providerId = 'kl-plugin-rbac'): AuthPolicyPlugin {
  const permissionEntries = resolvePermissionMatrixEntries(options)
  const defaultCheckPolicy = providerId === 'rbac'
    ? RBAC_POLICY_PLUGIN.checkPolicy
    : LOCAL_POLICY_PLUGIN.checkPolicy
  const optionsSchema: AuthPluginOptionsSchemaFactory = providerId === 'rbac'
    ? createResolvedRbacPolicyOptionsSchema
    : providerId === 'local'
      ? createResolvedLocalAuthPolicyOptionsSchema
      : createResolvedRbacPluginPolicyOptionsSchema

  return {
    manifest: { id: providerId, provides: ['auth.policy'] },
    optionsSchema,
    async checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision> {
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

// ---------------------------------------------------------------------------
// Policy plugin registry
// ---------------------------------------------------------------------------

export const authPolicyPlugins: Record<string, AuthPolicyPlugin> = {
  local: LOCAL_POLICY_PLUGIN,
  noop: NOOP_POLICY_PLUGIN,
  rbac: RBAC_POLICY_PLUGIN,
  'kl-plugin-rbac': KL_RBAC_DEFAULT_POLICY_PLUGIN,
}

// ---------------------------------------------------------------------------
// Auth listener plugin (enforcement bridge between identity + policy)
// ---------------------------------------------------------------------------

export interface AuthListenerOverrideContext {
  readonly payload: BeforeEventPayload<Record<string, unknown>>
  readonly identity: AuthIdentity | null
  readonly decision: AuthDecision
}

export interface AuthListenerPluginOptions {
  readonly id?: string
  readonly getAuthContext?: () => AuthContext | undefined
  readonly overrideInput?: (
    context: AuthListenerOverrideContext,
  ) => BeforeEventListenerResponse | Promise<BeforeEventListenerResponse>
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
  const NOOP_IDENTITY: AuthIdentityPlugin = {
    manifest: { id: 'noop', provides: ['auth.identity'] },
    async resolveIdentity(): Promise<AuthIdentity | null> { return null },
  }
  return createAuthListenerPlugin(NOOP_IDENTITY, NOOP_POLICY_PLUGIN, {
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

export const authListenerPluginFactories = {
  noop: createNoopAuthListenerPlugin,
  rbac: createRbacAuthListenerPlugin,
}

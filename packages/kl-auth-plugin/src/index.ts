import * as fs from 'node:fs'
import * as path from 'node:path'

export type AuthErrorCategory =
  | 'auth.identity.missing'
  | 'auth.identity.invalid'
  | 'auth.identity.expired'
  | 'auth.policy.denied'
  | 'auth.policy.unknown'
  | 'auth.provider.error'

export interface AuthContext {
  token?: string
  tokenSource?: string
  transport?: string
  actorHint?: string
  boardId?: string
  cardId?: string
  fromBoardId?: string
  toBoardId?: string
  columnId?: string
  labelName?: string
  commentId?: string
  attachment?: string
  actionKey?: string
  formId?: string
}

export interface AuthDecision {
  allowed: boolean
  reason?: AuthErrorCategory
  actor?: string
  metadata?: Record<string, unknown>
}

export type SDKBeforeEventType =
  | 'card.create'
  | 'card.update'
  | 'card.move'
  | 'card.delete'
  | 'card.transfer'
  | 'card.action.trigger'
  | 'card.purgeDeleted'
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'
  | 'column.create'
  | 'column.update'
  | 'column.delete'
  | 'column.reorder'
  | 'column.setMinimized'
  | 'column.cleanup'
  | 'attachment.add'
  | 'attachment.remove'
  | 'settings.update'
  | 'board.create'
  | 'board.update'
  | 'board.delete'
  | 'board.action.config.add'
  | 'board.action.config.remove'
  | 'board.action.trigger'
  | 'board.setDefault'
  | 'log.add'
  | 'log.clear'
  | 'board.log.add'
  | 'board.log.clear'
  | 'storage.migrate'
  | 'label.set'
  | 'label.rename'
  | 'label.delete'
  | 'webhook.create'
  | 'webhook.update'
  | 'webhook.delete'
  | 'form.submit'

export interface BeforeEventPayload<TInput = Record<string, unknown>> {
  readonly event: SDKBeforeEventType
  readonly input: TInput
  readonly actor?: string
  readonly boardId?: string
  readonly timestamp: string
}

export type BeforeEventListenerResponse = Record<string, unknown> | void

export interface SDKEvent {
  readonly type: string
  readonly data: unknown
  readonly timestamp: string
  readonly actor?: string
  readonly boardId?: string
  readonly meta?: Record<string, unknown>
}

export type SDKEventListener = (payload: SDKEvent | BeforeEventPayload<Record<string, unknown>>) => unknown

export interface EventBus {
  on(event: string, listener: SDKEventListener): () => void
  emit(event: string, payload: SDKEvent): void
}

export interface SDKEventListenerPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  register(bus: EventBus): void
  unregister(): void
}

export interface AuthIdentity {
  subject: string
  roles?: string[]
}

export interface AuthPluginManifest {
  readonly id: string
  readonly provides: readonly ('auth.identity' | 'auth.policy')[]
}

export interface AuthIdentityPlugin {
  readonly manifest: AuthPluginManifest
  resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>
}

export interface AuthPolicyPlugin {
  readonly manifest: AuthPluginManifest
  checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>
}

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

export interface RbacPrincipalEntry {
  subject: string
  roles: string[]
}

export type RbacRole = 'user' | 'manager' | 'admin'

export const NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'noop', provides: ['auth.identity'] },
  async resolveIdentity(_context: AuthContext): Promise<AuthIdentity | null> {
    return null
  },
}

export const NOOP_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'noop', provides: ['auth.policy'] },
  async checkPolicy(_identity: AuthIdentity | null, _action: string, _context: AuthContext): Promise<AuthDecision> {
    return { allowed: true }
  },
}

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
      return { subject: entry.subject, roles: [...entry.roles] }
    },
  }
}

export const RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin = createRbacIdentityPlugin(new Map())

export const RBAC_USER_ACTIONS: ReadonlySet<string> = new Set([
  'form.submit',
  'comment.create',
  'comment.update',
  'comment.delete',
  'attachment.add',
  'attachment.remove',
  'card.action.trigger',
  'log.add',
])

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

export const RBAC_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  ...RBAC_MANAGER_ACTIONS,
  'board.create',
  'board.update',
  'board.delete',
  'settings.update',
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

export const RBAC_ROLE_MATRIX: Record<RbacRole, ReadonlySet<string>> = {
  user: RBAC_USER_ACTIONS,
  manager: RBAC_MANAGER_ACTIONS,
  admin: RBAC_ADMIN_ACTIONS,
}

export const RBAC_POLICY_PLUGIN: AuthPolicyPlugin = {
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

export const authIdentityPlugins: Record<string, AuthIdentityPlugin> = {
  noop: NOOP_IDENTITY_PLUGIN,
  rbac: RBAC_IDENTITY_PLUGIN,
}

export const authPolicyPlugins: Record<string, AuthPolicyPlugin> = {
  noop: NOOP_POLICY_PLUGIN,
  rbac: RBAC_POLICY_PLUGIN,
}

const SDK_BEFORE_EVENT_NAMES: readonly SDKBeforeEventType[] = [
  'card.create',
  'card.update',
  'card.move',
  'card.delete',
  'card.transfer',
  'card.action.trigger',
  'card.purgeDeleted',
  'comment.create',
  'comment.update',
  'comment.delete',
  'column.create',
  'column.update',
  'column.delete',
  'column.reorder',
  'column.setMinimized',
  'column.cleanup',
  'attachment.add',
  'attachment.remove',
  'settings.update',
  'board.create',
  'board.update',
  'board.delete',
  'board.action.config.add',
  'board.action.config.remove',
  'board.action.trigger',
  'board.setDefault',
  'log.add',
  'log.clear',
  'board.log.add',
  'board.log.clear',
  'storage.migrate',
  'label.set',
  'label.rename',
  'label.delete',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'form.submit',
]

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
  const setString = (key: keyof AuthContext, value: unknown): void => {
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

export const authListenerPluginFactories = {
  noop: createNoopAuthListenerPlugin,
  rbac: createRbacAuthListenerPlugin,
}

const authPluginPackage = {
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  authListenerPluginFactories,
}

export default authPluginPackage

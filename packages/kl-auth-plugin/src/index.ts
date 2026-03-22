export interface AuthIdentity {
  subject: string
  roles?: string[]
}

export interface AuthPluginManifest {
  readonly id: string
  readonly provides: readonly ('auth.identity' | 'auth.policy')[]
}

export interface AuthDecision {
  allowed: boolean
  reason?: string
  actor?: string
  metadata?: Record<string, unknown>
}

export interface AuthContext {
  token?: string
  tokenSource?: string
  transport?: string
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

export interface AuthIdentityPlugin {
  readonly manifest: AuthPluginManifest
  resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>
}

export interface AuthPolicyPlugin {
  readonly manifest: AuthPluginManifest
  checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>
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

const authPluginPackage = {
  authIdentityPlugins,
  authPolicyPlugins,
}

export default authPluginPackage

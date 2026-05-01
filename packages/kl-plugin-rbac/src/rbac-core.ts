import type {
  AuthContext,
  AuthDecision,
  AuthIdentity,
  AuthPolicyPlugin,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'
import { RBAC_ROLE_MATRIX, SDK_BEFORE_EVENT_NAMES } from './rbac-actions'

export type AuthPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

export interface PermissionMatrixEntry {
  role: string
  actions: string[]
}

const DEFAULT_LOCAL_AUTH_ROLES = ['user', 'manager', 'admin'] as const

function getDefaultLocalAuthRoles(): string[] {
  return [...DEFAULT_LOCAL_AUTH_ROLES]
}

function createRbacDefaultPermissionEntries(): PermissionMatrixEntry[] {
  return (['user', 'manager', 'admin'] as const).map((role) => ({
    role,
    actions: [...RBAC_ROLE_MATRIX[role]],
  }))
}

export function getConfiguredAuthRoles(sdk?: KanbanSDK): string[] {
  const configSnapshot = typeof sdk?.getConfigSnapshot === 'function'
    ? sdk.getConfigSnapshot()
    : undefined
  const roles = normalizeStringList(
    configSnapshot?.plugins?.['auth.identity']?.options?.roles
    ?? configSnapshot?.auth?.['auth.identity']?.options?.roles,
  )
  return roles ?? getDefaultLocalAuthRoles()
}

export async function getAvailableAuthPolicyBeforeEvents(sdk?: KanbanSDK): Promise<string[]> {
  const events = typeof sdk?.listAvailableEvents === 'function'
    ? await sdk.listAvailableEvents({ type: 'before' })
    : undefined
  const configuredEvents = events
    ?.filter((event) => event.phase === 'before')
    .map((event) => event.event)
  const names = configuredEvents && configuredEvents.length > 0
    ? configuredEvents
    : [...SDK_BEFORE_EVENT_NAMES]
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

// ---------------------------------------------------------------------------
// Noop / Local policy plugins
// ---------------------------------------------------------------------------

export const NOOP_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'noop', provides: ['auth.policy'] },
  async checkPolicy(_identity: AuthIdentity | null, _action: string, _context: AuthContext): Promise<AuthDecision> {
    return { allowed: true }
  },
}

export const LOCAL_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'local', provides: ['auth.policy'] },
  optionsSchema: () => createAuthPolicyOptionsSchema('local'),
  async checkPolicy(identity: AuthIdentity | null, action: string, _context: AuthContext): Promise<AuthDecision> {
    if (!identity) {
      return { allowed: false, reason: 'auth.identity.missing' }
    }
    void action
    return { allowed: true, actor: identity.subject }
  },
}

// ---------------------------------------------------------------------------
// Permission matrix helpers
// ---------------------------------------------------------------------------

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? [...new Set(entries)] : undefined
}

export function parsePermissionMatrixEntries(value: unknown): PermissionMatrixEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const role = typeof (entry as { role?: unknown }).role === 'string'
      ? (entry as { role: string }).role
      : typeof (entry as { subject?: unknown }).subject === 'string'
        ? (entry as { subject: string }).subject
        : undefined
    const actions = normalizeStringList((entry as { actions?: unknown }).actions)
    if (typeof role !== 'string') return []
    const normalizedRole = role.trim()
    if (normalizedRole.length === 0 || !actions || actions.length === 0) return []
    return [{ role: normalizedRole, actions }]
  })
}

export function parseLegacyPermissionMatrix(value: unknown): PermissionMatrixEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([role, actions]) => {
    const normalizedRole = role.trim()
    const normalizedActions = normalizeStringList(actions)
    if (normalizedRole.length === 0 || !normalizedActions || normalizedActions.length === 0) return []
    return [{ role: normalizedRole, actions: normalizedActions }]
  })
}

export function resolvePermissionMatrixEntries(options?: Record<string, unknown>): PermissionMatrixEntry[] {
  const configuredEntries = parsePermissionMatrixEntries(options?.permissions)
  if (configuredEntries.length > 0) return configuredEntries
  return parseLegacyPermissionMatrix(options?.matrix)
}

export function checkPermissionMatrixPolicy(
  identity: AuthIdentity | null,
  action: string,
  entries: readonly PermissionMatrixEntry[],
): AuthDecision {
  if (!identity) {
    return { allowed: false, reason: 'auth.identity.missing' }
  }

  const roles = new Set(identity.roles ?? [])
  for (const entry of entries) {
    const isWildcard = entry.actions.includes('*')
    const isExact = entry.actions.includes(action)
    if (roles.has(entry.role) && (isWildcard || isExact)) {
      console.debug('[kl-plugin-rbac] policy allow: role=%s action=%s via=%s', entry.role, action, isWildcard ? 'wildcard' : 'exact')
      return { allowed: true, actor: identity.subject }
    }
  }

  console.debug('[kl-plugin-rbac] policy deny: subject=%s action=%s roles=%s', identity.subject, action, [...roles].join(','))
  return { allowed: false, reason: 'auth.policy.denied', actor: identity.subject }
}

// ---------------------------------------------------------------------------
// Policy options schema
// ---------------------------------------------------------------------------

function createAuthPolicyOptionsSchema(providerId = 'kl-plugin-rbac'): PluginSettingsOptionsSchemaMetadata {
  const shouldSeedDefaultMatrix = providerId === 'rbac' || providerId === 'kl-plugin-rbac'
  const permissionsSchema: Record<string, unknown> = {
    type: 'array',
    title: 'Permission matrix',
    description: 'Optional per-role permission rules. Choose a role from the auth.identity role catalog and the before-events it may run. When omitted, the provider uses its default policy behavior.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['role', 'actions'],
      properties: {
        role: {
          type: 'string',
          title: 'Role',
          minLength: 1,
          description: 'Role to authorize. Values come from auth.identity options.roles when available.',
          enum: async (sdk: KanbanSDK) => getConfiguredAuthRoles(sdk),
        },
        actions: {
          type: 'array',
          title: 'Events',
          minItems: 1,
          uniqueItems: true,
          items: {
            type: 'string',
            title: 'Before-event',
            enum: async (sdk: KanbanSDK) => getAvailableAuthPolicyBeforeEvents(sdk),
            minLength: 1,
          },
        },
      },
    },
  }

  if (shouldSeedDefaultMatrix) {
    permissionsSchema.default = createRbacDefaultPermissionEntries()
  }

  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        permissions: permissionsSchema,
      },
    } as PluginSettingsOptionsSchemaMetadata['schema'],
    uiSchema: {
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
                elementLabelProp: 'role',
                showSortButtons: true,
                detail: {
                  type: 'VerticalLayout',
                  elements: [
                    {
                      type: 'Control',
                      scope: '#/properties/role',
                      label: 'Role',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/actions',
                      label: 'Allowed before-events',
                      options: { showSortButtons: true },
                      rule: {
                        effect: 'DISABLE',
                        condition: {
                          scope: '#/properties/role',
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
    },
    secrets: [],
  }
}

export const createResolvedLocalAuthPolicyOptionsSchema: AuthPluginOptionsSchemaFactory = () => createAuthPolicyOptionsSchema('local')

export const createResolvedRbacPluginPolicyOptionsSchema: AuthPluginOptionsSchemaFactory = () => createAuthPolicyOptionsSchema('kl-plugin-rbac')

export const createResolvedRbacPolicyOptionsSchema: AuthPluginOptionsSchemaFactory = () => createAuthPolicyOptionsSchema('rbac')

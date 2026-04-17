import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  AuthCapabilityNamespace,
  AuthContext,
  AuthIdentity,
  AuthIdentityPlugin,
  CliPluginContext,
  KanbanSDK,
  KanbanConfig,
  PluginSettingsBeforeSaveContext,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  ProviderRef,
  RbacRole,
  StandaloneHttpPluginRegistrationOptions,
} from 'kanban-lite/sdk'


export type AuthPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

export const NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'noop', provides: ['auth.identity'] },
  async resolveIdentity(_context: AuthContext): Promise<AuthIdentity | null> {
    return null
  },
}

export interface LocalAuthUser {
  username: string
  password: string
  role?: string
}

export interface LocalAuthSession {
  username: string
  expiresAt: number
}

export interface MobileAuthSession {
  username: string
  roles: string[]
  workspaceOrigin: string
  expiresAt: number | null
}

export type AuthConfigSnapshot = Pick<KanbanConfig, 'auth' | 'plugins'>

export const API_TOKEN_ENV_KEYS = ['KANBAN_LITE_TOKEN', 'KANBAN_TOKEN'] as const
export const LOCAL_AUTH_COOKIE = 'kanban_lite_session'
export const LOCAL_AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const AUTH_SESSIONS_FILE = '.auth-sessions.json'
export const MOBILE_SESSIONS_FILE = '.mobile-sessions.json'
export const MOBILE_BOOTSTRAP_FILE = '.mobile-bootstrap-tokens.json'
export const MOBILE_AUTH_CONTRACT = Object.freeze({
  provider: 'local',
  browserLoginTransport: 'cookie-session',
  mobileSessionTransport: 'opaque-bearer',
  sessionKind: 'local-mobile-session-v1',
})
export const DEFAULT_LOCAL_AUTH_ROLES = ['user', 'manager', 'admin'] as const
export const AUTH_PLUGIN_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

import { RBAC_ROLE_MATRIX } from './auth-rbac'

export function getDefaultLocalAuthRoles(): string[] {
  return [...DEFAULT_LOCAL_AUTH_ROLES]
}

export function getConfiguredAuthRoles(sdk?: KanbanSDK): string[] {
  const configSnapshot = typeof sdk?.getConfigSnapshot === 'function'
    ? sdk.getConfigSnapshot()
    : undefined
  const roles = normalizeStringList(
    configSnapshot?.plugins?.['auth.identity']?.options?.roles,
  )
  return roles ?? getDefaultLocalAuthRoles()
}

export function createAuthIdentityOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apiToken: {
          type: 'string',
          title: 'API token',
          description: 'Optional explicit bearer token. When omitted, the provider falls back to KANBAN_LITE_TOKEN or KANBAN_TOKEN.',
        },
        roles: {
          type: 'array',
          title: 'Roles',
          description: 'Reusable role catalog for local users. Defaults to user, manager, and admin, and you can add or remove more entries.',
          default: getDefaultLocalAuthRoles(),
          items: {
            type: 'string',
            minLength: 1,
            title: 'Role',
          },
        },
        users: {
          type: 'array',
          title: 'Users',
          description: 'Optional standalone login users. Password values remain bcrypt hashes in storage.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['username', 'password'],
            properties: {
              username: {
                type: 'string',
                minLength: 1,
                title: 'Username',
              },
              password: {
                type: 'string',
                minLength: 1,
                title: 'Password hash',
                description: 'Bcrypt password hash used for standalone local login.',
              },
              role: {
                type: 'string',
                title: 'Role',
                description: 'Optional role assigned to the user. After saving the role catalog above, reopen or refresh the provider options to use the updated picker values.',
                enum: async (sdk: KanbanSDK) => getConfiguredAuthRoles(sdk),
              },
            },
          },
        },
      },
    },
    uiSchema: {
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
          label: 'Role catalog',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/roles',
              label: 'Roles',
              options: {
                showSortButtons: true,
              },
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
                    {
                      type: 'Control',
                      scope: '#/properties/username',
                      label: 'Username',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/password',
                      label: 'Password hash',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/role',
                      label: 'Role',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    secrets: [
      { path: 'apiToken', redaction: AUTH_PLUGIN_SECRET_REDACTION },
      { path: 'users.*.password', redaction: AUTH_PLUGIN_SECRET_REDACTION },
    ],
    beforeSave: validateAuthIdentityBeforeSave,
  }
}

/**
 * Validates auth.identity options before they are persisted when the provider
 * is being activated (transitioning from disabled to enabled).
 *
 * Rules enforced on activation:
 *   1. An API token must be configured (either in options or via env var).
 *   2. At least one user must have a role that grants `plugin-settings.update`
 *      (i.e. the `admin` role), so a future session can manage plugin settings
 *      after auth is enforced.
 *
 * The current session is not affected — existing sessions remain valid — but
 * new browser sessions will require credentials.
 */
async function validateAuthIdentityBeforeSave(
  options: Record<string, unknown>,
  context: PluginSettingsBeforeSaveContext,
): Promise<void> {
  // Only enforce on activation. Updating options for an already-active auth
  // provider does not re-trigger the lockout check; the running session stays
  // valid regardless.
  if (!context.isActivating) return

  const maskedValue = AUTH_PLUGIN_SECRET_REDACTION.maskedValue

  // 1. API token must be present (options field or env fallback).
  const optionToken = options.apiToken
  const hasApiTokenInOptions =
    typeof optionToken === 'string' && optionToken.length > 0 && optionToken !== maskedValue
  const hasApiTokenInEnv = API_TOKEN_ENV_KEYS.some(
    (key) => typeof process.env[key] === 'string' && (process.env[key] as string).length > 0,
  )
  if (!hasApiTokenInOptions && !hasApiTokenInEnv) {
    throw new Error(
      'Auth plugin requires an API Token before enabling. ' +
      'Add an apiToken to the options (or set the KANBAN_LITE_TOKEN environment variable) ' +
      'so new sessions can authenticate.',
    )
  }

  // 2. At least one local user must have a role that includes plugin-settings.update.
  const users = Array.isArray(options.users) ? (options.users as Array<Record<string, unknown>>) : []
  const hasAdminUser = users.some((u) => {
    if (!u || typeof u !== 'object') return false
    const role = u['role']
    return (
      typeof role === 'string' &&
      RBAC_ROLE_MATRIX[role as RbacRole]?.has('plugin-settings.update') === true
    )
  })
  if (!hasAdminUser) {
    throw new Error(
      'Auth plugin requires at least one user with admin role (which grants plugin-settings.update permission) ' +
      'before enabling, to ensure a future session can manage plugin settings.',
    )
  }
}

export function loadSessionsFromFile(filePath: string): Map<string, LocalAuthSession> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const now = Date.now()
    const store = new Map<string, LocalAuthSession>()
    for (const [id, session] of Object.entries(parsed)) {
      if (!isRecord(session)) continue
      const { username, expiresAt } = session as { username?: unknown; expiresAt?: unknown }
      if (typeof username !== 'string' || typeof expiresAt !== 'number') continue
      if (expiresAt > now) store.set(id, { username, expiresAt })
    }
    return store
  } catch {
    return new Map()
  }
}

export function persistSessionsToFile(filePath: string, store: Map<string, LocalAuthSession>): void {
  const data: Record<string, LocalAuthSession> = {}
  for (const [id, session] of store) {
    data[id] = session
  }
  fs.promises.writeFile(filePath, JSON.stringify(data), 'utf-8').catch(() => undefined)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function cloneProviderSelection(value: unknown): ProviderRef | null {
  if (!isRecord(value)) return null
  const provider = value.provider
  if (typeof provider !== 'string' || provider.length === 0) return null
  const options = isRecord(value.options) ? { ...value.options } : undefined
  return options ? { provider, options } : { provider }
}

export function getConfigSection(
  config: AuthConfigSnapshot | Record<string, unknown> | null | undefined,
  key: 'auth' | 'plugins',
): Record<string, unknown> | null {
  if (!isRecord(config)) return null
  const section = config[key]
  return isRecord(section) ? section : null
}

export function getAuthProviderSelection(
  config: AuthConfigSnapshot | Record<string, unknown> | null | undefined,
  capability: AuthCapabilityNamespace,
): ProviderRef | null {
  const plugins = getConfigSection(config, 'plugins')
  const auth = getConfigSection(config, 'auth')
  return cloneProviderSelection(plugins?.[capability])
    ?? cloneProviderSelection(auth?.[capability])
}

export function resolveAuthCapabilities(
  options: Pick<StandaloneHttpPluginRegistrationOptions, 'sdk' | 'authCapabilities'>,
): Record<AuthCapabilityNamespace, ProviderRef> {
  const configSnapshot = options.sdk?.getConfigSnapshot()
  if (!configSnapshot) return options.authCapabilities
  return {
    'auth.identity': getAuthProviderSelection(configSnapshot, 'auth.identity') ?? { provider: 'noop' },
    'auth.policy': getAuthProviderSelection(configSnapshot, 'auth.policy') ?? { provider: 'noop' },
    'auth.visibility': getAuthProviderSelection(configSnapshot, 'auth.visibility') ?? { provider: 'none' },
  }
}

export function cloneWritableConfig(
  context: CliPluginContext,
): Promise<Record<string, unknown>> {
  const snapshot = context.sdk?.getConfigSnapshot()
  if (snapshot) {
    return Promise.resolve(structuredClone(snapshot) as Record<string, unknown>)
  }

  const cfgPath = path.join(context.workspaceRoot, '.kanban.json')
  return fs.promises.readFile(cfgPath, 'utf-8')
    .then((raw) => JSON.parse(raw) as Record<string, unknown>)
    .catch(() => ({}))
}

export function getWritableUsers(provider: ProviderRef | null): Array<{ username: string; password: string; role?: string }> {
  const users = provider?.options?.users
  return Array.isArray(users)
    ? structuredClone(users as Array<{ username: string; password: string; role?: string }>)
    : []
}

export function getWritableRoles(provider: ProviderRef | null): string[] {
  return normalizeStringList(provider?.options?.roles) ?? getDefaultLocalAuthRoles()
}

export function normalizeToken(token?: string): string | null {
  if (!token) return null
  return token.startsWith('Bearer ') ? token.slice(7) : token
}

export function getConfiguredApiToken(): string | null {
  for (const key of API_TOKEN_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function cloneIdentity(identity: AuthIdentity): AuthIdentity {
  return {
    subject: identity.subject,
    ...(Array.isArray(identity.roles) ? { roles: [...identity.roles] } : {}),
    ...(Array.isArray(identity.groups) ? { groups: [...identity.groups] } : {}),
  }
}

export function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? [...new Set(entries)] : undefined
}

export function normalizeOptionalRole(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function resolveLocalIdentity(context: AuthContext): AuthIdentity | null {
  if (context.identity) return cloneIdentity(context.identity)

  const token = normalizeToken(context.token)
  const configuredToken = getConfiguredApiToken()
  if (token && configuredToken && safeTokenEquals(token, configuredToken)) {
    return { subject: context.actorHint ?? 'api-token' }
  }

  if (context.actorHint) {
    return { subject: context.actorHint }
  }

  return null
}

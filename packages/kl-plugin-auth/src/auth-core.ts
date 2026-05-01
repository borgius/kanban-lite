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

export interface LocalAuthToken {
  /** Opaque bearer token value. */
  token: string
  /**
   * Optional role for this token. When omitted the token grants unrestricted
   * access; when set, RBAC permission checks apply just as they would for a
   * user carrying that role.
   */
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
    configSnapshot?.plugins?.['auth.identity']?.options?.roles
    ?? configSnapshot?.auth?.['auth.identity']?.options?.roles,
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
          description: 'Single global bearer token. When omitted, the provider falls back to KANBAN_LITE_TOKEN or KANBAN_TOKEN. Use the Tokens array below for role-scoped tokens.',
        },
        tokens: {
          type: 'array',
          title: 'API Tokens',
          description: 'Named bearer tokens with optional role-based access. A token without a role grants unrestricted access; a token with a role is subject to the same permission checks as a user carrying that role.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['token'],
            properties: {
              token: {
                type: 'string',
                minLength: 1,
                title: 'Token',
                description: 'Opaque bearer token value.',
              },
              role: {
                type: 'string',
                title: 'Role',
                description: 'Optional role. When omitted the token grants unrestricted access.',
                enum: async (sdk: KanbanSDK) => getConfiguredAuthRoles(sdk),
              },
            },
          },
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
              label: 'Global API token',
            },
          ],
        },
        {
          type: 'Group',
          label: 'Named API tokens',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/tokens',
              label: 'Tokens',
              options: {
                generateToken: true,
                elementLabelProp: 'token',
                detail: {
                  type: 'HorizontalLayout',
                  elements: [
                    {
                      type: 'Control',
                      scope: '#/properties/token',
                      label: 'Token',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/role',
                      label: 'Role (leave blank for unrestricted access)',
                    },
                  ],
                },
              },
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
      { path: 'tokens.*.token', redaction: AUTH_PLUGIN_SECRET_REDACTION },
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
 *   1. At least one API token must be configured (apiToken, tokens array, or env var).
 *   2. There must be at least one admin access path (unrestricted global token, a
 *      named token with admin role, or a local user with admin role) so that plugin
 *      settings can still be managed after auth is enforced.
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

  // 1. At least one API token must be present (global apiToken, named token, or env fallback).
  const optionToken = options.apiToken
  const hasApiTokenInOptions =
    typeof optionToken === 'string' && optionToken.length > 0 && optionToken !== maskedValue
  const hasApiTokenInEnv = API_TOKEN_ENV_KEYS.some(
    (key) => typeof process.env[key] === 'string' && (process.env[key] as string).length > 0,
  )
  const namedTokenEntries = (Array.isArray(options.tokens) ? (options.tokens as Array<Record<string, unknown>>) : [])
    .filter((t) => {
      if (!t || typeof t !== 'object') return false
      const tokenVal = (t as Record<string, unknown>).token
      return typeof tokenVal === 'string' && tokenVal.length > 0 && tokenVal !== maskedValue
    })
  if (!hasApiTokenInOptions && !hasApiTokenInEnv && namedTokenEntries.length === 0) {
    throw new Error(
      'Auth plugin requires at least one API token before enabling. ' +
      'Add an apiToken, a named token in the Tokens array, or set the KANBAN_LITE_TOKEN environment variable ' +
      'so API clients can authenticate.',
    )
  }

  // 2. There must be at least one path to admin access so plugin settings remain manageable.
  // A global token (no role) is unrestricted; a named token or user with admin role also qualifies.
  const hasGlobalToken =
    hasApiTokenInOptions ||
    hasApiTokenInEnv ||
    namedTokenEntries.some((t) => !t.role)
  const hasAdminToken = namedTokenEntries.some(
    (t) =>
      typeof t.role === 'string' &&
      RBAC_ROLE_MATRIX[t.role as RbacRole]?.has('plugin-settings.update') === true,
  )
  const users = Array.isArray(options.users) ? (options.users as Array<Record<string, unknown>>) : []
  const hasAdminUser = users.some((u) => {
    if (!u || typeof u !== 'object') return false
    const role = u['role']
    return (
      typeof role === 'string' &&
      RBAC_ROLE_MATRIX[role as RbacRole]?.has('plugin-settings.update') === true
    )
  })
  if (!hasGlobalToken && !hasAdminToken && !hasAdminUser) {
    throw new Error(
      'Auth plugin requires at least one admin access path before enabling — ' +
      'a global (unrestricted) API token, a named token with admin role, or a local user with admin role — ' +
      'to ensure plugin settings can still be managed after auth is enforced.',
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

export function getWritableTokens(provider: ProviderRef | null): Array<{ token: string; role?: string }> {
  const tokens = provider?.options?.tokens
  return Array.isArray(tokens)
    ? structuredClone(tokens as Array<{ token: string; role?: string }>)
    : []
}

/**
 * Normalizes the `tokens` array from plugin options into typed `LocalAuthToken`
 * entries, discarding any malformed or empty entries.
 */
export function normalizeConfiguredTokens(options: Record<string, unknown> | null | undefined): LocalAuthToken[] {
  const tokens = options?.tokens
  if (!Array.isArray(tokens)) return []
  return tokens.flatMap((t) => {
    if (!t || typeof t !== 'object') return []
    const token = (t as Record<string, unknown>).token
    if (typeof token !== 'string' || token.length === 0) return []
    const entry: LocalAuthToken = { token }
    const role = normalizeOptionalRole((t as Record<string, unknown>).role)
    if (role) entry.role = role
    return [entry]
  })
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

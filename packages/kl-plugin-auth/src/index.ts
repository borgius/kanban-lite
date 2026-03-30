import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { compare, hash } from 'bcryptjs'
import type {
  AuthCapabilityNamespace,
  AuthContext,
  AuthDecision,
  AuthErrorCategory,
  AuthIdentity,
  AuthIdentityPlugin,
  AuthPolicyPlugin,
  BeforeEventListenerResponse,
  BeforeEventPayload,
  CliPluginContext,
  EventBus,
  KanbanCliPlugin,
  KanbanSDK,
  KanbanConfig,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  ProviderRef,
  RbacPrincipalEntry,
  RbacRole,
  SDKBeforeEventType,
  SDKEvent,
  SDKEventListener,
  SDKEventListenerPlugin,
  StandaloneHttpHandler,
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
  StandaloneHttpRequestContext,
} from 'kanban-lite/sdk'

export type {
  AuthContext,
  AuthDecision,
  AuthErrorCategory,
  AuthIdentity,
  AuthIdentityPlugin,
  AuthPluginManifest,
  AuthPolicyPlugin,
  BeforeEventListenerResponse,
  BeforeEventPayload,
  CliPluginContext,
  KanbanCliPlugin,
  PluginSettingsOptionsSchemaMetadata,
  ProviderRef,
  RbacPrincipalEntry,
  RbacRole,
  SDKBeforeEventType,
  SDKEvent,
  SDKEventListener,
  SDKEventListenerPlugin,
  StandaloneHttpPlugin,
  StandaloneHttpPluginRegistrationOptions,
} from 'kanban-lite/sdk'

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

type AuthPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

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

interface LocalAuthUser {
  username: string
  password: string
  role?: string
}

type PermissionMatrixSubjectType = 'role' | 'group'

interface PermissionMatrixEntry {
  subjectType: PermissionMatrixSubjectType
  subject: string
  actions: string[]
}

interface LocalAuthSession {
  username: string
  expiresAt: number
}

type AuthConfigSnapshot = Pick<KanbanConfig, 'auth' | 'plugins'>

const API_TOKEN_ENV_KEYS = ['KANBAN_LITE_TOKEN', 'KANBAN_TOKEN'] as const
const LOCAL_AUTH_COOKIE = 'kanban_lite_session'
const LOCAL_AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const AUTH_SESSIONS_FILE = '.auth-sessions.json'
const DEFAULT_LOCAL_AUTH_ROLES = ['user', 'manager', 'admin'] as const
const AUTH_PLUGIN_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

function getDefaultLocalAuthRoles(): string[] {
  return [...DEFAULT_LOCAL_AUTH_ROLES]
}

function getConfiguredAuthRoles(sdk?: KanbanSDK): string[] {
  const configSnapshot = typeof sdk?.getConfigSnapshot === 'function'
    ? sdk.getConfigSnapshot()
    : undefined
  const roles = normalizeStringList(
    configSnapshot?.plugins?.['auth.identity']?.options?.roles,
  )
  return roles ?? getDefaultLocalAuthRoles()
}

async function getAvailableAuthPolicyBeforeEvents(sdk?: KanbanSDK): Promise<string[]> {
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

function createAuthIdentityOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
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
          title: 'Local users',
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
  }
}

function createAuthPolicyOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        permissions: {
          type: 'array',
          title: 'Permission matrix',
          description: 'Optional per-role permission rules. Choose a role from the auth.identity role catalog and the before-events it may run. When omitted, the provider uses its default policy behavior.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['subject', 'actions'],
            properties: {
              subjectType: {
                type: 'string',
                title: 'Subject type',
                enum: ['role', 'group'],
                default: 'role',
              },
              subject: {
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
        },
      },
    },
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
                elementLabelProp: 'subject',
                showSortButtons: true,
                detail: {
                  type: 'VerticalLayout',
                  elements: [
                    {
                      type: 'Control',
                      scope: '#/properties/subject',
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
    },
    secrets: [],
  }
}

const createResolvedAuthPolicyOptionsSchema: AuthPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => {
  if (!sdk) {
    return createAuthPolicyOptionsSchema()
  }

  return createAuthPolicyOptionsSchema()
}

function loadSessionsFromFile(filePath: string): Map<string, LocalAuthSession> {
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

function persistSessionsToFile(filePath: string, store: Map<string, LocalAuthSession>): void {
  const data: Record<string, LocalAuthSession> = {}
  for (const [id, session] of store) {
    data[id] = session
  }
  fs.promises.writeFile(filePath, JSON.stringify(data), 'utf-8').catch(() => undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cloneProviderSelection(value: unknown): ProviderRef | null {
  if (!isRecord(value)) return null
  const provider = value.provider
  if (typeof provider !== 'string' || provider.length === 0) return null
  const options = isRecord(value.options) ? { ...value.options } : undefined
  return options ? { provider, options } : { provider }
}

function getConfigSection(
  config: AuthConfigSnapshot | Record<string, unknown> | null | undefined,
  key: 'auth' | 'plugins',
): Record<string, unknown> | null {
  if (!isRecord(config)) return null
  const section = config[key]
  return isRecord(section) ? section : null
}

function getAuthProviderSelection(
  config: AuthConfigSnapshot | Record<string, unknown> | null | undefined,
  capability: AuthCapabilityNamespace,
): ProviderRef | null {
  const plugins = getConfigSection(config, 'plugins')
  const auth = getConfigSection(config, 'auth')
  return cloneProviderSelection(plugins?.[capability])
    ?? cloneProviderSelection(auth?.[capability])
}

function resolveAuthCapabilities(
  options: Pick<StandaloneHttpPluginRegistrationOptions, 'sdk' | 'authCapabilities'>,
): Record<AuthCapabilityNamespace, ProviderRef> {
  const configSnapshot = options.sdk?.getConfigSnapshot()
  if (!configSnapshot) return options.authCapabilities
  return {
    'auth.identity': getAuthProviderSelection(configSnapshot, 'auth.identity') ?? { provider: 'noop' },
    'auth.policy': getAuthProviderSelection(configSnapshot, 'auth.policy') ?? { provider: 'noop' },
  }
}

function cloneWritableConfig(
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

function getWritableUsers(provider: ProviderRef | null): Array<{ username: string; password: string; role?: string }> {
  const users = provider?.options?.users
  return Array.isArray(users)
    ? structuredClone(users as Array<{ username: string; password: string; role?: string }>)
    : []
}

function getWritableRoles(provider: ProviderRef | null): string[] {
  return normalizeStringList(provider?.options?.roles) ?? getDefaultLocalAuthRoles()
}

function normalizeToken(token?: string): string | null {
  if (!token) return null
  return token.startsWith('Bearer ') ? token.slice(7) : token
}

function getConfiguredApiToken(): string | null {
  for (const key of API_TOKEN_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function cloneIdentity(identity: AuthIdentity): AuthIdentity {
  return {
    subject: identity.subject,
    ...(Array.isArray(identity.roles) ? { roles: [...identity.roles] } : {}),
    ...(Array.isArray(identity.groups) ? { groups: [...identity.groups] } : {}),
  }
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? [...new Set(entries)] : undefined
}

function normalizeOptionalRole(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function parsePermissionMatrixEntries(value: unknown): PermissionMatrixEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const rawSubjectType = (entry as { subjectType?: unknown }).subjectType
    const subject = (entry as { subject?: unknown }).subject
    const actions = normalizeStringList((entry as { actions?: unknown }).actions)
    if (rawSubjectType !== undefined && rawSubjectType !== 'role' && rawSubjectType !== 'group') return []
    if (typeof subject !== 'string') return []
    const subjectType: PermissionMatrixSubjectType = rawSubjectType === 'group' ? 'group' : 'role'
    const normalizedSubject = subject.trim()
    if (normalizedSubject.length === 0 || !actions || actions.length === 0) return []
    return [{ subjectType, subject: normalizedSubject, actions }]
  })
}

function parseLegacyPermissionMatrix(value: unknown): PermissionMatrixEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([role, actions]) => {
    const normalizedRole = role.trim()
    const normalizedActions = normalizeStringList(actions)
    if (normalizedRole.length === 0 || !normalizedActions || normalizedActions.length === 0) return []
    return [{ subjectType: 'role', subject: normalizedRole, actions: normalizedActions }]
  })
}

function resolvePermissionMatrixEntries(options?: Record<string, unknown>): PermissionMatrixEntry[] {
  const configuredEntries = parsePermissionMatrixEntries(options?.permissions)
  if (configuredEntries.length > 0) return configuredEntries
  return parseLegacyPermissionMatrix(options?.matrix)
}

function checkPermissionMatrixPolicy(
  identity: AuthIdentity | null,
  action: string,
  entries: readonly PermissionMatrixEntry[],
): AuthDecision {
  if (!identity) {
    return { allowed: false, reason: 'auth.identity.missing' }
  }

  const roles = new Set(identity.roles ?? [])
  const groups = new Set(identity.groups ?? [])
  for (const entry of entries) {
    const matchesSubject = entry.subjectType === 'role'
      ? roles.has(entry.subject)
      : groups.has(entry.subject)
    if (matchesSubject && entry.actions.includes(action)) {
      return { allowed: true, actor: identity.subject }
    }
  }

  return { allowed: false, reason: 'auth.policy.denied', actor: identity.subject }
}

function resolveLocalIdentity(context: AuthContext): AuthIdentity | null {
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

export const LOCAL_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'local', provides: ['auth.identity'] },
  optionsSchema: createAuthIdentityOptionsSchema,
  async resolveIdentity(context: AuthContext): Promise<AuthIdentity | null> {
    return resolveLocalIdentity(context)
  },
}

export const LOCAL_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'local', provides: ['auth.policy'] },
  optionsSchema: createResolvedAuthPolicyOptionsSchema,
  async checkPolicy(identity: AuthIdentity | null, action: string, _context: AuthContext): Promise<AuthDecision> {
    if (!identity) {
      return { allowed: false, reason: 'auth.identity.missing' }
    }
    void action
    return { allowed: true, actor: identity.subject }
  },
}

function getLocalUsers(options: StandaloneHttpPluginRegistrationOptions): LocalAuthUser[] {
  const users = resolveAuthCapabilities(options)['auth.identity'].options?.users
  if (!Array.isArray(users)) return []
  return users.flatMap((user) => {
    if (!user || typeof user !== 'object') return []
    const username = (user as { username?: unknown }).username
    const password = (user as { password?: unknown }).password
    const role = normalizeOptionalRole((user as { role?: unknown }).role)
    if (typeof username !== 'string' || username.length === 0 || typeof password !== 'string' || password.length === 0) {
      return []
    }
    const entry: LocalAuthUser = { username, password }
    if (role) entry.role = role
    return [entry]
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) return acc
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (!key) return acc
    acc[key] = decodeURIComponent(value)
    return acc
  }, {})
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function redirect(res: import('node:http').ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { Location: location })
  res.end()
}

function setCookie(
  res: import('node:http').ServerResponse,
  name: string,
  value: string,
  attributes: string[],
): void {
  const existing = res.getHeader('Set-Cookie')
  const next = `${name}=${encodeURIComponent(value)}; ${attributes.join('; ')}`
  if (!existing) {
    res.setHeader('Set-Cookie', next)
    return
  }
  res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, next] : [String(existing), next])
}

function clearCookie(res: import('node:http').ServerResponse, name: string): void {
  setCookie(res, name, '', ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'])
}

function normalizeReturnTo(rawValue: string | null | undefined): string {
  if (!rawValue || !rawValue.startsWith('/') || rawValue.startsWith('//')) return '/'
  return rawValue
}

function renderLoginPage(returnTo: string, error?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kanban Lite Login</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #111827; color: #f9fafb; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      form { width: min(420px, calc(100vw - 32px)); background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 24px; box-sizing: border-box; }
      h1 { margin: 0 0 8px; font-size: 1.5rem; }
      p { margin: 0 0 16px; color: #d1d5db; }
      label { display: block; margin: 12px 0 6px; font-weight: 600; }
      input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #4b5563; background: #111827; color: inherit; }
      button { margin-top: 16px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
      .error { margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; background: rgba(220, 38, 38, 0.2); color: #fecaca; }
    </style>
  </head>
  <body>
    <form method="post" action="/auth/login">
      <h1>Sign in</h1>
      <p>Authenticate to open this Kanban Lite workspace.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`
}

async function parseLoginBody(req: import('node:http').IncomingMessage & { _rawBody?: Buffer }): Promise<{ username: string; password: string; returnTo: string }> {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  const rawBody = req._rawBody?.toString('utf-8') ?? ''

  if (contentType.includes('application/json')) {
    const parsed = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {}
    return {
      username: typeof parsed.username === 'string' ? parsed.username : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      returnTo: normalizeReturnTo(typeof parsed.returnTo === 'string' ? parsed.returnTo : '/'),
    }
  }

  const params = new URLSearchParams(rawBody)
  return {
    username: params.get('username') ?? '',
    password: params.get('password') ?? '',
    returnTo: normalizeReturnTo(params.get('returnTo')),
  }
}

const LOCAL_AUTH_PROVIDER_IDS = new Set(['local', 'kl-plugin-auth'])

function isLocalAuthEnabled(options: StandaloneHttpPluginRegistrationOptions): boolean {
  const authCapabilities = resolveAuthCapabilities(options)
  return LOCAL_AUTH_PROVIDER_IDS.has(authCapabilities['auth.identity'].provider)
    || LOCAL_AUTH_PROVIDER_IDS.has(authCapabilities['auth.policy'].provider)
}

export function createStandaloneHttpPlugin(options: StandaloneHttpPluginRegistrationOptions): StandaloneHttpPlugin {
  const authCapabilities = resolveAuthCapabilities(options)
  const localAuthEnabled = isLocalAuthEnabled(options)
  const users = getLocalUsers(options)
  const sessionFilePath = path.join(options.kanbanDir, AUTH_SESSIONS_FILE)
  const sessionStore = loadSessionsFromFile(sessionFilePath)
  const identityOptions = authCapabilities['auth.identity'].options
  const explicitApiToken =
    typeof identityOptions?.apiToken === 'string' && identityOptions.apiToken.length > 0
      ? identityOptions.apiToken
      : null
  const apiToken: string | null = (() => {
    if (!localAuthEnabled) return null
    if (explicitApiToken) return explicitApiToken
    const envToken = getConfiguredApiToken()
    if (envToken) return envToken
    throw new Error(
      'kl-plugin-auth: auth.identity is configured but no API token is available. ' +
      'Set "apiToken" in auth.identity options (e.g. "options": { "apiToken": "..." }) ' +
      'or set the KANBAN_LITE_TOKEN environment variable before starting the server.',
    )
  })()

  const getSessionIdentity = (request: StandaloneHttpRequestContext): AuthIdentity | null => {
    const sessionId = parseCookies(request.req.headers.cookie)[LOCAL_AUTH_COOKIE]
    if (!sessionId) return null
    const session = sessionStore.get(sessionId)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      sessionStore.delete(sessionId)
      persistSessionsToFile(sessionFilePath, sessionStore)
      return null
    }
    const user = users.find((u) => u.username === session.username)
    const identity: AuthIdentity = { subject: session.username }
    if (typeof user?.role === 'string' && user.role.length > 0) identity.roles = [user.role]
    return identity
  }

  const applyRequestIdentity = (request: StandaloneHttpRequestContext): AuthIdentity | null => {
    const authorization = request.req.headers.authorization
    const queryToken = request.url.searchParams.get('token')
    const requestToken = normalizeToken(
      typeof authorization === 'string' ? authorization : queryToken ?? undefined,
    )
    if (requestToken && apiToken && safeTokenEquals(requestToken, apiToken)) {
      const tokenSource = queryToken && requestToken === normalizeToken(queryToken) ? 'query-param' : 'request-header'
      request.mergeAuthContext({
        token: requestToken,
        tokenSource,
        transport: 'http',
        identity: { subject: 'api-token' },
        actorHint: 'api-token',
      })
      return { subject: 'api-token' }
    }

    const sessionIdentity = getSessionIdentity(request)
    if (sessionIdentity) {
      request.mergeAuthContext({
        transport: 'http',
        tokenSource: 'cookie',
        identity: sessionIdentity,
        actorHint: sessionIdentity.subject,
      })
    }
    return sessionIdentity
  }

  return {
    manifest: { id: 'kl-plugin-auth-standalone', provides: ['standalone.http'] },
    registerMiddleware(): readonly StandaloneHttpHandler[] {
      if (!localAuthEnabled) return []
      return [
        async (request: StandaloneHttpRequestContext) => {
          const isPublicAuthRoute = request.pathname === '/auth/login' || request.pathname === '/auth/logout'
          const identity = applyRequestIdentity(request)
          if (identity || isPublicAuthRoute) return false

          if (request.isApiRequest) {
            sendJson(request.res, 401, { ok: false, error: 'Authentication required' })
            return true
          }

          if (request.isPageRequest) {
            const returnTo = normalizeReturnTo(`${request.pathname}${request.url.search}`)
            redirect(request.res, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
            return true
          }

          return false
        },
      ]
    },
    registerRoutes(): readonly StandaloneHttpHandler[] {
      if (!localAuthEnabled) return []
      return [
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('GET', '/auth/login')) return false
          const identity = applyRequestIdentity(request)
          const returnTo = normalizeReturnTo(request.url.searchParams.get('returnTo'))
          if (identity) {
            redirect(request.res, returnTo)
            return true
          }
          request.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          request.res.end(renderLoginPage(returnTo))
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('POST', '/auth/login')) return false
          const { username, password, returnTo } = await parseLoginBody(request.req)
          const user = users.find((candidate) => candidate.username === username)
          const passwordMatches = user ? await compare(password, user.password) : false

          if (!user || !passwordMatches) {
            request.res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
            request.res.end(renderLoginPage(returnTo, 'Invalid username or password.'))
            return true
          }

          const sessionId = crypto.randomBytes(24).toString('hex')
          sessionStore.set(sessionId, {
            username: user.username,
            expiresAt: Date.now() + LOCAL_AUTH_SESSION_TTL_MS,
          })
          persistSessionsToFile(sessionFilePath, sessionStore)
          setCookie(request.res, LOCAL_AUTH_COOKIE, sessionId, [
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            `Max-Age=${Math.floor(LOCAL_AUTH_SESSION_TTL_MS / 1000)}`,
          ])
          redirect(request.res, returnTo)
          return true
        },
        async (request: StandaloneHttpRequestContext) => {
          if (!request.route('POST', '/auth/logout') && !request.route('GET', '/auth/logout')) return false
          const sessionId = parseCookies(request.req.headers.cookie)[LOCAL_AUTH_COOKIE]
          if (sessionId) {
            sessionStore.delete(sessionId)
            persistSessionsToFile(sessionFilePath, sessionStore)
          }
          clearCookie(request.res, LOCAL_AUTH_COOKIE)
          redirect(request.res, '/auth/login')
          return true
        },
      ]
    },
  }
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
  optionsSchema: createResolvedAuthPolicyOptionsSchema,
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
  optionsSchema: createResolvedAuthPolicyOptionsSchema,
  checkPolicy: LOCAL_POLICY_PLUGIN.checkPolicy,
}

/**
 * Factory for a configurable auth policy plugin for `local`, `rbac`, and `kl-plugin-auth` providers.
 *
 * When `options.permissions` is provided it **overrides** the provider's default
 * policy behavior with an explicit permission matrix. The shared settings UI now
 * writes role-based rows and uses the live before-event catalog, while legacy
 * manual `subjectType: "group"` entries and `options.matrix` role maps remain
 * supported for backward compatibility.
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
 *       { "subject": "user", "actions": ["form.submit", "comment.create"] },
 *       { "subject": "admin", "actions": ["board.log.add", "settings.update"] }
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

  return {
    manifest: { id: providerId, provides: ['auth.policy'] },
    optionsSchema: createResolvedAuthPolicyOptionsSchema,
    async checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision> {
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

/**
 * CLI extension contributed by kl-plugin-auth.
 *
 * Registers `kl auth create-user` for adding bcrypt-hashed users to the
 * `plugins["auth.identity"].options.users` array in `.kanban.json`.
 *
 * @example
 * ```sh
 * kl auth create-user --username alice --password s3cr3t
 * kl auth create-user --username admin --password s3cr3t --role admin
 * ```
 */
export const cliPlugin: KanbanCliPlugin = {
  manifest: { id: 'kl-plugin-auth' },
  command: 'auth',
  async run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: CliPluginContext,
  ): Promise<void> {
    const sub = subArgs[0]

    if (sub === 'create-user') {
      const username = flags.username as string | undefined
      const password = flags.password as string | undefined
      const role = normalizeOptionalRole(flags.role)
      if (!username || !password) {
        console.error('Usage: kl auth create-user --username <name> --password <pass> [--role <role>]')
        process.exit(1)
      }

      const cfgPath = path.join(context.workspaceRoot, '.kanban.json')
      const cfg = await cloneWritableConfig(context)

      const plugins =
        typeof cfg.plugins === 'object' && cfg.plugins !== null
          ? (cfg.plugins as Record<string, unknown>)
          : {}
      const existingIdentity = getAuthProviderSelection(cfg, 'auth.identity')
      const identity =
        typeof plugins['auth.identity'] === 'object' && plugins['auth.identity'] !== null
          ? (plugins['auth.identity'] as Record<string, unknown>)
          : { provider: existingIdentity?.provider ?? 'kl-plugin-auth' }
      const options =
        typeof identity.options === 'object' && identity.options !== null
          ? (identity.options as Record<string, unknown>)
          : existingIdentity?.options
            ? structuredClone(existingIdentity.options)
            : {}
      const roles = getWritableRoles(existingIdentity)
      const users = Array.isArray(options.users)
        ? (options.users as { username: string; password: string; role?: string }[])
        : getWritableUsers(existingIdentity)

      if (users.some(u => u.username === username)) {
        console.error(`User "${username}" already exists.`)
        process.exit(1)
      }

      const hashed = await hash(password, 12)
      const newUser: { username: string; password: string; role?: string } = { username, password: hashed }
      if (role) newUser.role = role
      users.push(newUser)
      if (role && !roles.includes(role)) {
        roles.push(role)
      }
      if (roles.length > 0) {
        options.roles = roles
      }
      options.users = users
      identity.options = options
      plugins['auth.identity'] = identity
      cfg.plugins = plugins

      await fs.promises.writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
      console.log(`User "${username}" added.`)
      return
    }

    console.error(`Unknown auth sub-command: ${sub ?? '(none)'}`)
    console.error('Available sub-commands: create-user')
    process.exit(1)
  },
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-auth',
  capabilities: {
    'auth.identity': ['local', 'rbac', 'kl-plugin-auth'] as const,
    'auth.policy': ['local', 'rbac', 'kl-plugin-auth'] as const,
  },
  integrations: ['standalone.http', 'cli', 'event.listener'] as const,
} as const

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, AuthPluginOptionsSchemaFactory> = {
  'kl-plugin-auth': createAuthIdentityOptionsSchema,
  local: createAuthIdentityOptionsSchema,
  rbac: createAuthIdentityOptionsSchema,
}

/** Policy options schemas keyed by provider id for plugin-settings discovery. */
export const policyOptionsSchemas: Record<string, AuthPluginOptionsSchemaFactory> = {
  'kl-plugin-auth': createResolvedAuthPolicyOptionsSchema,
  local: createResolvedAuthPolicyOptionsSchema,
  rbac: createResolvedAuthPolicyOptionsSchema,
}

const authPluginPackage = {
  pluginManifest,
  authIdentityPlugins,
  authPolicyPlugins,
  createAuthIdentityPlugin,
  createAuthPolicyPlugin,
  createStandaloneHttpPlugin,
  createAuthListenerPlugin,
  createLocalAuthListenerPlugin,
  createNoopAuthListenerPlugin,
  createRbacAuthListenerPlugin,
  authListenerPluginFactories,
  optionsSchemas,
  policyOptionsSchemas,
}

export default authPluginPackage

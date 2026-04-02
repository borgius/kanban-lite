import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import * as path from 'path'
import { createRequire } from 'node:module'
import type { ZodRawShape, ZodTypeAny } from 'zod'
import type {
  Card,
  PluginSettingsCapabilityRow,
  PluginSettingsDiscoverySource,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsPayload,
  PluginSettingsProviderRow,
  PluginSettingsReadPayload,
  PluginSettingsRedactedValues,
  PluginSettingsRedactionPolicy,
  PluginSettingsSecretFieldMetadata,
  PluginSettingsSelectedState,
} from '../../shared/types'
import {
  DEFAULT_CONFIG,
  PLUGIN_CAPABILITY_NAMESPACES,
  normalizeCallbackCapabilities,
  configPath,
  normalizeAuthCapabilities,
  normalizeCardStateCapabilities,
  normalizeStorageCapabilities,
  normalizeWebhookCapabilities,
} from '../../shared/config'
import type {
  Webhook,
  CardStateCapabilityNamespace,
  KanbanConfig,
  KLPluginPackageManifest,
  PluginCapabilityNamespace,
  PluginCapabilitySelections,
  ResolvedCapabilities,
  CapabilityNamespace,
  ProviderRef,
  AuthCapabilityNamespace,
  ResolvedAuthCapabilities,
  ResolvedCallbackCapabilities,
  ResolvedWebhookCapabilities,
  ResolvedCardStateCapabilities,
} from '../../shared/config'
import type { AuthContext, AuthDecision, AuthErrorCategory, BeforeEventPayload, SDKBeforeEventType, SDKEventListenerPlugin, SDKExtensionPlugin, SDKExtensionLoaderResult, CardStateBackend, SDKPluginEventDeclaration } from '../types'
import { AuthError } from '../types'
import type { KanbanSDK } from '../KanbanSDK'
import type { StorageEngine } from './types'
import { createLocalFsAttachmentPlugin } from './localfs'
import { createFileBackedCardStateProvider } from './card-state-file'
import { MARKDOWN_PLUGIN } from './markdown'

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs')
)

// ---------------------------------------------------------------------------
// Monorepo workspace root detection
// ---------------------------------------------------------------------------

/**
 * Walks up from `startDir` looking for a `pnpm-workspace.yaml` file that
 * marks the workspace root.  Returns the first matching ancestor directory,
 * or `null` when running outside the monorepo (e.g., after a standalone npm
 * install by a user).
 *
 * @internal
 */
function findWorkspaceRoot(startDir: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * The pnpm workspace root directory, resolved once at module load time.
 *
 * - Inside the monorepo checkout: the absolute path to the repository root
 *   (contains `pnpm-workspace.yaml`).
 * - Outside the monorepo (standalone npm install): `null`.
 *
 * Used by the plugin loader to probe `packages/{name}` as the primary
 * workspace-local resolution path during the staged monorepo migration.
 *
 * @internal
 */
export const WORKSPACE_ROOT: string | null = findWorkspaceRoot(
  path.dirname(
    typeof __filename === 'string' && __filename
      ? __filename
      : path.join(process.cwd(), '__kanban-runtime__.cjs'),
  ),
)

const BUILTIN_CARD_STATE_PROVIDER_IDS = new Set(['localfs'])

// ---------------------------------------------------------------------------
// Auth plugin contracts and built-in noop implementations
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
  readonly provides: readonly AuthCapabilityNamespace[]
}

/**
 * Contract for `auth.identity` capability providers.
 *
 * Resolves an auth context to a typed identity. The shipped `noop` provider
 * always returns `null` (anonymous), preserving the current open-access
 * behavior until a real provider is configured.
 *
 * Token-based identity is the intended future auth mode.
 */
export interface AuthIdentityPlugin {
  readonly manifest: AuthPluginManifest
  /**
   * Optional transport-safe options schema metadata for shared plugin-settings flows.
   *
   * When provided, hosts may surface this in configuration UIs and redact any
   * secret fields according to the accompanying metadata.
   */
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  /**
   * Resolves an auth context to a caller identity, or `null` for
   * anonymous / invalid tokens.
   */
  resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>
}

/**
 * Contract for `auth.policy` capability providers.
 *
 * Determines whether a given identity may perform a named action. The
 * shipped `noop` provider always returns `{ allowed: true }` (allow-all),
 * preserving the current open-access behavior until a real provider is
 * configured.
 */
export interface AuthPolicyPlugin {
  readonly manifest: AuthPluginManifest
  /**
   * Optional transport-safe options schema metadata for shared plugin-settings flows.
   *
   * When provided, hosts may surface this in configuration UIs and redact any
   * secret fields according to the accompanying metadata.
   */
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  /**
   * Returns an {@link AuthDecision} indicating whether `identity` is
   * authorized to perform `action` in the given `context`.
   */
  checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>
}

/** Normalized auth input passed to `auth.visibility` providers. */
export interface AuthVisibilityFilterInput {
  /** Resolved caller identity, or `null` when the caller is anonymous. */
  identity: AuthIdentity | null
  /** Resolved caller roles normalized by the SDK. */
  roles: readonly string[]
  /** Active request-scoped auth context for the read flow. */
  auth: AuthContext
}

/**
 * Contract for `auth.visibility` capability providers.
 *
 * Visibility providers receive the SDK-resolved identity and a normalized role
 * list, then return the visible subset of the provided cards. The capability is
 * opt-in and disabled by default.
 */
export interface AuthVisibilityPlugin {
  readonly manifest: AuthPluginManifest
  /**
   * Optional transport-safe options schema metadata for shared plugin-settings flows.
   *
   * When provided, hosts may surface this in configuration UIs and redact any
   * secret fields according to the accompanying metadata.
   */
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  /** Returns the visible subset of `cards` for the resolved caller. */
  filterVisibleCards(cards: readonly Card[], input: AuthVisibilityFilterInput): Promise<Card[]>
}

/** Module shape supported for external auth provider packages. */
interface AuthPluginModule {
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
  /** Optional factory for a configurable policy plugin. When present it is called with the provider options from `.kanban.json` so plugins can apply per-deployment overrides such as a custom RBAC matrix. */
  readonly createAuthPolicyPlugin?: ((options?: Record<string, unknown>, providerId?: string) => unknown) | unknown
  /** Optional factory for a configurable identity plugin. When present it is called with the provider options from `.kanban.json` so plugins can apply per-deployment overrides such as an explicit API token. */
  readonly createAuthIdentityPlugin?: ((options?: Record<string, unknown>, providerId?: string) => unknown) | unknown
  /** Optional factory for a configurable visibility plugin. When present it is called with the provider options from `.kanban.json` so plugins can apply per-deployment visibility-rule configuration. */
  readonly createAuthVisibilityPlugin?: ((options?: Record<string, unknown>, providerId?: string) => unknown) | unknown
  readonly default?: unknown
}

/** Module shape supported for optional standalone HTTP integrations. */
interface StandaloneHttpPluginModule {
  readonly standaloneHttpPlugin?: unknown
  readonly createStandaloneHttpPlugin?: ((options: StandaloneHttpPluginRegistrationOptions) => unknown) | unknown
  readonly default?: unknown
}

/** Module shape supported for optional SDK extension packs contributed by plugins. */
interface SDKExtensionPluginModule {
  readonly sdkExtensionPlugin?: unknown
  readonly default?: unknown
}

/** Module shape supported for optional MCP tool integrations. */
interface McpPluginModule {
  readonly mcpPlugin?: unknown
}

/** Built-in compatibility no-op identity provider. Always resolves to `null` (anonymous). */
const FALLBACK_NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'noop', provides: ['auth.identity'] },
  async resolveIdentity(_context: AuthContext): Promise<AuthIdentity | null> {
    return null
  },
}

/** Built-in compatibility no-op policy provider. Always returns `{ allowed: true }` (allow-all). */
const FALLBACK_NOOP_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'noop', provides: ['auth.policy'] },
  async checkPolicy(_identity: AuthIdentity | null, _action: string, _context: AuthContext): Promise<AuthDecision> {
    return { allowed: true }
  },
}

// ---------------------------------------------------------------------------
// Webhook provider contract
// ---------------------------------------------------------------------------

/**
 * Contract for `webhook.delivery` capability providers.
 *
 * Owns webhook registry CRUD. Runtime delivery is listener-driven and must be
 * exported separately as `webhookListenerPlugin: SDKEventListenerPlugin` when an
 * external provider wants to own webhook event delivery.
 *
 * External packages (e.g. `kl-plugin-webhook`) must export a compatible
 * implementation as `webhookProviderPlugin` (or as the default export) with a
 * manifest that declares `'webhook.delivery'` in its `provides` array.
 */
export interface WebhookProviderPlugin {
  /** Plugin manifest identifying the provider and the capabilities it provides. */
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /** Lists all registered webhooks for the workspace. */
  listWebhooks(workspaceRoot: string): Webhook[]
  /** Creates and persists a new webhook. Returns the created webhook with its generated id. */
  createWebhook(workspaceRoot: string, input: { url: string; events: string[]; secret?: string }): Webhook
  /** Updates an existing webhook. Returns the updated webhook, or `null` if not found. */
  updateWebhook(
    workspaceRoot: string,
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): Webhook | null
  /** Deletes a webhook by id. Returns `true` if deleted, `false` if not found. */
  deleteWebhook(workspaceRoot: string, id: string): boolean
}

// ---------------------------------------------------------------------------
// Card-state provider contract
// ---------------------------------------------------------------------------

/** Shared plugin manifest shape for `card.state` capability providers. */
export interface CardStateProviderManifest {
  readonly id: string
  readonly provides: readonly CardStateCapabilityNamespace[]
}

/** Opaque JSON-like payload stored for a card-state domain. */
export type CardStateValue = Record<string, unknown>

/** Stable actor/card/domain lookup key used by card-state providers. */
export interface CardStateKey {
  actorId: string
  boardId: string
  cardId: string
  domain: string
}

/** Stored card-state record returned by provider operations. */
export interface CardStateRecord<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt: string
}

/** Write input for card-state domain mutations. */
export interface CardStateWriteInput<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt?: string
}

/** Unread cursor payload persisted by card-state providers. */
export interface CardStateCursor extends Record<string, unknown> {
  cursor: string
  updatedAt?: string
}

/** Lookup key for unread cursor state. */
export interface CardStateUnreadKey {
  actorId: string
  boardId: string
  cardId: string
}

/** Mutation input for marking unread state through a cursor. */
export interface CardStateReadThroughInput extends CardStateUnreadKey {
  cursor: CardStateCursor
}

/** Shared runtime context passed to and exposed for `card.state` providers. */
export interface CardStateModuleContext {
  workspaceRoot: string
  kanbanDir: string
  provider: string
  backend: Exclude<CardStateBackend, 'none'>
  options?: Record<string, unknown>
}

/**
 * Contract for first-class `card.state` capability providers.
 *
 * The core SDK resolves exactly one provider and shares both the provider and a
 * normalized module context with leaf modules so host layers never need
 * backend-specific branching.
 */
export interface CardStateProvider {
  readonly manifest: CardStateProviderManifest
  getCardState(input: CardStateKey): Promise<CardStateRecord | null>
  setCardState(input: CardStateWriteInput): Promise<CardStateRecord>
  getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null>
  markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>>
}

interface CardStateProviderModule {
  readonly cardStateProviders?: Record<string, unknown>
  readonly cardStateProvider?: unknown
  readonly createCardStateProvider?: ((context: CardStateModuleContext) => unknown) | unknown
  readonly default?: unknown
}

/**
 * Principal entry in the runtime-owned RBAC principal registry.
 *
 * Token values and principal entries must remain in host/runtime configuration
 * only. They must never be serialized to `.kanban.json`, included in
 * diagnostics, or echoed in log-safe output.
 */
export interface RbacPrincipalEntry {
  /** Caller subject identifier (e.g. user ID or service account name). */
  subject: string
  /** Assigned RBAC roles (valid values: `'user'`, `'manager'`, `'admin'`). */
  roles: string[]
  /** Optional group memberships resolved alongside the caller roles. */
  groups?: string[]
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

/**
 * Creates a runtime-validated RBAC identity plugin backed by a host-supplied
 * principal registry.
 *
 * Tokens are treated as opaque strings and looked up in `principals`. A token
 * present in the map resolves to the associated principal entry; any token
 * absent from the map resolves to `null` (anonymous / deny). Roles are taken
 * from the registry entry and are never inferred from token text.
 *
 * Token values and principal material — including role assignments — must
 * remain in host/runtime configuration only and must never appear in
 * `.kanban.json`, diagnostics, or log output.
 *
 * @param principals - Map of opaque token → {@link RbacPrincipalEntry}, owned
 *   and populated by the host at startup.
 */
export function createRbacIdentityPlugin(
  principals: ReadonlyMap<string, RbacPrincipalEntry>,
): AuthIdentityPlugin {
  const externalFactory = getBundledAuthCompatExports().createRbacIdentityPlugin
  return externalFactory ? externalFactory(principals) : createFallbackRbacIdentityPlugin(principals)
}

function resolveAuthIdentityPlugin(ref: ProviderRef): AuthIdentityPlugin {
  if (ref.provider === 'noop') return NOOP_IDENTITY_PLUGIN
  if (ref.provider === 'rbac') return RBAC_IDENTITY_PLUGIN
  const packageName = AUTH_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthIdentityPlugin(packageName, ref.provider, ref.options)
}

function resolveAuthPolicyPlugin(ref: ProviderRef): AuthPolicyPlugin {
  if (ref.provider === 'noop') return NOOP_POLICY_PLUGIN
  if (ref.provider === 'rbac') return RBAC_POLICY_PLUGIN
  const packageName = AUTH_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthPolicyPlugin(packageName, ref.provider, ref.options)
}

function resolveAuthVisibilityPlugin(ref: ProviderRef): AuthVisibilityPlugin | null {
  if (ref.provider === 'none') return null
  const packageName = AUTH_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthVisibilityPlugin(packageName, ref.provider, ref.options)
}

// ---------------------------------------------------------------------------
// RBAC action catalog and role matrix (first-cut built-in provider contract)
// ---------------------------------------------------------------------------

/**
 * Canonical role names for the shipped RBAC auth provider.
 *
 * Roles are cumulative: `manager` includes all `user` actions, and `admin`
 * includes all `manager` and `user` actions. The shipped `rbac` provider
 * enforces this matrix at the SDK authorization seam.
 *
 * Host surfaces must never replicate or extend this matrix locally.
 */
export type RbacRole = 'user' | 'manager' | 'admin'

/**
 * Actions available to the `user` role.
 *
 * Covers non-destructive card-interaction operations: form submission,
 * comments, attachments, action triggers, and card-level log writes.
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
 *
 * Adds card lifecycle mutations (create, update, move, transfer, delete),
 * board-action triggers, card-log clearing, and board-level log writes.
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
 *
 * Adds all destructive and configuration operations: board create/update/delete,
 * settings, webhooks, labels, columns, board-action config edits, board-log
 * clearing, migrations, default-board changes, and deleted-card purge.
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
 *
 * Each entry maps to the complete set of canonical action names that the role
 * is permitted to perform. This is the single canonical source of truth consumed
 * by the shipped `rbac` auth provider pair and by host tests that verify denial
 * semantics. Hosts must not replicate or extend this matrix locally.
 *
 * @example
 * // Check whether a resolved role may perform an action:
 * const allowed = RBAC_ROLE_MATRIX['manager'].has('card.create') // true
 * const denied  = RBAC_ROLE_MATRIX['user'].has('board.delete')   // false
 */
export const RBAC_ROLE_MATRIX: Record<RbacRole, ReadonlySet<string>> = {
  user: RBAC_USER_ACTIONS,
  manager: RBAC_MANAGER_ACTIONS,
  admin: RBAC_ADMIN_ACTIONS,
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

function getBundledAuthCompatExports(): BundledAuthCompatExports {
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

// ---------------------------------------------------------------------------
// Plugin manifest and capability interfaces
// ---------------------------------------------------------------------------

/**
 * Manifest describing what capability namespaces a plugin provides.
 */
export interface PluginManifest {
  readonly id: string
  readonly provides: readonly CapabilityNamespace[]
}

/**
 * Built-in adapter interface for `card.storage` capability.
 * Produces a {@link StorageEngine} instance from a kanban directory and optional options.
 */
export interface CardStoragePlugin {
  readonly manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  /** Optional node-host hints used by the extension/server/CLI for local file access and watching. */
  readonly nodeCapabilities?: {
    readonly isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}

/**
 * Built-in adapter interface for `attachment.storage` capability.
 *
 * Wraps file-copy and directory-resolution operations for card attachments.
 * T2 implementations delegate to the active card storage engine; T3+ may
 * extend this with node-only watch/materialization capabilities.
 */
export interface AttachmentStoragePlugin {
  readonly manifest: PluginManifest
  /** Returns the attachment directory for a card, or `null` if not determinable. */
  getCardDir?(card: Card): string | null
  /** Copies `sourcePath` into the attachment directory for `card`. */
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  /**
   * Appends `content` to an existing attachment when the provider can do so
   * efficiently in-place (for example, an object-storage API with native append).
   *
   * Returns `true` when the append was handled by the provider and `false`
   * when callers should fall back to read/modify/write via `copyAttachment`.
   */
  appendAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>
  /**
   * Resolves or materializes a local file path for a named attachment.
   * Returns `null` when the provider cannot expose a safe local file.
   */
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}

/**
 * Standalone HTTP request context exposed to plugin-provided middleware and routes.
 *
 * This standalone-only contract lets plugin packages inspect requests, respond
 * directly, and thread request-scoped auth state into the SDK's existing auth
 * pipeline without depending on Fastify internals.
 */
export interface StandaloneHttpRequestContext {
  /** Active SDK instance backing the standalone runtime. */
  readonly sdk: KanbanSDK
  /** Absolute workspace root containing `.kanban.json`. */
  readonly workspaceRoot: string
  /** Absolute workspace `.kanban` directory. */
  readonly kanbanDir: string
  /** Raw incoming HTTP request. */
  readonly req: http.IncomingMessage
  /** Raw outgoing HTTP response. */
  readonly res: http.ServerResponse
  /** Parsed request URL. */
  readonly url: URL
  /** URL pathname convenience field. */
  readonly pathname: string
  /** Uppercase HTTP method convenience field. */
  readonly method: string
  /** Resolved standalone webview directory. */
  readonly resolvedWebviewDir: string
  /** Loaded standalone `index.html` shell contents. */
  readonly indexHtml: string
  /** Route matcher helper matching the built-in standalone handlers. */
  readonly route: (expectedMethod: string, pattern: string) => Record<string, string> | null
  /** True when the request targets the standalone REST/API surface. */
  readonly isApiRequest: boolean
  /** True when the request is a browser page/navigation request. */
  readonly isPageRequest: boolean
  /** Returns the request-scoped auth context accumulated so far. */
  getAuthContext(): AuthContext
  /** Replaces the request-scoped auth context for downstream handlers. */
  setAuthContext(auth: AuthContext): AuthContext
  /** Shallow-merges request-scoped auth fields for downstream handlers. */
  mergeAuthContext(auth: Partial<AuthContext>): AuthContext
}

/** Request middleware/route handlers return `true` when they fully handled the request. */
export type StandaloneHttpHandler = (request: StandaloneHttpRequestContext) => Promise<boolean>

/**
 * Registration options passed to standalone HTTP plugins after the SDK has
 * resolved the active workspace capability selections.
 */
export interface StandaloneHttpPluginRegistrationOptions {
  /**
   * Active SDK instance backing the standalone runtime, when provided by the host.
   *
   * Plugin registration code may use the full public {@link KanbanSDK} surface,
   * including `getConfigSnapshot()`, when this seam is available.
   */
  readonly sdk?: KanbanSDK
  /** Absolute workspace root containing `.kanban.json`. */
  readonly workspaceRoot: string
  /** Absolute workspace `.kanban` directory. */
  readonly kanbanDir: string
  /** Resolved storage capability selections. */
  readonly capabilities: ResolvedCapabilities
  /** Resolved auth capability selections. */
  readonly authCapabilities: ResolvedAuthCapabilities
  /** Resolved webhook capability selections when webhook plugins are active. */
  readonly webhookCapabilities: ResolvedWebhookCapabilities | null
}

/**
 * Optional standalone-only integration exported by active plugin packages.
 *
 * Packages that already provide another capability (for example `auth.identity`
 * / `auth.policy`) may also contribute request middleware and HTTP routes to the
 * standalone server. Middleware runs before the built-in standalone route table;
 * plugin routes are matched before built-in routes.
 */
export interface StandaloneHttpPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly ['standalone.http'] }
  registerMiddleware?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[]
  registerRoutes?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[]
}

// ---------------------------------------------------------------------------
// MCP plugin registration contract
// ---------------------------------------------------------------------------

/**
 * Runtime context available to MCP tool handlers contributed by plugins.
 *
 * Passed to every registered tool handler by the MCP server during tool
 * invocation.  Intentionally minimal for the first-cut tool-only seam;
 * auth decorators, resource contributions, and lifecycle hooks are deferred.
 */
export interface McpToolContext {
  /** Absolute workspace root containing `.kanban.json`. */
  readonly workspaceRoot: string
  /** Absolute workspace `.kanban` directory. */
  readonly kanbanDir: string
  /** Active SDK instance backing the MCP server runtime. */
  readonly sdk: KanbanSDK
  /** Runs the tool operation with the core MCP auth context installed. */
  runWithAuth<T>(fn: () => Promise<T>): Promise<T>
  /** Maps thrown errors to the canonical MCP `{ content, isError }` response shape. */
  toErrorResult(err: unknown): McpToolResult
}

/** Canonical MCP tool result shape used by plugin-contributed tool handlers. */
export interface McpToolResult {
  readonly [key: string]: unknown
  readonly content: Array<{ type: 'text'; text: string }>
  readonly isError?: boolean
}

/** Minimal zod factory surface required by plugin-contributed MCP tool schemas. */
export interface McpSchemaFactory {
  string(): ZodTypeAny
  array(item: ZodTypeAny): ZodTypeAny
  boolean(): ZodTypeAny
}

/**
 * A single MCP tool definition contributed by a plugin.
 *
 * Tool names must match publicly exposed MCP tool names exactly so that
 * existing MCP client integrations are not broken when a tool is migrated
 * from core to a plugin.
 */
export interface McpToolDefinition {
  /** MCP tool name visible to clients (e.g. `'list_webhooks'`). */
  readonly name: string
  /** Human-readable tool description shown in MCP tool listings. */
  readonly description: string
  /** Lazily builds the tool input schema using the host MCP server's zod instance. */
  readonly inputSchema: (z: McpSchemaFactory) => ZodRawShape
  /**
   * Tool handler invoked by the MCP server when the tool is called.
   * Must return the MCP-standard content array response.
   */
  readonly handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<McpToolResult>
}

/**
 * Narrow MCP registration contract for plugin packages.
 *
 * First-partiy cut: tool contributions only. Pre/post registration hooks,
 * auth decorators, and resource contributions are deferred to follow-up work.
 *
 * Packages that want to own a set of MCP tools (e.g. `kl-plugin-webhook`)
 * can export `mcpPlugin` implementing this interface. The MCP server
 * discovers the export via the same active-package set used by the standalone
 * HTTP discovery path (SPE-06).
 */
export interface McpPluginRegistration {
  /** Plugin manifest identifying this MCP contribution. */
  readonly manifest: { readonly id: string; readonly provides: readonly ['mcp.tools'] }
  /**
   * Called once by the MCP server during tool registration.
   * Returns the complete set of tool definitions this plugin owns.
   */
  registerTools(ctx: McpToolContext): readonly McpToolDefinition[]
}

/**
 * Fully resolved capability bag produced by {@link resolveCapabilityBag}.
 *
 * Passed to the SDK so it no longer branches directly on storage type at call
 * sites; all storage routing is centralised in the plugin layer.
 */
export interface ResolvedCapabilityBag {
  /** Active card storage engine. */
  readonly cardStorage: StorageEngine
  /** Active attachment storage plugin. */
  readonly attachmentStorage: AttachmentStoragePlugin
  /**
   * Raw provider selections used to resolve this bag.
   * Useful for inspection/reporting (e.g. workspace status endpoints).
   */
  readonly providers: ResolvedCapabilities
  /**
   * Whether the active card storage provider stores cards as local files on
   * disk. `true` for markdown, `false` for SQLite and any remote provider.
   *
   * Host layers should check this before setting up file-change watchers or
   * attempting to open card files in a native editor.
   */
  readonly isFileBacked: boolean
  /**
   * Returns the local filesystem path for a card, or `null` if the provider
   * is not file-backed or the card has no associated file.
   *
   * Use this instead of reading `card.filePath` directly so that host code
   * remains forward-compatible with non-file-backed providers.
   */
  getLocalCardPath(card: Card): string | null
  /** Returns the local attachment directory for a card, or `null` when unavailable. */
  getAttachmentDir(card: Card): string | null
  /** Returns a safe local file path for a named attachment, or `null` when unavailable. */
  materializeAttachment(card: Card, attachment: string): Promise<string | null>
  /**
   * Returns the glob pattern (relative to the kanban directory) that host
   * file-watchers should use to observe card changes, or `null` when the
   * provider does not store cards as local files and therefore does not
   * require file-system watching.
   */
  getWatchGlob(): string | null
  /**
   * Resolved `auth.identity` plugin. Defaults to the `noop` compatibility id
   * (always returns `null` / anonymous) when no auth plugin is configured.
    */
  readonly authIdentity: AuthIdentityPlugin
  /** Raw resolved auth provider selections used to resolve auth plugins. */
  readonly authProviders: ResolvedAuthCapabilities
  /**
   * Resolved `auth.policy` plugin. Defaults to the `noop` compatibility id
   * (always returns `true` / allow-all) when no auth plugin is configured.
    */
  readonly authPolicy: AuthPolicyPlugin
  /** Resolved `auth.visibility` plugin, or `null` when visibility filtering is disabled. */
  readonly authVisibility: AuthVisibilityPlugin | null
  /** Resolved `card.state` provider shared across SDK modules and host surfaces. */
  readonly cardState: CardStateProvider
  /** Raw resolved `card.state` provider selection used to resolve card-state capability routing. */
  readonly cardStateProviders: ResolvedCardStateCapabilities
  /** Shared runtime context for the resolved `card.state` provider. */
  readonly cardStateContext: CardStateModuleContext
  /** Resolved event listener plugins. Currently always empty; reserved for future use. */
  /** Resolved event listener plugins. Reserved for future use; currently empty. */
  readonly eventListeners: readonly SDKEventListenerPlugin[]
  /**
   * Resolved webhook delivery provider for CRUD operations, or `null` when the
   * `kl-plugin-webhook` package is not yet installed.
   *
   * This field holds only the registry/persistence capability. Runtime delivery
   * is wired via {@link webhookListener}.
   */
  readonly webhookProvider: WebhookProviderPlugin | null
  /** Raw resolved webhook provider selection used to resolve webhook plugins. */
  readonly webhookProviders: ResolvedWebhookCapabilities | null
  /**
    * Resolved webhook runtime delivery listener, or `null` when no webhook package
    * is installed.
   *
   * Implements {@link SDKEventListenerPlugin} — registered via `register(bus)` at
   * SDK startup to subscribe to after-events and deliver outbound HTTP webhooks.
   */
  readonly webhookListener: SDKEventListenerPlugin | null
  /** Raw resolved callback runtime provider selection used to resolve callback plugins. */
  readonly callbackProviders: ResolvedCallbackCapabilities | null
  /** Resolved same-runtime callback listener for committed event subscriptions. */
  readonly callbackListener: SDKEventListenerPlugin | null
  /** Standalone-only middleware/routes exported by active capability packages. */
  readonly standaloneHttpPlugins: readonly StandaloneHttpPlugin[]
  /**
   * SDK extensions contributed by active plugin packages.
   *
   * Each entry corresponds to one plugin that exported `sdkExtensionPlugin`.
   * Consumed by `KanbanSDK.getExtension(id)` (SPE-02) and the future
   * `sdk.extensions` named-access bag.  Empty when no active plugin exports
   * the optional `sdkExtensionPlugin` field.
   */
  readonly sdkExtensions: readonly SDKExtensionLoaderResult[]
  /**
    * Built-in auth event listener plugin.
   *
   * Establishes the {@link SDKEventListenerPlugin} registration seam for
   * authorization. Active per-before-event auth checking will be wired in T9
   * once `BeforeEventPayload` carries the `AuthContext` and SDK action runners
   * transition away from the `_authorizeAction` path.
   */
  readonly authListener: SDKEventListenerPlugin
}

/**
 * Returns `true` only when the auth configuration permits the stable default
 * single-user card-state actor.
 *
 * Any non-noop `auth.identity` provider disables the fallback, even if the
 * provider later resolves no caller for a specific request.
 */
export function canUseDefaultCardStateActor(
  authCapabilities?: ResolvedAuthCapabilities | null,
): boolean {
  return (authCapabilities?.['auth.identity']?.provider ?? 'noop') === 'noop'
}

function isValidPluginManifest(manifest: unknown, namespace: CapabilityNamespace): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as PluginManifest
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.provides)
    && candidate.provides.includes(namespace)
}

// ---------------------------------------------------------------------------
// Package-level plugin manifest validation
// ---------------------------------------------------------------------------

function isValidPluginPackageManifest(value: unknown): value is KLPluginPackageManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as KLPluginPackageManifest
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (!candidate.capabilities || typeof candidate.capabilities !== 'object') return false
  for (const [, providerIds] of Object.entries(candidate.capabilities)) {
    if (!Array.isArray(providerIds)) return false
    if (!providerIds.every((id: unknown) => typeof id === 'string')) return false
  }
  if (candidate.integrations !== undefined) {
    if (!Array.isArray(candidate.integrations)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Built-in card storage plugins
// ---------------------------------------------------------------------------

/** Registry of built-in card.storage plugins keyed by provider id. */
const BUILTIN_CARD_PLUGINS: ReadonlyMap<string, CardStoragePlugin> = new Map([
  ['localfs', MARKDOWN_PLUGIN],
])

/**
 * Maps short user-facing provider ids to their installable npm package names.
 *
 * The ids `sqlite` and `mysql` are compatibility aliases that keep the familiar
 * user-visible provider id in `.kanban.json` while delegating implementation
 * ownership to standalone, versioned packages. When a provider id is listed
 * here and no built-in implementation is registered, the resolver loads the
 * mapped package name and issues install hints that reference it.
 *
 * Install targets:
 * - `sqlite`     → `npm install kl-plugin-storage-sqlite`
 * - `mysql`      → `npm install kl-plugin-storage-mysql`
 * - `postgresql` → `npm install kl-plugin-storage-postgresql`
 *
 * All packages must export `cardStoragePlugin` and `attachmentStoragePlugin`
 * with CJS entry `dist/index.cjs`.
 */
export const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
])

/**
 * Maps short `card.state` provider ids to their installable npm package names.
 *
 * Card-state is now merged into storage packages. The aliases point to the
 * same packages as `PROVIDER_ALIASES`.
 *
 * External packages must export `createCardStateProvider(context)` or a
 * `cardStateProvider`/`default` object with a manifest that provides
 * `'card.state'`.
 */
export const CARD_STATE_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
])

/**
 * Maps short webhook provider ids to their installable npm package names.
 *
 * - `webhooks` → `npm install kl-plugin-webhook`
 *
 * External packages must export `webhookProviderPlugin` (or a default export)
 * with a manifest that provides `'webhook.delivery'` and CRUD methods.
 */
export const WEBHOOK_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['webhooks', 'kl-plugin-webhook'],
])

/**
 * Maps short callback runtime provider ids to their installable npm package names.
 *
 * - `callbacks` → `npm install kl-plugin-callback`
 */
export const CALLBACK_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['callbacks', 'kl-plugin-callback'],
])

/**
 * Maps built-in auth compatibility ids to the external auth package.
 *
 * - `noop` → `npm install kl-plugin-auth`
 * - `rbac` → `npm install kl-plugin-auth`
 */
export const AUTH_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['noop', 'kl-plugin-auth'],
  ['rbac', 'kl-plugin-auth'],
  ['local', 'kl-plugin-auth'],
])

// ---------------------------------------------------------------------------
// Built-in attachment storage plugins
// ---------------------------------------------------------------------------

/** Set of provider ids that are handled as built-in attachment plugins. */
export const BUILTIN_ATTACHMENT_IDS: ReadonlySet<string> = new Set(['localfs'])

const BUILTIN_ATTACHMENT_PLUGINS: ReadonlyMap<string, (engine: StorageEngine) => AttachmentStoragePlugin> = new Map([
  ['localfs', createLocalFsAttachmentPlugin],
])

function resolveBuiltinAttachmentPlugin(providerName: string, engine: StorageEngine): AttachmentStoragePlugin {
  const pluginFactory = BUILTIN_ATTACHMENT_PLUGINS.get(providerName)
  if (!pluginFactory) {
    throw new Error(`Unsupported built-in attachment storage provider "${providerName}".`)
  }
  return pluginFactory(engine)
}

function normalizeAttachmentName(attachment: string): string | null {
  const normalized = attachment.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/')) return null
  if (path.basename(normalized) !== normalized) return null
  return normalized
}

function materializeAttachmentFromDir(
  getCardDir: ((card: Card) => string | null | undefined) | undefined,
  card: Card,
  attachment: string,
): string | null {
  const safeAttachment = normalizeAttachmentName(attachment)
  if (!safeAttachment) return null
  if (!Array.isArray(card.attachments) || !card.attachments.includes(safeAttachment)) return null
  const cardDir = getCardDir?.(card)
  if (!cardDir) return null
  return path.join(cardDir, safeAttachment)
}

// ---------------------------------------------------------------------------
// External plugin loaders
// ---------------------------------------------------------------------------

function messageIncludesPathHint(message: string, hint: string): boolean {
  const normalizedMessage = message.replace(/\\/g, '/')
  const normalizedHint = hint.replace(/\\/g, '/')
  return normalizedMessage.includes(`'${hint}'`)
    || normalizedMessage.includes(`"${hint}"`)
    || normalizedMessage.includes(hint)
    || normalizedMessage.includes(normalizedHint)
}

function isRecoverableMissingModuleError(err: unknown, ...hints: string[]): err is NodeJS.ErrnoException {
  const code = (err as NodeJS.ErrnoException)?.code
  const message = typeof (err as Error)?.message === 'string' ? (err as Error).message : ''
  return ['MODULE_NOT_FOUND', 'ENOENT', 'ENOTDIR'].includes(code ?? '')
    && hints.some((hint) => hint.length > 0 && messageIncludesPathHint(message, hint))
}

function resolveInstalledModuleEntry(request: string): string | null {
  try {
    return runtimeRequire.resolve(request)
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request, path.join('node_modules', request))) throw err
    return null
  }
}

function isStaleResolvedModuleEntry(resolvedPath: string, err: unknown): boolean {
  if (!isRecoverableMissingModuleError(err, resolvedPath, path.dirname(resolvedPath))) {
    return false
  }
  return !fs.existsSync(resolvedPath) || !fs.existsSync(path.dirname(resolvedPath))
}

/**
 * Tries to load an external plugin from the global npm node_modules directory.
 * The global prefix is derived from the Node.js binary path ({@link process.execPath}).
 * On Unix-like systems the global node_modules directory is `{prefix}/lib/node_modules`;
 * on Windows it is `{prefix}/node_modules`.
 *
 * @internal
 */
function tryLoadGlobalPackage(request: string): unknown {
  const npmPrefix = path.resolve(process.execPath, '..', '..')
  const globalNodeModules = process.platform === 'win32'
    ? path.join(npmPrefix, 'node_modules')
    : path.join(npmPrefix, 'lib', 'node_modules')
  const globalRequire = createRequire(path.join(globalNodeModules, '_kanban_sentinel_.js'))
  return globalRequire(request)
}

export function loadExternalModule(request: string): unknown {
  // 1. Standard npm resolution (installed package or pnpm workspace symlink).
  //    This intentionally takes precedence over the direct monorepo fallback so
  //    tests and consumers can override a workspace package with an installed
  //    copy (for example a temp-installed fixture in node_modules).
  const resolvedInstalledEntry = resolveInstalledModuleEntry(request)
  if (resolvedInstalledEntry) {
    try {
      return runtimeRequire(resolvedInstalledEntry)
    } catch (err: unknown) {
      if (!isStaleResolvedModuleEntry(resolvedInstalledEntry, err)) throw err
    }
  }

  // 2. Workspace-local packages/{request} (monorepo layout — fallback path
  //    during the staged migration before the package is published to npm).
  if (WORKSPACE_ROOT) {
    const workspacePackagePath = path.resolve(WORKSPACE_ROOT, 'packages', request)
    try {
      return runtimeRequire(workspacePackagePath)
    } catch (workspaceErr: unknown) {
      if (!isRecoverableMissingModuleError(workspaceErr, workspacePackagePath)) throw workspaceErr
    }
  }

  // 3. Globally installed npm package (npm install -g ...).
  try {
    return tryLoadGlobalPackage(request)
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request)) throw err
  }

  // 4. Legacy sibling path ../request (backward-compat for non-monorepo
  //    checkouts where plugin repos live as siblings of this repository).
  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  try {
    return runtimeRequire(siblingPackagePath)
  } catch (siblingErr: unknown) {
    if (isRecoverableMissingModuleError(siblingErr, siblingPackagePath)) {
      throw new Error(`Plugin package "${request}" is not installed. Run: npm install ${request}`)
    }
    throw siblingErr
  }
}

type ExternalPluginDiscoverySource = Exclude<PluginSettingsDiscoverySource, 'builtin'>

type PluginSettingsProviderReadModel = PluginSettingsReadPayload & Pick<
  PluginSettingsProviderRow,
  'packageName' | 'discoverySource' | 'optionsSchema'
>

interface ResolvedExternalModule {
  module: unknown
  source: ExternalPluginDiscoverySource
}

interface DiscoveredPluginProvider {
  capability: PluginCapabilityNamespace
  providerId: string
  packageName: string
  discoverySource: PluginSettingsDiscoverySource
  optionsSchema?: PluginSettingsOptionsSchemaMetadata
}

/**
 * Runtime resolver for a dynamic plugin-settings schema value.
 *
 * Plugin authors may use this for any value nested inside `schema` or
 * `uiSchema` when the final value depends on the active SDK runtime.
 * Hosts resolve these functions before sending schema metadata across
 * transports so JSON Forms always receives plain JSON-compatible values.
 */
export type PluginSettingsOptionsSchemaValueResolver<T = unknown> = (
  sdk: KanbanSDK,
  optionsSchema: PluginSettingsOptionsSchemaMetadata,
) => T | Promise<T>

/**
 * Top-level `optionsSchema()` return value supported by the shared resolver.
 *
 * The returned metadata itself may contain nested sync/async resolver
 * functions; those are recursively resolved by
 * {@link resolvePluginSettingsOptionsSchema}.
 */
export type PluginSettingsOptionsSchemaInput =
  | PluginSettingsOptionsSchemaMetadata
  | Promise<PluginSettingsOptionsSchemaMetadata>
  | PluginSettingsOptionsSchemaValueResolver<PluginSettingsOptionsSchemaMetadata>

/** Shared factory signature for plugin package `optionsSchema()` hooks. */
export type PluginSettingsOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaInput

type PluginSettingsConfigSnapshot = Pick<
  KanbanConfig,
  'auth' | 'pluginOptions' | 'plugins' | 'sqlitePath' | 'storageEngine' | 'webhookPlugin'
>

export class PluginSettingsStoreError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'PluginSettingsStoreError'
    this.code = code
    this.details = details
  }
}

const BUILTIN_AUTH_PROVIDER_IDS: ReadonlySet<string> = new Set(['noop'])

const DISCOVERY_SOURCE_PRIORITY: Record<PluginSettingsDiscoverySource, number> = {
  builtin: 5,
  workspace: 4,
  dependency: 3,
  global: 2,
  sibling: 1,
}

const PLUGIN_SETTINGS_SECRET_KEY_PATTERN = /(secret|token|password|passphrase|private[-_]?key|client[-_]?secret|secret[-_]?key|session[-_]?token|api[-_]?key)/i

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord
function isRecord<T extends object>(value: unknown): value is T & UnknownRecord
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPluginSettingsSecretFieldMetadata(value: unknown): value is PluginSettingsSecretFieldMetadata {
  return isRecord<PluginSettingsSecretFieldMetadata>(value)
    && typeof value.path === 'string'
    && value.path.length > 0
    && isRecord(value.redaction)
    && typeof value.redaction.maskedValue === 'string'
    && value.redaction.writeOnly === true
    && Array.isArray(value.redaction.targets)
}

function normalizePluginSettingsOptionsSchema(value: unknown): PluginSettingsOptionsSchemaMetadata | undefined {
  if (!isRecord(value) || !isRecord<PluginSettingsOptionsSchemaMetadata['schema']>(value.schema)) return undefined
  const uiSchema = isRecord(value.uiSchema)
    ? structuredClone(value.uiSchema as unknown as PluginSettingsOptionsSchemaMetadata['uiSchema'])
    : undefined
  const secrets = Array.isArray(value.secrets)
    ? value.secrets.filter(isValidPluginSettingsSecretFieldMetadata)
    : []
  return {
    schema: structuredClone(value.schema) as PluginSettingsOptionsSchemaMetadata['schema'],
    ...(uiSchema ? { uiSchema } : {}),
    secrets,
  }
}

async function resolvePluginSettingsOptionsSchemaNode(
  value: unknown,
  sdk: KanbanSDK,
  optionsSchema: PluginSettingsOptionsSchemaMetadata,
): Promise<unknown> {
  let current = await Promise.resolve(value)

  while (typeof current === 'function') {
    current = await (current as PluginSettingsOptionsSchemaValueResolver)(sdk, optionsSchema)
  }

  if (Array.isArray(current)) {
    const next: unknown[] = []
    for (const entry of current) {
      next.push(await resolvePluginSettingsOptionsSchemaNode(entry, sdk, optionsSchema))
    }
    return next
  }

  if (!isRecord(current)) {
    return current
  }

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(current)) {
    next[key] = await resolvePluginSettingsOptionsSchemaNode(entry, sdk, optionsSchema)
  }
  return next
}

/**
 * Resolves transport-safe plugin-settings metadata from a static object or a
 * dynamic sync/async schema factory.
 *
 * Any nested resolver function found inside `schema`, `uiSchema`, or other
 * metadata fields is awaited before normalization, ensuring downstream host
 * transports and JSON Forms consumers receive plain structured-clone-safe
 * values only.
 */
export async function resolvePluginSettingsOptionsSchema(
  value: unknown,
  sdk: KanbanSDK,
): Promise<PluginSettingsOptionsSchemaMetadata | undefined> {
  const root = {} as PluginSettingsOptionsSchemaMetadata & Record<string, unknown>
  let current = await Promise.resolve(value)

  while (typeof current === 'function') {
    current = await (current as PluginSettingsOptionsSchemaValueResolver)(sdk, root)
  }

  if (!isRecord(current)) return undefined

  for (const [key, entry] of Object.entries(current)) {
    root[key] = await resolvePluginSettingsOptionsSchemaNode(entry, sdk, root)
  }

  return normalizePluginSettingsOptionsSchema(root)
}

function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: structuredClone(ref.options) }
    : { provider: ref.provider }
}

function clonePluginSchemaDefaultValue<T>(value: T): T {
  return structuredClone(value)
}

function applyPluginSchemaDefaultsToData(schemaNode: unknown, dataNode: unknown): unknown {
  if (!isRecord(schemaNode)) return dataNode

  if (dataNode === undefined && Object.prototype.hasOwnProperty.call(schemaNode, 'default')) {
    return clonePluginSchemaDefaultValue(schemaNode.default)
  }

  if (Array.isArray(dataNode)) {
    if (isRecord(schemaNode.items)) {
      return dataNode.map((item) => applyPluginSchemaDefaultsToData(schemaNode.items, item))
    }

    const tupleItems = schemaNode.items
    if (Array.isArray(tupleItems)) {
      return dataNode.map((item, index) => applyPluginSchemaDefaultsToData(tupleItems[index], item))
    }

    return dataNode
  }

  if (!isRecord(dataNode)) return dataNode

  if (isRecord(schemaNode.properties)) {
    for (const [key, childSchema] of Object.entries(schemaNode.properties)) {
      const nextValue = applyPluginSchemaDefaultsToData(childSchema, dataNode[key])
      if (nextValue !== undefined) {
        dataNode[key] = nextValue
      }
    }
  }

  return dataNode
}

function applyPluginSchemaDefaults(
  schema: Record<string, unknown>,
  data: unknown,
): Record<string, unknown> {
  const nextData = isRecord(data) ? structuredClone(data) as Record<string, unknown> : {}
  return applyPluginSchemaDefaultsToData(schema, nextData) as Record<string, unknown>
}

function getPluginSchemaDefaultOptions(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema) return undefined
  const defaultOptions = applyPluginSchemaDefaults(schema, undefined)
  return Object.keys(defaultOptions).length > 0 ? defaultOptions : undefined
}

function readPluginSettingsConfigDocument(workspaceRoot: string): KanbanConfig {
  const filePath = configPath(workspaceRoot)

  let rawText: string
  try {
    rawText = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return structuredClone(DEFAULT_CONFIG)
    }

    throw new PluginSettingsStoreError(
      'plugin-settings-config-load-failed',
      'Unable to read plugin settings from .kanban.json.',
      { configPath: filePath },
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new PluginSettingsStoreError(
      'plugin-settings-config-load-failed',
      'Unable to parse plugin settings from .kanban.json.',
      { configPath: filePath },
    )
  }

  if (!isRecord(parsed)) {
    throw new PluginSettingsStoreError(
      'plugin-settings-config-load-failed',
      'Unable to parse plugin settings from .kanban.json.',
      { configPath: filePath },
    )
  }

  return parsed as unknown as KanbanConfig
}

function writePluginSettingsConfigDocument(workspaceRoot: string, config: KanbanConfig): void {
  const filePath = configPath(workspaceRoot)

  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  } catch {
    throw new PluginSettingsStoreError(
      'plugin-settings-config-save-failed',
      'Unable to save plugin settings to .kanban.json.',
      { configPath: filePath },
    )
  }
}

function ensurePluginSettingsOptionsRecord(
  options: unknown,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> {
  if (isRecord(options)) return structuredClone(options)

  throw new PluginSettingsStoreError(
    'plugin-settings-options-invalid',
    'Plugin option updates must be an object payload.',
    { capability, providerId },
  )
}

function generatePluginSettingsWebhookId(): string {
  return `wh_${crypto.randomBytes(8).toString('hex')}`
}

function normalizeWebhookPluginSettingsOptions(
  currentOptions: Record<string, unknown> | undefined,
  nextOptions: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(nextOptions.webhooks)) return nextOptions

  const currentWebhooks = Array.isArray(currentOptions?.webhooks) ? currentOptions.webhooks : []
  const webhooks = nextOptions.webhooks.map((entry, index) => {
    if (!isRecord(entry)) return entry

    const nextId = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (nextId.length > 0) {
      return nextId === entry.id ? entry : { ...entry, id: nextId }
    }

    const currentEntry = currentWebhooks[index]
    const currentId = isRecord(currentEntry) && typeof currentEntry.id === 'string'
      ? currentEntry.id.trim()
      : ''

    return {
      ...entry,
      id: currentId.length > 0 ? currentId : generatePluginSettingsWebhookId(),
    }
  })

  return {
    ...nextOptions,
    webhooks,
  }
}

function normalizePluginSettingsProviderOptionsForPersistence(
  capability: PluginCapabilityNamespace,
  currentOptions: Record<string, unknown> | undefined,
  nextOptions: Record<string, unknown>,
): Record<string, unknown> {
  if (capability === 'webhook.delivery') {
    return normalizeWebhookPluginSettingsOptions(currentOptions, nextOptions)
  }

  return nextOptions
}

function getMutablePluginsRecord(config: KanbanConfig): PluginCapabilitySelections {
  const existing = isRecord(config.plugins) ? config.plugins : {}
  const nextPlugins: PluginCapabilitySelections = {}

  for (const [key, value] of Object.entries(existing)) {
    if (isRecord(value) && typeof value.provider === 'string') {
      nextPlugins[key as PluginCapabilityNamespace] = {
        provider: value.provider,
        ...(isRecord(value.options) ? { options: structuredClone(value.options) } : {}),
      }
    }
  }

  config.plugins = nextPlugins
  return nextPlugins
}

function getMutablePluginOptionsRecord(config: KanbanConfig): NonNullable<KanbanConfig['pluginOptions']> {
  const existing = isRecord(config.pluginOptions) ? config.pluginOptions : {}
  const nextOptions: NonNullable<KanbanConfig['pluginOptions']> = {}

  for (const [capability, providers] of Object.entries(existing)) {
    if (!isRecord(providers)) continue

    const nextProviders: Record<string, Record<string, unknown>> = {}
    for (const [providerId, options] of Object.entries(providers)) {
      if (isRecord(options)) {
        nextProviders[providerId] = structuredClone(options)
      }
    }

    if (Object.keys(nextProviders).length > 0) {
      nextOptions[capability as PluginCapabilityNamespace] = nextProviders
    }
  }

  config.pluginOptions = nextOptions
  return nextOptions
}

function getCachedPluginProviderOptions(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> | undefined {
  const providers = config.pluginOptions?.[capability]
  if (!isRecord(providers)) return undefined

  const options = providers[providerId]
  return isRecord(options) ? structuredClone(options) : undefined
}

function setCachedPluginProviderOptions(
  config: KanbanConfig,
  capability: PluginCapabilityNamespace,
  providerId: string,
  options: Record<string, unknown> | undefined,
): void {
  const pluginOptions = getMutablePluginOptionsRecord(config)
  const nextProviders = isRecord(pluginOptions[capability])
    ? { ...pluginOptions[capability] }
    : {}

  if (options === undefined) {
    delete nextProviders[providerId]
  } else {
    nextProviders[providerId] = structuredClone(options)
  }

  if (Object.keys(nextProviders).length === 0) {
    delete pluginOptions[capability]
    return
  }

  pluginOptions[capability] = nextProviders
}

function normalizeProviderIdForComparison(
  capability: PluginCapabilityNamespace,
  providerId: string,
): string {
  if (capability === 'card.storage' && providerId === 'markdown') return 'localfs'
  if (capability === 'card.state' && providerId === 'builtin') return 'localfs'
  return providerId
}

function normalizeProviderRefForComparison(
  capability: PluginCapabilityNamespace,
  ref: ProviderRef,
): ProviderRef {
  return {
    provider: normalizeProviderIdForComparison(capability, ref.provider),
    ...(isRecord(ref.options) ? { options: structuredClone(ref.options) } : {}),
  }
}

function providerRefsMatch(
  capability: PluginCapabilityNamespace,
  left: ProviderRef,
  right: ProviderRef,
): boolean {
  const normalizedLeft = normalizeProviderRefForComparison(capability, left)
  const normalizedRight = normalizeProviderRefForComparison(capability, right)

  return normalizedLeft.provider === normalizedRight.provider
    && isDeepStrictEqual(normalizedLeft.options, normalizedRight.options)
}

function pruneEmptyPluginSettingsContainers(config: KanbanConfig): void {
  if (isRecord(config.plugins) && Object.keys(config.plugins).length === 0) {
    delete config.plugins
  }

  if (isRecord(config.pluginOptions) && Object.keys(config.pluginOptions).length === 0) {
    delete config.pluginOptions
  }
}

function pruneRedundantDerivedCardStateConfig(config: KanbanConfig): boolean {
  const configured = config.plugins?.['card.state']
  if (!configured) return false

  const derived = normalizeStorageCapabilities(config)['card.storage']
  if (!providerRefsMatch('card.state', configured, derived)) return false

  const plugins = getMutablePluginsRecord(config)
  delete plugins['card.state']

  setCachedPluginProviderOptions(config, 'card.state', configured.provider, undefined)
  const normalizedConfiguredProvider = normalizeProviderIdForComparison('card.state', configured.provider)
  if (normalizedConfiguredProvider !== configured.provider) {
    setCachedPluginProviderOptions(config, 'card.state', normalizedConfiguredProvider, undefined)
  }

  setCachedPluginProviderOptions(config, 'card.state', derived.provider, undefined)
  pruneEmptyPluginSettingsContainers(config)
  return true
}

function isRedundantDerivedAttachmentStorageConfig(configured: ProviderRef, derived: ProviderRef): boolean {
  const normalizedConfiguredProvider = normalizeProviderIdForComparison('attachment.storage', configured.provider)
  const normalizedDerivedProvider = normalizeProviderIdForComparison('attachment.storage', derived.provider)

  return normalizedConfiguredProvider === normalizedDerivedProvider
    || (normalizedConfiguredProvider === 'localfs' && normalizedDerivedProvider !== 'localfs')
}

function pruneRedundantDerivedAttachmentStorageConfig(config: KanbanConfig): boolean {
  const configured = config.plugins?.['attachment.storage']
  if (!configured) return false

  const derived = normalizeStorageCapabilities(config)['card.storage']
  if (!isRedundantDerivedAttachmentStorageConfig(configured, derived)) return false

  const plugins = getMutablePluginsRecord(config)
  delete plugins['attachment.storage']

  setCachedPluginProviderOptions(config, 'attachment.storage', configured.provider, undefined)
  const normalizedConfiguredProvider = normalizeProviderIdForComparison('attachment.storage', configured.provider)
  if (normalizedConfiguredProvider !== configured.provider) {
    setCachedPluginProviderOptions(config, 'attachment.storage', normalizedConfiguredProvider, undefined)
  }

  setCachedPluginProviderOptions(config, 'attachment.storage', derived.provider, undefined)
  pruneEmptyPluginSettingsContainers(config)
  return true
}

function pruneRedundantDerivedStorageConfig(config: KanbanConfig): boolean {
  const prunedAttachmentStorage = pruneRedundantDerivedAttachmentStorageConfig(config)
  const prunedCardState = pruneRedundantDerivedCardStateConfig(config)
  return prunedAttachmentStorage || prunedCardState
}

function getPersistedPluginProviderOptions(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> | undefined {
  const selectedRef = getSelectedProviderRef(config, capability)
  if (selectedRef?.provider === providerId && isRecord(selectedRef.options)) {
    return structuredClone(selectedRef.options)
  }

  return getCachedPluginProviderOptions(config, capability, providerId)
}

function tokenizePluginSettingsPath(value: string): string[] {
  const tokens: string[] = []
  const pattern = /([^.[\]]+)|\[(\d+)\]/g

  for (const match of value.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2])
  }

  return tokens
}

function matchesSecretPathPattern(pattern: string, currentPath: string): boolean {
  const patternTokens = tokenizePluginSettingsPath(pattern)
  const currentTokens = tokenizePluginSettingsPath(currentPath)

  if (patternTokens.length !== currentTokens.length) return false

  return patternTokens.every((token, index) => token === '*' || token === currentTokens[index])
}

function isSecretPath(patterns: readonly string[], currentPath: string): boolean {
  return patterns.some((pattern) => matchesSecretPathPattern(pattern, currentPath))
}

function getLastPluginSettingsPathToken(currentPath: string): string | null {
  const tokens = tokenizePluginSettingsPath(currentPath)
  return tokens.length > 0 ? tokens[tokens.length - 1] : null
}

function mergeProviderOptionsUpdate(
  currentValue: unknown,
  nextValue: unknown,
  currentPath: string,
  secretPaths: readonly string[],
  redaction: PluginSettingsRedactionPolicy,
): unknown {
  const currentToken = currentPath ? getLastPluginSettingsPathToken(currentPath) : null
  if (currentPath && (isSecretPath(secretPaths, currentPath) || (currentToken !== null && isSecretKeyName(currentToken)))) {
    if (nextValue === undefined || nextValue === redaction.maskedValue) {
      return currentValue === undefined ? undefined : structuredClone(currentValue)
    }
    return structuredClone(nextValue)
  }

  if (Array.isArray(nextValue)) {
    const currentArray = Array.isArray(currentValue) ? currentValue : []
    return nextValue.map((entry, index) => mergeProviderOptionsUpdate(
      currentArray[index],
      entry,
      `${currentPath}[${index}]`,
      secretPaths,
      redaction,
    ))
  }

  if (!isRecord(nextValue)) {
    return structuredClone(nextValue)
  }

  const currentRecord = isRecord(currentValue) ? currentValue : {}
  const merged: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(currentRecord)) {
    merged[key] = structuredClone(entry)
  }

  for (const [key, entry] of Object.entries(nextValue)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key
    const mergedValue = mergeProviderOptionsUpdate(currentRecord[key], entry, childPath, secretPaths, redaction)

    if (mergedValue === undefined) {
      delete merged[key]
      continue
    }

    merged[key] = mergedValue
  }

  return merged
}

function getDiscoveredPluginSettingsProvider(
  inventory: Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>,
  capability: PluginCapabilityNamespace,
  providerId: string,
): DiscoveredPluginProvider {
  const normalizedProviderId = normalizeProviderIdForComparison(capability, providerId)
  if (normalizedProviderId !== providerId) {
    const normalizedProvider = inventory.get(capability)?.get(normalizedProviderId)
    if (normalizedProvider) {
      return { ...normalizedProvider, providerId: normalizedProviderId }
    }
  }

  const provider = inventory.get(capability)?.get(providerId)
  if (provider) return provider

  // Alias fallback: resolve provider aliases (e.g. "local" → kl-plugin-auth)
  const aliasedPackage = resolveExternalPackageName(capability, providerId)
  if (aliasedPackage !== providerId) {
    const byCapability = inventory.get(capability)
    if (byCapability) {
      for (const candidate of byCapability.values()) {
        if (candidate.packageName === aliasedPackage) {
          return { ...candidate, providerId }
        }
      }
    }
  }

  throw new PluginSettingsStoreError(
    'plugin-settings-provider-not-found',
    'The requested plugin provider is not available for this capability.',
    { capability, providerId },
  )
}

function collectNodeModulePackageRequests(nodeModulesDir: string): string[] {
  if (!fs.existsSync(nodeModulesDir)) return []

  const requests = new Set<string>()
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name)
      for (const scopedEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          requests.add(`${entry.name}/${scopedEntry.name}`)
        }
      }
      continue
    }

    requests.add(entry.name)
  }

  return [...requests]
}

function collectWorkspacePackageRequests(): string[] {
  if (!WORKSPACE_ROOT) return []
  const packagesDir = path.join(WORKSPACE_ROOT, 'packages')
  if (!fs.existsSync(packagesDir)) return []

  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function collectSiblingPackageRequests(): string[] {
  const parentDir = path.resolve(process.cwd(), '..')
  if (!fs.existsSync(parentDir)) return []
  const currentDirName = path.basename(process.cwd())

  return fs.readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== currentDirName)
    .filter((entry) => fs.existsSync(path.join(parentDir, entry.name, 'package.json')))
    .map((entry) => entry.name)
}

function getGlobalNodeModulesDir(): string {
  const npmPrefix = path.resolve(process.execPath, '..', '..')
  return process.platform === 'win32'
    ? path.join(npmPrefix, 'node_modules')
    : path.join(npmPrefix, 'lib', 'node_modules')
}

function resolveExternalModuleWithSource(request: string): ResolvedExternalModule {
  if (WORKSPACE_ROOT) {
    const workspacePackagePath = path.resolve(WORKSPACE_ROOT, 'packages', request)
    try {
      return { module: runtimeRequire(workspacePackagePath), source: 'workspace' }
    } catch (workspaceErr: unknown) {
      if (!isRecoverableMissingModuleError(workspaceErr, workspacePackagePath)) throw workspaceErr
    }
  }

  try {
    return { module: runtimeRequire(request), source: 'dependency' }
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request, path.join('node_modules', request))) throw err
  }

  try {
    return { module: tryLoadGlobalPackage(request), source: 'global' }
  } catch (err: unknown) {
    if (!isRecoverableMissingModuleError(err, request)) throw err
  }

  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  try {
    return { module: runtimeRequire(siblingPackagePath), source: 'sibling' }
  } catch (siblingErr: unknown) {
    if (isRecoverableMissingModuleError(siblingErr, siblingPackagePath)) {
      throw new Error(`Plugin package "${request}" is not installed. Run: npm install ${request}`)
    }
    throw siblingErr
  }
}

function tryResolveExternalModuleWithSource(request: string): ResolvedExternalModule | null {
  try {
    return resolveExternalModuleWithSource(request)
  } catch {
    return null
  }
}

function isValidCardStoragePluginCandidate(plugin: unknown): plugin is CardStoragePlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as CardStoragePlugin
  return typeof candidate.createEngine === 'function'
    && isValidPluginManifest(candidate.manifest, 'card.storage')
}

function isValidAttachmentStoragePluginCandidate(plugin: unknown): plugin is AttachmentStoragePlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AttachmentStoragePlugin
  return typeof candidate.copyAttachment === 'function'
    && (typeof candidate.getCardDir === 'function' || typeof candidate.materializeAttachment === 'function')
    && isValidPluginManifest(candidate.manifest, 'attachment.storage')
}

function isValidCardStateProviderCandidate(provider: unknown): provider is CardStateProvider {
  if (!provider || typeof provider !== 'object') return false
  const candidate = provider as CardStateProvider
  return typeof candidate.getCardState === 'function'
    && typeof candidate.setCardState === 'function'
    && typeof candidate.getUnreadCursor === 'function'
    && typeof candidate.markUnreadReadThrough === 'function'
    && typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('card.state')
}

async function getProviderOptionsSchemaCandidate(
  mod: Record<string, unknown>,
  providerId: string,
  directCandidate: unknown,
  sdk: KanbanSDK,
): Promise<PluginSettingsOptionsSchemaMetadata | undefined> {
  if (isRecord(directCandidate) && typeof directCandidate.optionsSchema === 'function') {
    return resolvePluginSettingsOptionsSchema(directCandidate.optionsSchema(sdk), sdk)
  }

  const mappedOptionsSchemas = mod.optionsSchemas
  if (isRecord(mappedOptionsSchemas)) {
    const mappedValue = mappedOptionsSchemas[providerId]
    if (typeof mappedValue === 'function') {
      return resolvePluginSettingsOptionsSchema(mappedValue(sdk), sdk)
    }
    const normalized = await resolvePluginSettingsOptionsSchema(mappedValue, sdk)
    if (normalized) return normalized
  }

  if (typeof mod.optionsSchema === 'function') {
    return resolvePluginSettingsOptionsSchema(mod.optionsSchema(sdk), sdk)
  }

  return undefined
}

function addDiscoveredProvider(
  inventory: Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>,
  provider: DiscoveredPluginProvider,
): void {
  const byCapability = inventory.get(provider.capability) ?? new Map<string, DiscoveredPluginProvider>()
  inventory.set(provider.capability, byCapability)

  const existing = byCapability.get(provider.providerId)
  if (existing && DISCOVERY_SOURCE_PRIORITY[existing.discoverySource] >= DISCOVERY_SOURCE_PRIORITY[provider.discoverySource]) {
    return
  }

  byCapability.set(provider.providerId, provider)
}

function registerBuiltinPluginProviders(
  inventory: Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>,
): void {
  addDiscoveredProvider(inventory, {
    capability: 'card.storage',
    providerId: 'localfs',
    packageName: 'localfs',
    discoverySource: 'builtin',
  })
  addDiscoveredProvider(inventory, {
    capability: 'attachment.storage',
    providerId: 'localfs',
    packageName: 'localfs',
    discoverySource: 'builtin',
  })
  addDiscoveredProvider(inventory, {
    capability: 'card.state',
    providerId: 'localfs',
    packageName: 'localfs',
    discoverySource: 'builtin',
  })
  addDiscoveredProvider(inventory, {
    capability: 'auth.identity',
    providerId: 'noop',
    packageName: 'noop',
    discoverySource: 'builtin',
  })
  addDiscoveredProvider(inventory, {
    capability: 'auth.policy',
    providerId: 'noop',
    packageName: 'noop',
    discoverySource: 'builtin',
  })
}

async function inspectExternalPluginModule(
  request: string,
  resolved: ResolvedExternalModule,
  sdk: KanbanSDK,
): Promise<DiscoveredPluginProvider[]> {
  const mod = resolved.module as Record<string, unknown>
  const discovered: DiscoveredPluginProvider[] = []
  const add = (provider: DiscoveredPluginProvider): void => {
    discovered.push(provider)
  }

  // -----------------------------------------------------------------------
  // Manifest-first discovery — the pluginManifest export is the source of
  // truth.  When present we iterate only declared capabilities, validating
  // the corresponding module exports structurally.
  // -----------------------------------------------------------------------
  const manifest = mod.pluginManifest
  if (isValidPluginPackageManifest(manifest)) {
    const storageBackedAttachmentProviderIds = new Set(manifest.capabilities['card.storage'] ?? [])
    const storageBackedCardStateProviderIds = new Set(manifest.capabilities['card.storage'] ?? [])
    for (const [ns, providerIds] of Object.entries(manifest.capabilities)) {
      const capability = ns as PluginCapabilityNamespace
      for (const providerId of providerIds as readonly string[]) {
        switch (capability) {
          case 'card.storage': {
            const plugin = isValidCardStoragePluginCandidate(mod.cardStoragePlugin)
              ? mod.cardStoragePlugin
              : isValidCardStoragePluginCandidate(mod.default) ? mod.default : null
            if (plugin) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, plugin, sdk),
              })
            }
            break
          }
          case 'attachment.storage': {
            const shouldExposeOptionsSchema = !storageBackedAttachmentProviderIds.has(providerId)
            const plugin = isValidAttachmentStoragePluginCandidate(mod.attachmentStoragePlugin)
              ? mod.attachmentStoragePlugin
              : isValidAttachmentStoragePluginCandidate(mod.default) ? mod.default : null
            if (plugin) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                ...(shouldExposeOptionsSchema
                  ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, plugin, sdk) }
                  : {}),
              })
            }
            break
          }
          case 'auth.identity': {
            if (isRecord(mod.authIdentityPlugins)) {
              const candidate = mod.authIdentityPlugins[providerId]
              if (isValidAuthIdentityPlugin(candidate, providerId)) {
                add({
                  capability, providerId, packageName: request, discoverySource: resolved.source,
                  optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk),
                })
              }
            }
            break
          }
          case 'auth.policy': {
            if (isRecord(mod.authPolicyPlugins)) {
              const candidate = mod.authPolicyPlugins[providerId]
              if (isValidAuthPolicyPlugin(candidate, providerId)) {
                add({
                  capability, providerId, packageName: request, discoverySource: resolved.source,
                  optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk),
                })
              }
            }
            break
          }
          case 'auth.visibility': {
            const candidate = selectAuthVisibilityPlugin(mod as AuthPluginModule, providerId)
            if (candidate) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk),
              })
            }
            break
          }
          case 'webhook.delivery': {
            const directWebhookPlugin = isRecord(mod.webhookProviderPlugin) ? mod.webhookProviderPlugin : mod.default
            if (directWebhookPlugin && isValidWebhookProviderManifest((directWebhookPlugin as WebhookProviderPlugin).manifest)) {
              const provider = directWebhookPlugin as WebhookProviderPlugin
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, provider, sdk),
              })
            }
            break
          }
          case 'callback.runtime': {
            const directListener = isValidSDKEventListenerPlugin(mod.callbackListenerPlugin)
              ? mod.callbackListenerPlugin
              : isSDKEventListenerPluginConstructor(mod.CallbackListenerPlugin)
                ? new mod.CallbackListenerPlugin(process.cwd())
                : isValidSDKEventListenerPlugin(mod.default)
                  ? mod.default
                  : null
            if (directListener) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, directListener, sdk),
              })
            }
            break
          }
          case 'card.state': {
            const shouldExposeOptionsSchema = !storageBackedCardStateProviderIds.has(providerId)
            if (isRecord(mod.cardStateProviders)) {
              const candidate = mod.cardStateProviders[providerId]
              if (isValidCardStateProvider(candidate, providerId)) {
                add({
                  capability, providerId, packageName: request, discoverySource: resolved.source,
                  ...(shouldExposeOptionsSchema
                    ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk) }
                    : {}),
                })
                break
              }
            }
            if (isValidCardStateProviderCandidate(mod.cardStateProvider)) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                ...(shouldExposeOptionsSchema
                  ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, mod.cardStateProvider, sdk) }
                  : {}),
              })
            } else if (typeof mod.createCardStateProvider === 'function') {
              const candidate = (mod.createCardStateProvider as (context: CardStateModuleContext) => unknown)({
                workspaceRoot: process.cwd(),
                kanbanDir: path.join(process.cwd(), '.kanban'),
                provider: request,
                backend: 'external',
              })
              if (isValidCardStateProviderCandidate(candidate)) {
                add({
                  capability, providerId, packageName: request, discoverySource: resolved.source,
                  ...(shouldExposeOptionsSchema
                    ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk) }
                    : {}),
                })
              }
            }
            break
          }
        }
      }
    }
    return discovered
  }

  return discovered
}

function isBuiltinProviderForCapability(capability: PluginCapabilityNamespace, providerId: string): boolean {
  const normalizedProviderId = (() => {
    if (capability === 'card.storage' && providerId === 'markdown') return 'localfs'
    if (capability === 'card.state' && providerId === 'builtin') return 'localfs'
    return providerId
  })()

  switch (capability) {
    case 'card.storage':
      return BUILTIN_CARD_PLUGINS.has(normalizedProviderId)
    case 'attachment.storage':
      return BUILTIN_ATTACHMENT_IDS.has(normalizedProviderId)
    case 'card.state':
      return BUILTIN_CARD_STATE_PROVIDER_IDS.has(normalizedProviderId)
    case 'auth.identity':
    case 'auth.policy':
      return BUILTIN_AUTH_PROVIDER_IDS.has(normalizedProviderId)
    case 'auth.visibility':
      return normalizedProviderId === 'none'
    case 'webhook.delivery':
    case 'callback.runtime':
      return false
  }
}

function resolveExternalPackageName(capability: PluginCapabilityNamespace, providerId: string): string {
  switch (capability) {
    case 'card.storage':
    case 'attachment.storage':
      return PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'card.state':
      return CARD_STATE_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'auth.identity':
    case 'auth.policy':
    case 'auth.visibility':
      return AUTH_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'webhook.delivery':
      return WEBHOOK_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'callback.runtime':
      return CALLBACK_PROVIDER_ALIASES.get(providerId) ?? providerId
  }
}

function isPluginSettingsCapabilityDisabled(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
): boolean {
  return (
    (capability === 'auth.visibility' && config.plugins?.['auth.visibility']?.provider === 'none')
    ||
    (capability === 'webhook.delivery' && config.plugins?.['webhook.delivery']?.provider === 'none')
    || (capability === 'callback.runtime' && config.plugins?.['callback.runtime']?.provider === 'none')
  )
}

function isLikelyPluginPackageRequest(request: string): boolean {
  return /(^|\/|-)plugin(?:-|$)/i.test(request)
}

function collectPluginSettingsPackageRequests(config: PluginSettingsConfigSnapshot): string[] {
  const requests = new Set<string>()
  const add = (request: string | undefined): void => {
    if (request) requests.add(request)
  }
  const addFromBroadScan = (request: string | undefined): void => {
    if (request && isLikelyPluginPackageRequest(request)) requests.add(request)
  }

  for (const request of collectWorkspacePackageRequests()) addFromBroadScan(request)
  for (const request of collectNodeModulePackageRequests(path.join(process.cwd(), 'node_modules'))) addFromBroadScan(request)
  if (WORKSPACE_ROOT && WORKSPACE_ROOT !== process.cwd()) {
    for (const request of collectNodeModulePackageRequests(path.join(WORKSPACE_ROOT, 'node_modules'))) addFromBroadScan(request)
  }
  for (const request of collectNodeModulePackageRequests(getGlobalNodeModulesDir())) addFromBroadScan(request)
  for (const request of collectSiblingPackageRequests()) addFromBroadScan(request)

  for (const request of PROVIDER_ALIASES.values()) add(request)
  for (const request of CARD_STATE_PROVIDER_ALIASES.values()) add(request)
  for (const request of AUTH_PROVIDER_ALIASES.values()) add(request)
  for (const request of WEBHOOK_PROVIDER_ALIASES.values()) add(request)
  for (const request of CALLBACK_PROVIDER_ALIASES.values()) add(request)

  for (const capability of PLUGIN_CAPABILITY_NAMESPACES) {
    const providerRef = config.plugins?.[capability]
    if (providerRef && providerRef.provider !== 'none' && !isBuiltinProviderForCapability(capability, providerRef.provider)) {
      add(resolveExternalPackageName(capability, providerRef.provider))
    }
  }

  if (config.storageEngine !== undefined) {
    add(resolveExternalPackageName('card.storage', normalizeStorageCapabilities(config)['card.storage'].provider))
  }
  if (config.auth?.['auth.identity']) {
    add(resolveExternalPackageName('auth.identity', config.auth['auth.identity'].provider))
  }
  if (config.auth?.['auth.policy']) {
    add(resolveExternalPackageName('auth.policy', config.auth['auth.policy'].provider))
  }
  if (config.auth?.['auth.visibility'] && config.auth['auth.visibility'].provider !== 'none') {
    add(resolveExternalPackageName('auth.visibility', config.auth['auth.visibility'].provider))
  }
  if (config.webhookPlugin?.['webhook.delivery']) {
    add(resolveExternalPackageName('webhook.delivery', config.webhookPlugin['webhook.delivery'].provider))
  }

  return [...requests]
}

async function buildPluginSettingsInventoryCatalog(
  workspaceRoot: string,
  config: PluginSettingsConfigSnapshot,
  sdk: KanbanSDK,
): Promise<Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>> {
  const inventory = new Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>()
  registerBuiltinPluginProviders(inventory)

  for (const request of collectPluginSettingsPackageRequests(config)) {
    const resolved = tryResolveExternalModuleWithSource(request)
    if (!resolved) continue

    try {
      for (const provider of await inspectExternalPluginModule(request, resolved, sdk)) {
        addDiscoveredProvider(inventory, provider)
      }
    } catch {
      // Ignore broken or side-effectful packages discovered during broad inventory
      // scans so one unrelated module cannot prevent valid plugin providers from
      // appearing in shared plugin-settings hosts.
      continue
    }
  }

  return inventory
}

function getCapabilitySelectedState(config: PluginSettingsConfigSnapshot, capability: PluginCapabilityNamespace): PluginSettingsSelectedState {
  if (isPluginSettingsCapabilityDisabled(config, capability)) {
    return {
      capability,
      providerId: null,
      source: 'none',
    }
  }

  switch (capability) {
    case 'card.storage': {
      const selected = normalizeStorageCapabilities(config)['card.storage']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['card.storage']
          ? 'config'
          : config.storageEngine !== undefined
            ? 'legacy'
            : 'default',
      }
    }
    case 'attachment.storage': {
      const selected = normalizeStorageCapabilities(config)['attachment.storage']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['attachment.storage'] ? 'config' : 'default',
      }
    }
    case 'card.state': {
      const selected = normalizeCardStateCapabilities(config)['card.state']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['card.state'] ? 'config' : 'default',
      }
    }
    case 'auth.identity': {
      const selected = normalizeAuthCapabilities(config)['auth.identity']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['auth.identity']
          ? 'config'
          : config.auth?.['auth.identity']
            ? 'legacy'
            : 'default',
      }
    }
    case 'auth.policy': {
      const selected = normalizeAuthCapabilities(config)['auth.policy']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['auth.policy']
          ? 'config'
          : config.auth?.['auth.policy']
            ? 'legacy'
            : 'default',
      }
    }
    case 'auth.visibility': {
      const selected = normalizeAuthCapabilities(config)['auth.visibility']
      return {
        capability,
        providerId: selected.provider === 'none' ? null : selected.provider,
        source: config.plugins?.['auth.visibility']
          ? selected.provider === 'none'
            ? 'none'
            : 'config'
          : config.auth?.['auth.visibility']
            ? 'legacy'
            : 'default',
      }
    }
    case 'webhook.delivery': {
      const selected = normalizeWebhookCapabilities(config)['webhook.delivery']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['webhook.delivery']
          ? 'config'
          : config.webhookPlugin?.['webhook.delivery']
            ? 'legacy'
            : 'default',
      }
    }
    case 'callback.runtime': {
      const selected = normalizeCallbackCapabilities(config)['callback.runtime']
      return {
        capability,
        providerId: selected.provider === 'none' ? null : selected.provider,
        source: config.plugins?.['callback.runtime']
          ? selected.provider === 'none'
            ? 'none'
            : 'config'
          : 'default',
      }
    }
  }
}

function getSelectedProviderRef(config: PluginSettingsConfigSnapshot, capability: PluginCapabilityNamespace): ProviderRef | null {
  if (isPluginSettingsCapabilityDisabled(config, capability)) {
    return null
  }

  switch (capability) {
    case 'card.storage':
      return normalizeStorageCapabilities(config)['card.storage']
    case 'attachment.storage':
      return normalizeStorageCapabilities(config)['attachment.storage']
    case 'card.state':
      return normalizeCardStateCapabilities(config)['card.state']
    case 'auth.identity':
      return normalizeAuthCapabilities(config)['auth.identity']
    case 'auth.policy':
      return normalizeAuthCapabilities(config)['auth.policy']
    case 'auth.visibility': {
      const selected = normalizeAuthCapabilities(config)['auth.visibility']
      return selected.provider === 'none' ? null : selected
    }
    case 'webhook.delivery':
      return normalizeWebhookCapabilities(config)['webhook.delivery']
    case 'callback.runtime': {
      const selected = normalizeCallbackCapabilities(config)['callback.runtime']
      return selected.provider === 'none' ? null : selected
    }
  }
}

function isSecretKeyName(key: string): boolean {
  return PLUGIN_SETTINGS_SECRET_KEY_PATTERN.test(key)
}

function redactProviderOptionsValue(
  value: unknown,
  currentPath: string,
  secretPaths: readonly string[],
  redactedPaths: string[],
  redaction: PluginSettingsRedactionPolicy,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactProviderOptionsValue(
      entry,
      `${currentPath}[${index}]`,
      secretPaths,
      redactedPaths,
      redaction,
    ))
  }

  if (!isRecord(value)) return value

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key
    if (isSecretPath(secretPaths, childPath) || isSecretKeyName(key)) {
      next[key] = redaction.maskedValue
      redactedPaths.push(childPath)
      continue
    }

    next[key] = redactProviderOptionsValue(entry, childPath, secretPaths, redactedPaths, redaction)
  }

  return next
}

function createRedactedProviderOptions(
  options: Record<string, unknown> | undefined,
  optionsSchema: PluginSettingsOptionsSchemaMetadata | undefined,
  redaction: PluginSettingsRedactionPolicy,
): PluginSettingsRedactedValues | null {
  if (options === undefined) return null

  const redactedPaths: string[] = []
  const secretPaths = optionsSchema?.secrets.map((secret) => secret.path) ?? []
  const values = redactProviderOptionsValue(structuredClone(options), '', secretPaths, redactedPaths, redaction)

  return {
    values: isRecord(values) ? values : {},
    redactedPaths,
    redaction,
  }
}

export async function discoverPluginSettingsInventory(
  workspaceRoot: string,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsPayload> {
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  if (pruneRedundantDerivedStorageConfig(config)) {
    writePluginSettingsConfigDocument(workspaceRoot, config)
  }
  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)

  const capabilities: PluginSettingsCapabilityRow[] = PLUGIN_CAPABILITY_NAMESPACES.map((capability) => {
    const selected = getCapabilitySelectedState(config, capability)
    const providers = [...(inventory.get(capability)?.values() ?? [])]
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
      .map<PluginSettingsProviderRow>((provider) => ({
        capability,
        providerId: provider.providerId,
        packageName: provider.packageName,
        discoverySource: provider.discoverySource,
        isSelected: provider.providerId === selected.providerId,
        ...(provider.optionsSchema ? { optionsSchema: provider.optionsSchema } : {}),
      }))

    return { capability, selected, providers }
  })

  return { capabilities, redaction }
}

export async function readPluginSettingsProvider(
  workspaceRoot: string,
  capability: PluginCapabilityNamespace,
  providerId: string,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsProviderReadModel | null> {
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  if (pruneRedundantDerivedStorageConfig(config)) {
    writePluginSettingsConfigDocument(workspaceRoot, config)
  }
  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)
  let provider = inventory.get(capability)?.get(providerId) ?? null

  // Alias fallback: resolve provider aliases (e.g. "local" → kl-plugin-auth)
  if (!provider) {
    const aliasedPackage = resolveExternalPackageName(capability, providerId)
    if (aliasedPackage !== providerId) {
      const byCapability = inventory.get(capability)
      if (byCapability) {
        for (const candidate of byCapability.values()) {
          if (candidate.packageName === aliasedPackage) {
            provider = { ...candidate, providerId }
            break
          }
        }
      }
    }
  }

  if (!provider) return null

  const selected = getCapabilitySelectedState(config, capability)
  const options = createRedactedProviderOptions(
    getPersistedPluginProviderOptions(config, capability, providerId),
    provider.optionsSchema,
    redaction,
  )

  return {
    capability,
    providerId,
    packageName: provider.packageName,
    discoverySource: provider.discoverySource,
    ...(provider.optionsSchema ? { optionsSchema: provider.optionsSchema } : {}),
    selected,
    options,
  }
}

export async function persistPluginSettingsProviderSelection(
  workspaceRoot: string,
  capability: PluginCapabilityNamespace,
  providerId: string,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsProviderReadModel | null> {
  const normalizedProviderId = normalizeProviderIdForComparison(capability, providerId)
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  pruneRedundantDerivedStorageConfig(config)
  const configuredRef = config.plugins?.[capability]
    ? cloneProviderRef(config.plugins[capability])
    : null

  if ((capability === 'auth.visibility' || capability === 'webhook.delivery' || capability === 'callback.runtime') && providerId === 'none') {
    getMutablePluginsRecord(config)[capability] = configuredRef?.options !== undefined
      ? { provider: 'none', options: structuredClone(configuredRef.options) }
      : { provider: 'none' }
    writePluginSettingsConfigDocument(workspaceRoot, config)
    return null
  }

  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)
  const provider = getDiscoveredPluginSettingsProvider(inventory, capability, normalizedProviderId)
  const currentTargetOptions = getPersistedPluginProviderOptions(config, capability, normalizedProviderId)

  const selectedRef = getSelectedProviderRef(config, capability)
  if (selectedRef?.provider && isRecord(selectedRef.options)) {
    setCachedPluginProviderOptions(config, capability, selectedRef.provider, selectedRef.options)
  }

  const cachedTargetOptions = getCachedPluginProviderOptions(config, capability, normalizedProviderId)
  const selectedTargetOptions = selectedRef?.provider === normalizedProviderId && isRecord(selectedRef.options)
    ? structuredClone(selectedRef.options)
    : undefined
  const nextOptions = selectedTargetOptions
    ?? cachedTargetOptions
    ?? (configuredRef?.provider === 'none' && isRecord(configuredRef.options)
      ? structuredClone(configuredRef.options)
      : undefined)
    ?? getPluginSchemaDefaultOptions(
      isRecord(provider.optionsSchema?.schema)
        ? provider.optionsSchema.schema
        : undefined,
    )
  const persistedOptions = nextOptions !== undefined
    ? normalizePluginSettingsProviderOptionsForPersistence(capability, currentTargetOptions, nextOptions)
    : undefined
  const nextRef = {
    provider: normalizedProviderId,
    ...(persistedOptions !== undefined ? { options: persistedOptions } : {}),
  }

  getMutablePluginsRecord(config)[capability] = nextRef
  pruneRedundantDerivedStorageConfig(config)
  writePluginSettingsConfigDocument(workspaceRoot, config)

  const nextProvider = await readPluginSettingsProvider(workspaceRoot, capability, normalizedProviderId, redaction, sdk)
  if (nextProvider) return nextProvider

  throw new PluginSettingsStoreError(
    'plugin-settings-provider-not-found',
    'The requested plugin provider is not available for this capability.',
    { capability, providerId: normalizedProviderId },
  )
}

export async function persistPluginSettingsProviderOptions(
  workspaceRoot: string,
  capability: PluginCapabilityNamespace,
  providerId: string,
  options: unknown,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsProviderReadModel> {
  const normalizedProviderId = normalizeProviderIdForComparison(capability, providerId)
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  pruneRedundantDerivedStorageConfig(config)
  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)
  const provider = getDiscoveredPluginSettingsProvider(inventory, capability, normalizedProviderId)
  const nextOptions = ensurePluginSettingsOptionsRecord(options, capability, providerId)
  const selectedRef = getSelectedProviderRef(config, capability)
  const currentOptions = getPersistedPluginProviderOptions(config, capability, normalizedProviderId)
  const secretPaths = provider.optionsSchema?.secrets.map((secret) => secret.path) ?? []
  const mergedOptions = mergeProviderOptionsUpdate(currentOptions, nextOptions, '', secretPaths, redaction)
  const persistedOptions = normalizePluginSettingsProviderOptionsForPersistence(
    capability,
    currentOptions,
    isRecord(mergedOptions) ? mergedOptions : {},
  )

  setCachedPluginProviderOptions(config, capability, normalizedProviderId, persistedOptions)

  if (selectedRef?.provider === normalizedProviderId) {
    getMutablePluginsRecord(config)[capability] = {
      provider: normalizedProviderId,
      options: persistedOptions,
    }
  }
  pruneRedundantDerivedStorageConfig(config)
  writePluginSettingsConfigDocument(workspaceRoot, config)

  const nextProvider = await readPluginSettingsProvider(workspaceRoot, capability, normalizedProviderId, redaction, sdk)
  if (nextProvider) return nextProvider

  throw new PluginSettingsStoreError(
    'plugin-settings-provider-not-found',
    'The requested plugin provider is not available for this capability.',
    { capability, providerId: normalizedProviderId },
  )
}

function isValidAuthIdentityPlugin(plugin: unknown, providerId: string): plugin is AuthIdentityPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AuthIdentityPlugin
  return typeof candidate.resolveIdentity === 'function'
    && typeof candidate.manifest?.id === 'string'
    && candidate.manifest.id === providerId
    && Array.isArray(candidate.manifest.provides)
    && candidate.manifest.provides.includes('auth.identity')
}

function isValidAuthPolicyPlugin(plugin: unknown, providerId: string): plugin is AuthPolicyPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AuthPolicyPlugin
  return typeof candidate.checkPolicy === 'function'
    && typeof candidate.manifest?.id === 'string'
    && candidate.manifest.id === providerId
    && Array.isArray(candidate.manifest.provides)
    && candidate.manifest.provides.includes('auth.policy')
}

function isValidAuthVisibilityPlugin(plugin: unknown, providerId: string): plugin is AuthVisibilityPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AuthVisibilityPlugin
  return typeof candidate.filterVisibleCards === 'function'
    && typeof candidate.manifest?.id === 'string'
    && candidate.manifest.id === providerId
    && Array.isArray(candidate.manifest.provides)
    && candidate.manifest.provides.includes('auth.visibility')
}

function selectAuthIdentityPlugin(mod: AuthPluginModule, providerId: string): AuthIdentityPlugin | null {
  const mapped = mod.authIdentityPlugins?.[providerId]
  if (isValidAuthIdentityPlugin(mapped, providerId)) return mapped

  const direct = mod.authIdentityPlugin ?? mod.default
  if (isValidAuthIdentityPlugin(direct, providerId)) return direct

  return null
}

function selectAuthPolicyPlugin(mod: AuthPluginModule, providerId: string): AuthPolicyPlugin | null {
  const mapped = mod.authPolicyPlugins?.[providerId]
  if (isValidAuthPolicyPlugin(mapped, providerId)) return mapped

  const direct = mod.authPolicyPlugin ?? mod.default
  if (isValidAuthPolicyPlugin(direct, providerId)) return direct

  return null
}

function selectAuthVisibilityPlugin(mod: AuthPluginModule, providerId: string): AuthVisibilityPlugin | null {
  const mapped = mod.authVisibilityPlugins?.[providerId]
  if (isValidAuthVisibilityPlugin(mapped, providerId)) return mapped

  const direct = mod.authVisibilityPlugin ?? mod.default
  if (isValidAuthVisibilityPlugin(direct, providerId)) return direct

  return null
}

function loadExternalAuthIdentityPlugin(packageName: string, providerId: string, options?: Record<string, unknown>): AuthIdentityPlugin {
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

function loadExternalAuthPolicyPlugin(packageName: string, providerId: string, options?: Record<string, unknown>): AuthPolicyPlugin {
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

function loadExternalAuthVisibilityPlugin(packageName: string, providerId: string, options?: Record<string, unknown>): AuthVisibilityPlugin {
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

function isValidStandaloneHttpPlugin(plugin: unknown): plugin is StandaloneHttpPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as StandaloneHttpPlugin
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('standalone.http')
    && (candidate.registerMiddleware === undefined || typeof candidate.registerMiddleware === 'function')
    && (candidate.registerRoutes === undefined || typeof candidate.registerRoutes === 'function')
}

function isValidSDKPluginEventDeclaration(value: unknown): value is SDKPluginEventDeclaration {
  if (!value || typeof value !== 'object') return false
  const candidate = value as SDKPluginEventDeclaration
  return typeof candidate.event === 'string'
    && candidate.event.length > 0
    && (candidate.phase === 'before' || candidate.phase === 'after')
    && (candidate.resource === undefined || typeof candidate.resource === 'string')
    && (candidate.label === undefined || typeof candidate.label === 'string')
    && (candidate.apiAfter === undefined || typeof candidate.apiAfter === 'boolean')
}

function isValidSDKPluginEventDeclarations(value: unknown): value is readonly SDKPluginEventDeclaration[] {
  return Array.isArray(value) && value.every(isValidSDKPluginEventDeclaration)
}

function isValidSDKExtensionPlugin(plugin: unknown): plugin is SDKExtensionPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as SDKExtensionPlugin
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && typeof candidate.extensions === 'object'
    && candidate.extensions !== null
    && (candidate.events === undefined || isValidSDKPluginEventDeclarations(candidate.events))
}

/**
 * Attempts to load an optional `sdkExtensionPlugin` export from an active
 * package.  Returns `null` silently when the export is absent or does not
 * satisfy the {@link SDKExtensionPlugin} contract so that missing extensions
 * never prevent capability bag resolution.
 *
 * @internal
 */
function tryLoadSDKExtensionPlugin(packageName: string): SDKExtensionLoaderResult | null {
  let mod: SDKExtensionPluginModule
  try {
    mod = loadExternalModule(packageName) as SDKExtensionPluginModule
  } catch {
    return null
  }
  const candidate = mod.sdkExtensionPlugin
  if (!isValidSDKExtensionPlugin(candidate)) return null
  return {
    id: candidate.manifest.id,
    events: candidate.events ?? [],
    extensions: candidate.extensions,
  }
}

function isValidMcpPlugin(plugin: unknown): plugin is McpPluginRegistration {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as McpPluginRegistration
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('mcp.tools')
    && typeof candidate.registerTools === 'function'
}

function tryLoadMcpPlugin(packageName: string): McpPluginRegistration | null {
  let mod: McpPluginModule
  try {
    mod = loadExternalModule(packageName) as McpPluginModule
  } catch (err) {
    if (err instanceof Error && err.message.includes(`Plugin package "${packageName}" is not installed.`)) {
      return null
    }
    throw err
  }

  if (mod.mcpPlugin === undefined) return null
  if (!isValidMcpPlugin(mod.mcpPlugin)) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid mcpPlugin. ` +
      `Expected a named export 'mcpPlugin' with a manifest that provides 'mcp.tools' ` +
      `and a registerTools() method.`
    )
  }

  return mod.mcpPlugin
}

function loadStandaloneHttpPlugin(
  packageName: string,
  options: StandaloneHttpPluginRegistrationOptions,
): StandaloneHttpPlugin | null {
  let mod: StandaloneHttpPluginModule
  try {
    mod = loadExternalModule(packageName) as StandaloneHttpPluginModule
  } catch (err) {
    if (err instanceof Error && err.message.includes(`Plugin package "${packageName}" is not installed.`)) {
      return null
    }
    throw err
  }
  const direct = mod.standaloneHttpPlugin ?? mod.default
  if (isValidStandaloneHttpPlugin(direct)) return direct

  if (typeof mod.createStandaloneHttpPlugin === 'function') {
    const created = mod.createStandaloneHttpPlugin(options)
    if (isValidStandaloneHttpPlugin(created)) return created
    throw new Error(
      `Plugin "${packageName}" exported createStandaloneHttpPlugin() but it did not return ` +
      'a valid standalone HTTP plugin.'
    )
  }

  return null
}

function collectStandaloneHttpPackageNames(
  capabilities: ResolvedCapabilities,
  authCapabilities: ResolvedAuthCapabilities,
  webhookCapabilities: ResolvedWebhookCapabilities | null,
): string[] {
  const packageNames = new Set<string>()
  const add = (packageName: string | undefined): void => {
    if (packageName) packageNames.add(packageName)
  }

  const cardProvider = capabilities['card.storage'].provider
  if (!BUILTIN_CARD_PLUGINS.has(cardProvider)) {
    add(PROVIDER_ALIASES.get(cardProvider) ?? cardProvider)
  }

  const attachmentProvider = capabilities['attachment.storage'].provider
  if (!BUILTIN_ATTACHMENT_IDS.has(attachmentProvider)) {
    add(PROVIDER_ALIASES.get(attachmentProvider) ?? attachmentProvider)
  }

  add(AUTH_PROVIDER_ALIASES.get(authCapabilities['auth.identity'].provider) ?? authCapabilities['auth.identity'].provider)
  add(AUTH_PROVIDER_ALIASES.get(authCapabilities['auth.policy'].provider) ?? authCapabilities['auth.policy'].provider)
  if (authCapabilities['auth.visibility'].provider !== 'none') {
    add(AUTH_PROVIDER_ALIASES.get(authCapabilities['auth.visibility'].provider) ?? authCapabilities['auth.visibility'].provider)
  }

  if (webhookCapabilities) {
    const webhookProvider = webhookCapabilities['webhook.delivery'].provider
    if (webhookProvider !== 'none') {
      add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)
    }
  }

  return [...packageNames]
}

function resolveStandaloneHttpPlugins(
  options: StandaloneHttpPluginRegistrationOptions,
): StandaloneHttpPlugin[] {
  const resolved: StandaloneHttpPlugin[] = []
  for (const packageName of collectStandaloneHttpPackageNames(
    options.capabilities,
    options.authCapabilities,
    options.webhookCapabilities,
  )) {
    const plugin = loadStandaloneHttpPlugin(packageName, options)
    if (plugin) resolved.push(plugin)
  }
  return resolved
}

/**
 * Collects SDK extension contributions from all active external packages by
 * probing each for the optional `sdkExtensionPlugin` named export.
 *
 * @param capabilities        - Resolved storage capability selections.
 * @param authCapabilities    - Resolved auth capability selections.
 * @param webhookCapabilities - Resolved webhook capability selections, or `null`.
 * @returns De-duplicated list of resolved SDK extension entries.
 *
 * @internal
 */
function resolveSDKExtensions(
  capabilities: ResolvedCapabilities,
  authCapabilities: ResolvedAuthCapabilities,
  webhookCapabilities: ResolvedWebhookCapabilities | null,
): SDKExtensionLoaderResult[] {
  const resolved: SDKExtensionLoaderResult[] = []
  const seen = new Set<string>()
  for (const packageName of collectStandaloneHttpPackageNames(capabilities, authCapabilities, webhookCapabilities)) {
    const ext = tryLoadSDKExtensionPlugin(packageName)
    if (ext && !seen.has(ext.id)) {
      seen.add(ext.id)
      resolved.push(ext)
    }
  }
  return resolved
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
  const packageName = 'kl-plugin-auth'

  try {
    const mod = loadExternalModule(packageName) as AuthPluginModule
    const noopIdentity = mod.NOOP_IDENTITY_PLUGIN
    const noopPolicy = mod.NOOP_POLICY_PLUGIN
    const rbacIdentity = mod.RBAC_IDENTITY_PLUGIN
    const rbacPolicy = mod.RBAC_POLICY_PLUGIN
    const userActions = mod.RBAC_USER_ACTIONS
    const managerActions = mod.RBAC_MANAGER_ACTIONS
    const adminActions = mod.RBAC_ADMIN_ACTIONS
    const roleMatrix = mod.RBAC_ROLE_MATRIX

    if (
      !isValidAuthIdentityPlugin(noopIdentity, 'noop')
      || !isValidAuthPolicyPlugin(noopPolicy, 'noop')
      || !isValidAuthIdentityPlugin(rbacIdentity, 'rbac')
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
      createRbacIdentityPlugin: typeof mod.createRbacIdentityPlugin === 'function'
        ? mod.createRbacIdentityPlugin as (principals: ReadonlyMap<string, RbacPrincipalEntry>) => AuthIdentityPlugin
        : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Lazily loads an external npm card-storage plugin.
 * Returns a deterministic, actionable error when the package is not installed
 * rather than letting Node throw a confusing MODULE_NOT_FOUND.
 *
 * @internal
 */
function loadExternalCardPlugin(providerName: string): CardStoragePlugin {
  const mod = loadExternalModule(providerName) as { default?: unknown; cardStoragePlugin?: unknown }

  const plugin = (mod.cardStoragePlugin ?? mod.default) as CardStoragePlugin | undefined
  if (
    !plugin ||
    typeof plugin.createEngine !== 'function' ||
    !isValidPluginManifest(plugin.manifest, 'card.storage')
  ) {
    throw new Error(
      `Plugin "${providerName}" does not export a valid cardStoragePlugin. ` +
      `Expected a named export 'cardStoragePlugin' or default export with a ` +
      `'createEngine' method and a manifest that provides 'card.storage'.`
    )
  }
  return plugin
}

/**
 * Lazily loads an external npm attachment-storage plugin.
 * Returns a deterministic, actionable error when the package is not installed.
 *
 * @internal
 */
function loadExternalAttachmentPlugin(providerName: string): AttachmentStoragePlugin {
  const mod = loadExternalModule(providerName) as { default?: unknown; attachmentStoragePlugin?: unknown }

  const plugin = (mod.attachmentStoragePlugin ?? mod.default) as AttachmentStoragePlugin | undefined
  if (
    !plugin ||
    typeof plugin.copyAttachment !== 'function' ||
    (typeof plugin.getCardDir !== 'function' && typeof plugin.materializeAttachment !== 'function') ||
    !isValidPluginManifest(plugin.manifest, 'attachment.storage')
  ) {
    throw new Error(
      `Plugin "${providerName}" does not export a valid attachmentStoragePlugin. ` +
      `Expected a named export 'attachmentStoragePlugin' or default export with ` +
      `'copyAttachment' plus either 'getCardDir' or 'materializeAttachment', and a manifest that provides ` +
      `'attachment.storage'.`
    )
  }
  return plugin
}

function shouldAttemptSamePluginAttachmentProvider(cardProvider: string, attachmentProvider: string): boolean {
  return attachmentProvider === 'localfs'
    && !BUILTIN_CARD_PLUGINS.has(cardProvider)
    && !BUILTIN_ATTACHMENT_IDS.has(cardProvider)
}

function isRecoverableAttachmentPluginError(providerName: string, err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes(`Attachment storage plugin "${providerName}" is not installed`)
    || err.message.includes(`Plugin "${providerName}" does not export a valid attachmentStoragePlugin`)
}

// ---------------------------------------------------------------------------
// Webhook provider loader
// ---------------------------------------------------------------------------

function isValidWebhookProviderManifest(manifest: unknown): manifest is { readonly id: string; readonly provides: readonly string[] } {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as { id: unknown; provides: unknown }
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.provides)
    && (candidate.provides as unknown[]).includes('webhook.delivery')
}

/**
 * Type guard for {@link SDKEventListenerPlugin} — validates that `plugin` has
 * the `register` / `unregister` lifecycle and a valid manifest.
 *
 * @internal
 */
function isValidSDKEventListenerPlugin(plugin: unknown): plugin is SDKEventListenerPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const p = plugin as SDKEventListenerPlugin
  return typeof p.register === 'function'
    && typeof p.unregister === 'function'
    && typeof p.manifest?.id === 'string'
    && Array.isArray(p.manifest?.provides)
}

function isValidCardStateProviderManifest(
  manifest: unknown,
  providerId: string,
): manifest is CardStateProviderManifest {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as CardStateProviderManifest
  return typeof candidate.id === 'string'
    && candidate.id === providerId
    && Array.isArray(candidate.provides)
    && candidate.provides.includes('card.state')
}

function isValidCardStateProvider(
  provider: unknown,
  providerId: string,
): provider is CardStateProvider {
  if (!provider || typeof provider !== 'object') return false
  const candidate = provider as CardStateProvider
  return typeof candidate.getCardState === 'function'
    && typeof candidate.setCardState === 'function'
    && typeof candidate.getUnreadCursor === 'function'
    && typeof candidate.markUnreadReadThrough === 'function'
    && isValidCardStateProviderManifest(candidate.manifest, providerId)
}

function selectCardStateProvider(mod: CardStateProviderModule, providerId: string): CardStateProvider | null {
  const mapped = mod.cardStateProviders?.[providerId]
  if (isValidCardStateProvider(mapped, providerId)) return mapped

  const direct = mod.cardStateProvider ?? mod.default
  if (isValidCardStateProvider(direct, providerId)) return direct

  return null
}

function createCardStateModuleContext(ref: ProviderRef, kanbanDir: string): CardStateModuleContext {
  const context: CardStateModuleContext = {
    workspaceRoot: path.dirname(kanbanDir),
    kanbanDir,
    provider: ref.provider,
    backend: BUILTIN_CARD_STATE_PROVIDER_IDS.has(ref.provider) ? 'builtin' : 'external',
  }

  if (ref.options) {
    context.options = ref.options
  }

  return context
}

function loadExternalCardStateProvider(
  packageName: string,
  providerId: string,
  context: CardStateModuleContext,
): CardStateProvider {
  const mod = loadExternalModule(packageName) as CardStateProviderModule

  if (typeof mod.createCardStateProvider === 'function') {
    const created = mod.createCardStateProvider(context)
    if (isValidCardStateProvider(created, providerId)) return created
  }

  const provider = selectCardStateProvider(mod, providerId)
  if (!provider) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid cardStateProvider for "${providerId}". ` +
      `Expected cardStateProviders["${providerId}"] or cardStateProvider/default export with ` +
      `getCardState, setCardState, getUnreadCursor, markUnreadReadThrough, and a manifest that provides 'card.state'.`
    )
  }
  return provider
}

function resolveCardStateProvider(
  ref: ProviderRef,
  kanbanDir: string,
): { provider: CardStateProvider; context: CardStateModuleContext } {
  const baseContext = createCardStateModuleContext(ref, kanbanDir)
  if (BUILTIN_CARD_STATE_PROVIDER_IDS.has(ref.provider)) {
    return { provider: createFileBackedCardStateProvider(baseContext), context: baseContext }
  }

  const packageName = CARD_STATE_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  const provider = loadExternalCardStateProvider(packageName, ref.provider, baseContext)
  return {
    provider,
    context: {
      ...baseContext,
      provider: provider.manifest.id,
    },
  }
}

/**
 * Auto-derives card-state from the active storage plugin when no explicit
 * `card.state` provider is configured (or the configured provider is `localfs`).
 *
 * Resolution order:
 * 1. If an explicit non-localfs card-state provider is configured, use it.
 * 2. If the storage provider is external, try loading `createCardStateProvider`
 *    from the storage package.
 * 3. Fall back to the built-in file-backed card-state provider.
 */
function resolveCardStateProviderFromStorage(
  storageRef: ProviderRef,
  explicitCardStateRef: ProviderRef | undefined,
  kanbanDir: string,
): { provider: CardStateProvider; context: CardStateModuleContext } {
  // 1. Explicit non-localfs card-state provider configured — honour it.
  if (explicitCardStateRef && !BUILTIN_CARD_STATE_PROVIDER_IDS.has(explicitCardStateRef.provider)) {
    return resolveCardStateProvider(explicitCardStateRef, kanbanDir)
  }

  // 2. External storage — try loading card-state from the same package.
  if (storageRef.provider !== 'localfs') {
    const storagePackageName = PROVIDER_ALIASES.get(storageRef.provider) ?? storageRef.provider
    const context: CardStateModuleContext = {
      workspaceRoot: path.dirname(kanbanDir),
      kanbanDir,
      provider: storageRef.provider,
      backend: 'external',
      options: storageRef.options,
    }
    try {
      const provider = loadExternalCardStateProvider(storagePackageName, storageRef.provider, context)
      return {
        provider,
        context: { ...context, provider: provider.manifest.id },
      }
    } catch {
      // Storage package doesn't export card-state — fall through to builtin.
    }
  }

  // 3. Fall back to built-in file-backed provider.
  const builtinRef: ProviderRef = { provider: 'localfs' }
  const builtinContext = createCardStateModuleContext(builtinRef, kanbanDir)
  return { provider: createFileBackedCardStateProvider(builtinContext), context: builtinContext }
}

/** @internal Shape of a loaded webhook provider package module. */
interface WebhookProviderModule {
  webhookProviderPlugin?: unknown
  webhookListenerPlugin?: unknown
  WebhookListenerPlugin?: unknown
  default?: unknown
}

/** @internal Shape of a loaded callback runtime package module. */
interface CallbackRuntimeModule {
  callbackListenerPlugin?: unknown
  CallbackListenerPlugin?: unknown
  default?: unknown
}

/** @internal Combined result of loading a webhook package. */
interface WebhookPluginPack {
  provider: WebhookProviderPlugin
  /** Direct `SDKEventListenerPlugin` export when the package provides one. */
  listener?: SDKEventListenerPlugin
}

interface SDKEventListenerPluginConstructor {
  new (workspaceRoot: string): SDKEventListenerPlugin
}

function isSDKEventListenerPluginConstructor(value: unknown): value is SDKEventListenerPluginConstructor {
  return typeof value === 'function'
}

/**
 * Lazily loads an external npm webhook provider plugin.
 *
 * Accepts packages that export:
 * - `webhookProviderPlugin` (or a default): CRUD webhook provider.
 * - `webhookListenerPlugin` (optional): a {@link SDKEventListenerPlugin} for
 *   runtime delivery.
 * - `WebhookListenerPlugin` (optional): a class export constructed with the
 *   workspace root when the runtime listener needs workspace-local config.
 *
 * Returns a deterministic, actionable error when the package is not installed
 * or does not export the expected shape.
 *
 * @internal
 */
function loadWebhookPluginPack(providerName: string, workspaceRoot: string): WebhookPluginPack {
  const mod = loadExternalModule(providerName) as WebhookProviderModule

  const rawProvider = (mod.webhookProviderPlugin ?? mod.default) as WebhookProviderPlugin | undefined
  if (
    !rawProvider ||
    typeof rawProvider.listWebhooks !== 'function' ||
    typeof rawProvider.createWebhook !== 'function' ||
    typeof rawProvider.updateWebhook !== 'function' ||
    typeof rawProvider.deleteWebhook !== 'function' ||
    !isValidWebhookProviderManifest(rawProvider.manifest)
  ) {
    throw new Error(
      `Plugin "${providerName}" does not export a valid webhookProviderPlugin. ` +
      `Expected a named export 'webhookProviderPlugin' or default export with ` +
      `CRUD methods (listWebhooks, createWebhook, updateWebhook, deleteWebhook) ` +
      `and a manifest that provides 'webhook.delivery'.`
    )
  }

  const directListener = isValidSDKEventListenerPlugin(mod.webhookListenerPlugin)
    ? mod.webhookListenerPlugin
    : isSDKEventListenerPluginConstructor(mod.WebhookListenerPlugin)
      ? mod.WebhookListenerPlugin
      : undefined

  if (isSDKEventListenerPluginConstructor(directListener)) {
    return { provider: rawProvider, listener: new directListener(workspaceRoot) }
  }

  return { provider: rawProvider, listener: directListener }
}

function loadCallbackRuntimeListener(providerName: string, workspaceRoot: string): SDKEventListenerPlugin {
  const mod = loadExternalModule(providerName) as CallbackRuntimeModule

  const directListener = isSDKEventListenerPluginConstructor(mod.CallbackListenerPlugin)
    ? mod.CallbackListenerPlugin
    : isValidSDKEventListenerPlugin(mod.callbackListenerPlugin)
      ? mod.callbackListenerPlugin
      : isValidSDKEventListenerPlugin(mod.default)
        ? mod.default
        : undefined

  if (isSDKEventListenerPluginConstructor(directListener)) {
    return new directListener(workspaceRoot)
  }

  if (directListener) {
    return directListener
  }

  throw new Error(
    `Plugin "${providerName}" does not export a valid callback runtime listener. ` +
    `Expected a named export 'callbackListenerPlugin', 'CallbackListenerPlugin', ` +
    `or default export implementing register/unregister with an event-listener manifest.`
  )
}

function resolveCallbackRuntimeListener(
  ref: ProviderRef,
  workspaceRoot: string,
): SDKEventListenerPlugin | null {
  if (ref.provider === 'none') {
    return null
  }

  const packageName = CALLBACK_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  try {
    return loadCallbackRuntimeListener(packageName, workspaceRoot)
  } catch (err) {
    if (
      err instanceof Error
      && err.message.includes('Plugin package')
      && err.message.includes('not installed')
    ) {
      return null
    }
    throw err
  }
}

/**
 * Attempts to resolve a webhook provider and its runtime delivery listener from
 * a normalized {@link ProviderRef}.
 *
 * Listener resolution priority:
 * 1. `webhookListenerPlugin: SDKEventListenerPlugin` named export from package.
 * 2. `WebhookListenerPlugin` class export constructed with the workspace root.
 * 3. `null` — no webhook runtime listener is available.
 *
 * Returns `null` when the package is simply not installed yet (not-installed error).
 * Throws for any other loading or validation error.
 *
 * @internal
 */
function resolveWebhookPlugins(
  ref: ProviderRef,
  workspaceRoot: string,
): { provider: WebhookProviderPlugin; listener: SDKEventListenerPlugin | null } | null {
  if (ref.provider === 'none') {
    return null
  }

  const packageName = WEBHOOK_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  try {
    const { provider, listener } = loadWebhookPluginPack(packageName, workspaceRoot)
    return { provider, listener: listener ?? null }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Plugin package') &&
      err.message.includes('not installed')
    ) {
      return null
    }
    throw err
  }
}

const SDK_BEFORE_EVENT_NAMES: readonly SDKBeforeEventType[] = [
  'card.create',
  'card.update',
  'card.move',
  'card.delete',
  'card.transfer',
  'card.action.trigger',
  'card.checklist.add',
  'card.checklist.edit',
  'card.checklist.delete',
  'card.checklist.check',
  'card.checklist.uncheck',
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

// ---------------------------------------------------------------------------
// Capability bag resolver (main entry point)
// ---------------------------------------------------------------------------

/**
 * Creates the built-in auth event listener plugin that enforces authorization
 * during the before-event phase.
 *
 * The listener resolves identity from the active request-scoped auth carrier,
 * evaluates
 * the configured policy for {@link BeforeEventPayload.event}, emits
 * `auth.allowed` / `auth.denied`, and throws {@link AuthError} when a mutation
 * must be vetoed.
 *
 * @param authIdentity - Resolved identity provider used to establish the caller.
 * @param authPolicy   - Resolved policy provider used to authorize each action.
 * @param getAuthContext - Optional accessor for the active scoped auth context.
 * @returns A registered {@link SDKEventListenerPlugin} for the auth runtime seam.
 */
export function createBuiltinAuthListenerPlugin(
  authIdentity: AuthIdentityPlugin,
  authPolicy: AuthPolicyPlugin,
  getAuthContext?: () => AuthContext | undefined,
): SDKEventListenerPlugin {
  const subscriptions: Array<() => void> = []
  return {
    manifest: { id: 'builtin:auth-listener', provides: ['event.listener'] },
    register(bus: import('../eventBus').EventBus): void {
      if (subscriptions.length > 0) return

      const listener = async (payload: BeforeEventPayload<Record<string, unknown>>): Promise<void> => {
        if (!isBeforeEventPayload(payload)) return

        const context = withAuthHints(getAuthContext?.(), payload)
        const action = payload.event
        const identity = await authIdentity.resolveIdentity(context)
        const decision = await authPolicy.checkPolicy(identity, action, context)
        const actor = decision.actor ?? identity?.subject ?? payload.actor
        const boardId = payload.boardId ?? context.boardId

        if (!decision.allowed) {
          bus.emit('auth.denied', {
            type: 'auth.denied',
            data: {
              action,
              reason: toAuthErrorCategory(decision.reason, identity),
              actor,
            },
            timestamp: new Date().toISOString(),
            actor,
            boardId,
          })

          throw new AuthError(
            toAuthErrorCategory(decision.reason, identity),
            `Action "${action}" denied${actor ? ` for "${actor}"` : ''}`,
            actor,
          )
        }

        bus.emit('auth.allowed', {
          type: 'auth.allowed',
          data: { action, actor },
          timestamp: new Date().toISOString(),
          actor,
          boardId,
        })
      }

      for (const event of SDK_BEFORE_EVENT_NAMES) {
        subscriptions.push(bus.on(event, listener as unknown as import('../types').SDKEventListener))
      }
    },
    unregister(): void {
      while (subscriptions.length > 0) {
        subscriptions.pop()?.()
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Active external package name collection (canonical source for CLI discovery)
// ---------------------------------------------------------------------------

/**
 * Collects the canonical set of external npm package names that should be
 * probed for plugin extension contributions (e.g. `cliPlugin`, `standaloneHttpPlugin`)
 * from a raw workspace config object.
 *
 * Applies the same alias translations used by the standalone HTTP plugin discovery
 * path (`collectStandaloneHttpPackageNames`), and reads both the normalized `plugins`
 * key and the legacy `webhookPlugin` key so that webhook-only configurations
 * deterministically activate the webhook package for all surfaces.
 *
 * When no explicit webhook provider is configured, falls through to the default
 * `'webhooks'` → `'kl-plugin-webhook'` alias, matching the behaviour of
 * {@link normalizeWebhookCapabilities} and the standalone discovery path so that
 * both surfaces activate the same set of packages.
 *
 * @param config - Raw workspace config. Only the consumed fields need to be present.
 * @returns Deduplicated list of external npm package names to probe for extensions.
 */
export function collectActiveExternalPackageNames(config: {
  readonly plugins?: Partial<Record<string, ProviderRef>>
  readonly webhookPlugin?: Partial<Record<string, ProviderRef>>
  readonly auth?: Partial<Record<string, ProviderRef>>
}): string[] {
  const packageNames = new Set<string>()
  const add = (pkg: string | undefined): void => {
    if (pkg) packageNames.add(pkg)
  }

  // Card and attachment storage providers from normalized plugins key.
  const cardProvider = config.plugins?.['card.storage']?.provider === 'markdown'
    ? 'localfs'
    : config.plugins?.['card.storage']?.provider
  if (cardProvider && !BUILTIN_CARD_PLUGINS.has(cardProvider)) {
    add(PROVIDER_ALIASES.get(cardProvider) ?? cardProvider)
  }

  const attachmentProvider = config.plugins?.['attachment.storage']?.provider
  if (attachmentProvider && !BUILTIN_ATTACHMENT_IDS.has(attachmentProvider)) {
    add(PROVIDER_ALIASES.get(attachmentProvider) ?? attachmentProvider)
  }

  const cardStateProvider = config.plugins?.['card.state']?.provider === 'builtin'
    ? 'localfs'
    : config.plugins?.['card.state']?.provider
  if (cardStateProvider && !BUILTIN_CARD_STATE_PROVIDER_IDS.has(cardStateProvider)) {
    add(CARD_STATE_PROVIDER_ALIASES.get(cardStateProvider) ?? cardStateProvider)
  }

  // Auth providers — plugins key takes precedence over legacy auth key;
  // both resolve through AUTH_PROVIDER_ALIASES.
  const identityProvider = config.plugins?.['auth.identity']?.provider
    ?? config.auth?.['auth.identity']?.provider
  if (identityProvider) {
    add(AUTH_PROVIDER_ALIASES.get(identityProvider) ?? identityProvider)
  }

  const policyProvider = config.plugins?.['auth.policy']?.provider
    ?? config.auth?.['auth.policy']?.provider
  if (policyProvider) {
    add(AUTH_PROVIDER_ALIASES.get(policyProvider) ?? policyProvider)
  }

  const visibilityProvider = config.plugins?.['auth.visibility']?.provider
    ?? config.auth?.['auth.visibility']?.provider
  if (visibilityProvider && visibilityProvider !== 'none') {
    add(AUTH_PROVIDER_ALIASES.get(visibilityProvider) ?? visibilityProvider)
  }

  // Webhook provider — plugins['webhook.delivery'] takes precedence over the
  // legacy webhookPlugin key; falls through to the canonical default alias
  // 'webhooks' → 'kl-plugin-webhook' when neither is configured, matching
  // normalizeWebhookCapabilities and the standalone HTTP discovery path.
  const webhookProvider = config.plugins?.['webhook.delivery']?.provider
    ?? config.webhookPlugin?.['webhook.delivery']?.provider
    ?? 'webhooks'
  if (webhookProvider !== 'none') {
    add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)
  }

  const callbackProvider = config.plugins?.['callback.runtime']?.provider ?? 'none'
  if (callbackProvider !== 'none') {
    add(CALLBACK_PROVIDER_ALIASES.get(callbackProvider) ?? callbackProvider)
  }

  return [...packageNames]
}

/**
 * Resolves optional MCP tool plugins from the canonical active-package set.
 *
 * Reuses {@link collectActiveExternalPackageNames} so MCP follows the same
 * activation model as CLI and standalone HTTP discovery.
 */
export function resolveMcpPlugins(config: {
  readonly plugins?: Partial<Record<string, ProviderRef>>
  readonly webhookPlugin?: Partial<Record<string, ProviderRef>>
  readonly auth?: Partial<Record<string, ProviderRef>>
}): McpPluginRegistration[] {
  const resolved: McpPluginRegistration[] = []
  const seen = new Set<string>()

  for (const packageName of collectActiveExternalPackageNames(config)) {
    const plugin = tryLoadMcpPlugin(packageName)
    if (plugin && !seen.has(plugin.manifest.id)) {
      seen.add(plugin.manifest.id)
      resolved.push(plugin)
    }
  }

  return resolved
}

function resolveCardPlugin(ref: ProviderRef): CardStoragePlugin {
  const builtin = BUILTIN_CARD_PLUGINS.get(ref.provider)
  if (builtin) return builtin
  // Translate short compatibility alias ids to their external package names so
  // that module resolution and install hints use the correct package, not the
  // short user-facing id.
  const packageName = PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalCardPlugin(packageName)
}

function resolveAttachmentPlugin(ref: ProviderRef): AttachmentStoragePlugin {
  if (BUILTIN_ATTACHMENT_IDS.has(ref.provider)) {
    throw new Error(`Built-in attachment storage provider "${ref.provider}" requires an active storage engine.`)
  }
  const packageName = PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAttachmentPlugin(packageName)
}

/**
 * Resolves a fully typed {@link ResolvedCapabilityBag} from a normalized
 * {@link ResolvedCapabilities} map.
 *
 * Attachment storage fallback precedence:
 * 1. Explicit provider in `capabilities['attachment.storage']` (built-in or external)
 * 2. Card storage engine's explicit built-in attachment provider
 * 3. Built-in `localfs`
 *
 * Auth plugins default to the `noop` compatibility providers (anonymous identity,
 * allow-all policy) when `authCapabilities` is not supplied, preserving
 * the current open-access behavior.
 *
 * @param capabilities     - Normalized provider selections from {@link normalizeStorageCapabilities}.
 * @param kanbanDir        - Absolute path to the `.kanban` directory.
 * @param authCapabilities - Optional normalized auth provider selections from
 *                           {@link normalizeAuthCapabilities}. Defaults to noop providers.
 * @param webhookCapabilities - Optional normalized webhook provider selections from
 *                           {@link normalizeWebhookCapabilities}. When omitted, webhook
 *                           provider resolution is skipped and `bag.webhookProvider` is `null`.
 * @param cardStateCapabilities - Optional normalized card-state provider selections from
 *                           {@link normalizeCardStateCapabilities}.
 * @param callbackCapabilities - Optional normalized callback runtime provider selections from
 *                           {@link normalizeCallbackCapabilities}. When omitted, callback
 *                           listener resolution is skipped and `bag.callbackListener` is `null`.
 */
export function resolveCapabilityBag(
  capabilities: ResolvedCapabilities,
  kanbanDir: string,
  authCapabilities?: ResolvedAuthCapabilities,
  webhookCapabilities?: ResolvedWebhookCapabilities,
  cardStateCapabilities?: ResolvedCardStateCapabilities,
  callbackCapabilities?: ResolvedCallbackCapabilities,
): ResolvedCapabilityBag {
  const normalizedCapabilities: ResolvedCapabilities = {
    ...capabilities,
    'card.storage': capabilities['card.storage'].provider === 'markdown'
      ? {
          provider: 'localfs',
          ...(capabilities['card.storage'].options !== undefined
            ? { options: capabilities['card.storage'].options }
            : {}),
        }
      : capabilities['card.storage'],
  }

  const cardRef = normalizedCapabilities['card.storage']
  const cardPlugin = resolveCardPlugin(cardRef)
  const cardEngine = cardPlugin.createEngine(kanbanDir, cardRef.options)
  const nodeCapabilities = cardPlugin.nodeCapabilities

  const attachRef = normalizedCapabilities['attachment.storage']
  let attachPlugin: AttachmentStoragePlugin

  if (attachRef.provider === 'localfs') {
    if (shouldAttemptSamePluginAttachmentProvider(cardRef.provider, attachRef.provider)) {
      // Use the alias package name so the same-package attachment fallback
      // loads from the correct external package (e.g. kl-plugin-storage-sqlite,
      // not the short alias id 'sqlite').
      const cardPackageName = PROVIDER_ALIASES.get(cardRef.provider) ?? cardRef.provider
      try {
        attachPlugin = loadExternalAttachmentPlugin(cardPackageName)
      } catch (err) {
        if (!isRecoverableAttachmentPluginError(cardPackageName, err)) throw err
        attachPlugin = resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
      }
    } else {
      attachPlugin = resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
    }
  } else {
    attachPlugin = resolveAttachmentPlugin(attachRef)
  }

  const resolvedAuth: ResolvedAuthCapabilities = {
    'auth.identity': authCapabilities?.['auth.identity'] ?? { provider: 'noop' },
    'auth.policy': authCapabilities?.['auth.policy'] ?? { provider: 'noop' },
    'auth.visibility': authCapabilities?.['auth.visibility'] ?? { provider: 'none' },
  }

  // Card-state is auto-derived from the storage plugin when not explicitly
  // configured (or configured as 'localfs').  When the active card.storage
  // provider is external, we attempt to load createCardStateProvider from the
  // same storage package.  Falls back to the built-in file-backed provider
  // when the storage package does not export card-state support.
  const explicitCardState = (() => {
    const configured = cardStateCapabilities?.['card.state']
    if (!configured) return undefined
    if (configured.provider !== 'builtin') return configured
    return {
      provider: 'localfs',
      ...(configured.options !== undefined ? { options: configured.options } : {}),
    }
  })()
  const resolvedCardStateProvider = resolveCardStateProviderFromStorage(
    cardRef,
    explicitCardState,
    kanbanDir,
  )
  const resolvedAuthIdentity = resolveAuthIdentityPlugin(resolvedAuth['auth.identity'])
  const resolvedAuthPolicy = resolveAuthPolicyPlugin(resolvedAuth['auth.policy'])
  const resolvedAuthVisibility = resolveAuthVisibilityPlugin(resolvedAuth['auth.visibility'])
  const workspaceRoot = path.dirname(kanbanDir)
  const webhookPlugins = webhookCapabilities
    ? resolveWebhookPlugins(webhookCapabilities['webhook.delivery'], workspaceRoot)
    : null
  const callbackListener = callbackCapabilities
    ? resolveCallbackRuntimeListener(callbackCapabilities['callback.runtime'], workspaceRoot)
    : null
  const standaloneHttpPlugins = resolveStandaloneHttpPlugins({
    workspaceRoot,
    kanbanDir,
    capabilities: normalizedCapabilities,
    authCapabilities: resolvedAuth,
    webhookCapabilities: webhookCapabilities ?? null,
  })

  const sdkExtensions = resolveSDKExtensions(normalizedCapabilities, resolvedAuth, webhookCapabilities ?? null)

  return {
    cardStorage: cardEngine,
    attachmentStorage: attachPlugin,
    providers: normalizedCapabilities,
    isFileBacked: nodeCapabilities?.isFileBacked ?? cardEngine.type === 'markdown',
    getLocalCardPath(card: Card): string | null {
      if (nodeCapabilities) return nodeCapabilities.getLocalCardPath(card)
      if (cardEngine.type !== 'markdown') return null
      return card.filePath || null
    },
    getAttachmentDir(card: Card): string | null {
      return attachPlugin.getCardDir?.(card) ?? null
    },
    async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
      if (typeof attachPlugin.materializeAttachment === 'function') {
        return attachPlugin.materializeAttachment(card, attachment)
      }
      return materializeAttachmentFromDir(attachPlugin.getCardDir, card, attachment)
    },
    getWatchGlob(): string | null {
      if (nodeCapabilities) return nodeCapabilities.getWatchGlob()
      return cardEngine.type === 'markdown' ? 'boards/**/*.md' : null
    },
    authIdentity: resolvedAuthIdentity,
    authProviders: resolvedAuth,
    authPolicy: resolvedAuthPolicy,
    authVisibility: resolvedAuthVisibility,
    cardState: resolvedCardStateProvider.provider,
    cardStateProviders: { 'card.state': { provider: resolvedCardStateProvider.provider.manifest.id } },
    cardStateContext: resolvedCardStateProvider.context,
    eventListeners: [],
    webhookProvider: webhookPlugins?.provider ?? null,
    webhookProviders: webhookCapabilities ?? null,
    webhookListener: webhookPlugins?.listener ?? null,
    callbackProviders: callbackCapabilities ?? null,
    callbackListener,
    standaloneHttpPlugins,
    sdkExtensions,
    authListener: createBuiltinAuthListenerPlugin(resolvedAuthIdentity, resolvedAuthPolicy),
  }
}

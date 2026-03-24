import * as http from 'node:http'
import * as path from 'path'
import { createRequire } from 'node:module'
import type { ZodRawShape, ZodTypeAny } from 'zod'
import type { Card } from '../../shared/types'
import type { Webhook, CardStateCapabilityNamespace } from '../../shared/config'
import type { ResolvedCapabilities, CapabilityNamespace, ProviderRef, AuthCapabilityNamespace, ResolvedAuthCapabilities, ResolvedWebhookCapabilities, ResolvedCardStateCapabilities } from '../../shared/config'
import type { AuthContext, AuthDecision, AuthErrorCategory, BeforeEventPayload, SDKBeforeEventType, SDKEventListenerPlugin, SDKExtensionPlugin, SDKExtensionLoaderResult, CardStateBackend } from '../types'
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

const BUILTIN_CARD_STATE_PROVIDER_IDS = new Set(['builtin'])

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
   * Returns an {@link AuthDecision} indicating whether `identity` is
   * authorized to perform `action` in the given `context`.
   */
  checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>
}

/** Module shape supported for external auth provider packages. */
interface AuthPluginModule {
  readonly authIdentityPlugins?: Record<string, unknown>
  readonly authPolicyPlugins?: Record<string, unknown>
  readonly authIdentityPlugin?: unknown
  readonly authPolicyPlugin?: unknown
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
  readonly createAuthPolicyPlugin?: ((options?: Record<string, unknown>) => unknown) | unknown
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
 * External packages (e.g. `kl-webhooks-plugin`) must export a compatible
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
export interface CardStateCursor {
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
      return { subject: entry.subject, roles: [...entry.roles] }
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
  return loadExternalAuthIdentityPlugin(packageName, ref.provider)
}

function resolveAuthPolicyPlugin(ref: ProviderRef): AuthPolicyPlugin {
  if (ref.provider === 'noop') return NOOP_POLICY_PLUGIN
  if (ref.provider === 'rbac') return RBAC_POLICY_PLUGIN
  const packageName = AUTH_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAuthPolicyPlugin(packageName, ref.provider, ref.options)
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

/** No-op identity provider resolved from `kl-auth-plugin` when available. */
export const NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = getBundledAuthCompatExports().NOOP_IDENTITY_PLUGIN

/** No-op policy provider resolved from `kl-auth-plugin` when available. */
export const NOOP_POLICY_PLUGIN: AuthPolicyPlugin = getBundledAuthCompatExports().NOOP_POLICY_PLUGIN

/** RBAC identity provider resolved from `kl-auth-plugin` when available. */
export const RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin = getBundledAuthCompatExports().RBAC_IDENTITY_PLUGIN

/** RBAC policy provider resolved from `kl-auth-plugin` when available. */
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
 * Packages that want to own a set of MCP tools (e.g. `kl-webhooks-plugin`)
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
   * `kl-webhooks-plugin` package is not yet installed.
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
// Built-in card storage plugins
// ---------------------------------------------------------------------------

/** Registry of built-in card.storage plugins keyed by provider id. */
const BUILTIN_CARD_PLUGINS: ReadonlyMap<string, CardStoragePlugin> = new Map([
  ['markdown', MARKDOWN_PLUGIN],
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
 * - `sqlite` → `npm install kl-sqlite-storage`
 * - `mysql`  → `npm install kl-mysql-storage`
 *
 * Both packages must export `cardStoragePlugin` and `attachmentStoragePlugin`
 * with CJS entry `dist/index.cjs`.
 */
export const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-sqlite-storage'],
  ['mysql', 'kl-mysql-storage'],
])

/**
 * Maps short `card.state` provider ids to their installable npm package names.
 *
 * - `sqlite` → `npm install kl-sqlite-card-state`
 *
 * External packages must export `createCardStateProvider(context)` or a
 * `cardStateProvider`/`default` object with a manifest that provides
 * `'card.state'`.
 */
export const CARD_STATE_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-sqlite-card-state'],
])

/**
 * Maps short webhook provider ids to their installable npm package names.
 *
 * - `webhooks` → `npm install kl-webhooks-plugin`
 *
 * External packages must export `webhookProviderPlugin` (or a default export)
 * with a manifest that provides `'webhook.delivery'` and CRUD methods.
 */
export const WEBHOOK_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['webhooks', 'kl-webhooks-plugin'],
])

/**
 * Maps built-in auth compatibility ids to the external auth package.
 *
 * - `noop` → `npm install kl-auth-plugin`
 * - `rbac` → `npm install kl-auth-plugin`
 */
export const AUTH_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['noop', 'kl-auth-plugin'],
  ['rbac', 'kl-auth-plugin'],
  ['local', 'kl-auth-plugin'],
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

function isMissingRequestedModule(request: string, err: unknown): err is NodeJS.ErrnoException {
  return (err as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND'
    && typeof (err as Error)?.message === 'string'
    && (
      (err as Error).message.includes(`'${request}'`)
      || (err as Error).message.includes(request)
    )
}

function tryLoadSiblingPackage(request: string): unknown {
  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  return runtimeRequire(siblingPackagePath)
}

/**
 * Tries to load an external plugin from the workspace-local `packages/`
 * directory (monorepo layout).  Requires {@link WORKSPACE_ROOT} to be
 * discovered; throws `MODULE_NOT_FOUND` when the path does not exist so the
 * caller can distinguish "not present in monorepo" from other errors.
 *
 * @internal
 */
function tryLoadWorkspacePackage(request: string): unknown {
  if (!WORKSPACE_ROOT) {
    throw Object.assign(new Error(`Cannot find module '${request}'`), { code: 'MODULE_NOT_FOUND' })
  }
  const workspacePackagePath = path.resolve(WORKSPACE_ROOT, 'packages', request)
  return runtimeRequire(workspacePackagePath)
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
  // 1. Workspace-local packages/{request} (monorepo layout — primary path
  //    during the staged migration before the package is published to npm).
  if (WORKSPACE_ROOT) {
    const workspacePackagePath = path.resolve(WORKSPACE_ROOT, 'packages', request)
    try {
      return runtimeRequire(workspacePackagePath)
    } catch (workspaceErr: unknown) {
      if (!isMissingRequestedModule(workspacePackagePath, workspaceErr)) throw workspaceErr
    }
  }

  // 2. Standard npm resolution (installed package or pnpm workspace symlink).
  try {
    return runtimeRequire(request)
  } catch (err: unknown) {
    if (!isMissingRequestedModule(request, err)) throw err
  }

  // 3. Globally installed npm package (npm install -g ...).
  try {
    return tryLoadGlobalPackage(request)
  } catch (err: unknown) {
    if (!isMissingRequestedModule(request, err)) throw err
  }

  // 4. Legacy sibling path ../request (backward-compat for non-monorepo
  //    checkouts where plugin repos live as siblings of this repository).
  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  try {
    return runtimeRequire(siblingPackagePath)
  } catch (siblingErr: unknown) {
    if (isMissingRequestedModule(siblingPackagePath, siblingErr)) {
      throw new Error(`Plugin package "${request}" is not installed. Run: npm install ${request}`)
    }
    throw siblingErr
  }
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

function loadExternalAuthIdentityPlugin(packageName: string, providerId: string): AuthIdentityPlugin {
  const mod = loadExternalModule(packageName) as AuthPluginModule
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
    const created = (mod.createAuthPolicyPlugin as (opts?: Record<string, unknown>) => unknown)(options)
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

function isValidStandaloneHttpPlugin(plugin: unknown): plugin is StandaloneHttpPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as StandaloneHttpPlugin
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('standalone.http')
    && (candidate.registerMiddleware === undefined || typeof candidate.registerMiddleware === 'function')
    && (candidate.registerRoutes === undefined || typeof candidate.registerRoutes === 'function')
}

function isValidSDKExtensionPlugin(plugin: unknown): plugin is SDKExtensionPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as SDKExtensionPlugin
  return typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && typeof candidate.extensions === 'object'
    && candidate.extensions !== null
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
  return { id: candidate.manifest.id, extensions: candidate.extensions }
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

  if (webhookCapabilities) {
    const webhookProvider = webhookCapabilities['webhook.delivery'].provider
    add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)
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
  const packageName = 'kl-auth-plugin'

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

/** @internal Shape of a loaded webhook provider package module. */
interface WebhookProviderModule {
  webhookProviderPlugin?: unknown
  webhookListenerPlugin?: unknown
  WebhookListenerPlugin?: unknown
  default?: unknown
}

/** @internal Combined result of loading a webhook package. */
interface WebhookPluginPack {
  provider: WebhookProviderPlugin
  /** Direct `SDKEventListenerPlugin` export when the package provides one. */
  listener?: SDKEventListenerPlugin
}

interface WebhookListenerPluginConstructor {
  new (workspaceRoot: string): SDKEventListenerPlugin
}

function isWebhookListenerPluginConstructor(value: unknown): value is WebhookListenerPluginConstructor {
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
    : isWebhookListenerPluginConstructor(mod.WebhookListenerPlugin)
      ? mod.WebhookListenerPlugin
      : undefined

  if (isWebhookListenerPluginConstructor(directListener)) {
    return { provider: rawProvider, listener: new directListener(workspaceRoot) }
  }

  return { provider: rawProvider, listener: directListener }
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
 * `'webhooks'` → `'kl-webhooks-plugin'` alias, matching the behaviour of
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
  const cardProvider = config.plugins?.['card.storage']?.provider
  if (cardProvider && !BUILTIN_CARD_PLUGINS.has(cardProvider)) {
    add(PROVIDER_ALIASES.get(cardProvider) ?? cardProvider)
  }

  const attachmentProvider = config.plugins?.['attachment.storage']?.provider
  if (attachmentProvider && !BUILTIN_ATTACHMENT_IDS.has(attachmentProvider)) {
    add(PROVIDER_ALIASES.get(attachmentProvider) ?? attachmentProvider)
  }

  const cardStateProvider = config.plugins?.['card.state']?.provider
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

  // Webhook provider — plugins['webhook.delivery'] takes precedence over the
  // legacy webhookPlugin key; falls through to the canonical default alias
  // 'webhooks' → 'kl-webhooks-plugin' when neither is configured, matching
  // normalizeWebhookCapabilities and the standalone HTTP discovery path.
  const webhookProvider = config.plugins?.['webhook.delivery']?.provider
    ?? config.webhookPlugin?.['webhook.delivery']?.provider
    ?? 'webhooks'
  add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)

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
 */
export function resolveCapabilityBag(
  capabilities: ResolvedCapabilities,
  kanbanDir: string,
  authCapabilities?: ResolvedAuthCapabilities,
  webhookCapabilities?: ResolvedWebhookCapabilities,
  cardStateCapabilities?: ResolvedCardStateCapabilities,
): ResolvedCapabilityBag {
  const cardRef = capabilities['card.storage']
  const cardPlugin = resolveCardPlugin(cardRef)
  const cardEngine = cardPlugin.createEngine(kanbanDir, cardRef.options)
  const nodeCapabilities = cardPlugin.nodeCapabilities

  const attachRef = capabilities['attachment.storage']
  let attachPlugin: AttachmentStoragePlugin

  if (attachRef.provider === 'localfs') {
    if (shouldAttemptSamePluginAttachmentProvider(cardRef.provider, attachRef.provider)) {
      // Use the alias package name so the same-package attachment fallback
      // loads from the correct external package (e.g. kl-sqlite-storage,
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

  const resolvedAuth: ResolvedAuthCapabilities = authCapabilities ?? {
    'auth.identity': { provider: 'noop' },
    'auth.policy': { provider: 'noop' },
  }
  const resolvedCardState: ResolvedCardStateCapabilities = cardStateCapabilities ?? {
    'card.state': { provider: 'builtin' },
  }

  const resolvedAuthIdentity = resolveAuthIdentityPlugin(resolvedAuth['auth.identity'])
  const resolvedAuthPolicy = resolveAuthPolicyPlugin(resolvedAuth['auth.policy'])
  const resolvedCardStateProvider = resolveCardStateProvider(resolvedCardState['card.state'], kanbanDir)
  const workspaceRoot = path.dirname(kanbanDir)
  const webhookPlugins = webhookCapabilities
    ? resolveWebhookPlugins(webhookCapabilities['webhook.delivery'], workspaceRoot)
    : null
  const standaloneHttpPlugins = resolveStandaloneHttpPlugins({
    workspaceRoot,
    kanbanDir,
    capabilities,
    authCapabilities: resolvedAuth,
    webhookCapabilities: webhookCapabilities ?? null,
  })

  const sdkExtensions = resolveSDKExtensions(capabilities, resolvedAuth, webhookCapabilities ?? null)

  return {
    cardStorage: cardEngine,
    attachmentStorage: attachPlugin,
    providers: capabilities,
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
    cardState: resolvedCardStateProvider.provider,
    cardStateProviders: resolvedCardState,
    cardStateContext: resolvedCardStateProvider.context,
    eventListeners: [],
    webhookProvider: webhookPlugins?.provider ?? null,
    webhookProviders: webhookCapabilities ?? null,
    webhookListener: webhookPlugins?.listener ?? null,
    standaloneHttpPlugins,
    sdkExtensions,
    authListener: createBuiltinAuthListenerPlugin(resolvedAuthIdentity, resolvedAuthPolicy),
  }
}

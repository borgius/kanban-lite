import * as http from 'node:http';
import type { ZodRawShape, ZodTypeAny } from 'zod';
import type { Card, PluginSettingsOptionsSchemaMetadata, PluginSettingsPayload, PluginSettingsProviderRow, PluginSettingsReadPayload, PluginSettingsRedactionPolicy } from '../../shared/types';
import type { Webhook, CardStateCapabilityNamespace, ConfigStorageCapabilityNamespace, PluginCapabilityNamespace, ResolvedCapabilities, CapabilityNamespace, ProviderRef, AuthCapabilityNamespace, ResolvedAuthCapabilities, ResolvedWebhookCapabilities, ResolvedCardStateCapabilities } from '../../shared/config';
import type { AuthContext, AuthDecision, SDKEventListenerPlugin, SDKExtensionLoaderResult, CardStateBackend } from '../types';
import type { CloudflareWorkerProviderContext } from '../env';
import type { KanbanSDK } from '../KanbanSDK';
import type { StorageEngine } from './types';
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
export declare const WORKSPACE_ROOT: string | null;
/**
 * Runtime resolver for a dynamic plugin-settings schema value.
 */
export type PluginSettingsOptionsSchemaValueResolver<T = unknown> = (sdk: KanbanSDK, optionsSchema: PluginSettingsOptionsSchemaMetadata) => T | Promise<T>;
/**
 * Top-level `optionsSchema()` return value supported by the shared resolver.
 */
export type PluginSettingsOptionsSchemaInput = PluginSettingsOptionsSchemaMetadata | Promise<PluginSettingsOptionsSchemaMetadata> | PluginSettingsOptionsSchemaValueResolver<PluginSettingsOptionsSchemaMetadata>;
/** Shared factory signature for plugin package `optionsSchema()` hooks. */
export type PluginSettingsOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaInput;
/**
 * Resolved identity returned by {@link AuthIdentityPlugin.resolveIdentity}.
 */
export interface AuthIdentity {
    /** Opaque caller identifier (e.g., user ID or client ID). */
    subject: string;
    /** Optional list of roles or permission scopes. */
    roles?: string[];
    /** Optional group memberships resolved for the caller. */
    groups?: string[];
}
/** Plugin manifest scoped to auth capability namespaces. */
export interface AuthPluginManifest {
    readonly id: string;
    readonly provides: readonly AuthCapabilityNamespace[];
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
    readonly manifest: AuthPluginManifest;
    /**
     * Optional transport-safe options schema metadata for shared plugin-settings flows.
     *
     * When provided, hosts may surface this in configuration UIs and redact any
     * secret fields according to the accompanying metadata.
     */
    optionsSchema?: PluginSettingsOptionsSchemaFactory;
    /**
     * Resolves an auth context to a caller identity, or `null` for
     * anonymous / invalid tokens.
     */
    resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>;
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
    readonly manifest: AuthPluginManifest;
    /**
     * Optional transport-safe options schema metadata for shared plugin-settings flows.
     *
     * When provided, hosts may surface this in configuration UIs and redact any
     * secret fields according to the accompanying metadata.
     */
    optionsSchema?: PluginSettingsOptionsSchemaFactory;
    /**
     * Returns an {@link AuthDecision} indicating whether `identity` is
     * authorized to perform `action` in the given `context`.
     */
    checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>;
}
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
    readonly manifest: {
        readonly id: string;
        readonly provides: readonly string[];
    };
    /** Lists all registered webhooks for the workspace. */
    listWebhooks(workspaceRoot: string): Webhook[];
    /** Creates and persists a new webhook. Returns the created webhook with its generated id. */
    createWebhook(workspaceRoot: string, input: {
        url: string;
        events: string[];
        secret?: string;
    }): Webhook;
    /** Updates an existing webhook. Returns the updated webhook, or `null` if not found. */
    updateWebhook(workspaceRoot: string, id: string, updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>): Webhook | null;
    /** Deletes a webhook by id. Returns `true` if deleted, `false` if not found. */
    deleteWebhook(workspaceRoot: string, id: string): boolean;
}
/** Shared plugin manifest shape for `card.state` capability providers. */
export interface CardStateProviderManifest {
    readonly id: string;
    readonly provides: readonly CardStateCapabilityNamespace[];
}
/** Opaque JSON-like payload stored for a card-state domain. */
export type CardStateValue = Record<string, unknown>;
/** Stable actor/card/domain lookup key used by card-state providers. */
export interface CardStateKey {
    actorId: string;
    boardId: string;
    cardId: string;
    domain: string;
}
/** Stored card-state record returned by provider operations. */
export interface CardStateRecord<TValue = CardStateValue> extends CardStateKey {
    value: TValue;
    updatedAt: string;
}
/** Write input for card-state domain mutations. */
export interface CardStateWriteInput<TValue = CardStateValue> extends CardStateKey {
    value: TValue;
    updatedAt?: string;
}
/** Unread cursor payload persisted by card-state providers. */
export interface CardStateCursor {
    cursor: string;
    updatedAt?: string;
}
/** Lookup key for unread cursor state. */
export interface CardStateUnreadKey {
    actorId: string;
    boardId: string;
    cardId: string;
}
/** Mutation input for marking unread state through a cursor. */
export interface CardStateReadThroughInput extends CardStateUnreadKey {
    cursor: CardStateCursor;
}
/** Shared runtime context passed to and exposed for `card.state` providers. */
export interface CardStateModuleContext {
    workspaceRoot: string;
    kanbanDir: string;
    provider: string;
    backend: Exclude<CardStateBackend, 'none'>;
    options?: Record<string, unknown>;
    worker?: CloudflareWorkerProviderContext | null;
}
/**
 * Contract for first-class `card.state` capability providers.
 *
 * The core SDK resolves exactly one provider and shares both the provider and a
 * normalized module context with leaf modules so host layers never need
 * backend-specific branching.
 */
export interface CardStateProvider {
    readonly manifest: CardStateProviderManifest;
    getCardState(input: CardStateKey): Promise<CardStateRecord | null>;
    setCardState(input: CardStateWriteInput): Promise<CardStateRecord>;
    getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null>;
    markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>>;
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
    subject: string;
    /** Assigned RBAC roles (valid values: `'user'`, `'manager'`, `'admin'`). */
    roles: string[];
    /** Optional group memberships resolved alongside the caller roles. */
    groups?: string[];
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
export declare function createRbacIdentityPlugin(principals: ReadonlyMap<string, RbacPrincipalEntry>): AuthIdentityPlugin;
/**
 * Canonical role names for the shipped RBAC auth provider.
 *
 * Roles are cumulative: `manager` includes all `user` actions, and `admin`
 * includes all `manager` and `user` actions. The shipped `rbac` provider
 * enforces this matrix at the SDK authorization seam.
 *
 * Host surfaces must never replicate or extend this matrix locally.
 */
export type RbacRole = 'user' | 'manager' | 'admin';
/**
 * Actions available to the `user` role.
 *
 * Covers non-destructive card-interaction operations: form submission,
 * comments, attachments, action triggers, and card-level log writes.
 */
export declare const RBAC_USER_ACTIONS: ReadonlySet<string>;
/**
 * Actions available to the `manager` role (includes all `user` actions).
 *
 * Adds card lifecycle mutations (create, update, move, transfer, delete),
 * board-action triggers, card-log clearing, and board-level log writes.
 */
export declare const RBAC_MANAGER_ACTIONS: ReadonlySet<string>;
/**
 * Actions available to the `admin` role (includes all `manager` and `user` actions).
 *
 * Adds all destructive and configuration operations: board create/update/delete,
 * settings, webhooks, labels, columns, board-action config edits, board-log
 * clearing, migrations, default-board changes, and deleted-card purge.
 */
export declare const RBAC_ADMIN_ACTIONS: ReadonlySet<string>;
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
export declare const RBAC_ROLE_MATRIX: Record<RbacRole, ReadonlySet<string>>;
/** No-op identity provider resolved from `kl-plugin-auth` when available. */
export declare const NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin;
/** No-op policy provider resolved from `kl-plugin-auth` when available. */
export declare const NOOP_POLICY_PLUGIN: AuthPolicyPlugin;
/** RBAC identity provider resolved from `kl-plugin-auth` when available. */
export declare const RBAC_IDENTITY_PLUGIN: AuthIdentityPlugin;
/** RBAC policy provider resolved from `kl-plugin-auth` when available. */
export declare const RBAC_POLICY_PLUGIN: AuthPolicyPlugin;
/**
 * Manifest describing what capability namespaces a plugin provides.
 */
export interface PluginManifest {
    readonly id: string;
    readonly provides: readonly CapabilityNamespace[];
}
/**
 * Built-in adapter interface for `card.storage` capability.
 * Produces a {@link StorageEngine} instance from a kanban directory and optional options.
 */
export interface CardStoragePlugin {
    readonly manifest: PluginManifest;
    createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine;
    /** Optional node-host hints used by the extension/server/CLI for local file access and watching. */
    readonly nodeCapabilities?: {
        readonly isFileBacked: boolean;
        getLocalCardPath(card: Card): string | null;
        getWatchGlob(): string | null;
    };
}
/**
 * Built-in adapter interface for `attachment.storage` capability.
 *
 * Wraps file-copy and directory-resolution operations for card attachments.
 * T2 implementations delegate to the active card storage engine; T3+ may
 * extend this with node-only watch/materialization capabilities.
 */
export interface AttachmentStoragePlugin {
    readonly manifest: PluginManifest;
    /** Returns the attachment directory for a card, or `null` if not determinable. */
    getCardDir?(card: Card): string | null;
    /** Copies `sourcePath` into the attachment directory for `card`. */
    copyAttachment(sourcePath: string, card: Card): Promise<void>;
    /** Writes raw attachment bytes when the provider can persist them directly. */
    writeAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<void>;
    /** Reads raw attachment bytes when the provider can return them directly. */
    readAttachment?(card: Card, attachment: string): Promise<{
        data: Uint8Array;
        contentType?: string;
    } | null>;
    /**
     * Appends `content` to an existing attachment when the provider can do so
     * efficiently in-place (for example, an object-storage API with native append).
     *
     * Returns `true` when the append was handled by the provider and `false`
     * when callers should fall back to read/modify/write via `copyAttachment`.
     */
    appendAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>;
    /**
     * Resolves or materializes a local file path for a named attachment.
     * Returns `null` when the provider cannot expose a safe local file.
     */
    materializeAttachment?(card: Card, attachment: string): Promise<string | null>;
}
/** Shared plugin manifest shape for `config.storage` capability providers. */
export interface ConfigStorageProviderManifest {
    readonly id: string;
    readonly provides: readonly ConfigStorageCapabilityNamespace[];
}
/** Shared runtime context passed to and exposed for `config.storage` providers. */
export interface ConfigStorageModuleContext {
    workspaceRoot: string;
    documentId: string;
    provider: string;
    backend: 'builtin' | 'external';
    options?: Record<string, unknown>;
    worker?: CloudflareWorkerProviderContext | null;
}
/** Executable contract for first-class `config.storage` capability providers. */
export interface ConfigStorageProviderPlugin {
    readonly manifest: ConfigStorageProviderManifest;
    optionsSchema?: PluginSettingsOptionsSchemaFactory;
    readConfigDocument(): Record<string, unknown> | null | undefined;
    writeConfigDocument(document: Record<string, unknown>): void;
}
/** Context passed to callback runtime listener factories. */
export interface CallbackRuntimeListenerContext {
    readonly workspaceRoot: string;
    readonly worker: CloudflareWorkerProviderContext | null;
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
    readonly sdk: KanbanSDK;
    /** Absolute workspace root containing `.kanban.json`. */
    readonly workspaceRoot: string;
    /** Absolute workspace `.kanban` directory. */
    readonly kanbanDir: string;
    /** Raw incoming HTTP request. */
    readonly req: http.IncomingMessage;
    /** Raw outgoing HTTP response. */
    readonly res: http.ServerResponse;
    /** Parsed request URL. */
    readonly url: URL;
    /** URL pathname convenience field. */
    readonly pathname: string;
    /** Uppercase HTTP method convenience field. */
    readonly method: string;
    /** Resolved standalone webview directory. */
    readonly resolvedWebviewDir: string;
    /** Loaded standalone `index.html` shell contents. */
    readonly indexHtml: string;
    /** Route matcher helper matching the built-in standalone handlers. */
    readonly route: (expectedMethod: string, pattern: string) => Record<string, string> | null;
    /** True when the request targets the standalone REST/API surface. */
    readonly isApiRequest: boolean;
    /** True when the request is a browser page/navigation request. */
    readonly isPageRequest: boolean;
    /** Returns the request-scoped auth context accumulated so far. */
    getAuthContext(): AuthContext;
    /** Replaces the request-scoped auth context for downstream handlers. */
    setAuthContext(auth: AuthContext): AuthContext;
    /** Shallow-merges request-scoped auth fields for downstream handlers. */
    mergeAuthContext(auth: Partial<AuthContext>): AuthContext;
}
/** Request middleware/route handlers return `true` when they fully handled the request. */
export type StandaloneHttpHandler = (request: StandaloneHttpRequestContext) => Promise<boolean>;
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
    readonly sdk?: KanbanSDK;
    /** Absolute workspace root containing `.kanban.json`. */
    readonly workspaceRoot: string;
    /** Absolute workspace `.kanban` directory. */
    readonly kanbanDir: string;
    /** Resolved storage capability selections. */
    readonly capabilities: ResolvedCapabilities;
    /** Resolved auth capability selections. */
    readonly authCapabilities: ResolvedAuthCapabilities;
    /** Resolved webhook capability selections when webhook plugins are active. */
    readonly webhookCapabilities: ResolvedWebhookCapabilities | null;
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
    readonly manifest: {
        readonly id: string;
        readonly provides: readonly ['standalone.http'];
    };
    registerMiddleware?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[];
    registerRoutes?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[];
}
/**
 * Runtime context available to MCP tool handlers contributed by plugins.
 *
 * Passed to every registered tool handler by the MCP server during tool
 * invocation.  Intentionally minimal for the first-cut tool-only seam;
 * auth decorators, resource contributions, and lifecycle hooks are deferred.
 */
export interface McpToolContext {
    /** Absolute workspace root containing `.kanban.json`. */
    readonly workspaceRoot: string;
    /** Absolute workspace `.kanban` directory. */
    readonly kanbanDir: string;
    /** Active SDK instance backing the MCP server runtime. */
    readonly sdk: KanbanSDK;
    /** Runs the tool operation with the core MCP auth context installed. */
    runWithAuth<T>(fn: () => Promise<T>): Promise<T>;
    /** Maps thrown errors to the canonical MCP `{ content, isError }` response shape. */
    toErrorResult(err: unknown): McpToolResult;
}
/** Canonical MCP tool result shape used by plugin-contributed tool handlers. */
export interface McpToolResult {
    readonly content: Array<{
        type: 'text';
        text: string;
    }>;
    readonly isError?: boolean;
}
/** Minimal zod factory surface required by plugin-contributed MCP tool schemas. */
export interface McpSchemaFactory {
    string(): ZodTypeAny;
    array(item: ZodTypeAny): ZodTypeAny;
    boolean(): ZodTypeAny;
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
    readonly name: string;
    /** Human-readable tool description shown in MCP tool listings. */
    readonly description: string;
    /** Lazily builds the tool input schema using the host MCP server's zod instance. */
    readonly inputSchema: (z: McpSchemaFactory) => ZodRawShape;
    /**
     * Tool handler invoked by the MCP server when the tool is called.
     * Must return the MCP-standard content array response.
     */
    readonly handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<McpToolResult>;
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
    readonly manifest: {
        readonly id: string;
        readonly provides: readonly ['mcp.tools'];
    };
    /**
     * Called once by the MCP server during tool registration.
     * Returns the complete set of tool definitions this plugin owns.
     */
    registerTools(ctx: McpToolContext): readonly McpToolDefinition[];
}
/**
 * Fully resolved capability bag produced by {@link resolveCapabilityBag}.
 *
 * Passed to the SDK so it no longer branches directly on storage type at call
 * sites; all storage routing is centralised in the plugin layer.
 */
export interface ResolvedCapabilityBag {
    /** Active card storage engine. */
    readonly cardStorage: StorageEngine;
    /** Active attachment storage plugin. */
    readonly attachmentStorage: AttachmentStoragePlugin;
    /**
     * Raw provider selections used to resolve this bag.
     * Useful for inspection/reporting (e.g. workspace status endpoints).
     */
    readonly providers: ResolvedCapabilities;
    /**
     * Whether the active card storage provider stores cards as local files on
     * disk. `true` for markdown, `false` for SQLite and any remote provider.
     *
     * Host layers should check this before setting up file-change watchers or
     * attempting to open card files in a native editor.
     */
    readonly isFileBacked: boolean;
    /**
     * Returns the local filesystem path for a card, or `null` if the provider
     * is not file-backed or the card has no associated file.
     *
     * Use this instead of reading `card.filePath` directly so that host code
     * remains forward-compatible with non-file-backed providers.
     */
    getLocalCardPath(card: Card): string | null;
    /** Returns the local attachment directory for a card, or `null` when unavailable. */
    getAttachmentDir(card: Card): string | null;
    /** Returns a safe local file path for a named attachment, or `null` when unavailable. */
    materializeAttachment(card: Card, attachment: string): Promise<string | null>;
    /**
     * Returns the glob pattern (relative to the kanban directory) that host
     * file-watchers should use to observe card changes, or `null` when the
     * provider does not store cards as local files and therefore does not
     * require file-system watching.
     */
    getWatchGlob(): string | null;
    /**
     * Resolved `auth.identity` plugin. Defaults to the `noop` compatibility id
     * (always returns `null` / anonymous) when no auth plugin is configured.
      */
    readonly authIdentity: AuthIdentityPlugin;
    /** Raw resolved auth provider selections used to resolve auth plugins. */
    readonly authProviders: ResolvedAuthCapabilities;
    /**
     * Resolved `auth.policy` plugin. Defaults to the `noop` compatibility id
     * (always returns `true` / allow-all) when no auth plugin is configured.
      */
    readonly authPolicy: AuthPolicyPlugin;
    /** Resolved `card.state` provider shared across SDK modules and host surfaces. */
    readonly cardState: CardStateProvider;
    /** Raw resolved `card.state` provider selection used to resolve card-state capability routing. */
    readonly cardStateProviders: ResolvedCardStateCapabilities;
    /** Shared runtime context for the resolved `card.state` provider. */
    readonly cardStateContext: CardStateModuleContext;
    /** Resolved event listener plugins. Currently always empty; reserved for future use. */
    /** Resolved event listener plugins. Reserved for future use; currently empty. */
    readonly eventListeners: readonly SDKEventListenerPlugin[];
    /**
     * Resolved webhook delivery provider for CRUD operations, or `null` when the
     * `kl-plugin-webhook` package is not yet installed.
     *
     * This field holds only the registry/persistence capability. Runtime delivery
     * is wired via {@link webhookListener}.
     */
    readonly webhookProvider: WebhookProviderPlugin | null;
    /** Raw resolved webhook provider selection used to resolve webhook plugins. */
    readonly webhookProviders: ResolvedWebhookCapabilities | null;
    /**
      * Resolved webhook runtime delivery listener, or `null` when no webhook package
      * is installed.
     *
     * Implements {@link SDKEventListenerPlugin} — registered via `register(bus)` at
     * SDK startup to subscribe to after-events and deliver outbound HTTP webhooks.
     */
    readonly webhookListener: SDKEventListenerPlugin | null;
    /** Standalone-only middleware/routes exported by active capability packages. */
    readonly standaloneHttpPlugins: readonly StandaloneHttpPlugin[];
    /**
     * SDK extensions contributed by active plugin packages.
     *
     * Each entry corresponds to one plugin that exported `sdkExtensionPlugin`.
     * Consumed by `KanbanSDK.getExtension(id)` (SPE-02) and the future
     * `sdk.extensions` named-access bag.  Empty when no active plugin exports
     * the optional `sdkExtensionPlugin` field.
     */
    readonly sdkExtensions: readonly SDKExtensionLoaderResult[];
    /**
      * Built-in auth event listener plugin.
     *
     * Establishes the {@link SDKEventListenerPlugin} registration seam for
     * authorization. Active per-before-event auth checking will be wired in T9
     * once `BeforeEventPayload` carries the `AuthContext` and SDK action runners
     * transition away from the `_authorizeAction` path.
     */
    readonly authListener: SDKEventListenerPlugin;
}
/**
 * Resolves transport-safe plugin-settings metadata from a static object or a
 * dynamic sync/async schema factory.
 */
export declare function resolvePluginSettingsOptionsSchema(value: unknown, sdk: KanbanSDK): Promise<PluginSettingsOptionsSchemaMetadata | undefined>;
/**
 * Returns `true` only when the auth configuration permits the stable default
 * single-user card-state actor.
 *
 * Any non-noop `auth.identity` provider disables the fallback, even if the
 * provider later resolves no caller for a specific request.
 */
export declare function canUseDefaultCardStateActor(authCapabilities?: ResolvedAuthCapabilities | null): boolean;
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
export declare const PROVIDER_ALIASES: ReadonlyMap<string, string>;
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
export declare const CARD_STATE_PROVIDER_ALIASES: ReadonlyMap<string, string>;
/**
 * Maps short webhook provider ids to their installable npm package names.
 *
 * - `webhooks` → `npm install kl-plugin-webhook`
 *
 * External packages must export `webhookProviderPlugin` (or a default export)
 * with a manifest that provides `'webhook.delivery'` and CRUD methods.
 */
export declare const WEBHOOK_PROVIDER_ALIASES: ReadonlyMap<string, string>;
/**
 * Maps built-in auth compatibility ids to the external auth package.
 *
 * - `noop` → `npm install kl-plugin-auth`
 * - `rbac` → `npm install kl-plugin-auth`
 */
export declare const AUTH_PROVIDER_ALIASES: ReadonlyMap<string, string>;
/** Set of provider ids that are handled as built-in attachment plugins. */
export declare const BUILTIN_ATTACHMENT_IDS: ReadonlySet<string>;
export declare function loadExternalModule(request: string): unknown;
type PluginSettingsProviderReadModel = PluginSettingsReadPayload & Pick<PluginSettingsProviderRow, 'packageName' | 'discoverySource' | 'optionsSchema'>;
export declare class PluginSettingsStoreError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function discoverPluginSettingsInventory(workspaceRoot: string, redaction: PluginSettingsRedactionPolicy): PluginSettingsPayload;
export declare function readPluginSettingsProvider(workspaceRoot: string, capability: PluginCapabilityNamespace, providerId: string, redaction: PluginSettingsRedactionPolicy): PluginSettingsProviderReadModel | null;
export declare function persistPluginSettingsProviderSelection(workspaceRoot: string, capability: PluginCapabilityNamespace, providerId: string, redaction: PluginSettingsRedactionPolicy): PluginSettingsProviderReadModel | null;
export declare function persistPluginSettingsProviderOptions(workspaceRoot: string, capability: PluginCapabilityNamespace, providerId: string, options: unknown, redaction: PluginSettingsRedactionPolicy): PluginSettingsProviderReadModel;
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
export declare function createBuiltinAuthListenerPlugin(authIdentity: AuthIdentityPlugin, authPolicy: AuthPolicyPlugin, getAuthContext?: () => AuthContext | undefined): SDKEventListenerPlugin;
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
export declare function collectActiveExternalPackageNames(config: {
    readonly plugins?: Partial<Record<string, ProviderRef>>;
    readonly webhookPlugin?: Partial<Record<string, ProviderRef>>;
    readonly auth?: Partial<Record<string, ProviderRef>>;
}): string[];
/**
 * Resolves optional MCP tool plugins from the canonical active-package set.
 *
 * Reuses {@link collectActiveExternalPackageNames} so MCP follows the same
 * activation model as CLI and standalone HTTP discovery.
 */
export declare function resolveMcpPlugins(config: {
    readonly plugins?: Partial<Record<string, ProviderRef>>;
    readonly webhookPlugin?: Partial<Record<string, ProviderRef>>;
    readonly auth?: Partial<Record<string, ProviderRef>>;
}): McpPluginRegistration[];
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
export declare function resolveCapabilityBag(capabilities: ResolvedCapabilities, kanbanDir: string, authCapabilities?: ResolvedAuthCapabilities, webhookCapabilities?: ResolvedWebhookCapabilities, cardStateCapabilities?: ResolvedCardStateCapabilities): ResolvedCapabilityBag;
export {};

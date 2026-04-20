import type { CreateCardInput, SDKEvent, SDKEventType, SDKOptions, SubmitFormInput, SubmitFormResult, AuthContext, AuthDecision, SDKBeforeEventType, SDKAfterEventType, CardStateStatus, CardOpenStateValue, CardUnreadSummary, ResolveMobileBootstrapInput, ResolveMobileBootstrapResult, InspectMobileSessionInput, MobileSessionStatus } from './types';
import type { Comment, Card, KanbanColumn, BoardInfo, LabelDefinition, CardSortOption, LogEntry } from '../shared/types';
import type { CardDisplaySettings, PluginSettingsErrorPayload, PluginSettingsInstallRequest, PluginSettingsPayload, PluginSettingsProviderRow, PluginSettingsReadPayload, PluginSettingsInstallScope, PluginSettingsRedactionPolicy, Priority } from '../shared/types';
import type { BoardConfig, KanbanConfig, PluginCapabilityNamespace, ResolvedCapabilities, Webhook } from '../shared/config';
import type { CreateCardInput, SDKEvent, SDKEventType, SDKOptions, SubmitFormInput, SubmitFormResult, AuthContext, AuthDecision, SDKBeforeEventType, SDKAfterEventType, CardStateStatus, CardOpenStateValue, CardUnreadSummary } from './types';
import type { EventBusAnyListener, EventBusWaitOptions } from './eventBus';
import { EventBus } from './eventBus';
import type { StorageEngine } from './plugins/types';
import type { CardStateCursor, CardStateRecord, ResolvedCapabilityBag } from './plugins';
/**
 * Resolved storage/provider metadata for diagnostics and host surfaces.
 *
 * This lightweight shape is designed for UI status banners, REST responses,
 * CLI diagnostics, and integration checks that need to know which providers
 * are active without reaching into the internal capability bag.
 */
export interface StorageStatus {
    /** Active `card.storage` provider id (also mirrored as the legacy storage-engine label). */
    storageEngine: string;
    /** Fully resolved provider selections, or `null` when a pre-built storage engine was injected. */
    providers: ResolvedCapabilities | null;
    /** Whether the active card provider stores cards as local files. */
    isFileBacked: boolean;
    /** File-watcher glob for local card files, or `null` for non-file-backed providers. */
    watchGlob: string | null;
}
/**
 * Active auth provider metadata for diagnostics and host surfaces.
 *
 * Mirrors the same diagnostic-status pattern as {@link StorageStatus}.
 * Host surfaces (REST API, CLI, MCP) can surface this to help operators
 * understand whether token-based auth enforcement is live.
 */
export interface AuthStatus {
    /** Active `auth.identity` provider id. `'noop'` when no auth plugin is configured. */
    identityProvider: string;
    /** Active `auth.policy` provider id. `'noop'` when no auth plugin is configured. */
    policyProvider: string;
    /**
     * `true` when a real (non-noop) identity provider is active, meaning token
     * validation is being performed.
     */
    identityEnabled: boolean;
    /**
     * `true` when a real (non-noop) policy provider is active, meaning action-level
     * authorization checks are being performed.
     */
    policyEnabled: boolean;
}
type ReadonlySnapshot<T> = T extends (...args: never[]) => unknown ? T : T extends readonly (infer U)[] ? readonly ReadonlySnapshot<U>[] : T extends object ? {
    readonly [K in keyof T]: ReadonlySnapshot<T[K]>;
} : T;
/** Shared plugin secret redaction targets that every surface must honor. */
export declare const PLUGIN_SETTINGS_REDACTION_TARGETS: readonly ["read", "list", "error"];
/** Default write-only secret masking policy for plugin settings contracts. */
export declare const DEFAULT_PLUGIN_SETTINGS_REDACTION: PluginSettingsRedactionPolicy;
/** Supported install scopes for in-product plugin installation requests. */
export declare const PLUGIN_SETTINGS_INSTALL_SCOPES: readonly ["workspace", "global"];
/** Exact package-name matcher for install requests accepted by the plugin settings contract. */
export declare const EXACT_PLUGIN_SETTINGS_PACKAGE_NAME_PATTERN: RegExp;
/** Stable validation error codes for plugin settings contract violations. */
export type PluginSettingsValidationErrorCode = 'invalid-plugin-install-package-name' | 'invalid-plugin-install-scope';
/** Error thrown when plugin settings SDK operations fail with a redacted payload. */
export declare class PluginSettingsOperationError extends Error {
    readonly payload: PluginSettingsErrorPayload;
    constructor(payload: PluginSettingsErrorPayload);
}
/** Error thrown when a plugin settings contract validation boundary rejects input. */
export declare class PluginSettingsValidationError extends Error {
    readonly code: PluginSettingsValidationErrorCode;
    constructor(code: PluginSettingsValidationErrorCode, message: string);
}
/** Fixed argv install command emitted by the SDK-owned plugin installer. */
export interface PluginSettingsInstallCommand {
    command: 'npm';
    args: string[];
    cwd: string;
    shell: false;
}
/** Structured success payload returned by guarded plugin install requests. */
export interface PluginSettingsInstallResult {
    packageName: string;
    scope: PluginSettingsInstallScope;
    command: PluginSettingsInstallCommand;
    stdout: string;
    stderr: string;
    message: string;
    redaction: PluginSettingsRedactionPolicy;
}
/** Returns `true` when `value` is a supported plugin install scope. */
export declare function isPluginSettingsInstallScope(value: unknown): value is PluginSettingsInstallScope;
/** Returns `true` when `value` is an exact unscoped `kl-*` npm package name. */
export declare function isExactPluginSettingsPackageName(value: unknown): value is string;
/**
 * Validates the SDK install request contract for plugin settings flows.
 *
 * Only exact unscoped `kl-*` package names are accepted. Version specifiers,
 * paths, URLs, shell fragments, whitespace-delimited arguments, and other
 * npm wrapper syntax are rejected at this boundary before any subprocess work
 * is attempted.
 */
export declare function validatePluginSettingsInstallRequest(input: {
    packageName: unknown;
    scope: unknown;
}): PluginSettingsInstallRequest;
/** Applies the shared plugin secret redaction policy to surfaced error payloads. */
export declare function createPluginSettingsErrorPayload(input: {
    code: string;
    message: string;
    capability?: PluginCapabilityNamespace;
    providerId?: string;
    details?: Record<string, unknown>;
    redaction?: PluginSettingsRedactionPolicy;
}): PluginSettingsErrorPayload;
/**
 * Active webhook provider metadata for diagnostics and host surfaces.
 *
 * Mirrors the same diagnostic-status pattern as {@link StorageStatus}.
 * Host surfaces (REST API, CLI, MCP) can surface this to help operators
 * understand whether an external webhook delivery plugin is live.
 */
export interface WebhookStatus {
    /**
     * Active `webhook.delivery` provider id.
     * Returns `'none'` when `kl-plugin-webhook` is not installed.
     */
    webhookProvider: string;
    /**
     * `true` when an external webhook provider plugin is active.
     * `false` when `kl-plugin-webhook` is not installed.
     */
    webhookProviderActive: boolean;
}
/** Active card-state provider metadata for diagnostics and host surfaces. */
export type CardStateRuntimeStatus = CardStateStatus;
type PluginSettingsProviderReadModel = PluginSettingsReadPayload & Pick<PluginSettingsProviderRow, 'packageName' | 'discoverySource' | 'optionsSchema'>;
/**
 * Optional search and sort inputs for {@link KanbanSDK.listCards}.
 *
 * The object form is the recommended public contract for new callers because it
 * keeps structured metadata filters, free-text search, fuzzy search, and sort
 * options in one explicit shape.
 *
 * @example
 * ```ts
 * const cards = await sdk.listCards(undefined, 'bugs', {
 *   searchQuery: 'release meta.team: backend',
 *   metaFilter: { 'links.jira': 'PROJ-' },
 *   sort: 'modified:desc',
 *   fuzzy: true,
 * })
 * ```
 */
export interface ListCardsOptions {
    /**
     * Optional map of dot-notation metadata paths to required values.
     * Each entry is AND-based and field-scoped.
     */
    metaFilter?: Record<string, string>;
    /**
     * Optional sort order. Defaults to fractional board order.
     */
    sort?: CardSortOption;
    /**
     * Optional free-text query. The query may also include inline
     * `meta.field: value` tokens, which are merged with `metaFilter`.
     */
    searchQuery?: string;
    /**
     * Enables fuzzy matching when `true`. Exact substring matching remains the default.
     */
    fuzzy?: boolean;
}
/**
 * Core SDK for managing kanban boards with provider-backed card storage.
 *
 * Provides full CRUD operations for boards, cards, columns, comments,
 * attachments, and display settings. By default cards are persisted as
 * markdown files with YAML frontmatter under the `.kanban/` directory,
 * organized by board and status column, but the resolved `card.storage`
 * provider may also route card/comment persistence to SQLite, MySQL, or an
 * external plugin.
 *
 * This class is the foundation that the CLI, MCP server, and standalone
 * HTTP server are all built on top of.
 *
 * @example
 * ```ts
 * const sdk = new KanbanSDK('/path/to/project/.kanban')
 * await sdk.init()
 * const cards = await sdk.listCards()
 * ```
 */
export declare class KanbanSDK {
    private _migrated;
    private _onEvent?;
    private readonly _eventBus;
    private _webhookPlugin;
    private _pluginInstallRunner;
    /** @internal */ _storage: StorageEngine;
    private _capabilities;
    /** @internal Async-scoped auth carrier. Installed per request scope via {@link runWithAuth}. */
    private static readonly _authStorage;
    /** @internal */
    private static _runWithScopedAuth;
    /** @internal */
    private static _getScopedAuth;
    /**
     * Absolute path to the `.kanban` kanban directory.
     * The parent of this directory is treated as the workspace root.
     */
    readonly kanbanDir: string;
    /**
     * Creates a new KanbanSDK instance.
     *
     * @param kanbanDir - Absolute path to the `.kanban` kanban directory.
     *   When omitted, the directory is auto-detected by walking up from
     *   `process.cwd()` to find the workspace root (via `.git`, `package.json`,
     *   or `.kanban.json`), then reading `kanbanDirectory` from `.kanban.json`
     *   (defaults to `'.kanban'`).
     * @param options - Optional configuration including an event handler callback
     *   and storage engine selection.
     *
     * @example
     * ```ts
     * // Auto-detect from process.cwd()
     * const sdk = new KanbanSDK()
     *
     * // Explicit path
     * const sdk = new KanbanSDK('/home/user/my-project/.kanban')
     *
     * // With event handler for webhooks
     * const sdk = new KanbanSDK('/home/user/my-project/.kanban', {
     *   onEvent: (event, data) => fireWebhooks(root, event, data)
     * })
     *
     * // Force SQLite storage
     * const sdk = new KanbanSDK('/home/user/my-project/.kanban', {
     *   storageEngine: 'sqlite'
     * })
     * ```
     */
    constructor(kanbanDir?: string, options?: SDKOptions);
    /**
     * The underlying SDK event bus for advanced event workflows.
     *
     * Most consumers can use the convenience proxy methods on `KanbanSDK`
     * itself (`on`, `once`, `many`, `onAny`, `waitFor`, etc.). Access the
     * raw bus directly when you specifically need the shared `EventBus`
     * instance.
     */
    get eventBus(): EventBus;
    /** Subscribe to an SDK event or wildcard pattern. */
    on(event: string, listener: (payload: SDKEvent) => void): () => void;
    /** Subscribe to the next matching SDK event only once. */
    once(event: string, listener: (payload: SDKEvent) => void): () => void;
    /** Subscribe to an SDK event a fixed number of times. */
    many(event: string, timesToListen: number, listener: (payload: SDKEvent) => void): () => void;
    /** Subscribe to every SDK event regardless of name. */
    onAny(listener: EventBusAnyListener): () => void;
    /** Remove a specific event listener. */
    off(event: string, listener: (payload: SDKEvent) => void): void;
    /** Remove a specific catch-all listener. */
    offAny(listener: EventBusAnyListener): void;
    /** Remove all event listeners for one event, or all listeners when omitted. */
    removeAllListeners(event?: string): void;
    /** Return the registered event names currently tracked by the bus. */
    eventNames(): string[];
    /** Get the number of listeners for a specific event, or all listeners when omitted. */
    listenerCount(event?: string): number;
    /** Check whether any listeners are registered for an event or for the bus overall. */
    hasListeners(event?: string): boolean;
    /** Wait for the next matching SDK event and resolve with its payload. */
    waitFor(event: string, options?: EventBusWaitOptions): Promise<SDKEvent>;
    /**
     * The active storage engine powering this SDK instance.
     * Returns the resolved `card.storage` provider implementation
     * (for example `markdown`, `sqlite`, or `mysql`).
     */
    get storageEngine(): StorageEngine;
    /**
     * The resolved storage/attachment capability bag for this SDK instance.
     * Returns `null` when a pre-built storage engine was injected directly.
     */
    get capabilities(): ResolvedCapabilityBag | null;
    /**
     * Returns storage/provider metadata for host surfaces and diagnostics.
     *
     * Use this to inspect resolved provider ids, file-backed status, and
     * watcher behavior without reaching into capability internals.
     *
     * @returns A {@link StorageStatus} snapshot containing the active provider id,
     *   resolved provider selections (when available), whether cards are backed by
     *   local files, and the watcher glob used by file-backed hosts.
     *
     * @example
     * ```ts
     * const status = sdk.getStorageStatus()
     * console.log(status.storageEngine) // 'markdown' | 'sqlite' | 'mysql' | ...
    * console.log(status.watchGlob) // e.g. markdown card glob for board/status directories
     * ```
     */
    getStorageStatus(): StorageStatus;
    /**
     * Returns auth provider metadata for host surfaces and diagnostics.
     *
     * Use this to inspect which identity and policy providers are active
     * and whether real auth enforcement is enabled.
     *
     * @returns An {@link AuthStatus} snapshot containing the active provider ids
     *   and boolean flags indicating whether non-noop providers are live.
     *
     * @example
     * ```ts
     * const status = sdk.getAuthStatus()
     * console.log(status.identityProvider) // 'noop' | 'my-token-plugin' | ...
     * console.log(status.identityEnabled)  // false when no plugin configured
     * ```
     */
    getAuthStatus(): AuthStatus;
    /**
     * Resolves the minimal mobile bootstrap contract for a workspace entry attempt.
     *
     * This SDK-owned seam keeps the supported v1 auth contract explicit without
     * introducing a duplicate username/password API. The result always stays scoped
     * to the existing `local` auth provider, preserves the browser cookie-login
     * assumption for standalone `/auth/login`, and advertises the approved opaque
     * bearer transport that the mobile app will store after the real login or token
     * redemption flow completes.
     *
     * @param input - Workspace bootstrap request from a typed origin, deep link, or QR entry.
     * @returns The canonical workspace origin plus the next supported auth step.
     * @throws {Error} If `workspaceOrigin` is empty or not an absolute URL.
     *
     * @example
     * ```ts
     * const bootstrap = await sdk.resolveMobileBootstrap({
     *   workspaceOrigin: 'https://field.example.com/app/',
     *   bootstrapToken: 'one-time-link-token'
     * })
     *
     * console.log(bootstrap.workspaceOrigin) // 'https://field.example.com'
     * console.log(bootstrap.nextStep) // 'redeem-bootstrap-token'
     * ```
     */
    resolveMobileBootstrap(input: ResolveMobileBootstrapInput): Promise<ResolveMobileBootstrapResult>;
    /**
     * Builds the safe mobile session-status payload returned after restore validation.
     *
     * Host layers should call this only after validating the opaque mobile session
     * credential against the server-owned session store. The returned shape is safe
     * for no-stale-flash restore gates because it includes only workspace/subject
     * namespace metadata and the fixed transport contract — never the raw token,
     * password, or browser cookie material.
     *
     * @param input - Validated mobile session metadata to surface back to the app.
     * @returns A normalized session-status payload suitable for cold-start/resume checks.
     * @throws {Error} If `workspaceOrigin` or `subject` is empty, or if `workspaceOrigin` is not an absolute URL.
     *
     * @example
     * ```ts
     * const status = await sdk.inspectMobileSession({
     *   workspaceOrigin: 'https://field.example.com/mobile',
     *   subject: 'worker-7',
     *   roles: ['technician', 'reviewer']
     * })
     *
     * console.log(status.authentication.mobileSessionTransport) // 'opaque-bearer'
     * console.log(status.roles) // ['technician', 'reviewer']
     * ```
     */
    inspectMobileSession(input: InspectMobileSessionInput): Promise<MobileSessionStatus>;
    /**
     * Returns webhook provider metadata for host surfaces and diagnostics.
     *
    export type { CreateCardInput, SDKEventType, SDKBeforeEventType, SDKAfterEventType, SDKEventHandler, SDKOptions, AuthContext, AuthDecision, AuthErrorCategory, SDKEvent, SDKEventListener, EventListenerPlugin, BeforeEventPayload, AfterEventPayload, BeforeEventListenerResponse, SDKEventListenerPlugin, MobileAuthenticationContract, ResolveMobileBootstrapInput, ResolveMobileBootstrapResult, InspectMobileSessionInput, MobileSessionStatus, CardStateErrorCode, CardStateAvailability, CardStateBackend, CardStateStatus, DefaultCardStateActor, CardOpenStateValue, CardUnreadSummary, StorageEngine, StorageEngineType, CliPluginSdk, CliPluginContext, KanbanCliPlugin, SDKExtensionPlugin, SDKExtensionLoaderResult } from './types';
     * Use this to inspect which webhook delivery provider is active and whether
     * `kl-plugin-webhook` is installed.
     *
     * @returns A {@link WebhookStatus} snapshot containing the active provider id
     *   and a boolean flag indicating whether a provider is active.
     *
     * @example
     * ```ts
     * const status = sdk.getWebhookStatus()
     * console.log(status.webhookProvider)      // 'none' | 'webhooks' | ...
     * console.log(status.webhookProviderActive) // false when kl-plugin-webhook not installed
     * ```
     */
    getWebhookStatus(): WebhookStatus;
    /**
     * Lists the capability-grouped plugin provider inventory for the workspace.
     *
     * Discovery reuses the canonical runtime loader order so the returned rows
     * reflect providers that the SDK can actually resolve at runtime. Selected
     * state is derived from `.kanban.json`, and the payload carries the shared
     * plugin-settings redaction policy for downstream UI/API/CLI/MCP reuse.
     *
     * @returns A capability-grouped plugin settings inventory payload.
     */
    listPluginSettings(): Promise<PluginSettingsPayload>;
    /**
     * Returns the redacted plugin settings read model for one provider.
     *
     * The read model includes the provider's discovery source, current selected
     * state for the capability, any discovered options schema metadata, and a
     * redacted snapshot of persisted options when this provider is selected.
     *
     * @param capability - The capability namespace to inspect.
     * @param providerId - Provider identifier within that capability.
     * @returns The redacted provider read model, or `null` when the provider is not discovered.
     */
    getPluginSettings(capability: PluginCapabilityNamespace, providerId: string): Promise<PluginSettingsProviderReadModel | null>;
    /**
     * Persists the canonical selected provider for one capability inside `.kanban.json`.
     *
     * Selection is modeled only by the provider ref stored under `plugins[capability]`.
     * Re-selecting the same provider preserves any existing persisted options while
     * switching to a different provider replaces the previous single-provider entry.
     * Selecting `none` for `webhook.delivery` disables webhook runtime loading while
     * preserving any stored webhook options for later re-enable.
     *
     * @param capability - Capability namespace to update.
     * @param providerId - Provider identifier to select.
     * @returns The redacted provider read model after persistence succeeds, or `null`
     *   when the capability was explicitly disabled.
     */
    selectPluginSettingsProvider(capability: PluginCapabilityNamespace, providerId: string): Promise<PluginSettingsProviderReadModel | null>;
    /**
     * Persists provider options under the canonical capability-selection model.
     *
     * Secret fields remain write-only: callers may submit the shared masked value
     * placeholder to keep an existing stored secret unchanged, while any non-masked
     * replacement overwrites that secret. Persisting options also canonicalizes the
     * selected provider under `plugins[capability]`.
     *
     * @param capability - Capability namespace to update.
     * @param providerId - Provider identifier whose options are being updated.
     * @param options - Provider options payload to persist.
     * @returns The redacted provider read model after persistence succeeds.
     */
    updatePluginSettingsOptions(capability: PluginCapabilityNamespace, providerId: string, options: Record<string, unknown>): Promise<PluginSettingsProviderReadModel>;
    /**
     * Installs a supported external plugin package through guarded `npm install` execution.
     *
     * The SDK validates the request before launching a subprocess, accepts only exact
     * unscoped `kl-*` package names, always disables lifecycle scripts for in-product
     * installs, and redacts stdout/stderr before surfacing either the success payload
     * or a structured failure payload.
     *
     * @param input - Candidate package name and install scope to validate and install.
     * @returns Structured redacted success payload describing the executed npm command.
     * @throws {PluginSettingsOperationError} When validation fails or npm exits unsuccessfully.
     */
    installPluginSettingsPackage(input: {
        packageName: unknown;
        scope: unknown;
    }): Promise<PluginSettingsInstallResult>;
    /**
      * Returns card-state provider metadata for host surfaces and diagnostics.
      *
      * The status includes the stable auth-absent default actor contract and lets
      * callers distinguish configured-identity failures from true backend
      * unavailability via `availability` / `errorCode`.
     */
    getCardStateStatus(): CardStateRuntimeStatus;
    /**
     * Returns the SDK extension bag contributed by the plugin with the given `id`,
     * or `undefined` when no active plugin has exported a matching `sdkExtensionPlugin`.
     *
     * Use this to access plugin-owned SDK capabilities (e.g. webhook CRUD methods
     * contributed by `kl-plugin-webhook`) without importing plugin packages directly.
     *
     * @typeParam T - Shape of the expected extension bag.
     * @param id - The plugin manifest id to look up (e.g. `'kl-plugin-webhook'`).
     * @returns The resolved extension bag cast to `T`, or `undefined` when the plugin
     *   is not active or has not exported `sdkExtensionPlugin`.
     *
     * @example
     * ```ts
     * const webhookExt = sdk.getExtension<{ listWebhooks(): Webhook[] }>('kl-plugin-webhook')
     * const webhooks = webhookExt?.listWebhooks() ?? []
     * ```
     */
    getExtension<T extends Record<string, unknown> = Record<string, unknown>>(id: string): T | undefined;
    /** @internal */
    private _requireCardStateCapabilities;
    /** @internal */
    private _resolveCardStateTarget;
    /**
     * Derives a card-state target directly from a pre-loaded Card without a listCards round-trip.
     * @internal
     */
    private _resolveCardStateTargetDirect;
    /** @internal */
    private _resolveCardStateActorId;
    /** @internal */
    private _getLatestUnreadActivityCursor;
    /** @internal */
    private _createUnreadSummary;
    /**
     * Reads persisted card-state for the current actor without producing any side effects.
     *
      * When `domain` is omitted, the unread cursor domain is returned.
      * This method reads actor-scoped `card.state` only and does not reflect or
      * modify active-card UI state.
     */
    getCardState(cardId: string, boardId?: string, domain?: string): Promise<CardStateRecord | null>;
    /**
     * Batch-efficient read model for a pre-loaded card used during board init and broadcast.
     *
     * Unlike calling {@link getUnreadSummary} and {@link getCardState} separately, this method:
     * - Resolves the actor identity exactly once.
     * - Derives the board/card target from the supplied Card without an extra listCards round-trip.
     * - Runs log, unread-cursor, and open-state I/O concurrently.
     *
     * Use this when the caller already holds the full Card object (e.g. inside
     * `decorateCardsForWebview`) to avoid the N² file-scan that the individual
     * methods incur when called in a loop over all cards.
     *
     * @param card - The pre-loaded Card object.
     * @param fallbackBoardId - Board ID to use when `card.boardId` is not set.
     * @returns Unread summary and open-domain card-state record for the current actor.
     */
    getCardStateReadModelForCard(card: Card, fallbackBoardId?: string): Promise<{
        unread: CardUnreadSummary;
        open: CardStateRecord<CardOpenStateValue> | null;
    }>;
    /**
     * Batch variant of {@link getCardStateReadModelForCard} that returns read
     * models for every supplied card in a single pass. Providers with
     * `batchGetCardStates` support (e.g. Cloudflare D1) collapse per-card
     * round-trips into one per board.
     */
    getCardStateReadModelForCards(
        cards: readonly Card[],
        fallbackBoardId?: string,
    ): Promise<Map<string, {
        unread: CardUnreadSummary;
        open: CardStateRecord<CardOpenStateValue> | null;
    }>>;
    /**
      * Derives unread state for the current actor from persisted activity logs without mutating card state.
      *
      * Unread derivation is SDK-owned for both the built-in file-backed backend and
      * first-party compatibility backends such as `sqlite`.
     */
    getUnreadSummary(cardId: string, boardId?: string): Promise<CardUnreadSummary>;
    /**
     * Persists an explicit open-card mutation for the current actor.
     *
     * Opening a card records the `open` domain and acknowledges the latest unread
      * activity cursor for that actor without depending on `setActiveCard`.
      * This does not change workspace active-card UI state.
     */
    markCardOpened(cardId: string, boardId?: string): Promise<CardUnreadSummary>;
    /**
     * Persists an explicit read-through cursor for the current actor.
     *
     * Reads are side-effect free; call this method when you want to acknowledge
      * unread activity explicitly. Configured-identity failures surface as
      * `ERR_CARD_STATE_IDENTITY_UNAVAILABLE` rather than backend unavailability.
     */
    markCardRead(cardId: string, boardId?: string, readThrough?: CardStateCursor): Promise<CardUnreadSummary>;
    /**
     * Resolves caller identity and evaluates whether the named action is permitted.
     *
     * This is the internal SDK pre-action authorization seam. SDK methods that
     * represent mutating or privileged operations should call this before
     * executing their logic.
     *
     * When no auth plugins are configured the built-in noop path allows all
     * actions anonymously, preserving the current open-access behavior
     * for workspaces without an auth configuration.
     *
     * @param action  - Canonical action name (e.g. `'card.create'`, `'board.delete'`).
     * @param context - Optional auth context from the inbound request.
     * @returns Fulfilled {@link AuthDecision} when the action is permitted.
     * @throws {AuthError} When the policy plugin denies the action.
     *
     * @internal
     */
    _authorizeAction(action: string, context?: AuthContext): Promise<AuthDecision>;
    /**
     * Runs `fn` within an async scope where `auth` is the active auth context.
     *
     * Use this on host surfaces (REST routes, CLI commands, MCP handlers) to
     * bind a request-scoped {@link AuthContext} before calling SDK mutators.
     * The context is propagated automatically through every `await` in the call
     * tree without being threaded through method signatures.
     *
     * @param auth - Request-scoped auth context to install for the duration of `fn`.
     * @param fn   - Async callback to execute with the auth context active.
     * @returns The promise returned by `fn`.
     *
     * @example
     * ```ts
     * const card = await sdk.runWithAuth({ token: req.headers.authorization }, () =>
     *   sdk.createCard({ boardId: 'default', title: 'New task' })
     * )
     * ```
     */
    runWithAuth<T>(auth: AuthContext, fn: () => Promise<T>): Promise<T>;
    /** Returns the auth context installed by the nearest enclosing {@link runWithAuth} call, if any. @internal */
    get _currentAuthContext(): AuthContext | undefined;
    /** @internal */
    private _resolveEventActor;
    /** @internal */
    private static _cloneMergeValue;
    /**
     * Recursively deep-merges `source` into a shallow copy of `target`.
     *
     * - Plain objects are merged recursively; later keys override earlier keys at
     *   every depth.
     * - Arrays, primitives, and class instances in `source` **replace** the
     *   corresponding value in `target` (no concatenation of arrays).
     * - `target` itself is never mutated; the caller receives the merged clone.
     *
     * @internal
     */
    private static _deepMerge;
    /**
     * Dispatches a before-event to all registered listeners and returns a
     * deep-merged clone of the input.
     *
     * Clones `input` immediately with `structuredClone` so the caller's object
     * is never mutated. Awaits all registered before-event listeners in
     * registration order via {@link EventBus.emitAsync}. Each plain-object
     * listener response is deep-merged in registration order over the clone so
     * that later-registered listeners override earlier ones at every nesting
     * depth. Arrays in listener responses **replace** (no concatenation).
     * Non-plain-object, `void`, or empty `{}` responses contribute no keys and
     * the accumulated input stays effectively unchanged.
     *
     * **Throwing aborts the mutation:** any error thrown by a listener —
     * including {@link AuthError} — propagates immediately to the caller.
     * No subsequent listeners execute and no mutation write occurs.
     *
     * @param event   - Before-event name (e.g. `'card.create'`).
     * @param input   - Initial mutation input used as the clone/merge base.
     * @param actor   - Resolved acting principal, if known.
     * @param boardId - Board context for this action, if applicable.
     * @returns Promise resolving to the deep-merged input clone after all listeners settle.
     *
     * @internal
     */
    _runBeforeEvent<TInput extends Record<string, unknown>>(event: SDKBeforeEventType, input: TInput, actor?: string, boardId?: string): Promise<TInput>;
    /**
     * Emits an after-event exactly once after a mutation has been committed.
     *
     * Wraps `data` in an {@link AfterEventPayload} envelope and emits it on the event
     * bus as an {@link SDKEvent}. After-event listeners are non-blocking: the event bus
     * isolates errors per listener so a failing listener never prevents sibling listeners
     * from executing and never propagates to the SDK caller.
        *
        * The SDK reserves `meta.callback` for durable callback delivery metadata. Every
        * committed after-event receives a durable callback event ID before any queue enqueue
        * or direct handler dispatch, plus explicit event-plus-handler idempotency semantics
        * and the Cloudflare durable-record D1 budget contract: one claim/upsert plus one
        * checkpoint after each handler attempt, with the terminal summary folded into the
        * last checkpoint so the lifecycle budget is `1 + total handler attempts`.
     *
     * @param event   - After-event name (e.g. `'task.created'`).
     * @param data    - The committed mutation result.
     * @param actor   - Resolved acting principal, if known.
     * @param boardId - Board context for this event, if applicable.
        * @param meta    - Optional audit metadata. The SDK appends a reserved
        *   `meta.callback` contract before dispatch.
     *
     * @internal
     */
    _runAfterEvent<TResult>(event: SDKAfterEventType, data: TResult, actor?: string, boardId?: string, meta?: Record<string, unknown>): void;
    /**
     * Returns the local file path for a card when the active provider exposes one.
     *
     * This is most useful for editor integrations or diagnostics that need to open
     * or reveal the underlying source file. Providers that do not expose stable
     * local card files return `null`.
     *
     * @param card - The resolved card object.
     * @returns The absolute on-disk card path, or `null` when the active provider
     *   does not expose one.
     *
     * @example
     * ```ts
     * const card = await sdk.getCard('42')
     * if (card) {
     *   console.log(sdk.getLocalCardPath(card))
     * }
     * ```
     */
    getLocalCardPath(card: Card): string | null;
    /**
     * Returns the local attachment directory for a card when the active
     * attachment provider exposes one.
     *
     * File-backed providers typically return an absolute directory under the
     * workspace, while database-backed or remote attachment providers may return
     * `null` when attachments are not directly browseable on disk.
     *
     * @param card - The resolved card object.
     * @returns The absolute attachment directory, or `null` when the active
     *   attachment provider cannot expose one.
     */
    getAttachmentStoragePath(card: Card): string | null;
    /**
     * Requests an efficient in-place append for an attachment when the active
     * attachment provider supports it.
     *
     * Returns `true` when the provider handled the append directly and `false`
     * when callers should fall back to rewriting the attachment through the
     * normal copy/materialization path.
     */
    appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>;
    /** Reads raw attachment bytes, preferring provider-native byte helpers when available. */
    readAttachment(card: Card, attachment: string): Promise<{
        data: Uint8Array;
        contentType?: string;
    } | null>;
    /** Writes raw attachment bytes, preferring provider-native byte helpers when available. */
    writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void>;
    /**
     * Resolves or materializes a safe local file path for a named attachment.
     *
     * For simple file-backed providers this usually returns the existing file.
     * Other providers may need to materialize a temporary local copy first.
     * The method also guards against invalid attachment names and only resolves
     * files already attached to the card.
     *
     * @param card - The resolved card object.
     * @param attachment - Attachment filename exactly as stored on the card.
     * @returns An absolute local path, or `null` when the attachment cannot be
     *   safely exposed by the current provider.
     *
     * @example
     * ```ts
     * const card = await sdk.getCard('42')
     * const pdfPath = card ? await sdk.materializeAttachment(card, 'report.pdf') : null
     * ```
     */
    materializeAttachment(card: Card, attachment: string): Promise<string | null>;
    /**
     * Copies an attachment through the resolved attachment-storage capability.
     *
     * This is a low-level helper used by higher-level attachment flows. It writes
     * the supplied source file into the active attachment provider for the given
     * card, whether that provider is local filesystem storage or a custom plugin.
     *
     * @param sourcePath - Absolute or relative path to the source file to copy.
     * @param card - The target card that should own the copied attachment.
     */
    copyAttachment(sourcePath: string, card: Card): Promise<void>;
    /**
     * Closes the storage engine and releases any held resources (e.g. database
     * connections). Call this when the SDK instance is no longer needed.
     */
    close(): void;
    /** Tear down the SDK, destroying the event bus and all listeners. */
    destroy(): void;
    /**
     * Emits an event to the registered handler, if one exists.
     * Called internally after every successful mutating operation.
     */
    /** @internal */
    emitEvent(event: SDKEventType, data: unknown): void;
    /**
     * The workspace root directory (parent of the kanban directory).
     *
     * This is the project root where `.kanban.json` configuration lives.
     *
     * @returns The absolute path to the workspace root directory.
     *
     * @example
     * ```ts
     * const sdk = new KanbanSDK('/home/user/my-project/.kanban')
     * console.log(sdk.workspaceRoot) // '/home/user/my-project'
     * ```
     */
    get workspaceRoot(): string;
    /**
     * Returns a cloned read-only snapshot of the current workspace config.
     *
     * The returned snapshot is created from a fresh config read and deep-cloned
     * before being returned, so callers receive an isolated view of the current
     * `.kanban.json` state rather than a live mutable runtime object. Mutating the
     * returned snapshot does not update persisted config or affect this SDK instance.
     *
     * @returns A cloned read-only snapshot of the current {@link KanbanConfig}.
     *
     * @example
     * ```ts
     * const config = sdk.getConfigSnapshot()
     * console.log(config.defaultBoard)
     * ```
     */
    getConfigSnapshot(): ReadonlySnapshot<KanbanConfig>;
    /** @internal */
    _resolveBoardId(boardId?: string): string;
    /** @internal */
    _boardDir(boardId?: string): string;
    /** @internal */
    _isCompletedStatus(status: string, boardId?: string): boolean;
    /** @internal */
    _ensureMigrated(): Promise<void>;
    /**
     * Initializes the SDK by running any pending filesystem migrations and
     * ensuring the default board's directory structure exists.
     *
     * This should be called once before performing any operations, especially
     * on a fresh workspace or after upgrading from a single-board layout.
     *
     * @returns A promise that resolves when initialization is complete.
     *
     * @example
     * ```ts
     * const sdk = new KanbanSDK('/path/to/project/.kanban')
     * await sdk.init()
     * ```
     */
    init(): Promise<void>;
    /**
     * Lists all boards defined in the workspace configuration.
     *
     * @returns An array of {@link BoardInfo} objects containing each board's
      *   `id`, `name`, optional `description`, and display-title metadata config.
     *
     * @example
     * ```ts
     * const boards = sdk.listBoards()
     * // [{ id: 'default', name: 'Default Board', description: undefined }]
     * ```
     */
    listBoards(): BoardInfo[];
    /**
     * Creates a new board with the given ID and name.
     *
     * If no columns are specified, the new board inherits columns from the
     * default board. If the default board has no columns, a standard set of
     * five columns (Backlog, To Do, In Progress, Review, Done) is used.
     *
     * @param id - Unique identifier for the board (used in file paths and API calls).
     * @param name - Human-readable display name for the board.
     * @param options - Optional configuration for the new board.
     * @param options.description - A short description of the board's purpose.
     * @param options.columns - Custom column definitions. Defaults to the default board's columns.
     * @param options.defaultStatus - The default status for new cards. Defaults to the first column's ID.
     * @param options.defaultPriority - The default priority for new cards. Defaults to the workspace default.
     * @returns A {@link BoardInfo} object for the newly created board.
     * @throws {Error} If a board with the given `id` already exists.
     *
     * @example
     * ```ts
     * const board = sdk.createBoard('bugs', 'Bug Tracker', {
     *   description: 'Track and triage bugs',
     *   defaultStatus: 'triage'
     * })
     * ```
     */
    createBoard(id: string, name: string, options?: {
        description?: string;
        columns?: KanbanColumn[];
        defaultStatus?: string;
        defaultPriority?: Priority;
    }): Promise<BoardInfo>;
    /**
     * Deletes a board and its directory from the filesystem.
     *
     * The board must be empty (no cards) and must not be the default board.
     * The board's directory is removed recursively from disk, and the board
     * entry is removed from the workspace configuration.
     *
     * @param boardId - The ID of the board to delete.
     * @returns A promise that resolves when the board has been deleted.
     * @throws {Error} If the board does not exist.
     * @throws {Error} If the board is the default board.
     * @throws {Error} If the board still contains cards.
     *
     * @example
     * ```ts
     * await sdk.deleteBoard('old-sprint')
     * ```
     */
    deleteBoard(boardId: string): Promise<void>;
    /**
     * Retrieves the full configuration for a specific board.
     *
     * @param boardId - The ID of the board to retrieve.
      * @returns The {@link BoardConfig} object containing columns, settings, metadata, and display-title metadata config.
     * @throws {Error} If the board does not exist.
     *
     * @example
     * ```ts
     * const config = sdk.getBoard('default')
     * console.log(config.columns) // [{ id: 'backlog', name: 'Backlog', ... }, ...]
     * ```
     */
    getBoard(boardId: string): BoardConfig;
    /**
     * Updates properties of an existing board.
     *
     * Only the provided fields are updated; omitted fields remain unchanged.
     * The `nextCardId` counter cannot be modified through this method.
     *
     * @param boardId - The ID of the board to update.
     * @param updates - A partial object containing the fields to update.
     * @param updates.name - New display name for the board.
     * @param updates.description - New description for the board.
     * @param updates.columns - Replacement column definitions.
     * @param updates.defaultStatus - New default status for new cards.
     * @param updates.defaultPriority - New default priority for new cards.
    * @param updates.title - Ordered metadata keys whose values should prefix rendered card titles.
     * @returns The updated {@link BoardConfig} object.
     * @throws {Error} If the board does not exist.
     *
     * @example
     * ```ts
     * const updated = sdk.updateBoard('bugs', {
     *   name: 'Bug Tracker v2',
     *   defaultPriority: 'high'
     * })
     * ```
     */
    updateBoard(boardId: string, updates: Partial<Omit<BoardConfig, 'nextCardId'>>): Promise<BoardConfig>;
    /**
     * Returns the named actions defined on a board.
     *
     * @param boardId - Board ID. Defaults to the active board when omitted.
     * @returns A map of action key to display title.
     * @throws {Error} If the board does not exist.
      *
      * @example
      * ```ts
      * const actions = sdk.getBoardActions('deployments')
      * console.log(actions.deploy) // 'Deploy now'
      * ```
     */
    getBoardActions(boardId?: string): Record<string, string>;
    /**
     * Adds or updates a named action on a board.
     *
     * @param boardId - Board ID.
     * @param key - Unique action key (used as identifier).
     * @param title - Human-readable display title for the action.
     * @returns The updated actions map.
     * @throws {Error} If the board does not exist.
      *
      * @example
      * ```ts
      * sdk.addBoardAction('deployments', 'deploy', 'Deploy now')
      * ```
     */
    addBoardAction(boardId: string, key: string, title: string): Promise<Record<string, string>>;
    /**
     * Removes a named action from a board.
     *
     * @param boardId - Board ID.
     * @param key - The action key to remove.
     * @returns The updated actions map.
     * @throws {Error} If the board does not exist.
     * @throws {Error} If the action key is not found on the board.
      *
      * @example
      * ```ts
      * sdk.removeBoardAction('deployments', 'deploy')
      * ```
     */
    removeBoardAction(boardId: string, key: string): Promise<Record<string, string>>;
    /**
     * Fires the `board.action` webhook event for a named board action.
     *
     * @param boardId - The board that owns the action.
     * @param actionKey - The key of the action to trigger.
     * @throws {Error} If the board does not exist.
     * @throws {Error} If the action key is not defined on the board.
      *
      * @example
      * ```ts
      * await sdk.triggerBoardAction('deployments', 'deploy')
      * ```
     */
    triggerBoardAction(boardId: string, actionKey: string): Promise<void>;
    /**
     * Transfers a card from one board to another.
     *
     * The card file is physically moved to the target board's directory. If a
     * target status is not specified, the card is placed in the target board's
     * default status column. The card's order is recalculated to place it at
     * the end of the target column. Timestamps (`modified`, `completedAt`)
     * are updated accordingly.
     *
     * @param cardId - The ID of the card to transfer.
     * @param fromBoardId - The ID of the source board.
     * @param toBoardId - The ID of the destination board.
     * @param targetStatus - Optional status column in the destination board.
     *   Defaults to the destination board's default status.
     * @returns A promise resolving to the updated {@link Card} card object.
     * @throws {Error} If either board does not exist.
     * @throws {Error} If the card is not found in the source board.
     *
     * @example
     * ```ts
     * const card = await sdk.transferCard('42', 'inbox', 'bugs', 'triage')
     * console.log(card.boardId) // 'bugs'
     * console.log(card.status)  // 'triage'
     * ```
     */
    transferCard(cardId: string, fromBoardId: string, toBoardId: string, targetStatus?: string): Promise<Card>;
    /**
     * Lists all cards on a board, optionally filtered by column/status and search criteria.
     *
     * **Note:** This includes soft-deleted cards (status `'deleted'`).
     * Filter them out if you need only active cards.
     *
     * This method performs several housekeeping tasks during loading:
     * - Migrates flat root-level `.md` files into their proper status subdirectories
     * - Reconciles status/folder mismatches (moves files to match their frontmatter status)
     * - Migrates legacy integer ordering to fractional indexing
     * - Syncs the card ID counter with existing cards
     *
    * By default cards are returned sorted by their fractional order key (board order).
    * Pass a {@link CardSortOption} to sort by creation or modification date instead.
    *
    * Search behavior is storage-agnostic and is the same for markdown and SQLite workspaces:
    * - Exact mode is the default.
    * - Exact free-text search checks the legacy text fields: `content`, `id`, `assignee`, and `labels`.
    * - Inline `meta.field: value` tokens and `metaFilter` entries are always field-scoped and AND-based.
    * - In exact mode, metadata matching uses case-insensitive substring matching.
    * - In fuzzy mode, free-text search also considers metadata values, and field-scoped metadata checks gain fuzzy fallback matching.
    *
    * New code should prefer the object overload so search and sort options stay explicit.
    * The legacy positional parameters remain supported for backward compatibility.
     *
     * @param columns - Optional array of status/column IDs to filter by.
     *   When provided, ensures those subdirectories exist on disk.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
    * @param optionsOrMetaFilter - Either the recommended {@link ListCardsOptions} object,
    *   or the legacy positional `metaFilter` map for backward compatibility.
    * @param sort - Legacy positional sort order. One of `'created:asc'`, `'created:desc'`,
    *   `'modified:asc'`, `'modified:desc'`. Defaults to fractional board order.
    * @param searchQuery - Legacy positional free-text query, which may include
    *   `meta.field: value` tokens.
    * @param fuzzy - Legacy positional fuzzy-search toggle. Defaults to `false`.
     * @returns A promise resolving to an array of {@link Card} card objects.
     *
     * @example
     * ```ts
     * // List all cards on the default board
     * const allCards = await sdk.listCards()
     *
     * // List only cards in 'todo' and 'in-progress' columns on the 'bugs' board
     * const filtered = await sdk.listCards(['todo', 'in-progress'], 'bugs')
     *
     * // Preferred object form: exact metadata-aware search using inline meta tokens
     * const releaseCards = await sdk.listCards(undefined, undefined, {
     *   searchQuery: 'release meta.team: backend'
     * })
     *
     * // Preferred object form: fuzzy search across free text and metadata values
     * const fuzzyMatches = await sdk.listCards(undefined, undefined, {
     *   searchQuery: 'meta.team: backnd api plumbng',
     *   fuzzy: true
     * })
     *
     * // Structured metadata filters remain supported and are merged with inline meta tokens
     * const q1Jira = await sdk.listCards(undefined, undefined, {
     *   metaFilter: { sprint: 'Q1', 'links.jira': 'PROJ' },
     *   sort: 'created:desc'
     * })
     *
     * // Legacy positional form still works for existing callers
     * const newest = await sdk.listCards(undefined, undefined, undefined, 'created:desc', 'meta.team: backend', true)
     * ```
     */
    listCards(columns?: string[], boardId?: string, options?: ListCardsOptions): Promise<Card[]>;
    listCards(columns?: string[], boardId?: string, metaFilter?: Record<string, string>, sort?: CardSortOption, searchQuery?: string, fuzzy?: boolean): Promise<Card[]>;
    /**
     * Retrieves a single card by its ID.
     *
     * Supports partial ID matching -- the provided `cardId` is matched against
     * all cards on the board.
     *
     * @param cardId - The full or partial ID of the card to retrieve.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the matching {@link Card} card, or `null` if not found.
     *
     * @example
     * ```ts
     * const card = await sdk.getCard('42')
     * if (card) {
     *   console.log(card.content)
     * }
     * ```
     */
    getCard(cardId: string, boardId?: string): Promise<Card | null>;
    /**
     * Retrieves the card currently marked as active/open in this workspace.
     *
     * Active-card state is persisted in the workspace so other interfaces
     * (standalone server, CLI, MCP, and VS Code) can query the same card.
     * Returns `null` when no card is currently active.
     *
     * @param boardId - Optional board ID. When provided, returns the active card
     *   only if it belongs to that board.
     * @returns A promise resolving to the active {@link Card}, or `null`.
     *
     * @example
     * ```ts
     * const active = await sdk.getActiveCard()
     * if (active) {
     *   console.log(active.id)
     * }
     * ```
     */
    getActiveCard(boardId?: string): Promise<Card | null>;
    /** @internal */
    setActiveCard(cardId: string, boardId?: string): Promise<Card>;
    /** @internal */
    clearActiveCard(boardId?: string): Promise<void>;
    /**
     * Creates a new card on a board.
     *
     * The card is assigned an auto-incrementing numeric ID, placed at the end
     * of its target status column using fractional indexing, and persisted as a
     * markdown file with YAML frontmatter. If no status or priority is provided,
     * the board's defaults are used.
     *
     * @param data - The card creation input. See {@link CreateCardInput}.
     * @param data.content - Markdown content for the card. The first `# Heading` becomes the title.
     * @param data.status - Optional status column. Defaults to the board's default status.
     * @param data.priority - Optional priority level. Defaults to the board's default priority.
     * @param data.assignee - Optional assignee name.
     * @param data.dueDate - Optional due date as an ISO 8601 string.
     * @param data.labels - Optional array of label strings.
     * @param data.attachments - Optional array of attachment filenames.
     * @param data.metadata - Optional arbitrary key-value metadata stored in the card's frontmatter.
     * @param data.actions - Optional per-card actions as action keys or key-to-title map.
     * @param data.forms - Optional attached forms, using workspace-form references or inline definitions.
     * @param data.formData - Optional per-form persisted values keyed by resolved form ID.
     * @param data.boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the newly created {@link Card} card.
     *
     * @example
     * ```ts
     * const card = await sdk.createCard({
     *   content: '# Fix login bug\n\nUsers cannot log in with email.',
     *   status: 'todo',
     *   priority: 'high',
     *   labels: ['bug', 'auth'],
     *   boardId: 'bugs'
     * })
     * console.log(card.id) // '7'
     * ```
     */
    createCard(data: CreateCardInput): Promise<Card>;
    /**
     * Updates an existing card's properties.
     *
     * Only the provided fields are updated; omitted fields remain unchanged.
     * The `filePath`, `id`, and `boardId` fields are protected and cannot be
     * overwritten. If the card's title changes, the underlying file is renamed.
     * If the status changes, the file is moved to the new status subdirectory
     * and `completedAt` is updated accordingly.
    *
    * Common update fields include `content`, `status`, `priority`, `assignee`,
    * `dueDate`, `labels`, `metadata`, `actions`, `forms`, and `formData`.
     *
     * @param cardId - The ID of the card to update.
     * @param updates - A partial {@link Card} object with the fields to update.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const updated = await sdk.updateCard('42', {
     *   priority: 'critical',
     *   assignee: 'alice',
     *   labels: ['urgent', 'backend']
     * })
     * ```
     */
    updateCard(cardId: string, updates: Partial<Card>, boardId?: string): Promise<Card>;
    /**
     * Validates and persists a form submission for a card, then emits `form.submit`
     * through the normal SDK event/webhook pipeline.
     *
     * The target form must already be attached to the card, either as an inline
     * card-local form or as a named reusable workspace form reference.
     *
     * **Partial-at-rest semantics:** `card.formData[formId]` may be a partial
     * record at rest (containing only previously submitted or pre-seeded fields).
     * The merge below always produces a full canonical object, and that full
     * object is what gets persisted and returned as `result.data`.
     *
     * Merge order for the resolved base payload (lowest → highest priority):
     * 1. Workspace-config form defaults (`KanbanConfig.forms[formName].data`)
     * 2. Card-scoped attachment defaults (`attachment.data`)
     * 3. Persisted per-card form data (`card.formData[formId]`, may be partial)
     * 4. Card metadata fields that are declared in the form schema
     * 5. The submitted payload passed to this method
     *
     * Before the merge, string values in each source layer are prepared via
     * `prepareFormData()` (from `src/shared/formDataPreparation`), which resolves
     * `${path}` placeholders against the full card interpolation context.
     *
     * Validation happens authoritatively in the SDK before persistence and before
     * any event/webhook emission, so CLI/API/MCP/UI callers all share the same rules.
    * After a successful submit, the SDK also appends a system card log entry that
    * records the submitted payload under `payload` for audit/debug visibility.
     *
     * @param input - The form submission input.
     * @param input.cardId - ID of the card that owns the target form.
     * @param input.formId - Resolved form ID/name to submit.
     * @param input.data - Submitted field values to merge over the resolved base payload.
     * @param input.boardId - Optional board ID. Defaults to the workspace default board.
     * @returns The canonical persisted payload and event context. `result.data` is
     *   always the full merged and validated object (never a partial snapshot).
     * @throws {Error} If the card or form cannot be found, or if validation fails.
     *
     * @example
     * ```ts
     * const result = await sdk.submitForm({
     *   cardId: '42',
     *   formId: 'bug-report',
     *   data: { severity: 'high', title: 'Crash on save' }
     * })
     * console.log(result.data.severity) // 'high'
     * ```
     */
    submitForm(input: SubmitFormInput): Promise<SubmitFormResult>;
    /**
     * Triggers a named action for a card.
     *
     * Validates the card, appends an activity log entry, and emits the
     * `card.action.triggered` after-event so registered webhooks receive
     * the action payload automatically.
     *
     * @param cardId - The ID of the card to trigger the action for.
     * @param action - The action name string (e.g. `'retry'`, `'sendEmail'`).
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves when the action has been processed.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * await sdk.triggerAction('42', 'retry')
     * await sdk.triggerAction('42', 'sendEmail', 'bugs')
     * ```
     */
    triggerAction(cardId: string, action: string, boardId?: string): Promise<void>;
    /**
     * Moves a card to a different status column and/or position within that column.
     *
     * The card's fractional order key is recalculated based on the target
     * position. If the status changes, the underlying file is moved to the
     * corresponding subdirectory and `completedAt` is updated accordingly.
     *
     * @param cardId - The ID of the card to move.
     * @param newStatus - The target status/column ID.
     * @param position - Optional zero-based index within the target column.
     *   Defaults to the end of the column.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * // Move card to 'in-progress' at position 0 (top of column)
     * const card = await sdk.moveCard('42', 'in-progress', 0)
     *
     * // Move card to 'done' at the end (default)
     * const done = await sdk.moveCard('42', 'done')
     * ```
     */
    moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Card>;
    /**
     * Soft-deletes a card by moving it to the `deleted` status column.
     * The file remains on disk and can be restored.
     *
     * @param cardId - The ID of the card to soft-delete.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves when the card has been moved to deleted status.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * await sdk.deleteCard('42', 'bugs')
     * ```
     */
    deleteCard(cardId: string, boardId?: string): Promise<void>;
    /**
     * Permanently deletes a card's markdown file from disk.
     * This cannot be undone.
     *
     * @param cardId - The ID of the card to permanently delete.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves when the card file has been removed from disk.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * await sdk.permanentlyDeleteCard('42', 'bugs')
     * ```
     */
    permanentlyDeleteCard(cardId: string, boardId?: string): Promise<void>;
    /**
     * Returns all cards in a specific status column.
     *
     * This is a convenience wrapper around {@link listCards} that filters
     * by a single status value.
     *
     * @param status - The status/column ID to filter by (e.g., `'todo'`, `'in-progress'`).
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to an array of {@link Card} cards in the given status.
     *
     * @example
     * ```ts
     * const inProgress = await sdk.getCardsByStatus('in-progress')
     * console.log(`${inProgress.length} cards in progress`)
     * ```
     */
    getCardsByStatus(status: string, boardId?: string): Promise<Card[]>;
    /**
     * Returns a sorted list of unique assignee names across all cards on a board.
     *
     * Cards with no assignee are excluded from the result.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to a sorted array of unique assignee name strings.
     *
     * @example
     * ```ts
     * const assignees = await sdk.getUniqueAssignees('bugs')
     * // ['alice', 'bob', 'charlie']
     * ```
     */
    getUniqueAssignees(boardId?: string): Promise<string[]>;
    /**
     * Returns a sorted list of unique labels across all cards on a board.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to a sorted array of unique label strings.
     *
     * @example
     * ```ts
     * const labels = await sdk.getUniqueLabels()
     * // ['bug', 'enhancement', 'frontend', 'urgent']
     * ```
     */
    getUniqueLabels(boardId?: string): Promise<string[]>;
    /**
     * Returns all label definitions from the workspace configuration.
     *
     * Label definitions map label names to their color and optional group.
     * Labels on cards that have no definition will render with default gray styling.
     *
     * @returns A record mapping label names to {@link LabelDefinition} objects.
     *
     * @example
     * ```ts
     * const labels = sdk.getLabels()
     * // { bug: { color: '#e11d48', group: 'Type' }, docs: { color: '#16a34a' } }
     * ```
     */
    getLabels(): Record<string, LabelDefinition>;
    /**
     * Creates or updates a label definition in the workspace configuration.
     *
     * If the label already exists, its definition is replaced entirely.
     * The change is persisted to `.kanban.json` immediately.
     *
     * @param name - The label name (e.g. `'bug'`, `'frontend'`).
     * @param definition - The label definition with color and optional group.
     *
     * @example
     * ```ts
     * sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
     * sdk.setLabel('docs', { color: '#16a34a' })
     * ```
     */
    setLabel(name: string, definition: LabelDefinition): Promise<void>;
    /**
     * Removes a label definition from the workspace configuration and cascades
     * the deletion to all cards by removing the label from their `labels` array.
     *
     * @param name - The label name to remove.
     *
     * @example
     * ```ts
     * await sdk.deleteLabel('bug')
     * ```
     */
    deleteLabel(name: string): Promise<void>;
    /**
     * Renames a label in the configuration and cascades the change to all cards.
     *
     * Updates the label key in `.kanban.json` and replaces the old label name
     * with the new one on every card that uses it.
     *
     * @param oldName - The current label name.
     * @param newName - The new label name.
     *
     * @example
     * ```ts
     * await sdk.renameLabel('bug', 'defect')
     * // Config updated: 'defect' now has bug's color/group
     * // All cards with 'bug' label now have 'defect' instead
     * ```
     */
    renameLabel(oldName: string, newName: string): Promise<void>;
    /**
     * Returns a sorted list of label names that belong to the given group.
     *
     * Labels without an explicit `group` property are not matched by any
     * group name (they are considered ungrouped).
     *
     * @param group - The group name to filter by (e.g. `'Type'`, `'Priority'`).
     * @returns A sorted array of label names in the group.
     *
     * @example
     * ```ts
     * sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
     * sdk.setLabel('feature', { color: '#2563eb', group: 'Type' })
     *
     * sdk.getLabelsInGroup('Type')
     * // ['bug', 'feature']
     * ```
     */
    getLabelsInGroup(group: string): string[];
    /**
     * Returns all cards that have at least one label belonging to the given group.
     *
     * Looks up all labels in the group via {@link getLabelsInGroup}, then filters
     * cards to those containing any of those labels.
     *
     * @param group - The group name to filter by.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to an array of matching {@link Card} cards.
     *
     * @example
     * ```ts
     * const typeCards = await sdk.filterCardsByLabelGroup('Type')
     * // Returns all cards with 'bug', 'feature', or any other 'Type' label
     * ```
     */
    filterCardsByLabelGroup(group: string, boardId?: string): Promise<Card[]>;
    /**
     * Adds a file attachment to a card.
     *
     * The source file is copied into the card's directory (alongside its
     * markdown file) unless it already resides there. The attachment filename
     * is added to the card's `attachments` array if not already present.
     *
     * @param cardId - The ID of the card to attach the file to.
     * @param sourcePath - Path to the file to attach. Can be absolute or relative.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const card = await sdk.addAttachment('42', '/tmp/screenshot.png')
     * console.log(card.attachments) // ['screenshot.png']
     * ```
     */
    addAttachment(cardId: string, sourcePath: string, boardId?: string): Promise<Card>;
    /**
     * Adds a raw attachment payload to a card without requiring a source file path.
     */
    addAttachmentData(cardId: string, filename: string, data: string | Uint8Array, boardId?: string): Promise<Card>;
    /**
     * Removes an attachment reference from a card's metadata.
     *
     * This removes the attachment filename from the card's `attachments` array
     * but does not delete the physical file from disk.
     *
     * @param cardId - The ID of the card to remove the attachment from.
     * @param attachment - The attachment filename to remove (e.g., `'screenshot.png'`).
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const card = await sdk.removeAttachment('42', 'old-screenshot.png')
     * ```
     */
    removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Card>;
    /**
     * Lists all attachment filenames for a card.
     *
     * @param cardId - The ID of the card whose attachments to list.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to an array of attachment filename strings.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const files = await sdk.listAttachments('42')
     * // ['screenshot.png', 'debug-log.txt']
     * ```
     */
    listAttachments(cardId: string, boardId?: string): Promise<string[]>;
    /**
     * Reads raw attachment bytes for a card.
     */
    getAttachmentData(cardId: string, filename: string, boardId?: string): Promise<{
        data: Uint8Array;
        contentType?: string;
    } | null>;
    /**
     * Returns the absolute path to the attachment directory for a card.
     *
      * For the default markdown/localfs path this is typically
      * `{column_dir}/attachments/`. Other providers may return a different local
      * directory or `null` when attachments are not directly browseable on disk.
     *
     * @param cardId - The ID of the card.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the absolute directory path, or `null` if the card is not found.
     *
     * @example
     * ```ts
     * const dir = await sdk.getAttachmentDir('42')
     * // '/workspace/.kanban/boards/default/backlog/attachments'
     * ```
     */
    getAttachmentDir(cardId: string, boardId?: string): Promise<string | null>;
    /**
     * Lists all comments on a card.
     *
     * @param cardId - The ID of the card whose comments to list.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to an array of {@link Comment} objects.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const comments = await sdk.listComments('42')
     * for (const c of comments) {
     *   console.log(`${c.author}: ${c.content}`)
     * }
     * ```
     */
    listComments(cardId: string, boardId?: string): Promise<Comment[]>;
    /**
     * Adds a comment to a card.
     *
     * The comment is assigned an auto-incrementing ID (e.g., `'c1'`, `'c2'`)
     * based on the existing comments. The card's `modified` timestamp is updated.
     *
     * @param cardId - The ID of the card to comment on.
     * @param author - The name of the comment author.
     * @param content - The comment text content.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card (including the new comment).
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const card = await sdk.addComment('42', 'alice', 'This needs more investigation.')
     * console.log(card.comments.length) // 1
     * ```
     */
    addComment(cardId: string, author: string, content: string, boardId?: string): Promise<Card>;
    /**
     * Updates the content of an existing comment on a card.
     *
     * @param cardId - The ID of the card containing the comment.
     * @param commentId - The ID of the comment to update (e.g., `'c1'`).
     * @param content - The new content for the comment.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card.
     * @throws {Error} If the card is not found.
     * @throws {Error} If the comment is not found on the card.
     *
     * @example
     * ```ts
     * const card = await sdk.updateComment('42', 'c1', 'Updated: this is now resolved.')
     * ```
     */
    updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<Card>;
    /**
     * Deletes a comment from a card.
     *
     * @param cardId - The ID of the card containing the comment.
     * @param commentId - The ID of the comment to delete (e.g., `'c1'`).
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated {@link Card} card.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const card = await sdk.deleteComment('42', 'c2')
     * ```
     */
    deleteComment(cardId: string, commentId: string, boardId?: string): Promise<Card>;
    /**
     * Creates a comment on a card from a streaming text source, persisting it
     * once the stream is exhausted.
     *
     * This method is the streaming counterpart to {@link addComment}. It is
     * intended for use by AI agents that generate comment text incrementally
     * (e.g. an LLM `textStream`). The caller may supply `onStart` and `onChunk`
     * callbacks to fan live progress out to connected WebSocket viewers without
     * requiring intermediate disk writes.
     *
     * @param cardId - The ID of the card to comment on.
     * @param author - Display name of the streaming author.
     * @param stream - An `AsyncIterable<string>` that yields text chunks.
     * @param options.boardId - Optional board ID override.
     * @param options.onStart - Called once before iteration with the allocated
     *   comment ID, author, and ISO timestamp.
     * @param options.onChunk - Called after each chunk with the comment ID and
     *   the raw chunk string.
     * @returns A promise resolving to the updated {@link Card} once the stream
     *   has been fully consumed and the comment has been persisted.
     * @throws {Error} If the card is not found.
     * @throws {Error} If `author` is empty.
     *
     * @example
     * ```ts
     * // Stream an AI SDK textStream as a comment
     * const { textStream } = await streamText({ model, prompt })
     * const card = await sdk.streamComment('42', 'ai-agent', textStream, {
     *   onStart: (id, author, created) => broadcast({ type: 'commentStreamStart', cardId: '42', commentId: id, author, created }),
     *   onChunk: (id, chunk) => broadcast({ type: 'commentChunk', cardId: '42', commentId: id, chunk }),
     * })
     * ```
     */
    streamComment(cardId: string, author: string, stream: AsyncIterable<string>, options?: {
        boardId?: string;
        onStart?: (commentId: string, author: string, created: string) => void;
        onChunk?: (commentId: string, chunk: string) => void;
    }): Promise<Card>;
    /**
     * Returns the absolute path to the log file for a card.
     *
      * The log file is stored as the card attachment `<cardId>.log` through the
      * active `attachment.storage` provider. File-backed providers usually return
      * a stable workspace path, while remote providers may return a materialized
      * temporary local file path instead.
     *
     * @param cardId - The ID of the card.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the log file path, or `null` if the card is not found.
     */
    getLogFilePath(cardId: string, boardId?: string): Promise<string | null>;
    /**
     * Lists all log entries for a card.
     *
     * Reads the card's `.log` file and parses each line into a {@link LogEntry}.
     * Returns an empty array if no log file exists.
     *
     * @param cardId - The ID of the card whose logs to list.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to an array of {@link LogEntry} objects.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const logs = await sdk.listLogs('42')
     * for (const entry of logs) {
     *   console.log(`[${entry.source}] ${entry.text}`)
     * }
     * ```
     */
    listLogs(cardId: string, boardId?: string): Promise<LogEntry[]>;
    /**
     * Adds a log entry to a card.
     *
      * Appends a new line to the card's `.log` attachment via the active
      * attachment-storage capability. Providers may handle this with a native
      * append hook when available, otherwise the SDK falls back to a safe
      * read/modify/write cycle. If the file does not exist, it is created and
      * automatically added to the card's attachments array.
     * The timestamp defaults to the current time if not provided.
     * The source defaults to `'default'` if not provided.
     *
     * @param cardId - The ID of the card to add the log to.
     * @param text - The log message text. Supports inline markdown.
     * @param options - Optional log entry parameters.
     * @param options.source - Source/origin label. Defaults to `'default'`.
     * @param options.timestamp - ISO 8601 timestamp. Defaults to current time.
     * @param options.object - Optional structured data to attach as JSON.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the created {@link LogEntry}.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * const entry = await sdk.addLog('42', 'Build started')
     * const entry2 = await sdk.addLog('42', 'Deploy complete', {
     *   source: 'ci',
     *   object: { version: '1.2.3', duration: 42 }
     * })
     * ```
     */
    addLog(cardId: string, text: string, options?: {
        source?: string;
        timestamp?: string;
        object?: Record<string, unknown>;
    }, boardId?: string): Promise<LogEntry>;
    /**
     * Clears all log entries for a card by deleting the `.log` file.
     *
      * The log attachment reference is removed from the card's attachments array.
      * When a local/materialized file exists, it is deleted best-effort as well.
      * New log entries recreate the log attachment automatically.
     *
     * @param cardId - The ID of the card whose logs to clear.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves when the logs have been cleared.
     * @throws {Error} If the card is not found.
     *
     * @example
     * ```ts
     * await sdk.clearLogs('42')
     * ```
     */
    clearLogs(cardId: string, boardId?: string): Promise<void>;
    /**
     * Returns the absolute path to the board-level log file for a given board.
     *
     * The board log file is located at `.kanban/boards/<boardId>/board.log`,
     * at the same level as the column folders.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns The absolute path to `board.log` for the specified board.
     *
     * @example
     * ```ts
     * const logPath = sdk.getBoardLogFilePath()
     * // '/workspace/.kanban/boards/default/board.log'
     * ```
     */
    getBoardLogFilePath(boardId?: string): string;
    /**
     * Lists all log entries from the board-level log file.
     *
     * Returns an empty array if the log file does not exist yet.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves to an array of {@link LogEntry} objects, oldest first.
     *
     * @example
     * ```ts
     * const logs = await sdk.listBoardLogs()
     * // [{ timestamp: '2024-01-01T00:00:00.000Z', source: 'api', text: 'Card created' }]
     * ```
     */
    listBoardLogs(boardId?: string): Promise<LogEntry[]>;
    /**
     * Appends a new log entry to the board-level log file.
     *
     * Creates the log file if it does not yet exist.
     *
     * @param text - The human-readable log message.
     * @param options - Optional entry metadata: source label, ISO timestamp override, and structured object.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves to the created {@link LogEntry}.
     *
     * @example
     * ```ts
     * const entry = await sdk.addBoardLog('Board archived', { source: 'cli' })
     * ```
     */
    addBoardLog(text: string, options?: {
        source?: string;
        timestamp?: string;
        object?: Record<string, unknown>;
    }, boardId?: string): Promise<LogEntry>;
    /**
     * Clears all log entries for a board by deleting the board-level `board.log` file.
     *
     * New log entries will recreate the file automatically.
     * No error is thrown if the file does not exist.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise that resolves when the logs have been cleared.
     *
     * @example
     * ```ts
     * await sdk.clearBoardLogs()
     * ```
     */
    clearBoardLogs(boardId?: string): Promise<void>;
    /**
     * Lists all columns defined for a board.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns An array of {@link KanbanColumn} objects in their current order.
     *
     * @example
     * ```ts
     * const columns = sdk.listColumns('bugs')
     * // [{ id: 'triage', name: 'Triage', color: '#ef4444' }, ...]
     * ```
     */
    listColumns(boardId?: string): KanbanColumn[];
    /**
     * Adds a new column to a board.
     *
     * The column is appended to the end of the board's column list.
     *
     * @param column - The column definition to add.
     * @param column.id - Unique identifier for the column (used as status values on cards).
     * @param column.name - Human-readable display name.
     * @param column.color - CSS color string for the column header.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns The full updated array of {@link KanbanColumn} objects for the board.
     * @throws {Error} If the board is not found.
     * @throws {Error} If a column with the same ID already exists.
     * @throws {Error} If the column ID is `'deleted'` (reserved for soft-delete).
     *
     * @example
     * ```ts
     * const columns = sdk.addColumn(
     *   { id: 'blocked', name: 'Blocked', color: '#ef4444' },
     *   'default'
     * )
     * ```
     */
    addColumn(column: KanbanColumn, boardId?: string): Promise<KanbanColumn[]>;
    /**
     * Updates the properties of an existing column.
     *
     * Only the provided fields (`name`, `color`) are updated; the column's
     * `id` cannot be changed.
     *
     * @param columnId - The ID of the column to update.
     * @param updates - A partial object with the fields to update.
     * @param updates.name - New display name for the column.
     * @param updates.color - New CSS color string for the column.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns The full updated array of {@link KanbanColumn} objects for the board.
     * @throws {Error} If the board is not found.
     * @throws {Error} If the column is not found.
     *
     * @example
     * ```ts
     * const columns = sdk.updateColumn('in-progress', {
     *   name: 'Working On',
     *   color: '#f97316'
     * })
     * ```
     */
    updateColumn(columnId: string, updates: Partial<Omit<KanbanColumn, 'id'>>, boardId?: string): Promise<KanbanColumn[]>;
    /**
     * Removes a column from a board.
     *
     * The column must be empty (no cards currently assigned to it).
     * This operation cannot be undone.
     *
     * @param columnId - The ID of the column to remove.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the updated array of {@link KanbanColumn} objects.
     * @throws {Error} If the board is not found.
     * @throws {Error} If the column is not found.
     * @throws {Error} If the column still contains cards.
     * @throws {Error} If the column ID is `'deleted'` (reserved for soft-delete).
     *
     * @example
     * ```ts
     * const columns = await sdk.removeColumn('blocked', 'default')
     * ```
     */
    removeColumn(columnId: string, boardId?: string): Promise<KanbanColumn[]>;
    /**
     * Moves all cards in the specified column to the `deleted` (soft-delete) column.
     *
     * This is a non-destructive operation — cards are moved to the reserved
     * `deleted` status and can be restored or permanently deleted later.
     * The column itself is not removed.
     *
     * @param columnId - The ID of the column whose cards should be moved to `deleted`.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the number of cards that were moved.
     * @throws {Error} If the column is `'deleted'` (no-op protection).
     *
     * @example
     * ```ts
     * const moved = await sdk.cleanupColumn('blocked')
     * console.log(`Moved ${moved} cards to deleted`)
     * ```
     */
    cleanupColumn(columnId: string, boardId?: string): Promise<number>;
    /**
     * Permanently deletes all cards currently in the `deleted` column.
     *
     * This is equivalent to "empty trash". All soft-deleted cards are
     * removed from disk. This operation cannot be undone.
     *
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns A promise resolving to the number of cards that were permanently deleted.
     *
     * @example
     * ```ts
     * const count = await sdk.purgeDeletedCards()
     * console.log(`Permanently deleted ${count} cards`)
     * ```
     */
    purgeDeletedCards(boardId?: string): Promise<number>;
    /**
     * Reorders the columns of a board.
     *
     * The `columnIds` array must contain every existing column ID exactly once,
     * in the desired new order.
     *
     * @param columnIds - An array of all column IDs in the desired order.
     * @param boardId - Optional board ID. Defaults to the workspace's default board.
     * @returns The reordered array of {@link KanbanColumn} objects.
     * @throws {Error} If the board is not found.
     * @throws {Error} If any column ID in the array does not exist.
     * @throws {Error} If the array does not include all column IDs.
     *
     * @example
     * ```ts
     * const columns = sdk.reorderColumns(
     *   ['backlog', 'todo', 'blocked', 'in-progress', 'review', 'done'],
     *   'default'
     * )
     * ```
     */
    reorderColumns(columnIds: string[], boardId?: string): Promise<KanbanColumn[]>;
    /**
     * Returns the minimized column IDs for a board.
     *
     * @param boardId - Board to query (uses default board if omitted).
     * @returns Array of column IDs currently marked as minimized.
     */
    getMinimizedColumns(boardId?: string): string[];
    /**
     * Sets the minimized column IDs for a board, persisting the state to the
     * workspace config file. Stale or invalid IDs are silently dropped.
     *
     * @param columnIds - Column IDs to mark as minimized.
     * @param boardId - Board to update (uses default board if omitted).
     * @returns The sanitized list of minimized column IDs that was saved.
     */
    setMinimizedColumns(columnIds: string[], boardId?: string): Promise<string[]>;
    /**
     * Returns the global card display settings for the workspace.
     *
     * Display settings control which fields are shown on card previews
     * (e.g., priority badges, assignee avatars, due dates, labels).
     *
     * @returns The current {@link CardDisplaySettings} object.
     *
     * @example
     * ```ts
     * const settings = sdk.getSettings()
     * console.log(settings.showPriority) // true
     * ```
     */
    getSettings(): CardDisplaySettings;
    /**
     * Updates the global card display settings for the workspace.
     *
     * The provided settings object fully replaces the display settings
     * in the workspace configuration file (`.kanban.json`).
     *
     * @param settings - The new {@link CardDisplaySettings} to apply.
     *
     * @example
     * ```ts
     * sdk.updateSettings({
     *   showPriority: true,
     *   showAssignee: true,
     *   showDueDate: false,
     *   showLabels: true
     * })
     * ```
     */
    updateSettings(settings: CardDisplaySettings): Promise<void>;
    /**
     * Migrates all card data from the current storage engine to SQLite.
     *
     * Cards are scanned from every board using the active engine, then written
      * through the configured `sqlite` compatibility provider. After all data has
      * been copied the workspace `.kanban.json` is updated with
      * `storageEngine: 'sqlite'` and `sqlitePath` so that subsequent SDK instances
      * resolve the same compatibility provider.
     *
     * The existing markdown files are **not** deleted; they serve as a manual
     * backup until the caller explicitly removes them.
     *
     * @param dbPath - Path to the SQLite database file. Relative paths are
     *   resolved from the workspace root. Defaults to `'.kanban/kanban.db'`.
     * @returns The total number of cards migrated.
     * @throws {Error} If the current engine is already `'sqlite'`.
     *
     * @example
     * ```ts
     * const count = await sdk.migrateToSqlite()
     * console.log(`Migrated ${count} cards to SQLite`)
     * ```
     */
    migrateToSqlite(dbPath?: string): Promise<number>;
    /**
      * Migrates all card data from the current `sqlite` compatibility provider back
      * to markdown files.
     *
     * Cards are scanned from every board in the SQLite database and written as
     * individual `.md` files under `.kanban/boards/<boardId>/<status>/`. After
     * migration the workspace `.kanban.json` is updated to remove the
     * `storageEngine`/`sqlitePath` overrides so the default markdown engine is
     * used by subsequent SDK instances.
     *
     * The SQLite database file is **not** deleted; it serves as a manual backup.
     *
     * @returns The total number of cards migrated.
     * @throws {Error} If the current engine is already `'markdown'`.
     *
     * @example
     * ```ts
     * const count = await sdk.migrateToMarkdown()
     * console.log(`Migrated ${count} cards to markdown`)
     * ```
     */
    migrateToMarkdown(): Promise<number>;
    /**
     * Sets the default board for the workspace.
     *
     * @param boardId - The ID of the board to set as the default.
     * @throws {Error} If the board does not exist.
     *
     * @example
     * ```ts
     * sdk.setDefaultBoard('sprint-2')
     * ```
     */
    setDefaultBoard(boardId: string): Promise<void>;
    /**
     * Lists all registered webhooks.
     *
     * Delegates to the resolved `kl-plugin-webhook` provider.
     * Throws if no `webhook.delivery` provider is installed.
     *
     * @returns Array of {@link Webhook} objects.
     * @throws {Error} When `kl-plugin-webhook` is not installed.
     */
    listWebhooks(): Webhook[];
    /**
     * Creates and persists a new webhook.
     *
     * Delegates to the resolved `kl-plugin-webhook` provider.
     * Throws if no `webhook.delivery` provider is installed.
     *
     * @param webhookConfig - The webhook configuration.
     * @returns The newly created {@link Webhook}.
     * @throws {Error} When `kl-plugin-webhook` is not installed.
     */
    createWebhook(webhookConfig: {
        url: string;
        events: string[];
        secret?: string;
    }): Promise<Webhook>;
    /**
     * Deletes a webhook by its ID.
     *
     * Delegates to the resolved `kl-plugin-webhook` provider.
     * Throws if no `webhook.delivery` provider is installed.
     *
     * @param id - The webhook ID to delete.
     * @returns `true` if deleted, `false` if not found.
     * @throws {Error} When `kl-plugin-webhook` is not installed.
     */
    deleteWebhook(id: string): Promise<boolean>;
    /**
     * Updates an existing webhook's configuration.
     *
     * Delegates to the resolved `kl-plugin-webhook` provider.
     * Throws if no `webhook.delivery` provider is installed.
     *
     * @param id - The webhook ID to update.
     * @param updates - Partial webhook fields to merge.
     * @returns The updated {@link Webhook}, or `null` if not found.
     * @throws {Error} When `kl-plugin-webhook` is not installed.
     */
    updateWebhook(id: string, updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>): Promise<Webhook | null>;
}
export {};

import type { Card, CardFormAttachment, CardFormDataMap, Priority, ResolvedFormDescriptor } from '../shared/types'
import type { CapabilitySelections, Webhook } from '../shared/config'
import type { StorageEngine, StorageEngineType } from './plugins/types'
import type { CardStateCursor } from './plugins'

export type { StorageEngine, StorageEngineType } from './plugins/types'
export { MarkdownStorageEngine } from './plugins/markdown'

/**
 * Input data for creating a new kanban card.
 */
export interface CreateCardInput {
  /** The markdown body content of the card (title and description). */
  content: string
  /** The initial status column for the card (e.g., `"backlog"`, `"in-progress"`). Defaults to the first column. */
  status?: string
  /** The priority level of the card. Defaults to `"medium"`. */
  priority?: Priority
  /** The username of the person assigned to the card, or `null` for unassigned. */
  assignee?: string | null
  /** The due date as an ISO 8601 date string (e.g., `"2026-03-01"`), or `null` for no due date. */
  dueDate?: string | null
  /** An array of label strings to categorize the card. */
  labels?: string[]
  /** An array of attachment filenames associated with the card. */
  attachments?: string[]
  /** The board identifier when working with multiple boards. */
  boardId?: string
  /** Arbitrary user-defined metadata to store in the card's frontmatter. */
  metadata?: Record<string, unknown>
  /** Named actions that can be triggered via the action webhook. */
  actions?: string[] | Record<string, string>
  /** Forms attached to this card (named config-form references or inline definitions). */
  forms?: CardFormAttachment[]
  /** Per-form persisted data keyed by resolved form ID. */
  formData?: CardFormDataMap
}

/**
 * Before-event names emitted by the SDK immediately before a mutation is committed.
 *
 * Plugins may listen to these events and return plain-object partial overrides that
 * are collected by `EventBus.emitAsync` in listener-registration order and
 * deep-merged by `KanbanSDK._runBeforeEvent()` to influence the pending mutation
 * input. Throwing from a before-event listener aborts the action before any write
 * occurs.
 *
 * Naming convention: `resource.verb` (present tense).
 *
 * @see BeforeEventPayload for the payload envelope passed to before-event listeners.
 * @see BeforeEventListenerResponse for the allowed return type.
 */
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

/**
 * After-event names emitted by the SDK after a mutation has been committed.
 *
 * After-event listeners are non-blocking — errors are isolated per listener
 * and do not prevent sibling listeners or the overall SDK action from completing.
 *
 * Naming convention: `resource.pastTense`.
 *
 * @see AfterEventPayload for the payload envelope passed to after-event listeners.
 */
export type SDKAfterEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.deleted'
  | 'attachment.added'
  | 'attachment.removed'
  | 'settings.updated'
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'board.action'
  | 'card.action.triggered'
  | 'board.log.added'
  | 'board.log.cleared'
  | 'log.added'
  | 'log.cleared'
  | 'storage.migrated'
  | 'form.submitted'
  | 'auth.allowed'
  | 'auth.denied'

/**
 * Union of all SDK event types (before-events and after-events).
 *
 * Use {@link SDKBeforeEventType} when you need only pre-mutation event names,
 * or {@link SDKAfterEventType} when you need only post-mutation event names.
 *
 * **Before-events** (`resource.verb`): dispatched before a write; plugins may
 * return overrides or throw to veto the mutation.
 *
 * **After-events** (`resource.pastTense`): dispatched after a successful write;
 * listeners are non-blocking and error-isolated.
 */
export type SDKEventType = SDKBeforeEventType | SDKAfterEventType

/**
 * Callback invoked by the SDK after every mutating operation.
 *
 * @param event - The event type (e.g., `'task.created'`).
 * @param data - The event payload (sanitized card, column, comment, or board object).
 */
export type SDKEventHandler = (event: SDKEventType, data: unknown) => void

/** Typed event payload envelope emitted on the SDK event bus. */
export interface SDKEvent<T = unknown> {
  /** The event type identifier (e.g. 'task.created', 'auth.denied'). */
  readonly type: string
  /** The event payload data. */
  readonly data: T
  /** ISO-8601 timestamp of when the event was emitted. */
  readonly timestamp: string
  /** The actor (user/principal) who triggered the event, if known. */
  readonly actor?: string
  /** The board context for this event, if applicable. */
  readonly boardId?: string
  /** Additional metadata for extensibility. */
  readonly meta?: Record<string, unknown>
}

/** Listener callback for SDK event bus subscriptions. */
export type SDKEventListener<T = unknown> = (payload: SDKEvent<T>) => void

/**
 * Plugin contract for event bus subscribers (e.g. webhooks, audit logging).
 *
 * @deprecated Use {@link SDKEventListenerPlugin} instead. This interface assumes an
 * `init(bus, workspaceRoot)` factory pattern that is superseded by the listener-only
 * `register(bus)` / `unregister()` contract. Will be removed in a future release.
 */
export interface EventListenerPlugin {
  /** Plugin manifest with id and capability declarations. */
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /** Initialize the plugin and subscribe to events on the bus. */
  init(bus: import('./eventBus').EventBus, workspaceRoot: string): void
  /** Tear down the plugin and remove all event subscriptions. */
  destroy(): void
}

// ---------------------------------------------------------------------------
// Before/after event payload envelopes and plugin listener contract
// ---------------------------------------------------------------------------

/**
 * Payload envelope for before-events dispatched immediately before a mutation is
 * committed. This is the object passed to every registered before-event listener.
 *
 * Plugins may return a plain `Record<string, unknown>` partial override from their
 * listener. `EventBus.emitAsync` collects all plain-object responses in
 * listener-registration order and returns them as an ordered array.
 * `KanbanSDK._runBeforeEvent()` is the sole owner of cloning the input,
 * deep-merging those ordered outputs over it, and preserving the original input
 * when no listeners return meaningful overrides. Returning `void` contributes
 * nothing to the merge. Throwing any `Error` aborts the mutation entirely.
 *
 * **Auth note:** Authorization context is not carried in this payload. The SDK
 * resolves request identity through its own scoped carrier before dispatching
 * before-events; plugins that perform authorization checks should use the
 * `auth.allowed`/`auth.denied` after-events or the dedicated auth plugin contract.
 *
 * @typeParam TInput - The shape of the pending mutation's input data.
 *
 * @see BeforeEventListenerResponse for the allowed listener return type.
 * @see SDKBeforeEventType for the full set of before-event names.
 */
export interface BeforeEventPayload<TInput = Record<string, unknown>> {
  /** The before-event name (e.g. `'card.create'`, `'comment.delete'`). */
  readonly event: SDKBeforeEventType
  /**
   * The input data for the pending mutation.
   * Listener responses are collected and deep-merged by `_runBeforeEvent()`,
   * not by the event bus itself.
   */
  readonly input: TInput
  /** Resolved acting principal (e.g. a username or subject claim), if available. */
  readonly actor?: string
  /** Board context for this action, if applicable. */
  readonly boardId?: string
  /** ISO-8601 timestamp when this action was initiated by the SDK action runner. */
  readonly timestamp: string
}

/**
 * Payload envelope for after-events dispatched after a mutation has been committed.
 * After-event listeners are non-blocking — errors are caught per listener and do
 * not propagate to the SDK caller or prevent sibling listeners from executing.
 *
 * @typeParam TResult - The shape of the committed mutation result.
 *
 * @see SDKAfterEventType for the full set of after-event names.
 */
export interface AfterEventPayload<TResult = unknown> {
  /** The after-event name (e.g. `'task.created'`, `'comment.deleted'`). */
  readonly event: SDKAfterEventType
  /** The committed result of the mutation (e.g. the persisted card or comment). */
  readonly data: TResult
  /** Resolved acting principal, if available. */
  readonly actor?: string
  /** Board context for this event, if applicable. */
  readonly boardId?: string
  /** ISO-8601 timestamp when the mutation was committed. */
  readonly timestamp: string
  /** Optional audit metadata supplied by the SDK action runner. */
  readonly meta?: Record<string, unknown>
}

/**
 * Allowed return type from a plugin listener registered for a before-event.
 *
 * - **`Record<string, unknown>`** — plain-object partial override. `EventBus.emitAsync`
 *   collects all such responses in listener-registration order and returns them as
 *   an ordered array. `KanbanSDK._runBeforeEvent()` then deep-merges those outputs
 *   over a fresh clone of the original input so that later-registered listeners
 *   override keys set by earlier ones.
 * - **`void` / `undefined`** — contributes nothing to the merge; `_runBeforeEvent()`
 *   falls back to the original input when all listeners return nothing meaningful.
 * - **Thrown `Error`** — aborts the pending mutation before any write occurs.
 *
 * Non-plain-object return values (arrays, class instances, primitives) are
 * silently ignored and do not appear in the collected outputs.
 */
export type BeforeEventListenerResponse = Record<string, unknown> | void

/**
 * Listener-only runtime plugin contract.
 *
 * Plugins subscribe to SDK before/after events via `register()`. For before-events
 * a listener may return a {@link BeforeEventListenerResponse} plain-object to override
 * fields in the pending mutation or throw to veto it. After-event listeners must not
 * throw (errors are isolated and logged by the event bus).
 *
 * **Constraints:**
 * - Plugins MUST NOT call SDK mutation methods from within any listener.
 * - Storage and attachment capability providers use direct adapter interfaces and
 *   do not implement this contract.
 *
 * This interface supersedes the deprecated {@link EventListenerPlugin}.
 */
export interface SDKEventListenerPlugin {
  /** Plugin manifest with id and capability declarations. */
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /**
   * Register all event listeners on the bus.
   * Called once during SDK initialization after capability providers are resolved.
   */
  register(bus: import('./eventBus').EventBus): void
  /**
   * Remove all event listeners and release any plugin-owned resources.
   * Called once during SDK shutdown or when the plugin is removed.
   */
  unregister(): void
}

/**
 * Optional configuration for the {@link KanbanSDK} constructor.
 */
export interface SDKOptions {
  /**
   * Optional callback invoked after every mutating operation.
   * Useful for triggering webhooks, logging, or other side effects.
   */
  onEvent?: SDKEventHandler
  /**
   * Provide a fully constructed {@link StorageEngine} to use. Takes precedence
   * over `storageEngine` and `sqlitePath` when supplied.
   */
  storage?: StorageEngine
  /**
   * Override the storage engine type. Falls back to the value in `.kanban.json`
   * (`storageEngine` field), then to `'markdown'` if unset.
   */
  storageEngine?: StorageEngineType
  /**
   * Path to the SQLite database file (only relevant when `storageEngine` is
   * `'sqlite'`). If relative, resolved from the workspace root. Defaults to
   * `.kanban/kanban.db`.
   */
  sqlitePath?: string
  /**
   * Optional capability-provider overrides.
   * Any omitted namespace falls back to `.kanban.json` and legacy defaults.
   */
  capabilities?: CapabilitySelections
}

export interface SubmitFormInput {
  /** Card ID that owns the target attached form. */
  cardId: string
  /** Resolved form identifier (named config form id or inline generated id). */
  formId: string
  /** Submitted field values merged over the resolved base payload before validation. */
  data: Record<string, unknown>
  /** Optional board ID. Defaults to the workspace default board. */
  boardId?: string
}

export interface SubmitFormResult {
  /** Board that owns the submitted card/form. */
  boardId: string
  /** Sanitized persisted card snapshot after the successful form update. */
  card: Omit<Card, 'filePath'>
  /** Resolved form descriptor used for validation and downstream context. */
  form: ResolvedFormDescriptor
  /** Final validated payload that was persisted to `card.formData[form.id]`. */
  data: Record<string, unknown>
}

export type FormSubmitEvent = SubmitFormResult

/**
 * Strips the `filePath` property from a card before exposing it
 * in webhook payloads or API responses. The file path is an internal
 * implementation detail that should not be leaked externally.
 *
 * @param card - The card object to sanitize.
 * @returns A copy of the card without the `filePath` field.
 *
 * @example
 * const safe = sanitizeCard(card)
 * // safe.filePath is undefined
 */
export function sanitizeCard(card: Card): Omit<Card, 'filePath'> {
  const { filePath, ...rest } = card
  void filePath
  return rest
}

// ---------------------------------------------------------------------------
// Auth context, decision, and error vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical machine-readable auth error categories.
 *
 * Consumed by {@link AuthError} and {@link AuthDecision.reason} so that host
 * surfaces (HTTP API, CLI, MCP, extension) can map denial semantics to their
 * own error codes (e.g. HTTP 401 vs 403) without parsing error messages.
 */
export type AuthErrorCategory =
  | 'auth.identity.missing'  // No token supplied when one is required
  | 'auth.identity.invalid'  // Token present but failed validation
  | 'auth.identity.expired'  // Token present but expired
  | 'auth.policy.denied'     // Identity resolved but action not permitted
  | 'auth.policy.unknown'    // Policy plugin could not evaluate the action
  | 'auth.provider.error'    // Internal error from an identity or policy provider

/**
 * Authorization decision returned by {@link AuthPolicyPlugin.checkPolicy}.
 *
 * When {@link allowed} is `false`, {@link reason} provides a machine-readable
 * denial code suitable for mapping to HTTP 401/403, CLI exit codes, or MCP
 * tool error payloads.
 */
export interface AuthDecision {
  /** Whether the action is permitted. */
  allowed: boolean
  /** Machine-readable reason code. Present when {@link allowed} is `false`. */
  reason?: AuthErrorCategory
  /** Resolved caller subject from the identity plugin. Present when identity was established. */
  actor?: string
  /** Optional provider-supplied audit metadata (safe for logging). */
  metadata?: Record<string, unknown>
}

/**
 * Shared auth context passed from host surfaces into SDK operations.
 *
 * Host adapters (standalone server, CLI, MCP, extension) extract tokens from
 * their respective transports and construct this object before exercising the
 * SDK authorization seam. Tokens are never persisted to `.kanban.json`.
 */
export interface AuthContext {
  /**
   * Opaque bearer token provided by the host.
   * Never logged or surfaced in error responses.
   */
  token?: string
  /**
    * Identifies how the token was sourced (e.g. `'request-header'`, `'env'`, `'config'`, `'secret-storage'`).
   * Informational only; used for diagnostics and logging.
   */
  tokenSource?: string
  /**
    * Transport mechanism of the incoming request (e.g. `'http'`, `'mcp'`, `'extension'`, `'cli'`).
    * Informational only; used for diagnostics and logging.
    */
  transport?: string
  /**
   * Pre-resolved identity supplied by a trusted host integration such as
   * standalone middleware after validating a cookie-backed session.
   */
  identity?: { subject: string; roles?: string[] }
  /**
    * Optional non-authoritative hint for the caller identity.
    * Never trusted for authorization decisions; used for diagnostics and logging only.
    */
  actorHint?: string
  /** Target board ID relevant to the action being authorized. */
  boardId?: string
  /** Target card ID relevant to the action being authorized. */
  cardId?: string
  /** Source board ID for transfer-style operations. */
  fromBoardId?: string
  /** Destination board ID for transfer-style operations. */
  toBoardId?: string
  /** Target column/status ID relevant to the action being authorized. */
  columnId?: string
  /** Target comment ID relevant to the action being authorized. */
  commentId?: string
  /** Target form ID relevant to the action being authorized. */
  formId?: string
  /** Attachment filename relevant to the action being authorized. */
  attachment?: string
  /** Label name relevant to the action being authorized. */
  labelName?: string
  /** Webhook ID relevant to the action being authorized. */
  webhookId?: string
  /** Action key/name relevant to the action being authorized. */
  actionKey?: string
}

/**
 * Typed error thrown by the SDK authorization seam when a policy plugin
 * denies an action.
 *
 * Host surfaces should catch this to return appropriate error responses
 * (HTTP 403, CLI error output, MCP tool error) without leaking token material.
 */
export class AuthError extends Error {
  /** Machine-readable error category. */
  public readonly category: AuthErrorCategory
  /** Resolved caller subject when available (safe to include in error responses). */
  public readonly actor?: string

  constructor(category: AuthErrorCategory, message: string, actor?: string) {
    super(message)
    this.name = 'AuthError'
    this.category = category
    this.actor = actor
  }
}

/** Stable machine-readable error for configured-auth card-state calls without a resolved identity. */
export const ERR_CARD_STATE_IDENTITY_UNAVAILABLE = 'ERR_CARD_STATE_IDENTITY_UNAVAILABLE'

/** Stable machine-readable error for card-state calls when no provider is active. */
export const ERR_CARD_STATE_UNAVAILABLE = 'ERR_CARD_STATE_UNAVAILABLE'

/** Public card-state error codes shared across SDK, API, CLI, and MCP hosts. */
export type CardStateErrorCode =
  | typeof ERR_CARD_STATE_IDENTITY_UNAVAILABLE
  | typeof ERR_CARD_STATE_UNAVAILABLE

/** Stable mode name for the auth-absent card-state default actor contract. */
export const CARD_STATE_DEFAULT_ACTOR_MODE = 'auth-absent-only'

/**
 * Shared default actor contract for auth-absent card-state mode.
 *
 * This actor is only valid when no real `auth.identity` provider is configured.
 * All host surfaces should treat this as a stable public contract for both the
 * built-in file-backed `builtin` backend and first-party compatibility backends
 * such as `sqlite`.
 */
export const DEFAULT_CARD_STATE_ACTOR = Object.freeze({
  id: 'default-user',
  source: 'default',
  mode: CARD_STATE_DEFAULT_ACTOR_MODE,
} as const)

/** Stable type of the shared auth-absent card-state fallback actor. */
export type DefaultCardStateActor = typeof DEFAULT_CARD_STATE_ACTOR

/** Host-facing availability states for the public card-state status surface. */
export type CardStateAvailability = 'available' | 'identity-unavailable' | 'unavailable'

/** Host-facing backend family names for the public card-state status surface. */
export type CardStateBackend = 'builtin' | 'external' | 'none'

/** Stable built-in domain name for unread/read cursor persistence. */
export const CARD_STATE_UNREAD_DOMAIN = 'unread'

/** Stable built-in domain name for explicit actor-scoped open-card state persistence. */
export const CARD_STATE_OPEN_DOMAIN = 'open'

/**
 * Value persisted for the built-in explicit open-card mutation.
 *
 * This records actor-scoped `card.state` data and is distinct from workspace
 * active-card UI state such as `.active-card.json`.
 */
export interface CardOpenStateValue extends Record<string, unknown> {
  /** When the actor explicitly opened the card. */
  openedAt: string
  /** Latest unread-driving activity cursor acknowledged by the open mutation. */
  readThrough: CardStateCursor | null
}

/**
 * Side-effect-free unread snapshot resolved for one actor/card pair.
 *
 * This summary models actor-scoped unread/open semantics only; it does not
 * describe which card the UI currently considers active/open.
 */
export interface CardUnreadSummary {
  /** Resolved actor id used for this read or mutation. */
  actorId: string
  /** Resolved board id for the target card. */
  boardId: string
  /** Resolved full card id. */
  cardId: string
  /** Latest unread-driving activity cursor derived from persisted logs. */
  latestActivity: CardStateCursor | null
  /** Persisted read-through cursor for the current actor, when any. */
  readThrough: CardStateCursor | null
  /** `true` when the actor has unread activity beyond `readThrough`. */
  unread: boolean
}

/**
 * Public provider/status snapshot for `card.state` host surfaces.
 *
 * Host layers should use `availability` and `errorCode` to distinguish a real
 * backend outage from configured-identity failures where the backend is healthy
 * but no actor could be resolved.
 */
export interface CardStateStatus {
  /** Active `card.state` provider id, or `'none'` when unavailable. */
  provider: string
  /** `true` when a card-state provider is active. */
  active: boolean
  /** Backend family for high-level diagnostics. */
  backend: CardStateBackend
  /** Current availability classification for callers. */
  availability: CardStateAvailability
  /** Stable contract for when the default actor may be used. */
  defaultActorMode: typeof CARD_STATE_DEFAULT_ACTOR_MODE
  /** Shared auth-absent single-user fallback actor contract. */
  defaultActor: DefaultCardStateActor
  /** `true` only when the current auth configuration permits the default actor. */
  defaultActorAvailable: boolean
  /** Machine-readable error code when `availability !== 'available'`. */
  errorCode?: CardStateErrorCode
}

/**
 * Typed public error for card-state availability and identity failures.
 *
 * `ERR_CARD_STATE_IDENTITY_UNAVAILABLE` means a configured `auth.identity`
 * provider did not yield an actor. `ERR_CARD_STATE_UNAVAILABLE` means no active
 * `card.state` backend is available.
 */
export class CardStateError extends Error {
  /** Machine-readable error code. */
  public readonly code: CardStateErrorCode
  /** Status classification derived from {@link code}. */
  public readonly availability: Exclude<CardStateAvailability, 'available'>

  constructor(code: CardStateErrorCode, message: string) {
    super(message)
    this.name = 'CardStateError'
    this.code = code
    this.availability = code === ERR_CARD_STATE_IDENTITY_UNAVAILABLE
      ? 'identity-unavailable'
      : 'unavailable'
  }
}

/**
 * Minimal SDK webhook facade supplied to CLI plugins via {@link CliPluginContext}.
 *
 * Structural subset of `KanbanSDK`; plugins should use this surface instead of
 * importing `KanbanSDK` directly so they remain decoupled from core internals.
 */
export interface CliPluginSdk {
  /**
   * Returns the SDK extension bag contributed by the plugin with the given id,
   * when the host is backed by a full `KanbanSDK` instance.
   *
   * CLI plugins should prefer this extension path when available and fall back
   * to compatibility methods only when running against older or mocked SDK facades.
   */
  getExtension?<T extends Record<string, unknown> = Record<string, unknown>>(id: string): T | undefined
  listWebhooks(): Webhook[]
  createWebhook(input: { url: string; events: string[]; secret?: string }): Promise<Webhook>
  updateWebhook(
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): Promise<Webhook | null>
  deleteWebhook(id: string): Promise<boolean>
}

/**
 * Runtime context supplied to a {@link KanbanCliPlugin} when it is invoked by
 * the `kl` CLI.
 */
export interface CliPluginContext {
  /** Absolute path to the workspace root that contains `.kanban.json`. */
  workspaceRoot: string
  /**
   * Resolved SDK instance for the current workspace.
   *
   * Present when the plugin is invoked through the core `kl` CLI.
   * Absent in isolated unit tests or standalone invocations.
   * Plugins should prefer this over constructing their own SDK so that
   * SDK-level auth policy is honoured.
   */
  sdk?: CliPluginSdk
  /**
   * Core-owned CLI auth helper.
   *
   * Wraps mutating SDK calls with the CLI auth context derived from the
   * environment (`KANBAN_LITE_TOKEN` / `KANBAN_TOKEN`).  Use this instead
   * of calling SDK methods directly from CLI plugins so authentication and
   * policy enforcement are handled by core.
   */
  runWithCliAuth?: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * Optional CLI extension that a plugin package may export as the named export
 * `cliPlugin`.
 *
 * When the `kl` CLI resolves a top-level command that matches the plugin's
 * {@link command} namespace (and no built-in handler claims it), or when a
 * built-in handler encounters an unknown sub-command, it delegates to
 * {@link run}.
 *
 * @example
 * ```typescript
 * // exported from the plugin package as `export const cliPlugin`
 * export const cliPlugin: KanbanCliPlugin = {
 *   manifest: { id: 'my-plugin' },
 *   command: 'auth',
 *   async run(subArgs, flags, context) {
 *     // handle sub-commands
 *   },
 * }
 * ```
 */
export interface KanbanCliPlugin {
  /** Plugin manifest identifying this extension. */
  readonly manifest: { readonly id: string }
  /**
   * Top-level CLI namespace owned by this plugin (e.g. `"auth"`).
   * Must match the first positional argument after `kl`.
   */
  readonly command: string
  /**
   * Optional compatibility aliases that should route to {@link command}.
   *
   * Useful for preserving historical shorthand command names after ownership
   * moves fully into a plugin package.
   */
  readonly aliases?: readonly string[]
  /**
   * Execute the plugin CLI command.
   *
   * @param subArgs  Positional arguments after the top-level command token.
   * @param flags    Parsed flag map (`string | boolean` values).
   * @param context  Runtime context including the workspace root path.
   */
  run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: CliPluginContext,
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// SDK extension plugin contract
// ---------------------------------------------------------------------------

/**
 * Optional SDK extension pack contributed by a plugin package.
 *
 * Plugins may export `sdkExtensionPlugin` to contribute named SDK methods or
 * capabilities to the active SDK instance. Extensions are loaded alongside the
 * plugin's capability providers and become accessible through
 * `sdk.getExtension(id)` or the `sdk.extensions` bag (SPE-02).
 *
 * **Authoring rules:**
 * - `manifest.id` should match the plugin's npm package name by convention.
 * - `extensions` must contain plain values or async functions — no class
 *   instances with hidden side-effecting constructors.
 * - This export is fully optional; plugins that omit it do not appear in the
 *   resolved `sdkExtensions` array and no existing capability exports change.
 *
 * @typeParam T - Shape of the named SDK extensions contributed by this plugin.
 */
export interface SDKExtensionPlugin<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Plugin manifest identifying this extension contribution. */
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /**
   * Named SDK methods or capabilities contributed by this plugin.
   * Accessible through `sdk.getExtension(manifest.id)` after capability resolution.
   */
  readonly extensions: T
}

/**
 * Resolved entry in the SDK extensions bag populated during capability bag resolution.
 *
 * Each entry corresponds to one active plugin package that exported
 * `sdkExtensionPlugin`. Consumed by `KanbanSDK.getExtension(id)` (SPE-02) and
 * the future `sdk.extensions` named-access bag.
 *
 * @typeParam T - Shape of the SDK extensions contributed by the owning plugin.
 */
export interface SDKExtensionLoaderResult<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Plugin id matching the contributing plugin's `manifest.id`. */
  readonly id: string
  /** Resolved SDK methods/capabilities from the plugin. */
  readonly extensions: T
}

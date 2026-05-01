import type { Card, CardFormAttachment, CardFormDataMap, CardTask, Priority } from '../../shared/types'
import type { CapabilitySelections } from '../../shared/config'
import type { KanbanSDK } from '../KanbanSDK'
import type { StorageEngine, StorageEngineType } from '../plugins/types'

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
  /** Optional initial checklist task items to seed on the card. */
  tasks?: CardTask[]
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
  | 'card.checklist.add'
  | 'card.checklist.edit'
  | 'card.checklist.delete'
  | 'card.checklist.check'
  | 'card.checklist.uncheck'
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
 * Phase filter used by {@link KanbanSDK.listAvailableEvents} and plugin-declared
 * event catalogs.
 */
export type SDKAvailableEventPhase = 'before' | 'after'

/**
 * Filtering options for {@link KanbanSDK.listAvailableEvents}.
 *
 * - `type: 'before'` returns only pre-mutation events.
 * - `type: 'after'` returns only post-mutation events.
 * - `type: 'all'` (default) returns both.
 * - `mask` supports dotted wildcard matching compatible with the SDK event bus
 *   (`*` for one segment, `**` for zero-or-more segments).
 */
export interface SDKAvailableEventsOptions {
  /** Event phase/type filter. Defaults to `'all'`. */
  readonly type?: SDKAvailableEventPhase | 'all'
  /** Optional dotted wildcard mask such as `'task.*'` or `'auth.**'`. */
  readonly mask?: string
}

/**
 * Event declaration that plugin packages may contribute through
 * `sdkExtensionPlugin.events`.
 *
 * These declarations are metadata-only. Declaring an event here does not emit or
 * subscribe to it automatically; it simply makes the event discoverable through
 * `sdk.listAvailableEvents()` and host surfaces that wrap that SDK method.
 */
export interface SDKPluginEventDeclaration {
  /** Custom or plugin-owned event name. Dotted namespaces are recommended. */
  readonly event: string
  /** Whether this is a pre-mutation (`'before'`) or post-mutation (`'after'`) event. */
  readonly phase: SDKAvailableEventPhase
  /** Optional resource/domain label shown in discovery UIs. */
  readonly resource?: string
  /** Optional human-readable label shown in discovery UIs. */
  readonly label?: string
  /**
   * Whether this after-event is expected to be surfaced remotely as an API/webhook
   * after-event. Ignored for before-events and defaults to `false`.
   */
  readonly apiAfter?: boolean
}

/**
 * Canonical descriptor returned by {@link KanbanSDK.listAvailableEvents}.
 *
 * Core events are derived from the built-in integration catalog; plugin events are
 * aggregated from active `sdkExtensionPlugin.events` declarations.
 */
export interface SDKAvailableEventDescriptor {
  /** Event name. */
  readonly event: string
  /** Event phase (`'before'` or `'after'`). */
  readonly phase: SDKAvailableEventPhase
  /** Whether the event originates from core or from plugin declarations. */
  readonly source: 'core' | 'plugin'
  /** Optional resource/domain grouping label. */
  readonly resource?: string
  /** Optional human-readable label. */
  readonly label?: string
  /** `true` when the event is observable as an SDK before-event. */
  readonly sdkBefore: boolean
  /** `true` when the event is observable as an SDK after-event. */
  readonly sdkAfter: boolean
  /** `true` when the event is observable through remote API/webhook after-event transport. */
  readonly apiAfter: boolean
  /** Active plugin ids that declared this event, when any. */
  readonly pluginIds?: readonly string[]
}

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
  init(bus: import('../eventBus').EventBus, workspaceRoot: string): void
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
  /**
   * Optional audit metadata supplied by the SDK action runner.
   *
   * The SDK reserves `meta.callback` for the durable callback-dispatch contract:
   * it contains a durable event ID, event-plus-handler idempotency semantics,
   * and the Cloudflare durable-record D1 budget contract: one claim/upsert plus
   * one checkpoint after each handler attempt, with the terminal summary folded
   * into the last checkpoint for a full lifecycle budget of `1 + total handler
   * attempts`.
   */
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
  register(bus: import('../eventBus').EventBus): void
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
  /**
   * Remote kanban-lite REST API base URL (e.g. `"http://localhost:3000"`).
   *
   * When set, the `KanbanSDK` constructor will throw and direct you to use
   * `RemoteKanbanSDK` instead, since remote mode requires a different class
   * to avoid local filesystem initialization.
   *
   * @see RemoteKanbanSDK
   */
  remoteUrl?: string
  /**
   * Bearer token for remote API authentication.
   * Only relevant when `remoteUrl` is set — pass to `RemoteKanbanSDK` instead.
   */
  token?: string
  /** @internal Testing seam for guarded plugin install subprocess execution. */
  pluginInstallRunner?: (command: {
    command: 'npm'
    args: string[]
    cwd: string
    shell: false
  }) => Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>
}


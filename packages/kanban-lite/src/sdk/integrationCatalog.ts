import type { SDKAfterEventType, SDKBeforeEventType } from './types'

/**
 * Resource group identifier for kanban-lite operations and events.
 *
 * Used to group actions and trigger events in first-party integrations such as
 * the n8n node package, mapping to the corresponding SDK resource domain.
 */
export type KanbanResource =
  | 'auth'
  | 'attachment'
  | 'board'
  | 'card'
  | 'column'
  | 'comment'
  | 'form'
  | 'label'
  | 'settings'
  | 'storage'
  | 'webhook'
  | 'workspace'

/**
 * Transport availability classification for a kanban-lite event.
 *
 * - `sdkBefore` – available as a **before-event** in local SDK mode only.
 *   The listener fires immediately before the mutation is committed; it may
 *   return field overrides or throw to abort the mutation. Never surfaced
 *   through the webhook delivery channel.
 *
 * - `sdkAfter`  – available as an **after-event** in local SDK mode.
 *   The listener fires after the mutation is committed; it is non-blocking.
 *
 * - `apiAfter`  – delivered via **webhook / remote API** after-event
 *   transport. Only committed (after) events are observable remotely; the
 *   before-event channel is SDK-local.
 *
 * A before-event always has `sdkBefore=true, sdkAfter=false, apiAfter=false`.
 * An after-event always has `sdkBefore=false, sdkAfter=true, apiAfter=true`.
 */
export interface KanbanEventTransport {
  readonly sdkBefore: boolean
  readonly sdkAfter: boolean
  readonly apiAfter: boolean
}

/**
 * Canonical descriptor for a single kanban-lite event as consumed by
 * first-party integrations.
 *
 * The `event` string exactly matches a value from {@link SDKBeforeEventType}
 * or {@link SDKAfterEventType}. Transport availability flags are derived
 * programmatically from which type the event belongs to, so they cannot
 * diverge from SDK semantics.
 *
 * @see KANBAN_EVENT_CATALOG for the full exported list.
 */
export interface KanbanEventDescriptor extends KanbanEventTransport {
  /** SDK event name, exactly matching {@link SDKBeforeEventType} or {@link SDKAfterEventType}. */
  readonly event: SDKBeforeEventType | SDKAfterEventType
  /** Resource group this event belongs to. */
  readonly resource: KanbanResource
  /** Human-readable label for display in integration UIs (e.g. n8n trigger node). */
  readonly label: string
}

/**
 * Canonical descriptor for a single kanban-lite action (operation).
 *
 * Consumed by first-party integrations (e.g. the n8n app node) to build
 * resource/operation group definitions from one stable source of truth rather
 * than duplicating SDK method names across packages.
 *
 * @see KANBAN_ACTION_CATALOG for the full exported list.
 */
export interface KanbanActionDescriptor {
  /** Resource group this operation belongs to. */
  readonly resource: KanbanResource
  /** Machine identifier for the operation (e.g. `'create'`, `'list'`, `'move'`). */
  readonly operation: string
  /** Human-readable label for display in integration UIs. */
  readonly label: string
}

// ---------------------------------------------------------------------------
// Before-event catalog – SDK-local only (sdkBefore=true, sdkAfter=false, apiAfter=false)
// `satisfies` ensures every `event` value is a valid SDKBeforeEventType; if a
// string is added that is not in SDKBeforeEventType the compiler will error.
// ---------------------------------------------------------------------------

const BEFORE_ENTRIES = [
  // card
  { event: 'card.create'               as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card create' },
  { event: 'card.update'               as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card update' },
  { event: 'card.move'                 as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card move' },
  { event: 'card.delete'               as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card delete' },
  { event: 'card.transfer'             as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card transfer' },
  { event: 'card.action.trigger'       as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card action trigger' },
  { event: 'card.purgeDeleted'         as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before purge deleted cards' },
  // comment
  { event: 'comment.create'            as SDKBeforeEventType, resource: 'comment'    as KanbanResource, label: 'Before comment create' },
  { event: 'comment.update'            as SDKBeforeEventType, resource: 'comment'    as KanbanResource, label: 'Before comment update' },
  { event: 'comment.delete'            as SDKBeforeEventType, resource: 'comment'    as KanbanResource, label: 'Before comment delete' },
  // column
  { event: 'column.create'             as SDKBeforeEventType, resource: 'column'     as KanbanResource, label: 'Before column create' },
  { event: 'column.update'             as SDKBeforeEventType, resource: 'column'     as KanbanResource, label: 'Before column update' },
  { event: 'column.delete'             as SDKBeforeEventType, resource: 'column'     as KanbanResource, label: 'Before column delete' },
  { event: 'column.reorder'            as SDKBeforeEventType, resource: 'column'     as KanbanResource, label: 'Before column reorder' },
  { event: 'column.setMinimized'       as SDKBeforeEventType, resource: 'column'     as KanbanResource, label: 'Before column set minimized' },
  { event: 'column.cleanup'            as SDKBeforeEventType, resource: 'column'     as KanbanResource, label: 'Before column cleanup' },
  // attachment
  { event: 'attachment.add'            as SDKBeforeEventType, resource: 'attachment' as KanbanResource, label: 'Before attachment add' },
  { event: 'attachment.remove'         as SDKBeforeEventType, resource: 'attachment' as KanbanResource, label: 'Before attachment remove' },
  // settings
  { event: 'settings.update'           as SDKBeforeEventType, resource: 'settings'   as KanbanResource, label: 'Before settings update' },
  // board
  { event: 'board.create'              as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board create' },
  { event: 'board.update'              as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board update' },
  { event: 'board.delete'              as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board delete' },
  { event: 'board.action.config.add'   as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board action config add' },
  { event: 'board.action.config.remove' as SDKBeforeEventType, resource: 'board'     as KanbanResource, label: 'Before board action config remove' },
  { event: 'board.action.trigger'      as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board action trigger' },
  { event: 'board.setDefault'          as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board set default' },
  // card logs
  { event: 'log.add'                   as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card log add' },
  { event: 'log.clear'                 as SDKBeforeEventType, resource: 'card'       as KanbanResource, label: 'Before card log clear' },
  // board logs
  { event: 'board.log.add'             as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board log add' },
  { event: 'board.log.clear'           as SDKBeforeEventType, resource: 'board'      as KanbanResource, label: 'Before board log clear' },
  // storage
  { event: 'storage.migrate'           as SDKBeforeEventType, resource: 'storage'    as KanbanResource, label: 'Before storage migrate' },
  // label
  { event: 'label.set'                 as SDKBeforeEventType, resource: 'label'      as KanbanResource, label: 'Before label set' },
  { event: 'label.rename'              as SDKBeforeEventType, resource: 'label'      as KanbanResource, label: 'Before label rename' },
  { event: 'label.delete'              as SDKBeforeEventType, resource: 'label'      as KanbanResource, label: 'Before label delete' },
  // webhook
  { event: 'webhook.create'            as SDKBeforeEventType, resource: 'webhook'    as KanbanResource, label: 'Before webhook create' },
  { event: 'webhook.update'            as SDKBeforeEventType, resource: 'webhook'    as KanbanResource, label: 'Before webhook update' },
  { event: 'webhook.delete'            as SDKBeforeEventType, resource: 'webhook'    as KanbanResource, label: 'Before webhook delete' },
  // form
  { event: 'form.submit'               as SDKBeforeEventType, resource: 'form'       as KanbanResource, label: 'Before form submit' },
] satisfies ReadonlyArray<{ event: SDKBeforeEventType; resource: KanbanResource; label: string }>

// ---------------------------------------------------------------------------
// After-event catalog – SDK-local + remote API webhook delivery
// (sdkBefore=false, sdkAfter=true, apiAfter=true)
// `satisfies` ensures every `event` value is a valid SDKAfterEventType.
// ---------------------------------------------------------------------------

const AFTER_ENTRIES = [
  // card
  { event: 'task.created'     as SDKAfterEventType, resource: 'card'       as KanbanResource, label: 'Card created' },
  { event: 'task.updated'     as SDKAfterEventType, resource: 'card'       as KanbanResource, label: 'Card updated' },
  { event: 'task.moved'       as SDKAfterEventType, resource: 'card'       as KanbanResource, label: 'Card moved' },
  { event: 'task.deleted'     as SDKAfterEventType, resource: 'card'       as KanbanResource, label: 'Card deleted' },
  // comment
  { event: 'comment.created'  as SDKAfterEventType, resource: 'comment'    as KanbanResource, label: 'Comment created' },
  { event: 'comment.updated'  as SDKAfterEventType, resource: 'comment'    as KanbanResource, label: 'Comment updated' },
  { event: 'comment.deleted'  as SDKAfterEventType, resource: 'comment'    as KanbanResource, label: 'Comment deleted' },
  // column
  { event: 'column.created'   as SDKAfterEventType, resource: 'column'     as KanbanResource, label: 'Column created' },
  { event: 'column.updated'   as SDKAfterEventType, resource: 'column'     as KanbanResource, label: 'Column updated' },
  { event: 'column.deleted'   as SDKAfterEventType, resource: 'column'     as KanbanResource, label: 'Column deleted' },
  // attachment
  { event: 'attachment.added'  as SDKAfterEventType, resource: 'attachment' as KanbanResource, label: 'Attachment added' },
  { event: 'attachment.removed' as SDKAfterEventType, resource: 'attachment' as KanbanResource, label: 'Attachment removed' },
  // settings
  { event: 'settings.updated' as SDKAfterEventType, resource: 'settings'   as KanbanResource, label: 'Settings updated' },
  // board
  { event: 'board.created'    as SDKAfterEventType, resource: 'board'      as KanbanResource, label: 'Board created' },
  { event: 'board.updated'    as SDKAfterEventType, resource: 'board'      as KanbanResource, label: 'Board updated' },
  { event: 'board.deleted'    as SDKAfterEventType, resource: 'board'      as KanbanResource, label: 'Board deleted' },
  { event: 'board.action'     as SDKAfterEventType, resource: 'board'      as KanbanResource, label: 'Board action triggered' },
  { event: 'board.log.added'  as SDKAfterEventType, resource: 'board'      as KanbanResource, label: 'Board log added' },
  { event: 'board.log.cleared' as SDKAfterEventType, resource: 'board'     as KanbanResource, label: 'Board log cleared' },
  // card logs
  { event: 'log.added'        as SDKAfterEventType, resource: 'card'       as KanbanResource, label: 'Card log added' },
  { event: 'log.cleared'      as SDKAfterEventType, resource: 'card'       as KanbanResource, label: 'Card log cleared' },
  // storage
  { event: 'storage.migrated' as SDKAfterEventType, resource: 'storage'    as KanbanResource, label: 'Storage migrated' },
  // form
  { event: 'form.submitted'   as SDKAfterEventType, resource: 'form'       as KanbanResource, label: 'Form submitted' },
  // auth
  { event: 'auth.allowed'     as SDKAfterEventType, resource: 'auth'       as KanbanResource, label: 'Auth allowed' },
  { event: 'auth.denied'      as SDKAfterEventType, resource: 'auth'       as KanbanResource, label: 'Auth denied' },
] satisfies ReadonlyArray<{ event: SDKAfterEventType; resource: KanbanResource; label: string }>

// ---------------------------------------------------------------------------
// Exported catalogs
// ---------------------------------------------------------------------------

/**
 * Canonical event catalog for kanban-lite first-party integrations.
 *
 * Each entry is a {@link KanbanEventDescriptor} with:
 * - the exact SDK event name
 * - the resource group it belongs to
 * - a human-readable label
 * - transport availability flags (`sdkBefore`, `sdkAfter`, `apiAfter`)
 *
 * **Transport rules encoded here:**
 * - Before-events (`sdkBefore=true`): only observable in local SDK mode.
 * - After-events (`sdkAfter=true, apiAfter=true`): observable in both local
 *   SDK mode and remote API / webhook delivery.
 *
 * Consumers such as the n8n trigger node MUST use this catalog instead of
 * hardcoding event name strings, so that any future additions to
 * {@link SDKBeforeEventType} or {@link SDKAfterEventType} are automatically
 * reflected after catalog is updated here.
 */
export const KANBAN_EVENT_CATALOG: readonly KanbanEventDescriptor[] = [
  ...BEFORE_ENTRIES.map(
    (e): KanbanEventDescriptor => ({ ...e, sdkBefore: true, sdkAfter: false, apiAfter: false }),
  ),
  ...AFTER_ENTRIES.map(
    (e): KanbanEventDescriptor => ({ ...e, sdkBefore: false, sdkAfter: true, apiAfter: true }),
  ),
]

/**
 * Canonical action (operation) catalog for kanban-lite first-party integrations.
 *
 * Each entry is a {@link KanbanActionDescriptor} describing a resource group,
 * machine operation identifier, and human-readable label. The n8n app node
 * consumes this catalog to generate resource/operation group definitions from
 * one source of truth rather than duplicating SDK method names.
 */
export const KANBAN_ACTION_CATALOG: readonly KanbanActionDescriptor[] = [
  // board
  { resource: 'board', operation: 'list',           label: 'List boards' },
  { resource: 'board', operation: 'get',            label: 'Get board' },
  { resource: 'board', operation: 'create',         label: 'Create board' },
  { resource: 'board', operation: 'update',         label: 'Update board' },
  { resource: 'board', operation: 'delete',         label: 'Delete board' },
  { resource: 'board', operation: 'setDefault',     label: 'Set default board' },
  { resource: 'board', operation: 'triggerAction',  label: 'Trigger board action' },
  // card
  { resource: 'card', operation: 'list',            label: 'List cards' },
  { resource: 'card', operation: 'get',             label: 'Get card' },
  { resource: 'card', operation: 'create',          label: 'Create card' },
  { resource: 'card', operation: 'update',          label: 'Update card' },
  { resource: 'card', operation: 'move',            label: 'Move card' },
  { resource: 'card', operation: 'delete',          label: 'Delete card (soft)' },
  { resource: 'card', operation: 'transfer',        label: 'Transfer card between boards' },
  { resource: 'card', operation: 'purgeDeleted',    label: 'Purge deleted cards' },
  { resource: 'card', operation: 'triggerAction',   label: 'Trigger card action' },
  // comment
  { resource: 'comment', operation: 'list',         label: 'List comments' },
  { resource: 'comment', operation: 'add',          label: 'Add comment' },
  { resource: 'comment', operation: 'update',       label: 'Update comment' },
  { resource: 'comment', operation: 'delete',       label: 'Delete comment' },
  // attachment
  { resource: 'attachment', operation: 'list',      label: 'List attachments' },
  { resource: 'attachment', operation: 'add',       label: 'Add attachment' },
  { resource: 'attachment', operation: 'remove',    label: 'Remove attachment' },
  // column
  { resource: 'column', operation: 'list',          label: 'List columns' },
  { resource: 'column', operation: 'add',           label: 'Add column' },
  { resource: 'column', operation: 'update',        label: 'Update column' },
  { resource: 'column', operation: 'remove',        label: 'Remove column' },
  { resource: 'column', operation: 'reorder',       label: 'Reorder columns' },
  { resource: 'column', operation: 'setMinimized',  label: 'Set minimized columns' },
  { resource: 'column', operation: 'cleanup',       label: 'Cleanup column cards' },
  // label
  { resource: 'label', operation: 'list',           label: 'List labels' },
  { resource: 'label', operation: 'set',            label: 'Set label' },
  { resource: 'label', operation: 'rename',         label: 'Rename label' },
  { resource: 'label', operation: 'delete',         label: 'Delete label' },
  // settings
  { resource: 'settings', operation: 'get',         label: 'Get settings' },
  { resource: 'settings', operation: 'update',      label: 'Update settings' },
  // storage
  { resource: 'storage', operation: 'getStatus',          label: 'Get storage status' },
  { resource: 'storage', operation: 'migrateToSqlite',    label: 'Migrate to SQLite' },
  { resource: 'storage', operation: 'migrateToMarkdown',  label: 'Migrate to Markdown' },
  // form
  { resource: 'form', operation: 'submit',           label: 'Submit form' },
  // webhook
  { resource: 'webhook', operation: 'list',          label: 'List webhooks' },
  { resource: 'webhook', operation: 'create',        label: 'Create webhook' },
  { resource: 'webhook', operation: 'update',        label: 'Update webhook' },
  { resource: 'webhook', operation: 'delete',        label: 'Delete webhook' },
  // workspace
  { resource: 'workspace', operation: 'getInfo',     label: 'Get workspace info' },
  // auth
  { resource: 'auth', operation: 'getStatus',        label: 'Get auth status' },
] satisfies ReadonlyArray<{ resource: KanbanResource; operation: string; label: string }>

// ---------------------------------------------------------------------------
// Convenience helpers for first-party integration consumers
// ---------------------------------------------------------------------------

/**
 * Returns all event descriptors belonging to the given resource group.
 *
 * @param resource - The {@link KanbanResource} to filter by.
 */
export function getEventsByResource(resource: KanbanResource): readonly KanbanEventDescriptor[] {
  return KANBAN_EVENT_CATALOG.filter(e => e.resource === resource)
}

/**
 * Returns event descriptors that are available in local SDK mode as
 * before-events (i.e. `sdkBefore === true`).
 */
export function getSdkBeforeEvents(): readonly KanbanEventDescriptor[] {
  return KANBAN_EVENT_CATALOG.filter(e => e.sdkBefore)
}

/**
 * Returns event descriptors that are available in local SDK mode as
 * after-events (i.e. `sdkAfter === true`).
 */
export function getSdkAfterEvents(): readonly KanbanEventDescriptor[] {
  return KANBAN_EVENT_CATALOG.filter(e => e.sdkAfter)
}

/**
 * Returns event descriptors that are deliverable via remote API / webhook
 * transport (i.e. `apiAfter === true`). These are the events a remote n8n
 * trigger node can subscribe to when connected in API mode.
 */
export function getApiAfterEvents(): readonly KanbanEventDescriptor[] {
  return KANBAN_EVENT_CATALOG.filter(e => e.apiAfter)
}

/**
 * Returns action descriptors for the given resource group.
 *
 * @param resource - The {@link KanbanResource} to filter by.
 */
export function getActionsByResource(resource: KanbanResource): readonly KanbanActionDescriptor[] {
  return KANBAN_ACTION_CATALOG.filter(a => a.resource === resource)
}

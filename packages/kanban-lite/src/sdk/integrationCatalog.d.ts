import type { SDKAfterEventType, SDKBeforeEventType } from './types';
/**
 * Resource group identifier for kanban-lite operations and events.
 *
 * Used to group actions and trigger events in first-party integrations such as
 * the n8n node package, mapping to the corresponding SDK resource domain.
 */
export type KanbanResource = 'auth' | 'attachment' | 'board' | 'card' | 'column' | 'comment' | 'form' | 'label' | 'settings' | 'storage' | 'webhook' | 'workspace';
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
    readonly sdkBefore: boolean;
    readonly sdkAfter: boolean;
    readonly apiAfter: boolean;
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
    readonly event: SDKBeforeEventType | SDKAfterEventType;
    /** Resource group this event belongs to. */
    readonly resource: KanbanResource;
    /** Human-readable label for display in integration UIs (e.g. n8n trigger node). */
    readonly label: string;
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
    readonly resource: KanbanResource;
    /** Machine identifier for the operation (e.g. `'create'`, `'list'`, `'move'`). */
    readonly operation: string;
    /** Human-readable label for display in integration UIs. */
    readonly label: string;
}
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
export declare const KANBAN_EVENT_CATALOG: readonly KanbanEventDescriptor[];
/**
 * Canonical action (operation) catalog for kanban-lite first-party integrations.
 *
 * Each entry is a {@link KanbanActionDescriptor} describing a resource group,
 * machine operation identifier, and human-readable label. The n8n app node
 * consumes this catalog to generate resource/operation group definitions from
 * one source of truth rather than duplicating SDK method names.
 */
export declare const KANBAN_ACTION_CATALOG: readonly KanbanActionDescriptor[];
/**
 * Returns all event descriptors belonging to the given resource group.
 *
 * @param resource - The {@link KanbanResource} to filter by.
 */
export declare function getEventsByResource(resource: KanbanResource): readonly KanbanEventDescriptor[];
/**
 * Returns event descriptors that are available in local SDK mode as
 * before-events (i.e. `sdkBefore === true`).
 */
export declare function getSdkBeforeEvents(): readonly KanbanEventDescriptor[];
/**
 * Returns event descriptors that are available in local SDK mode as
 * after-events (i.e. `sdkAfter === true`).
 */
export declare function getSdkAfterEvents(): readonly KanbanEventDescriptor[];
/**
 * Returns event descriptors that are deliverable via remote API / webhook
 * transport (i.e. `apiAfter === true`). These are the events a remote n8n
 * trigger node can subscribe to when connected in API mode.
 */
export declare function getApiAfterEvents(): readonly KanbanEventDescriptor[];
/**
 * Returns action descriptors for the given resource group.
 *
 * @param resource - The {@link KanbanResource} to filter by.
 */
export declare function getActionsByResource(resource: KanbanResource): readonly KanbanActionDescriptor[];

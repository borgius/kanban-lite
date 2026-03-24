import type { BeforeEventPayload, SDKEvent, SDKEventListener } from './types';
/** Listener callback for subscriptions that receive all SDK events. */
export type EventBusAnyListener = (event: string, payload: SDKEvent) => void;
/** Options for awaiting the next matching event on the bus. */
export interface EventBusWaitOptions {
    /** Reject after the given number of milliseconds. */
    timeout?: number;
    /** Optional payload predicate used to ignore non-matching events. */
    filter?: (payload: SDKEvent) => boolean;
}
/** Configuration options for the SDK event bus. */
export interface EventBusOptions {
    /** Maximum number of listeners per event (default: 50). */
    maxListeners?: number;
}
/**
 * Typed pub/sub event bus wrapping EventEmitter2.
 *
 * Provides namespaced wildcard event routing (e.g. `card.*`, `auth.**`)
 * with error isolation — a failing listener never prevents other listeners
 * from receiving the event.
 */
export declare class EventBus {
    private readonly _emitter;
    constructor(options?: EventBusOptions);
    /**
     * Await all before-event listeners registered for `event` in deterministic
     * registration order, collect their plain-object outputs, and return them as
     * an ordered array for the caller to merge.
     *
     * Each listener receives the same unmodified `payload`. Merge semantics —
     * cloning the input, deep-merging the ordered outputs, and falling back to the
     * original input when no outputs are produced — are entirely the responsibility
     * of `KanbanSDK._runBeforeEvent()`. The bus is a pure ordered dispatcher.
     *
     * - **Plain-object returns** (`Record<string, unknown>`) are appended to the
     *   returned array in listener-registration order.
     * - **Non-plain-object returns** (arrays, class instances, primitives, `void`) are
     *   silently ignored and do not appear in the output array.
     * - **Thrown errors** propagate immediately to the caller as a mutation-abort
     *   signal; no subsequent listeners are executed.
     *
     * After specific-event listeners are settled, `onAny` subscribers receive the
     * event name and original payload in a non-blocking, error-isolated fire so that
     * monitoring hooks cannot be accidentally turned into before-event vetoes.
     *
     * @param event   - Before-event name (e.g. `'card.create'`).
     * @param payload - Before-event payload passed unchanged to every listener.
     * @returns Promise resolving to an ordered array of plain-object listener outputs.
     */
    emitAsync<TInput extends Record<string, unknown>>(event: string, payload: BeforeEventPayload<TInput>): Promise<ReadonlyArray<Record<string, unknown>>>;
    /**
     * Emit an event to all matching listeners.
     * Each listener is invoked inside a try/catch — one failing listener
     * does not prevent subsequent listeners from executing.
     */
    emit(event: string, payload: SDKEvent): void;
    /**
     * Subscribe to a specific event (supports wildcards like `card.*` or `**`).
     * @returns An unsubscribe function.
     */
    on(event: string, listener: SDKEventListener): () => void;
    /**
     * Subscribe to the next matching event only once.
     * Supports wildcards like `card.*` or `**`.
     * @returns An unsubscribe function.
     */
    once(event: string, listener: SDKEventListener): () => void;
    /**
     * Subscribe to an event a fixed number of times.
     * Supports wildcards like `card.*` or `**`.
     * @returns An unsubscribe function.
     */
    many(event: string, timesToListen: number, listener: SDKEventListener): () => void;
    /**
     * Subscribe to ALL events regardless of name.
     * The listener receives (eventName, payload).
     * @returns An unsubscribe function.
     */
    onAny(listener: EventBusAnyListener): () => void;
    /** Remove a specific listener from an event. */
    off(event: string, listener: SDKEventListener): void;
    /** Remove a specific onAny listener. */
    offAny(listener: EventBusAnyListener): void;
    /** Remove all listeners for a specific event, or reset the whole bus when omitted. */
    removeAllListeners(event?: string): void;
    /** Tear down the event bus and remove all listeners. */
    destroy(): void;
    /** Return the currently registered event names. */
    eventNames(): string[];
    /** Get the number of listeners for a specific event, or all events if omitted. */
    listenerCount(event?: string): number;
    /** Check whether any listeners are registered for an event. */
    hasListeners(event?: string): boolean;
    /**
     * Wait for the next matching event and resolve with its payload.
     * Wildcard patterns are supported.
     */
    waitFor(event: string, options?: EventBusWaitOptions): Promise<SDKEvent>;
}

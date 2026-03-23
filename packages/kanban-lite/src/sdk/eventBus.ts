import { EventEmitter2 } from 'eventemitter2'
import type { BeforeEventPayload, BeforeEventListenerResponse, SDKEvent, SDKEventListener } from './types'

/** Listener callback for subscriptions that receive all SDK events. */
export type EventBusAnyListener = (event: string, payload: SDKEvent) => void

/**
 * Returns true when `value` is a plain-object merge candidate.
 *
 * Accepts `{}` literals and `Object.create(null)` objects. Rejects arrays,
 * class instances, primitives, and `null`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Options for awaiting the next matching event on the bus. */
export interface EventBusWaitOptions {
  /** Reject after the given number of milliseconds. */
  timeout?: number
  /** Optional payload predicate used to ignore non-matching events. */
  filter?: (payload: SDKEvent) => boolean
}

type EventBusListenerFn = (payload: SDKEvent) => void
type EventBusAnyListenerFn = (event: string | string[], payload: SDKEvent) => void

/** Configuration options for the SDK event bus. */
export interface EventBusOptions {
  /** Maximum number of listeners per event (default: 50). */
  maxListeners?: number
}

/**
 * Typed pub/sub event bus wrapping EventEmitter2.
 *
 * Provides namespaced wildcard event routing (e.g. `card.*`, `auth.**`)
 * with error isolation — a failing listener never prevents other listeners
 * from receiving the event.
 */
export class EventBus {
  private readonly _emitter: EventEmitter2

  constructor(options?: EventBusOptions) {
    this._emitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: options?.maxListeners ?? 50,
      ignoreErrors: false,
      verboseMemoryLeak: true,
    })
  }

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
  async emitAsync<TInput extends Record<string, unknown>>(
    event: string,
    payload: BeforeEventPayload<TInput>,
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    type AsyncBeforeListener = (
      p: BeforeEventPayload<TInput>,
    ) => BeforeEventListenerResponse | Promise<BeforeEventListenerResponse>

    const listeners = this._emitter.listeners(event) as AsyncBeforeListener[]
    const orderedOutputs: Array<Record<string, unknown>> = []

    for (const listener of listeners) {
      // Errors from before-event listeners are intentionally not caught here.
      // They propagate to the SDK action runner as a mutation-abort signal.
      const result = await listener(payload)
      if (isPlainObject(result)) {
        orderedOutputs.push(result)
      }
    }

    // Fire onAny listeners non-blocking. They are monitoring hooks and must not
    // influence the ordered outputs or abort the action on error.
    const anyListeners = this._emitter.listenersAny() as EventBusAnyListenerFn[]
    for (const listener of anyListeners) {
      try {
        listener(event, payload as unknown as SDKEvent)
      } catch (err) {
        console.error(`[EventBus] onAny listener error for "${event}":`, err)
      }
    }

    return orderedOutputs
  }

  /**
   * Emit an event to all matching listeners.
   * Each listener is invoked inside a try/catch — one failing listener
   * does not prevent subsequent listeners from executing.
   */
  emit(event: string, payload: SDKEvent): void {
    const listeners = this._emitter.listeners(event) as EventBusListenerFn[]
    for (const listener of listeners) {
      try {
        listener(payload)
      } catch (err) {
        console.error(`[EventBus] listener error for "${event}":`, err)
      }
    }
    // Also fire to wildcard / onAny listeners that wouldn't be in .listeners()
    const anyListeners = this._emitter.listenersAny() as EventBusAnyListenerFn[]
    for (const listener of anyListeners) {
      try {
        listener(event, payload)
      } catch (err) {
        console.error(`[EventBus] onAny listener error for "${event}":`, err)
      }
    }
  }

  /**
   * Subscribe to a specific event (supports wildcards like `card.*` or `**`).
   * @returns An unsubscribe function.
   */
  on(event: string, listener: SDKEventListener): () => void {
    this._emitter.on(event, listener)
    return () => { this._emitter.off(event, listener) }
  }

  /**
   * Subscribe to the next matching event only once.
   * Supports wildcards like `card.*` or `**`.
   * @returns An unsubscribe function.
   */
  once(event: string, listener: SDKEventListener): () => void {
    this._emitter.once(event, listener)
    return () => { this._emitter.off(event, listener) }
  }

  /**
   * Subscribe to an event a fixed number of times.
   * Supports wildcards like `card.*` or `**`.
   * @returns An unsubscribe function.
   */
  many(event: string, timesToListen: number, listener: SDKEventListener): () => void {
    if (timesToListen < 1) return () => {}
    this._emitter.many(event, timesToListen, listener)
    return () => { this._emitter.off(event, listener) }
  }

  /**
   * Subscribe to ALL events regardless of name.
   * The listener receives (eventName, payload).
   * @returns An unsubscribe function.
   */
  onAny(listener: EventBusAnyListener): () => void {
    this._emitter.onAny(listener as unknown as EventBusAnyListenerFn)
    return () => { this._emitter.offAny(listener as unknown as EventBusAnyListenerFn) }
  }

  /** Remove a specific listener from an event. */
  off(event: string, listener: SDKEventListener): void {
    this._emitter.off(event, listener)
  }

  /** Remove a specific onAny listener. */
  offAny(listener: EventBusAnyListener): void {
    this._emitter.offAny(listener as unknown as EventBusAnyListenerFn)
  }

  /** Remove all listeners for a specific event, or reset the whole bus when omitted. */
  removeAllListeners(event?: string): void {
    this._emitter.removeAllListeners(event)
    if (event === undefined) {
      for (const listener of this._emitter.listenersAny() as EventBusAnyListenerFn[]) {
        this._emitter.offAny(listener)
      }
    }
  }

  /** Tear down the event bus and remove all listeners. */
  destroy(): void {
    this.removeAllListeners()
  }

  /** Return the currently registered event names. */
  eventNames(): string[] {
    return this._emitter.eventNames().map(name => Array.isArray(name) ? name.join('.') : String(name))
  }

  /** Get the number of listeners for a specific event, or all events if omitted. */
  listenerCount(event?: string): number {
    if (event) {
      return this._emitter.listeners(event).length
    }
    return this.eventNames().reduce(
      (sum, name) => sum + this._emitter.listeners(name).length,
      0,
    ) + this._emitter.listenersAny().length
  }

  /** Check whether any listeners are registered for an event. */
  hasListeners(event?: string): boolean {
    return event ? !!this._emitter.hasListeners(event) : this.listenerCount() > 0
  }

  /**
   * Wait for the next matching event and resolve with its payload.
   * Wildcard patterns are supported.
   */
  waitFor(event: string, options?: EventBusWaitOptions): Promise<SDKEvent> {
    return new Promise<SDKEvent>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const unsubscribe = this.on(event, (payload) => {
        try {
          if (options?.filter && !options.filter(payload)) return
          if (timer) clearTimeout(timer)
          unsubscribe()
          resolve(payload)
        } catch (error) {
          if (timer) clearTimeout(timer)
          unsubscribe()
          reject(error)
        }
      })

      if (options?.timeout !== undefined) {
        timer = setTimeout(() => {
          unsubscribe()
          reject(new Error(`Timed out waiting for event "${event}"`))
        }, options.timeout)
      }
    })
  }
}

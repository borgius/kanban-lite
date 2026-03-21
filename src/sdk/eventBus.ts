import { EventEmitter2 } from 'eventemitter2'
import type { SDKEvent, SDKEventListener } from './types'

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
   * Emit an event to all matching listeners.
   * Each listener is invoked inside a try/catch — one failing listener
   * does not prevent subsequent listeners from executing.
   */
  emit(event: string, payload: SDKEvent): void {
    const listeners = this._emitter.listeners(event) as Function[]
    for (const listener of listeners) {
      try {
        listener(payload)
      } catch (err) {
        console.error(`[EventBus] listener error for "${event}":`, err)
      }
    }
    // Also fire to wildcard / onAny listeners that wouldn't be in .listeners()
    const anyListeners = this._emitter.listenersAny() as Function[]
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
   * Subscribe to ALL events regardless of name.
   * The listener receives (eventName, payload).
   * @returns An unsubscribe function.
   */
  onAny(listener: (event: string, payload: SDKEvent) => void): () => void {
    this._emitter.onAny(listener as any)
    return () => { this._emitter.offAny(listener as any) }
  }

  /** Remove a specific listener from an event. */
  off(event: string, listener: SDKEventListener): void {
    this._emitter.off(event, listener)
  }

  /** Remove all listeners, effectively resetting the bus. */
  removeAllListeners(): void {
    this._emitter.removeAllListeners()
  }

  /** Tear down the event bus and remove all listeners. */
  destroy(): void {
    this.removeAllListeners()
  }

  /** Get the number of listeners for a specific event, or all events if omitted. */
  listenerCount(event?: string): number {
    if (event) {
      return this._emitter.listeners(event).length
    }
    return this._emitter.eventNames().reduce(
      (sum, name) => sum + this._emitter.listeners(name as string).length,
      0,
    )
  }

  /** Check whether any listeners are registered for an event. */
  hasListeners(event?: string): boolean {
    return !!this._emitter.hasListeners(event)
  }
}

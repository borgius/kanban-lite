/**
 * @internal Temporary compatibility shim — canonical webhook runtime delivery moved to `kl-webhooks-plugin`.
 *
 * {@link WebhookListenerPlugin} here is the built-in fallback instantiated by `KanbanSDK`
 * only when no external webhook provider exports a compatible listener. When
 * `kl-webhooks-plugin` is active (it exports its own `WebhookListenerPlugin` class), that
 * plugin-owned listener is registered instead and this module is never reached for delivery.
 * This module remains as a temporary compatibility fallback until plugin-ownership parity
 * is fully verified; it will be removed in a subsequent migration wave.
 */
import type { SDKEvent, SDKEventListenerPlugin, SDKAfterEventType } from '../types'
import type { EventBus, EventBusAnyListener } from '../eventBus'
import { fireWebhooks } from '../webhooks'

/**
 * Set of all after-event names emitted by the SDK after a successful mutation.
 *
 * Used by {@link WebhookListenerPlugin} to filter `onAny` callbacks so that
 * webhook delivery fires exclusively on committed after-events and never on
 * in-flight before-events.
 *
 * @internal
 */
const SDK_AFTER_EVENT_NAMES: ReadonlySet<string> = new Set<SDKAfterEventType>([
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'column.created',
  'column.updated',
  'column.deleted',
  'attachment.added',
  'attachment.removed',
  'settings.updated',
  'board.created',
  'board.updated',
  'board.deleted',
  'board.action',
  'board.log.added',
  'board.log.cleared',
  'log.added',
  'log.cleared',
  'storage.migrated',
  'form.submitted',
])

/**
 * Built-in compatibility-shim listener plugin that delivers SDK after-events to configured webhooks.
 *
 * **This is a compatibility shim.** The canonical runtime delivery implementation is
 * owned by `kl-webhooks-plugin`. `KanbanSDK` instantiates this class only when no
 * external webhook provider exports a compatible `WebhookListenerPlugin`. When
 * `kl-webhooks-plugin` is active, its own listener is registered instead and this
 * class is never reached for delivery.
 *
 * Implements {@link SDKEventListenerPlugin} — registers and unregisters via
 * {@link register} / {@link unregister}.
 *
 * Subscribes to all SDK events via the event bus but **delivers only after-events**
 * to webhooks. Before-events (pre-mutation dispatches) are intentionally ignored to
 * prevent premature or duplicate webhook delivery.
 *
 * @example
 * ```ts
 * // Used automatically by KanbanSDK as a fallback when no plugin provides a listener.
 * const plugin = new WebhookListenerPlugin('/path/to/workspace')
 * plugin.register(sdk.eventBus)
 * plugin.unregister()
 * ```
 */
export class WebhookListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest = {
    id: 'builtin:webhook-listener',
    provides: ['event.listener'] as const,
  }

  private _unsubscribe: (() => void) | null = null

  /**
   * @param workspaceRoot - Absolute path to the workspace root used to load
   *   webhook configuration from `.kanban.json` on each delivery.
   */
  constructor(private readonly _workspaceRoot: string) {}

  /**
   * Register the after-event delivery listener on the event bus.
   *
   * Uses `bus.onAny` to receive all events but skips any event that is not in
   * the {@link SDK_AFTER_EVENT_NAMES} set, ensuring webhook delivery fires only
   * after a mutation has been committed.
   *
   * @param bus - The SDK event bus instance.
   */
  register(bus: EventBus): void {
    const workspaceRoot = this._workspaceRoot
    const handler: EventBusAnyListener = (event: string, payload: SDKEvent) => {
      if (!SDK_AFTER_EVENT_NAMES.has(event)) return
      fireWebhooks(workspaceRoot, event as SDKAfterEventType, payload.data)
    }
    this._unsubscribe = bus.onAny(handler)
  }

  /**
   * Unregister the event bus subscription and release all plugin-owned resources.
   */
  unregister(): void {
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = null
    }
  }
}

/**
 * Factory function to create a new {@link WebhookListenerPlugin} instance.
 *
 * @param workspaceRoot - Absolute path to the workspace root for webhook config loading.
 * @returns A fresh, unregistered {@link WebhookListenerPlugin}.
 */
export function createWebhookListenerPlugin(workspaceRoot: string): WebhookListenerPlugin {
  return new WebhookListenerPlugin(workspaceRoot)
}

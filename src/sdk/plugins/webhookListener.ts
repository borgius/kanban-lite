import type { SDKEvent, EventListenerPlugin } from '../types'
import type { SDKEventType } from '../types'
import type { EventBus } from '../eventBus'
import { fireWebhooks } from '../webhooks'

/**
 * Built-in event listener plugin that delivers SDK events to configured webhooks.
 *
 * Subscribes to all SDK events via the event bus and delegates delivery
 * to the existing {@link fireWebhooks} function, which reads webhook
 * configurations from `.kanban.json` and performs fire-and-forget HTTP POSTs.
 *
 * @example
 * ```ts
 * const plugin = createWebhookListenerPlugin()
 * plugin.init(sdk.eventBus, '/path/to/workspace')
 * // webhook delivery is now automatic for all SDK events
 * ```
 */
export class WebhookListenerPlugin implements EventListenerPlugin {
  readonly manifest = {
    id: 'builtin:webhook-listener',
    provides: ['event.listener'] as const,
  }

  private _unsubscribe: (() => void) | null = null
  private _workspaceRoot = ''

  /**
   * Subscribe to all SDK events and deliver matching ones via webhooks.
   * @param bus - The SDK event bus instance.
   * @param workspaceRoot - Absolute path to the workspace root (for loading webhook config).
   */
  init(bus: EventBus, workspaceRoot: string): void {
    this._workspaceRoot = workspaceRoot
    this._unsubscribe = bus.onAny((event: string, payload: SDKEvent) => {
      fireWebhooks(this._workspaceRoot, event as SDKEventType, payload.data)
    })
  }

  /** Remove the event subscription and clean up. */
  destroy(): void {
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = null
    }
  }
}

/**
 * Factory function to create a new WebhookListenerPlugin instance.
 * @returns A fresh, uninitialized WebhookListenerPlugin.
 */
export function createWebhookListenerPlugin(): WebhookListenerPlugin {
  return new WebhookListenerPlugin()
}

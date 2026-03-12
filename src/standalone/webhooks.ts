import type { SDKEventType } from '../sdk/types'
export { fireWebhooks, loadWebhooks, saveWebhooks, createWebhook, deleteWebhook, updateWebhook } from '../sdk/webhooks'
export type { Webhook } from '../shared/config'

/**
 * All webhook event types that can be fired.
 *
 * Re-exported from the SDK so that the webhook module stays in sync
 * with the canonical event list defined in `src/sdk/types.ts`.
 */
export type WebhookEvent = SDKEventType


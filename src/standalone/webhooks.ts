import * as crypto from 'crypto'
import { readConfig, writeConfig } from '../shared/config'
import type { Webhook } from '../shared/config'
import type { SDKEventType } from '../sdk/types'
export { fireWebhooks } from '../sdk/webhooks'

export type { Webhook }

/**
 * All webhook event types that can be fired.
 *
 * Re-exported from the SDK so that the webhook module stays in sync
 * with the canonical event list defined in `src/sdk/types.ts`.
 */
export type WebhookEvent = SDKEventType

/**
 * Loads all registered webhooks from the workspace `.kanban.json` config.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns Array of {@link Webhook} objects, or an empty array if none are registered.
 *
 * @example
 * const hooks = loadWebhooks('/home/user/my-project')
 * console.log(hooks.length) // => 2
 */
export function loadWebhooks(workspaceRoot: string): Webhook[] {
  const config = readConfig(workspaceRoot)
  return config.webhooks || []
}

/**
 * Persists the full webhooks array to the workspace `.kanban.json` config.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param webhooks - The complete array of webhooks to save.
 */
export function saveWebhooks(workspaceRoot: string, webhooks: Webhook[]): void {
  const config = readConfig(workspaceRoot)
  config.webhooks = webhooks
  writeConfig(workspaceRoot, config)
}

/**
 * Creates and persists a new webhook registration.
 *
 * Generates a unique ID prefixed with `wh_` and sets the webhook as
 * active by default.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param webhookConfig - The webhook configuration.
 * @param webhookConfig.url - The HTTP(S) endpoint URL.
 * @param webhookConfig.events - Array of event names to subscribe to, or `['*']` for all.
 * @param webhookConfig.secret - Optional HMAC-SHA256 signing key.
 * @returns The newly created {@link Webhook} object with its generated ID.
 *
 * @example
 * const wh = createWebhook('/home/user/project', {
 *   url: 'https://example.com/webhook',
 *   events: ['task.created', 'task.moved'],
 *   secret: 'my-signing-key'
 * })
 * console.log(wh.id) // => 'wh_a1b2c3d4e5f67890'
 */
export function createWebhook(
  workspaceRoot: string,
  webhookConfig: { url: string; events: string[]; secret?: string }
): Webhook {
  const webhooks = loadWebhooks(workspaceRoot)
  const webhook: Webhook = {
    id: 'wh_' + crypto.randomBytes(8).toString('hex'),
    url: webhookConfig.url,
    events: webhookConfig.events,
    secret: webhookConfig.secret,
    active: true
  }
  webhooks.push(webhook)
  saveWebhooks(workspaceRoot, webhooks)
  return webhook
}

/**
 * Deletes a webhook by its ID.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param id - The webhook ID to delete (e.g., `'wh_a1b2c3d4e5f67890'`).
 * @returns `true` if the webhook was found and deleted, `false` otherwise.
 *
 * @example
 * const removed = deleteWebhook('/home/user/project', 'wh_a1b2c3d4e5f67890')
 * console.log(removed) // => true
 */
export function deleteWebhook(workspaceRoot: string, id: string): boolean {
  const webhooks = loadWebhooks(workspaceRoot)
  const filtered = webhooks.filter(w => w.id !== id)
  if (filtered.length === webhooks.length) return false
  saveWebhooks(workspaceRoot, filtered)
  return true
}

/**
 * Updates an existing webhook's configuration.
 *
 * Only the provided fields are changed; omitted fields remain unchanged.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param id - The webhook ID to update.
 * @param updates - Partial webhook fields to merge.
 * @returns The updated {@link Webhook}, or `null` if not found.
 *
 * @example
 * // Toggle a webhook inactive
 * updateWebhook('/home/user/project', 'wh_abc123', { active: false })
 *
 * @example
 * // Change subscribed events
 * updateWebhook('/home/user/project', 'wh_abc123', {
 *   events: ['task.created', 'task.deleted']
 * })
 */
export function updateWebhook(
  workspaceRoot: string,
  id: string,
  updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>
): Webhook | null {
  const webhooks = loadWebhooks(workspaceRoot)
  const webhook = webhooks.find(w => w.id === id)
  if (!webhook) return null

  if (updates.url !== undefined) webhook.url = updates.url
  if (updates.events !== undefined) webhook.events = updates.events
  if (updates.secret !== undefined) webhook.secret = updates.secret
  if (updates.active !== undefined) webhook.active = updates.active

  saveWebhooks(workspaceRoot, webhooks)
  return webhook
}



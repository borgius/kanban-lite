import * as crypto from 'crypto'
import * as http from 'http'
import * as https from 'https'
import { readConfig } from '../shared/config'
import type { Webhook } from '../shared/config'
import type { SDKEventType } from './types'

/**
 * Fires matching webhooks for an event.
 *
 * Loads all registered webhooks from the workspace `.kanban.json` config,
 * filters for active ones subscribed to the given event (or to `'*'`), and
 * delivers the payload asynchronously to each matching endpoint. Delivery
 * failures are logged but do not block the caller.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param event - The event type being fired (e.g., `'task.created'`).
 * @param data - The event payload data (typically a sanitized card, column, or comment object).
 *
 * @example
 * fireWebhooks('/home/user/project', 'task.created', { id: '1', status: 'backlog' })
 */
export function fireWebhooks(workspaceRoot: string, event: SDKEventType, data: unknown): void {
  const config = readConfig(workspaceRoot)
  const webhooks = config.webhooks || []
  const matching = webhooks.filter(
    w => w.active && (w.events.includes('*') || w.events.includes(event))
  )
  if (matching.length === 0) return

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data
  })

  for (const webhook of matching) {
    deliverWebhook(webhook, event, payload).catch(err => {
      console.error(`Webhook delivery failed for ${webhook.id} (${webhook.url}):`, err.message || err)
    })
  }
}

/**
 * Delivers a webhook payload to its endpoint via HTTP POST.
 *
 * If the webhook has a `secret`, the payload is signed with HMAC-SHA256
 * and the signature is included in the `X-Webhook-Signature` header.
 * Requests time out after 10 seconds. Only HTTP 2xx responses are
 * considered successful.
 *
 * @param webhook - The webhook to deliver to.
 * @param event - The event name (included in the `X-Webhook-Event` header).
 * @param payload - The JSON-serialized payload string.
 */
async function deliverWebhook(webhook: Webhook, event: string, payload: string): Promise<void> {
  const url = new URL(webhook.url)
  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
    'X-Webhook-Event': event
  }

  if (webhook.secret) {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex')
    headers['X-Webhook-Signature'] = `sha256=${signature}`
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: 10000
      },
      (res) => {
        res.resume() // drain response
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout'))
    })
    req.write(payload)
    req.end()
  })
}

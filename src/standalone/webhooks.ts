import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import * as https from 'https'
import * as crypto from 'crypto'

export interface Webhook {
  id: string
  url: string
  events: string[]  // e.g. ["task.created", "task.moved"] or ["*"] for all
  secret?: string   // optional HMAC-SHA256 signing key
  active: boolean
}

export type WebhookEvent =
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.deleted'

const WEBHOOKS_FILENAME = '.kanban-webhooks.json'

function webhooksPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WEBHOOKS_FILENAME)
}

export function loadWebhooks(workspaceRoot: string): Webhook[] {
  try {
    const raw = fs.readFileSync(webhooksPath(workspaceRoot), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function saveWebhooks(workspaceRoot: string, webhooks: Webhook[]): void {
  fs.writeFileSync(webhooksPath(workspaceRoot), JSON.stringify(webhooks, null, 2) + '\n', 'utf-8')
}

export function createWebhook(
  workspaceRoot: string,
  config: { url: string; events: string[]; secret?: string }
): Webhook {
  const webhooks = loadWebhooks(workspaceRoot)
  const webhook: Webhook = {
    id: 'wh_' + crypto.randomBytes(8).toString('hex'),
    url: config.url,
    events: config.events,
    secret: config.secret,
    active: true
  }
  webhooks.push(webhook)
  saveWebhooks(workspaceRoot, webhooks)
  return webhook
}

export function deleteWebhook(workspaceRoot: string, id: string): boolean {
  const webhooks = loadWebhooks(workspaceRoot)
  const filtered = webhooks.filter(w => w.id !== id)
  if (filtered.length === webhooks.length) return false
  saveWebhooks(workspaceRoot, filtered)
  return true
}

export function fireWebhooks(workspaceRoot: string, event: WebhookEvent, data: unknown): void {
  const webhooks = loadWebhooks(workspaceRoot)
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

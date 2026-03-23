import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Local type definitions
// Structural interfaces that match kanban-lite internals without deep imports.
// Validated by the runtime plugin loader's shape checks.
// ---------------------------------------------------------------------------

/** A registered webhook endpoint persisted in `.kanban.json`. */
export interface Webhook {
  /** Unique identifier (e.g., `'wh_a1b2c3d4e5f6'`). */
  id: string
  /** The HTTP(S) URL that receives POST requests with event payloads. */
  url: string
  /** Event names to subscribe to (e.g., `['task.created']`), or `['*']` for all events. */
  events: string[]
  /** Optional HMAC-SHA256 signing key for payload verification. */
  secret?: string
  /** Whether this webhook is active. Inactive webhooks are skipped during delivery. */
  active: boolean
}

/** Minimal slice of a kanban workspace config needed for webhook persistence. */
interface KanbanConfig {
  webhooks?: Webhook[]
  [key: string]: unknown
}

/**
 * Minimal EventBus duck type.
 *
 * The real `EventBus` is provided by kanban-lite at runtime; this interface
 * captures only the surface used by this plugin so no import from core is needed.
 */
interface EventBus {
  onAny(listener: (event: string, payload: { data: unknown; timestamp: string }) => void): () => void
}

/**
 * Minimal SDKEventListenerPlugin shape consumed by `KanbanSDK`.
 *
 * Mirrors the `SDKEventListenerPlugin` type from `kanban-lite/sdk/types` so
 * the exported listener is structurally compatible at runtime.
 */
export interface SDKEventListenerPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /** Attach to the SDK event bus and begin delivering matching webhook events. */
  register(bus: EventBus): void
  /** Detach from the SDK event bus and stop delivery. */
  unregister(): void
}

/**
 * Webhook provider plugin contract consumed by the kanban-lite core loader.
 *
 * Matches `WebhookProviderPlugin` from `kanban-lite/sdk/plugins`.
 */
export interface WebhookProviderPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /** Lists all registered webhooks for the workspace. */
  listWebhooks(workspaceRoot: string): Webhook[]
  /** Creates and persists a new webhook. Returns the created webhook with its generated id. */
  createWebhook(workspaceRoot: string, input: { url: string; events: string[]; secret?: string }): Webhook
  /** Updates an existing webhook. Returns the updated webhook, or `null` if not found. */
  updateWebhook(
    workspaceRoot: string,
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): Webhook | null
  /** Deletes a webhook by id. Returns `true` if deleted, `false` if not found. */
  deleteWebhook(workspaceRoot: string, id: string): boolean
}

const SDK_AFTER_EVENT_NAMES = new Set<string>([
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

// ---------------------------------------------------------------------------
// Config persistence helpers
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = '.kanban.json'

function readWebhooks(workspaceRoot: string): Webhook[] {
  const filePath = path.join(workspaceRoot, CONFIG_FILENAME)
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as KanbanConfig
    return Array.isArray(raw.webhooks) ? raw.webhooks : []
  } catch {
    return []
  }
}

function writeWebhooks(workspaceRoot: string, webhooks: Webhook[]): void {
  const filePath = path.join(workspaceRoot, CONFIG_FILENAME)
  let config: KanbanConfig = {}
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as KanbanConfig
  } catch {
    // File absent — start from a blank config object.
  }
  config.webhooks = webhooks
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

function generateWebhookId(): string {
  return 'wh_' + crypto.randomBytes(6).toString('hex')
}

// ---------------------------------------------------------------------------
// HTTP delivery
// Semantics ported directly from src/sdk/webhooks.ts in kanban-light core.
// ---------------------------------------------------------------------------

async function deliverWebhook(webhook: Webhook, event: string, payload: string): Promise<void> {
  const url = new URL(webhook.url)
  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
    'X-Webhook-Event': event,
  }

  if (webhook.secret) {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex')
    headers['X-Webhook-Signature'] = `sha256=${signature}`
  }

  return new Promise<void>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: 10000,
      },
      (res) => {
        res.resume() // drain response body
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
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

function fireWebhooks(workspaceRoot: string, event: string, data: unknown): void {
  const webhooks = readWebhooks(workspaceRoot)
  const matching = webhooks.filter(
    (w) => w.active && (w.events.includes('*') || w.events.includes(event)),
  )
  if (matching.length === 0) return

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  })

  for (const webhook of matching) {
    deliverWebhook(webhook, event, payload).catch((err: unknown) => {
      console.error(
        `[kl-webhooks-plugin] delivery failed for ${webhook.id} (${webhook.url}):`,
        err instanceof Error ? err.message : err,
      )
    })
  }
}

// ---------------------------------------------------------------------------
// CRUD implementations
// ---------------------------------------------------------------------------

function listWebhooks(workspaceRoot: string): Webhook[] {
  return readWebhooks(workspaceRoot)
}

function createWebhook(
  workspaceRoot: string,
  input: { url: string; events: string[]; secret?: string },
): Webhook {
  const webhooks = readWebhooks(workspaceRoot)
  const webhook: Webhook = {
    id: generateWebhookId(),
    url: input.url,
    events: [...input.events],
    active: true,
    ...(input.secret !== undefined ? { secret: input.secret } : {}),
  }
  webhooks.push(webhook)
  writeWebhooks(workspaceRoot, webhooks)
  return webhook
}

function updateWebhook(
  workspaceRoot: string,
  id: string,
  updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
): Webhook | null {
  const webhooks = readWebhooks(workspaceRoot)
  const index = webhooks.findIndex((w) => w.id === id)
  if (index === -1) return null
  const updated: Webhook = { ...webhooks[index], ...updates }
  webhooks[index] = updated
  writeWebhooks(workspaceRoot, webhooks)
  return updated
}

function deleteWebhook(workspaceRoot: string, id: string): boolean {
  const webhooks = readWebhooks(workspaceRoot)
  const index = webhooks.findIndex((w) => w.id === id)
  if (index === -1) return false
  webhooks.splice(index, 1)
  writeWebhooks(workspaceRoot, webhooks)
  return true
}

// ---------------------------------------------------------------------------
// SDKEventListenerPlugin lifecycle
// ---------------------------------------------------------------------------

export class WebhookListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest = {
    id: 'webhooks',
    provides: ['event.listener'] as const,
  }

  private _unsubscribe: (() => void) | null = null

  constructor(private readonly _workspaceRoot: string) {}

  register(bus: EventBus): void {
    if (this._unsubscribe) return
    this._unsubscribe = bus.onAny((event, payload) => {
      if (!SDK_AFTER_EVENT_NAMES.has(event)) return
      fireWebhooks(this._workspaceRoot, event, payload.data)
    })
  }

  unregister(): void {
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = null
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

/**
 * Webhook delivery provider plugin for kanban-lite.
 *
 * Provides the `webhook.delivery` capability. Implements the current
 * kanban-lite webhook registry CRUD and outbound HTTP delivery semantics
 * outside of core.
 *
 * Persists webhooks in the workspace `.kanban.json` `webhooks` array — the
 * same shape used by kanban-lite's built-in webhook system — so no migration
 * is needed when enabling this plugin.
 *
 * @example
 * // .kanban.json – select this provider
 * {
 *   "plugins": {
 *     "webhook.delivery": { "provider": "webhooks" }
 *   }
 * }
 */
export const webhookProviderPlugin: WebhookProviderPlugin = {
  manifest: {
    id: 'webhooks',
    provides: ['webhook.delivery'],
  },
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
}

export default webhookProviderPlugin

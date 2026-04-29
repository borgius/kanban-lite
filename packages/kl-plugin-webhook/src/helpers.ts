import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import type {
  CliPluginContext,
  EventBus,
  KanbanConfig,
  KanbanCliPlugin,
  McpPluginRegistration,
  McpToolContext,
  McpToolDefinition,
  McpToolResult,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  SDKEventListenerPlugin,
  SDKExtensionPlugin,
  StandaloneHttpHandler,
  StandaloneHttpPlugin,
  Webhook,
  WebhookProviderPlugin,
  KanbanSDK,
  AfterEventPayload,
} from 'kanban-lite/sdk'

export type {
  CliPluginContext,
  KanbanCliPlugin,
  McpPluginRegistration,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
  SDKExtensionPlugin,
  StandaloneHttpPlugin,
  Webhook,
  WebhookProviderPlugin
} from 'kanban-lite/sdk'

type Awaitable<T> = T | Promise<T>

/** Internal helper for partial `.kanban.json` persistence during plugin-owned fallback writes. */
type PersistedWebhookConfig = Partial<KanbanConfig> & Record<string, unknown>

interface PersistedWebhookPluginConfig {
  provider?: string
  options?: Record<string, unknown>
}

interface PersistedWebhookPlugins {
  'webhook.delivery'?: PersistedWebhookPluginConfig
}

function isDebugLoggingEnabled(): boolean {
  const value = process.env.KANBAN_LITE_WEBHOOK_DEBUG ?? process.env.KL_WEBHOOK_DEBUG
  if (!value) return false
  return !['0', 'false', 'off', 'no'].includes(value.toLowerCase())
}

export function debugLog(...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    console.log(...args)
  }
}

export const SDK_AFTER_EVENT_NAMES = new Set<string>([
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
  'card.action.triggered',
  'board.log.added',
  'board.log.cleared',
  'log.added',
  'log.cleared',
  'storage.migrated',
  'form.submitted'
])

// ---------------------------------------------------------------------------
// Config persistence helpers
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = '.kanban.json'

function getPluginConfiguredWebhooks(raw: PersistedWebhookConfig): Webhook[] | null {
  const plugins = raw.plugins as PersistedWebhookPlugins | undefined
  const webhookPlugin = plugins?.['webhook.delivery']
  const pluginWebhooks = webhookPlugin?.options?.webhooks
  return Array.isArray(pluginWebhooks) ? (pluginWebhooks as Webhook[]) : null
}

export function readWebhooks(workspaceRoot: string): Webhook[] {
  const filePath = path.join(workspaceRoot, CONFIG_FILENAME)
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedWebhookConfig
    const pluginWebhooks = getPluginConfiguredWebhooks(raw)
    if (pluginWebhooks) return pluginWebhooks
    const webhooks = raw.webhooks
    return Array.isArray(webhooks) ? webhooks : []
  } catch {
    return []
  }
}

function writeWebhooks(workspaceRoot: string, webhooks: Webhook[]): void {
  const filePath = path.join(workspaceRoot, CONFIG_FILENAME)
  let config: PersistedWebhookConfig = {}
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedWebhookConfig
  } catch {
    // File absent — start from a blank config object.
  }

  config.webhooks = webhooks
  const plugins = (config.plugins ?? {}) as PersistedWebhookPlugins
  const webhookPlugin = plugins['webhook.delivery'] ?? { provider: 'webhooks' }
  const options = (webhookPlugin.options ?? {}) as Record<string, unknown>
  options.webhooks = webhooks
  webhookPlugin.options = options
  plugins['webhook.delivery'] = webhookPlugin
  config.plugins = plugins as Record<string, unknown>

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

function generateWebhookId(): string {
  return 'wh_' + crypto.randomBytes(8).toString('hex')
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
    'X-Webhook-Event': event
  }

  const serverToken = process.env['KANBAN_LITE_TOKEN']
  if (serverToken) {
    headers['Authorization'] = `Bearer ${serverToken}`
  }

  const hasSecret = !!webhook.secret
  if (webhook.secret) {
    const signature = crypto.createHmac('sha256', webhook.secret).update(payload).digest('hex')
    headers['X-Webhook-Signature'] = `sha256=${signature}`
  }

  debugLog(
    `[kl-plugin-webhook] → POST ${webhook.url} | event=${event} | id=${webhook.id} | secret=${hasSecret ? 'yes' : 'no'} | payloadBytes=${Buffer.byteLength(payload)}`
  )

  return new Promise<void>((resolve, reject) => {
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
        debugLog(
          `[kl-plugin-webhook] ← ${res.statusCode} ${res.statusMessage ?? ''} | id=${webhook.id} | url=${webhook.url}`
        )
        res.resume() // drain response body
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      }
    )
    req.on('error', (err) => {
      console.error(
        `[kl-plugin-webhook] request error | id=${webhook.id} | url=${webhook.url}:`,
        err.message
      )
      reject(err)
    })
    req.on('timeout', () => {
      console.error(`[kl-plugin-webhook] timeout | id=${webhook.id} | url=${webhook.url}`)
      req.destroy()
      reject(new Error('Timeout'))
    })
    req.write(payload)
    req.end()
  })
}

function matchesEvent(pattern: string, event: string): boolean {
  if (pattern === '*') return true
  if (pattern === event) return true
  // Support glob-style prefix wildcards: 'card.*' matches 'card.created', 'card.action.triggered', etc.
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return event === prefix || event.startsWith(prefix + '.')
  }
  return false
}

export function fireWebhooks(workspaceRoot: string, event: string, data: unknown): void {
  const webhooks = readWebhooks(workspaceRoot)
  debugLog(`[kl-plugin-webhook] fireWebhooks: event=${event} | total=${webhooks.length} registered`)
  const matching = webhooks.filter((w) => w.active && w.events.some((p) => matchesEvent(p, event)))
  if (matching.length === 0) {
    debugLog(
      `[kl-plugin-webhook] no matching webhooks for event=${event} (${webhooks.filter((w) => !w.active).length} inactive)`
    )
    return
  }
  debugLog(
    `[kl-plugin-webhook] firing ${matching.length} webhook(s) for event=${event}: ${matching.map((w) => w.id).join(', ')}`
  )

  const isEnvelope = data !== null && typeof data === 'object' && 'data' in (data as object)
  const ap = isEnvelope ? (data as AfterEventPayload) : undefined
  const payload = JSON.stringify({
    event,
    timestamp: ap?.timestamp ?? new Date().toISOString(),
    actor: ap?.actor,
    boardId: ap?.boardId,
    meta: ap?.meta,
    data: isEnvelope ? ap!.data : data,
  })

  for (const webhook of matching) {
    deliverWebhook(webhook, event, payload).catch((err: unknown) => {
      console.error(
        `[kl-plugin-webhook] delivery failed for ${webhook.id} (${webhook.url}):`,
        err instanceof Error ? err.message : err
      )
    })
  }
}

// ---------------------------------------------------------------------------
// CRUD implementations
// ---------------------------------------------------------------------------

export function listWebhooks(workspaceRoot: string): Webhook[] {
  return readWebhooks(workspaceRoot)
}

export function createWebhook(
  workspaceRoot: string,
  input: { url: string; events: string[]; secret?: string }
): Webhook {
  const webhooks = readWebhooks(workspaceRoot)
  const webhook: Webhook = {
    id: generateWebhookId(),
    url: input.url,
    events: [...input.events],
    active: true,
    ...(input.secret !== undefined ? { secret: input.secret } : {})
  }
  webhooks.push(webhook)
  writeWebhooks(workspaceRoot, webhooks)
  return webhook
}

export function updateWebhook(
  workspaceRoot: string,
  id: string,
  updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>
): Webhook | null {
  const webhooks = readWebhooks(workspaceRoot)
  const index = webhooks.findIndex((w) => w.id === id)
  if (index === -1) return null
  const updated: Webhook = { ...webhooks[index], ...updates }
  webhooks[index] = updated
  writeWebhooks(workspaceRoot, webhooks)
  return updated
}

export function deleteWebhook(workspaceRoot: string, id: string): boolean {
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

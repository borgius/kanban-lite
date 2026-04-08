import * as crypto from 'crypto'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import type {
  EventBus,
  McpPluginRegistration,
  McpToolContext,
  McpToolDefinition,
  McpToolResult,
  SDKEventListenerPlugin,
  SDKExtensionPlugin,
  StandaloneHttpHandler,
  StandaloneHttpPlugin,
  Webhook,
  WebhookProviderPlugin,
  KanbanSDK,
} from 'kanban-lite/sdk'
import {
  debugLog,
  SDK_AFTER_EVENT_NAMES,
  readWebhooks,
  fireWebhooks,
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from './helpers'

export class WebhookListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest = {
    id: 'webhooks',
    provides: ['event.listener'] as const
  }

  private _unsubscribe: (() => void) | null = null

  constructor(private readonly _workspaceRoot: string) {
    debugLog(
      `[kl-plugin-webhook] WebhookListenerPlugin constructed | workspaceRoot=${_workspaceRoot}`
    )
  }

  register(bus: EventBus): void {
    if (this._unsubscribe) {
      debugLog('[kl-plugin-webhook] WebhookListenerPlugin already registered, skipping')
      return
    }
    const webhooks = readWebhooks(this._workspaceRoot)
    debugLog(
      `[kl-plugin-webhook] WebhookListenerPlugin.register() | ${webhooks.length} webhook(s) configured: ${webhooks.map((w) => `${w.id}(${w.active ? 'active' : 'inactive'}) → ${w.url}`).join(', ') || 'none'}`
    )
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
    provides: ['webhook.delivery']
  },
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook
}

export default webhookProviderPlugin

// ---------------------------------------------------------------------------
// SDK extension pack (SPE-03)
// Contributes webhook CRUD methods to the SDK extensions bag so callers can
// access them through `sdk.getExtension('kl-plugin-webhook')`.
// ---------------------------------------------------------------------------

/**
 * Shape of the SDK extension bag contributed by this package.
 *
 * Accessible via `sdk.getExtension<WebhookSdkExtensions>('kl-plugin-webhook')`
 * after the package is loaded as the active `webhook.delivery` provider.
 */
export interface WebhookSdkExtensions extends Record<string, unknown> {
  listWebhooks(workspaceRoot: string): Webhook[]
  createWebhook(
    workspaceRoot: string,
    input: { url: string; events: string[]; secret?: string }
  ): Webhook
  updateWebhook(
    workspaceRoot: string,
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>
  ): Webhook | null
  deleteWebhook(workspaceRoot: string, id: string): boolean
}

/**
 * SDK extension pack for `kl-plugin-webhook`.
 *
 * Contributes the four canonical webhook CRUD methods to the SDK extensions bag.
 * Discovered by the kanban-lite plugin loader whenever this package is active
 * as the `webhook.delivery` provider (the default for all workspaces).
 *
 * Access the extensions through:
 * ```ts
 * const ext = sdk.getExtension<WebhookSdkExtensions>('kl-plugin-webhook')
 * const webhooks = ext?.listWebhooks(sdk.workspaceRoot) ?? []
 * ```
 */
export const sdkExtensionPlugin: SDKExtensionPlugin<WebhookSdkExtensions> = {
  manifest: {
    id: 'kl-plugin-webhook',
    provides: ['sdk.extension'] as const
  },
  extensions: {
    listWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook
  }
}

// ---------------------------------------------------------------------------
// MCP plugin – webhook tool ownership
// ---------------------------------------------------------------------------

function redactWebhook<T extends { secret?: string }>(w: T): Omit<T, 'secret'> {
  const { secret: _secret, ...safe } = w
  return safe as Omit<T, 'secret'>
}

export const mcpPlugin: McpPluginRegistration = {
  manifest: {
    id: 'webhooks',
    provides: ['mcp.tools']
  },
  registerTools(): readonly McpToolDefinition[] {
    return [
      {
        name: 'list_webhooks',
        description: 'List all registered webhooks.',
        inputSchema: () => ({}),
        handler: async (_args, ctx) => {
          try {
            const webhooks = await ctx.runWithAuth(() => Promise.resolve(ctx.sdk.listWebhooks()))
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(webhooks.map(redactWebhook), null, 2)
                }
              ]
            }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        }
      },
      {
        name: 'add_webhook',
        description: 'Register a new webhook to receive event notifications.',
        inputSchema: (z) => ({
          url: z.string().describe('Webhook target URL (HTTP/HTTPS)'),
          events: z
            .array(z.string())
            .optional()
            .describe(
              'Events to subscribe to (e.g. ["task.created", "task.updated"]). Default: ["*"] for all.'
            ),
          secret: z.string().optional().describe('Optional HMAC-SHA256 signing secret')
        }),
        handler: async (args, ctx) => {
          const { url, events, secret } = args as {
            url: string
            events?: string[]
            secret?: string
          }
          try {
            const webhook = await ctx.runWithAuth(() =>
              Promise.resolve(ctx.sdk.createWebhook({ url, events: events || ['*'], secret }))
            )
            return {
              content: [
                { type: 'text' as const, text: JSON.stringify(redactWebhook(webhook), null, 2) }
              ]
            }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        }
      },
      {
        name: 'remove_webhook',
        description: 'Remove a registered webhook by ID.',
        inputSchema: (z) => ({
          webhookId: z.string().describe('Webhook ID (e.g. "wh_abc123")')
        }),
        handler: async (args, ctx) => {
          const { webhookId } = args as { webhookId: string }
          try {
            const removed = await ctx.runWithAuth(() =>
              Promise.resolve(ctx.sdk.deleteWebhook(webhookId))
            )
            if (!removed) {
              return {
                content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }],
                isError: true
              }
            }
            return { content: [{ type: 'text' as const, text: `Deleted webhook: ${webhookId}` }] }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        }
      },
      {
        name: 'update_webhook',
        description:
          'Update an existing webhook configuration (URL, events, secret, or active status).',
        inputSchema: (z) => ({
          webhookId: z.string().describe('Webhook ID (e.g. "wh_abc123")'),
          url: z.string().optional().describe('New webhook target URL'),
          events: z.array(z.string()).optional().describe('New events to subscribe to'),
          secret: z.string().optional().describe('New HMAC-SHA256 signing secret'),
          active: z.boolean().optional().describe('Set webhook active (true) or inactive (false)')
        }),
        handler: async (args, ctx) => {
          const { webhookId, url, events, secret, active } = args as {
            webhookId: string
            url?: string
            events?: string[]
            secret?: string
            active?: boolean
          }
          const updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>> = {}
          if (url !== undefined) updates.url = url
          if (events !== undefined) updates.events = events
          if (secret !== undefined) updates.secret = secret
          if (active !== undefined) updates.active = active
          try {
            const updated = await ctx.runWithAuth(() =>
              Promise.resolve(ctx.sdk.updateWebhook(webhookId, updates))
            )
            if (!updated) {
              return {
                content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }],
                isError: true
              }
            }
            return {
              content: [
                { type: 'text' as const, text: JSON.stringify(redactWebhook(updated), null, 2) }
              ]
            }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Standalone HTTP plugin – /api/webhooks route ownership
// ---------------------------------------------------------------------------

function pluginJsonOk(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ ok: true, data }))
}

function pluginJsonError(res: http.ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ ok: false, error }))
}

async function pluginReadBody(
  req: http.IncomingMessage & { _rawBody?: Buffer }
): Promise<Record<string, unknown>> {
  if (req._rawBody instanceof Buffer) {
    try {
      return JSON.parse(req._rawBody.toString('utf-8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function pluginExtractAuth(req: http.IncomingMessage): {
  token?: string
  tokenSource?: string
  transport?: string
} {
  const header = req.headers['authorization']
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return { token: header.slice(7), tokenSource: 'request-header', transport: 'http' }
  }
  return { transport: 'http' }
}

function isAuthErrorLike(err: unknown): boolean {
  const category = (err as Record<string, unknown> | null | undefined)?.category
  return typeof category === 'string' && category.startsWith('auth.')
}

function authErrToStatus(err: unknown): 401 | 403 | 500 {
  const category = (err as Record<string, unknown>)?.category as string | undefined
  if (category === 'auth.unauthorized') return 401
  if (category === 'auth.forbidden' || category === 'auth.policy.denied') return 403
  return 500
}

function authErrMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)) || 'Unauthorized'
}

const handleGetWebhooks: StandaloneHttpHandler = async (ctx) => {
  if (!ctx.route('GET', '/api/webhooks')) return false
  const auth = pluginExtractAuth(ctx.req)
  try {
    const data = await ctx.sdk.runWithAuth(auth, () => Promise.resolve(ctx.sdk.listWebhooks()))
    pluginJsonOk(ctx.res, data)
  } catch (err) {
    if (isAuthErrorLike(err)) {
      pluginJsonError(ctx.res, authErrToStatus(err), authErrMessage(err))
    } else {
      pluginJsonError(ctx.res, 500, 'Internal error')
    }
  }
  return true
}

const handlePostWebhook: StandaloneHttpHandler = async (ctx) => {
  if (!ctx.route('POST', '/api/webhooks')) return false
  const auth = pluginExtractAuth(ctx.req)
  try {
    const body = await pluginReadBody(ctx.req as http.IncomingMessage & { _rawBody?: Buffer })
    if (typeof body.url !== 'string' || !Array.isArray(body.events)) {
      pluginJsonError(ctx.res, 400, 'url and events are required')
      return true
    }
    const data = await ctx.sdk.runWithAuth(auth, () =>
      Promise.resolve(
        ctx.sdk.createWebhook({
          url: body.url as string,
          events: body.events as string[],
          secret: typeof body.secret === 'string' ? body.secret : undefined
        })
      )
    )
    pluginJsonOk(ctx.res, data, 201)
  } catch (err) {
    if (isAuthErrorLike(err)) {
      pluginJsonError(ctx.res, authErrToStatus(err), authErrMessage(err))
    } else {
      pluginJsonError(ctx.res, 500, 'Internal error')
    }
  }
  return true
}

const handlePutWebhook: StandaloneHttpHandler = async (ctx) => {
  const params = ctx.route('PUT', '/api/webhooks/:id')
  if (!params) return false
  const { id } = params
  const auth = pluginExtractAuth(ctx.req)
  try {
    const body = await pluginReadBody(ctx.req as http.IncomingMessage & { _rawBody?: Buffer })
    const updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>> = {}
    if (typeof body.url === 'string') updates.url = body.url
    if (Array.isArray(body.events)) updates.events = body.events as string[]
    if (typeof body.secret === 'string') updates.secret = body.secret
    if (typeof body.active === 'boolean') updates.active = body.active
    const data = await ctx.sdk.runWithAuth(auth, () =>
      Promise.resolve(ctx.sdk.updateWebhook(id, updates))
    )
    if (data === null) {
      pluginJsonError(ctx.res, 404, 'Webhook not found')
    } else {
      pluginJsonOk(ctx.res, data)
    }
  } catch (err) {
    if (isAuthErrorLike(err)) {
      pluginJsonError(ctx.res, authErrToStatus(err), authErrMessage(err))
    } else {
      pluginJsonError(ctx.res, 500, 'Internal error')
    }
  }
  return true
}

const handleDeleteWebhook: StandaloneHttpHandler = async (ctx) => {
  const params = ctx.route('DELETE', '/api/webhooks/:id')
  if (!params) return false
  const { id } = params
  const auth = pluginExtractAuth(ctx.req)
  try {
    const deleted = await ctx.sdk.runWithAuth(auth, () =>
      Promise.resolve(ctx.sdk.deleteWebhook(id))
    )
    if (!deleted) {
      pluginJsonError(ctx.res, 404, 'Webhook not found')
    } else {
      pluginJsonOk(ctx.res, { id })
    }
  } catch (err) {
    if (isAuthErrorLike(err)) {
      pluginJsonError(ctx.res, authErrToStatus(err), authErrMessage(err))
    } else {
      pluginJsonError(ctx.res, 500, 'Internal error')
    }
  }
  return true
}

/**
 * Test endpoint: `POST /api/webhooks/test`.
 *
 * Receives an arbitrary webhook payload and writes it to the board log so
 * operators can verify that webhooks are delivered correctly without needing an
 * external receiver.  Point a webhook URL at
 * `http://localhost:<port>/api/webhooks/test` to exercise the full delivery
 * pipeline end-to-end.
 */
const handlePostWebhookTest: StandaloneHttpHandler = async (ctx) => {
  if (!ctx.route('POST', '/api/webhooks/test')) return false
  debugLog('[kl-plugin-webhook] POST /api/webhooks/test received')
  try {
    const body = await pluginReadBody(ctx.req as http.IncomingMessage & { _rawBody?: Buffer })
    const event = typeof body.event === 'string' ? body.event : 'unknown'
    // Guard against infinite delivery loops: log-related events are emitted by this
    // handler itself, so re-delivering them would cause a cycle. Acknowledge and skip.
    const LOG_EVENTS = new Set(['board.log.added', 'board.log.cleared', 'log.added', 'log.cleared'])
    if (LOG_EVENTS.has(event)) {
      pluginJsonOk(ctx.res, { received: true, event })
      return true
    }
    const ts = typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString()
    const text = `[webhook-test] Received event: ${event}`
    debugLog(`[kl-plugin-webhook] /test: writing board log for event=${event}`)
    // Use a pre-resolved system identity so the auth policy allows the call
    // without requiring a real user token (webhooks are server-initiated).
    const systemAuth = {
      transport: 'system',
      identity: { subject: 'system:webhook-test', roles: ['admin'] }
    }
    await ctx.sdk.runWithAuth(systemAuth, () =>
      ctx.sdk.addBoardLog(text, {
        source: 'webhook-test',
        timestamp: ts,
        object: body as Record<string, unknown>
      })
    )
    debugLog(`[kl-plugin-webhook] /test: board log written for event=${event}`)
    pluginJsonOk(ctx.res, { received: true, event })
  } catch (err) {
    console.error(
      '[kl-plugin-webhook] /test: error writing board log:',
      err instanceof Error ? err.message : err
    )
    pluginJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Internal error')
  }
  return true
}

/**
 * Standalone HTTP plugin that registers `/api/webhooks` route ownership for the
 * kanban-lite standalone server.
 *
 * When this package is installed and the `webhook.delivery` provider is
 * configured, the standalone HTTP seam loads this plugin automatically and runs
 * its route handlers _before_ the built-in core system routes. No manual
 * configuration is needed: the same CRUD surface is exposed via the same
 * `/api/webhooks` paths; delivery is handled by {@link webhookProviderPlugin}.
 *
 * This plugin is the route owner for the standalone `/api/webhooks` surface.
 */
export const standaloneHttpPlugin: StandaloneHttpPlugin = {
  manifest: {
    id: 'webhooks',
    provides: ['standalone.http'] as const
  },
  registerRoutes(): readonly StandaloneHttpHandler[] {
    return [
      handleGetWebhooks,
      handlePostWebhookTest,
      handlePostWebhook,
      handlePutWebhook,
      handleDeleteWebhook
    ]
  }
}

// ---------------------------------------------------------------------------
// CLI plugin – webhook command ownership
// ---------------------------------------------------------------------------

// Minimal ANSI helpers — avoids importing core coloring utilities.

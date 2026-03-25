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
  /** Unique identifier (e.g., `'wh_a1b2c3d4e5f6a7b8'`). */
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
  plugins?: {
    'webhook.delivery'?: {
      provider?: string
      options?: {
        webhooks?: Webhook[]
        [key: string]: unknown
      }
      [key: string]: unknown
    }
    [key: string]: unknown
  }
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
  'card.action.triggered',
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
    const webhooks = raw.plugins?.['webhook.delivery']?.options?.webhooks
    return Array.isArray(webhooks) ? webhooks : []
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
  if (!config.plugins) config.plugins = {}
  if (!config.plugins['webhook.delivery']) config.plugins['webhook.delivery'] = { provider: 'kl-webhooks-plugin' }
  if (!config.plugins['webhook.delivery'].options) config.plugins['webhook.delivery'].options = {}
  config.plugins['webhook.delivery'].options['webhooks'] = webhooks
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

function fireWebhooks(workspaceRoot: string, event: string, data: unknown): void {
  const webhooks = readWebhooks(workspaceRoot)
  const matching = webhooks.filter(
    (w) => w.active && w.events.some((p) => matchesEvent(p, event)),
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

// ---------------------------------------------------------------------------
// SDK extension pack (SPE-03)
// Contributes webhook CRUD methods to the SDK extensions bag so callers can
// access them through `sdk.getExtension('kl-webhooks-plugin')`.
// ---------------------------------------------------------------------------

/**
 * Shape of the SDK extension bag contributed by this package.
 *
 * Accessible via `sdk.getExtension<WebhookSdkExtensions>('kl-webhooks-plugin')`
 * after the package is loaded as the active `webhook.delivery` provider.
 */
export interface WebhookSdkExtensions {
  listWebhooks(workspaceRoot: string): Webhook[]
  createWebhook(workspaceRoot: string, input: { url: string; events: string[]; secret?: string }): Webhook
  updateWebhook(
    workspaceRoot: string,
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): Webhook | null
  deleteWebhook(workspaceRoot: string, id: string): boolean
}

interface WebhookCliSdkExtensionHost {
  getExtension?<T = unknown>(id: string): T | undefined
  listWebhooks(): Webhook[]
  createWebhook(input: { url: string; events: string[]; secret?: string }): Promise<Webhook>
  updateWebhook(
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): Promise<Webhook | null>
  deleteWebhook(id: string): Promise<boolean>
}

function getWebhookSdkExtensions(sdk?: WebhookCliSdkExtensionHost): WebhookSdkExtensions | undefined {
  return sdk?.getExtension?.<WebhookSdkExtensions>('kl-webhooks-plugin')
}

/**
 * SDK extension pack for `kl-webhooks-plugin`.
 *
 * Contributes the four canonical webhook CRUD methods to the SDK extensions bag.
 * Discovered by the kanban-lite plugin loader whenever this package is active
 * as the `webhook.delivery` provider (the default for all workspaces).
 *
 * Access the extensions through:
 * ```ts
 * const ext = sdk.getExtension<WebhookSdkExtensions>('kl-webhooks-plugin')
 * const webhooks = ext?.listWebhooks(sdk.workspaceRoot) ?? []
 * ```
 */
export const sdkExtensionPlugin = {
  manifest: {
    id: 'kl-webhooks-plugin',
    provides: ['sdk.extension'] as const,
  },
  extensions: {
    listWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
  },
} satisfies { manifest: { id: string; provides: readonly string[] }; extensions: WebhookSdkExtensions }

// ---------------------------------------------------------------------------
// MCP plugin – webhook tool ownership
// ---------------------------------------------------------------------------

interface McpToolResult {
  readonly content: Array<{ type: 'text'; text: string }>
  readonly isError?: boolean
}

interface McpWebhookSdkHost {
  listWebhooks(): Webhook[]
  createWebhook(input: { url: string; events: string[]; secret?: string }): Promise<Webhook>
  updateWebhook(
    id: string,
    updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): Promise<Webhook | null>
  deleteWebhook(id: string): Promise<boolean>
}

interface McpToolContext {
  readonly sdk: McpWebhookSdkHost
  runWithAuth<T>(fn: () => Promise<T>): Promise<T>
  toErrorResult(err: unknown): McpToolResult
}

interface McpZodType {
  optional(): McpZodType
  describe(description: string): McpZodType
}

interface McpZodFactory {
  string(): McpZodType
  array(item: McpZodType): McpZodType
  boolean(): McpZodType
}

interface McpToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: (z: McpZodFactory) => Record<string, McpZodType>
  readonly handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<McpToolResult>
}

interface McpPluginRegistration {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  registerTools(ctx: McpToolContext): readonly McpToolDefinition[]
}

function redactWebhook<T extends { secret?: string }>(w: T): Omit<T, 'secret'> {
  const { secret: _secret, ...safe } = w
  return safe as Omit<T, 'secret'>
}

export const mcpPlugin: McpPluginRegistration = {
  manifest: {
    id: 'webhooks',
    provides: ['mcp.tools'],
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
            return { content: [{ type: 'text' as const, text: JSON.stringify(webhooks.map(redactWebhook), null, 2) }] }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        },
      },
      {
        name: 'add_webhook',
        description: 'Register a new webhook to receive event notifications.',
        inputSchema: (z) => ({
          url: z.string().describe('Webhook target URL (HTTP/HTTPS)'),
          events: z.array(z.string()).optional().describe('Events to subscribe to (e.g. ["task.created", "task.updated"]). Default: ["*"] for all.'),
          secret: z.string().optional().describe('Optional HMAC-SHA256 signing secret'),
        }),
        handler: async (args, ctx) => {
          const { url, events, secret } = args as { url: string; events?: string[]; secret?: string }
          try {
            const webhook = await ctx.runWithAuth(() => ctx.sdk.createWebhook({ url, events: events || ['*'], secret }))
            return { content: [{ type: 'text' as const, text: JSON.stringify(redactWebhook(webhook), null, 2) }] }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        },
      },
      {
        name: 'remove_webhook',
        description: 'Remove a registered webhook by ID.',
        inputSchema: (z) => ({
          webhookId: z.string().describe('Webhook ID (e.g. "wh_abc123")'),
        }),
        handler: async (args, ctx) => {
          const { webhookId } = args as { webhookId: string }
          try {
            const removed = await ctx.runWithAuth(() => ctx.sdk.deleteWebhook(webhookId))
            if (!removed) {
              return { content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }], isError: true }
            }
            return { content: [{ type: 'text' as const, text: `Deleted webhook: ${webhookId}` }] }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        },
      },
      {
        name: 'update_webhook',
        description: 'Update an existing webhook configuration (URL, events, secret, or active status).',
        inputSchema: (z) => ({
          webhookId: z.string().describe('Webhook ID (e.g. "wh_abc123")'),
          url: z.string().optional().describe('New webhook target URL'),
          events: z.array(z.string()).optional().describe('New events to subscribe to'),
          secret: z.string().optional().describe('New HMAC-SHA256 signing secret'),
          active: z.boolean().optional().describe('Set webhook active (true) or inactive (false)'),
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
            const updated = await ctx.runWithAuth(() => ctx.sdk.updateWebhook(webhookId, updates))
            if (!updated) {
              return { content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }], isError: true }
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(redactWebhook(updated), null, 2) }] }
          } catch (err) {
            return ctx.toErrorResult(err)
          }
        },
      },
    ]
  },
}

// ---------------------------------------------------------------------------
// Standalone HTTP plugin – /api/webhooks route ownership
// ---------------------------------------------------------------------------

/**
 * Minimal duck-typed request context provided by the standalone HTTP seam.
 * Mirrors `StandaloneHttpRequestContext` from kanban-lite core without importing it.
 */
interface PluginHttpRequestContext {
  readonly sdk: {
    listWebhooks(): Webhook[]
    createWebhook(input: { url: string; events: string[]; secret?: string }): Promise<Webhook>
    updateWebhook(
      id: string,
      updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
    ): Promise<Webhook | null>
    deleteWebhook(id: string): Promise<boolean>
    addBoardLog(
      text: string,
      options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
      boardId?: string,
    ): Promise<unknown>
    runWithAuth<T>(
      auth: { token?: string; tokenSource?: string; transport?: string; identity?: { subject: string; roles?: string[] } },
      fn: () => Promise<T>,
    ): Promise<T>
  }
  readonly req: http.IncomingMessage & { _rawBody?: Buffer }
  readonly res: http.ServerResponse
  route(method: string, pattern: string): Record<string, string> | null
}

type PluginHttpHandler = (ctx: PluginHttpRequestContext) => Promise<boolean>

function pluginJsonOk(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ ok: true, data }))
}

function pluginJsonError(res: http.ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ ok: false, error }))
}

async function pluginReadBody(
  req: http.IncomingMessage & { _rawBody?: Buffer },
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

const handleGetWebhooks: PluginHttpHandler = async (ctx) => {
  if (!ctx.route('GET', '/api/webhooks')) return false
  const auth = pluginExtractAuth(ctx.req)
  try {
    const data = await ctx.sdk.runWithAuth(auth, async () => ctx.sdk.listWebhooks())
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

const handlePostWebhook: PluginHttpHandler = async (ctx) => {
  if (!ctx.route('POST', '/api/webhooks')) return false
  const auth = pluginExtractAuth(ctx.req)
  try {
    const body = await pluginReadBody(ctx.req)
    if (typeof body.url !== 'string' || !Array.isArray(body.events)) {
      pluginJsonError(ctx.res, 400, 'url and events are required')
      return true
    }
    const data = await ctx.sdk.runWithAuth(auth, () =>
      ctx.sdk.createWebhook({
        url: body.url as string,
        events: body.events as string[],
        secret: typeof body.secret === 'string' ? body.secret : undefined,
      }),
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

const handlePutWebhook: PluginHttpHandler = async (ctx) => {
  const params = ctx.route('PUT', '/api/webhooks/:id')
  if (!params) return false
  const { id } = params
  const auth = pluginExtractAuth(ctx.req)
  try {
    const body = await pluginReadBody(ctx.req)
    const updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>> = {}
    if (typeof body.url === 'string') updates.url = body.url
    if (Array.isArray(body.events)) updates.events = body.events as string[]
    if (typeof body.secret === 'string') updates.secret = body.secret
    if (typeof body.active === 'boolean') updates.active = body.active
    const data = await ctx.sdk.runWithAuth(auth, () => ctx.sdk.updateWebhook(id, updates))
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

const handleDeleteWebhook: PluginHttpHandler = async (ctx) => {
  const params = ctx.route('DELETE', '/api/webhooks/:id')
  if (!params) return false
  const { id } = params
  const auth = pluginExtractAuth(ctx.req)
  try {
    const deleted = await ctx.sdk.runWithAuth(auth, () => ctx.sdk.deleteWebhook(id))
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
const handlePostWebhookTest: PluginHttpHandler = async (ctx) => {
  if (!ctx.route('POST', '/api/webhooks/test')) return false
  try {
    const body = await pluginReadBody(ctx.req)
    const event = typeof body.event === 'string' ? body.event : 'unknown'
    const ts = typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString()
    const text = `[webhook-test] Received event: ${event}`
    // Use a pre-resolved system identity so the auth policy allows the call
    // without requiring a real user token (webhooks are server-initiated).
    const systemAuth = {
      transport: 'system',
      identity: { subject: 'system:webhook-test', roles: ['admin'] },
    }
    await ctx.sdk.runWithAuth(systemAuth, () =>
      ctx.sdk.addBoardLog(text, {
        source: 'webhook-test',
        timestamp: ts,
        object: body as Record<string, unknown>,
      }),
    )
    pluginJsonOk(ctx.res, { received: true, event })
  } catch (err) {
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
export const standaloneHttpPlugin = {
  manifest: {
    id: 'webhooks',
    provides: ['standalone.http'] as const,
  },
  registerRoutes(_options?: unknown): readonly PluginHttpHandler[] {
    return [handleGetWebhooks, handlePostWebhookTest, handlePostWebhook, handlePutWebhook, handleDeleteWebhook]
  },
} as const

// ---------------------------------------------------------------------------
// CLI plugin – webhook command ownership
// ---------------------------------------------------------------------------

// Minimal ANSI helpers — avoids importing core coloring utilities.
function _bold(s: string): string { return `\x1b[1m${s}\x1b[0m` }
function _green(s: string): string { return `\x1b[32m${s}\x1b[0m` }
function _red(s: string): string { return `\x1b[31m${s}\x1b[0m` }
function _dim(s: string): string { return `\x1b[2m${s}\x1b[0m` }

/**
 * CLI plugin that contributes the `webhooks` top-level command family to the
 * `kl` CLI.
 *
 * This plugin owns the canonical CLI implementation for webhook CRUD.
 * The core `kl` CLI loads this plugin automatically when `kl-webhooks-plugin`
 * is active (the default for all workspaces) and routes the `webhooks`,
 * `webhook`, and `wh` commands here.
 *
 * Sub-commands: `list` (default), `add`, `update`, `remove` / `rm`
 *
 * @example
 * ```sh
 * kl webhooks
 * kl webhooks add --url https://example.com/hook --events task.created
 * kl webhooks update wh_abc --active false
 * kl webhooks remove wh_abc
 * ```
 */
export const cliPlugin = {
  manifest: { id: 'webhooks' },
  command: 'webhooks',
  aliases: ['webhook', 'wh'],
  async run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: { workspaceRoot: string; sdk?: WebhookCliSdkExtensionHost; runWithCliAuth?: <T>(fn: () => Promise<T>) => Promise<T> },
  ): Promise<void> {
    const { workspaceRoot } = context
    const subcommand = subArgs[0] || 'list'
    const sdkExtensions = getWebhookSdkExtensions(context.sdk)

    // Helpers that delegate through SDK auth when the core CLI context is present,
    // falling back to direct local calls for backward compatibility (e.g. unit tests).
    const _list = (): Webhook[] =>
      sdkExtensions ? sdkExtensions.listWebhooks(workspaceRoot)
        : context.sdk ? context.sdk.listWebhooks() : listWebhooks(workspaceRoot)
    const _create = (input: { url: string; events: string[]; secret?: string }): Promise<Webhook> =>
      context.sdk && context.runWithCliAuth
        ? context.runWithCliAuth(() => Promise.resolve(
          sdkExtensions ? sdkExtensions.createWebhook(workspaceRoot, input) : context.sdk!.createWebhook(input),
        ))
        : Promise.resolve(createWebhook(workspaceRoot, input))
    const _delete = (id: string): Promise<boolean> =>
      context.sdk && context.runWithCliAuth
        ? context.runWithCliAuth(() => Promise.resolve(
          sdkExtensions ? sdkExtensions.deleteWebhook(workspaceRoot, id) : context.sdk!.deleteWebhook(id),
        ))
        : Promise.resolve(deleteWebhook(workspaceRoot, id))
    const _update = (
      id: string,
      updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>,
    ): Promise<Webhook | null> =>
      context.sdk && context.runWithCliAuth
        ? context.runWithCliAuth(() => Promise.resolve(
          sdkExtensions ? sdkExtensions.updateWebhook(workspaceRoot, id, updates) : context.sdk!.updateWebhook(id, updates),
        ))
        : Promise.resolve(updateWebhook(workspaceRoot, id, updates))

    switch (subcommand) {
      case 'list': {
        const webhooks = _list()
        if (flags.json) {
          console.log(JSON.stringify(webhooks, null, 2))
        } else if (webhooks.length === 0) {
          console.log(_dim('  No webhooks registered.'))
        } else {
          console.log(`  ${_dim('ID'.padEnd(22))}  ${_dim('URL'.padEnd(40))}  ${_dim('EVENTS'.padEnd(20))}  ${_dim('ACTIVE')}`)
          console.log(_dim('  ' + '-'.repeat(90)))
          for (const w of webhooks) {
            const events = w.events.join(', ')
            const active = w.active ? _green('yes') : _red('no')
            console.log(`  ${_bold(w.id.padEnd(22))}  ${w.url.padEnd(40)}  ${events.padEnd(20)}  ${active}`)
          }
        }
        break
      }
      case 'add': {
        const url = typeof flags.url === 'string' ? flags.url : ''
        if (!url) {
          console.error(_red('Usage: kl webhooks add --url <url> [--events <event1,event2>] [--secret <key>]'))
          process.exit(1)
        }
        const events = typeof flags.events === 'string' ? flags.events.split(',').map(e => e.trim()) : ['*']
        const secret = typeof flags.secret === 'string' ? flags.secret : undefined
        const webhook = await _create({ url, events, secret })
        if (flags.json) {
          console.log(JSON.stringify(webhook, null, 2))
        } else {
          console.log(_green(`Created webhook: ${webhook.id}`))
          console.log(`  URL:    ${webhook.url}`)
          console.log(`  Events: ${webhook.events.join(', ')}`)
          if (webhook.secret) console.log(`  Secret: ${_dim('(configured)')}`)
        }
        break
      }
      case 'remove':
      case 'rm': {
        const webhookId = subArgs[1]
        if (!webhookId) {
          console.error(_red('Usage: kl webhooks remove <id>'))
          process.exit(1)
        }
        const removed = await _delete(webhookId)
        if (removed) {
          console.log(_green(`Removed webhook: ${webhookId}`))
        } else {
          console.error(_red(`Webhook not found: ${webhookId}`))
          process.exit(1)
        }
        break
      }
      case 'update': {
        const webhookId = subArgs[1]
        if (!webhookId) {
          console.error(_red('Usage: kl webhooks update <id> [--url <url>] [--events <e1,e2>] [--secret <key>] [--active true|false]'))
          process.exit(1)
        }
        const updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>> = {}
        if (typeof flags.url === 'string') updates.url = flags.url
        if (typeof flags.events === 'string') updates.events = flags.events.split(',').map(e => e.trim())
        if (typeof flags.secret === 'string') updates.secret = flags.secret
        if (typeof flags.active === 'string') updates.active = flags.active === 'true'
        const updated = await _update(webhookId, updates)
        if (!updated) {
          console.error(_red(`Webhook not found: ${webhookId}`))
          process.exit(1)
        }
        if (flags.json) {
          console.log(JSON.stringify(updated, null, 2))
        } else {
          console.log(_green(`Updated webhook: ${updated.id}`))
          console.log(`  URL:    ${updated.url}`)
          console.log(`  Events: ${updated.events.join(', ')}`)
          console.log(`  Active: ${updated.active ? _green('yes') : _red('no')}`)
        }
        break
      }
      default:
        console.error(_red(`Unknown webhooks subcommand: ${subcommand}`))
        console.error('Available: list, add, update, remove')
        process.exit(1)
    }
  },
} as const

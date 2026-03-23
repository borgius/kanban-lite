/**
 * API transport adapter for Kanban Lite n8n nodes.
 *
 * Executes operations against a running Kanban Lite standalone server via
 * HTTP and registers/unregisters webhook subscriptions for trigger events.
 * Only committed after-events (`apiAfter=true`) are available in this mode.
 *
 * Attempting to subscribe to a before-event (`sdkBefore=true, apiAfter=false`)
 * throws a {@link KanbanTransportError} with code `'transport.unsupported_event'`
 * and an actionable message explaining that the event requires SDK transport.
 *
 * @module transport/apiAdapter
 */

import type {
  ApiTransportCredentials,
  EventCapabilityEntry,
  KanbanLiteResult,
  KanbanLiteTransport,
  SubscribeOptions,
  TriggerRegistration,
} from './types'
import { KanbanTransportError } from './types'
import {
  DEFAULT_EVENT_CAPABILITIES,
  buildApiHeaders,
  normalizeResult,
  resolveApiRoute,
  throwApiError,
} from './normalize'

// ---------------------------------------------------------------------------
// HTTP fetch abstraction (injectable for testing)
// ---------------------------------------------------------------------------

/** Minimal fetch-compatible signature used by the API adapter. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'>>

// ---------------------------------------------------------------------------
// API Transport adapter
// ---------------------------------------------------------------------------

/** Options for constructing an {@link ApiTransport}. */
export interface ApiTransportOptions {
  /** Credentials for connecting to the standalone Kanban Lite server. */
  credentials: ApiTransportCredentials
  /**
   * Optional event capability catalog. When omitted, the built-in
   * {@link DEFAULT_EVENT_CAPABILITIES} is used.
   */
  eventCapabilities?: readonly EventCapabilityEntry[]
  /**
   * Injectable fetch function for unit testing.
   * Defaults to the global `fetch` when not provided.
   */
  fetchFn?: FetchFn
}

/**
 * Remote API transport adapter.
 *
 * Routes action executions to the standalone server's REST API and subscribes
 * to events by registering webhooks via POST /api/webhooks. Trigger lifecycle
 * cleanup (dispose) deletes the registered webhook via DELETE /api/webhooks/:id.
 *
 * Only after-events (`apiAfter=true`) are supported. Subscribing to a
 * before-event throws a clear, actionable error.
 */
export class ApiTransport implements KanbanLiteTransport {
  readonly mode = 'api' as const

  private readonly creds: ApiTransportCredentials
  private readonly capabilities: Map<string, EventCapabilityEntry>
  private readonly fetch: FetchFn

  constructor(options: ApiTransportOptions) {
    this.creds = options.credentials
    const catalog = options.eventCapabilities ?? DEFAULT_EVENT_CAPABILITIES
    this.capabilities = new Map(catalog.map(e => [e.event, e]))
    this.fetch = options.fetchFn ?? (globalThis.fetch as FetchFn)
  }

  /** @inheritdoc */
  canSubscribe(eventName: string): boolean {
    const entry = this.capabilities.get(eventName)
    return entry !== undefined && entry.apiAfter === true
  }

  /** @inheritdoc */
  async subscribe(
    eventName: string,
    _handler: (payload: unknown) => void,
    options?: SubscribeOptions,
  ): Promise<TriggerRegistration> {
    const entry = this.capabilities.get(eventName)

    // Explicit rejection for before-events with a helpful message.
    if (entry && entry.sdkBefore && !entry.apiAfter) {
      throw new KanbanTransportError(
        'transport.unsupported_event',
        `Event "${eventName}" is a before-event (interceptor) and is only available in SDK transport mode. ` +
          'Switch the trigger node transport to "Local SDK" or choose an after-event for API mode. ' +
          'After-events have past-tense names (e.g. "task.created" instead of "card.create").',
      )
    }

    if (!this.canSubscribe(eventName)) {
      throw new KanbanTransportError(
        'transport.unsupported_event',
        `Event "${eventName}" is not available in API transport mode. ` +
          'Only after-events (apiAfter=true) can be delivered via webhook.',
      )
    }

    if (!options?.callbackUrl) {
      throw new KanbanTransportError(
        'transport.missing_callback_url',
        'API transport subscribe() requires options.callbackUrl to be set to the n8n webhook endpoint URL.',
      )
    }

    const baseUrl = this.creds.baseUrl.replace(/\/$/, '')
    const headers = buildApiHeaders(this.creds)

    const body: Record<string, unknown> = {
      url: options.callbackUrl,
      events: [eventName],
    }
    if (options.secret) body['secret'] = options.secret

    const response = await this.fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throwApiError(response.status, text)
    }

    const webhookData = (await response.json()) as Record<string, unknown>
    const webhookId = typeof webhookData['id'] === 'string' ? webhookData['id'] : String(Date.now())

    let disposed = false
    const creds = this.creds
    const fetchFn = this.fetch

    return {
      id: `api:${eventName}:${webhookId}`,
      externalId: webhookId,
      dispose: async () => {
        if (disposed) return
        disposed = true
        const delHeaders = buildApiHeaders(creds)
        try {
          const delRes = await fetchFn(`${creds.baseUrl.replace(/\/$/, '')}/api/webhooks/${webhookId}`, {
            method: 'DELETE',
            headers: delHeaders,
          })
          if (!delRes.ok && delRes.status !== 404) {
            // 404 means webhook was already deleted – that's fine
            const errText = await delRes.text()
            throwApiError(delRes.status, errText)
          }
        } catch (err) {
          if (err instanceof KanbanTransportError) throw err
          throw new KanbanTransportError(
            'transport.dispose_failed',
            `Failed to delete webhook ${webhookId}: ${String(err)}`,
            undefined,
            err,
          )
        }
      },
    }
  }

  /** @inheritdoc */
  async execute(
    resource: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<KanbanLiteResult<unknown>> {
    const route = resolveApiRoute(this.creds.baseUrl, resource, operation, params)

    if (!route) {
      throw new KanbanTransportError(
        'transport.unsupported_operation',
        `Operation "${resource}/${operation}" is not mapped in the API transport.`,
      )
    }

    const headers = buildApiHeaders(this.creds)
    const init: RequestInit = {
      method: route.method,
      headers,
    }

    if (route.body !== undefined && route.method !== 'GET' && route.method !== 'DELETE') {
      init.body = JSON.stringify(route.body)
    }

    const response = await this.fetch(route.url, init)
    const status = response.status

    if (!response.ok) {
      const text = await response.text()
      throwApiError(status, text)
    }

    // 204 No Content – return empty object
    let data: unknown = null
    if (status !== 204) {
      const text = await response.text()
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }
    }

    return normalizeResult(data, status)
  }
}

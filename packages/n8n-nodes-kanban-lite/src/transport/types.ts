/**
 * Shared transport contracts for Kanban Lite n8n nodes.
 *
 * Both the app node (one-shot action execution) and the trigger node
 * (event subscription lifecycle) operate through the {@link KanbanLiteTransport}
 * interface. Concrete adapters – {@link SdkTransport} and {@link ApiTransport} –
 * normalize behaviour from the local KanbanSDK and remote HTTP API so that
 * node implementations never need per-transport branching.
 *
 * @module transport/types
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Normalized error thrown by all transport operations.
 *
 * Consumers should check `code` for programmatic handling and `statusCode`
 * when the transport is HTTP-backed.
 */
export class KanbanTransportError extends Error {
  /** Machine-readable error code (e.g. `'transport.unsupported_event'`). */
  readonly code: string
  /** HTTP status code from the remote server, when applicable. */
  readonly statusCode?: number
  /** Original cause, when available. */
  readonly cause?: unknown

  constructor(code: string, message: string, statusCode?: number, cause?: unknown) {
    super(message)
    this.name = 'KanbanTransportError'
    this.code = code
    this.statusCode = statusCode
    this.cause = cause
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Normalized result returned by every transport `execute` call.
 *
 * `data` is the raw response payload from the SDK method or API endpoint.
 * `statusCode` is the HTTP status when the transport is HTTP-backed.
 */
export interface KanbanLiteResult<T = unknown> {
  readonly data: T
  readonly statusCode?: number
}

// ---------------------------------------------------------------------------
// Trigger subscription
// ---------------------------------------------------------------------------

/**
 * Options controlling how a trigger subscription is registered.
 */
export interface SubscribeOptions {
  /**
   * Publicly reachable URL to which the Kanban Lite server POSTs webhook
   * deliveries. **Required for API transport mode.** Ignored in SDK mode.
   */
  callbackUrl?: string
  /**
   * Optional shared secret used to sign HMAC-SHA256 webhook deliveries.
   * Only meaningful in API transport mode.
   */
  secret?: string
}

/**
 * Opaque handle returned by `subscribe()` for trigger lifecycle management.
 *
 * Call `dispose()` in the trigger node's `closeFunction` to clean up the
 * subscription (removes the SDK listener or DELETEs the remote webhook).
 */
export interface TriggerRegistration {
  /** Human-readable identifier for logging/diagnostics. */
  readonly id: string
  /** Transport-specific external identifier (for example the remote webhook id). */
  readonly externalId?: string
  /** Async cleanup – idempotent. */
  dispose(): Promise<void>
}

// ---------------------------------------------------------------------------
// Credentials helpers
// ---------------------------------------------------------------------------

/** Credentials for the remote API (HTTP) transport adapter. */
export interface ApiTransportCredentials {
  baseUrl: string
  authMode: 'none' | 'bearerToken' | 'apiKey'
  token?: string
  apiKeyHeader?: string
}

/** Credentials / settings for the local SDK transport adapter. */
export interface SdkTransportCredentials {
  workspaceRoot: string
  boardDir?: string
}

// ---------------------------------------------------------------------------
// Event capability catalog entry (transport-local type)
// ---------------------------------------------------------------------------

/**
 * Minimal transport-local event capability descriptor.
 *
 * Structurally compatible with `KanbanEventDescriptor` from the upstream SDK
 * integration catalog. First-party callers may pass the real catalog entries;
 * the transport layer works equally well with inline or custom entries.
 */
export interface EventCapabilityEntry {
  /** SDK event name, e.g. `'task.created'` or `'card.create'`. */
  readonly event: string
  readonly sdkBefore: boolean
  readonly sdkAfter: boolean
  readonly apiAfter: boolean
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

/** Transport mode identifier. */
export type TransportMode = 'sdk' | 'api'

/**
 * Core transport abstraction for Kanban Lite n8n nodes.
 *
 * Implementations:
 * - {@link SdkTransport} – delegates to a local `KanbanSDK` instance.
 * - {@link ApiTransport}  – delegates to the standalone HTTP API and webhook delivery.
 *
 * Both implementations resolve the same normalized result/error shapes so that
 * app nodes and trigger nodes never need per-transport branching.
 */
export interface KanbanLiteTransport {
  /** Transport mode this instance represents. */
  readonly mode: TransportMode

  /**
   * Execute a one-shot action (mutation or query) and return a normalized result.
   *
   * @param resource  - Resource group identifier (e.g. `'card'`, `'board'`).
   * @param operation - Operation identifier (e.g. `'create'`, `'list'`).
   * @param params    - Operation-specific input payload.
   * @throws {KanbanTransportError} on transport failure or unsupported operation.
   */
  execute(
    resource: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<KanbanLiteResult<unknown>>

  /**
   * Subscribe to a named event and return a lifecycle registration.
   *
   * In **SDK mode** the `handler` is called in-process whenever the event fires.
   * In **API mode** a webhook is registered at the standalone server; the `handler`
   * parameter is ignored because delivery goes through n8n's own webhook endpoint.
   * Use `options.callbackUrl` to specify the inbound delivery target.
   *
   * @param eventName - SDK event name (e.g. `'task.created'`).
   * @param handler   - Callback invoked on each in-process event delivery (SDK mode).
   * @param options   - Subscription options; `callbackUrl` is required in API mode.
   * @throws {KanbanTransportError} when the event is unsupported in this transport mode.
   */
  subscribe(
    eventName: string,
    handler: (payload: unknown) => void,
    options?: SubscribeOptions,
  ): Promise<TriggerRegistration>

  /**
   * Returns `true` when the named event is deliverable in this transport mode.
   *
   * API mode supports only after-events (`apiAfter=true`).
   * SDK mode supports both before-events (`sdkBefore=true`) and after-events
   * (`sdkAfter=true`).
   */
  canSubscribe(eventName: string): boolean
}

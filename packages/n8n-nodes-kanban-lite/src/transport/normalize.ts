/**
 * Shared normalization helpers for Kanban Lite transport adapters.
 *
 * All transport adapters must route their results and errors through these
 * helpers so that n8n nodes receive consistent shapes regardless of whether
 * they operate in SDK or API mode.
 *
 * @module transport/normalize
 */

import type { ApiTransportCredentials, EventCapabilityEntry, KanbanLiteResult } from './types'
import { KanbanTransportError } from './types'

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------

/**
 * Wrap a raw SDK or HTTP response value in the canonical result envelope.
 *
 * @param data       - Raw response value from the SDK method or API endpoint.
 * @param statusCode - HTTP status code; omit for SDK responses.
 */
export function normalizeResult<T>(data: T, statusCode?: number): KanbanLiteResult<T> {
  return statusCode !== undefined ? { data, statusCode } : { data }
}

// ---------------------------------------------------------------------------
// HTTP header building
// ---------------------------------------------------------------------------

/**
 * Build HTTP request headers from API transport credentials.
 *
 * The Authorization or API key header is added only when authMode is not
 * `'none'`. All other headers are always present.
 *
 * @param credentials - Configured API transport credentials.
 */
export function buildApiHeaders(credentials: ApiTransportCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }

  if (credentials.authMode === 'bearerToken' && credentials.token) {
    headers['Authorization'] = `Bearer ${credentials.token}`
  } else if (credentials.authMode === 'apiKey' && credentials.token) {
    const headerName = credentials.apiKeyHeader ?? 'X-Api-Key'
    headers[headerName] = credentials.token
  }

  return headers
}

// ---------------------------------------------------------------------------
// HTTP error handling
// ---------------------------------------------------------------------------

/**
 * Parse an HTTP error response and throw a normalized {@link KanbanTransportError}.
 *
 * @param status   - HTTP response status code.
 * @param bodyText - Raw response body text used for the error message.
 * @throws {KanbanTransportError} always.
 */
export function throwApiError(status: number, bodyText: string): never {
  let message = `HTTP ${status}`
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    if (typeof parsed['error'] === 'string') message = parsed['error']
    else if (typeof parsed['message'] === 'string') message = parsed['message']
  } catch {
    if (bodyText) message = `${message}: ${bodyText.slice(0, 200)}`
  }
  const code =
    status === 401 ? 'transport.unauthorized'
    : status === 403 ? 'transport.forbidden'
    : status === 404 ? 'transport.not_found'
    : status >= 500 ? 'transport.server_error'
    : 'transport.request_failed'
  throw new KanbanTransportError(code, message, status)
}

// ---------------------------------------------------------------------------
// Event routing helper used by ApiTransport URL mapper
// ---------------------------------------------------------------------------

/**
 * Build the HTTP method and URL path for a resource/operation pair.
 *
 * Returns `undefined` when the operation is not yet mapped; callers should
 * throw a `KanbanTransportError` with code `'transport.unsupported_operation'`.
 *
 * @param baseUrl   - Bare origin (no trailing slash), e.g. `http://localhost:3000`.
 * @param resource  - Resource group identifier (e.g. `'card'`, `'board'`).
 * @param operation - Operation identifier (e.g. `'create'`, `'list'`).
 * @param params    - Operation parameters (used to extract path variables like `id`).
 */
export function resolveApiRoute(
  baseUrl: string,
  resource: string,
  operation: string,
  params: Record<string, unknown>,
): { method: string; url: string; body?: unknown } | undefined {
  const base = baseUrl.replace(/\/$/, '')
  const id = typeof params['id'] === 'string' ? params['id'] : undefined
  const boardId = typeof params['boardId'] === 'string' ? params['boardId'] : undefined
  const cardId = typeof params['cardId'] === 'string' ? params['cardId'] : undefined

  const boardPath = boardId ? `?boardId=${encodeURIComponent(boardId)}` : ''

  switch (`${resource}/${operation}`) {
    // --- BOARD ---
    case 'board/list':        return { method: 'GET',    url: `${base}/api/boards` }
    case 'board/get':         return { method: 'GET',    url: `${base}/api/boards/${id ?? ''}` }
    case 'board/create':      return { method: 'POST',   url: `${base}/api/boards`, body: params }
    case 'board/update':      return { method: 'PUT',    url: `${base}/api/boards/${id ?? ''}`, body: params }
    case 'board/delete':      return { method: 'DELETE', url: `${base}/api/boards/${id ?? ''}` }
    case 'board/setDefault':  return { method: 'POST',   url: `${base}/api/boards/${id ?? ''}/default` }
    case 'board/triggerAction': return { method: 'POST', url: `${base}/api/boards/${id ?? ''}/actions/trigger`, body: params }
    // --- CARD ---
    case 'card/list':         return { method: 'GET',    url: `${base}/api/cards${boardPath}` }
    case 'card/get':          return { method: 'GET',    url: `${base}/api/cards/${id ?? ''}` }
    case 'card/create':       return { method: 'POST',   url: `${base}/api/cards`, body: params }
    case 'card/update':       return { method: 'PUT',    url: `${base}/api/cards/${id ?? ''}`, body: params }
    case 'card/move':         return { method: 'PUT',    url: `${base}/api/cards/${id ?? ''}/move`, body: params }
    case 'card/delete':       return { method: 'DELETE', url: `${base}/api/cards/${id ?? ''}` }
    case 'card/transfer':     return { method: 'POST',   url: `${base}/api/cards/${id ?? ''}/transfer`, body: params }
    case 'card/purgeDeleted': return { method: 'POST',   url: `${base}/api/cards/purge-deleted${boardPath}` }
    case 'card/triggerAction': return { method: 'POST',  url: `${base}/api/cards/${id ?? ''}/actions/trigger`, body: params }
    // --- COLUMN ---
    case 'column/list':       return { method: 'GET',    url: `${base}/api/columns${boardPath}` }
    case 'column/add':        return { method: 'POST',   url: `${base}/api/columns`, body: params }
    case 'column/update':     return { method: 'PUT',    url: `${base}/api/columns/${id ?? ''}`, body: params }
    case 'column/remove':     return { method: 'DELETE', url: `${base}/api/columns/${id ?? ''}` }
    case 'column/reorder':    return { method: 'POST',   url: `${base}/api/columns/reorder`, body: params }
    case 'column/setMinimized': return { method: 'POST', url: `${base}/api/columns/minimized`, body: params }
    case 'column/cleanup':    return { method: 'POST',   url: `${base}/api/columns/${id ?? ''}/cleanup`, body: params }
    // --- COMMENT ---
    case 'comment/list':      return { method: 'GET',    url: `${base}/api/cards/${cardId ?? id ?? ''}/comments` }
    case 'comment/add':       return { method: 'POST',   url: `${base}/api/cards/${cardId ?? id ?? ''}/comments`, body: params }
    case 'comment/update':    return { method: 'PUT',    url: `${base}/api/cards/${cardId ?? ''}/comments/${id ?? ''}`, body: params }
    case 'comment/delete':    return { method: 'DELETE', url: `${base}/api/cards/${cardId ?? ''}/comments/${id ?? ''}` }
    // --- ATTACHMENT ---
    case 'attachment/list':   return { method: 'GET',    url: `${base}/api/cards/${cardId ?? id ?? ''}/attachments` }
    case 'attachment/add':    return { method: 'POST',   url: `${base}/api/cards/${cardId ?? id ?? ''}/attachments`, body: params }
    case 'attachment/remove': return { method: 'DELETE', url: `${base}/api/cards/${cardId ?? ''}/attachments/${typeof params['attachment'] === 'string' ? params['attachment'] : ''}` }
    // --- LABEL ---
    case 'label/list':        return { method: 'GET',    url: `${base}/api/labels${boardPath}` }
    case 'label/set':         return { method: 'POST',   url: `${base}/api/labels`, body: params }
    case 'label/rename':      return { method: 'PUT',    url: `${base}/api/labels/${typeof params['name'] === 'string' ? encodeURIComponent(params['name']) : ''}`, body: params }
    case 'label/delete':      return { method: 'DELETE', url: `${base}/api/labels/${typeof params['name'] === 'string' ? encodeURIComponent(params['name']) : ''}` }
    // --- SETTINGS ---
    case 'settings/get':      return { method: 'GET',    url: `${base}/api/settings${boardPath}` }
    case 'settings/update':   return { method: 'PUT',    url: `${base}/api/settings`, body: params }
    // --- STORAGE ---
    case 'storage/getStatus':          return { method: 'GET',  url: `${base}/api/storage` }
    case 'storage/migrateToSqlite':    return { method: 'POST', url: `${base}/api/storage/migrate-to-sqlite`, body: params }
    case 'storage/migrateToMarkdown':  return { method: 'POST', url: `${base}/api/storage/migrate-to-markdown` }
    // --- FORM ---
    case 'form/submit':       return { method: 'POST',   url: `${base}/api/forms/${id ?? ''}/submit`, body: params }
    // --- WEBHOOK ---
    case 'webhook/list':      return { method: 'GET',    url: `${base}/api/webhooks` }
    case 'webhook/create':    return { method: 'POST',   url: `${base}/api/webhooks`, body: params }
    case 'webhook/update':    return { method: 'PUT',    url: `${base}/api/webhooks/${id ?? ''}`, body: params }
    case 'webhook/delete':    return { method: 'DELETE', url: `${base}/api/webhooks/${id ?? ''}` }
    // --- WORKSPACE ---
    case 'workspace/getInfo': return { method: 'GET',    url: `${base}/api/workspace` }
    // --- AUTH ---
    case 'auth/getStatus':    return { method: 'GET',    url: `${base}/api/auth/status` }
    // unmapped
    default: return undefined
  }
}

// ---------------------------------------------------------------------------
// Default event capability set (after-events deliverable via API/webhook)
// ---------------------------------------------------------------------------

/**
 * Minimal built-in event capability entries used when no external catalog is
 * provided to a transport adapter.
 *
 * Entries marked `apiAfter=true` are the committed after-events deliverable
 * through the standalone server's webhook mechanism. Entries with only
 * `sdkBefore=true` are interceptor-only events not available remotely.
 */
export const DEFAULT_EVENT_CAPABILITIES: readonly EventCapabilityEntry[] = [
  // after-events (available in both SDK and API mode)
  { event: 'task.created',       sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'task.updated',       sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'task.moved',         sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'task.deleted',       sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'comment.created',    sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'comment.updated',    sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'comment.deleted',    sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'column.created',     sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'column.updated',     sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'column.deleted',     sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'attachment.added',   sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'attachment.removed', sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'settings.updated',   sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'board.created',      sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'board.updated',      sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'board.deleted',      sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'board.action',       sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'board.log.added',    sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'board.log.cleared',  sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'log.added',          sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'log.cleared',        sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'storage.migrated',   sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'form.submitted',     sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'auth.allowed',       sdkBefore: false, sdkAfter: true, apiAfter: true },
  { event: 'auth.denied',        sdkBefore: false, sdkAfter: true, apiAfter: true },
  // before-events (SDK mode only)
  { event: 'card.create',               sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'card.update',               sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'card.move',                 sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'card.delete',               sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'card.transfer',             sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'card.action.trigger',       sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'card.purgeDeleted',         sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'comment.create',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'comment.update',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'comment.delete',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'column.create',             sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'column.update',             sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'column.delete',             sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'column.reorder',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'column.setMinimized',       sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'column.cleanup',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'attachment.add',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'attachment.remove',         sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'settings.update',           sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.create',              sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.update',              sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.delete',              sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.action.config.add',   sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.action.config.remove', sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.action.trigger',      sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.setDefault',          sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'log.add',                   sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'log.clear',                 sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.log.add',             sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'board.log.clear',           sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'storage.migrate',           sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'label.set',                 sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'label.rename',              sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'label.delete',              sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'webhook.create',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'webhook.update',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'webhook.delete',            sdkBefore: true, sdkAfter: false, apiAfter: false },
  { event: 'form.submit',               sdkBefore: true, sdkAfter: false, apiAfter: false },
]

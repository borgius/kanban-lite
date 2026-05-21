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
import { buildStandaloneApiUrl } from 'kanban-lite/sdk'
import type { StandaloneApiPath } from 'kanban-lite/sdk'

const API_PATHS = {
  boards: '/api/boards',
  board: '/api/boards/{boardId}',
  boardActionTrigger: '/api/boards/{boardId}/actions/{key}/trigger',
  boardTasks: '/api/boards/{boardId}/tasks',
  boardTask: '/api/boards/{boardId}/tasks/{id}',
  boardTaskMove: '/api/boards/{boardId}/tasks/{id}/move',
  boardTaskTransfer: '/api/boards/{boardId}/tasks/{id}/transfer',
  boardTaskAction: '/api/boards/{boardId}/tasks/{id}/actions/{action}',
  tasks: '/api/tasks',
  task: '/api/tasks/{id}',
  taskMove: '/api/tasks/{id}/move',
  taskAction: '/api/tasks/{id}/actions/{action}',
  taskComments: '/api/tasks/{id}/comments',
  taskComment: '/api/tasks/{id}/comments/{commentId}',
  taskAttachments: '/api/tasks/{id}/attachments',
  taskAttachment: '/api/tasks/{id}/attachments/{filename}',
  taskFormSubmit: '/api/tasks/{id}/forms/{formId}/submit',
  columns: '/api/columns',
  column: '/api/columns/{id}',
  columnsReorder: '/api/columns/reorder',
  columnsMinimized: '/api/columns/minimized',
  labels: '/api/labels',
  label: '/api/labels/{name}',
  settings: '/api/settings',
  storage: '/api/storage',
  storageMigrateSqlite: '/api/storage/migrate-to-sqlite',
  storageMigrateMarkdown: '/api/storage/migrate-to-markdown',
  webhooks: '/api/webhooks',
  webhook: '/api/webhooks/{id}',
  workspace: '/api/workspace',
  authStatus: '/api/auth',
} as const satisfies Record<string, StandaloneApiPath | '/api/workspace'>

function buildUrl(
  baseUrl: string,
  path: StandaloneApiPath | '/api/workspace',
  options: { path?: Record<string, unknown>; query?: Record<string, unknown> } = {},
): string {
  if (path === '/api/workspace') {
    const base = baseUrl.replace(/\/$/, '')
    const url = new URL(`${base}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  return buildStandaloneApiUrl(baseUrl, path, {
    path: options.path as never,
    query: options.query as never,
  })
}

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
  const id = typeof params['id'] === 'string' ? params['id'] : undefined
  const boardId = typeof params['boardId'] === 'string' ? params['boardId'] : undefined
  const cardId = typeof params['cardId'] === 'string' ? params['cardId'] : undefined
  const action = typeof params['action'] === 'string' ? params['action'] : undefined
  const attachment = typeof params['attachment'] === 'string' ? params['attachment'] : undefined
  const labelName = typeof params['name'] === 'string' ? params['name'] : undefined
  const formId = typeof params['formId'] === 'string' ? params['formId'] : id
  const taskId = cardId ?? id

  switch (`${resource}/${operation}`) {
    // --- BOARD ---
    case 'board/list':        return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.boards) }
    case 'board/get':         return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.board, { path: { boardId: id ?? '' } }) }
    case 'board/create':      return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.boards), body: params }
    case 'board/update':      return { method: 'PUT',    url: buildUrl(baseUrl, API_PATHS.board, { path: { boardId: id ?? '' } }), body: params }
    case 'board/delete':      return { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.board, { path: { boardId: id ?? '' } }) }
    case 'board/setDefault':  return undefined
    case 'board/triggerAction': return action
      ? { method: 'POST', url: buildUrl(baseUrl, API_PATHS.boardActionTrigger, { path: { boardId: id ?? '', key: action } }) }
      : undefined
    // --- CARD ---
    case 'card/list':         return boardId
      ? { method: 'GET', url: buildUrl(baseUrl, API_PATHS.boardTasks, { path: { boardId } }) }
      : { method: 'GET', url: buildUrl(baseUrl, API_PATHS.tasks) }
    case 'card/get':          return boardId
      ? { method: 'GET', url: buildUrl(baseUrl, API_PATHS.boardTask, { path: { boardId, id: id ?? '' } }) }
      : { method: 'GET', url: buildUrl(baseUrl, API_PATHS.task, { path: { id: id ?? '' } }) }
    case 'card/create':       return boardId
      ? { method: 'POST', url: buildUrl(baseUrl, API_PATHS.boardTasks, { path: { boardId } }), body: params }
      : { method: 'POST', url: buildUrl(baseUrl, API_PATHS.tasks), body: params }
    case 'card/update':       return boardId
      ? { method: 'PUT', url: buildUrl(baseUrl, API_PATHS.boardTask, { path: { boardId, id: id ?? '' } }), body: params }
      : { method: 'PUT', url: buildUrl(baseUrl, API_PATHS.task, { path: { id: id ?? '' } }), body: params }
    case 'card/move':         return boardId
      ? { method: 'PATCH', url: buildUrl(baseUrl, API_PATHS.boardTaskMove, { path: { boardId, id: id ?? '' } }), body: params }
      : { method: 'PATCH', url: buildUrl(baseUrl, API_PATHS.taskMove, { path: { id: id ?? '' } }), body: params }
    case 'card/delete':       return boardId
      ? { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.boardTask, { path: { boardId, id: id ?? '' } }) }
      : { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.task, { path: { id: id ?? '' } }) }
    case 'card/transfer':     return boardId
      ? { method: 'POST', url: buildUrl(baseUrl, API_PATHS.boardTaskTransfer, { path: { boardId, id: id ?? '' } }), body: params }
      : undefined
    case 'card/purgeDeleted': return undefined
    case 'card/triggerAction': return action
      ? boardId
        ? { method: 'POST', url: buildUrl(baseUrl, API_PATHS.boardTaskAction, { path: { boardId, id: id ?? '', action } }) }
        : { method: 'POST', url: buildUrl(baseUrl, API_PATHS.taskAction, { path: { id: id ?? '', action } }) }
      : undefined
    // --- COLUMN ---
    case 'column/list':       return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.columns, { query: boardId ? { boardId } : undefined }) }
    case 'column/add':        return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.columns), body: params }
    case 'column/update':     return { method: 'PUT',    url: buildUrl(baseUrl, API_PATHS.column, { path: { id: id ?? '' } }), body: params }
    case 'column/remove':     return { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.column, { path: { id: id ?? '' } }) }
    case 'column/reorder':    return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.columnsReorder), body: params }
    case 'column/setMinimized': return { method: 'PUT',  url: buildUrl(baseUrl, API_PATHS.columnsMinimized), body: params }
    case 'column/cleanup':    return { method: 'POST',   url: `${baseUrl.replace(/\/$/, '')}/api/columns/${id ?? ''}/cleanup`, body: params }
    // --- COMMENT ---
    case 'comment/list':      return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.taskComments, { path: { id: taskId ?? '' } }) }
    case 'comment/add':       return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.taskComments, { path: { id: taskId ?? '' } }), body: params }
    case 'comment/update':    return { method: 'PUT',    url: buildUrl(baseUrl, API_PATHS.taskComment, { path: { id: taskId ?? '', commentId: id ?? '' } }), body: params }
    case 'comment/delete':    return { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.taskComment, { path: { id: taskId ?? '', commentId: id ?? '' } }) }
    // --- ATTACHMENT ---
    case 'attachment/list':   return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.taskAttachments, { path: { id: taskId ?? '' } }) }
    case 'attachment/add':    return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.taskAttachments, { path: { id: taskId ?? '' } }), body: params }
    case 'attachment/remove': return { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.taskAttachment, { path: { id: taskId ?? '', filename: attachment ?? '' } }) }
    // --- LABEL ---
    case 'label/list':        return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.labels, { query: boardId ? { boardId } : undefined }) }
    case 'label/set':         return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.labels), body: params }
    case 'label/rename':      return { method: 'PUT',    url: buildUrl(baseUrl, API_PATHS.label, { path: { name: labelName ?? '' } }), body: params }
    case 'label/delete':      return { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.label, { path: { name: labelName ?? '' } }) }
    // --- SETTINGS ---
    case 'settings/get':      return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.settings, { query: boardId ? { boardId } : undefined }) }
    case 'settings/update':   return { method: 'PUT',    url: buildUrl(baseUrl, API_PATHS.settings), body: params }
    // --- STORAGE ---
    case 'storage/getStatus':          return { method: 'GET',  url: buildUrl(baseUrl, API_PATHS.storage) }
    case 'storage/migrateToSqlite':    return { method: 'POST', url: buildUrl(baseUrl, API_PATHS.storageMigrateSqlite), body: params }
    case 'storage/migrateToMarkdown':  return { method: 'POST', url: buildUrl(baseUrl, API_PATHS.storageMigrateMarkdown) }
    // --- FORM ---
    case 'form/submit':       return taskId && formId
      ? { method: 'POST', url: buildUrl(baseUrl, API_PATHS.taskFormSubmit, { path: { id: taskId, formId } }), body: params }
      : undefined
    // --- WEBHOOK ---
    case 'webhook/list':      return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.webhooks) }
    case 'webhook/create':    return { method: 'POST',   url: buildUrl(baseUrl, API_PATHS.webhooks), body: params }
    case 'webhook/update':    return { method: 'PUT',    url: buildUrl(baseUrl, API_PATHS.webhook, { path: { id: id ?? '' } }), body: params }
    case 'webhook/delete':    return { method: 'DELETE', url: buildUrl(baseUrl, API_PATHS.webhook, { path: { id: id ?? '' } }) }
    // --- WORKSPACE ---
    case 'workspace/getInfo': return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.workspace) }
    // --- AUTH ---
    case 'auth/getStatus':    return { method: 'GET',    url: buildUrl(baseUrl, API_PATHS.authStatus) }
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

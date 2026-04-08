import * as fs from 'fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type {
  AfterEventPayload,
  CallbackHandlerConfig,
  Card,
  CardStateKey,
  CloudflareWorkerProviderContext,
  ConfigStorageModuleContext,
  KanbanSDK,
} from 'kanban-lite/sdk'
import {
  PROVIDER_ID,
  DEFAULT_BOARD_ID,
  CREATE_SCHEMA_SQL,
  schemaReady,
  assertCallableCallbackModuleExport,
  buildCallbackHandlerRevisionInput,
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
  normalizeCallbackHandlers,
  readConfig,
  resolveCallbackModuleTarget,
  resolveCallbackRuntimeModule,
  type CloudflareD1Database,
  type CloudflareR2Bucket,
  type CardRow,
  type CallbackEventRecordRow,
  type CloudflareCallbackStoredHandler,
  type CloudflareCallbackEventRecord,
  type CloudflareQueueBinding,
  type CallbackHandlerExecutable,
  type CallbackHandlerExecutableInput,
  type ConfigDocument,
  type JsonRecord,
  type MaybePromise,
  sdkRuntime,
  runtimeRequire,
} from './types'

export const configDocumentCache = new Map<string, ConfigDocument>()

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeBoardId(boardId: string | undefined): string {
  return typeof boardId === 'string' && boardId.trim() ? boardId : DEFAULT_BOARD_ID
}

export function safeClone<T>(value: T): T {
  return structuredClone(value)
}

export function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === 'function'
}

export function buildRemoteCardPath(boardId: string, status: string, cardId: string): string {
  return `cloudflare://boards/${boardId}/${status}/${cardId}.json`
}

export function buildRemoteCardDir(card: Pick<Card, 'boardId' | 'id'>): string {
  return `cloudflare://attachments/cards/${card.id}`
}

export function normalizeAttachmentName(attachment: string): string | null {
  const normalized = attachment.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/') || normalized.includes('\0')) return null
  const segments = normalized.split('/')
  const base = segments[segments.length - 1]
  if (!base || base === '.' || base === '..') return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(base)) return null
  return base
}

export function getAttachmentNameFromSourcePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const candidate = normalizeAttachmentName(segments[segments.length - 1] ?? '')
  if (!candidate) {
    throw new Error(`kl-plugin-cloudflare: could not derive a safe attachment filename from source path '${sourcePath}'.`)
  }
  return candidate
}

export function buildAttachmentKey(card: Pick<Card, 'boardId' | 'id'>, attachment: string): string {
  return `cards/${card.id}/${attachment}`
}

export function getConfigDocumentCacheKey(context: ConfigStorageModuleContext): string {
  return `${context.workspaceRoot}:${context.documentId}`
}

export function getCachedConfigDocument(context: ConfigStorageModuleContext): ConfigDocument | null {
  const cached = configDocumentCache.get(getConfigDocumentCacheKey(context))
  if (cached) return safeClone(cached)
  const seeded = context.worker?.bootstrap.config
  if (seeded && isRecord(seeded)) {
    const document = safeClone(seeded as unknown as ConfigDocument)
    configDocumentCache.set(getConfigDocumentCacheKey(context), safeClone(document))
    return document
  }
  return null
}

export function cacheConfigDocument(
  context: ConfigStorageModuleContext,
  document: ConfigDocument,
): ConfigDocument {
  const cloned = safeClone(document)
  configDocumentCache.set(getConfigDocumentCacheKey(context), safeClone(cloned))
  return cloned
}

export function normalizeCard(card: Card): Card {
  const cloned = safeClone(card)
  const boardId = normalizeBoardId(cloned.boardId)
  const status = typeof cloned.status === 'string' && cloned.status.trim()
    ? cloned.status
    : 'backlog'

  return {
    ...cloned,
    boardId,
    status,
    labels: Array.isArray(cloned.labels) ? [...cloned.labels] : [],
    attachments: Array.isArray(cloned.attachments) ? [...cloned.attachments] : [],
    comments: Array.isArray(cloned.comments) ? safeClone(cloned.comments) : [],
    ...(typeof cloned.filePath === 'string' && cloned.filePath
      ? {}
      : { filePath: buildRemoteCardPath(boardId, status, cloned.id) }),
  }
}

export function parseStoredCard(row: CardRow): Card | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.card_json)
  } catch {
    return null
  }

  if (!isRecord(parsed) || typeof parsed.id !== 'string') return null

  const card = normalizeCard(parsed as unknown as Card)
  return {
    ...card,
    boardId: row.board_id,
    status: row.status,
    filePath: buildRemoteCardPath(row.board_id, row.status, row.card_id),
  }
}

export function parseConfigDocument(raw: string): ConfigDocument {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error('kl-plugin-cloudflare: D1 config storage returned a non-object document.')
  }
  return parsed
}

export function parseCardStateValue(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function getUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

export function isAfterEventPayload(value: unknown): value is AfterEventPayload<unknown> {
  return isRecord(value)
    && isNonEmptyString(value.event)
    && 'data' in value
    && isNonEmptyString(value.timestamp)
}

export function isModuleCallbackHandler(
  handler: CallbackHandlerConfig,
): handler is CallbackHandlerConfig & Required<Pick<CallbackHandlerConfig, 'module' | 'handler'>> {
  return handler.type === 'module'
    && typeof handler.module === 'string'
    && handler.module.length > 0
    && typeof handler.handler === 'string'
    && handler.handler.length > 0
}

export function logCloudflareCallbackError(message: string, error?: unknown): void {
  if (error === undefined) {
    console.error(`[kl-plugin-cloudflare] ${message}`)
    return
  }

  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[kl-plugin-cloudflare] ${message}`, detail)
}

export function getD1ChangedRowCount(result: unknown): number | null {
  if (!isRecord(result)) return null
  const meta = isRecord(result.meta) ? result.meta : null
  return typeof meta?.changes === 'number' ? meta.changes : null
}

export function requireCallbackQueue(
  worker: CloudflareWorkerProviderContext | null | undefined,
): CloudflareQueueBinding {
  return requireWorkerContext(worker, 'callback.runtime').requireQueue<CloudflareQueueBinding>('callbacks')
}

export function readCloudflareCallbackHandlers(workspaceRoot: string): CallbackHandlerConfig[] {
  const config = readConfig(workspaceRoot)
  const callbackRuntime = isRecord(config.plugins?.['callback.runtime'])
    ? config.plugins?.['callback.runtime']
    : null

  if (!callbackRuntime || callbackRuntime.provider !== PROVIDER_ID) {
    return []
  }

  const options = isRecord(callbackRuntime.options) ? callbackRuntime.options : null
  const handlers = normalizeCallbackHandlers(options?.handlers, {
    onError(message) {
      logCloudflareCallbackError(message)
    },
  })

  if (handlers.some((handler) => handler.enabled && handler.type !== 'module')) {
    throw new Error(
      'Cloudflare callback.runtime only supports enabled module handlers. Disable or migrate inline/process handlers before selecting provider "cloudflare".',
    )
  }

  return handlers.filter(isModuleCallbackHandler)
}

export function createCallbackEventSnapshot(
  event: AfterEventPayload<unknown>,
  eventId: string,
): AfterEventPayload<unknown> {
  return safeClone({
    ...event,
    meta: {
      ...(isRecord(event.meta) ? event.meta : {}),
      callback: createDurableCallbackDispatchMetadata(eventId),
    },
  })
}

export function createCallbackEventRecord(
  event: AfterEventPayload<unknown>,
  handlers: readonly (CallbackHandlerConfig & Required<Pick<CallbackHandlerConfig, 'module' | 'handler'>>)[],
): CloudflareCallbackEventRecord {
  const dispatch = getDurableCallbackDispatchMetadata(event.meta) ?? createDurableCallbackDispatchMetadata()
  const createdAt = getUpdatedAt(event.timestamp)

  return {
    version: 1,
    eventId: dispatch.eventId,
    event: createCallbackEventSnapshot(event, dispatch.eventId),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    handlers: handlers.map((handler) => ({
      id: handler.id,
      name: handler.name,
      module: resolveCallbackModuleTarget(handler.module).configuredSpecifier,
      handler: handler.handler,
      handlerRevision: createDurableCallbackHandlerRevision(buildCallbackHandlerRevisionInput(handler)),
      status: 'pending',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
      completedAt: null,
    })),
  }
}

export function parseCallbackStoredHandler(value: unknown): CloudflareCallbackStoredHandler | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.id)) return null
  if (!isNonEmptyString(value.name)) return null
  if (!isNonEmptyString(value.module)) return null
  if (!isNonEmptyString(value.handler)) return null
  if (!isNonEmptyString(value.handlerRevision)) return null
  if (value.status !== 'pending' && value.status !== 'failed' && value.status !== 'completed') return null
  if (typeof value.attempts !== 'number' || value.attempts < 0) return null

  return {
    id: value.id.trim(),
    name: value.name.trim(),
    module: value.module.trim(),
    handler: value.handler.trim(),
    handlerRevision: value.handlerRevision.trim(),
    status: value.status,
    attempts: value.attempts,
    lastError: typeof value.lastError === 'string' ? value.lastError : null,
    lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
  }
}

export function parseCallbackEventRecord(raw: string): CloudflareCallbackEventRecord {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error('kl-plugin-cloudflare: callback event record is not an object.')
  }
  if (parsed.version !== 1) {
    throw new Error('kl-plugin-cloudflare: callback event record version is unsupported.')
  }
  if (!isNonEmptyString(parsed.eventId)) {
    throw new Error('kl-plugin-cloudflare: callback event record is missing eventId.')
  }
  if (!isAfterEventPayload(parsed.event)) {
    throw new Error('kl-plugin-cloudflare: callback event record is missing a valid event snapshot.')
  }
  if (parsed.status !== 'pending' && parsed.status !== 'retrying' && parsed.status !== 'completed') {
    throw new Error('kl-plugin-cloudflare: callback event record has an invalid status.')
  }
  if (typeof parsed.attempts !== 'number' || parsed.attempts < 0) {
    throw new Error('kl-plugin-cloudflare: callback event record has an invalid attempt count.')
  }
  if (!isNonEmptyString(parsed.createdAt) || !isNonEmptyString(parsed.updatedAt)) {
    throw new Error('kl-plugin-cloudflare: callback event record is missing timestamps.')
  }
  if (!Array.isArray(parsed.handlers)) {
    throw new Error('kl-plugin-cloudflare: callback event record is missing handler state.')
  }

  const handlers = parsed.handlers
    .map((entry) => parseCallbackStoredHandler(entry))
    .filter((entry): entry is CloudflareCallbackStoredHandler => entry !== null)

  if (handlers.length !== parsed.handlers.length) {
    throw new Error('kl-plugin-cloudflare: callback event record contains an invalid handler entry.')
  }

  return {
    version: 1,
    eventId: parsed.eventId.trim(),
    event: safeClone(parsed.event),
    status: parsed.status,
    attempts: parsed.attempts,
    lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
    createdAt: parsed.createdAt.trim(),
    updatedAt: parsed.updatedAt.trim(),
    handlers,
  }
}

export async function insertCallbackEventRecord(
  database: CloudflareD1Database,
  record: CloudflareCallbackEventRecord,
): Promise<boolean> {
  const result = await database
    .prepare(`
      INSERT INTO callback_event_records (event_id, record_json)
      VALUES (?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `)
    .bind(record.eventId, JSON.stringify(record))
    .run()

  const changed = getD1ChangedRowCount(result)
  return changed === null ? true : changed > 0
}

export async function readCallbackEventRecord(
  database: CloudflareD1Database,
  eventId: string,
): Promise<CloudflareCallbackEventRecord | null> {
  const row = await database
    .prepare('SELECT record_json FROM callback_event_records WHERE event_id = ?')
    .bind(eventId)
    .first<CallbackEventRecordRow>()

  if (!row) return null
  return parseCallbackEventRecord(row.record_json)
}

export async function updateCallbackEventRecord(
  database: CloudflareD1Database,
  record: CloudflareCallbackEventRecord,
): Promise<void> {
  await database
    .prepare('UPDATE callback_event_records SET record_json = ? WHERE event_id = ?')
    .bind(JSON.stringify(record), record.eventId)
    .run()
}

export function updateCallbackEventRecordSummary(record: CloudflareCallbackEventRecord, updatedAt: string): void {
  const lastFailedHandler = [...record.handlers]
    .reverse()
    .find((handler) => handler.status === 'failed' && typeof handler.lastError === 'string' && handler.lastError.length > 0)

  record.status = record.handlers.every((handler) => handler.status === 'completed')
    ? 'completed'
    : record.handlers.some((handler) => handler.status === 'failed')
      ? 'retrying'
      : 'pending'
  record.lastError = record.status === 'retrying'
    ? lastFailedHandler?.lastError ?? null
    : null
  record.updatedAt = updatedAt
}

export async function persistCallbackEventRecordProgress(
  database: CloudflareD1Database,
  record: CloudflareCallbackEventRecord,
  updatedAt: string,
): Promise<void> {
  updateCallbackEventRecordSummary(record, updatedAt)
  await updateCallbackEventRecord(database, record)
}

export function loadCloudflareCallbackModule(
  moduleSpecifier: string,
  workspaceRoot: string,
  resolveModule?: (request: string) => unknown,
): unknown {
  const moduleTarget = resolveCallbackModuleTarget(moduleSpecifier, { workspaceRoot })
  const requests = moduleTarget.runtimeSpecifier === moduleTarget.configuredSpecifier
    ? [moduleTarget.configuredSpecifier]
    : [moduleTarget.configuredSpecifier, moduleTarget.runtimeSpecifier]

  for (const request of requests) {
    const resolved = resolveModule?.(request)
    if (resolved !== undefined) {
      return resolved
    }
  }

  let lastError: unknown = null
  for (const request of requests) {
    try {
      return resolveCallbackRuntimeModule(request)
    } catch (error) {
      lastError = error
    }
  }

  if (moduleTarget.runtimeSpecifier !== moduleTarget.configuredSpecifier && lastError instanceof Error) {
    throw new Error(
      `Configured callback.runtime module '${moduleTarget.configuredSpecifier}' could not be loaded from '${moduleTarget.runtimeSpecifier}'. ${lastError.message}`,
    )
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function executeCallbackModuleHandler(
  record: CloudflareCallbackEventRecord,
  handler: CloudflareCallbackStoredHandler,
  workspaceRoot: string,
  sdk: KanbanSDK,
  resolveModule?: (request: string) => unknown,
): Promise<void> {
  const executable = assertCallableCallbackModuleExport<CallbackHandlerExecutable>(
    loadCloudflareCallbackModule(handler.module, workspaceRoot, resolveModule),
    handler.module,
    handler.handler,
  )

  await executable({
    event: safeClone(record.event),
    sdk,
    callback: createDurableCallbackHandlerClaims(
      createDurableCallbackDispatchMetadata(record.eventId),
      handler.id,
      handler.handlerRevision,
    ),
  })
}

export function createWorkerOnlyError(capability: string): Error {
  return new Error(
    `kl-plugin-cloudflare: ${capability} requires the Cloudflare Worker provider context. `
    + 'Use the Worker factory exports (for example createCardStoragePlugin(context)) in a Worker host.',
  )
}

export function requireWorkerContext(worker: CloudflareWorkerProviderContext | null | undefined, capability: string): CloudflareWorkerProviderContext {
  if (!worker) throw createWorkerOnlyError(capability)
  return worker
}

export function getDatabase(worker: CloudflareWorkerProviderContext | null | undefined, capability: string): CloudflareD1Database {
  return requireWorkerContext(worker, capability).requireD1<CloudflareD1Database>('database')
}

export function getAttachmentsBucket(worker: CloudflareWorkerProviderContext | null | undefined, capability: string): CloudflareR2Bucket {
  return requireWorkerContext(worker, capability).requireR2<CloudflareR2Bucket>('attachments')
}

export function ensureSchema(database: CloudflareD1Database): MaybePromise<void> {
  const existing = schemaReady.get(database)
  if (existing === true) return
  if (existing) {
    return existing
  }

  const result = database.exec(CREATE_SCHEMA_SQL)
  if (isPromiseLike(result)) {
    const pending = result.then(() => {
      schemaReady.set(database, true)
    })
    schemaReady.set(database, pending)
    return pending
  }

  schemaReady.set(database, true)
}

export function toUint8Array(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }
  if (value instanceof Uint8Array) {
    return value
  }
  return new Uint8Array(value)
}

export function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left)
  combined.set(right, left.length)
  return combined
}

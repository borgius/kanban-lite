import path from 'node:path'
import { createRequire } from 'node:module'
import type {
  AttachmentStoragePlugin,
  AfterEventPayload,
  CallbackHandlerConfig,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateWriteInput,
  CardStoragePlugin,
  CloudflareWorkerProviderContext,
  ConfigStorageModuleContext,
  ConfigStorageProviderPlugin,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
  StorageEngine,
} from 'kanban-lite/sdk'

export type {
  AttachmentStoragePlugin,
  AfterEventPayload,
  CallbackHandlerConfig,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateWriteInput,
  CardStoragePlugin,
  CloudflareWorkerProviderContext,
  ConfigStorageModuleContext,
  ConfigStorageProviderPlugin,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
  StorageEngine,
} from 'kanban-lite/sdk'

type KanbanSdkRuntimeModule = typeof import('kanban-lite/sdk')
const runtimeRequire = createRequire(path.resolve(process.cwd(), 'package.json'))

function hasKanbanSdkRuntimeModule(value: unknown): value is KanbanSdkRuntimeModule {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as KanbanSdkRuntimeModule).assertCallableCallbackModuleExport === 'function'
    && typeof (value as KanbanSdkRuntimeModule).buildCallbackExecutionPlan === 'function'
    && typeof (value as KanbanSdkRuntimeModule).buildCallbackHandlerRevisionInput === 'function'
    && typeof (value as KanbanSdkRuntimeModule).createCloudflareCallbackQueueMessageEnvelope === 'function'
    && typeof (value as KanbanSdkRuntimeModule).createDurableCallbackDispatchMetadata === 'function'
    && typeof (value as KanbanSdkRuntimeModule).createDurableCallbackHandlerClaims === 'function'
    && typeof (value as KanbanSdkRuntimeModule).createDurableCallbackHandlerRevision === 'function'
    && typeof (value as KanbanSdkRuntimeModule).getDurableCallbackDispatchMetadata === 'function'
    && typeof (value as KanbanSdkRuntimeModule).normalizeCallbackHandlers === 'function'
    && typeof (value as KanbanSdkRuntimeModule).readConfig === 'function'
    && typeof (value as KanbanSdkRuntimeModule).resolveCallbackModuleTarget === 'function'
    && typeof (value as KanbanSdkRuntimeModule).resolveCallbackRuntimeModule === 'function'
}

function tryLoadKanbanSdkRuntimeModule(request: string): KanbanSdkRuntimeModule | null {
  try {
    const loaded = runtimeRequire(request) as unknown
    return hasKanbanSdkRuntimeModule(loaded) ? loaded : null
  } catch {
    return null
  }
}

const sdkRuntime = tryLoadKanbanSdkRuntimeModule('kanban-lite/sdk')
  ?? tryLoadKanbanSdkRuntimeModule(
    path.resolve(process.cwd(), 'packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs'),
  )

if (!sdkRuntime) {
  throw new Error(
    'kl-plugin-cloudflare: unable to load kanban-lite SDK runtime helpers. Install kanban-lite or build the workspace SDK before loading this provider.',
  )
}

const {
  assertCallableCallbackModuleExport,
  buildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput,
  createCloudflareCallbackQueueMessageEnvelope,
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
  normalizeCallbackHandlers,
  readConfig,
  resolveCallbackModuleTarget,
  resolveCallbackRuntimeModule,
} = sdkRuntime

const PROVIDER_ID = 'cloudflare'
const DEFAULT_BOARD_ID = 'default'

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cards (
  board_id  TEXT NOT NULL,
  card_id   TEXT NOT NULL,
  status    TEXT NOT NULL,
  card_json TEXT NOT NULL,
  PRIMARY KEY (board_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_cards_board_status ON cards (board_id, status, card_id);

CREATE TABLE IF NOT EXISTS config_documents (
  document_id   TEXT PRIMARY KEY,
  document_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_state (
  actor_id   TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  card_id    TEXT NOT NULL,
  domain     TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, board_id, card_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_card_state_lookup
  ON card_state (actor_id, board_id, card_id, domain);

CREATE TABLE IF NOT EXISTS callback_event_records (
  event_id    TEXT PRIMARY KEY,
  record_json TEXT NOT NULL
);
`

const schemaReady = new WeakMap<CloudflareD1Database, true | Promise<void>>()

interface CloudflareD1PreparedStatement {
  bind(...values: unknown[]): CloudflareD1PreparedStatement
  first<T = Record<string, unknown>>(): MaybePromise<T | null>
  all<T = Record<string, unknown>>(): MaybePromise<{ results: T[] }>
  run(): MaybePromise<unknown>
}

interface CloudflareD1Database {
  exec(query: string): MaybePromise<unknown>
  prepare(query: string): CloudflareD1PreparedStatement
}

interface CloudflareR2ObjectBody {
  httpMetadata?: { contentType?: string }
  arrayBuffer(): Promise<ArrayBuffer>
}

interface CloudflareR2Bucket {
  put(key: string, value: string | Uint8Array | ArrayBuffer): Promise<unknown>
  get(key: string): Promise<CloudflareR2ObjectBody | null>
}

interface CardRow {
  board_id: string
  card_id: string
  status: string
  card_json: string
}

interface ConfigDocumentRow {
  document_json: string
}

interface CardStateRow {
  value_json: string
  updated_at: string
}

interface CallbackEventRecordRow {
  record_json: string
}

interface CloudflareQueueBinding {
  send(message: unknown): Promise<unknown>
}

interface CloudflareCallbackRuntimeContext {
  readonly workspaceRoot: string
  readonly sdk: KanbanSDK
  readonly resolveModule?: (request: string) => unknown
}

interface CloudflareCallbackRuntimeQueueInput {
  readonly eventId: string
}

type CloudflareCallbackQueueDisposition = 'ack' | 'retry'

type CallbackHandlerExecutableInput = {
  readonly event: AfterEventPayload<unknown>
  readonly sdk: KanbanSDK
  readonly callback: ReturnType<typeof createDurableCallbackHandlerClaims>
}

type CallbackHandlerExecutable = (input: CallbackHandlerExecutableInput) => unknown

interface CloudflareCallbackStoredHandler {
  readonly id: string
  readonly name: string
  readonly module: string
  readonly handler: string
  readonly handlerRevision: string
  status: 'pending' | 'failed' | 'completed'
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
  completedAt: string | null
}

interface CloudflareCallbackEventRecord {
  readonly version: 1
  readonly eventId: string
  readonly event: AfterEventPayload<unknown>
  status: 'pending' | 'retrying' | 'completed'
  attempts: number
  lastError: string | null
  readonly createdAt: string
  updatedAt: string
  handlers: CloudflareCallbackStoredHandler[]
}

interface CloudflareCallbackQueueConsumer extends SDKEventListenerPlugin {
  attachRuntimeContext?(context: CloudflareCallbackRuntimeContext): void
  consumeQueuedCallbackEvent(input: CloudflareCallbackRuntimeQueueInput): Promise<CloudflareCallbackQueueDisposition>
}

type ConfigDocument = Record<string, unknown>
type JsonRecord = Record<string, unknown>
type MaybePromise<T> = T | Promise<T>

interface WorkerConfigRepositoryBridge {
  readConfigDocument(): Promise<ConfigDocument | null | undefined>
  writeConfigDocument(document: ConfigDocument): Promise<void>
}

const configDocumentCache = new Map<string, ConfigDocument>()

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeBoardId(boardId: string | undefined): string {
  return typeof boardId === 'string' && boardId.trim() ? boardId : DEFAULT_BOARD_ID
}

function safeClone<T>(value: T): T {
  return structuredClone(value)
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === 'function'
}

function buildRemoteCardPath(boardId: string, status: string, cardId: string): string {
  return `cloudflare://boards/${boardId}/${status}/${cardId}.json`
}

function buildRemoteCardDir(card: Pick<Card, 'boardId' | 'id'>): string {
  return `cloudflare://attachments/cards/${card.id}`
}

function normalizeAttachmentName(attachment: string): string | null {
  const normalized = attachment.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/') || normalized.includes('\0')) return null
  const segments = normalized.split('/')
  const base = segments[segments.length - 1]
  if (!base || base === '.' || base === '..') return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(base)) return null
  return base
}

function getAttachmentNameFromSourcePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const candidate = normalizeAttachmentName(segments[segments.length - 1] ?? '')
  if (!candidate) {
    throw new Error(`kl-plugin-cloudflare: could not derive a safe attachment filename from source path '${sourcePath}'.`)
  }
  return candidate
}

function buildAttachmentKey(card: Pick<Card, 'boardId' | 'id'>, attachment: string): string {
  return `cards/${card.id}/${attachment}`
}

function getConfigDocumentCacheKey(context: ConfigStorageModuleContext): string {
  return `${context.workspaceRoot}:${context.documentId}`
}

function getCachedConfigDocument(context: ConfigStorageModuleContext): ConfigDocument | null {
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

function cacheConfigDocument(
  context: ConfigStorageModuleContext,
  document: ConfigDocument,
): ConfigDocument {
  const cloned = safeClone(document)
  configDocumentCache.set(getConfigDocumentCacheKey(context), safeClone(cloned))
  return cloned
}

function normalizeCard(card: Card): Card {
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

function parseStoredCard(row: CardRow): Card | null {
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

function parseConfigDocument(raw: string): ConfigDocument {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error('kl-plugin-cloudflare: D1 config storage returned a non-object document.')
  }
  return parsed
}

function parseCardStateValue(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

function isAfterEventPayload(value: unknown): value is AfterEventPayload<unknown> {
  return isRecord(value)
    && isNonEmptyString(value.event)
    && 'data' in value
    && isNonEmptyString(value.timestamp)
}

function isModuleCallbackHandler(
  handler: CallbackHandlerConfig,
): handler is CallbackHandlerConfig & Required<Pick<CallbackHandlerConfig, 'module' | 'handler'>> {
  return handler.type === 'module'
    && typeof handler.module === 'string'
    && handler.module.length > 0
    && typeof handler.handler === 'string'
    && handler.handler.length > 0
}

function logCloudflareCallbackError(message: string, error?: unknown): void {
  if (error === undefined) {
    console.error(`[kl-plugin-cloudflare] ${message}`)
    return
  }

  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[kl-plugin-cloudflare] ${message}`, detail)
}

function getD1ChangedRowCount(result: unknown): number | null {
  if (!isRecord(result)) return null
  const meta = isRecord(result.meta) ? result.meta : null
  return typeof meta?.changes === 'number' ? meta.changes : null
}

function requireCallbackQueue(
  worker: CloudflareWorkerProviderContext | null | undefined,
): CloudflareQueueBinding {
  return requireWorkerContext(worker, 'callback.runtime').requireQueue<CloudflareQueueBinding>('callbacks')
}

function readCloudflareCallbackHandlers(workspaceRoot: string): CallbackHandlerConfig[] {
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

function createCallbackEventSnapshot(
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

function createCallbackEventRecord(
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

function parseCallbackStoredHandler(value: unknown): CloudflareCallbackStoredHandler | null {
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

function parseCallbackEventRecord(raw: string): CloudflareCallbackEventRecord {
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

async function insertCallbackEventRecord(
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

async function readCallbackEventRecord(
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

async function updateCallbackEventRecord(
  database: CloudflareD1Database,
  record: CloudflareCallbackEventRecord,
): Promise<void> {
  await database
    .prepare('UPDATE callback_event_records SET record_json = ? WHERE event_id = ?')
    .bind(JSON.stringify(record), record.eventId)
    .run()
}

function updateCallbackEventRecordSummary(record: CloudflareCallbackEventRecord, updatedAt: string): void {
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

async function persistCallbackEventRecordProgress(
  database: CloudflareD1Database,
  record: CloudflareCallbackEventRecord,
  updatedAt: string,
): Promise<void> {
  updateCallbackEventRecordSummary(record, updatedAt)
  await updateCallbackEventRecord(database, record)
}

function loadCloudflareCallbackModule(
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

async function executeCallbackModuleHandler(
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

function createWorkerOnlyError(capability: string): Error {
  return new Error(
    `kl-plugin-cloudflare: ${capability} requires the Cloudflare Worker provider context. `
    + 'Use the Worker factory exports (for example createCardStoragePlugin(context)) in a Worker host.',
  )
}

function requireWorkerContext(worker: CloudflareWorkerProviderContext | null | undefined, capability: string): CloudflareWorkerProviderContext {
  if (!worker) throw createWorkerOnlyError(capability)
  return worker
}

function getDatabase(worker: CloudflareWorkerProviderContext | null | undefined, capability: string): CloudflareD1Database {
  return requireWorkerContext(worker, capability).requireD1<CloudflareD1Database>('database')
}

function getAttachmentsBucket(worker: CloudflareWorkerProviderContext | null | undefined, capability: string): CloudflareR2Bucket {
  return requireWorkerContext(worker, capability).requireR2<CloudflareR2Bucket>('attachments')
}

function ensureSchema(database: CloudflareD1Database): MaybePromise<void> {
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

function toUint8Array(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }
  if (value instanceof Uint8Array) {
    return value
  }
  return new Uint8Array(value)
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left)
  combined.set(right, left.length)
  return combined
}

class CloudflareAttachmentStore {
  constructor(private readonly worker: CloudflareWorkerProviderContext) {}

  getCardDir(card: Card): string {
    return buildRemoteCardDir(card)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const fileName = getAttachmentNameFromSourcePath(sourcePath)
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(sourcePath)
    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    await bucket.put(buildAttachmentKey(card, fileName), bytes)
  }

  async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) return false

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    const key = buildAttachmentKey(card, fileName)
    const existing = await bucket.get(key)
    const nextChunk = toUint8Array(content)
    const existingBytes = existing ? new Uint8Array(await existing.arrayBuffer()) : new Uint8Array()
    await bucket.put(key, concatUint8Arrays(existingBytes, nextChunk))
    return true
  }

  async writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) {
      throw new Error(`kl-plugin-cloudflare: invalid attachment name '${attachment}'.`)
    }

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    await bucket.put(buildAttachmentKey(card, fileName), toUint8Array(content))
  }

  async readAttachment(
    card: Card,
    attachment: string,
  ): Promise<{ data: Uint8Array; contentType?: string } | null> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) return null

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    const stored = await bucket.get(buildAttachmentKey(card, fileName))
    if (!stored) return null

    return {
      data: new Uint8Array(await stored.arrayBuffer()),
      contentType: stored.httpMetadata?.contentType,
    }
  }

  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    const fileName = normalizeAttachmentName(attachment)
    if (!fileName) return null
    if (!Array.isArray(card.attachments) || !card.attachments.includes(fileName)) return null

    const bucket = getAttachmentsBucket(this.worker, 'attachment.storage')
    const stored = await bucket.get(buildAttachmentKey(card, fileName))
    if (!stored) return null

    try {
      const [os, pathModule, fs] = await Promise.all([
        import('node:os'),
        import('node:path'),
        import('node:fs/promises'),
      ])
      const tempDir = await fs.mkdtemp(pathModule.join(os.tmpdir(), 'kl-plugin-cloudflare-attachment-'))
      const materializedPath = pathModule.join(tempDir, fileName)
      await fs.writeFile(materializedPath, new Uint8Array(await stored.arrayBuffer()))
      return materializedPath
    } catch {
      return null
    }
  }
}

class CloudflareStorageEngine implements StorageEngine {
  readonly type = PROVIDER_ID

  constructor(
    readonly kanbanDir: string,
    private readonly worker: CloudflareWorkerProviderContext,
    private readonly attachments: CloudflareAttachmentStore,
  ) {}

  private async ensureReady(): Promise<CloudflareD1Database> {
    const database = getDatabase(this.worker, 'card.storage')
    await ensureSchema(database)
    return database
  }

  async init(): Promise<void> {
    await this.ensureReady()
  }

  close(): void {}

  async migrate(): Promise<void> {
    await this.ensureReady()
  }

  async ensureBoardDirs(): Promise<void> {}

  async deleteBoardData(_boardDir: string, boardId: string): Promise<void> {
    const database = await this.ensureReady()
    await database
      .prepare('DELETE FROM cards WHERE board_id = ?')
      .bind(boardId)
      .run()
  }

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const database = await this.ensureReady()
    const rows = await database
      .prepare('SELECT board_id, card_id, status, card_json FROM cards WHERE board_id = ? ORDER BY card_id ASC')
      .bind(boardId)
      .all<CardRow>()

    return rows.results
      .map((row) => parseStoredCard(row))
      .filter((card): card is Card => card !== null)
  }

  async writeCard(card: Card): Promise<void> {
    const normalized = normalizeCard(card)
    const database = await this.ensureReady()
    await database
      .prepare(`
        INSERT INTO cards (card_id, board_id, status, card_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(board_id, card_id)
        DO UPDATE SET
          status = excluded.status,
          card_json = excluded.card_json
      `)
      .bind(
        normalized.id,
        normalizeBoardId(normalized.boardId),
        normalized.status,
        JSON.stringify(normalized),
      )
      .run()
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    const boardId = normalizeBoardId(card.boardId)
    const database = await this.ensureReady()
    const existing = await database
      .prepare('SELECT board_id, card_id, status, card_json FROM cards WHERE board_id = ? AND card_id = ?')
      .bind(boardId, card.id)
      .first<CardRow>()

    const baseCard = existing ? parseStoredCard(existing) ?? normalizeCard(card) : normalizeCard(card)
    const movedCard = {
      ...baseCard,
      boardId,
      status: newStatus as Card['status'],
      filePath: buildRemoteCardPath(boardId, newStatus, card.id),
    }

    await database
      .prepare('UPDATE cards SET status = ?, card_json = ? WHERE board_id = ? AND card_id = ?')
      .bind(newStatus, JSON.stringify(movedCard), boardId, card.id)
      .run()

    return ''
  }

  async renameCard(): Promise<string> {
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const database = await this.ensureReady()
    await database
      .prepare('DELETE FROM cards WHERE board_id = ? AND card_id = ?')
      .bind(normalizeBoardId(card.boardId), card.id)
      .run()
  }

  getCardDir(card: Card): string {
    return this.attachments.getCardDir(card)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    await this.attachments.copyAttachment(sourcePath, card)
  }
}

function createFallbackCardStoragePlugin(): CardStoragePlugin {
  return {
    manifest: { id: PROVIDER_ID, provides: ['card.storage'] as const },
    createEngine() {
      throw createWorkerOnlyError('card.storage')
    },
    nodeCapabilities: {
      isFileBacked: false,
      getLocalCardPath() { return null },
      getWatchGlob() { return null },
    },
  }
}

function createFallbackAttachmentStoragePlugin(): AttachmentStoragePlugin {
  return {
    manifest: { id: PROVIDER_ID, provides: ['attachment.storage'] as const },
    getCardDir(): string | null {
      return null
    },
    async copyAttachment(): Promise<void> {
      throw createWorkerOnlyError('attachment.storage')
    },
    async materializeAttachment(): Promise<string | null> {
      return null
    },
  }
}

export function createCardStoragePlugin(context: CloudflareWorkerProviderContext): CardStoragePlugin {
  const attachments = new CloudflareAttachmentStore(context)
  return {
    manifest: { id: PROVIDER_ID, provides: ['card.storage'] as const },
    createEngine(kanbanDir: string): StorageEngine {
      return new CloudflareStorageEngine(kanbanDir, context, attachments)
    },
    nodeCapabilities: {
      isFileBacked: false,
      getLocalCardPath() { return null },
      getWatchGlob() { return null },
    },
  }
}

export function createAttachmentStoragePlugin(context: CloudflareWorkerProviderContext): AttachmentStoragePlugin {
  const attachments = new CloudflareAttachmentStore(context)
  return {
    manifest: { id: PROVIDER_ID, provides: ['attachment.storage'] as const },
    getCardDir(): string | null {
      return null
    },
    async copyAttachment(sourcePath: string, card: Card): Promise<void> {
      await attachments.copyAttachment(sourcePath, card)
    },
    async appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean> {
      return attachments.appendAttachment(card, attachment, content)
    },
    async writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void> {
      await attachments.writeAttachment(card, attachment, content)
    },
    async readAttachment(card: Card, attachment: string): Promise<{ data: Uint8Array; contentType?: string } | null> {
      return attachments.readAttachment(card, attachment)
    },
    async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
      return attachments.materializeAttachment(card, attachment)
    },
  }
}

export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  async function ensureReady(): Promise<CloudflareD1Database> {
    const database = getDatabase(context.worker, 'card.state')
    await ensureSchema(database)
    return database
  }

  return {
    manifest: { id: PROVIDER_ID, provides: ['card.state'] as const },
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      const database = await ensureReady()
      const row = await database
        .prepare(`
          SELECT value_json, updated_at
          FROM card_state
          WHERE actor_id = ? AND board_id = ? AND card_id = ? AND domain = ?
        `)
        .bind(input.actorId, input.boardId, input.cardId, input.domain)
        .first<CardStateRow>()

      if (!row) return null
      const value = parseCardStateValue(row.value_json)
      if (!value) return null
      return {
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: input.domain,
        value,
        updatedAt: row.updated_at,
      }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      const database = await ensureReady()
      const updatedAt = getUpdatedAt(input.updatedAt)
      await database
        .prepare(`
          INSERT INTO card_state (actor_id, board_id, card_id, domain, value_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(actor_id, board_id, card_id, domain)
          DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `)
        .bind(
          input.actorId,
          input.boardId,
          input.cardId,
          input.domain,
          JSON.stringify(input.value),
          updatedAt,
        )
        .run()

      return {
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: input.domain,
        value: safeClone(input.value),
        updatedAt,
      }
    },
    async getUnreadCursor(input) {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && isRecord(record.value) && typeof record.value.cursor === 'string'
        ? record.value as CardStateCursor
        : null
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = getUpdatedAt(input.cursor.updatedAt)
      const value: CardStateCursor = {
        cursor: input.cursor.cursor,
        updatedAt,
      }
      const record = await this.setCardState({
        actorId: input.actorId,
        boardId: input.boardId,
        cardId: input.cardId,
        domain: 'unread',
        value,
        updatedAt,
      })
      return record as CardStateRecord<CardStateCursor>
    },
  }
}

export function createWorkerConfigRepositoryBridge(context: ConfigStorageModuleContext): WorkerConfigRepositoryBridge {
  return {
    async readConfigDocument(): Promise<ConfigDocument | null> {
      const database = getDatabase(context.worker, 'config.storage')
      await ensureSchema(database)

      const row = await database
        .prepare('SELECT document_json FROM config_documents WHERE document_id = ?')
        .bind(context.documentId)
        .first<ConfigDocumentRow>()

      if (!row) {
        return getCachedConfigDocument(context)
      }

      return cacheConfigDocument(context, parseConfigDocument(row.document_json))
    },
    async writeConfigDocument(document: ConfigDocument): Promise<void> {
      const database = getDatabase(context.worker, 'config.storage')
      const nextDocument = safeClone(document)
      await ensureSchema(database)
      await database
        .prepare(`
          INSERT INTO config_documents (document_id, document_json)
          VALUES (?, ?)
          ON CONFLICT(document_id)
          DO UPDATE SET document_json = excluded.document_json
        `)
        .bind(context.documentId, JSON.stringify(nextDocument))
        .run()

      cacheConfigDocument(context, nextDocument)
    },
  }
}

export function createConfigStorageProvider(context: ConfigStorageModuleContext): ConfigStorageProviderPlugin {
  return {
    manifest: { id: PROVIDER_ID, provides: ['config.storage'] as const },
    readConfigDocument(): ConfigDocument | null {
      const database = getDatabase(context.worker, 'config.storage')
      const ready = ensureSchema(database)
      if (isPromiseLike(ready)) {
        const cached = getCachedConfigDocument(context)
        if (cached !== null) return cached
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage reads require a cached bootstrap document under the current synchronous config seam.',
        )
      }

      const row = database
        .prepare('SELECT document_json FROM config_documents WHERE document_id = ?')
        .bind(context.documentId)
        .first<ConfigDocumentRow>()

      if (isPromiseLike(row)) {
        const cached = getCachedConfigDocument(context)
        if (cached !== null) return cached
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage reads cannot synchronously await D1. Use the Worker bootstrap/runtime-host cache for runtime reads.',
        )
      }

      if (!row) return getCachedConfigDocument(context)

      return cacheConfigDocument(context, parseConfigDocument(row.document_json))
    },
    writeConfigDocument(document: ConfigDocument): void {
      const database = getDatabase(context.worker, 'config.storage')
      const ready = ensureSchema(database)
      if (isPromiseLike(ready)) {
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage writes cannot synchronously await D1 under the current Worker config seam. Use runtimeHost.writeConfig() for live Worker writes.',
        )
      }

      const nextDocument = safeClone(document)

      const result = database
        .prepare(`
          INSERT INTO config_documents (document_id, document_json)
          VALUES (?, ?)
          ON CONFLICT(document_id)
          DO UPDATE SET document_json = excluded.document_json
        `)
        .bind(context.documentId, JSON.stringify(nextDocument))
        .run()

      if (isPromiseLike(result)) {
        throw new Error(
          'kl-plugin-cloudflare: direct config.storage writes cannot synchronously await D1 under the current Worker config seam. Use runtimeHost.writeConfig() for live Worker writes.',
        )
      }

      cacheConfigDocument(context, nextDocument)
    },
  }
}

type CloudflareCallbackOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

const SDK_AFTER_EVENT_NAMES = [
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
  'form.submitted',
  'auth.allowed',
  'auth.denied',
] as const

function getAvailableCloudflareCallbackEvents(sdk?: KanbanSDK): string[] {
  const events = typeof sdk?.listAvailableEvents === 'function'
    ? sdk.listAvailableEvents({ type: 'after' })
        .filter((event) => event.phase === 'after')
        .map((event) => event.event)
    : [...SDK_AFTER_EVENT_NAMES]

  return [...new Set(events)].sort((left, right) => left.localeCompare(right))
}

function createCloudflareCallbackOptionsSchema(sdk?: KanbanSDK): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      title: 'Cloudflare callback runtime options',
      description: 'Configure ordered module handlers for durable Cloudflare Queue delivery. Cloudflare uses the shared callback.runtime handlers list but only executes Worker-safe module rows.',
      additionalProperties: false,
      properties: {
        handlers: {
          type: 'array',
          title: 'Handlers',
          description: 'Ordered module handlers evaluated for committed after-events. Cloudflare persists one durable event record plus one compact queue message per matched event.',
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'name', 'type', 'events', 'enabled', 'module', 'handler'],
            properties: {
              id: {
                type: 'string',
                title: 'ID',
                minLength: 1,
                description: 'Stable handler identifier used for durable event-plus-handler idempotency.',
              },
              name: {
                type: 'string',
                title: 'Name',
                minLength: 1,
                description: 'Short label used in logs and shared plugin settings surfaces.',
              },
              type: {
                type: 'string',
                title: 'Handler type',
                const: 'module',
                default: 'module',
                description: 'Cloudflare Workers execute module handlers only.',
              },
              events: {
                type: 'array',
                title: 'Events',
                description: 'Committed after-events that should enqueue this module handler. Wildcard masks such as task.* are supported.',
                minItems: 1,
                items: {
                  type: 'string',
                  enum: getAvailableCloudflareCallbackEvents(sdk),
                },
              },
              enabled: {
                type: 'boolean',
                title: 'Enabled',
                description: 'Disable this handler without deleting its saved configuration.',
                default: true,
              },
              module: {
                type: 'string',
                title: 'Module specifier',
                minLength: 1,
                description: 'Worker-bundled callback module specifier resolved through the shared KANBAN_MODULES registry.',
              },
              handler: {
                type: 'string',
                title: 'Named export',
                minLength: 1,
                description: 'Callable named export invoked from the configured module.',
              },
            },
          },
        },
      },
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Cloudflare callback handlers',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/handlers',
              label: 'Handlers',
              options: {
                elementLabelProp: 'name',
                showSortButtons: true,
                detail: {
                  type: 'VerticalLayout',
                  elements: [
                    {
                      type: 'Control',
                      scope: '#/properties/id',
                      label: 'ID',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/name',
                      label: 'Name',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/enabled',
                      label: 'Enabled',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/events',
                      label: 'Events',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/module',
                      label: 'Module specifier',
                      options: {
                        placeholder: './callbacks/task-created.cjs',
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/handler',
                      label: 'Named export',
                      options: {
                        placeholder: 'onTaskCreated',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    secrets: [],
  }
}

class CloudflareCallbackListenerPlugin implements CloudflareCallbackQueueConsumer {
  readonly manifest = {
    id: 'kl-plugin-cloudflare',
    provides: ['event.listener'] as const,
  }

  readonly optionsSchema = createCloudflareCallbackOptionsSchema

  private _unsubscribe: (() => void) | null = null
  private _workspaceRoot: string
  private readonly _worker: CloudflareWorkerProviderContext | null
  private _sdk: KanbanSDK | null = null
  private _resolveModule: ((request: string) => unknown) | null = null

  constructor(context: { workspaceRoot: string; worker: CloudflareWorkerProviderContext | null }) {
    this._workspaceRoot = context.workspaceRoot
    this._worker = context.worker
  }

  attachRuntimeContext(context: CloudflareCallbackRuntimeContext): void {
    this._workspaceRoot = context.workspaceRoot
    this._sdk = context.sdk
    this._resolveModule = context.resolveModule ?? null
  }

  register(bus: EventBus): void {
    if (this._unsubscribe) return
    if (!this._workspaceRoot || !this._worker) {
      return
    }

    this._unsubscribe = bus.onAny((eventName, payload) => {
      if (!isAfterEventPayload(payload.data) || payload.data.event !== eventName) return

      void this.enqueueCommittedEvent(payload.data).catch((error) => {
        logCloudflareCallbackError(
          `failed to enqueue durable callback event for "${eventName}"`,
          error,
        )
      })
    })
  }

  unregister(): void {
    if (!this._unsubscribe) return
    this._unsubscribe()
    this._unsubscribe = null
  }

  async consumeQueuedCallbackEvent(
    input: CloudflareCallbackRuntimeQueueInput,
  ): Promise<CloudflareCallbackQueueDisposition> {
    if (!this._worker) {
      throw createWorkerOnlyError('callback.runtime')
    }
    if (!this._sdk) {
      throw new Error('kl-plugin-cloudflare: callback.runtime queue consumer requires an attached SDK runtime context.')
    }

    const database = getDatabase(this._worker, 'callback.runtime')
    await ensureSchema(database)

    const record = await readCallbackEventRecord(database, input.eventId)
    if (!record) {
      throw new Error(`kl-plugin-cloudflare: durable callback event record '${input.eventId}' is missing.`)
    }

    if (record.handlers.every((handler) => handler.status === 'completed')) {
      return 'ack'
    }

    const attemptTimestamp = getUpdatedAt()
    record.attempts += 1

    let shouldRetry = false
    let lastError: string | null = null

    for (const handler of record.handlers) {
      if (handler.status === 'completed') continue

      handler.attempts += 1
      handler.lastAttemptAt = attemptTimestamp

      try {
        await executeCallbackModuleHandler(
          record,
          handler,
          this._workspaceRoot,
          this._sdk,
          this._resolveModule ?? undefined,
        )
        handler.status = 'completed'
        handler.completedAt = attemptTimestamp
        handler.lastError = null
      } catch (error) {
        shouldRetry = true
        lastError = error instanceof Error ? error.message : String(error)
        handler.status = 'failed'
        handler.lastError = lastError
      }

      await persistCallbackEventRecordProgress(database, record, attemptTimestamp)
    }

    updateCallbackEventRecordSummary(record, attemptTimestamp)

    return shouldRetry ? 'retry' : 'ack'
  }

  private async enqueueCommittedEvent(event: AfterEventPayload<unknown>): Promise<void> {
    const handlers = buildCallbackExecutionPlan(
      readCloudflareCallbackHandlers(this._workspaceRoot),
      event.event,
    ).filter(isModuleCallbackHandler)

    if (handlers.length === 0) return

    const database = getDatabase(this._worker, 'callback.runtime')
    await ensureSchema(database)

    const record = createCallbackEventRecord(event, handlers)
    const inserted = await insertCallbackEventRecord(database, record)
    if (!inserted) return

    await requireCallbackQueue(this._worker).send(
      createCloudflareCallbackQueueMessageEnvelope(record.eventId),
    )
  }
}

export function createCallbackListenerPlugin(
  context: { workspaceRoot: string; worker: CloudflareWorkerProviderContext | null },
): CloudflareCallbackQueueConsumer {
  return new CloudflareCallbackListenerPlugin(context)
}

export const callbackListenerPlugin: SDKEventListenerPlugin & {
  optionsSchema: CloudflareCallbackOptionsSchemaFactory
} = {
  manifest: {
    id: 'kl-plugin-cloudflare',
    provides: ['event.listener'],
  },
  optionsSchema: createCloudflareCallbackOptionsSchema,
  register(): void {
    // Shared discovery/schema export only. Runtime loading uses createCallbackListenerPlugin(context).
  },
  unregister(): void {
    // No-op for the discovery export.
  },
}

export const optionsSchemas: Record<string, CloudflareCallbackOptionsSchemaFactory> = {
  [PROVIDER_ID]: createCloudflareCallbackOptionsSchema,
  'kl-plugin-cloudflare': createCloudflareCallbackOptionsSchema,
}

export const cardStoragePlugin = createFallbackCardStoragePlugin()

export const attachmentStoragePlugin = createFallbackAttachmentStoragePlugin()

export const pluginManifest = {
  id: 'kl-plugin-cloudflare',
  capabilities: {
    'card.storage': [PROVIDER_ID] as const,
    'attachment.storage': [PROVIDER_ID] as const,
    'card.state': [PROVIDER_ID] as const,
    'config.storage': [PROVIDER_ID] as const,
    'callback.runtime': [PROVIDER_ID] as const,
  },
  integrations: ['event.listener'] as const,
} as const

const cloudflarePluginPackage = {
  pluginManifest,
  callbackListenerPlugin,
  optionsSchemas,
}

export default cloudflarePluginPackage

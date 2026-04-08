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



export type KanbanSdkRuntimeModule = typeof import('kanban-lite/sdk')
export const runtimeRequire = createRequire(path.resolve(process.cwd(), 'package.json'))

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

export const sdkRuntime = tryLoadKanbanSdkRuntimeModule('kanban-lite/sdk')
  ?? tryLoadKanbanSdkRuntimeModule(
    path.resolve(process.cwd(), 'packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs'),
  )

if (!sdkRuntime) {
  throw new Error(
    'kl-plugin-cloudflare: unable to load kanban-lite SDK runtime helpers. Install kanban-lite or build the workspace SDK before loading this provider.',
  )
}

export const {
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

export const PROVIDER_ID = 'cloudflare'
export const DEFAULT_BOARD_ID = 'default'

export const CREATE_SCHEMA_SQL = `
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

export const schemaReady = new WeakMap<CloudflareD1Database, true | Promise<void>>()

export interface CloudflareD1PreparedStatement {
  bind(...values: unknown[]): CloudflareD1PreparedStatement
  first<T = Record<string, unknown>>(): MaybePromise<T | null>
  all<T = Record<string, unknown>>(): MaybePromise<{ results: T[] }>
  run(): MaybePromise<unknown>
}

export interface CloudflareD1Database {
  exec(query: string): MaybePromise<unknown>
  prepare(query: string): CloudflareD1PreparedStatement
}

export interface CloudflareR2ObjectBody {
  httpMetadata?: { contentType?: string }
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface CloudflareR2Bucket {
  put(key: string, value: string | Uint8Array | ArrayBuffer): Promise<unknown>
  get(key: string): Promise<CloudflareR2ObjectBody | null>
}

export interface CardRow {
  board_id: string
  card_id: string
  status: string
  card_json: string
}

export interface ConfigDocumentRow {
  document_json: string
}

export interface CardStateRow {
  value_json: string
  updated_at: string
}

export interface CallbackEventRecordRow {
  record_json: string
}

export interface CloudflareQueueBinding {
  send(message: unknown): Promise<unknown>
}

export interface CloudflareCallbackRuntimeContext {
  readonly workspaceRoot: string
  readonly sdk: KanbanSDK
  readonly resolveModule?: (request: string) => unknown
}

export interface CloudflareCallbackRuntimeQueueInput {
  readonly eventId: string
}

export type CloudflareCallbackQueueDisposition = 'ack' | 'retry'

export type CallbackHandlerExecutableInput = {
  readonly event: AfterEventPayload<unknown>
  readonly sdk: KanbanSDK
  readonly callback: ReturnType<typeof createDurableCallbackHandlerClaims>
}

export type CallbackHandlerExecutable = (input: CallbackHandlerExecutableInput) => unknown

export interface CloudflareCallbackStoredHandler {
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

export interface CloudflareCallbackEventRecord {
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

export interface CloudflareCallbackQueueConsumer extends SDKEventListenerPlugin {
  attachRuntimeContext?(context: CloudflareCallbackRuntimeContext): void
  consumeQueuedCallbackEvent(input: CloudflareCallbackRuntimeQueueInput): Promise<CloudflareCallbackQueueDisposition>
}

export type ConfigDocument = Record<string, unknown>
export type JsonRecord = Record<string, unknown>
export type MaybePromise<T> = T | Promise<T>

export interface WorkerConfigRepositoryBridge {
  readConfigDocument(): Promise<ConfigDocument | null | undefined>
  writeConfigDocument(document: ConfigDocument): Promise<void>
}

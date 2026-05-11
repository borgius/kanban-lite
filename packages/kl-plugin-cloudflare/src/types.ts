// @ts-ignore TS7016: local runtime shim is a plain .mjs file with adjacent declaration support for editors.
import { assertCallableCallbackModuleExport as sdkAssertCallableCallbackModuleExport, buildCallbackExecutionPlan as sdkBuildCallbackExecutionPlan, buildCallbackHandlerRevisionInput as sdkBuildCallbackHandlerRevisionInput, createCloudflareCallbackQueueMessageEnvelope as sdkCreateCloudflareCallbackQueueMessageEnvelope, createDurableCallbackDispatchMetadata as sdkCreateDurableCallbackDispatchMetadata, createDurableCallbackHandlerClaims as sdkCreateDurableCallbackHandlerClaims, createDurableCallbackHandlerRevision as sdkCreateDurableCallbackHandlerRevision, getDurableCallbackDispatchMetadata as sdkGetDurableCallbackDispatchMetadata, normalizeCallbackHandlers as sdkNormalizeCallbackHandlers, readConfig as sdkReadConfig, resolveCallbackModuleTarget as sdkResolveCallbackModuleTarget, resolveCallbackRuntimeModule as sdkResolveCallbackRuntimeModule } from './sdk-runtime.mjs'
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
export const sdkRuntime: KanbanSdkRuntimeModule = {
  assertCallableCallbackModuleExport: sdkAssertCallableCallbackModuleExport,
  buildCallbackExecutionPlan: sdkBuildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput: sdkBuildCallbackHandlerRevisionInput,
  createCloudflareCallbackQueueMessageEnvelope: sdkCreateCloudflareCallbackQueueMessageEnvelope,
  createDurableCallbackDispatchMetadata: sdkCreateDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims: sdkCreateDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision: sdkCreateDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata: sdkGetDurableCallbackDispatchMetadata,
  normalizeCallbackHandlers: sdkNormalizeCallbackHandlers,
  readConfig: sdkReadConfig,
  resolveCallbackModuleTarget: sdkResolveCallbackModuleTarget,
  resolveCallbackRuntimeModule: sdkResolveCallbackRuntimeModule,
} as KanbanSdkRuntimeModule

type AssertCallableCallbackModuleExport = KanbanSdkRuntimeModule['assertCallableCallbackModuleExport']
type BuildCallbackExecutionPlan = KanbanSdkRuntimeModule['buildCallbackExecutionPlan']
type BuildCallbackHandlerRevisionInput = KanbanSdkRuntimeModule['buildCallbackHandlerRevisionInput']
type CreateCloudflareCallbackQueueMessageEnvelope = KanbanSdkRuntimeModule['createCloudflareCallbackQueueMessageEnvelope']
type CreateDurableCallbackDispatchMetadata = KanbanSdkRuntimeModule['createDurableCallbackDispatchMetadata']
type CreateDurableCallbackHandlerClaims = KanbanSdkRuntimeModule['createDurableCallbackHandlerClaims']
type CreateDurableCallbackHandlerRevision = KanbanSdkRuntimeModule['createDurableCallbackHandlerRevision']
type GetDurableCallbackDispatchMetadata = KanbanSdkRuntimeModule['getDurableCallbackDispatchMetadata']
type NormalizeCallbackHandlers = KanbanSdkRuntimeModule['normalizeCallbackHandlers']
type ReadConfig = KanbanSdkRuntimeModule['readConfig']
type ResolveCallbackModuleTarget = KanbanSdkRuntimeModule['resolveCallbackModuleTarget']
type ResolveCallbackRuntimeModule = KanbanSdkRuntimeModule['resolveCallbackRuntimeModule']

export const assertCallableCallbackModuleExport: AssertCallableCallbackModuleExport = sdkRuntime.assertCallableCallbackModuleExport

export const buildCallbackExecutionPlan: BuildCallbackExecutionPlan = sdkRuntime.buildCallbackExecutionPlan

export const buildCallbackHandlerRevisionInput: BuildCallbackHandlerRevisionInput = sdkRuntime.buildCallbackHandlerRevisionInput

export const createCloudflareCallbackQueueMessageEnvelope: CreateCloudflareCallbackQueueMessageEnvelope = sdkRuntime.createCloudflareCallbackQueueMessageEnvelope

export const createDurableCallbackDispatchMetadata: CreateDurableCallbackDispatchMetadata = sdkRuntime.createDurableCallbackDispatchMetadata

export const createDurableCallbackHandlerClaims: CreateDurableCallbackHandlerClaims = sdkRuntime.createDurableCallbackHandlerClaims

export const createDurableCallbackHandlerRevision: CreateDurableCallbackHandlerRevision = sdkRuntime.createDurableCallbackHandlerRevision

export const getDurableCallbackDispatchMetadata: GetDurableCallbackDispatchMetadata = sdkRuntime.getDurableCallbackDispatchMetadata

export const normalizeCallbackHandlers: NormalizeCallbackHandlers = sdkRuntime.normalizeCallbackHandlers

export const readConfig: ReadConfig = sdkRuntime.readConfig

export const resolveCallbackModuleTarget: ResolveCallbackModuleTarget = sdkRuntime.resolveCallbackModuleTarget

export const resolveCallbackRuntimeModule: ResolveCallbackRuntimeModule = sdkRuntime.resolveCallbackRuntimeModule

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
  delete(key: string): Promise<void>
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

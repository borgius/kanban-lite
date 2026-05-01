import type { RuntimeHost } from '../sdk'
import type { KanbanSDK } from '../sdk'
import type { RuntimeHostConfigDocument, RuntimeHostConfigRepositoryReadResult } from '../shared/env'
import type { CloudflareWorkerBootstrapConfig, CloudflareWorkerBootstrap, CloudflareWorkerProviderContext } from '../sdk/env'
import type { ConfigStorageModuleContext } from '../sdk/plugins'
import type { createStandaloneRouteDispatcher } from '../standalone/dispatch'

export type WorkerConfigInput = CloudflareWorkerBootstrapConfig
export type WorkerModuleRegistry = Record<string, unknown>

export interface WorkerConfigRepositoryBridge {
  readConfigDocument(): Promise<RuntimeHostConfigDocument | null | undefined>
  writeConfigDocument(document: RuntimeHostConfigDocument): Promise<void>
}

export interface WorkerConfigRepositoryBridgeModule {
  readonly createWorkerConfigRepositoryBridge?: ((context: ConfigStorageModuleContext) => unknown) | unknown
}

export interface WorkerConfigRepositoryOwnerState {
  readonly providerId: string
  readonly bridge: WorkerConfigRepositoryBridge | null
  readonly bridgeFailure: unknown
  committedConfig: RuntimeHostConfigDocument | undefined
  lastReadResult: Exclude<RuntimeHostConfigRepositoryReadResult, { status: 'ok' }> | null
  lastRevisionToken: string | null
  initialized: boolean
  dispatcherStale: boolean
  commitQueue: Promise<void>
}

export interface WorkerRequestConfigState {
  config: RuntimeHostConfigDocument | undefined
  pendingConfigCommits: Promise<void>[]
}

export interface WorkerRuntimeHostHandle {
  readonly runtimeHost: RuntimeHost
  refreshCommittedConfig(): Promise<void>
  runWithRequestScope<T>(fn: () => Promise<T>): Promise<T>
  needsDispatcherRefresh(): boolean
  markDispatcherReady(): void
  assertConfigReady(): void
}

export interface WorkerEntrypointState {
  dispatcher: ReturnType<typeof createStandaloneRouteDispatcher> | null
  workerRuntimeHost: WorkerRuntimeHostHandle | null
  bootstrap: CloudflareWorkerBootstrap | null
  moduleRegistry: WorkerModuleRegistry
  runtimeEnv?: CloudflareWorkerRuntimeEnv
}


export interface CloudflareWorkerRuntimeEnv {
  [bindingName: string]: unknown
  KANBAN_DIR?: string
  KANBAN_BOOTSTRAP?: string | CloudflareWorkerBootstrap
  KANBAN_CONFIG?: string | WorkerConfigInput
  KANBAN_MODULES?: WorkerModuleRegistry
  KANBAN_ACTIVE_CARD_STATE?: unknown
  ASSETS?: { fetch(request: Request): Promise<Response> }
  /** CF account ID — injected as a Worker var for runtime cron schedule sync. */
  CLOUDFLARE_ACCOUNT_ID?: string
  /** CF API token secret — set via `wrangler secret put CLOUDFLARE_API_TOKEN` for runtime cron sync. */
  CLOUDFLARE_API_TOKEN?: string
  /** Worker script name — injected as a Worker var for runtime cron schedule sync. */
  CLOUDFLARE_WORKER_NAME?: string
}

export interface CloudflareWorkerFetchHandlerOptions {
  kanbanDir?: string
  bootstrap?: string | CloudflareWorkerBootstrap
  config?: WorkerConfigInput
  moduleRegistry?: WorkerModuleRegistry
  runtimeHost?: RuntimeHost
  basePath?: string
  webviewDir?: string
}

export interface CloudflareWorkerQueueMessage<Body = unknown> {
  readonly id: string
  readonly body: Body
  readonly attempts?: number
  readonly timestamp?: Date | number
  ack?(): void
  retry?(): void
}

export interface CloudflareWorkerQueueBatch<Body = unknown> {
  readonly messages: readonly CloudflareWorkerQueueMessage<Body>[]
}

export interface CloudflareWorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException?(): void
}

export interface CloudflareWorkerScheduledEvent {
  /** The cron expression string that triggered this invocation (e.g. "*/5 * * * *"). */
  readonly cron: string
  /** Unix timestamp (ms) of the scheduled trigger time. */
  readonly scheduledTime: number
}

export type CloudflareWorkerQueueHandlerOptions = CloudflareWorkerFetchHandlerOptions

export interface CallbackRuntimeQueueConsumer {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  register(bus: unknown): void
  unregister(): void
  attachRuntimeContext?(context: {
    workspaceRoot: string
    sdk: KanbanSDK
    resolveModule?: (request: string) => unknown
  }): void
  consumeQueuedCallbackEvent?(input: { eventId: string }): Promise<'ack' | 'retry'> | 'ack' | 'retry'
}

export interface CallbackRuntimeWorkerModule {
  createCallbackListenerPlugin?: ((context: {
    workspaceRoot: string
    worker: CloudflareWorkerProviderContext | null
  }) => unknown) | unknown
}

export type NodeLikeResponse = {
  statusCode: number
  writableEnded: boolean
  writeHead: (statusCode: number, headers?: Record<string, string>) => NodeLikeResponse
  setHeader: (name: string, value: string) => NodeLikeResponse
  removeHeader: (name: string) => NodeLikeResponse
  getHeader: (name: string) => string | undefined
  getHeaders: () => Record<string, string>
  write: (chunk: string | Uint8Array) => boolean
  end: (chunk?: string | Uint8Array) => NodeLikeResponse
}


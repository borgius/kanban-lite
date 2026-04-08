import type { ConfigStorageModuleContext } from '../sdk/plugins'
import type {
  RuntimeHost,
  RuntimeHostConfigDocument,
  RuntimeHostConfigRepositoryReadResult,
  RuntimeHostConfigSelection,
} from '../shared/env'
import type {
  CloudflareWorkerBootstrap,
  CloudflareWorkerBootstrapConfig,
  CloudflareWorkerProviderContext,
} from '../sdk/env'

export const CLOUDFLARE_CALLBACK_RUNTIME_PROVIDER_ID = 'cloudflare'
export const CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND = 'durable-callback-event'
export const CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION = 1
export const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])

export type WorkerConfigInput = CloudflareWorkerBootstrapConfig
export type WorkerModuleRegistry = Record<string, unknown>

export type WorkerSdkInstance = {
  close(): void
}

export type WorkerSdkConstructor = new (kanbanDir: string) => WorkerSdkInstance

export interface WorkerSdkModule {
  readonly KanbanSDK?: WorkerSdkConstructor | unknown
  readonly installRuntimeHost?: ((runtimeHost: RuntimeHost) => void) | unknown
}

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
  workerRuntimeHost: WorkerRuntimeHostHandle | null
  bootstrap: CloudflareWorkerBootstrap | null
  moduleRegistry: WorkerModuleRegistry
}

export interface CallbackRuntimeQueueConsumer {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  register(bus: unknown): void
  unregister(): void
  attachRuntimeContext?(context: {
    workspaceRoot: string
    sdk: WorkerSdkInstance
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

export interface CloudflareCallbackModuleHandlerConfig {
  readonly module: string
  readonly handler: string
}

export interface CloudflareWorkerRuntimeEnv {
  [bindingName: string]: unknown
  KANBAN_DIR?: string
  KANBAN_BOOTSTRAP?: string | CloudflareWorkerBootstrap
  KANBAN_CONFIG?: string | WorkerConfigInput
  KANBAN_MODULES?: WorkerModuleRegistry
}

export interface CloudflareWorkerQueueHandlerOptions {
  kanbanDir?: string
  bootstrap?: string | CloudflareWorkerBootstrap
  config?: WorkerConfigInput
  moduleRegistry?: WorkerModuleRegistry
  runtimeHost?: RuntimeHost
  sdkModule?: WorkerSdkModule
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

export interface CloudflareCallbackQueueMessageEnvelope {
  readonly version: typeof CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION
  readonly kind: typeof CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND
  readonly eventId: string
}

export interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined
  run<R>(store: T, callback: () => R): R
}

export class FallbackAsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
  private currentStore: T | undefined

  getStore(): T | undefined {
    return this.currentStore
  }

  run<R>(store: T, callback: () => R): R {
    const previousStore = this.currentStore
    this.currentStore = store
    try {
      return callback()
    } finally {
      this.currentStore = previousStore
    }
  }
}

export interface NodePathModuleLike {
  resolve(...paths: string[]): string
  dirname(path: string): string
  join(...paths: string[]): string
}

export function getBuiltinNodeModule<T>(specifier: string): T | null {
  const nodeProcess = globalThis.process as { getBuiltinModule?: (request: string) => unknown } | undefined
  if (typeof nodeProcess?.getBuiltinModule !== 'function') {
    return null
  }

  try {
    return (nodeProcess.getBuiltinModule(specifier) as T | undefined) ?? null
  } catch {
    return null
  }
}

export function createAsyncLocalStorageLike<T>(): AsyncLocalStorageLike<T> {
  const asyncHooks = getBuiltinNodeModule<{
    AsyncLocalStorage?: new <V>() => AsyncLocalStorageLike<V>
  }>('node:async_hooks')

  if (typeof asyncHooks?.AsyncLocalStorage === 'function') {
    return new asyncHooks.AsyncLocalStorage<T>()
  }

  return new FallbackAsyncLocalStorage<T>()
}

export function getPathModule(): NodePathModuleLike | null {
  return getBuiltinNodeModule<NodePathModuleLike>('node:path')
}

export function resolvePath(...segments: string[]): string {
  const pathModule = getPathModule()
  if (pathModule) {
    return pathModule.resolve(...segments)
  }

  const normalized = segments.filter((segment) => segment.length > 0)
  if (normalized.length === 0) {
    return '/'
  }

  return normalized.join('/').replace(/\/+/g, '/').replace(/\/\//g, '/')
}

export function dirnamePath(inputPath: string): string {
  const pathModule = getPathModule()
  if (pathModule) {
    return pathModule.dirname(inputPath)
  }

  const normalized = inputPath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) {
    return '/'
  }
  return normalized.slice(0, lastSlash)
}

export function joinPath(...segments: string[]): string {
  const pathModule = getPathModule()
  if (pathModule) {
    return pathModule.join(...segments)
  }

  return segments
    .filter((segment) => segment.length > 0)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
}

export function cloneWorkerValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isConfigDocument(value: unknown): value is RuntimeHostConfigDocument {
  return isRecord(value)
}

export function isValidWorkerConfigRepositoryBridge(value: unknown): value is WorkerConfigRepositoryBridge {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkerConfigRepositoryBridge).readConfigDocument === 'function'
    && typeof (value as WorkerConfigRepositoryBridge).writeConfigDocument === 'function'
}

export function getCloudflareCallbackRuntimeConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const plugins = isRecord(config.plugins) ? config.plugins : null
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime']) ? plugins['callback.runtime'] : null
  if (!callbackRuntime || callbackRuntime.provider !== CLOUDFLARE_CALLBACK_RUNTIME_PROVIDER_ID) {
    return null
  }
  return callbackRuntime
}

export function getConfiguredCloudflareCallbackModuleHandlers(config: Record<string, unknown>): CloudflareCallbackModuleHandlerConfig[] {
  const callbackRuntime = getCloudflareCallbackRuntimeConfig(config)
  const options = callbackRuntime && isRecord(callbackRuntime.options) ? callbackRuntime.options : null
  const rawHandlers = Array.isArray(options?.handlers) ? options.handlers : []
  const handlers: CloudflareCallbackModuleHandlerConfig[] = []

  rawHandlers.forEach((rawHandler, index) => {
    if (!isRecord(rawHandler)) {
      return
    }

    const enabled = typeof rawHandler.enabled === 'boolean' ? rawHandler.enabled : true
    if (!enabled) {
      return
    }

    if (rawHandler.type !== 'module') {
      throw new Error(
        'Cloudflare callback.runtime only supports enabled module handlers. Disable or migrate inline/process handlers before selecting provider "cloudflare".',
      )
    }

    if (!isNonEmptyString(rawHandler.module) || !isNonEmptyString(rawHandler.handler)) {
      throw new Error(
        `Enabled Cloudflare callback.runtime module handler at index ${index} requires non-empty module and handler strings.`,
      )
    }

    handlers.push({
      module: rawHandler.module.trim(),
      handler: rawHandler.handler.trim(),
    })
  })

  return handlers.filter((entry, index, entries) => entries.findIndex(
    (candidate) => candidate.module === entry.module && candidate.handler === entry.handler,
  ) === index)
}

export function hasCloudflareCallbackModuleHandlers(config: Record<string, unknown>): boolean {
  return getConfiguredCloudflareCallbackModuleHandlers(config).length > 0
}

export function collectCloudflareCallbackModuleRegistryEntries(config: Record<string, unknown>): Array<{ module: string; handlers: string[] }> {
  const handlersByModule = new Map<string, Set<string>>()
  for (const handler of getConfiguredCloudflareCallbackModuleHandlers(config)) {
    const exports = handlersByModule.get(handler.module) ?? new Set<string>()
    exports.add(handler.handler)
    handlersByModule.set(handler.module, exports)
  }

  return [...handlersByModule.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([module, handlers]) => ({
      module,
      handlers: [...handlers].sort((left, right) => left.localeCompare(right)),
    }))
}

export function assertCallableCallbackModuleExport<TExecutable>(candidate: unknown, moduleSpecifier: string, exportName: string): TExecutable {
  const resolvedModuleSpecifier = isNonEmptyString(moduleSpecifier) ? moduleSpecifier.trim() : moduleSpecifier
  const resolvedExportName = isNonEmptyString(exportName) ? exportName.trim() : ''
  if (!resolvedExportName) {
    throw new Error('Module handlers require a non-empty named export.')
  }

  if ((typeof candidate === 'function' || isRecord(candidate))
    && Object.prototype.hasOwnProperty.call(Object(candidate), resolvedExportName)) {
    const executable = (Object(candidate) as Record<string, unknown>)[resolvedExportName]
    if (typeof executable === 'function') {
      return executable as TExecutable
    }
  }

  throw new Error(`Configured callback.runtime module '${resolvedModuleSpecifier}' does not export the callable named handler '${resolvedExportName}'.`)
}

export function assertCloudflareCallbackModuleRegistry(config: Record<string, unknown>, moduleRegistry: Record<string, unknown>): void {
  for (const entry of collectCloudflareCallbackModuleRegistryEntries(config)) {
    if (!Object.prototype.hasOwnProperty.call(moduleRegistry, entry.module)) {
      throw new Error(`Configured callback.runtime module '${entry.module}' is not available in KANBAN_MODULES.`)
    }

    const loadedModule = moduleRegistry[entry.module]
    for (const exportName of entry.handlers) {
      assertCallableCallbackModuleExport(loadedModule, entry.module, exportName)
    }
  }
}

export function assertCloudflareCallbackModuleHandlerSetMatchesBootstrap(bootstrapConfig: Record<string, unknown>, runtimeConfig: Record<string, unknown>): void {
  const bootstrapEntries = collectCloudflareCallbackModuleRegistryEntries(bootstrapConfig)
  const runtimeEntries = collectCloudflareCallbackModuleRegistryEntries(runtimeConfig)
  if (JSON.stringify(bootstrapEntries) === JSON.stringify(runtimeEntries)) {
    return
  }

  throw new Error(
    'Cloudflare Worker callback.runtime enabled module handler set changed from the bootstrap-owned deploy registry. Update the Worker bootstrap and redeploy before applying this config change.',
  )
}

export function parseCloudflareCallbackQueueMessageEnvelope(value: unknown): CloudflareCallbackQueueMessageEnvelope | null {
  if (!isRecord(value)) return null
  if (value.version !== CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION) return null
  if (value.kind !== CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND) return null
  if (!isNonEmptyString(value.eventId)) return null
  return {
    version: CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION,
    kind: CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND,
    eventId: value.eventId.trim(),
  }
}

export function getWorkerRevisionToken(workerProviderContext: CloudflareWorkerProviderContext | null | undefined): string {
  const binding = workerProviderContext?.revision.getBinding()
  if (binding === undefined) {
    return 'bootstrap'
  }
  if (typeof binding === 'string' || typeof binding === 'number' || typeof binding === 'boolean' || binding === null) {
    return String(binding)
  }
  try {
    return JSON.stringify(binding)
  } catch {
    return String(binding)
  }
}

export function areWorkerConfigsEqual(left: RuntimeHostConfigDocument | undefined, right: RuntimeHostConfigDocument | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function getConfigStorageOptions(bootstrap: CloudflareWorkerBootstrap | null): Record<string, unknown> | undefined {
  const configured = bootstrap?.config.plugins?.['config.storage']
  if (!isRecord(configured) || !isRecord(configured.options)) {
    return undefined
  }
  return structuredClone(configured.options)
}

export function createWorkerModuleRegistry(baseRegistry: WorkerModuleRegistry): WorkerModuleRegistry {
  return { ...baseRegistry }
}

export function resolveWorkerModule(requestCandidates: readonly string[], moduleRegistry: WorkerModuleRegistry, upstreamHost?: RuntimeHost): unknown {
  for (const request of requestCandidates) {
    if (Object.prototype.hasOwnProperty.call(moduleRegistry, request)) {
      return moduleRegistry[request]
    }

    const resolved = upstreamHost?.resolveExternalModule?.(request)
    if (resolved !== undefined) {
      return resolved
    }
  }

  return undefined
}


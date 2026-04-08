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
import {
  getSharedRuntimeHost,
  installSharedRuntimeHost,
} from '../shared/runtimeHostState'

const CLOUDFLARE_WORKER_BOOTSTRAP_VERSION = 1
const CONFIG_REPOSITORY_DOCUMENT_ID = 'workspace-config'
const CLOUDFLARE_CALLBACK_RUNTIME_PROVIDER_ID = 'cloudflare'
const CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND = 'durable-callback-event'
const CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION = 1
const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])

const CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET = {
  steadyStateD1ReadsPerRequest: 0,
  maxReadsPerColdStartOrRefreshBoundary: 1,
} as const

type WorkerConfigInput = CloudflareWorkerBootstrapConfig
export type WorkerModuleRegistry = Record<string, unknown>

type WorkerSdkInstance = {
  close(): void
}

export interface WorkerSdkModule {
  readonly KanbanSDK?: (new (kanbanDir: string) => WorkerSdkInstance) | unknown
  readonly installRuntimeHost?: ((runtimeHost: RuntimeHost) => void) | unknown
}

interface WorkerConfigRepositoryBridge {
  readConfigDocument(): Promise<RuntimeHostConfigDocument | null | undefined>
  writeConfigDocument(document: RuntimeHostConfigDocument): Promise<void>
}

interface WorkerConfigRepositoryBridgeModule {
  readonly createWorkerConfigRepositoryBridge?: ((context: ConfigStorageModuleContext) => unknown) | unknown
}

interface WorkerConfigRepositoryOwnerState {
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

interface WorkerRequestConfigState {
  config: RuntimeHostConfigDocument | undefined
  pendingConfigCommits: Promise<void>[]
}

interface WorkerRuntimeHostHandle {
  readonly runtimeHost: RuntimeHost
  refreshCommittedConfig(): Promise<void>
  runWithRequestScope<T>(fn: () => Promise<T>): Promise<T>
  needsDispatcherRefresh(): boolean
  markDispatcherReady(): void
  assertConfigReady(): void
}

interface WorkerEntrypointState {
  workerRuntimeHost: WorkerRuntimeHostHandle | null
  bootstrap: CloudflareWorkerBootstrap | null
  moduleRegistry: WorkerModuleRegistry
}

interface CallbackRuntimeQueueConsumer {
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

interface CallbackRuntimeWorkerModule {
  createCallbackListenerPlugin?: ((context: {
    workspaceRoot: string
    worker: CloudflareWorkerProviderContext | null
  }) => unknown) | unknown
}

interface CloudflareCallbackModuleHandlerConfig {
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

interface CloudflareCallbackQueueMessageEnvelope {
  readonly version: typeof CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION
  readonly kind: typeof CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND
  readonly eventId: string
}

interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined
  run<R>(store: T, callback: () => R): R
}

class FallbackAsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
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

interface NodePathModuleLike {
  resolve(...paths: string[]): string
  dirname(path: string): string
  join(...paths: string[]): string
}

function getBuiltinNodeModule<T>(specifier: string): T | null {
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

function createAsyncLocalStorageLike<T>(): AsyncLocalStorageLike<T> {
  const asyncHooks = getBuiltinNodeModule<{
    AsyncLocalStorage?: new <V>() => AsyncLocalStorageLike<V>
  }>('node:async_hooks')

  if (typeof asyncHooks?.AsyncLocalStorage === 'function') {
    return new asyncHooks.AsyncLocalStorage<T>()
  }

  return new FallbackAsyncLocalStorage<T>()
}

function getPathModule(): NodePathModuleLike | null {
  return getBuiltinNodeModule<NodePathModuleLike>('node:path')
}

function resolvePath(...segments: string[]): string {
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

function dirnamePath(inputPath: string): string {
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

function joinPath(...segments: string[]): string {
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

function cloneWorkerValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isConfigDocument(value: unknown): value is RuntimeHostConfigDocument {
  return isRecord(value)
}

function isValidWorkerConfigRepositoryBridge(value: unknown): value is WorkerConfigRepositoryBridge {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkerConfigRepositoryBridge).readConfigDocument === 'function'
    && typeof (value as WorkerConfigRepositoryBridge).writeConfigDocument === 'function'
}

function inferConfigStorageProvider(config: Pick<CloudflareWorkerBootstrapConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>): string {
  const plugins = isRecord(config.plugins) ? config.plugins : null
  const configStorage = plugins && isRecord(plugins['config.storage']) ? plugins['config.storage'] : null
  if (typeof configStorage?.provider === 'string' && configStorage.provider.trim()) {
    return configStorage.provider.trim()
  }

  const cardStorage = plugins && isRecord(plugins['card.storage']) ? plugins['card.storage'] : null
  if (typeof cardStorage?.provider === 'string' && cardStorage.provider.trim()) {
    return cardStorage.provider.trim()
  }

  return 'localfs'
}

function normalizeRevisionSource(source: unknown): { kind: 'bootstrap' } | { kind: 'binding'; binding: string } {
  if (!source || typeof source !== 'object') {
    return { kind: 'bootstrap' }
  }

  const candidate = source as Record<string, unknown>
  if (candidate.kind === 'bootstrap') {
    return { kind: 'bootstrap' }
  }

  if (candidate.kind === 'binding' && isNonEmptyString(candidate.binding)) {
    return { kind: 'binding', binding: candidate.binding.trim() }
  }

  throw new Error('Cloudflare Worker bootstrap revision source must be either { kind: "bootstrap" } or { kind: "binding", binding: string }.')
}

function normalizeBindingHandles(handles: unknown): Record<string, string> {
  if (!handles) return {}
  if (!isRecord(handles)) {
    throw new Error('Cloudflare Worker bootstrap binding handles must be an object keyed by logical handle name.')
  }

  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(handles)) {
    if (!isNonEmptyString(value)) {
      throw new Error(`Cloudflare Worker bootstrap binding handle '${name}' must map to a non-empty binding name.`)
    }
    normalized[name] = value.trim()
  }
  return normalized
}

function normalizeConfigDocumentId(documentId: unknown): string {
  if (documentId === undefined) {
    return CONFIG_REPOSITORY_DOCUMENT_ID
  }
  if (!isNonEmptyString(documentId)) {
    throw new Error('Cloudflare Worker bootstrap topology.configStorage.documentId must be a non-empty string when provided.')
  }
  return documentId.trim()
}

function normalizeConfigFreshnessBudget(budget: unknown): { steadyStateD1ReadsPerRequest: number; maxReadsPerColdStartOrRefreshBoundary: number } {
  if (!isRecord(budget)) {
    throw new Error('Cloudflare Worker bootstrap must include a configFreshness budget.')
  }

  const steadyStateD1ReadsPerRequest = Number(budget.steadyStateD1ReadsPerRequest)
  const maxReadsPerColdStartOrRefreshBoundary = Number(budget.maxReadsPerColdStartOrRefreshBoundary)
  if (!Number.isInteger(steadyStateD1ReadsPerRequest) || !Number.isInteger(maxReadsPerColdStartOrRefreshBoundary)) {
    throw new Error('Cloudflare Worker config-freshness budgets must be integers.')
  }
  if (steadyStateD1ReadsPerRequest !== 0) {
    throw new Error('Cloudflare Worker steady-state config-freshness budgets must keep D1 reads off the hot path (0 per request).')
  }
  if (maxReadsPerColdStartOrRefreshBoundary < 0 || maxReadsPerColdStartOrRefreshBoundary > 1) {
    throw new Error('Cloudflare Worker config-freshness budgets allow at most one D1 revision/config read on cold start or an explicit stale-refresh boundary.')
  }

  return {
    steadyStateD1ReadsPerRequest,
    maxReadsPerColdStartOrRefreshBoundary,
  }
}

function createLocalCloudflareWorkerBootstrap(config: CloudflareWorkerBootstrapConfig): CloudflareWorkerBootstrap {
  return {
    version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
    config: cloneWorkerValue(config),
    topology: {
      configStorage: {
        documentId: CONFIG_REPOSITORY_DOCUMENT_ID,
        provider: inferConfigStorageProvider(config),
        bindingHandles: {},
        revisionSource: { kind: 'bootstrap' },
      },
    },
    budgets: {
      configFreshness: { ...CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET },
    },
  }
}

function resolveLocalCloudflareWorkerBootstrap(rawBootstrap: unknown): CloudflareWorkerBootstrap {
  let parsed = rawBootstrap
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed) as unknown
  }

  if (!isRecord(parsed)) {
    throw new Error('Cloudflare Worker bootstrap must be an object.')
  }
  if (parsed.version !== CLOUDFLARE_WORKER_BOOTSTRAP_VERSION) {
    throw new Error(`Unsupported Cloudflare Worker bootstrap version: ${String(parsed.version)}`)
  }
  if (!isRecord(parsed.config)) {
    throw new Error('Cloudflare Worker bootstrap must include an embedded config object.')
  }
  if (!isRecord(parsed.topology) || !isRecord((parsed.topology as Record<string, unknown>).configStorage)) {
    throw new Error('Cloudflare Worker bootstrap must include topology.configStorage.')
  }

  const configStorage = (parsed.topology as Record<string, unknown>).configStorage as Record<string, unknown>
  const provider = isNonEmptyString(configStorage.provider) ? configStorage.provider.trim() : null
  if (!provider) {
    throw new Error('Cloudflare Worker bootstrap topology.configStorage.provider must be a non-empty string.')
  }

  const config = cloneWorkerValue(parsed.config as CloudflareWorkerBootstrapConfig)
  const inferredProvider = inferConfigStorageProvider(config)
  if (provider !== inferredProvider) {
    throw new Error(`Cloudflare Worker bootstrap config.storage provider '${provider}' does not match the embedded config topology '${inferredProvider}'.`)
  }

  const budgets = isRecord(parsed.budgets) ? parsed.budgets : null
  return {
    version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
    config,
    topology: {
      configStorage: {
        documentId: normalizeConfigDocumentId(configStorage.documentId),
        provider,
        bindingHandles: normalizeBindingHandles(configStorage.bindingHandles),
        revisionSource: normalizeRevisionSource(configStorage.revisionSource),
      },
    },
    budgets: {
      configFreshness: normalizeConfigFreshnessBudget(budgets?.configFreshness),
    },
  }
}

function requireRuntimeBinding(runtimeBindings: Record<string, unknown>, bindingName: string, errorContext: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(runtimeBindings, bindingName)) {
    throw new Error(`${errorContext} requires the runtime binding '${bindingName}', but it is not available in the current Worker env.`)
  }
  return runtimeBindings[bindingName]
}

function createLocalCloudflareWorkerProviderContext(
  bootstrap: CloudflareWorkerBootstrap,
  runtimeBindings: Record<string, unknown>,
): CloudflareWorkerProviderContext {
  const normalizedBootstrap = resolveLocalCloudflareWorkerBootstrap(bootstrap)
  const configStorage = cloneWorkerValue(normalizedBootstrap.topology.configStorage)
  const resolvedBindings: Record<string, unknown> = {}

  for (const [handleName, bindingName] of Object.entries(configStorage.bindingHandles)) {
    resolvedBindings[handleName] = requireRuntimeBinding(runtimeBindings, bindingName, `Cloudflare Worker binding handle '${handleName}'`)
  }

  const revisionBinding = configStorage.revisionSource.kind === 'binding'
    ? requireRuntimeBinding(runtimeBindings, configStorage.revisionSource.binding, 'Cloudflare Worker revision access')
    : undefined

  const frozenBindings = Object.freeze({ ...resolvedBindings })
  const getBinding = <T = unknown>(handleName: string): T | undefined => frozenBindings[handleName] as T | undefined
  const requireBinding = <T = unknown>(handleName: string): T => {
    const bindingName = configStorage.bindingHandles[handleName]
    if (!bindingName) {
      throw new Error(`Cloudflare Worker bootstrap does not declare a binding handle named '${handleName}'.`)
    }
    return requireRuntimeBinding(runtimeBindings, bindingName, `Cloudflare Worker binding handle '${handleName}'`) as T
  }

  return {
    bootstrap: normalizedBootstrap,
    config: cloneWorkerValue(normalizedBootstrap.config),
    configStorage,
    bindingHandles: cloneWorkerValue(configStorage.bindingHandles),
    bindings: frozenBindings,
    revision: {
      source: normalizeRevisionSource(configStorage.revisionSource),
      getBinding<T = unknown>() {
        return revisionBinding as T | undefined
      },
    },
    getBinding,
    requireBinding,
    requireD1<T = unknown>(handleName: string): T {
      return requireBinding<T>(handleName)
    },
    requireR2<T = unknown>(handleName: string): T {
      return requireBinding<T>(handleName)
    },
    requireQueue<T = unknown>(handleName: string): T {
      return requireBinding<T>(handleName)
    },
  }
}

function assertLocalCloudflareWorkerBootstrapConfigMutation(
  bootstrap: CloudflareWorkerBootstrap,
  nextConfig: Pick<CloudflareWorkerBootstrapConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
): void {
  const nextProvider = inferConfigStorageProvider(nextConfig)
  if (nextProvider !== bootstrap.topology.configStorage.provider) {
    throw new Error(
      `Cloudflare Worker config.storage topology changed from '${bootstrap.topology.configStorage.provider}' to '${nextProvider}'. Update the Worker bootstrap and redeploy before applying this config change.`,
    )
  }
}

function getCloudflareCallbackRuntimeConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const plugins = isRecord(config.plugins) ? config.plugins : null
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime']) ? plugins['callback.runtime'] : null
  if (!callbackRuntime || callbackRuntime.provider !== CLOUDFLARE_CALLBACK_RUNTIME_PROVIDER_ID) {
    return null
  }
  return callbackRuntime
}

function getConfiguredCloudflareCallbackModuleHandlers(config: Record<string, unknown>): CloudflareCallbackModuleHandlerConfig[] {
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

function hasCloudflareCallbackModuleHandlers(config: Record<string, unknown>): boolean {
  return getConfiguredCloudflareCallbackModuleHandlers(config).length > 0
}

function collectCloudflareCallbackModuleRegistryEntries(config: Record<string, unknown>): Array<{ module: string; handlers: string[] }> {
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

function assertCallableCallbackModuleExport<TExecutable>(candidate: unknown, moduleSpecifier: string, exportName: string): TExecutable {
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

function assertCloudflareCallbackModuleRegistry(config: Record<string, unknown>, moduleRegistry: Record<string, unknown>): void {
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

function assertCloudflareCallbackModuleHandlerSetMatchesBootstrap(bootstrapConfig: Record<string, unknown>, runtimeConfig: Record<string, unknown>): void {
  const bootstrapEntries = collectCloudflareCallbackModuleRegistryEntries(bootstrapConfig)
  const runtimeEntries = collectCloudflareCallbackModuleRegistryEntries(runtimeConfig)
  if (JSON.stringify(bootstrapEntries) === JSON.stringify(runtimeEntries)) {
    return
  }

  throw new Error(
    'Cloudflare Worker callback.runtime enabled module handler set changed from the bootstrap-owned deploy registry. Update the Worker bootstrap and redeploy before applying this config change.',
  )
}

function parseCloudflareCallbackQueueMessageEnvelope(value: unknown): CloudflareCallbackQueueMessageEnvelope | null {
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

function getWorkerRevisionToken(workerProviderContext: CloudflareWorkerProviderContext | null | undefined): string {
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

function areWorkerConfigsEqual(left: RuntimeHostConfigDocument | undefined, right: RuntimeHostConfigDocument | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function getConfigStorageOptions(bootstrap: CloudflareWorkerBootstrap | null): Record<string, unknown> | undefined {
  const configured = bootstrap?.config.plugins?.['config.storage']
  if (!isRecord(configured) || !isRecord(configured.options)) {
    return undefined
  }
  return structuredClone(configured.options)
}

function createWorkerModuleRegistry(baseRegistry: WorkerModuleRegistry): WorkerModuleRegistry {
  return { ...baseRegistry }
}

function resolveWorkerModule(requestCandidates: readonly string[], moduleRegistry: WorkerModuleRegistry, upstreamHost?: RuntimeHost): unknown {
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

function resolveWorkerConfigRepositoryOwnerState(
  bootstrap: CloudflareWorkerBootstrap | null,
  moduleRegistry: WorkerModuleRegistry,
  upstreamHost: RuntimeHost | undefined,
  workerProviderContext: CloudflareWorkerProviderContext | null | undefined,
  workspaceRoot: string,
): WorkerConfigRepositoryOwnerState | null {
  if (!bootstrap || !workerProviderContext) {
    return null
  }

  const providerId = bootstrap.topology.configStorage.provider
  if (providerId === 'localfs') {
    return null
  }

  const packageName = PROVIDER_ALIASES.get(providerId) ?? providerId
  const moduleCandidates = packageName === providerId ? [providerId] : [packageName, providerId]
  const resolvedModule = resolveWorkerModule(moduleCandidates, moduleRegistry, upstreamHost) as WorkerConfigRepositoryBridgeModule | undefined
  if (!resolvedModule) {
    return {
      providerId,
      bridge: null,
      bridgeFailure: new Error(`Configured config.storage provider '${providerId}' is not available in the Worker module registry.`),
      committedConfig: cloneWorkerValue(bootstrap.config),
      lastReadResult: null,
      lastRevisionToken: null,
      initialized: false,
      dispatcherStale: false,
      commitQueue: Promise.resolve(),
    }
  }

  if (typeof resolvedModule.createWorkerConfigRepositoryBridge !== 'function') {
    return {
      providerId,
      bridge: null,
      bridgeFailure: new Error(
        `Configured config.storage provider '${providerId}' does not export createWorkerConfigRepositoryBridge(context).`,
      ),
      committedConfig: cloneWorkerValue(bootstrap.config),
      lastReadResult: null,
      lastRevisionToken: null,
      initialized: false,
      dispatcherStale: false,
      commitQueue: Promise.resolve(),
    }
  }

  const context: ConfigStorageModuleContext = {
    workspaceRoot,
    documentId: bootstrap.topology.configStorage.documentId,
    provider: providerId,
    backend: 'external',
    worker: workerProviderContext,
  }
  const options = getConfigStorageOptions(bootstrap)
  if (options) {
    context.options = options
  }

  const created = resolvedModule.createWorkerConfigRepositoryBridge(context)
  if (!isValidWorkerConfigRepositoryBridge(created)) {
    return {
      providerId,
      bridge: null,
      bridgeFailure: new Error(
        `Configured config.storage provider '${providerId}' exported createWorkerConfigRepositoryBridge(context) but it did not return a valid bridge.`,
      ),
      committedConfig: cloneWorkerValue(bootstrap.config),
      lastReadResult: null,
      lastRevisionToken: null,
      initialized: false,
      dispatcherStale: false,
      commitQueue: Promise.resolve(),
    }
  }

  return {
    providerId,
    bridge: created,
    bridgeFailure: null,
    committedConfig: cloneWorkerValue(bootstrap.config),
    lastReadResult: null,
    lastRevisionToken: null,
    initialized: false,
    dispatcherStale: false,
    commitQueue: Promise.resolve(),
  }
}

function toRuntimeHostConfigSelection(config: RuntimeHostConfigDocument): RuntimeHostConfigSelection {
  return {
    storageEngine: config.storageEngine,
    sqlitePath: config.sqlitePath,
    plugins: config.plugins,
  }
}

function getCallbackRuntimeProviderId(config: RuntimeHostConfigDocument | undefined | null): string | null {
  const plugins = isRecord(config?.plugins) ? config.plugins : null
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime']) ? plugins['callback.runtime'] : null
  return typeof callbackRuntime?.provider === 'string' && callbackRuntime.provider.length > 0
    ? callbackRuntime.provider
    : null
}

function isCallbackRuntimeQueueConsumer(value: unknown): value is CallbackRuntimeQueueConsumer {
  return Boolean(value)
    && typeof value === 'object'
    && isRecord((value as CallbackRuntimeQueueConsumer).manifest)
    && Array.isArray((value as CallbackRuntimeQueueConsumer).manifest.provides)
    && typeof (value as CallbackRuntimeQueueConsumer).register === 'function'
    && typeof (value as CallbackRuntimeQueueConsumer).unregister === 'function'
}

function loadWorkerCallbackQueueConsumer(
  providerId: string,
  workspaceRoot: string,
  workerProviderContext: CloudflareWorkerProviderContext | null,
  moduleRegistry: WorkerModuleRegistry,
  upstreamHost?: RuntimeHost,
): CallbackRuntimeQueueConsumer {
  const packageName = PROVIDER_ALIASES.get(providerId) ?? providerId
  const moduleCandidates = packageName === providerId ? [providerId] : [packageName, providerId]
  const mod = resolveWorkerModule(moduleCandidates, moduleRegistry, upstreamHost) as CallbackRuntimeWorkerModule | undefined
  if (!mod) {
    throw new Error(`Configured callback.runtime provider '${providerId}' is not available in the Worker module registry.`)
  }

  if (typeof mod.createCallbackListenerPlugin !== 'function') {
    throw new Error(`Plugin "${packageName}" does not export createCallbackListenerPlugin(context) for Cloudflare queue delivery.`)
  }

  const created = mod.createCallbackListenerPlugin({
    workspaceRoot,
    worker: workerProviderContext,
  })

  if (!isCallbackRuntimeQueueConsumer(created) || typeof created.consumeQueuedCallbackEvent !== 'function') {
    throw new Error(`Plugin "${packageName}" createCallbackListenerPlugin(context) must return a queue-capable callback runtime listener.`)
  }

  return created
}

function resolveWorkerBootstrap(options: CloudflareWorkerQueueHandlerOptions, env?: CloudflareWorkerRuntimeEnv): CloudflareWorkerBootstrap | null {
  const rawBootstrap = options.bootstrap ?? env?.KANBAN_BOOTSTRAP
  if (rawBootstrap !== undefined) {
    return resolveLocalCloudflareWorkerBootstrap(rawBootstrap)
  }

  const rawConfig = options.config ?? env?.KANBAN_CONFIG
  return rawConfig ? createLocalCloudflareWorkerBootstrap(cloneWorkerValue(rawConfig)) : null
}

function assertWorkerCallbackModules(bootstrap: CloudflareWorkerBootstrap | null, moduleRegistry: WorkerModuleRegistry): void {
  if (!bootstrap) {
    return
  }

  assertCloudflareCallbackModuleRegistry(bootstrap.config as Record<string, unknown>, moduleRegistry)
}

function assertWorkerCallbackModuleHandlerSet(bootstrap: CloudflareWorkerBootstrap | null, config: RuntimeHostConfigDocument): void {
  if (!bootstrap) {
    return
  }

  assertCloudflareCallbackModuleHandlerSetMatchesBootstrap(
    bootstrap.config as Record<string, unknown>,
    config as Record<string, unknown>,
  )
}

function createWorkerConfigReadFailure(
  result: Exclude<RuntimeHostConfigRepositoryReadResult, { status: 'ok' }>,
  providerId: string | undefined,
): Error {
  if (result.status === 'missing') {
    return new Error(`Configured config.storage provider '${providerId ?? 'unknown'}' did not return a config document.`)
  }
  if (result.cause instanceof Error) {
    return result.cause
  }
  return new Error(String(result.cause))
}

function getWorkerPaths(options: CloudflareWorkerQueueHandlerOptions, env?: CloudflareWorkerRuntimeEnv): { kanbanDir: string; workspaceRoot: string } {
  const kanbanDir = options.kanbanDir ?? env?.KANBAN_DIR ?? '.kanban'
  const absoluteKanbanDir = resolvePath(kanbanDir)
  return {
    kanbanDir,
    workspaceRoot: dirnamePath(absoluteKanbanDir),
  }
}

function resolveWorkerSdkModule(
  options: CloudflareWorkerQueueHandlerOptions,
  moduleRegistry: WorkerModuleRegistry,
  upstreamHost?: RuntimeHost,
): Required<Pick<WorkerSdkModule, 'KanbanSDK'>> & Pick<WorkerSdkModule, 'installRuntimeHost'> {
  const candidate = options.sdkModule ?? resolveWorkerModule(['kanban-lite/sdk'], moduleRegistry, upstreamHost) as WorkerSdkModule | undefined
  if (!candidate || typeof candidate.KanbanSDK !== 'function') {
    throw new Error('Cloudflare Worker queue runtime requires an injected sdkModule with a KanbanSDK constructor.')
  }
  return candidate as Required<Pick<WorkerSdkModule, 'KanbanSDK'>> & Pick<WorkerSdkModule, 'installRuntimeHost'>
}

function resolveWorkerRuntimeHostHandle(
  options: CloudflareWorkerQueueHandlerOptions,
  env: CloudflareWorkerRuntimeEnv | undefined,
  workspaceRoot: string,
  state: WorkerEntrypointState,
): WorkerRuntimeHostHandle {
  if (state.workerRuntimeHost) {
    return state.workerRuntimeHost
  }

  const bootstrap = resolveWorkerBootstrap(options, env)
  const moduleRegistry = createWorkerModuleRegistry(options.moduleRegistry ?? env?.KANBAN_MODULES ?? {})
  const upstreamHost = options.runtimeHost ?? getSharedRuntimeHost() ?? undefined
  const workerProviderContext = bootstrap && env
    ? createLocalCloudflareWorkerProviderContext(bootstrap, env as Record<string, unknown>)
    : upstreamHost?.getCloudflareWorkerProviderContext?.() ?? null

  assertWorkerCallbackModules(bootstrap, moduleRegistry)

  const configOwner = resolveWorkerConfigRepositoryOwnerState(
    bootstrap,
    moduleRegistry,
    upstreamHost,
    workerProviderContext,
    workspaceRoot,
  )

  state.bootstrap = bootstrap
  state.moduleRegistry = moduleRegistry
  state.workerRuntimeHost = createWorkerRuntimeHost(
    bootstrap,
    moduleRegistry,
    upstreamHost,
    workerProviderContext,
    configOwner,
  )

  return state.workerRuntimeHost
}

function installWorkerRuntimeHost(runtimeHost: RuntimeHost, sdkModule: Pick<WorkerSdkModule, 'installRuntimeHost'> | null): void {
  installSharedRuntimeHost(runtimeHost)
  if (typeof sdkModule?.installRuntimeHost === 'function') {
    sdkModule.installRuntimeHost(runtimeHost)
  }
}

function createWorkerRuntimeHost(
  bootstrap: CloudflareWorkerBootstrap | null,
  moduleRegistry: WorkerModuleRegistry,
  upstreamHost?: RuntimeHost,
  workerProviderContext?: CloudflareWorkerProviderContext | null,
  configOwner?: WorkerConfigRepositoryOwnerState | null,
): WorkerRuntimeHostHandle {
  let committedConfig: RuntimeHostConfigDocument | undefined = cloneWorkerValue(bootstrap?.config)
  let hasAuthoritativeConfig = false
  let dispatcherStale = false
  const requestConfigStorage = createAsyncLocalStorageLike<WorkerRequestConfigState>()

  const assertCanWriteConfig = (workspaceRoot: string, filePath: string, nextConfig: RuntimeHostConfigDocument): void => {
    const clonedNextConfig = cloneWorkerValue(nextConfig)
    if (bootstrap) {
      assertLocalCloudflareWorkerBootstrapConfigMutation(bootstrap, toRuntimeHostConfigSelection(clonedNextConfig))
      assertWorkerCallbackModuleHandlerSet(bootstrap, clonedNextConfig)
    }
    upstreamHost?.assertCanWriteConfig?.(workspaceRoot, filePath, clonedNextConfig)
  }

  const scheduleCommittedConfigWrite = (nextConfig: RuntimeHostConfigDocument, requestState: WorkerRequestConfigState): void => {
    if (!configOwner?.bridge || configOwner.bridgeFailure) {
      return
    }

    const pendingCommit = configOwner.commitQueue
      .catch(() => undefined)
      .then(async () => {
        const clonedNextConfig = cloneWorkerValue(nextConfig)
        await configOwner.bridge?.writeConfigDocument(clonedNextConfig)
        committedConfig = cloneWorkerValue(clonedNextConfig)
        hasAuthoritativeConfig = true
        configOwner.lastReadResult = null
        dispatcherStale = true
      })

    configOwner.commitQueue = pendingCommit
    requestState.pendingConfigCommits.push(pendingCommit)
  }

  const runtimeHost: RuntimeHost = {
    readConfig(workspaceRoot, filePath) {
      const requestState = requestConfigStorage.getStore()
      if (requestState?.config !== undefined) {
        return cloneWorkerValue(requestState.config)
      }
      if (committedConfig !== undefined) return cloneWorkerValue(committedConfig)
      return cloneWorkerValue(upstreamHost?.readConfig?.(workspaceRoot, filePath))
    },
    writeConfig(workspaceRoot, filePath, nextConfig) {
      const clonedNextConfig = cloneWorkerValue(nextConfig)
      assertCanWriteConfig(workspaceRoot, filePath, clonedNextConfig)
      if (upstreamHost?.writeConfig?.(workspaceRoot, filePath, clonedNextConfig)) {
        const requestState = requestConfigStorage.getStore()
        if (requestState) {
          requestState.config = cloneWorkerValue(clonedNextConfig)
        }
        committedConfig = cloneWorkerValue(clonedNextConfig)
        dispatcherStale = true
        return true
      }
      throw new Error('Cloudflare Workers runtime does not support writing .kanban.json without a custom runtimeHost.writeConfig override.')
    },
    readConfigRepositoryDocument() {
      if (!configOwner) {
        return undefined
      }

      const requestState = requestConfigStorage.getStore()
      if (requestState?.config !== undefined) {
        return {
          status: 'ok',
          value: cloneWorkerValue(requestState.config),
          providerId: configOwner.providerId,
        }
      }

      if (configOwner.lastReadResult) {
        return configOwner.lastReadResult
      }

      if (committedConfig !== undefined) {
        return {
          status: 'ok',
          value: cloneWorkerValue(committedConfig),
          providerId: configOwner.providerId,
        }
      }

      return {
        status: 'missing',
        providerId: configOwner.providerId,
      }
    },
    writeConfigRepositoryDocument(workspaceRoot, filePath, nextConfig) {
      if (!configOwner) {
        return undefined
      }

      const clonedNextConfig = cloneWorkerValue(nextConfig)
      assertCanWriteConfig(workspaceRoot, filePath, clonedNextConfig)

      if (configOwner.bridgeFailure || !configOwner.bridge) {
        return {
          status: 'error',
          cause: configOwner.bridgeFailure ?? new Error('Worker config bridge is unavailable.'),
          providerId: configOwner.providerId,
        }
      }

      const requestState = requestConfigStorage.getStore()
      if (!requestState) {
        return {
          status: 'error',
          cause: new Error('Cloudflare Worker config writes require an active request context.'),
          providerId: configOwner.providerId,
        }
      }

      requestState.config = cloneWorkerValue(clonedNextConfig)
      scheduleCommittedConfigWrite(clonedNextConfig, requestState)
      return { status: 'ok', providerId: configOwner.providerId }
    },
    assertCanWriteConfig,
    getConfigStorageFailure(workspaceRoot, config) {
      return cloneWorkerValue(upstreamHost?.getConfigStorageFailure?.(workspaceRoot, toRuntimeHostConfigSelection(cloneWorkerValue(config))))
    },
    loadWorkspaceEnv(workspaceRoot) {
      return upstreamHost?.loadWorkspaceEnv?.(workspaceRoot) ?? true
    },
    resolveExternalModule(request) {
      if (Object.prototype.hasOwnProperty.call(moduleRegistry, request)) {
        return moduleRegistry[request]
      }
      return upstreamHost?.resolveExternalModule?.(request)
    },
    getCloudflareWorkerProviderContext() {
      return workerProviderContext ?? upstreamHost?.getCloudflareWorkerProviderContext?.() ?? null
    },
  }

  return {
    runtimeHost,
    async refreshCommittedConfig(): Promise<void> {
      if (!configOwner) {
        return
      }

      const nextRevisionToken = getWorkerRevisionToken(workerProviderContext)
      if (configOwner.initialized && configOwner.lastRevisionToken === nextRevisionToken) {
        return
      }

      configOwner.initialized = true
      configOwner.lastRevisionToken = nextRevisionToken

      if (configOwner.bridgeFailure || !configOwner.bridge) {
        if (hasAuthoritativeConfig) {
          committedConfig = undefined
        }
        configOwner.lastReadResult = {
          status: 'error',
          reason: 'read',
          cause: configOwner.bridgeFailure ?? new Error('Worker config bridge is unavailable.'),
          providerId: configOwner.providerId,
        }
        return
      }

      try {
        const nextDocument = await configOwner.bridge.readConfigDocument()
        if (nextDocument == null) {
          if (hasAuthoritativeConfig) {
            committedConfig = undefined
          }
          configOwner.lastReadResult = {
            status: 'missing',
            providerId: configOwner.providerId,
          }
          return
        }

        if (!isConfigDocument(nextDocument)) {
          if (hasAuthoritativeConfig) {
            committedConfig = undefined
          }
          configOwner.lastReadResult = {
            status: 'error',
            reason: 'parse',
            cause: new Error('Worker config bridge returned an invalid config document.'),
            providerId: configOwner.providerId,
          }
          return
        }

        const clonedNextDocument = cloneWorkerValue(nextDocument)
        assertWorkerCallbackModuleHandlerSet(bootstrap, clonedNextDocument)
        const changed = !areWorkerConfigsEqual(committedConfig, clonedNextDocument)
        committedConfig = clonedNextDocument
        hasAuthoritativeConfig = true
        configOwner.lastReadResult = null
        if (changed) {
          dispatcherStale = true
        }
      } catch (error) {
        if (hasAuthoritativeConfig) {
          committedConfig = undefined
        }
        configOwner.lastReadResult = {
          status: 'error',
          reason: 'read',
          cause: error,
          providerId: configOwner.providerId,
        }
      }
    },
    async runWithRequestScope<T>(fn: () => Promise<T>): Promise<T> {
      const requestState: WorkerRequestConfigState = {
        config: cloneWorkerValue(committedConfig),
        pendingConfigCommits: [],
      }

      return requestConfigStorage.run(requestState, async () => {
        const result = await fn()
        if (requestState.pendingConfigCommits.length > 0) {
          await Promise.all(requestState.pendingConfigCommits)
        }
        return result
      })
    },
    needsDispatcherRefresh(): boolean {
      return dispatcherStale
    },
    markDispatcherReady(): void {
      dispatcherStale = false
    },
    assertConfigReady(): void {
      if (!configOwner?.lastReadResult) {
        return
      }

      throw createWorkerConfigReadFailure(configOwner.lastReadResult, configOwner.providerId)
    },
  }
}

export function createCloudflareWorkerQueueHandler(options: CloudflareWorkerQueueHandlerOptions = {}) {
  const state: WorkerEntrypointState = {
    workerRuntimeHost: null,
    bootstrap: null,
    moduleRegistry: {},
  }

  return async (
    batch: CloudflareWorkerQueueBatch<unknown>,
    env?: CloudflareWorkerRuntimeEnv,
    _context?: CloudflareWorkerExecutionContext,
  ): Promise<void> => {
    const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
    const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)
    const sdkModule = resolveWorkerSdkModule(options, state.moduleRegistry, options.runtimeHost ?? getSharedRuntimeHost() ?? undefined)

    await workerRuntimeHost.refreshCommittedConfig()
    workerRuntimeHost.assertConfigReady()
    installWorkerRuntimeHost(workerRuntimeHost.runtimeHost, sdkModule)

    await workerRuntimeHost.runWithRequestScope(async () => {
      if (!state.bootstrap || !hasCloudflareCallbackModuleHandlers(state.bootstrap.config as Record<string, unknown>)) {
        throw new Error('Cloudflare callback queue received work, but no callback.runtime module handlers are configured.')
      }

      const runtimeConfig = workerRuntimeHost.runtimeHost.readConfig?.(workspaceRoot, joinPath(kanbanDir, '.kanban.json'))
      const callbackProviderId = getCallbackRuntimeProviderId(runtimeConfig) ?? getCallbackRuntimeProviderId(state.bootstrap.config)
      if (!callbackProviderId || callbackProviderId === 'none') {
        throw new Error('Cloudflare callback queue received work, but callback.runtime is not configured.')
      }

      const workerProviderContext = workerRuntimeHost.runtimeHost.getCloudflareWorkerProviderContext?.() ?? null
      const callbackConsumer = loadWorkerCallbackQueueConsumer(
        callbackProviderId,
        workspaceRoot,
        workerProviderContext,
        state.moduleRegistry,
        options.runtimeHost ?? getSharedRuntimeHost() ?? undefined,
      )
      const sdk = new sdkModule.KanbanSDK(resolvePath(kanbanDir))

      try {
        callbackConsumer.attachRuntimeContext?.({
          workspaceRoot,
          sdk,
          resolveModule: workerRuntimeHost.runtimeHost.resolveExternalModule?.bind(workerRuntimeHost.runtimeHost),
        })

        for (const message of batch.messages) {
          const envelope = parseCloudflareCallbackQueueMessageEnvelope(message.body)
          if (!envelope) {
            throw new Error('Cloudflare callback queue received an invalid durable callback envelope.')
          }

          const disposition = await callbackConsumer.consumeQueuedCallbackEvent?.({ eventId: envelope.eventId })
          if (disposition === 'retry') {
            message.retry?.()
            continue
          }

          message.ack?.()
        }
      } finally {
        sdk.close()
        callbackConsumer.unregister()
      }
    })
  }
}

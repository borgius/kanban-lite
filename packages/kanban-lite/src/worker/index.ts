import * as path from 'node:path'
import { Buffer } from 'node:buffer'
import { AsyncLocalStorage } from 'node:async_hooks'
import * as bundledCloudflareProviderModule from '../../../kl-plugin-cloudflare/src/index'
import * as bundledSdkRuntimeModule from '../../dist/sdk/index.cjs'
import {
  assertCloudflareCallbackModuleHandlerSetMatchesBootstrap,
  assertCloudflareCallbackModuleRegistry,
  getRuntimeHost,
  hasCloudflareCallbackModuleHandlers,
  installRuntimeHost,
  KanbanSDK,
  parseCloudflareCallbackQueueMessageEnvelope,
  resolveCallbackRuntimeModule,
} from '../sdk'
import type { RuntimeHost } from '../sdk'
import {
  PROVIDER_ALIASES,
  type ConfigStorageModuleContext,
} from '../sdk/plugins'
import type {
  RuntimeHostConfigDocument,
  RuntimeHostConfigRepositoryReadResult,
  RuntimeHostConfigSelection,
} from '../shared/env'
import {
  assertCloudflareWorkerBootstrapConfigMutation,
  createCloudflareWorkerProviderContext,
  resolveCloudflareWorkerBootstrapInput,
} from '../sdk/env'
import type {
  CloudflareWorkerBootstrap,
  CloudflareWorkerBootstrapConfig,
  CloudflareWorkerProviderContext,
} from '../sdk/env'
import { createStandaloneRouteDispatcher } from '../standalone/dispatch'
import { getIndexHtml } from '../standalone/internal/runtime'
import type { StandaloneContext } from '../standalone/context'
import type { IncomingMessageWithRawBody } from '../standalone/httpUtils'

type WorkerConfigInput = CloudflareWorkerBootstrapConfig
type WorkerModuleRegistry = Record<string, unknown>

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
  dispatcher: ReturnType<typeof createStandaloneRouteDispatcher> | null
  workerRuntimeHost: WorkerRuntimeHostHandle | null
  bootstrap: CloudflareWorkerBootstrap | null
  moduleRegistry: WorkerModuleRegistry
}

function cloneWorkerValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isConfigDocument(value: unknown): value is RuntimeHostConfigDocument {
  return isRecord(value)
}

function isValidWorkerConfigRepositoryBridge(
  value: unknown,
): value is WorkerConfigRepositoryBridge {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkerConfigRepositoryBridge).readConfigDocument === 'function'
    && typeof (value as WorkerConfigRepositoryBridge).writeConfigDocument === 'function'
}

function getWorkerRevisionToken(workerProviderContext: CloudflareWorkerProviderContext | null | undefined): string {
  const binding = workerProviderContext?.revision.getBinding()
  if (binding === undefined) {
    return 'bootstrap'
  }

  if (
    typeof binding === 'string'
    || typeof binding === 'number'
    || typeof binding === 'boolean'
    || binding === null
  ) {
    return String(binding)
  }

  try {
    return JSON.stringify(binding)
  } catch {
    return String(binding)
  }
}

function areWorkerConfigsEqual(
  left: RuntimeHostConfigDocument | undefined,
  right: RuntimeHostConfigDocument | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function getConfigStorageOptions(
  bootstrap: CloudflareWorkerBootstrap | null,
): Record<string, unknown> | undefined {
  const configured = bootstrap?.config.plugins?.['config.storage']
  if (!isRecord(configured) || !isRecord(configured.options)) {
    return undefined
  }
  return structuredClone(configured.options)
}

function createWorkerModuleRegistry(baseRegistry: WorkerModuleRegistry): WorkerModuleRegistry {
  return {
    ...baseRegistry,
    'kl-plugin-cloudflare': baseRegistry['kl-plugin-cloudflare'] ?? bundledCloudflareProviderModule,
  }
}

function resolveWorkerModule(
  requestCandidates: readonly string[],
  moduleRegistry: WorkerModuleRegistry,
  upstreamHost?: RuntimeHost,
): unknown {
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
  const moduleCandidates = packageName === providerId
    ? [providerId]
    : [packageName, providerId]

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
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime'])
    ? plugins['callback.runtime']
    : null

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
): CallbackRuntimeQueueConsumer {
  const packageName = PROVIDER_ALIASES.get(providerId) ?? providerId
  const mod = resolveCallbackRuntimeModule(packageName) as CallbackRuntimeWorkerModule

  if (typeof mod.createCallbackListenerPlugin !== 'function') {
    throw new Error(
      `Plugin "${packageName}" does not export createCallbackListenerPlugin(context) for Cloudflare queue delivery.`,
    )
  }

  const created = mod.createCallbackListenerPlugin({
    workspaceRoot,
    worker: workerProviderContext,
  })

  if (!isCallbackRuntimeQueueConsumer(created) || typeof created.consumeQueuedCallbackEvent !== 'function') {
    throw new Error(
      `Plugin "${packageName}" createCallbackListenerPlugin(context) must return a queue-capable callback runtime listener.`,
    )
  }

  return created
}

export interface CloudflareWorkerRuntimeEnv {
  [bindingName: string]: unknown
  KANBAN_DIR?: string
  KANBAN_BOOTSTRAP?: string | CloudflareWorkerBootstrap
  KANBAN_CONFIG?: string | WorkerConfigInput
  KANBAN_MODULES?: WorkerModuleRegistry
  ASSETS?: { fetch(request: Request): Promise<Response> }
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

export type CloudflareWorkerQueueHandlerOptions = CloudflareWorkerFetchHandlerOptions

interface CallbackRuntimeQueueConsumer {
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

interface CallbackRuntimeWorkerModule {
  createCallbackListenerPlugin?: ((context: {
    workspaceRoot: string
    worker: CloudflareWorkerProviderContext | null
  }) => unknown) | unknown
}

type NodeLikeResponse = {
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

function resolveWorkerBootstrap(
  options: CloudflareWorkerFetchHandlerOptions,
  env?: CloudflareWorkerRuntimeEnv,
): CloudflareWorkerBootstrap | null {
  return resolveCloudflareWorkerBootstrapInput(
    options.bootstrap ?? env?.KANBAN_BOOTSTRAP,
    options.config ?? env?.KANBAN_CONFIG,
  )
}

function assertWorkerCallbackModules(
  bootstrap: CloudflareWorkerBootstrap | null,
  moduleRegistry: WorkerModuleRegistry,
): void {
  if (!bootstrap) {
    return
  }

  assertCloudflareCallbackModuleRegistry(
    bootstrap.config as Record<string, unknown>,
    moduleRegistry,
  )
}

function assertWorkerCallbackModuleHandlerSet(
  bootstrap: CloudflareWorkerBootstrap | null,
  config: RuntimeHostConfigDocument,
): void {
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
    return new Error(
      `Configured config.storage provider '${providerId ?? 'unknown'}' did not return a config document.`,
    )
  }

  if (result.cause instanceof Error) {
    return result.cause
  }

  return new Error(String(result.cause))
}

function getWorkerPaths(
  options: CloudflareWorkerFetchHandlerOptions,
  env?: CloudflareWorkerRuntimeEnv,
): { kanbanDir: string; workspaceRoot: string } {
  const kanbanDir = options.kanbanDir ?? env?.KANBAN_DIR ?? '.kanban'
  const absoluteKanbanDir = path.resolve(kanbanDir)
  return {
    kanbanDir,
    workspaceRoot: path.dirname(absoluteKanbanDir),
  }
}

function resolveWorkerRuntimeHostHandle(
  options: CloudflareWorkerFetchHandlerOptions,
  env: CloudflareWorkerRuntimeEnv | undefined,
  workspaceRoot: string,
  state: WorkerEntrypointState,
): WorkerRuntimeHostHandle {
  if (state.workerRuntimeHost) {
    return state.workerRuntimeHost
  }

  const bootstrap = resolveWorkerBootstrap(options, env)
  const moduleRegistry = createWorkerModuleRegistry(options.moduleRegistry ?? env?.KANBAN_MODULES ?? {})
  const upstreamHost = options.runtimeHost ?? getRuntimeHost() ?? undefined
  const workerProviderContext = bootstrap && env
    ? createCloudflareWorkerProviderContext(bootstrap, env as Record<string, unknown>)
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

function installWorkerRuntimeHost(runtimeHost: RuntimeHost): void {
  installRuntimeHost(runtimeHost)
  if (typeof bundledSdkRuntimeModule.installRuntimeHost === 'function') {
    bundledSdkRuntimeModule.installRuntimeHost(runtimeHost)
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
  const requestConfigStorage = new AsyncLocalStorage<WorkerRequestConfigState>()

  const assertCanWriteConfig = (workspaceRoot: string, filePath: string, nextConfig: RuntimeHostConfigDocument): void => {
    const clonedNextConfig = cloneWorkerValue(nextConfig)
    if (bootstrap) {
      assertCloudflareWorkerBootstrapConfigMutation(bootstrap, toRuntimeHostConfigSelection(clonedNextConfig))
      assertWorkerCallbackModuleHandlerSet(bootstrap, clonedNextConfig)
    }
    upstreamHost?.assertCanWriteConfig?.(workspaceRoot, filePath, clonedNextConfig)
  }

  const scheduleCommittedConfigWrite = (
    nextConfig: RuntimeHostConfigDocument,
    requestState: WorkerRequestConfigState,
  ): void => {
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
      return cloneWorkerValue(
        upstreamHost?.getConfigStorageFailure?.(
          workspaceRoot,
          toRuntimeHostConfigSelection(cloneWorkerValue(config)),
        ),
      )
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

function createWorkerContext(kanbanDir: string): StandaloneContext {
  const absoluteKanbanDir = path.resolve(kanbanDir)
  const workspaceRoot = path.dirname(absoluteKanbanDir)
  const sdk = new KanbanSDK(absoluteKanbanDir)
    return {
      absoluteKanbanDir,
      workspaceRoot,
      sdk,
      wss: { clients: new Set() } as StandaloneContext['wss'],
    cards: [],
    migrating: false,
    suppressWatcherEventsUntil: 0,
    currentEditingCardId: null,
    clientEditingCardIds: new Map(),
    clientAuthContexts: new Map(),
    lastWrittenContent: '',
    currentBoardId: undefined,
    tempFilePath: undefined,
    tempFileCardId: undefined,
    tempFileAuthContext: undefined,
    tempFileWatcher: undefined,
    tempFileWriting: false,
  }
}

function createNodeLikeResponse(): { response: NodeLikeResponse; toResponse: () => Response } {
  const headers = new Headers()
  const chunks: Uint8Array[] = []
  const response: NodeLikeResponse = {
    statusCode: 200,
    writableEnded: false,
    writeHead(statusCode, nextHeaders) {
      response.statusCode = statusCode
      for (const [name, value] of Object.entries(nextHeaders ?? {})) {
        headers.set(name, value)
      }
      return response
    },
    setHeader(name, value) {
      headers.set(name, value)
      return response
    },
    removeHeader(name) {
      headers.delete(name)
      return response
    },
    getHeader(name) {
      return headers.get(name) ?? undefined
    },
    getHeaders() {
      return Object.fromEntries(headers.entries())
    },
    write(chunk) {
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
      chunks.push(data)
      return true
    },
    end(chunk) {
      if (chunk !== undefined) {
        response.write(chunk)
      }
      response.writableEnded = true
      return response
    },
  }
  return {
    response,
    toResponse() {
      const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
      const body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
      return new Response(body, { status: response.statusCode, headers })
    },
  }
}

async function toIncomingMessage(request: Request): Promise<IncomingMessageWithRawBody> {
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : Buffer.from(await request.arrayBuffer())
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value])),
    _rawBody: body,
  } as IncomingMessageWithRawBody
}

export function createCloudflareWorkerFetchHandler(options: CloudflareWorkerFetchHandlerOptions = {}) {
  return createCloudflareWorkerEntrypoint(options).fetch
}

export function createCloudflareWorkerQueueHandler(options: CloudflareWorkerQueueHandlerOptions = {}) {
  return createCloudflareWorkerEntrypoint(options).queue
}

function createCloudflareWorkerEntrypoint(options: CloudflareWorkerFetchHandlerOptions = {}) {
  const state: WorkerEntrypointState = {
    dispatcher: null,
    workerRuntimeHost: null,
    bootstrap: null,
    moduleRegistry: {},
  }

  const fetch = async (request: Request, env?: CloudflareWorkerRuntimeEnv): Promise<Response> => {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return new Response('WebSocket upgrades are not supported by this Cloudflare Workers entrypoint yet.', {
        status: 501,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const url = new URL(request.url)
    const basePath = options.basePath ?? ''
    const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/')
    if (!isApiRequest && /\.[^./]+$/.test(url.pathname) && env?.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request)
      if (assetResponse.status !== 404) return assetResponse
    }

    try {
      const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
      const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)

      await workerRuntimeHost.refreshCommittedConfig()
      installWorkerRuntimeHost(workerRuntimeHost.runtimeHost)

      if (!state.dispatcher || workerRuntimeHost.needsDispatcherRefresh()) {
        const ctx = createWorkerContext(kanbanDir)
        state.dispatcher = createStandaloneRouteDispatcher(ctx, options.webviewDir ?? '', getIndexHtml(basePath), basePath)
        workerRuntimeHost.markDispatcherReady()
      }

      const req = await toIncomingMessage(request)
      const { response, toResponse } = createNodeLikeResponse()

      await workerRuntimeHost.runWithRequestScope(async () => {
        await state.dispatcher?.handle(req, response as unknown as import('node:http').ServerResponse)
      })

      return toResponse()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isApiRequest) {
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(message, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
  }

  const queue = async (
    batch: CloudflareWorkerQueueBatch<unknown>,
    env?: CloudflareWorkerRuntimeEnv,
    _context?: CloudflareWorkerExecutionContext,
  ): Promise<void> => {
    const { kanbanDir, workspaceRoot } = getWorkerPaths(options, env)
    const workerRuntimeHost = resolveWorkerRuntimeHostHandle(options, env, workspaceRoot, state)

    await workerRuntimeHost.refreshCommittedConfig()
    workerRuntimeHost.assertConfigReady()
    installWorkerRuntimeHost(workerRuntimeHost.runtimeHost)

    await workerRuntimeHost.runWithRequestScope(async () => {
      if (!state.bootstrap || !hasCloudflareCallbackModuleHandlers(state.bootstrap.config as Record<string, unknown>)) {
        throw new Error('Cloudflare callback queue received work, but no callback.runtime module handlers are configured.')
      }

      const runtimeConfig = workerRuntimeHost.runtimeHost.readConfig(
        workspaceRoot,
        path.join(kanbanDir, '.kanban.json'),
      )
      const callbackProviderId = getCallbackRuntimeProviderId(runtimeConfig) ?? getCallbackRuntimeProviderId(state.bootstrap.config)
      if (!callbackProviderId || callbackProviderId === 'none') {
        throw new Error('Cloudflare callback queue received work, but callback.runtime is not configured.')
      }

      const workerProviderContext = workerRuntimeHost.runtimeHost.getCloudflareWorkerProviderContext?.() ?? null
      const callbackConsumer = loadWorkerCallbackQueueConsumer(
        callbackProviderId,
        workspaceRoot,
        workerProviderContext,
      )
      const sdk = new KanbanSDK(path.resolve(kanbanDir))

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

          const disposition = await callbackConsumer.consumeQueuedCallbackEvent({ eventId: envelope.eventId })
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

  return { fetch, queue }
}

const { fetch: workerFetch, queue: workerQueue } = createCloudflareWorkerEntrypoint()

export { workerQueue as queue }

export default {
  fetch: workerFetch,
  queue: workerQueue,
}

import type { ConfigStorageModuleContext } from '../sdk/plugins'
import type { RuntimeHost, RuntimeHostConfigDocument, RuntimeHostConfigSelection, RuntimeHostConfigRepositoryReadResult } from '../shared/env'
import type {
  CloudflareWorkerBootstrap,
  CloudflareWorkerProviderContext,
} from '../sdk/env'
import { resolveCloudflareWorkerBootstrapInput } from '../sdk/env'
import type {
  WorkerConfigInput,
  WorkerModuleRegistry,
  WorkerSdkModule,
  WorkerSdkConstructor,
  WorkerConfigRepositoryBridge,
  WorkerConfigRepositoryBridgeModule,
  WorkerConfigRepositoryOwnerState,
  CallbackRuntimeQueueConsumer,
  CallbackRuntimeWorkerModule,
  CloudflareWorkerQueueHandlerOptions,
  CloudflareWorkerRuntimeEnv,
} from './queue-utils'
import {
  PROVIDER_ALIASES,
  isRecord,
  cloneWorkerValue,
  resolveWorkerModule,
  getConfigStorageOptions,
  isValidWorkerConfigRepositoryBridge,
  assertCloudflareCallbackModuleRegistry,
  assertCloudflareCallbackModuleHandlerSetMatchesBootstrap,
  resolvePath,
  dirnamePath,
} from './queue-utils'

export function resolveWorkerConfigRepositoryOwnerState(
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

export function toRuntimeHostConfigSelection(config: RuntimeHostConfigDocument): RuntimeHostConfigSelection {
  return {
    storageEngine: config.storageEngine,
    sqlitePath: config.sqlitePath,
    plugins: config.plugins,
  }
}

export function getCallbackRuntimeProviderId(config: RuntimeHostConfigDocument | undefined | null): string | null {
  const plugins = isRecord(config?.plugins) ? config.plugins : null
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime']) ? plugins['callback.runtime'] : null
  return typeof callbackRuntime?.provider === 'string' && callbackRuntime.provider.length > 0
    ? callbackRuntime.provider
    : null
}

export function isCallbackRuntimeQueueConsumer(value: unknown): value is CallbackRuntimeQueueConsumer {
  return Boolean(value)
    && typeof value === 'object'
    && isRecord((value as CallbackRuntimeQueueConsumer).manifest)
    && Array.isArray((value as CallbackRuntimeQueueConsumer).manifest.provides)
    && typeof (value as CallbackRuntimeQueueConsumer).register === 'function'
    && typeof (value as CallbackRuntimeQueueConsumer).unregister === 'function'
}

export function loadWorkerCallbackQueueConsumer(
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

export function resolveWorkerBootstrap(options: CloudflareWorkerQueueHandlerOptions, env?: CloudflareWorkerRuntimeEnv): CloudflareWorkerBootstrap | null {
  return resolveCloudflareWorkerBootstrapInput(
    options.bootstrap ?? env?.KANBAN_BOOTSTRAP,
    options.config ?? env?.KANBAN_CONFIG,
  )
}

export function assertWorkerCallbackModules(bootstrap: CloudflareWorkerBootstrap | null, moduleRegistry: WorkerModuleRegistry): void {
  if (!bootstrap) {
    return
  }

  assertCloudflareCallbackModuleRegistry(bootstrap.config as Record<string, unknown>, moduleRegistry)
}

export function assertWorkerCallbackModuleHandlerSet(bootstrap: CloudflareWorkerBootstrap | null, config: RuntimeHostConfigDocument): void {
  if (!bootstrap) {
    return
  }

  assertCloudflareCallbackModuleHandlerSetMatchesBootstrap(
    bootstrap.config as Record<string, unknown>,
    config as Record<string, unknown>,
  )
}

export function createWorkerConfigReadFailure(
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

export function getWorkerPaths(options: CloudflareWorkerQueueHandlerOptions, env?: CloudflareWorkerRuntimeEnv): { kanbanDir: string; workspaceRoot: string } {
  const kanbanDir = options.kanbanDir ?? env?.KANBAN_DIR ?? '.kanban'
  const absoluteKanbanDir = resolvePath(kanbanDir)
  return {
    kanbanDir,
    workspaceRoot: dirnamePath(absoluteKanbanDir),
  }
}

export function resolveWorkerSdkModule(
  options: CloudflareWorkerQueueHandlerOptions,
  moduleRegistry: WorkerModuleRegistry,
  upstreamHost?: RuntimeHost,
): { KanbanSDK: WorkerSdkConstructor; installRuntimeHost?: (runtimeHost: RuntimeHost) => void } {
  const candidate = options.sdkModule ?? resolveWorkerModule(['kanban-lite/sdk'], moduleRegistry, upstreamHost) as WorkerSdkModule | undefined
  if (!candidate || typeof candidate.KanbanSDK !== 'function') {
    throw new Error('Cloudflare Worker queue runtime requires an injected sdkModule with a KanbanSDK constructor.')
  }

  return {
    KanbanSDK: candidate.KanbanSDK as WorkerSdkConstructor,
    installRuntimeHost: typeof candidate.installRuntimeHost === 'function'
      ? candidate.installRuntimeHost as (runtimeHost: RuntimeHost) => void
      : undefined,
  }
}


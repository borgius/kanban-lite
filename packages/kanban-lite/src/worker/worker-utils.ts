import * as path from 'node:path'
import * as bundledCloudflareProviderModule from '../../../kl-plugin-cloudflare/src/index'
import {
  assertCloudflareCallbackModuleHandlerSetMatchesBootstrap,
  assertCloudflareCallbackModuleRegistry,
  resolveCallbackRuntimeModule,
} from '../sdk'
import type { RuntimeHost } from '../sdk'
import { PROVIDER_ALIASES } from '../sdk/plugins'
import type { ConfigStorageModuleContext } from '../sdk/plugins'
import type { RuntimeHostConfigDocument, RuntimeHostConfigRepositoryReadResult, RuntimeHostConfigSelection } from '../shared/env'
import { resolveCloudflareWorkerBootstrapInput } from '../sdk/env'
import type { CloudflareWorkerBootstrap, CloudflareWorkerProviderContext } from '../sdk/env'
import type {
  WorkerModuleRegistry,
  WorkerConfigRepositoryBridge,
  WorkerConfigRepositoryBridgeModule,
  WorkerConfigRepositoryOwnerState,
  CloudflareWorkerRuntimeEnv,
  CloudflareWorkerFetchHandlerOptions,
  CallbackRuntimeQueueConsumer,
  CallbackRuntimeWorkerModule,
} from './worker-types'

export function cloneWorkerValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isConfigDocument(value: unknown): value is RuntimeHostConfigDocument {
  return isRecord(value)
}

export function isValidWorkerConfigRepositoryBridge(
  value: unknown,
): value is WorkerConfigRepositoryBridge {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkerConfigRepositoryBridge).readConfigDocument === 'function'
    && typeof (value as WorkerConfigRepositoryBridge).writeConfigDocument === 'function'
}

export function getWorkerRevisionToken(workerProviderContext: CloudflareWorkerProviderContext | null | undefined): string {
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

export function areWorkerConfigsEqual(
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

export function getConfigStorageOptions(
  bootstrap: CloudflareWorkerBootstrap | null,
): Record<string, unknown> | undefined {
  const configured = bootstrap?.config.plugins?.['config.storage']
  if (!isRecord(configured) || !isRecord(configured.options)) {
    return undefined
  }
  return structuredClone(configured.options)
}

export function createWorkerModuleRegistry(baseRegistry: WorkerModuleRegistry): WorkerModuleRegistry {
  const bundledCloudflareProvider = baseRegistry.cloudflare
    ?? baseRegistry['kl-plugin-cloudflare']
    ?? bundledCloudflareProviderModule

  return {
    ...baseRegistry,
    cloudflare: bundledCloudflareProvider,
    'kl-plugin-cloudflare': bundledCloudflareProvider,
  }
}

export function resolveWorkerModule(
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

export function toRuntimeHostConfigSelection(config: RuntimeHostConfigDocument): RuntimeHostConfigSelection {
  return {
    storageEngine: config.storageEngine,
    sqlitePath: config.sqlitePath,
    plugins: config.plugins,
  }
}

export function getCallbackRuntimeProviderId(config: RuntimeHostConfigDocument | undefined | null): string | null {
  const plugins = isRecord(config?.plugins) ? config.plugins : null
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime'])
    ? plugins['callback.runtime']
    : null

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


export function resolveWorkerBootstrap(
  options: CloudflareWorkerFetchHandlerOptions,
  env?: CloudflareWorkerRuntimeEnv,
): CloudflareWorkerBootstrap | null {
  return resolveCloudflareWorkerBootstrapInput(
    options.bootstrap ?? env?.KANBAN_BOOTSTRAP,
    options.config ?? env?.KANBAN_CONFIG,
  )
}

export function assertWorkerCallbackModules(
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

export function assertWorkerCallbackModuleHandlerSet(
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

export function createWorkerConfigReadFailure(
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

export function getWorkerPaths(
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


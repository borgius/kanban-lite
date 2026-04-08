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
  assertCloudflareWorkerBootstrapConfigMutation,
  createCloudflareWorkerProviderContext,
  resolveCloudflareWorkerBootstrapInput,
} from '../sdk/env'
import {
  getSharedRuntimeHost,
  installSharedRuntimeHost,
} from '../shared/runtimeHostState'

import {
  createWorkerModuleRegistry,
  hasCloudflareCallbackModuleHandlers,
  joinPath,
  parseCloudflareCallbackQueueMessageEnvelope,
  resolvePath,
} from './queue-utils'
import type {
  WorkerModuleRegistry,
  WorkerSdkModule,
  WorkerSdkConstructor,
  WorkerEntrypointState,
  WorkerRuntimeHostHandle,
  CloudflareWorkerRuntimeEnv,
  CloudflareWorkerQueueHandlerOptions,
  CloudflareWorkerQueueBatch,
  CloudflareWorkerExecutionContext,
} from './queue-utils'
export type {
  WorkerModuleRegistry,
  WorkerSdkModule,
  CloudflareWorkerRuntimeEnv,
  CloudflareWorkerQueueHandlerOptions,
  CloudflareWorkerQueueMessage,
  CloudflareWorkerQueueBatch,
  CloudflareWorkerExecutionContext,
} from './queue-utils'
import {
  assertWorkerCallbackModules,
  getCallbackRuntimeProviderId,
  getWorkerPaths,
  loadWorkerCallbackQueueConsumer,
  resolveWorkerBootstrap,
  resolveWorkerConfigRepositoryOwnerState,
  resolveWorkerSdkModule,
} from './queue-setup'
import { createWorkerRuntimeHost } from './queue-runtime-host'

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

function installWorkerRuntimeHost(runtimeHost: RuntimeHost, sdkModule: Pick<WorkerSdkModule, 'installRuntimeHost'> | null): void {
  installSharedRuntimeHost(runtimeHost)
  if (typeof sdkModule?.installRuntimeHost === 'function') {
    sdkModule.installRuntimeHost(runtimeHost)
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

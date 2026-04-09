import { AsyncLocalStorage } from 'node:async_hooks'
import * as bundledSdkRuntimeModule from '../../dist/sdk/index.cjs'
import { getRuntimeHost, installRuntimeHost } from '../sdk'
import type { RuntimeHost } from '../sdk'
import { assertCloudflareWorkerBootstrapConfigMutation, createCloudflareWorkerProviderContext } from '../sdk/env'
import type { RuntimeHostConfigDocument } from '../shared/env'
import type { CloudflareWorkerBootstrap, CloudflareWorkerProviderContext } from '../sdk/env'
import type {
  WorkerModuleRegistry,
  WorkerConfigRepositoryOwnerState,
  WorkerRequestConfigState,
  WorkerRuntimeHostHandle,
  WorkerEntrypointState,
  CloudflareWorkerRuntimeEnv,
  CloudflareWorkerFetchHandlerOptions,
} from './worker-types'
import {
  cloneWorkerValue,
  isConfigDocument,
  areWorkerConfigsEqual,
  getWorkerRevisionToken,
  toRuntimeHostConfigSelection,
  assertWorkerCallbackModuleHandlerSet,
  createWorkerConfigReadFailure,
  resolveWorkerBootstrap,
  assertWorkerCallbackModules,
  createWorkerModuleRegistry,
  resolveWorkerConfigRepositoryOwnerState,
} from './worker-utils'

const CLOUDFLARE_ACTIVE_CARD_STATE_BINDING = 'KANBAN_ACTIVE_CARD_STATE'

type WorkerActiveCardStateScope = Parameters<NonNullable<RuntimeHost['readActiveCardState']>>[0]
type WorkerActiveCardStateValue = NonNullable<Awaited<ReturnType<NonNullable<RuntimeHost['readActiveCardState']>>>>

interface WorkerActiveCardStateDurableObjectStub {
  getActiveCardState(): Promise<WorkerActiveCardStateValue | null>
  setActiveCardState(state: WorkerActiveCardStateValue): Promise<void>
  clearActiveCardState(): Promise<void>
}

interface WorkerActiveCardStateDurableObjectNamespace {
  getByName(name: string): WorkerActiveCardStateDurableObjectStub
}

function getWorkerActiveCardStateNamespace(
  env: CloudflareWorkerRuntimeEnv | undefined,
): WorkerActiveCardStateDurableObjectNamespace | null {
  const candidate = env?.[CLOUDFLARE_ACTIVE_CARD_STATE_BINDING]
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  return typeof (candidate as WorkerActiveCardStateDurableObjectNamespace).getByName === 'function'
    ? candidate as WorkerActiveCardStateDurableObjectNamespace
    : null
}

function getWorkerActiveCardStateStub(
  namespace: WorkerActiveCardStateDurableObjectNamespace,
  scope: WorkerActiveCardStateScope,
): WorkerActiveCardStateDurableObjectStub {
  return namespace.getByName(`active-card:${scope.workspaceRoot}:${scope.kanbanDir}`)
}

export function resolveWorkerRuntimeHostHandle(
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
    env,
  )

  return state.workerRuntimeHost
}

export function installWorkerRuntimeHost(runtimeHost: RuntimeHost): void {
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
  env?: CloudflareWorkerRuntimeEnv,
): WorkerRuntimeHostHandle {
  let committedConfig: RuntimeHostConfigDocument | undefined = cloneWorkerValue(bootstrap?.config)
  let hasAuthoritativeConfig = false
  let dispatcherStale = false
  const requestConfigStorage = new AsyncLocalStorage<WorkerRequestConfigState>()
  const activeCardNamespace = getWorkerActiveCardStateNamespace(env)

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
    ...(activeCardNamespace || upstreamHost?.readActiveCardState || upstreamHost?.writeActiveCardState || upstreamHost?.clearActiveCardState
      ? {
          async readActiveCardState(scope: WorkerActiveCardStateScope) {
            if (activeCardNamespace) {
              return cloneWorkerValue(await getWorkerActiveCardStateStub(activeCardNamespace, scope).getActiveCardState())
            }
            return cloneWorkerValue(await upstreamHost?.readActiveCardState?.(scope))
          },
          async writeActiveCardState(scope: WorkerActiveCardStateScope, state: WorkerActiveCardStateValue) {
            if (activeCardNamespace) {
              await getWorkerActiveCardStateStub(activeCardNamespace, scope).setActiveCardState(cloneWorkerValue(state))
              return
            }
            await upstreamHost?.writeActiveCardState?.(scope, cloneWorkerValue(state))
          },
          async clearActiveCardState(scope: WorkerActiveCardStateScope) {
            if (activeCardNamespace) {
              await getWorkerActiveCardStateStub(activeCardNamespace, scope).clearActiveCardState()
              return
            }
            await upstreamHost?.clearActiveCardState?.(scope)
          },
        }
      : {}),
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


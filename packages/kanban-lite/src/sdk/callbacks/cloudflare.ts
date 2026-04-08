import type { DurableCallbackDispatchMetadata } from './contract'
import { createDurableCallbackDispatchMetadata } from './contract'
import {
  assertCallableCallbackModuleExport,
  normalizeCallbackHandlers,
} from './core'

export const CLOUDFLARE_CALLBACK_MODULE_REGISTRY_NAME = 'KANBAN_MODULES' as const
export const CLOUDFLARE_CALLBACK_QUEUE_HANDLE = 'callbacks' as const
export const CLOUDFLARE_CALLBACK_QUEUE_ENTRYPOINT_EXPORT = 'queue' as const
export const CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND = 'durable-callback-event' as const
export const CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION = 1 as const
export const CLOUDFLARE_CALLBACK_RUNTIME_PROVIDER_ID = 'cloudflare' as const
export const CLOUDFLARE_CALLBACK_QUEUE_CONSUMER_DEFAULTS = Object.freeze({
  maxBatchSize: 1,
  maxBatchTimeout: 0,
  maxRetries: 3,
  deadLetterQueue: null,
} as const)

export interface CallbackModuleHandlerConfig {
  readonly id?: string
  readonly name?: string
  readonly type: 'module'
  readonly enabled?: boolean
  readonly module: string
  readonly handler: string
}

export interface CloudflareCallbackModuleRegistryEntry {
  readonly module: string
  readonly handlers: readonly string[]
}

export interface CloudflareCallbackQueueMessageEnvelope {
  readonly version: typeof CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION
  readonly kind: typeof CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND
  readonly eventId: string
}

export interface CloudflareCallbackQueueContract {
  readonly moduleRegistry: typeof CLOUDFLARE_CALLBACK_MODULE_REGISTRY_NAME
  readonly queueHandle: typeof CLOUDFLARE_CALLBACK_QUEUE_HANDLE
  readonly consumerExport: typeof CLOUDFLARE_CALLBACK_QUEUE_ENTRYPOINT_EXPORT
  readonly zeroIdle: true
  readonly delivery: {
    readonly scope: 'event'
    readonly payload: 'durable-reference'
    readonly atLeastOnce: true
    readonly batchingConfiguredByHost: true
    readonly deadLetterQueueOptional: true
  }
}

export const CLOUDFLARE_CALLBACK_QUEUE_CONTRACT: CloudflareCallbackQueueContract = {
  moduleRegistry: CLOUDFLARE_CALLBACK_MODULE_REGISTRY_NAME,
  queueHandle: CLOUDFLARE_CALLBACK_QUEUE_HANDLE,
  consumerExport: CLOUDFLARE_CALLBACK_QUEUE_ENTRYPOINT_EXPORT,
  zeroIdle: true,
  delivery: {
    scope: 'event',
    payload: 'durable-reference',
    atLeastOnce: true,
    batchingConfiguredByHost: true,
    deadLetterQueueOptional: true,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function getCloudflareCallbackRuntimeConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const plugins = isRecord(config.plugins) ? config.plugins : null
  const callbackRuntime = plugins && isRecord(plugins['callback.runtime'])
    ? plugins['callback.runtime']
    : null

  if (!callbackRuntime || callbackRuntime.provider !== CLOUDFLARE_CALLBACK_RUNTIME_PROVIDER_ID) {
    return null
  }

  return callbackRuntime
}

function getRawCallbackHandlers(config: Record<string, unknown>): unknown[] {
  const callbackRuntime = getCloudflareCallbackRuntimeConfig(config)
  const options = callbackRuntime && isRecord(callbackRuntime.options)
    ? callbackRuntime.options
    : null
  return Array.isArray(options?.handlers) ? options.handlers : []
}

function getEnabledCloudflareModuleRows(config: Record<string, unknown>): CallbackModuleHandlerConfig[] {
  return getRawCallbackHandlers(config)
    .flatMap((rawHandler, index) => {
      if (!isRecord(rawHandler)) {
        return []
      }

      const enabled = typeof rawHandler.enabled === 'boolean' ? rawHandler.enabled : true
      const type = rawHandler.type
      if (!enabled) {
        return []
      }

      if (type !== 'module') {
        throw new Error(
          'Cloudflare callback.runtime only supports enabled module handlers. Disable or migrate inline/process handlers before selecting provider "cloudflare".',
        )
      }

      if (!isNonEmptyString(rawHandler.module) || !isNonEmptyString(rawHandler.handler)) {
        throw new Error(
          `Enabled Cloudflare callback.runtime module handler at index ${index} requires non-empty module and handler strings.`,
        )
      }

      return [{
        type: 'module' as const,
        module: rawHandler.module.trim(),
        handler: rawHandler.handler.trim(),
        ...(isNonEmptyString(rawHandler.id) ? { id: rawHandler.id.trim() } : {}),
        ...(isNonEmptyString(rawHandler.name) ? { name: rawHandler.name.trim() } : {}),
      }]
    })
}

export function getConfiguredCallbackModuleHandlers(
  config: Record<string, unknown>,
): CallbackModuleHandlerConfig[] {
  return getEnabledCloudflareModuleRows(config)
    .concat(
      normalizeCallbackHandlers(getRawCallbackHandlers(config), {
        onError(message) {
          throw new Error(`Invalid Cloudflare callback.runtime handler configuration: ${message}`)
        },
      })
        .filter((handler) => handler.enabled !== false && handler.type !== 'module')
        .map((handler) => {
          throw new Error(
            `Cloudflare callback.runtime only supports enabled module handlers; found enabled ${handler.type} handler "${handler.name}".`,
          )
        }),
    )
    .filter((entry, index, entries) => entries.findIndex(
      (candidate) => candidate.module === entry.module && candidate.handler === entry.handler,
    ) === index)
}

export function hasCloudflareCallbackModuleHandlers(config: Record<string, unknown>): boolean {
  return getConfiguredCallbackModuleHandlers(config).length > 0
}

export function collectCloudflareCallbackModuleRegistryEntries(
  config: Record<string, unknown>,
): CloudflareCallbackModuleRegistryEntry[] {
  const handlersByModule = new Map<string, Set<string>>()

  for (const handler of getConfiguredCallbackModuleHandlers(config)) {
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

export function assertCloudflareCallbackModuleRegistry(
  config: Record<string, unknown>,
  moduleRegistry: Record<string, unknown>,
): void {
  for (const entry of collectCloudflareCallbackModuleRegistryEntries(config)) {
    if (!Object.prototype.hasOwnProperty.call(moduleRegistry, entry.module)) {
      throw new Error(
        `Configured callback.runtime module '${entry.module}' is not available in ${CLOUDFLARE_CALLBACK_MODULE_REGISTRY_NAME}.`,
      )
    }

    const loadedModule = moduleRegistry[entry.module]
    for (const exportName of entry.handlers) {
      assertCallableCallbackModuleExport(loadedModule, entry.module, exportName)
    }
  }
}

export function assertCloudflareCallbackModuleHandlerSetMatchesBootstrap(
  bootstrapConfig: Record<string, unknown>,
  runtimeConfig: Record<string, unknown>,
): void {
  const bootstrapEntries = collectCloudflareCallbackModuleRegistryEntries(bootstrapConfig)
  const runtimeEntries = collectCloudflareCallbackModuleRegistryEntries(runtimeConfig)

  if (JSON.stringify(bootstrapEntries) === JSON.stringify(runtimeEntries)) {
    return
  }

  throw new Error(
    'Cloudflare Worker callback.runtime enabled module handler set changed from the bootstrap-owned deploy registry. Update the Worker bootstrap and redeploy before applying this config change.',
  )
}

export function createCloudflareCallbackQueueMessageEnvelope(
  input: string | DurableCallbackDispatchMetadata,
): CloudflareCallbackQueueMessageEnvelope {
  const dispatch = typeof input === 'string'
    ? createDurableCallbackDispatchMetadata(input)
    : input

  return {
    version: CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_VERSION,
    kind: CLOUDFLARE_CALLBACK_QUEUE_MESSAGE_KIND,
    eventId: dispatch.eventId,
  }
}

export function parseCloudflareCallbackQueueMessageEnvelope(
  value: unknown,
): CloudflareCallbackQueueMessageEnvelope | null {
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

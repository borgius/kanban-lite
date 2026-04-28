import type { ProviderRef } from '../../shared/config'
import type { SDKPluginEventDeclaration, SDKEventListenerPlugin } from '../types'
import { loadExternalModule } from './plugin-loader'
import {
  isSDKEventListenerPluginConstructor,
  isValidSDKEventListenerPlugin,
} from './webhook-callback-plugins'

export const CRON_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['cron', 'kl-plugin-cron'],
])

interface CronRuntimeModule {
  cronListenerPlugin?: unknown
  CronListenerPlugin?: unknown
  getCronRuntimeEventDeclarations?: ((workspaceRoot: string) => unknown) | unknown
  default?: unknown
}

export interface CronRuntimeFeatures {
  readonly id: string
  readonly listener: SDKEventListenerPlugin
  readonly events: readonly SDKPluginEventDeclaration[]
}

function isValidSDKPluginEventDeclaration(value: unknown): value is SDKPluginEventDeclaration {
  if (!value || typeof value !== 'object') return false
  const candidate = value as SDKPluginEventDeclaration
  return typeof candidate.event === 'string'
    && candidate.event.length > 0
    && (candidate.phase === 'before' || candidate.phase === 'after')
    && (candidate.resource === undefined || typeof candidate.resource === 'string')
    && (candidate.label === undefined || typeof candidate.label === 'string')
    && (candidate.apiAfter === undefined || typeof candidate.apiAfter === 'boolean')
}

function normalizeCronRuntimeEventDeclarations(
  value: unknown,
  packageName: string,
): readonly SDKPluginEventDeclaration[] {
  if (value === undefined) return []
  if (Array.isArray(value) && value.every(isValidSDKPluginEventDeclaration)) {
    return value
  }

  throw new Error(
    `Plugin "${packageName}" does not export valid cron runtime event declarations. ` +
    `Expected getCronRuntimeEventDeclarations(workspaceRoot) to return SDK plugin event declarations.`,
  )
}

function loadCronRuntimeFeatures(packageName: string, workspaceRoot: string): CronRuntimeFeatures {
  const mod = loadExternalModule(packageName) as CronRuntimeModule

  const directListener = isSDKEventListenerPluginConstructor(mod.CronListenerPlugin)
    ? mod.CronListenerPlugin
    : isValidSDKEventListenerPlugin(mod.cronListenerPlugin)
      ? mod.cronListenerPlugin
      : isValidSDKEventListenerPlugin(mod.default)
        ? mod.default
        : undefined

  if (!directListener) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid cron runtime listener. ` +
      `Expected a named export 'cronListenerPlugin', 'CronListenerPlugin', ` +
      `or default export implementing register/unregister with an event-listener manifest.`,
    )
  }

  const listener = isSDKEventListenerPluginConstructor(directListener)
    ? new directListener(workspaceRoot)
    : directListener

  const rawEvents = typeof mod.getCronRuntimeEventDeclarations === 'function'
    ? mod.getCronRuntimeEventDeclarations(workspaceRoot)
    : undefined

  return {
    id: listener.manifest.id,
    listener,
    events: normalizeCronRuntimeEventDeclarations(rawEvents, packageName),
  }
}

export function resolveCronRuntimeFeatures(
  ref: ProviderRef,
  workspaceRoot: string,
): CronRuntimeFeatures | null {
  if (ref.provider === 'none') return null

  const packageName = CRON_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  try {
    return loadCronRuntimeFeatures(packageName, workspaceRoot)
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes('Plugin package')
      && error.message.includes('not installed')
    ) {
      return null
    }
    throw error
  }
}

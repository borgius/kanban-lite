import type {
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactedValues,
  PluginSettingsRedactionPolicy,
} from '../../shared/types'
import type {
  KanbanConfig,
  PluginCapabilityNamespace,
  PluginCapabilitySelections,
  ProviderRef,
} from '../../shared/config'
import type { KanbanSDK } from '../KanbanSDK'

export type PluginSettingsOptionsSchemaValueResolver<T = unknown> = (
  sdk: KanbanSDK,
  optionsSchema: PluginSettingsOptionsSchemaMetadata,
) => T | Promise<T>

export declare class PluginSettingsStoreError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>
  constructor(code: string, message: string, details?: Record<string, unknown>)
}

export declare function resolvePluginSettingsOptionsSchema(
  value: unknown,
  sdk: KanbanSDK,
): Promise<PluginSettingsOptionsSchemaMetadata | undefined>

export declare function cloneProviderRef(ref: ProviderRef): ProviderRef

export declare function getPluginSchemaDefaultOptions(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined

export declare function readPluginSettingsConfigDocument(workspaceRoot: string): KanbanConfig

export declare function writePluginSettingsConfigDocument(workspaceRoot: string, config: KanbanConfig): void

export declare function ensurePluginSettingsOptionsRecord(
  options: unknown,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown>

export declare function normalizePluginSettingsProviderOptionsForPersistence(
  capability: PluginCapabilityNamespace,
  currentOptions: Record<string, unknown> | undefined,
  nextOptions: Record<string, unknown>,
): Record<string, unknown>

export declare function getMutablePluginsRecord(config: KanbanConfig): PluginCapabilitySelections

export declare function getCachedPluginProviderOptions(
  config: Pick<KanbanConfig, 'auth' | 'pluginOptions' | 'plugins' | 'sqlitePath' | 'storageEngine' | 'webhookPlugin'>,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> | undefined

export declare function setCachedPluginProviderOptions(
  config: KanbanConfig,
  capability: PluginCapabilityNamespace,
  providerId: string,
  options: Record<string, unknown> | undefined,
): void

export declare function normalizeProviderIdForComparison(
  capability: PluginCapabilityNamespace,
  providerId: string,
): string

export declare function pruneRedundantDerivedStorageConfig(config: KanbanConfig): boolean

export declare function getSelectedProviderRef(
  config: Pick<KanbanConfig, 'auth' | 'pluginOptions' | 'plugins' | 'sqlitePath' | 'storageEngine' | 'webhookPlugin'>,
  capability: PluginCapabilityNamespace,
): ProviderRef | null

export declare function getPersistedPluginProviderOptions(
  config: Pick<KanbanConfig, 'auth' | 'pluginOptions' | 'plugins' | 'sqlitePath' | 'storageEngine' | 'webhookPlugin'>,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> | undefined

export declare function mergeProviderOptionsUpdate(
  currentValue: unknown,
  nextValue: unknown,
  currentPath: string,
  secretPaths: readonly string[],
  redaction: PluginSettingsRedactionPolicy,
): unknown

export declare function createRedactedProviderOptions(
  options: Record<string, unknown> | undefined,
  optionsSchema: PluginSettingsOptionsSchemaMetadata | undefined,
  redaction: PluginSettingsRedactionPolicy,
): PluginSettingsRedactedValues | null

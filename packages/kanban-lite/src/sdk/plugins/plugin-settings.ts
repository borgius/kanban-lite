import * as crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactedValues,
  PluginSettingsRedactionPolicy,
  PluginSettingsSecretFieldMetadata,
} from '../../shared/types'
import {
  DEFAULT_CONFIG,
  normalizeAuthCapabilities,
  normalizeCallbackCapabilities,
  normalizeCronCapabilities,
  normalizeCardStateCapabilities,
  normalizeConfigStorageSelection,
  normalizeStorageCapabilities,
  normalizeWebhookCapabilities,
  invalidateConfigReadCache,
} from '../../shared/config'
import type {
  KanbanConfig,
  PluginCapabilityNamespace,
  PluginCapabilitySelections,
  ProviderRef,
} from '../../shared/config'
import type { KanbanSDK } from '../KanbanSDK'
import {
  readConfigRepositoryDocument,
  writeConfigRepositoryDocument,
} from '../modules/configRepository'

export type PluginSettingsOptionsSchemaValueResolver<T = unknown> = (
  sdk: KanbanSDK,
  optionsSchema: PluginSettingsOptionsSchemaMetadata,
) => T | Promise<T>

export type PluginSettingsOptionsSchemaInput =
  | PluginSettingsOptionsSchemaMetadata
  | Promise<PluginSettingsOptionsSchemaMetadata>
  | PluginSettingsOptionsSchemaValueResolver<PluginSettingsOptionsSchemaMetadata>

/** Shared factory signature for plugin package `optionsSchema()` hooks. */
export type PluginSettingsOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaInput

type PluginSettingsConfigSnapshot = Pick<
  KanbanConfig,
  'auth' | 'plugins' | 'sqlitePath' | 'storageEngine' | 'webhookPlugin'
>

type UnknownRecord = Record<string, unknown>

const PLUGIN_SETTINGS_SECRET_KEY_PATTERN = /(secret|token|password|passphrase|private[-_]?key|client[-_]?secret|secret[-_]?key|session[-_]?token|api[-_]?key)/i

export class PluginSettingsStoreError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'PluginSettingsStoreError'
    this.code = code
    this.details = details
  }
}

function isRecord(value: unknown): value is UnknownRecord
function isRecord<T extends object>(value: unknown): value is T & UnknownRecord
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPluginSettingsSecretFieldMetadata(value: unknown): value is PluginSettingsSecretFieldMetadata {
  return isRecord<PluginSettingsSecretFieldMetadata>(value)
    && typeof value.path === 'string'
    && value.path.length > 0
    && isRecord(value.redaction)
    && typeof value.redaction.maskedValue === 'string'
    && value.redaction.writeOnly === true
    && Array.isArray(value.redaction.targets)
}

function normalizePluginSettingsOptionsSchema(value: unknown): PluginSettingsOptionsSchemaMetadata | undefined {
  if (!isRecord(value) || !isRecord<PluginSettingsOptionsSchemaMetadata['schema']>(value.schema)) return undefined
  const uiSchema = isRecord(value.uiSchema)
    ? structuredClone(value.uiSchema as unknown as PluginSettingsOptionsSchemaMetadata['uiSchema'])
    : undefined
  const secrets = Array.isArray(value.secrets)
    ? value.secrets.filter(isValidPluginSettingsSecretFieldMetadata)
    : []
  // beforeSave is a server-side function hook; preserve it but never serialize it to transports.
  const beforeSave = typeof value.beforeSave === 'function'
    ? (value.beforeSave as PluginSettingsOptionsSchemaMetadata['beforeSave'])
    : undefined
  return {
    schema: structuredClone(value.schema) as PluginSettingsOptionsSchemaMetadata['schema'],
    ...(uiSchema ? { uiSchema } : {}),
    secrets,
    ...(beforeSave ? { beforeSave } : {}),
  }
}

async function resolvePluginSettingsOptionsSchemaNode(
  value: unknown,
  sdk: KanbanSDK,
  optionsSchema: PluginSettingsOptionsSchemaMetadata,
): Promise<unknown> {
  let current = await Promise.resolve(value)

  while (typeof current === 'function') {
    current = await (current as PluginSettingsOptionsSchemaValueResolver)(sdk, optionsSchema)
  }

  if (Array.isArray(current)) {
    const next: unknown[] = []
    for (const entry of current) {
      next.push(await resolvePluginSettingsOptionsSchemaNode(entry, sdk, optionsSchema))
    }
    return next
  }

  if (!isRecord(current)) {
    return current
  }

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(current)) {
    next[key] = await resolvePluginSettingsOptionsSchemaNode(entry, sdk, optionsSchema)
  }
  return next
}

/**
 * Resolves transport-safe plugin-settings metadata from a static object or a
 * dynamic sync/async schema factory.
 *
 * Any nested resolver function found inside `schema`, `uiSchema`, or other
 * metadata fields is awaited before normalization, ensuring downstream host
 * transports and JSON Forms consumers receive plain structured-clone-safe
 * values only.
 */
export async function resolvePluginSettingsOptionsSchema(
  value: unknown,
  sdk: KanbanSDK,
): Promise<PluginSettingsOptionsSchemaMetadata | undefined> {
  const root = {} as PluginSettingsOptionsSchemaMetadata & Record<string, unknown>
  let current = await Promise.resolve(value)

  while (typeof current === 'function') {
    current = await (current as PluginSettingsOptionsSchemaValueResolver)(sdk, root)
  }

  if (!isRecord(current)) return undefined

  for (const [key, entry] of Object.entries(current)) {
    root[key] = await resolvePluginSettingsOptionsSchemaNode(entry, sdk, root)
  }

  return normalizePluginSettingsOptionsSchema(root)
}

export function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: structuredClone(ref.options) }
    : { provider: ref.provider }
}

function clonePluginSchemaDefaultValue<T>(value: T): T {
  return structuredClone(value)
}

function applyPluginSchemaDefaultsToData(schemaNode: unknown, dataNode: unknown): unknown {
  if (!isRecord(schemaNode)) return dataNode

  if (dataNode === undefined && Object.prototype.hasOwnProperty.call(schemaNode, 'default')) {
    return clonePluginSchemaDefaultValue(schemaNode.default)
  }

  if (Array.isArray(dataNode)) {
    if (isRecord(schemaNode.items)) {
      return dataNode.map((item) => applyPluginSchemaDefaultsToData(schemaNode.items, item))
    }

    const tupleItems = schemaNode.items
    if (Array.isArray(tupleItems)) {
      return dataNode.map((item, index) => applyPluginSchemaDefaultsToData(tupleItems[index], item))
    }

    return dataNode
  }

  if (!isRecord(dataNode)) return dataNode

  if (isRecord(schemaNode.properties)) {
    for (const [key, childSchema] of Object.entries(schemaNode.properties)) {
      const nextValue = applyPluginSchemaDefaultsToData(childSchema, dataNode[key])
      if (nextValue !== undefined) {
        dataNode[key] = nextValue
      }
    }
  }

  return dataNode
}

function applyPluginSchemaDefaults(
  schema: Record<string, unknown>,
  data: unknown,
): Record<string, unknown> {
  const nextData = isRecord(data) ? structuredClone(data) as Record<string, unknown> : {}
  return applyPluginSchemaDefaultsToData(schema, nextData) as Record<string, unknown>
}

export function getPluginSchemaDefaultOptions(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema) return undefined
  const defaultOptions = applyPluginSchemaDefaults(schema, undefined)
  return Object.keys(defaultOptions).length > 0 ? defaultOptions : undefined
}

export function readPluginSettingsConfigDocument(workspaceRoot: string): KanbanConfig {
  const result = readConfigRepositoryDocument(workspaceRoot, {
    allowSeedFallbackOnProviderError: true,
  })
  if (result.status === 'missing') {
    return structuredClone(DEFAULT_CONFIG)
  }

  if (result.status === 'error') {
    throw new PluginSettingsStoreError(
      'plugin-settings-config-load-failed',
      result.reason === 'read'
        ? 'Unable to read plugin settings from .kanban.json.'
        : 'Unable to parse plugin settings from .kanban.json.',
      { configPath: result.filePath },
    )
  }

  return result.value as unknown as KanbanConfig
}

function getPluginSettingsConfigSaveFailureMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (isRecord(error) && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message
  }

  return null
}

function isPluginSettingsRuntimeMutationRejected(error: unknown): error is Error {
  const message = getPluginSettingsConfigSaveFailureMessage(error)
  return message?.startsWith('Cloudflare Worker config.storage topology changed from ') ?? false
}

export function writePluginSettingsConfigDocument(workspaceRoot: string, config: KanbanConfig): void {
  const result = writeConfigRepositoryDocument(workspaceRoot, config)
  if (result.status === 'error') {
    if (isPluginSettingsRuntimeMutationRejected(result.cause)) {
      throw new PluginSettingsStoreError(
        'plugin-settings-runtime-mutation-rejected',
        result.cause.message,
        { configPath: result.filePath },
      )
    }

    throw new PluginSettingsStoreError(
      'plugin-settings-config-save-failed',
      'Unable to save plugin settings to .kanban.json.',
      { configPath: result.filePath },
    )
  }
  invalidateConfigReadCache()
}

export function ensurePluginSettingsOptionsRecord(
  options: unknown,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> {
  if (isRecord(options)) return structuredClone(options)

  throw new PluginSettingsStoreError(
    'plugin-settings-options-invalid',
    'Plugin option updates must be an object payload.',
    { capability, providerId },
  )
}

function generatePluginSettingsWebhookId(): string {
  return `wh_${crypto.randomBytes(8).toString('hex')}`
}

function normalizeWebhookPluginSettingsOptions(
  currentOptions: Record<string, unknown> | undefined,
  nextOptions: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(nextOptions.webhooks)) return nextOptions

  const currentWebhooks = Array.isArray(currentOptions?.webhooks) ? currentOptions.webhooks : []
  const webhooks = nextOptions.webhooks.map((entry, index) => {
    if (!isRecord(entry)) return entry

    const nextId = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (nextId.length > 0) {
      return nextId === entry.id ? entry : { ...entry, id: nextId }
    }

    const currentEntry = currentWebhooks[index]
    const currentId = isRecord(currentEntry) && typeof currentEntry.id === 'string'
      ? currentEntry.id.trim()
      : ''

    return {
      ...entry,
      id: currentId.length > 0 ? currentId : generatePluginSettingsWebhookId(),
    }
  })

  return {
    ...nextOptions,
    webhooks,
  }
}

export function normalizePluginSettingsProviderOptionsForPersistence(
  capability: PluginCapabilityNamespace,
  currentOptions: Record<string, unknown> | undefined,
  nextOptions: Record<string, unknown>,
): Record<string, unknown> {
  if (capability === 'webhook.delivery') {
    return normalizeWebhookPluginSettingsOptions(currentOptions, nextOptions)
  }

  return nextOptions
}

export function getMutablePluginsRecord(config: KanbanConfig): PluginCapabilitySelections {
  const existing = isRecord(config.plugins) ? config.plugins : {}
  const nextPlugins: PluginCapabilitySelections = {}

  for (const [key, value] of Object.entries(existing)) {
    if (isRecord(value) && typeof value.provider === 'string') {
      nextPlugins[key as PluginCapabilityNamespace] = {
        provider: value.provider,
        ...(isRecord(value.options) ? { options: structuredClone(value.options) } : {}),
      }
    }
  }

  config.plugins = nextPlugins
  return nextPlugins
}

export function normalizeProviderIdForComparison(
  capability: PluginCapabilityNamespace,
  providerId: string,
): string {
  if (capability === 'card.storage' && providerId === 'markdown') return 'localfs'
  if (capability === 'config.storage' && providerId === 'markdown') return 'localfs'
  if (capability === 'card.state' && providerId === 'builtin') return 'localfs'
  return providerId
}

function normalizeProviderRefForComparison(
  capability: PluginCapabilityNamespace,
  ref: ProviderRef,
): ProviderRef {
  return {
    provider: normalizeProviderIdForComparison(capability, ref.provider),
    ...(isRecord(ref.options) ? { options: structuredClone(ref.options) } : {}),
  }
}

function providerRefsMatch(
  capability: PluginCapabilityNamespace,
  left: ProviderRef,
  right: ProviderRef,
): boolean {
  const normalizedLeft = normalizeProviderRefForComparison(capability, left)
  const normalizedRight = normalizeProviderRefForComparison(capability, right)

  return normalizedLeft.provider === normalizedRight.provider
    && isDeepStrictEqual(normalizedLeft.options, normalizedRight.options)
}

function pruneEmptyPluginSettingsContainers(config: KanbanConfig): void {
  if (isRecord(config.plugins) && Object.keys(config.plugins).length === 0) {
    delete config.plugins
  }
}

function pruneRedundantDerivedCardStateConfig(config: KanbanConfig): boolean {
  const configured = config.plugins?.['card.state']
  if (!configured) return false

  const derived = normalizeStorageCapabilities(config)['card.storage']
  if (!providerRefsMatch('card.state', configured, derived)) return false

  const plugins = getMutablePluginsRecord(config)
  delete plugins['card.state']

  pruneEmptyPluginSettingsContainers(config)
  return true
}

function isRedundantDerivedAttachmentStorageConfig(configured: ProviderRef, derived: ProviderRef): boolean {
  const normalizedConfiguredProvider = normalizeProviderIdForComparison('attachment.storage', configured.provider)
  const normalizedDerivedProvider = normalizeProviderIdForComparison('attachment.storage', derived.provider)

  return normalizedConfiguredProvider === normalizedDerivedProvider
    || (normalizedConfiguredProvider === 'localfs' && normalizedDerivedProvider !== 'localfs')
}

function pruneRedundantDerivedAttachmentStorageConfig(config: KanbanConfig): boolean {
  const configured = config.plugins?.['attachment.storage']
  if (!configured) return false

  const derived = normalizeStorageCapabilities(config)['card.storage']
  if (!isRedundantDerivedAttachmentStorageConfig(configured, derived)) return false

  const plugins = getMutablePluginsRecord(config)
  delete plugins['attachment.storage']

  pruneEmptyPluginSettingsContainers(config)
  return true
}

export function pruneRedundantDerivedStorageConfig(config: KanbanConfig): boolean {
  const prunedAttachmentStorage = pruneRedundantDerivedAttachmentStorageConfig(config)
  const prunedCardState = pruneRedundantDerivedCardStateConfig(config)
  return prunedAttachmentStorage || prunedCardState
}

export function getSelectedProviderRef(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
): ProviderRef | null {
  if (
    (capability === 'auth.visibility' && config.plugins?.['auth.visibility']?.provider === 'none')
    || (capability === 'webhook.delivery' && config.plugins?.['webhook.delivery']?.provider === 'none')
    || (capability === 'callback.runtime' && config.plugins?.['callback.runtime']?.provider === 'none')
  ) {
    return null
  }

  switch (capability) {
    case 'card.storage':
      return normalizeStorageCapabilities(config)['card.storage']
    case 'config.storage': {
      const selected = normalizeConfigStorageSelection(config)
      return selected.configured ?? selected.effective
    }
    case 'attachment.storage':
      return normalizeStorageCapabilities(config)['attachment.storage']
    case 'card.state':
      return normalizeCardStateCapabilities(config)['card.state']
    case 'auth.identity':
      return normalizeAuthCapabilities(config)['auth.identity']
    case 'auth.policy':
      return normalizeAuthCapabilities(config)['auth.policy']
    case 'auth.visibility': {
      const selected = normalizeAuthCapabilities(config)['auth.visibility']
      return selected.provider === 'none' ? null : selected
    }
    case 'webhook.delivery':
      return normalizeWebhookCapabilities(config)['webhook.delivery']
    case 'callback.runtime': {
      const selected = normalizeCallbackCapabilities(config)['callback.runtime']
      return selected.provider === 'none' ? null : selected
    }
    case 'cron.runtime': {
      const selected = normalizeCronCapabilities(config)['cron.runtime']
      return selected.provider === 'none' ? null : selected
    }
  }
}

export function getPersistedPluginProviderOptions(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
  providerId: string,
): Record<string, unknown> | undefined {
  const selectedRef = getSelectedProviderRef(config, capability)
  if (selectedRef?.provider === providerId && isRecord(selectedRef.options)) {
    return structuredClone(selectedRef.options)
  }

  return undefined
}


export * from './plugin-settings/redaction'

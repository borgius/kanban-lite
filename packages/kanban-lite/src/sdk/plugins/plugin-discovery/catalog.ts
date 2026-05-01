import * as fs from 'node:fs'
import * as path from 'path'
import type {
  PluginSettingsCapabilityRow,
  PluginSettingsDiscoverySource,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsPayload,
  PluginSettingsProviderRow,
  PluginSettingsReadPayload,
  PluginSettingsRedactionPolicy,
  PluginSettingsSelectedState,
} from '../../../shared/types'
import {
  normalizeCronCapabilities,
  PLUGIN_CAPABILITY_NAMESPACES,
  normalizeCallbackCapabilities,
  normalizeAuthCapabilities,
  normalizeCardStateCapabilities,
  normalizeStorageCapabilities,
  normalizeWebhookCapabilities,
} from '../../../shared/config'
import type {
  KanbanConfig,
  KLPluginPackageManifest,
  PluginCapabilityNamespace,
  ProviderRef,
} from '../../../shared/config'
import type { KanbanSDK } from '../../KanbanSDK'
import {
  cloneProviderRef,
  createRedactedProviderOptions,
  ensurePluginSettingsOptionsRecord,
  getPersistedPluginProviderOptions,
  getPluginSchemaDefaultOptions,
  getMutablePluginsRecord,
  getSelectedProviderRef,
  mergeProviderOptionsUpdate,
  normalizePluginSettingsProviderOptionsForPersistence,
  normalizeProviderIdForComparison,
  PluginSettingsStoreError,
  pruneRedundantDerivedStorageConfig,
  readPluginSettingsConfigDocument,
  resolvePluginSettingsOptionsSchema,
  writePluginSettingsConfigDocument,
} from '../plugin-settings'
export type {
  PluginSettingsOptionsSchemaValueResolver,
  PluginSettingsOptionsSchemaInput,
  PluginSettingsOptionsSchemaFactory,
} from '../plugin-settings'
import { WORKSPACE_ROOT, tryResolveExternalModuleWithSource } from '../plugin-loader'
import type { ResolvedExternalModule, ExternalPluginDiscoverySource } from '../plugin-loader'
import {
  BUILTIN_CARD_PLUGINS,
  BUILTIN_ATTACHMENT_IDS,
  PROVIDER_ALIASES,
  isValidCardStoragePluginCandidate,
  isValidAttachmentStoragePluginCandidate,
} from '../storage-plugins'
import {
  AUTH_PROVIDER_ALIASES,
  AUTH_POLICY_PROVIDER_ALIASES,
  BUILTIN_AUTH_PROVIDER_IDS,
  isValidAuthIdentityPlugin,
  isValidAuthPolicyPlugin,
  isValidAuthVisibilityPlugin,
  selectAuthVisibilityPlugin,
} from '../auth-plugins'
import type { AuthPluginModule } from '../auth-plugins'
import {
  BUILTIN_CARD_STATE_PROVIDER_IDS,
  CARD_STATE_PROVIDER_ALIASES,
  isValidCardStateProviderCandidate,
  isValidCardStateProvider,
} from '../card-state-plugins'
import type { CardStateModuleContext } from '../card-state-plugins'
import {
  CRON_PROVIDER_ALIASES,
} from '../cron-plugins'
import {
  WEBHOOK_PROVIDER_ALIASES,
  CALLBACK_PROVIDER_ALIASES,
  isValidSDKEventListenerPlugin,
  isSDKEventListenerPluginConstructor,
} from '../webhook-callback-plugins'
import type { WebhookProviderPlugin } from '../webhook-callback-plugins'
import {
  resolveDiscoveredConfigStorageProvider,
  isValidConfigStorageProviderCandidate,
} from '../config-storage-plugins'
import type { ConfigStorageProviderModule } from '../config-storage-plugins'

import {
  addDiscoveredProvider,
  collectNodeModulePackageRequests,
  collectSiblingPackageRequests,
  collectWorkspacePackageRequests,
  getProviderOptionsSchemaCandidate,
  getGlobalNodeModulesDir,
  inspectExternalPluginModule,
  isBuiltinProviderForCapability,
  isLikelyPluginPackageRequest,
  isPluginSettingsCapabilityDisabled,
  isRecord,
  isValidPluginPackageManifest,
  DISCOVERY_SOURCE_PRIORITY,
  registerBuiltinPluginProviders,
  resolveExternalPackageName,
  type PluginSettingsConfigSnapshot,
  type DiscoveredPluginProvider,
  type PluginSettingsProviderReadModel,
} from './helpers'

function collectPluginSettingsPackageRequests(config: PluginSettingsConfigSnapshot): string[] {
  const requests = new Set<string>()
  const add = (request: string | undefined): void => {
    if (request) requests.add(request)
  }
  const addFromBroadScan = (request: string | undefined): void => {
    if (request && isLikelyPluginPackageRequest(request)) requests.add(request)
  }

  for (const request of collectWorkspacePackageRequests()) addFromBroadScan(request)
  for (const request of collectNodeModulePackageRequests(path.join(process.cwd(), 'node_modules'))) addFromBroadScan(request)
  if (WORKSPACE_ROOT && WORKSPACE_ROOT !== process.cwd()) {
    for (const request of collectNodeModulePackageRequests(path.join(WORKSPACE_ROOT, 'node_modules'))) addFromBroadScan(request)
  }
  for (const request of collectNodeModulePackageRequests(getGlobalNodeModulesDir())) addFromBroadScan(request)
  for (const request of collectSiblingPackageRequests()) addFromBroadScan(request)

  for (const request of PROVIDER_ALIASES.values()) add(request)
  for (const request of CARD_STATE_PROVIDER_ALIASES.values()) add(request)
  for (const request of AUTH_PROVIDER_ALIASES.values()) add(request)
  for (const request of AUTH_POLICY_PROVIDER_ALIASES.values()) add(request)
  for (const request of WEBHOOK_PROVIDER_ALIASES.values()) add(request)
  for (const request of CALLBACK_PROVIDER_ALIASES.values()) add(request)
  for (const request of CRON_PROVIDER_ALIASES.values()) add(request)

  for (const capability of PLUGIN_CAPABILITY_NAMESPACES) {
    const providerRef = config.plugins?.[capability]
    if (providerRef && providerRef.provider !== 'none' && !isBuiltinProviderForCapability(capability, providerRef.provider)) {
      add(resolveExternalPackageName(capability, providerRef.provider))
    }
  }

  if (config.storageEngine !== undefined) {
    add(resolveExternalPackageName('card.storage', normalizeStorageCapabilities(config)['card.storage'].provider))
  }
  if (config.auth?.['auth.identity']) {
    add(resolveExternalPackageName('auth.identity', config.auth['auth.identity'].provider))
  }
  if (config.auth?.['auth.policy']) {
    add(resolveExternalPackageName('auth.policy', config.auth['auth.policy'].provider))
  }
  if (config.auth?.['auth.visibility'] && config.auth['auth.visibility'].provider !== 'none') {
    add(resolveExternalPackageName('auth.visibility', config.auth['auth.visibility'].provider))
  }
  if (config.webhookPlugin?.['webhook.delivery']) {
    add(resolveExternalPackageName('webhook.delivery', config.webhookPlugin['webhook.delivery'].provider))
  }

  return [...requests]
}

async function buildPluginSettingsInventoryCatalog(
  workspaceRoot: string,
  config: PluginSettingsConfigSnapshot,
  sdk: KanbanSDK,
): Promise<Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>> {
  const inventory = new Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>()
  registerBuiltinPluginProviders(inventory)

  for (const request of collectPluginSettingsPackageRequests(config)) {
    const resolved = tryResolveExternalModuleWithSource(request)
    if (!resolved) continue
    try {
      for (const provider of await inspectExternalPluginModule(request, resolved, sdk)) {
        addDiscoveredProvider(inventory, provider)
      }
    } catch {
      continue
    }
  }

  return inventory
}

function getDiscoveredPluginSettingsProvider(
  inventory: Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>,
  capability: PluginCapabilityNamespace,
  providerId: string,
): DiscoveredPluginProvider {
  const normalizedProviderId = normalizeProviderIdForComparison(capability, providerId)
  if (normalizedProviderId !== providerId) {
    const normalizedProvider = inventory.get(capability)?.get(normalizedProviderId)
    if (normalizedProvider) {
      return { ...normalizedProvider, providerId: normalizedProviderId }
    }
  }

  const provider = inventory.get(capability)?.get(providerId)
  if (provider) return provider

  const aliasedPackage = resolveExternalPackageName(capability, providerId)
  if (aliasedPackage !== providerId) {
    const byCapability = inventory.get(capability)
    if (byCapability) {
      for (const candidate of byCapability.values()) {
        if (candidate.packageName === aliasedPackage) {
          return { ...candidate, providerId }
        }
      }
    }
  }

  throw new PluginSettingsStoreError(
    'plugin-settings-provider-not-found',
    'The requested plugin provider is not available for this capability.',
    { capability, providerId },
  )
}

function getCapabilitySelectedState(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
  sdk: KanbanSDK,
): PluginSettingsSelectedState {
  if (isPluginSettingsCapabilityDisabled(config, capability)) {
    return {
      capability,
      providerId: null,
      source: 'none',
    }
  }
  switch (capability) {
    case 'card.storage': {
      const selected = normalizeStorageCapabilities(config)['card.storage']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['card.storage']
          ? 'config'
          : config.storageEngine !== undefined
            ? 'legacy'
            : 'default',
      }
    }
    case 'config.storage': {
      const selected = sdk.resolveConfigStorageStatus(config)
      return {
        capability,
        providerId: selected.effective?.provider ?? null,
        source: config.plugins?.['config.storage']
          ? 'config'
          : config.storageEngine !== undefined && selected.mode === 'derived'
            ? 'legacy'
            : 'default',
        resolution: selected,
      }
    }
    case 'attachment.storage': {
      const selected = normalizeStorageCapabilities(config)['attachment.storage']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['attachment.storage'] ? 'config' : 'default',
      }
    }
    case 'card.state': {
      const selected = normalizeCardStateCapabilities(config)['card.state']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['card.state'] ? 'config' : 'default',
      }
    }
    case 'auth.identity': {
      const selected = normalizeAuthCapabilities(config)['auth.identity']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['auth.identity']
          ? 'config'
          : config.auth?.['auth.identity']
            ? 'legacy'
            : 'default',
      }
    }
    case 'auth.policy': {
      const selected = normalizeAuthCapabilities(config)['auth.policy']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['auth.policy']
          ? 'config'
          : config.auth?.['auth.policy']
            ? 'legacy'
            : 'default',
      }
    }
    case 'auth.visibility': {
      const selected = normalizeAuthCapabilities(config)['auth.visibility']
      return {
        capability,
        providerId: selected.provider === 'none' ? null : selected.provider,
        source: config.plugins?.['auth.visibility']
          ? selected.provider === 'none'
            ? 'none'
            : 'config'
          : config.auth?.['auth.visibility']
            ? 'legacy'
            : 'default',
      }
    }
    case 'webhook.delivery': {
      const selected = normalizeWebhookCapabilities(config)['webhook.delivery']
      return {
        capability,
        providerId: selected.provider,
        source: config.plugins?.['webhook.delivery']
          ? 'config'
          : config.webhookPlugin?.['webhook.delivery']
            ? 'legacy'
            : 'default',
      }
    }
    case 'callback.runtime': {
      const selected = normalizeCallbackCapabilities(config)['callback.runtime']
      return {
        capability,
        providerId: selected.provider === 'none' ? null : selected.provider,
        source: config.plugins?.['callback.runtime']
          ? selected.provider === 'none'
            ? 'none'
            : 'config'
          : 'default',
      }
    }
    case 'cron.runtime': {
      const selected = normalizeCronCapabilities(config)['cron.runtime']
      return {
        capability,
        providerId: selected.provider === 'none' ? null : selected.provider,
        source: config.plugins?.['cron.runtime']
          ? selected.provider === 'none'
            ? 'none'
            : 'config'
          : 'default',
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exported discovery and settings functions
// ---------------------------------------------------------------------------

export async function discoverPluginSettingsInventory(
  workspaceRoot: string,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsPayload> {
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  if (pruneRedundantDerivedStorageConfig(config)) {
    try {
      writePluginSettingsConfigDocument(workspaceRoot, config)
    } catch {
      // Best-effort cleanup; do not fail the read when the configured
      // config.storage provider is unavailable (e.g. plugin not installed).
    }
  }
  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)

  const capabilities: PluginSettingsCapabilityRow[] = PLUGIN_CAPABILITY_NAMESPACES.map((capability) => {
    const selected = getCapabilitySelectedState(config, capability, sdk)
    const providers = [...(inventory.get(capability)?.values() ?? [])]
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
      .map<PluginSettingsProviderRow>((provider) => ({
        capability,
        providerId: provider.providerId,
        packageName: provider.packageName,
        discoverySource: provider.discoverySource,
        isSelected: provider.providerId === selected.providerId,
        ...(provider.optionsSchema ? { optionsSchema: provider.optionsSchema } : {}),
      }))
    return { capability, selected, providers }
  })

  return { capabilities, redaction }
}

export async function readPluginSettingsProvider(
  workspaceRoot: string,
  capability: PluginCapabilityNamespace,
  providerId: string,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsProviderReadModel | null> {
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  if (pruneRedundantDerivedStorageConfig(config)) {
    try {
      writePluginSettingsConfigDocument(workspaceRoot, config)
    } catch {
      // Best-effort cleanup
    }
  }
  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)
  let provider = inventory.get(capability)?.get(providerId) ?? null

  if (!provider) {
    const aliasedPackage = resolveExternalPackageName(capability, providerId)
    if (aliasedPackage !== providerId) {
      const byCapability = inventory.get(capability)
      if (byCapability) {
        for (const candidate of byCapability.values()) {
          if (candidate.packageName === aliasedPackage) {
            provider = { ...candidate, providerId }
            break
          }
        }
      }
    }
  }

  if (!provider) return null

  const selected = getCapabilitySelectedState(config, capability, sdk)
  const options = createRedactedProviderOptions(
    getPersistedPluginProviderOptions(config, capability, providerId),
    provider.optionsSchema,
    redaction,
  )

  return {
    capability,
    providerId,
    packageName: provider.packageName,
    discoverySource: provider.discoverySource,
    ...(provider.optionsSchema ? { optionsSchema: provider.optionsSchema } : {}),
    selected,
    options,
  }
}

export async function persistPluginSettingsProviderSelection(
  workspaceRoot: string,
  capability: PluginCapabilityNamespace,
  providerId: string,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsProviderReadModel | null> {
  const normalizedProviderId = normalizeProviderIdForComparison(capability, providerId)
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  pruneRedundantDerivedStorageConfig(config)
  const configuredRef = config.plugins?.[capability]
    ? cloneProviderRef(config.plugins[capability] as ProviderRef)
    : null

  if ((capability === 'auth.visibility' || capability === 'webhook.delivery' || capability === 'callback.runtime') && providerId === 'none') {
    getMutablePluginsRecord(config)[capability] = configuredRef?.options !== undefined
      ? { provider: 'none', options: structuredClone(configuredRef.options) }
      : { provider: 'none' }
    writePluginSettingsConfigDocument(workspaceRoot, config)
    return null
  }

  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)
  const provider = getDiscoveredPluginSettingsProvider(inventory, capability, normalizedProviderId)
  const currentTargetOptions = getPersistedPluginProviderOptions(config, capability, normalizedProviderId)

  const selectedRef = getSelectedProviderRef(config, capability)
  const selectedTargetOptions = selectedRef?.provider === normalizedProviderId && isRecord(selectedRef.options)
    ? structuredClone(selectedRef.options)
    : undefined
  const nextOptions = selectedTargetOptions
    ?? (configuredRef?.provider === 'none' && isRecord(configuredRef.options)
      ? structuredClone(configuredRef.options)
      : undefined)
    ?? getPluginSchemaDefaultOptions(
      isRecord(provider.optionsSchema?.schema)
        ? provider.optionsSchema.schema
        : undefined,
    )
  const persistedOptions = nextOptions !== undefined
    ? normalizePluginSettingsProviderOptionsForPersistence(capability, currentTargetOptions, nextOptions)
    : undefined
  const nextRef = {
    provider: normalizedProviderId,
    ...(persistedOptions !== undefined ? { options: persistedOptions } : {}),
  }

  // Run beforeSave when moving to a new provider (activating it).
  const isActivating = !selectedRef || selectedRef.provider !== normalizedProviderId || selectedRef.provider === 'none'
  if (isActivating && provider.optionsSchema?.beforeSave) {
    try {
      await provider.optionsSchema.beforeSave(persistedOptions ?? {}, { capability, providerId: normalizedProviderId, sdk, isActivating })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plugin options validation failed before save.'
      throw new PluginSettingsStoreError('plugin-settings-before-save-rejected', message, { capability, providerId: normalizedProviderId })
    }
  }

  getMutablePluginsRecord(config)[capability] = nextRef
  pruneRedundantDerivedStorageConfig(config)
  writePluginSettingsConfigDocument(workspaceRoot, config)

  const nextProvider = await readPluginSettingsProvider(workspaceRoot, capability, normalizedProviderId, redaction, sdk)
  if (nextProvider) return nextProvider

  throw new PluginSettingsStoreError(
    'plugin-settings-provider-not-found',
    'The requested plugin provider is not available for this capability.',
    { capability, providerId: normalizedProviderId },
  )
}

export async function persistPluginSettingsProviderOptions(
  workspaceRoot: string,
  capability: PluginCapabilityNamespace,
  providerId: string,
  options: unknown,
  redaction: PluginSettingsRedactionPolicy,
  sdk: KanbanSDK,
): Promise<PluginSettingsProviderReadModel> {
  const normalizedProviderId = normalizeProviderIdForComparison(capability, providerId)
  const config = readPluginSettingsConfigDocument(workspaceRoot)
  pruneRedundantDerivedStorageConfig(config)
  const inventory = await buildPluginSettingsInventoryCatalog(workspaceRoot, config, sdk)
  const provider = getDiscoveredPluginSettingsProvider(inventory, capability, normalizedProviderId)
  const nextOptions = ensurePluginSettingsOptionsRecord(options, capability, providerId)
  const selectedRef = getSelectedProviderRef(config, capability)
  const currentOptions = getPersistedPluginProviderOptions(config, capability, normalizedProviderId)
  const secretPaths = provider.optionsSchema?.secrets.map((secret) => secret.path) ?? []
  const mergedOptions = mergeProviderOptionsUpdate(currentOptions, nextOptions, '', secretPaths, redaction)
  const persistedOptions = normalizePluginSettingsProviderOptionsForPersistence(
    capability,
    currentOptions,
    isRecord(mergedOptions) ? mergedOptions : {},
  )

  if (selectedRef?.provider === normalizedProviderId) {
    // Provider is already active; run beforeSave with isActivating=false before persisting.
    if (provider.optionsSchema?.beforeSave) {
      try {
        await provider.optionsSchema.beforeSave(isRecord(mergedOptions) ? mergedOptions : {}, { capability, providerId: normalizedProviderId, sdk, isActivating: false })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Plugin options validation failed before save.'
        throw new PluginSettingsStoreError('plugin-settings-before-save-rejected', message, { capability, providerId: normalizedProviderId })
      }
    }

    getMutablePluginsRecord(config)[capability] = {
      provider: normalizedProviderId,
      options: persistedOptions,
    }
    pruneRedundantDerivedStorageConfig(config)
    writePluginSettingsConfigDocument(workspaceRoot, config)

    const nextProvider = await readPluginSettingsProvider(workspaceRoot, capability, normalizedProviderId, redaction, sdk)
    if (nextProvider) return nextProvider

    throw new PluginSettingsStoreError(
      'plugin-settings-provider-not-found',
      'The requested plugin provider is not available for this capability.',
      { capability, providerId: normalizedProviderId },
    )
  }

  // Inactive provider: save options and switch the capability to this provider.
  // This matches the UI intent ("Save to persist these options and switch this capability to the provider").
  if (provider.optionsSchema?.beforeSave) {
    try {
      await provider.optionsSchema.beforeSave(isRecord(mergedOptions) ? mergedOptions : {}, { capability, providerId: normalizedProviderId, sdk, isActivating: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plugin options validation failed before save.'
      throw new PluginSettingsStoreError('plugin-settings-before-save-rejected', message, { capability, providerId: normalizedProviderId })
    }
  }

  getMutablePluginsRecord(config)[capability] = {
    provider: normalizedProviderId,
    options: persistedOptions,
  }
  pruneRedundantDerivedStorageConfig(config)
  writePluginSettingsConfigDocument(workspaceRoot, config)

  const nextProvider = await readPluginSettingsProvider(workspaceRoot, capability, normalizedProviderId, redaction, sdk)
  if (nextProvider) return nextProvider

  throw new PluginSettingsStoreError(
    'plugin-settings-provider-not-found',
    'The requested plugin provider is not available for this capability.',
    { capability, providerId: normalizedProviderId },
  )
}



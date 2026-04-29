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

// ---------------------------------------------------------------------------
// Private types
// ---------------------------------------------------------------------------

export type PluginSettingsConfigSnapshot = Pick<
  KanbanConfig,
  'auth' | 'plugins' | 'sqlitePath' | 'storageEngine' | 'webhookPlugin'
>

export type PluginSettingsProviderReadModel = PluginSettingsReadPayload & Pick<
  PluginSettingsProviderRow,
  'packageName' | 'discoverySource' | 'optionsSchema'
>


export const DISCOVERY_SOURCE_PRIORITY: Record<PluginSettingsDiscoverySource, number> = {
  builtin: 5,
  workspace: 4,
  dependency: 3,
  global: 2,
  sibling: 1,
}

export interface DiscoveredPluginProvider {
  capability: PluginCapabilityNamespace
  providerId: string
  packageName: string
  discoverySource: PluginSettingsDiscoverySource
  optionsSchema?: PluginSettingsOptionsSchemaMetadata
}

type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord
export function isRecord<T extends object>(value: unknown): value is T & UnknownRecord
export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Package scanning helpers
// ---------------------------------------------------------------------------

export function collectNodeModulePackageRequests(nodeModulesDir: string): string[] {
  if (!fs.existsSync(nodeModulesDir)) return []
  const requests = new Set<string>()
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name)
      for (const scopedEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          requests.add(`${entry.name}/${scopedEntry.name}`)
        }
      }
      continue
    }
    requests.add(entry.name)
  }
  return [...requests]
}

export function collectWorkspacePackageRequests(): string[] {
  if (!WORKSPACE_ROOT) return []
  const packagesDir = path.join(WORKSPACE_ROOT, 'packages')
  if (!fs.existsSync(packagesDir)) return []
  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

export function collectSiblingPackageRequests(): string[] {
  const parentDir = path.resolve(process.cwd(), '..')
  if (!fs.existsSync(parentDir)) return []
  const currentDirName = path.basename(process.cwd())
  return fs.readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== currentDirName)
    .filter((entry) => fs.existsSync(path.join(parentDir, entry.name, 'package.json')))
    .map((entry) => entry.name)
}

export function getGlobalNodeModulesDir(): string {
  const npmPrefix = path.resolve(process.execPath, '..', '..')
  return process.platform === 'win32'
    ? path.join(npmPrefix, 'node_modules')
    : path.join(npmPrefix, 'lib', 'node_modules')
}

export function isBuiltinProviderForCapability(capability: PluginCapabilityNamespace, providerId: string): boolean {
  const normalizedProviderId = (() => {
    if (capability === 'card.storage' && providerId === 'markdown') return 'localfs'
    if (capability === 'config.storage' && providerId === 'markdown') return 'localfs'
    if (capability === 'card.state' && providerId === 'builtin') return 'localfs'
    return providerId
  })()
  switch (capability) {
    case 'card.storage': return BUILTIN_CARD_PLUGINS.has(normalizedProviderId)
    case 'config.storage': return normalizedProviderId === 'localfs'
    case 'attachment.storage': return BUILTIN_ATTACHMENT_IDS.has(normalizedProviderId)
    case 'card.state': return BUILTIN_CARD_STATE_PROVIDER_IDS.has(normalizedProviderId)
    case 'auth.identity':
    case 'auth.policy': return BUILTIN_AUTH_PROVIDER_IDS.has(normalizedProviderId)
    case 'auth.visibility': return normalizedProviderId === 'none'
    case 'webhook.delivery':
    case 'callback.runtime': return false
  }
}

export function resolveExternalPackageName(capability: PluginCapabilityNamespace, providerId: string): string {
  switch (capability) {
    case 'card.storage':
    case 'config.storage':
    case 'attachment.storage': return PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'card.state': return CARD_STATE_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'auth.identity': return AUTH_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'auth.policy': return AUTH_POLICY_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'auth.visibility': return AUTH_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'webhook.delivery': return WEBHOOK_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'callback.runtime': return CALLBACK_PROVIDER_ALIASES.get(providerId) ?? providerId
    case 'cron.runtime': return CRON_PROVIDER_ALIASES.get(providerId) ?? providerId
  }
}

export function isPluginSettingsCapabilityDisabled(
  config: PluginSettingsConfigSnapshot,
  capability: PluginCapabilityNamespace,
): boolean {
  return (
    (capability === 'auth.visibility' && config.plugins?.['auth.visibility']?.provider === 'none')
    || (capability === 'webhook.delivery' && config.plugins?.['webhook.delivery']?.provider === 'none')
    || (capability === 'callback.runtime' && config.plugins?.['callback.runtime']?.provider === 'none')
    || (capability === 'cron.runtime' && config.plugins?.['cron.runtime']?.provider === 'none')
  )
}

export function isLikelyPluginPackageRequest(request: string): boolean {
  return /(^|\/|-)plugin(?:-|$)/i.test(request)
}

export function isValidPluginPackageManifest(value: unknown): value is KLPluginPackageManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as KLPluginPackageManifest
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (!candidate.capabilities || typeof candidate.capabilities !== 'object') return false
  for (const [, providerIds] of Object.entries(candidate.capabilities)) {
    if (!Array.isArray(providerIds)) return false
    if (!providerIds.every((id: unknown) => typeof id === 'string')) return false
  }
  if (candidate.integrations !== undefined) {
    if (!Array.isArray(candidate.integrations)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Options schema candidate helper
// ---------------------------------------------------------------------------

export async function getProviderOptionsSchemaCandidate(
  mod: Record<string, unknown>,
  providerId: string,
  directCandidate: unknown,
  sdk: KanbanSDK,
): Promise<PluginSettingsOptionsSchemaMetadata | undefined> {
  if (isRecord(directCandidate) && typeof directCandidate.optionsSchema === 'function') {
    return resolvePluginSettingsOptionsSchema(directCandidate.optionsSchema(sdk), sdk)
  }

  const mappedOptionsSchemas = mod.optionsSchemas
  if (isRecord(mappedOptionsSchemas)) {
    const mappedValue = mappedOptionsSchemas[providerId]
    if (typeof mappedValue === 'function') {
      return resolvePluginSettingsOptionsSchema(mappedValue(sdk), sdk)
    }
    const normalized = await resolvePluginSettingsOptionsSchema(mappedValue, sdk)
    if (normalized) return normalized
  }

  if (typeof mod.optionsSchema === 'function') {
    return resolvePluginSettingsOptionsSchema(mod.optionsSchema(sdk), sdk)
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Inventory catalog building
// ---------------------------------------------------------------------------

export function addDiscoveredProvider(
  inventory: Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>,
  provider: DiscoveredPluginProvider,
): void {
  const byCapability = inventory.get(provider.capability) ?? new Map<string, DiscoveredPluginProvider>()
  inventory.set(provider.capability, byCapability)

  const existing = byCapability.get(provider.providerId)
  if (existing && DISCOVERY_SOURCE_PRIORITY[existing.discoverySource] >= DISCOVERY_SOURCE_PRIORITY[provider.discoverySource]) {
    return
  }

  byCapability.set(provider.providerId, provider)
}

export function registerBuiltinPluginProviders(
  inventory: Map<PluginCapabilityNamespace, Map<string, DiscoveredPluginProvider>>,
): void {
  addDiscoveredProvider(inventory, { capability: 'card.storage', providerId: 'localfs', packageName: 'localfs', discoverySource: 'builtin' })
  addDiscoveredProvider(inventory, { capability: 'attachment.storage', providerId: 'localfs', packageName: 'localfs', discoverySource: 'builtin' })
  addDiscoveredProvider(inventory, { capability: 'config.storage', providerId: 'localfs', packageName: 'localfs', discoverySource: 'builtin' })
  addDiscoveredProvider(inventory, { capability: 'card.state', providerId: 'localfs', packageName: 'localfs', discoverySource: 'builtin' })
  addDiscoveredProvider(inventory, { capability: 'auth.identity', providerId: 'noop', packageName: 'noop', discoverySource: 'builtin' })
  addDiscoveredProvider(inventory, { capability: 'auth.policy', providerId: 'noop', packageName: 'noop', discoverySource: 'builtin' })
}

export async function inspectExternalPluginModule(
  request: string,
  resolved: ResolvedExternalModule,
  sdk: KanbanSDK,
): Promise<DiscoveredPluginProvider[]> {
  const mod = resolved.module as Record<string, unknown>
  const discovered: DiscoveredPluginProvider[] = []
  const add = (provider: DiscoveredPluginProvider): void => { discovered.push(provider) }

  const manifest = mod.pluginManifest
  if (!isValidPluginPackageManifest(manifest)) return discovered

  const storageBackedAttachmentProviderIds = new Set(manifest.capabilities['card.storage'] ?? [])
  const storageBackedCardStateProviderIds = new Set(manifest.capabilities['card.storage'] ?? [])

  for (const [ns, providerIds] of Object.entries(manifest.capabilities)) {
    const capability = ns as PluginCapabilityNamespace
    for (const providerId of providerIds as readonly string[]) {
      switch (capability) {
        case 'card.storage': {
          const plugin = isValidCardStoragePluginCandidate(mod.cardStoragePlugin)
            ? mod.cardStoragePlugin
            : isValidCardStoragePluginCandidate(mod.default) ? mod.default : null
          if (plugin) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, plugin, sdk),
            })
          }
          break
        }
        case 'config.storage': {
          const plugin = resolveDiscoveredConfigStorageProvider(
            mod as ConfigStorageProviderModule,
            providerId,
            sdk,
          )
          if (plugin) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, plugin, sdk),
            })
          }
          break
        }
        case 'attachment.storage': {
          const shouldExposeOptionsSchema = !storageBackedAttachmentProviderIds.has(providerId)
          const plugin = isValidAttachmentStoragePluginCandidate(mod.attachmentStoragePlugin)
            ? mod.attachmentStoragePlugin
            : isValidAttachmentStoragePluginCandidate(mod.default) ? mod.default : null
          if (plugin) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              ...(shouldExposeOptionsSchema
                ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, plugin, sdk) }
                : {}),
            })
          }
          break
        }
        case 'auth.identity': {
          if (isRecord(mod.authIdentityPlugins)) {
            const candidate = mod.authIdentityPlugins[providerId]
            if (isValidAuthIdentityPlugin(candidate, providerId)) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk),
              })
            }
          }
          break
        }
        case 'auth.policy': {
          if (isRecord(mod.authPolicyPlugins)) {
            const candidate = mod.authPolicyPlugins[providerId]
            if (isValidAuthPolicyPlugin(candidate, providerId)) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk),
              })
            }
          }
          break
        }
        case 'auth.visibility': {
          const candidate = selectAuthVisibilityPlugin(mod as AuthPluginModule, providerId)
          if (candidate) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk),
            })
          }
          break
        }
        case 'webhook.delivery': {
          const directWebhookPlugin = isRecord(mod.webhookProviderPlugin) ? mod.webhookProviderPlugin : mod.default
          if (directWebhookPlugin && (directWebhookPlugin as WebhookProviderPlugin).manifest?.provides?.includes?.('webhook.delivery')) {
            const provider = directWebhookPlugin as WebhookProviderPlugin
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, provider, sdk),
            })
          }
          break
        }
        case 'callback.runtime': {
          const directListener = isValidSDKEventListenerPlugin(mod.callbackListenerPlugin)
            ? mod.callbackListenerPlugin
            : isSDKEventListenerPluginConstructor(mod.CallbackListenerPlugin)
              ? new (mod.CallbackListenerPlugin as new (workspaceRoot: string) => import('../../types').SDKEventListenerPlugin)(process.cwd())
              : isValidSDKEventListenerPlugin(mod.default)
                ? mod.default
                : null
          if (directListener) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, directListener, sdk),
            })
          }
          break
        }
        case 'cron.runtime': {
          const directListener = isValidSDKEventListenerPlugin(mod.cronListenerPlugin)
            ? mod.cronListenerPlugin
            : isSDKEventListenerPluginConstructor(mod.CronListenerPlugin)
              ? new (mod.CronListenerPlugin as new (workspaceRoot: string) => import('../../types').SDKEventListenerPlugin)(process.cwd())
              : isValidSDKEventListenerPlugin(mod.default)
                ? mod.default
                : null
          if (directListener) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, directListener, sdk),
            })
          }
          break
        }
        case 'card.state': {
          const shouldExposeOptionsSchema = !storageBackedCardStateProviderIds.has(providerId)
          if (isRecord(mod.cardStateProviders)) {
            const candidate = mod.cardStateProviders[providerId]
            if (isValidCardStateProvider(candidate, providerId)) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                ...(shouldExposeOptionsSchema
                  ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk) }
                  : {}),
              })
              break
            }
          }
          if (isValidCardStateProviderCandidate(mod.cardStateProvider)) {
            add({
              capability, providerId, packageName: request, discoverySource: resolved.source,
              ...(shouldExposeOptionsSchema
                ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, mod.cardStateProvider, sdk) }
                : {}),
            })
          } else if (typeof mod.createCardStateProvider === 'function') {
            const candidate = (mod.createCardStateProvider as (context: CardStateModuleContext) => unknown)({
              workspaceRoot: process.cwd(),
              kanbanDir: path.join(process.cwd(), '.kanban'),
              provider: request,
              backend: 'external',
            })
            if (isValidCardStateProviderCandidate(candidate)) {
              add({
                capability, providerId, packageName: request, discoverySource: resolved.source,
                ...(shouldExposeOptionsSchema
                  ? { optionsSchema: await getProviderOptionsSchemaCandidate(mod, providerId, candidate, sdk) }
                  : {}),
              })
            }
          }
          break
        }
      }
    }
  }
  return discovered
}


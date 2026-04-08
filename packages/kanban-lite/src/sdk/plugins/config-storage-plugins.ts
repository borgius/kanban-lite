import type { ProviderRef } from '../../shared/config'
import type { CloudflareWorkerProviderContext } from '../env'
import type { PluginSettingsOptionsSchemaFactory } from './plugin-settings'
import { loadExternalModule, getCloudflareWorkerProviderContext } from './plugin-loader'
import { getConfigRepositoryDocumentId } from '../configDocumentIdentity'
import {
  type ConfigRepositoryDocument,
  installConfigStorageProviderResolver,
} from '../modules/configRepository'
import { PROVIDER_ALIASES } from './storage-plugins'

// ---------------------------------------------------------------------------
// Config storage plugin contracts
// ---------------------------------------------------------------------------

/** Shared plugin manifest shape for `config.storage` capability providers. */
export interface ConfigStorageProviderManifest {
  readonly id: string
  readonly provides: readonly import('../../shared/config').ConfigStorageCapabilityNamespace[]
}

/** Shared runtime context passed to and exposed for `config.storage` providers. */
export interface ConfigStorageModuleContext {
  workspaceRoot: string
  documentId: string
  provider: string
  backend: 'builtin' | 'external'
  options?: Record<string, unknown>
  worker?: CloudflareWorkerProviderContext | null
}

/** Executable contract for first-class `config.storage` capability providers. */
export interface ConfigStorageProviderPlugin {
  readonly manifest: ConfigStorageProviderManifest
  optionsSchema?: PluginSettingsOptionsSchemaFactory
  readConfigDocument(): ConfigRepositoryDocument | null | undefined
  writeConfigDocument(document: ConfigRepositoryDocument): void
}

export interface ConfigStorageProviderModule {
  readonly configStorageProviders?: Record<string, unknown>
  readonly configStorageProvider?: unknown
  readonly createConfigStorageProvider?: ((context: ConfigStorageModuleContext) => unknown) | unknown
  readonly default?: unknown
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isValidConfigStorageProviderManifest(
  manifest: unknown,
  providerId?: string,
): manifest is ConfigStorageProviderManifest {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as ConfigStorageProviderManifest
  return typeof candidate.id === 'string'
    && (providerId === undefined || candidate.id === providerId)
    && Array.isArray(candidate.provides)
    && candidate.provides.includes('config.storage')
}

export function isValidConfigStorageProviderCandidate(
  plugin: unknown,
  providerId?: string,
): plugin is ConfigStorageProviderPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as ConfigStorageProviderPlugin
  return typeof candidate.readConfigDocument === 'function'
    && typeof candidate.writeConfigDocument === 'function'
    && isValidConfigStorageProviderManifest(candidate.manifest, providerId)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectConfigStorageProvider(
  mod: ConfigStorageProviderModule,
  providerId: string,
): ConfigStorageProviderPlugin | null {
  const mapped = mod.configStorageProviders?.[providerId]
  if (isValidConfigStorageProviderCandidate(mapped, providerId)) return mapped
  const direct = mod.configStorageProvider ?? mod.default
  if (isValidConfigStorageProviderCandidate(direct, providerId)) return direct
  return null
}

export function createConfigStorageModuleContext(
  ref: ProviderRef,
  workspaceRoot: string,
  documentId: string,
): ConfigStorageModuleContext {
  const context: ConfigStorageModuleContext = {
    workspaceRoot,
    documentId,
    provider: ref.provider,
    backend: ref.provider === 'localfs' ? 'builtin' : 'external',
  }
  if (ref.options) {
    context.options = structuredClone(ref.options)
  }
  const worker = getCloudflareWorkerProviderContext()
  if (worker) {
    context.worker = worker
  }
  return context
}

export function resolveDiscoveredConfigStorageProvider(
  mod: ConfigStorageProviderModule,
  providerId: string,
  sdk: import('../KanbanSDK').KanbanSDK,
): ConfigStorageProviderPlugin | null {
  const context = createConfigStorageModuleContext(
    { provider: providerId },
    sdk.workspaceRoot,
    getConfigRepositoryDocumentId(),
  )

  if (typeof mod.createConfigStorageProvider === 'function') {
    const created = mod.createConfigStorageProvider(context)
    if (isValidConfigStorageProviderCandidate(created, providerId)) {
      return created
    }
    return null
  }

  return selectConfigStorageProvider(mod, providerId)
}

// ---------------------------------------------------------------------------
// External plugin loader
// ---------------------------------------------------------------------------

function loadExternalConfigStorageProvider(
  packageName: string,
  providerId: string,
  context: ConfigStorageModuleContext,
): ConfigStorageProviderPlugin {
  const mod = loadExternalModule(packageName) as ConfigStorageProviderModule

  if (typeof mod.createConfigStorageProvider === 'function') {
    const created = mod.createConfigStorageProvider(context)
    if (isValidConfigStorageProviderCandidate(created, providerId)) {
      return created
    }
    throw new Error(
      `Plugin "${packageName}" exported createConfigStorageProvider(context) but it did not return a valid configStorageProvider.`,
    )
  }

  const provider = selectConfigStorageProvider(mod, providerId)
  if (!provider) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid configStorageProvider for "${providerId}". `
      + `Expected configStorageProviders["${providerId}"] or configStorageProvider/default export with `
      + `readConfigDocument, writeConfigDocument, and a manifest that provides 'config.storage'.`,
    )
  }

  return provider
}

// ---------------------------------------------------------------------------
// Provider resolver (entry point)
// ---------------------------------------------------------------------------

export function resolveConfigStorageProviderForRepository(
  ref: ProviderRef,
  workspaceRoot: string,
  documentId: string,
): { provider: ConfigStorageProviderPlugin; context: ConfigStorageModuleContext } {
  const normalizedRef = ref.provider === 'markdown'
    ? {
        provider: 'localfs',
        ...(ref.options !== undefined ? { options: structuredClone(ref.options) } : {}),
      }
    : {
        provider: ref.provider,
        ...(ref.options !== undefined ? { options: structuredClone(ref.options) } : {}),
      }

  const context = createConfigStorageModuleContext(normalizedRef, workspaceRoot, documentId)
  if (context.provider === 'localfs') {
    throw new Error('The built-in localfs config repository does not require an external config.storage provider.')
  }

  const packageName = PROVIDER_ALIASES.get(context.provider) ?? context.provider
  const provider = loadExternalConfigStorageProvider(packageName, context.provider, context)

  return {
    provider,
    context: {
      ...context,
      provider: provider.manifest.id,
    },
  }
}

// Wire the resolver into the configRepository module seam.
installConfigStorageProviderResolver(resolveConfigStorageProviderForRepository)

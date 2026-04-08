import * as path from 'path'
import type { Card } from '../../shared/types'
import type { CapabilityNamespace } from '../../shared/config'
import type { CloudflareWorkerProviderContext } from '../env'
import type { StorageEngine } from './types'
import { createLocalFsAttachmentPlugin } from './localfs'
import { MARKDOWN_PLUGIN } from './markdown'
import { loadExternalModule, getCloudflareWorkerProviderContext } from './plugin-loader'

// ---------------------------------------------------------------------------
// Plugin manifest (shared across card.storage and attachment.storage)
// ---------------------------------------------------------------------------

/**
 * Manifest describing what capability namespaces a plugin provides.
 */
export interface PluginManifest {
  readonly id: string
  readonly provides: readonly CapabilityNamespace[]
}

// ---------------------------------------------------------------------------
// Card storage plugin contract
// ---------------------------------------------------------------------------

/**
 * Built-in adapter interface for `card.storage` capability.
 */
export interface CardStoragePlugin {
  readonly manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  readonly nodeCapabilities?: {
    readonly isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}

// ---------------------------------------------------------------------------
// Attachment storage plugin contract
// ---------------------------------------------------------------------------

/**
 * Built-in adapter interface for `attachment.storage` capability.
 */
export interface AttachmentStoragePlugin {
  readonly manifest: PluginManifest
  getCardDir?(card: Card): string | null
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  writeAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<void>
  readAttachment?(card: Card, attachment: string): Promise<{ data: Uint8Array; contentType?: string } | null>
  appendAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}

interface CardStoragePluginModule {
  readonly cardStoragePlugin?: unknown
  readonly createCardStoragePlugin?: ((context: CloudflareWorkerProviderContext) => unknown) | unknown
  readonly default?: unknown
}

interface AttachmentStoragePluginModule {
  readonly attachmentStoragePlugin?: unknown
  readonly createAttachmentStoragePlugin?: ((context: CloudflareWorkerProviderContext) => unknown) | unknown
  readonly default?: unknown
}

// ---------------------------------------------------------------------------
// Provider aliases and built-in registries
// ---------------------------------------------------------------------------

/**
 * Maps short user-facing provider ids to their installable npm package names.
 */
export const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])

/** Registry of built-in card.storage plugins keyed by provider id. */
export const BUILTIN_CARD_PLUGINS: ReadonlyMap<string, CardStoragePlugin> = new Map([
  ['localfs', MARKDOWN_PLUGIN],
])

/** Set of provider ids that are handled as built-in attachment plugins. */
export const BUILTIN_ATTACHMENT_IDS: ReadonlySet<string> = new Set(['localfs'])

const BUILTIN_ATTACHMENT_PLUGINS: ReadonlyMap<string, (engine: StorageEngine) => AttachmentStoragePlugin> = new Map([
  ['localfs', createLocalFsAttachmentPlugin],
])

export const ENGINE_BOUND_ATTACHMENT_FACTORY_EXPORTS: ReadonlyMap<string, string> = new Map([
  ['mysql', 'createMysqlAttachmentPlugin'],
  ['postgresql', 'createPostgresqlAttachmentPlugin'],
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function canonicalizeEngineBoundAttachmentProviderId(providerId: string): string {
  for (const [canonicalProviderId, packageName] of PROVIDER_ALIASES) {
    if (providerId === canonicalProviderId || providerId === packageName) {
      return canonicalProviderId
    }
  }
  return providerId
}

function isValidPluginManifest(manifest: unknown, namespace: CapabilityNamespace): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as PluginManifest
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.provides)
    && candidate.provides.includes(namespace)
}

export function isValidCardStoragePluginCandidate(plugin: unknown): plugin is CardStoragePlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as CardStoragePlugin
  return typeof candidate.createEngine === 'function'
    && isValidPluginManifest(candidate.manifest, 'card.storage')
}

export function isValidAttachmentStoragePluginCandidate(plugin: unknown): plugin is AttachmentStoragePlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const candidate = plugin as AttachmentStoragePlugin
  return typeof candidate.copyAttachment === 'function'
    && (typeof candidate.getCardDir === 'function' || typeof candidate.materializeAttachment === 'function')
    && isValidPluginManifest(candidate.manifest, 'attachment.storage')
}

function normalizeAttachmentName(attachment: string): string | null {
  const normalized = attachment.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/')) return null
  if (path.basename(normalized) !== normalized) return null
  return normalized
}

export function materializeAttachmentFromDir(
  getCardDir: ((card: Card) => string | null | undefined) | undefined,
  card: Card,
  attachment: string,
): string | null {
  const safeAttachment = normalizeAttachmentName(attachment)
  if (!safeAttachment) return null
  if (!Array.isArray(card.attachments) || !card.attachments.includes(safeAttachment)) return null
  const cardDir = getCardDir?.(card)
  if (!cardDir) return null
  return path.join(cardDir, safeAttachment)
}

export function resolveBuiltinAttachmentPlugin(providerName: string, engine: StorageEngine): AttachmentStoragePlugin {
  const pluginFactory = BUILTIN_ATTACHMENT_PLUGINS.get(providerName)
  if (!pluginFactory) {
    throw new Error(`Unsupported built-in attachment storage provider "${providerName}".`)
  }
  return pluginFactory(engine)
}

// ---------------------------------------------------------------------------
// External plugin loaders
// ---------------------------------------------------------------------------

/**
 * Lazily loads an external npm card-storage plugin.
 *
 * @internal
 */
export function loadExternalCardPlugin(providerName: string): CardStoragePlugin {
  const mod = loadExternalModule(providerName) as CardStoragePluginModule
  const workerContext = getCloudflareWorkerProviderContext()

  if (workerContext && typeof mod.createCardStoragePlugin === 'function') {
    const created = mod.createCardStoragePlugin(workerContext)
    if (isValidCardStoragePluginCandidate(created)) {
      return created
    }
    throw new Error(
      `Plugin "${providerName}" exported createCardStoragePlugin(context) but it did not return a valid cardStoragePlugin.`,
    )
  }

  const plugin = (mod.cardStoragePlugin ?? mod.default) as CardStoragePlugin | undefined
  if (
    !plugin ||
    typeof plugin.createEngine !== 'function' ||
    !isValidPluginManifest(plugin.manifest, 'card.storage')
  ) {
    throw new Error(
      `Plugin "${providerName}" does not export a valid cardStoragePlugin. ` +
      `Expected a named export 'cardStoragePlugin' or default export with a ` +
      `'createEngine' method and a manifest that provides 'card.storage'.`
    )
  }
  return plugin
}

/**
 * Lazily loads an external npm attachment-storage plugin.
 *
 * @internal
 */
export function loadExternalAttachmentPlugin(
  providerName: string,
  activeCardStorage?: { providerId: string; engine: StorageEngine },
): AttachmentStoragePlugin {
  const mod = loadExternalModule(providerName) as AttachmentStoragePluginModule
  const workerContext = getCloudflareWorkerProviderContext()

  if (workerContext && typeof mod.createAttachmentStoragePlugin === 'function') {
    const created = mod.createAttachmentStoragePlugin(workerContext)
    if (isValidAttachmentStoragePluginCandidate(created)) {
      return created
    }
    throw new Error(
      `Plugin "${providerName}" exported createAttachmentStoragePlugin(context) but it did not return a valid attachmentStoragePlugin.`,
    )
  }

  const activeProviderId = activeCardStorage?.providerId
  const activeEngine = activeCardStorage?.engine
  const canonicalActiveProviderId = activeProviderId
    ? canonicalizeEngineBoundAttachmentProviderId(activeProviderId)
    : undefined
  const canonicalActiveEngineType = activeEngine
    ? canonicalizeEngineBoundAttachmentProviderId(activeEngine.type)
    : undefined
  if (canonicalActiveProviderId && activeEngine && canonicalActiveEngineType === canonicalActiveProviderId) {
    const engineFactoryExportName = ENGINE_BOUND_ATTACHMENT_FACTORY_EXPORTS.get(canonicalActiveProviderId)
    if (engineFactoryExportName) {
      const engineFactory = (mod as Record<string, unknown>)[engineFactoryExportName]
      if (typeof engineFactory === 'function') {
        const created = (engineFactory as (engine: StorageEngine) => unknown)(activeEngine)
        if (isValidAttachmentStoragePluginCandidate(created)) {
          return created
        }
        throw new Error(
          `Plugin "${providerName}" exported ${engineFactoryExportName}(engine) but it did not return a valid attachmentStoragePlugin.`,
        )
      }
    }
  }

  const plugin = (mod.attachmentStoragePlugin ?? mod.default) as AttachmentStoragePlugin | undefined
  if (
    !plugin ||
    typeof plugin.copyAttachment !== 'function' ||
    (typeof plugin.getCardDir !== 'function' && typeof plugin.materializeAttachment !== 'function') ||
    !isValidPluginManifest(plugin.manifest, 'attachment.storage')
  ) {
    throw new Error(
      `Plugin "${providerName}" does not export a valid attachmentStoragePlugin. ` +
      `Expected a named export 'attachmentStoragePlugin' or default export with ` +
      `'copyAttachment' plus either 'getCardDir' or 'materializeAttachment', and a manifest that provides ` +
      `'attachment.storage'.`
    )
  }
  return plugin
}

// ---------------------------------------------------------------------------
// Provider resolvers
// ---------------------------------------------------------------------------

export function resolveCardPlugin(ref: import('../../shared/config').ProviderRef): CardStoragePlugin {
  const builtin = BUILTIN_CARD_PLUGINS.get(ref.provider)
  if (builtin) return builtin
  const packageName = PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalCardPlugin(packageName)
}

export function resolveAttachmentPlugin(
  ref: import('../../shared/config').ProviderRef,
  activeCardStorage?: { providerId: string; engine: StorageEngine },
): AttachmentStoragePlugin {
  if (BUILTIN_ATTACHMENT_IDS.has(ref.provider)) {
    throw new Error(`Built-in attachment storage provider "${ref.provider}" requires an active storage engine.`)
  }
  const packageName = PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAttachmentPlugin(packageName, activeCardStorage)
}

export function shouldAttemptSamePluginAttachmentProvider(cardProvider: string, attachmentProvider: string): boolean {
  return attachmentProvider === 'localfs'
    && !BUILTIN_CARD_PLUGINS.has(cardProvider)
    && !BUILTIN_ATTACHMENT_IDS.has(cardProvider)
}

export function isRecoverableAttachmentPluginError(providerName: string, err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes(`Attachment storage plugin "${providerName}" is not installed`)
    || err.message.includes(`Plugin "${providerName}" does not export a valid attachmentStoragePlugin`)
}

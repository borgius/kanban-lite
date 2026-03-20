import * as path from 'path'
import { createRequire } from 'node:module'
import type { Card } from '../../shared/types'
import type { ResolvedCapabilities, CapabilityNamespace, ProviderRef, AuthCapabilityNamespace, ResolvedAuthCapabilities } from '../../shared/config'
import type { AuthContext, AuthDecision } from '../types'
import type { StorageEngine } from './types'
import { createLocalFsAttachmentPlugin } from './localfs'
import { MARKDOWN_PLUGIN } from './markdown'

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs')
)

// ---------------------------------------------------------------------------
// Auth plugin contracts and built-in noop implementations
// ---------------------------------------------------------------------------

/**
 * Resolved identity returned by {@link AuthIdentityPlugin.resolveIdentity}.
 */
export interface AuthIdentity {
  /** Opaque caller identifier (e.g., user ID or client ID). */
  subject: string
  /** Optional list of roles or permission scopes. */
  roles?: string[]
}

/** Plugin manifest scoped to auth capability namespaces. */
export interface AuthPluginManifest {
  readonly id: string
  readonly provides: readonly AuthCapabilityNamespace[]
}

/**
 * Contract for `auth.identity` capability providers.
 *
 * Resolves an auth context to a typed identity. The built-in `noop` provider
 * always returns `null` (anonymous), preserving the current open-access
 * behavior until a real provider is configured.
 *
 * Token-based identity is the intended future auth mode.
 */
export interface AuthIdentityPlugin {
  readonly manifest: AuthPluginManifest
  /**
   * Resolves an auth context to a caller identity, or `null` for
   * anonymous / invalid tokens.
   */
  resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>
}

/**
 * Contract for `auth.policy` capability providers.
 *
 * Determines whether a given identity may perform a named action. The
 * built-in `noop` provider always returns `{ allowed: true }` (allow-all),
 * preserving the current open-access behavior until a real provider is
 * configured.
 */
export interface AuthPolicyPlugin {
  readonly manifest: AuthPluginManifest
  /**
   * Returns an {@link AuthDecision} indicating whether `identity` is
   * authorized to perform `action` in the given `context`.
   */
  checkPolicy(identity: AuthIdentity | null, action: string, context: AuthContext): Promise<AuthDecision>
}

/** Built-in no-op identity provider. Always resolves to `null` (anonymous). */
export const NOOP_IDENTITY_PLUGIN: AuthIdentityPlugin = {
  manifest: { id: 'noop', provides: ['auth.identity'] },
  async resolveIdentity(_context: AuthContext): Promise<AuthIdentity | null> {
    return null
  },
}

/** Built-in no-op policy provider. Always returns `{ allowed: true }` (allow-all). */
export const NOOP_POLICY_PLUGIN: AuthPolicyPlugin = {
  manifest: { id: 'noop', provides: ['auth.policy'] },
  async checkPolicy(_identity: AuthIdentity | null, _action: string, _context: AuthContext): Promise<AuthDecision> {
    return { allowed: true }
  },
}

function resolveAuthIdentityPlugin(ref: ProviderRef): AuthIdentityPlugin {
  if (ref.provider === 'noop') return NOOP_IDENTITY_PLUGIN
  throw new Error(
    `Unknown auth.identity provider "${ref.provider}". ` +
    `Only "noop" is supported in this release.`
  )
}

function resolveAuthPolicyPlugin(ref: ProviderRef): AuthPolicyPlugin {
  if (ref.provider === 'noop') return NOOP_POLICY_PLUGIN
  throw new Error(
    `Unknown auth.policy provider "${ref.provider}". ` +
    `Only "noop" is supported in this release.`
  )
}

// ---------------------------------------------------------------------------
// Plugin manifest and capability interfaces
// ---------------------------------------------------------------------------

/**
 * Manifest describing what capability namespaces a plugin provides.
 */
export interface PluginManifest {
  readonly id: string
  readonly provides: readonly CapabilityNamespace[]
}

/**
 * Built-in adapter interface for `card.storage` capability.
 * Produces a {@link StorageEngine} instance from a kanban directory and optional options.
 */
export interface CardStoragePlugin {
  readonly manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  /** Optional node-host hints used by the extension/server/CLI for local file access and watching. */
  readonly nodeCapabilities?: {
    readonly isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}

/**
 * Built-in adapter interface for `attachment.storage` capability.
 *
 * Wraps file-copy and directory-resolution operations for card attachments.
 * T2 implementations delegate to the active card storage engine; T3+ may
 * extend this with node-only watch/materialization capabilities.
 */
export interface AttachmentStoragePlugin {
  readonly manifest: PluginManifest
  /** Returns the attachment directory for a card, or `null` if not determinable. */
  getCardDir?(card: Card): string | null
  /** Copies `sourcePath` into the attachment directory for `card`. */
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  /**
   * Appends `content` to an existing attachment when the provider can do so
   * efficiently in-place (for example, an object-storage API with native append).
   *
   * Returns `true` when the append was handled by the provider and `false`
   * when callers should fall back to read/modify/write via `copyAttachment`.
   */
  appendAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>
  /**
   * Resolves or materializes a local file path for a named attachment.
   * Returns `null` when the provider cannot expose a safe local file.
   */
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}

/**
 * Fully resolved capability bag produced by {@link resolveCapabilityBag}.
 *
 * Passed to the SDK so it no longer branches directly on storage type at call
 * sites; all storage routing is centralised in the plugin layer.
 */
export interface ResolvedCapabilityBag {
  /** Active card storage engine. */
  readonly cardStorage: StorageEngine
  /** Active attachment storage plugin. */
  readonly attachmentStorage: AttachmentStoragePlugin
  /**
   * Raw provider selections used to resolve this bag.
   * Useful for inspection/reporting (e.g. workspace status endpoints).
   */
  readonly providers: ResolvedCapabilities
  /**
   * Whether the active card storage provider stores cards as local files on
   * disk. `true` for markdown, `false` for SQLite and any remote provider.
   *
   * Host layers should check this before setting up file-change watchers or
   * attempting to open card files in a native editor.
   */
  readonly isFileBacked: boolean
  /**
   * Returns the local filesystem path for a card, or `null` if the provider
   * is not file-backed or the card has no associated file.
   *
   * Use this instead of reading `card.filePath` directly so that host code
   * remains forward-compatible with non-file-backed providers.
   */
  getLocalCardPath(card: Card): string | null
  /** Returns the local attachment directory for a card, or `null` when unavailable. */
  getAttachmentDir(card: Card): string | null
  /** Returns a safe local file path for a named attachment, or `null` when unavailable. */
  materializeAttachment(card: Card, attachment: string): Promise<string | null>
  /**
   * Returns the glob pattern (relative to the kanban directory) that host
   * file-watchers should use to observe card changes, or `null` when the
   * provider does not store cards as local files and therefore does not
   * require file-system watching.
   */
  getWatchGlob(): string | null
  /**
   * Resolved `auth.identity` plugin. Defaults to the built-in `noop` provider
   * (always returns `null` / anonymous) when no auth plugin is configured.
   */
  readonly authIdentity: AuthIdentityPlugin
  /**
   * Resolved `auth.policy` plugin. Defaults to the built-in `noop` provider
   * (always returns `true` / allow-all) when no auth plugin is configured.
   */
  readonly authPolicy: AuthPolicyPlugin
}

function isValidPluginManifest(manifest: unknown, namespace: CapabilityNamespace): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as PluginManifest
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.provides)
    && candidate.provides.includes(namespace)
}

// ---------------------------------------------------------------------------
// Built-in card storage plugins
// ---------------------------------------------------------------------------

/** Registry of built-in card.storage plugins keyed by provider id. */
const BUILTIN_CARD_PLUGINS: ReadonlyMap<string, CardStoragePlugin> = new Map([
  ['markdown', MARKDOWN_PLUGIN],
])

/**
 * Maps short user-facing provider ids to their installable npm package names.
 *
 * The ids `sqlite` and `mysql` are compatibility aliases that keep the familiar
 * user-visible provider id in `.kanban.json` while delegating implementation
 * ownership to standalone, versioned packages. When a provider id is listed
 * here and no built-in implementation is registered, the resolver loads the
 * mapped package name and issues install hints that reference it.
 *
 * Install targets:
 * - `sqlite` → `npm install kl-sqlite-storage`
 * - `mysql`  → `npm install kl-mysql-storage`
 *
 * Both packages must export `cardStoragePlugin` and `attachmentStoragePlugin`
 * with CJS entry `dist/index.cjs`.
 */
export const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-sqlite-storage'],
  ['mysql', 'kl-mysql-storage'],
])

// ---------------------------------------------------------------------------
// Built-in attachment storage plugins
// ---------------------------------------------------------------------------

/** Set of provider ids that are handled as built-in attachment plugins. */
export const BUILTIN_ATTACHMENT_IDS: ReadonlySet<string> = new Set(['localfs'])

const BUILTIN_ATTACHMENT_PLUGINS: ReadonlyMap<string, (engine: StorageEngine) => AttachmentStoragePlugin> = new Map([
  ['localfs', createLocalFsAttachmentPlugin],
])

function resolveBuiltinAttachmentPlugin(providerName: string, engine: StorageEngine): AttachmentStoragePlugin {
  const pluginFactory = BUILTIN_ATTACHMENT_PLUGINS.get(providerName)
  if (!pluginFactory) {
    throw new Error(`Unsupported built-in attachment storage provider "${providerName}".`)
  }
  return pluginFactory(engine)
}

function normalizeAttachmentName(attachment: string): string | null {
  const normalized = attachment.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/')) return null
  if (path.basename(normalized) !== normalized) return null
  return normalized
}

function materializeAttachmentFromDir(
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

// ---------------------------------------------------------------------------
// External plugin loaders
// ---------------------------------------------------------------------------

function isMissingRequestedModule(request: string, err: unknown): err is NodeJS.ErrnoException {
  return (err as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND'
    && typeof (err as Error)?.message === 'string'
    && (err as Error).message.includes(`'${request}'`)
}

function tryLoadSiblingPackage(request: string): unknown {
  const siblingPackagePath = path.resolve(process.cwd(), '..', request)
  return runtimeRequire(siblingPackagePath)
}

function loadExternalModule(request: string): unknown {
  try {
    return runtimeRequire(request)
  } catch (err: unknown) {
    if (!isMissingRequestedModule(request, err)) throw err

    try {
      return tryLoadSiblingPackage(request)
    } catch (siblingErr: unknown) {
      const siblingPackagePath = path.resolve(process.cwd(), '..', request)
      if (isMissingRequestedModule(siblingPackagePath, siblingErr)) {
        throw new Error(`Plugin package "${request}" is not installed. Run: npm install ${request}`)
      }
      throw siblingErr
    }
  }
}

/**
 * Lazily loads an external npm card-storage plugin.
 * Returns a deterministic, actionable error when the package is not installed
 * rather than letting Node throw a confusing MODULE_NOT_FOUND.
 *
 * @internal
 */
function loadExternalCardPlugin(providerName: string): CardStoragePlugin {
  const mod = loadExternalModule(providerName) as { default?: unknown; cardStoragePlugin?: unknown }

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
 * Returns a deterministic, actionable error when the package is not installed.
 *
 * @internal
 */
function loadExternalAttachmentPlugin(providerName: string): AttachmentStoragePlugin {
  const mod = loadExternalModule(providerName) as { default?: unknown; attachmentStoragePlugin?: unknown }

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

function shouldAttemptSamePluginAttachmentProvider(cardProvider: string, attachmentProvider: string): boolean {
  return attachmentProvider === 'localfs'
    && !BUILTIN_CARD_PLUGINS.has(cardProvider)
    && !BUILTIN_ATTACHMENT_IDS.has(cardProvider)
}

function isRecoverableAttachmentPluginError(providerName: string, err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes(`Attachment storage plugin "${providerName}" is not installed`)
    || err.message.includes(`Plugin "${providerName}" does not export a valid attachmentStoragePlugin`)
}

// ---------------------------------------------------------------------------
// Capability bag resolver (main entry point)
// ---------------------------------------------------------------------------

function resolveCardPlugin(ref: ProviderRef): CardStoragePlugin {
  const builtin = BUILTIN_CARD_PLUGINS.get(ref.provider)
  if (builtin) return builtin
  // Translate short compatibility alias ids to their external package names so
  // that module resolution and install hints use the correct package, not the
  // short user-facing id.
  const packageName = PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalCardPlugin(packageName)
}

function resolveAttachmentPlugin(ref: ProviderRef): AttachmentStoragePlugin {
  if (BUILTIN_ATTACHMENT_IDS.has(ref.provider)) {
    throw new Error(`Built-in attachment storage provider "${ref.provider}" requires an active storage engine.`)
  }
  const packageName = PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  return loadExternalAttachmentPlugin(packageName)
}

/**
 * Resolves a fully typed {@link ResolvedCapabilityBag} from a normalized
 * {@link ResolvedCapabilities} map.
 *
 * Attachment storage fallback precedence:
 * 1. Explicit provider in `capabilities['attachment.storage']` (built-in or external)
 * 2. Card storage engine's explicit built-in attachment provider
 * 3. Built-in `localfs`
 *
 * Auth plugins default to the built-in `noop` providers (anonymous identity,
 * allow-all policy) when `authCapabilities` is not supplied, preserving
 * the current open-access behavior.
 *
 * @param capabilities     - Normalized provider selections from {@link normalizeStorageCapabilities}.
 * @param kanbanDir        - Absolute path to the `.kanban` directory.
 * @param authCapabilities - Optional normalized auth provider selections from
 *                           {@link normalizeAuthCapabilities}. Defaults to noop providers.
 */
export function resolveCapabilityBag(
  capabilities: ResolvedCapabilities,
  kanbanDir: string,
  authCapabilities?: ResolvedAuthCapabilities,
): ResolvedCapabilityBag {
  const cardRef = capabilities['card.storage']
  const cardPlugin = resolveCardPlugin(cardRef)
  const cardEngine = cardPlugin.createEngine(kanbanDir, cardRef.options)
  const nodeCapabilities = cardPlugin.nodeCapabilities

  const attachRef = capabilities['attachment.storage']
  let attachPlugin: AttachmentStoragePlugin

  if (attachRef.provider === 'localfs') {
    if (shouldAttemptSamePluginAttachmentProvider(cardRef.provider, attachRef.provider)) {
      // Use the alias package name so the same-package attachment fallback
      // loads from the correct external package (e.g. kl-sqlite-storage,
      // not the short alias id 'sqlite').
      const cardPackageName = PROVIDER_ALIASES.get(cardRef.provider) ?? cardRef.provider
      try {
        attachPlugin = loadExternalAttachmentPlugin(cardPackageName)
      } catch (err) {
        if (!isRecoverableAttachmentPluginError(cardPackageName, err)) throw err
        attachPlugin = resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
      }
    } else {
      attachPlugin = resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
    }
  } else {
    attachPlugin = resolveAttachmentPlugin(attachRef)
  }

  const resolvedAuth: ResolvedAuthCapabilities = authCapabilities ?? {
    'auth.identity': { provider: 'noop' },
    'auth.policy': { provider: 'noop' },
  }

  return {
    cardStorage: cardEngine,
    attachmentStorage: attachPlugin,
    providers: capabilities,
    isFileBacked: nodeCapabilities?.isFileBacked ?? cardEngine.type === 'markdown',
    getLocalCardPath(card: Card): string | null {
      if (nodeCapabilities) return nodeCapabilities.getLocalCardPath(card)
      if (cardEngine.type !== 'markdown') return null
      return card.filePath || null
    },
    getAttachmentDir(card: Card): string | null {
      return attachPlugin.getCardDir?.(card) ?? null
    },
    async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
      if (typeof attachPlugin.materializeAttachment === 'function') {
        return attachPlugin.materializeAttachment(card, attachment)
      }
      return materializeAttachmentFromDir(attachPlugin.getCardDir, card, attachment)
    },
    getWatchGlob(): string | null {
      if (nodeCapabilities) return nodeCapabilities.getWatchGlob()
      return cardEngine.type === 'markdown' ? 'boards/**/*.md' : null
    },
    authIdentity: resolveAuthIdentityPlugin(resolvedAuth['auth.identity']),
    authPolicy: resolveAuthPolicyPlugin(resolvedAuth['auth.policy']),
  }
}

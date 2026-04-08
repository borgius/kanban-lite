/**
 * Plugin capability resolution — barrel re-exports all submodules and
 * provides the final `resolveCapabilityBag` assembly function.
 *
 * Submodule responsibilities:
 *   plugin-settings.ts       — config I/O, options-schema helpers
 *   plugin-loader.ts         — require/resolve runtime helpers
 *   auth-plugins.ts          — auth.identity / auth.policy / auth.visibility
 *   storage-plugins.ts       — card.storage / attachment.storage
 *   card-state-plugins.ts    — card.state
 *   config-storage-plugins.ts — config.storage
 *   webhook-callback-plugins.ts — webhook.delivery / callback.runtime
 *   mcp-sdk-plugins.ts       — standalone HTTP + MCP tool plugins + SDK extensions
 *   auth-listener.ts         — built-in auth before-event listener
 *   plugin-discovery.ts      — plugin inventory discovery + settings persistence
 */
import * as path from 'path'
import type { Card } from '../../shared/types'
import type {
  ProviderRef,
  ResolvedCapabilities,
  ResolvedAuthCapabilities,
  ResolvedCallbackCapabilities,
  ResolvedWebhookCapabilities,
  ResolvedCardStateCapabilities,
} from '../../shared/config'
import type { SDKEventListenerPlugin, SDKExtensionLoaderResult } from '../types'
import type { StorageEngine } from './types'
import {
  BUILTIN_CARD_PLUGINS,
  BUILTIN_ATTACHMENT_IDS,
  PROVIDER_ALIASES,
  materializeAttachmentFromDir,
  resolveBuiltinAttachmentPlugin,
  loadExternalAttachmentPlugin,
  resolveCardPlugin,
  resolveAttachmentPlugin,
  shouldAttemptSamePluginAttachmentProvider,
  isRecoverableAttachmentPluginError,
} from './storage-plugins'
import type { CardStoragePlugin, AttachmentStoragePlugin } from './storage-plugins'
import {
  AUTH_PROVIDER_ALIASES,
  resolveAuthIdentityPlugin,
  resolveAuthPolicyPlugin,
  resolveAuthVisibilityPlugin,
} from './auth-plugins'
import type { AuthIdentityPlugin, AuthPolicyPlugin, AuthVisibilityPlugin } from './auth-plugins'
import {
  BUILTIN_CARD_STATE_PROVIDER_IDS,
  CARD_STATE_PROVIDER_ALIASES,
  resolveCardStateProviderFromStorage,
} from './card-state-plugins'
import type { CardStateProvider, CardStateModuleContext } from './card-state-plugins'
import {
  WEBHOOK_PROVIDER_ALIASES,
  CALLBACK_PROVIDER_ALIASES,
  resolveWebhookPlugins,
  resolveCallbackRuntimeListener,
} from './webhook-callback-plugins'
import type { WebhookProviderPlugin } from './webhook-callback-plugins'
import {
  tryLoadMcpPlugin,
  resolveStandaloneHttpPlugins,
  resolveSDKExtensions,
} from './mcp-sdk-plugins'
import type { McpPluginRegistration, StandaloneHttpPlugin } from './mcp-sdk-plugins'
import { createBuiltinAuthListenerPlugin } from './auth-listener'

// ---------------------------------------------------------------------------
// Barrel re-exports
// ---------------------------------------------------------------------------

export { PluginSettingsStoreError, resolvePluginSettingsOptionsSchema } from './plugin-settings'
export type { PluginSettingsOptionsSchemaFactory, PluginSettingsOptionsSchemaInput, PluginSettingsOptionsSchemaValueResolver } from './plugin-settings'
export * from './plugin-loader'
export * from './auth-plugins'
export * from './storage-plugins'
export * from './card-state-plugins'
export * from './config-storage-plugins'
export * from './webhook-callback-plugins'
export * from './mcp-sdk-plugins'
export * from './auth-listener'
export * from './plugin-discovery'

// ---------------------------------------------------------------------------
// ResolvedCapabilityBag — assembled from all resolved capability plugins
// ---------------------------------------------------------------------------

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
   */
  readonly isFileBacked: boolean
  /**
   * Returns the local filesystem path for a card, or `null` if the provider
   * is not file-backed or the card has no associated file.
   */
  getLocalCardPath(card: Card): string | null
  /** Returns the local attachment directory for a card, or `null` when unavailable. */
  getAttachmentDir(card: Card): string | null
  /** Returns a safe local file path for a named attachment, or `null` when unavailable. */
  materializeAttachment(card: Card, attachment: string): Promise<string | null>
  /**
   * Returns the glob pattern (relative to the kanban directory) that host
   * file-watchers should use to observe card changes, or `null` when the
   * provider does not store cards as local files.
   */
  getWatchGlob(): string | null
  /** Resolved `auth.identity` plugin. Defaults to `noop` when no auth is configured. */
  readonly authIdentity: AuthIdentityPlugin
  /** Raw resolved auth provider selections. */
  readonly authProviders: ResolvedAuthCapabilities
  /** Resolved `auth.policy` plugin. Defaults to `noop` when no auth is configured. */
  readonly authPolicy: AuthPolicyPlugin
  /** Resolved `auth.visibility` plugin, or `null` when visibility filtering is disabled. */
  readonly authVisibility: AuthVisibilityPlugin | null
  /** Resolved `card.state` provider shared across SDK modules and host surfaces. */
  readonly cardState: CardStateProvider
  /** Raw resolved `card.state` provider selection. */
  readonly cardStateProviders: ResolvedCardStateCapabilities
  /** Shared runtime context for the resolved `card.state` provider. */
  readonly cardStateContext: CardStateModuleContext
  /** Resolved event listener plugins. Reserved for future use; currently empty. */
  readonly eventListeners: readonly SDKEventListenerPlugin[]
  /**
   * Resolved webhook delivery provider for CRUD operations, or `null` when the
   * `kl-plugin-webhook` package is not yet installed.
   */
  readonly webhookProvider: WebhookProviderPlugin | null
  /** Raw resolved webhook provider selection. */
  readonly webhookProviders: ResolvedWebhookCapabilities | null
  /** Resolved webhook runtime delivery listener, or `null` when no webhook package is installed. */
  readonly webhookListener: SDKEventListenerPlugin | null
  /** Raw resolved callback runtime provider selection. */
  readonly callbackProviders: ResolvedCallbackCapabilities | null
  /** Resolved same-runtime callback listener for committed event subscriptions. */
  readonly callbackListener: SDKEventListenerPlugin | null
  /** Standalone-only middleware/routes exported by active capability packages. */
  readonly standaloneHttpPlugins: readonly StandaloneHttpPlugin[]
  /**
   * SDK extensions contributed by active plugin packages.
   * Consumed by `KanbanSDK.getExtension(id)`. Empty when no active plugin
   * exports the optional `sdkExtensionPlugin` field.
   */
  readonly sdkExtensions: readonly SDKExtensionLoaderResult[]
  /**
   * Built-in auth event listener plugin establishing the auth before-event seam.
   */
  readonly authListener: SDKEventListenerPlugin
}

/**
 * Returns `true` only when the auth configuration permits the stable default
 * single-user card-state actor.
 *
 * Any non-noop `auth.identity` provider disables the fallback, even if the
 * provider later resolves no caller for a specific request.
 */
export function canUseDefaultCardStateActor(
  authCapabilities?: ResolvedAuthCapabilities | null,
): boolean {
  return (authCapabilities?.['auth.identity']?.provider ?? 'noop') === 'noop'
}

/**
 * Returns the deduplicated list of external npm package names that are
 * referenced by the active capability provider configuration.
 *
 * Applies the same alias translations used by the standalone HTTP plugin
 * discovery path (`collectStandaloneHttpPackageNames`), and reads both the
 * normalized `plugins` key and the legacy `webhookPlugin` key so that
 * webhook-only configurations deterministically activate the webhook package.
 *
 * @param config - Raw workspace config. Only the consumed fields need to be present.
 */
export function collectActiveExternalPackageNames(config: {
  readonly plugins?: Partial<Record<string, ProviderRef>>
  readonly webhookPlugin?: Partial<Record<string, ProviderRef>>
  readonly auth?: Partial<Record<string, ProviderRef>>
}): string[] {
  const packageNames = new Set<string>()
  const add = (pkg: string | undefined): void => {
    if (pkg) packageNames.add(pkg)
  }

  const cardProvider = config.plugins?.['card.storage']?.provider === 'markdown'
    ? 'localfs'
    : config.plugins?.['card.storage']?.provider
  if (cardProvider && !BUILTIN_CARD_PLUGINS.has(cardProvider)) {
    add(PROVIDER_ALIASES.get(cardProvider) ?? cardProvider)
  }

  const attachmentProvider = config.plugins?.['attachment.storage']?.provider
  if (attachmentProvider && !BUILTIN_ATTACHMENT_IDS.has(attachmentProvider)) {
    add(PROVIDER_ALIASES.get(attachmentProvider) ?? attachmentProvider)
  }

  const configStorageProvider = config.plugins?.['config.storage']?.provider === 'markdown'
    ? 'localfs'
    : config.plugins?.['config.storage']?.provider
  if (configStorageProvider && configStorageProvider !== 'localfs') {
    add(PROVIDER_ALIASES.get(configStorageProvider) ?? configStorageProvider)
  }

  const cardStateProvider = config.plugins?.['card.state']?.provider === 'builtin'
    ? 'localfs'
    : config.plugins?.['card.state']?.provider
  if (cardStateProvider && !BUILTIN_CARD_STATE_PROVIDER_IDS.has(cardStateProvider)) {
    add(CARD_STATE_PROVIDER_ALIASES.get(cardStateProvider) ?? cardStateProvider)
  }

  const identityProvider = config.plugins?.['auth.identity']?.provider
    ?? config.auth?.['auth.identity']?.provider
  if (identityProvider) {
    add(AUTH_PROVIDER_ALIASES.get(identityProvider) ?? identityProvider)
  }

  const policyProvider = config.plugins?.['auth.policy']?.provider
    ?? config.auth?.['auth.policy']?.provider
  if (policyProvider) {
    add(AUTH_PROVIDER_ALIASES.get(policyProvider) ?? policyProvider)
  }

  const visibilityProvider = config.plugins?.['auth.visibility']?.provider
    ?? config.auth?.['auth.visibility']?.provider
  if (visibilityProvider && visibilityProvider !== 'none') {
    add(AUTH_PROVIDER_ALIASES.get(visibilityProvider) ?? visibilityProvider)
  }

  const webhookProvider = config.plugins?.['webhook.delivery']?.provider
    ?? config.webhookPlugin?.['webhook.delivery']?.provider
    ?? 'webhooks'
  if (webhookProvider !== 'none') {
    add(WEBHOOK_PROVIDER_ALIASES.get(webhookProvider) ?? webhookProvider)
  }

  const callbackProvider = config.plugins?.['callback.runtime']?.provider ?? 'none'
  if (callbackProvider !== 'none') {
    add(CALLBACK_PROVIDER_ALIASES.get(callbackProvider) ?? callbackProvider)
  }

  return [...packageNames]
}

/**
 * Resolves optional MCP tool plugins from the canonical active-package set.
 *
 * Reuses {@link collectActiveExternalPackageNames} so MCP follows the same
 * activation model as CLI and standalone HTTP discovery.
 */
export function resolveMcpPlugins(config: {
  readonly plugins?: Partial<Record<string, ProviderRef>>
  readonly webhookPlugin?: Partial<Record<string, ProviderRef>>
  readonly auth?: Partial<Record<string, ProviderRef>>
}): McpPluginRegistration[] {
  const resolved: McpPluginRegistration[] = []
  const seen = new Set<string>()

  for (const packageName of collectActiveExternalPackageNames(config)) {
    const plugin = tryLoadMcpPlugin(packageName)
    if (plugin && !seen.has(plugin.manifest.id)) {
      seen.add(plugin.manifest.id)
      resolved.push(plugin)
    }
  }

  return resolved
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
 * Auth plugins default to the `noop` compatibility providers when
 * `authCapabilities` is not supplied, preserving open-access behaviour.
 *
 * @param capabilities     - Normalized provider selections from {@link normalizeStorageCapabilities}.
 * @param kanbanDir        - Absolute path to the `.kanban` directory.
 * @param authCapabilities - Optional normalized auth provider selections.
 * @param webhookCapabilities - Optional normalized webhook provider selections.
 * @param cardStateCapabilities - Optional normalized card-state provider selections.
 * @param callbackCapabilities - Optional normalized callback runtime provider selections.
 */
export function resolveCapabilityBag(
  capabilities: ResolvedCapabilities,
  kanbanDir: string,
  authCapabilities?: ResolvedAuthCapabilities,
  webhookCapabilities?: ResolvedWebhookCapabilities,
  cardStateCapabilities?: ResolvedCardStateCapabilities,
  callbackCapabilities?: ResolvedCallbackCapabilities,
): ResolvedCapabilityBag {
  const normalizedCapabilities: ResolvedCapabilities = {
    ...capabilities,
    'card.storage': capabilities['card.storage'].provider === 'markdown'
      ? {
          provider: 'localfs',
          ...(capabilities['card.storage'].options !== undefined
            ? { options: capabilities['card.storage'].options }
            : {}),
        }
      : capabilities['card.storage'],
  }

  const cardRef = normalizedCapabilities['card.storage']
  const cardPlugin = resolveCardPlugin(cardRef)
  const cardEngine = cardPlugin.createEngine(kanbanDir, cardRef.options)
  const nodeCapabilities = cardPlugin.nodeCapabilities

  const attachRef = normalizedCapabilities['attachment.storage']
  let attachPlugin: AttachmentStoragePlugin

  if (attachRef.provider === 'localfs') {
    if (shouldAttemptSamePluginAttachmentProvider(cardRef.provider, attachRef.provider)) {
      const cardPackageName = PROVIDER_ALIASES.get(cardRef.provider) ?? cardRef.provider
      try {
        attachPlugin = loadExternalAttachmentPlugin(cardPackageName, {
          providerId: cardRef.provider,
          engine: cardEngine,
        })
      } catch (err) {
        if (!isRecoverableAttachmentPluginError(cardPackageName, err)) throw err
        attachPlugin = resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
      }
    } else {
      attachPlugin = resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
    }
  } else {
    attachPlugin = resolveAttachmentPlugin(
      attachRef,
      attachRef.provider === cardRef.provider
        ? { providerId: attachRef.provider, engine: cardEngine }
        : undefined,
    )
  }

  const resolvedAuth: ResolvedAuthCapabilities = {
    'auth.identity': authCapabilities?.['auth.identity'] ?? { provider: 'noop' },
    'auth.policy': authCapabilities?.['auth.policy'] ?? { provider: 'noop' },
    'auth.visibility': authCapabilities?.['auth.visibility'] ?? { provider: 'none' },
  }

  const explicitCardState = (() => {
    const configured = cardStateCapabilities?.['card.state']
    if (!configured) return undefined
    if (configured.provider !== 'builtin') return configured
    return {
      provider: 'localfs',
      ...(configured.options !== undefined ? { options: configured.options } : {}),
    }
  })()
  const resolvedCardStateProvider = resolveCardStateProviderFromStorage(
    cardRef,
    explicitCardState,
    kanbanDir,
  )
  const resolvedAuthIdentity = resolveAuthIdentityPlugin(resolvedAuth['auth.identity'])
  const resolvedAuthPolicy = resolveAuthPolicyPlugin(resolvedAuth['auth.policy'])
  const resolvedAuthVisibility = resolveAuthVisibilityPlugin(resolvedAuth['auth.visibility'])
  const workspaceRoot = path.dirname(kanbanDir)
  const webhookPlugins = webhookCapabilities
    ? resolveWebhookPlugins(webhookCapabilities['webhook.delivery'], workspaceRoot)
    : null
  const callbackListener = callbackCapabilities
    ? resolveCallbackRuntimeListener(callbackCapabilities['callback.runtime'], workspaceRoot)
    : null
  const standaloneHttpPlugins = resolveStandaloneHttpPlugins({
    workspaceRoot,
    kanbanDir,
    capabilities: normalizedCapabilities,
    authCapabilities: resolvedAuth,
    webhookCapabilities: webhookCapabilities ?? null,
  })
  const sdkExtensions = resolveSDKExtensions(normalizedCapabilities, resolvedAuth, webhookCapabilities ?? null)

  return {
    cardStorage: cardEngine,
    attachmentStorage: attachPlugin,
    providers: normalizedCapabilities,
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
    authIdentity: resolvedAuthIdentity,
    authProviders: resolvedAuth,
    authPolicy: resolvedAuthPolicy,
    authVisibility: resolvedAuthVisibility,
    cardState: resolvedCardStateProvider.provider,
    cardStateProviders: { 'card.state': { provider: resolvedCardStateProvider.provider.manifest.id } },
    cardStateContext: resolvedCardStateProvider.context,
    eventListeners: [],
    webhookProvider: webhookPlugins?.provider ?? null,
    webhookProviders: webhookCapabilities ?? null,
    webhookListener: webhookPlugins?.listener ?? null,
    callbackProviders: callbackCapabilities ?? null,
    callbackListener,
    standaloneHttpPlugins,
    sdkExtensions,
    authListener: createBuiltinAuthListenerPlugin(resolvedAuthIdentity, resolvedAuthPolicy),
  }
}

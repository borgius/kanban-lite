import * as path from 'path'
import type { Card } from '../../shared/types'
import type {
  ResolvedAuthCapabilities,
  ResolvedCallbackCapabilities,
  ResolvedCapabilities,
  ResolvedCardStateCapabilities,
  ResolvedWebhookCapabilities,
  ProviderRef,
} from '../../shared/config'
import type {
  AuthIdentityPlugin,
  AuthPolicyPlugin,
  AuthVisibilityPlugin,
} from './auth-plugins'
import {
  resolveAuthIdentityPlugin,
  resolveAuthPolicyPlugin,
  resolveAuthVisibilityPlugin,
} from './auth-plugins'
import { createBuiltinAuthListenerPlugin } from './auth-listener'
import type {
  CardStateModuleContext,
  CardStateProvider,
} from './card-state-plugins'
import { resolveCardStateProviderFromStorage } from './card-state-plugins'
import {
  resolveSDKExtensions,
  resolveStandaloneHttpPlugins,
} from './mcp-sdk-plugins'
import type { StandaloneHttpPlugin } from './mcp-sdk-plugins'
import {
  isRecoverableAttachmentPluginError,
  loadExternalAttachmentPlugin,
  materializeAttachmentFromDir,
  PROVIDER_ALIASES,
  resolveAttachmentPlugin,
  resolveBuiltinAttachmentPlugin,
  resolveCardPlugin,
  shouldAttemptSamePluginAttachmentProvider,
} from './storage-plugins'
import type { AttachmentStoragePlugin } from './storage-plugins'
import type { StorageEngine } from './types'
import {
  resolveCallbackRuntimeListener,
  resolveWebhookPlugins,
} from './webhook-callback-plugins'
import type { WebhookProviderPlugin } from './webhook-callback-plugins'
import type {
  SDKExtensionLoaderResult,
  SDKEventListenerPlugin,
} from '../types'

/**
 * Fully resolved capability bag produced by {@link resolveCapabilityBag}.
 */
export interface ResolvedCapabilityBag {
  readonly cardStorage: StorageEngine
  readonly attachmentStorage: AttachmentStoragePlugin
  readonly providers: ResolvedCapabilities
  readonly isFileBacked: boolean
  getLocalCardPath(card: Card): string | null
  getAttachmentDir(card: Card): string | null
  materializeAttachment(card: Card, attachment: string): Promise<string | null>
  getWatchGlob(): string | null
  readonly authIdentity: AuthIdentityPlugin
  readonly authProviders: ResolvedAuthCapabilities
  readonly authPolicy: AuthPolicyPlugin
  readonly authVisibility: AuthVisibilityPlugin | null
  readonly cardState: CardStateProvider
  readonly cardStateProviders: ResolvedCardStateCapabilities
  readonly cardStateContext: CardStateModuleContext
  readonly eventListeners: readonly SDKEventListenerPlugin[]
  readonly webhookProvider: WebhookProviderPlugin | null
  readonly webhookProviders: ResolvedWebhookCapabilities | null
  readonly webhookListener: SDKEventListenerPlugin | null
  readonly callbackProviders: ResolvedCallbackCapabilities | null
  readonly callbackListener: SDKEventListenerPlugin | null
  readonly standaloneHttpPlugins: readonly StandaloneHttpPlugin[]
  readonly sdkExtensions: readonly SDKExtensionLoaderResult[]
  readonly authListener: SDKEventListenerPlugin
}

/**
 * Returns `true` only when the auth configuration permits the stable default
 * single-user card-state actor.
 */
export function canUseDefaultCardStateActor(
  authCapabilities?: ResolvedAuthCapabilities | null,
): boolean {
  return (authCapabilities?.['auth.identity']?.provider ?? 'noop') === 'noop'
}

function normalizeCardStorageCapabilities(capabilities: ResolvedCapabilities): ResolvedCapabilities {
  const cardStorage = capabilities['card.storage']
  if (cardStorage.provider !== 'markdown') return capabilities

  return {
    ...capabilities,
    'card.storage': {
      provider: 'localfs',
      ...(cardStorage.options !== undefined ? { options: cardStorage.options } : {}),
    },
  }
}

function resolveAttachmentStorage(
  cardRef: ProviderRef,
  attachRef: ProviderRef,
  cardEngine: StorageEngine,
): AttachmentStoragePlugin {
  if (attachRef.provider !== 'localfs') {
    return resolveAttachmentPlugin(
      attachRef,
      attachRef.provider === cardRef.provider
        ? { providerId: attachRef.provider, engine: cardEngine }
        : undefined,
    )
  }

  if (!shouldAttemptSamePluginAttachmentProvider(cardRef.provider, attachRef.provider)) {
    return resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
  }

  const cardPackageName = PROVIDER_ALIASES.get(cardRef.provider) ?? cardRef.provider
  try {
    return loadExternalAttachmentPlugin(cardPackageName, {
      providerId: cardRef.provider,
      engine: cardEngine,
    })
  } catch (err) {
    if (!isRecoverableAttachmentPluginError(cardPackageName, err)) throw err
    return resolveBuiltinAttachmentPlugin(attachRef.provider, cardEngine)
  }
}

function resolveExplicitCardStateRef(
  cardStateCapabilities?: ResolvedCardStateCapabilities,
): ProviderRef | undefined {
  const configured = cardStateCapabilities?.['card.state']
  if (!configured) return undefined
  if (configured.provider !== 'builtin') return configured

  return {
    provider: 'localfs',
    ...(configured.options !== undefined ? { options: configured.options } : {}),
  }
}

/**
 * Resolves a fully typed capability bag from normalized provider selections.
 */
export function resolveCapabilityBag(
  capabilities: ResolvedCapabilities,
  kanbanDir: string,
  authCapabilities?: ResolvedAuthCapabilities,
  webhookCapabilities?: ResolvedWebhookCapabilities,
  cardStateCapabilities?: ResolvedCardStateCapabilities,
  callbackCapabilities?: ResolvedCallbackCapabilities,
): ResolvedCapabilityBag {
  const normalizedCapabilities = normalizeCardStorageCapabilities(capabilities)
  const cardRef = normalizedCapabilities['card.storage']
  const attachRef = normalizedCapabilities['attachment.storage']

  const cardPlugin = resolveCardPlugin(cardRef)
  const cardEngine = cardPlugin.createEngine(kanbanDir, cardRef.options)
  const nodeCapabilities = cardPlugin.nodeCapabilities
  const attachmentStorage = resolveAttachmentStorage(cardRef, attachRef, cardEngine)

  const resolvedAuth: ResolvedAuthCapabilities = {
    'auth.identity': authCapabilities?.['auth.identity'] ?? { provider: 'noop' },
    'auth.policy': authCapabilities?.['auth.policy'] ?? { provider: 'noop' },
    'auth.visibility': authCapabilities?.['auth.visibility'] ?? { provider: 'none' },
  }

  const resolvedCardState = resolveCardStateProviderFromStorage(
    cardRef,
    resolveExplicitCardStateRef(cardStateCapabilities),
    kanbanDir,
  )
  const authIdentity = resolveAuthIdentityPlugin(resolvedAuth['auth.identity'])
  const authPolicy = resolveAuthPolicyPlugin(resolvedAuth['auth.policy'])
  const authVisibility = resolveAuthVisibilityPlugin(resolvedAuth['auth.visibility'])
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
  const sdkExtensions = resolveSDKExtensions(
    normalizedCapabilities,
    resolvedAuth,
    webhookCapabilities ?? null,
  )

  return {
    cardStorage: cardEngine,
    attachmentStorage,
    providers: normalizedCapabilities,
    isFileBacked: nodeCapabilities?.isFileBacked ?? cardEngine.type === 'markdown',
    getLocalCardPath(card: Card): string | null {
      if (nodeCapabilities) return nodeCapabilities.getLocalCardPath(card)
      if (cardEngine.type !== 'markdown') return null
      return card.filePath || null
    },
    getAttachmentDir(card: Card): string | null {
      return attachmentStorage.getCardDir?.(card) ?? null
    },
    async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
      if (typeof attachmentStorage.materializeAttachment === 'function') {
        return attachmentStorage.materializeAttachment(card, attachment)
      }
      return materializeAttachmentFromDir(attachmentStorage.getCardDir, card, attachment)
    },
    getWatchGlob(): string | null {
      if (nodeCapabilities) return nodeCapabilities.getWatchGlob()
      return cardEngine.type === 'markdown' ? 'boards/**/*.md' : null
    },
    authIdentity,
    authProviders: resolvedAuth,
    authPolicy,
    authVisibility,
    cardState: resolvedCardState.provider,
    cardStateProviders: { 'card.state': { provider: resolvedCardState.provider.manifest.id } },
    cardStateContext: resolvedCardState.context,
    eventListeners: [],
    webhookProvider: webhookPlugins?.provider ?? null,
    webhookProviders: webhookCapabilities ?? null,
    webhookListener: webhookPlugins?.listener ?? null,
    callbackProviders: callbackCapabilities ?? null,
    callbackListener,
    standaloneHttpPlugins,
    sdkExtensions,
    authListener: createBuiltinAuthListenerPlugin(authIdentity, authPolicy),
  }
}

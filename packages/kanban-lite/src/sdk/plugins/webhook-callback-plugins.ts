import type { SDKEventListenerPlugin } from '../types'
import type { CloudflareWorkerProviderContext } from '../env'
import type { ProviderRef } from '../../shared/config'
import {
  loadExternalModule,
  getCloudflareWorkerProviderContext,
  resolveCallbackRuntimeModule,
} from './plugin-loader'

// ---------------------------------------------------------------------------
// Webhook provider contract
// ---------------------------------------------------------------------------

/**
 * Contract for `webhook.delivery` capability providers.
 *
 * Owns webhook registry CRUD. Runtime delivery is listener-driven and must be
 * exported separately as `webhookListenerPlugin: SDKEventListenerPlugin` when an
 * external provider wants to own webhook event delivery.
 */
export interface WebhookProviderPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  listWebhooks(workspaceRoot: string): import('../../shared/config').Webhook[]
  createWebhook(workspaceRoot: string, input: { url: string; events: string[]; secret?: string }): import('../../shared/config').Webhook
  updateWebhook(
    workspaceRoot: string,
    id: string,
    updates: Partial<Pick<import('../../shared/config').Webhook, 'url' | 'events' | 'secret' | 'active'>>,
  ): import('../../shared/config').Webhook | null
  deleteWebhook(workspaceRoot: string, id: string): boolean
}

/** Context passed to callback runtime listener factories. */
export interface CallbackRuntimeListenerContext {
  readonly workspaceRoot: string
  readonly worker: CloudflareWorkerProviderContext | null
}

/**
 * Maps short webhook provider ids to their installable npm package names.
 *
 * - `webhooks` → `npm install kl-plugin-webhook`
 */
export const WEBHOOK_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['webhooks', 'kl-plugin-webhook'],
])

/**
 * Maps short callback runtime provider ids to their installable npm package names.
 *
 * - `callbacks` → `npm install kl-plugin-callback`
 */
export const CALLBACK_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['callbacks', 'kl-plugin-callback'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function isValidWebhookProviderManifest(
  manifest: unknown,
): manifest is { readonly id: string; readonly provides: readonly string[] } {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as { id: unknown; provides: unknown }
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.provides)
    && (candidate.provides as unknown[]).includes('webhook.delivery')
}

export function isValidSDKEventListenerPlugin(plugin: unknown): plugin is SDKEventListenerPlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const p = plugin as SDKEventListenerPlugin
  return typeof p.register === 'function'
    && typeof p.unregister === 'function'
    && typeof p.manifest?.id === 'string'
    && Array.isArray(p.manifest?.provides)
}

interface SDKEventListenerPluginConstructor {
  new (workspaceRoot: string): SDKEventListenerPlugin
}

export function isSDKEventListenerPluginConstructor(value: unknown): value is SDKEventListenerPluginConstructor {
  return typeof value === 'function'
}

// ---------------------------------------------------------------------------
// Internal module shapes
// ---------------------------------------------------------------------------

interface WebhookProviderModule {
  webhookProviderPlugin?: unknown
  webhookListenerPlugin?: unknown
  WebhookListenerPlugin?: unknown
  default?: unknown
}

interface CallbackRuntimeModule {
  callbackListenerPlugin?: unknown
  CallbackListenerPlugin?: unknown
  createCallbackListenerPlugin?: ((context: CallbackRuntimeListenerContext) => unknown) | unknown
  default?: unknown
}

interface WebhookPluginPack {
  provider: WebhookProviderPlugin
  listener?: SDKEventListenerPlugin
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function loadWebhookPluginPack(providerName: string, workspaceRoot: string): WebhookPluginPack {
  const mod = loadExternalModule(providerName) as WebhookProviderModule

  const rawProvider = (mod.webhookProviderPlugin ?? mod.default) as WebhookProviderPlugin | undefined
  if (
    !rawProvider ||
    typeof rawProvider.listWebhooks !== 'function' ||
    typeof rawProvider.createWebhook !== 'function' ||
    typeof rawProvider.updateWebhook !== 'function' ||
    typeof rawProvider.deleteWebhook !== 'function' ||
    !isValidWebhookProviderManifest(rawProvider.manifest)
  ) {
    throw new Error(
      `Plugin "${providerName}" does not export a valid webhookProviderPlugin. ` +
      `Expected a named export 'webhookProviderPlugin' or default export with ` +
      `CRUD methods (listWebhooks, createWebhook, updateWebhook, deleteWebhook) ` +
      `and a manifest that provides 'webhook.delivery'.`
    )
  }

  const directListener = isValidSDKEventListenerPlugin(mod.webhookListenerPlugin)
    ? mod.webhookListenerPlugin
    : isSDKEventListenerPluginConstructor(mod.WebhookListenerPlugin)
      ? mod.WebhookListenerPlugin
      : undefined

  if (isSDKEventListenerPluginConstructor(directListener)) {
    return { provider: rawProvider, listener: new directListener(workspaceRoot) }
  }

  return { provider: rawProvider, listener: directListener }
}

function loadCallbackRuntimeListener(providerName: string, workspaceRoot: string): SDKEventListenerPlugin {
  const mod = resolveCallbackRuntimeModule(providerName) as CallbackRuntimeModule

  if (typeof mod.createCallbackListenerPlugin === 'function') {
    const created = mod.createCallbackListenerPlugin({
      workspaceRoot,
      worker: getCloudflareWorkerProviderContext(),
    })
    if (isValidSDKEventListenerPlugin(created)) {
      return created
    }
    throw new Error(
      `Plugin "${providerName}" exported createCallbackListenerPlugin(context) but it did not return a valid callback runtime listener.`,
    )
  }

  const directListener = isSDKEventListenerPluginConstructor(mod.CallbackListenerPlugin)
    ? mod.CallbackListenerPlugin
    : isValidSDKEventListenerPlugin(mod.callbackListenerPlugin)
      ? mod.callbackListenerPlugin
      : isValidSDKEventListenerPlugin(mod.default)
        ? mod.default
        : undefined

  if (isSDKEventListenerPluginConstructor(directListener)) {
    return new directListener(workspaceRoot)
  }

  if (directListener) {
    return directListener
  }

  throw new Error(
    `Plugin "${providerName}" does not export a valid callback runtime listener. ` +
    `Expected a named export 'callbackListenerPlugin', 'CallbackListenerPlugin', ` +
    `or default export implementing register/unregister with an event-listener manifest.`
  )
}

// ---------------------------------------------------------------------------
// Exported resolvers
// ---------------------------------------------------------------------------

export function resolveWebhookPlugins(
  ref: ProviderRef,
  workspaceRoot: string,
): { provider: WebhookProviderPlugin; listener: SDKEventListenerPlugin | null } | null {
  if (ref.provider === 'none') return null

  const packageName = WEBHOOK_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  try {
    const { provider, listener } = loadWebhookPluginPack(packageName, workspaceRoot)
    return { provider, listener: listener ?? null }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Plugin package') &&
      err.message.includes('not installed')
    ) {
      return null
    }
    throw err
  }
}

export function resolveCallbackRuntimeListener(
  ref: ProviderRef,
  workspaceRoot: string,
): SDKEventListenerPlugin | null {
  if (ref.provider === 'none') return null

  const packageName = CALLBACK_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  try {
    return loadCallbackRuntimeListener(packageName, workspaceRoot)
  } catch (err) {
    if (
      err instanceof Error
      && err.message.includes('Plugin package')
      && err.message.includes('not installed')
    ) {
      return null
    }
    throw err
  }
}

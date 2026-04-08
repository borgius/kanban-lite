import * as path from 'path'
import type { CardStateBackend } from '../types'
import type { ProviderRef } from '../../shared/config'
import type { CloudflareWorkerProviderContext } from '../env'
import { createFileBackedCardStateProvider } from './card-state-file'
import { loadExternalModule, getCloudflareWorkerProviderContext } from './plugin-loader'
import { PROVIDER_ALIASES } from './storage-plugins'

// ---------------------------------------------------------------------------
// Card state plugin contracts
// ---------------------------------------------------------------------------

/** Shared plugin manifest shape for `card.state` capability providers. */
export interface CardStateProviderManifest {
  readonly id: string
  readonly provides: readonly import('../../shared/config').CardStateCapabilityNamespace[]
}

/** Opaque JSON-like payload stored for a card-state domain. */
export type CardStateValue = Record<string, unknown>

/** Stable actor/card/domain lookup key used by card-state providers. */
export interface CardStateKey {
  actorId: string
  boardId: string
  cardId: string
  domain: string
}

/** Stored card-state record returned by provider operations. */
export interface CardStateRecord<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt: string
}

/** Write input for card-state domain mutations. */
export interface CardStateWriteInput<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt?: string
}

/** Unread cursor payload persisted by card-state providers. */
export interface CardStateCursor extends Record<string, unknown> {
  cursor: string
  updatedAt?: string
}

/** Lookup key for unread cursor state. */
export interface CardStateUnreadKey {
  actorId: string
  boardId: string
  cardId: string
}

/** Mutation input for marking unread state through a cursor. */
export interface CardStateReadThroughInput extends CardStateUnreadKey {
  cursor: CardStateCursor
}

/** Shared runtime context passed to and exposed for `card.state` providers. */
export interface CardStateModuleContext {
  workspaceRoot: string
  kanbanDir: string
  provider: string
  backend: Exclude<CardStateBackend, 'none'>
  options?: Record<string, unknown>
  worker?: CloudflareWorkerProviderContext | null
}

/**
 * Contract for first-class `card.state` capability providers.
 */
export interface CardStateProvider {
  readonly manifest: CardStateProviderManifest
  getCardState(input: CardStateKey): Promise<CardStateRecord | null>
  setCardState(input: CardStateWriteInput): Promise<CardStateRecord>
  getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null>
  markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>>
}

interface CardStateProviderModule {
  readonly cardStateProviders?: Record<string, unknown>
  readonly cardStateProvider?: unknown
  readonly createCardStateProvider?: ((context: CardStateModuleContext) => unknown) | unknown
  readonly default?: unknown
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUILTIN_CARD_STATE_PROVIDER_IDS = new Set(['localfs'])

/**
 * Maps short `card.state` provider ids to their installable npm package names.
 */
export const CARD_STATE_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['sqlite', 'kl-plugin-storage-sqlite'],
  ['mysql', 'kl-plugin-storage-mysql'],
  ['postgresql', 'kl-plugin-storage-postgresql'],
  ['mongodb', 'kl-plugin-storage-mongodb'],
  ['redis', 'kl-plugin-storage-redis'],
  ['cloudflare', 'kl-plugin-cloudflare'],
])

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isValidCardStateProviderManifest(
  manifest: unknown,
  providerId: string,
): manifest is CardStateProviderManifest {
  if (!manifest || typeof manifest !== 'object') return false
  const candidate = manifest as CardStateProviderManifest
  return typeof candidate.id === 'string'
    && candidate.id === providerId
    && Array.isArray(candidate.provides)
    && candidate.provides.includes('card.state')
}

export function isValidCardStateProviderCandidate(provider: unknown): provider is CardStateProvider {
  if (!provider || typeof provider !== 'object') return false
  const candidate = provider as CardStateProvider
  return typeof candidate.getCardState === 'function'
    && typeof candidate.setCardState === 'function'
    && typeof candidate.getUnreadCursor === 'function'
    && typeof candidate.markUnreadReadThrough === 'function'
    && typeof candidate.manifest?.id === 'string'
    && Array.isArray(candidate.manifest?.provides)
    && candidate.manifest.provides.includes('card.state')
}

export function isValidCardStateProvider(
  provider: unknown,
  providerId: string,
): provider is CardStateProvider {
  if (!provider || typeof provider !== 'object') return false
  const candidate = provider as CardStateProvider
  return typeof candidate.getCardState === 'function'
    && typeof candidate.setCardState === 'function'
    && typeof candidate.getUnreadCursor === 'function'
    && typeof candidate.markUnreadReadThrough === 'function'
    && isValidCardStateProviderManifest(candidate.manifest, providerId)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectCardStateProvider(mod: CardStateProviderModule, providerId: string): CardStateProvider | null {
  const mapped = mod.cardStateProviders?.[providerId]
  if (isValidCardStateProvider(mapped, providerId)) return mapped
  const direct = mod.cardStateProvider ?? mod.default
  if (isValidCardStateProvider(direct, providerId)) return direct
  return null
}

export function createCardStateModuleContext(ref: ProviderRef, kanbanDir: string): CardStateModuleContext {
  const context: CardStateModuleContext = {
    workspaceRoot: path.dirname(kanbanDir),
    kanbanDir,
    provider: ref.provider,
    backend: BUILTIN_CARD_STATE_PROVIDER_IDS.has(ref.provider) ? 'builtin' : 'external',
  }
  if (ref.options) {
    context.options = ref.options
  }
  const worker = getCloudflareWorkerProviderContext()
  if (worker) {
    context.worker = worker
  }
  return context
}

// ---------------------------------------------------------------------------
// External plugin loaders
// ---------------------------------------------------------------------------

function loadExternalCardStateProvider(
  packageName: string,
  providerId: string,
  context: CardStateModuleContext,
): CardStateProvider {
  const mod = loadExternalModule(packageName) as CardStateProviderModule

  if (typeof mod.createCardStateProvider === 'function') {
    const created = mod.createCardStateProvider(context)
    if (isValidCardStateProvider(created, providerId)) return created
  }

  const provider = selectCardStateProvider(mod, providerId)
  if (!provider) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid cardStateProvider for "${providerId}". ` +
      `Expected cardStateProviders["${providerId}"] or cardStateProvider/default export with ` +
      `getCardState, setCardState, getUnreadCursor, markUnreadReadThrough, and a manifest that provides 'card.state'.`
    )
  }
  return provider
}

// ---------------------------------------------------------------------------
// Provider resolvers
// ---------------------------------------------------------------------------

export function resolveCardStateProvider(
  ref: ProviderRef,
  kanbanDir: string,
): { provider: CardStateProvider; context: CardStateModuleContext } {
  const baseContext = createCardStateModuleContext(ref, kanbanDir)
  if (BUILTIN_CARD_STATE_PROVIDER_IDS.has(ref.provider)) {
    return { provider: createFileBackedCardStateProvider(baseContext), context: baseContext }
  }
  const packageName = CARD_STATE_PROVIDER_ALIASES.get(ref.provider) ?? ref.provider
  const provider = loadExternalCardStateProvider(packageName, ref.provider, baseContext)
  return {
    provider,
    context: { ...baseContext, provider: provider.manifest.id },
  }
}

/**
 * Auto-derives card-state from the active storage plugin when no explicit
 * `card.state` provider is configured (or the configured provider is `localfs`).
 */
export function resolveCardStateProviderFromStorage(
  storageRef: ProviderRef,
  explicitCardStateRef: ProviderRef | undefined,
  kanbanDir: string,
): { provider: CardStateProvider; context: CardStateModuleContext } {
  // 1. Explicit non-localfs card-state provider configured — honour it.
  if (explicitCardStateRef && !BUILTIN_CARD_STATE_PROVIDER_IDS.has(explicitCardStateRef.provider)) {
    return resolveCardStateProvider(explicitCardStateRef, kanbanDir)
  }

  // 2. External storage — try loading card-state from the same package.
  if (storageRef.provider !== 'localfs') {
    const storagePackageName = PROVIDER_ALIASES.get(storageRef.provider) ?? storageRef.provider
    const context: CardStateModuleContext = {
      workspaceRoot: path.dirname(kanbanDir),
      kanbanDir,
      provider: storageRef.provider,
      backend: 'external',
      options: storageRef.options,
    }
    try {
      const provider = loadExternalCardStateProvider(storagePackageName, storageRef.provider, context)
      return {
        provider,
        context: { ...context, provider: provider.manifest.id },
      }
    } catch {
      // Storage package doesn't export card-state — fall through to builtin.
    }
  }

  // 3. Fall back to built-in file-backed provider.
  const builtinRef: ProviderRef = { provider: 'localfs' }
  const builtinContext = createCardStateModuleContext(builtinRef, kanbanDir)
  return { provider: createFileBackedCardStateProvider(builtinContext), context: builtinContext }
}

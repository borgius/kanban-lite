/**
 * Module-level helpers, exported interfaces, and utility types shared across
 * the KanbanSDK class-split files.  Nothing in this file depends on the class
 * hierarchy, making it safe to import from any level of the chain.
 */
import type { CardSortOption, LogEntry } from '../shared/types'
import type {
  PluginSettingsProviderRow,
  PluginSettingsReadPayload,
} from '../shared/types'
import type { KanbanConfig, ConfigStorageCapabilityResolution, ResolvedCapabilities } from '../shared/config'
import type {
  SDKAvailableEventDescriptor,
  SDKAvailableEventsOptions,
  CardStateStatus,
} from './types'
import type { CardStateCursor } from './plugins'

// ---------------------------------------------------------------------------
// Module-level event-matching helpers (used by listAvailableEvents)
// ---------------------------------------------------------------------------

export function normalizeAvailableEventType(type: SDKAvailableEventsOptions['type']): 'before' | 'after' | 'all' {
  if (type === undefined) return 'all'
  if (type === 'before' || type === 'after' || type === 'all') return type
  throw new Error(`Invalid event type filter: ${String(type)}. Expected "before", "after", or "all".`)
}

export function matchesEventMask(event: string, mask?: string): boolean {
  if (!mask) return true
  const normalizedMask = mask.trim()
  if (!normalizedMask) return true

  const eventSegments = event.split('.')
  const maskSegments = normalizedMask.split('.')

  const match = (eventIndex: number, maskIndex: number): boolean => {
    if (maskIndex === maskSegments.length) return eventIndex === eventSegments.length

    const token = maskSegments[maskIndex]
    if (token === '**') {
      if (maskIndex === maskSegments.length - 1) return true
      for (let nextEventIndex = eventIndex; nextEventIndex <= eventSegments.length; nextEventIndex += 1) {
        if (match(nextEventIndex, maskIndex + 1)) return true
      }
      return false
    }

    if (eventIndex >= eventSegments.length) return false
    if (token !== '*' && token !== eventSegments[eventIndex]) return false
    return match(eventIndex + 1, maskIndex + 1)
  }

  return match(0, 0)
}

export function compareAvailableEvents(left: SDKAvailableEventDescriptor, right: SDKAvailableEventDescriptor): number {
  if (left.phase !== right.phase) return left.phase === 'before' ? -1 : 1
  const eventCompare = left.event.localeCompare(right.event)
  if (eventCompare !== 0) return eventCompare
  if (left.source !== right.source) return left.source === 'core' ? -1 : 1
  return (left.pluginIds?.[0] ?? '').localeCompare(right.pluginIds?.[0] ?? '')
}

/**
 * Returns `true` when `value` is a plain-object merge candidate.
 * @internal
 */
export function _isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function isUnreadActivityMetadata(value: unknown): value is {
  type: string
  qualifiesForUnread: true
} {
  if (!_isPlainObject(value)) return false
  return typeof value.type === 'string'
    && value.qualifiesForUnread === true
}

export function getUnreadActivityCursor(entry: LogEntry, index: number): CardStateCursor | null {
  const activity = entry.object?.activity
  if (!isUnreadActivityMetadata(activity)) return null
  return {
    cursor: `${entry.timestamp}:${index}`,
    updatedAt: entry.timestamp,
  }
}

export function cursorsMatch(left: CardStateCursor | null, right: CardStateCursor | null): boolean {
  return left?.cursor === right?.cursor
}

// ---------------------------------------------------------------------------
// Exported diagnostic status interfaces
// ---------------------------------------------------------------------------

/**
 * Resolved storage/provider metadata for diagnostics and host surfaces.
 */
export interface StorageStatus {
  storageEngine: string
  providers: ResolvedCapabilities | null
  configStorage: ConfigStorageCapabilityResolution
  isFileBacked: boolean
  watchGlob: string | null
}

/**
 * Active auth provider metadata for diagnostics and host surfaces.
 */
export interface AuthStatus {
  identityProvider: string
  policyProvider: string
  identityEnabled: boolean
  policyEnabled: boolean
}

/**
 * Active webhook provider metadata for diagnostics and host surfaces.
 */
export interface WebhookStatus {
  webhookProvider: string
  webhookProviderActive: boolean
}

/** Active card-state provider metadata for diagnostics and host surfaces. */
export type CardStateRuntimeStatus = CardStateStatus

// ---------------------------------------------------------------------------
// Internal utility types
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ServiceMethodArgs<TMethod> =
  TMethod extends (ctx: any, ...args: infer TArgs) => any ? TArgs : never
/* eslint-enable @typescript-eslint/no-explicit-any */

export type MethodInput<TMethod> =
  ServiceMethodArgs<TMethod> extends [infer TFirst, ...unknown[]]
    ? TFirst
    : Record<string, unknown>

export type ReadonlySnapshot<T> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? readonly ReadonlySnapshot<U>[]
      : T extends object
        ? { readonly [K in keyof T]: ReadonlySnapshot<T[K]> }
        : T

export type ConfigStorageResolutionInput = Pick<KanbanConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>

export type PluginSettingsProviderReadModel = PluginSettingsReadPayload & Pick<
  PluginSettingsProviderRow,
  'packageName' | 'discoverySource' | 'optionsSchema'
>

// ---------------------------------------------------------------------------
// ListCardsOptions and helpers
// ---------------------------------------------------------------------------

/**
 * Optional search and sort inputs for {@link KanbanSDK.listCards}.
 */
export interface ListCardsOptions {
  metaFilter?: Record<string, string>
  sort?: CardSortOption
  searchQuery?: string
  fuzzy?: boolean
}

export const LIST_CARD_SORT_OPTIONS: ReadonlySet<CardSortOption> = new Set([
  'created:asc',
  'created:desc',
  'modified:asc',
  'modified:desc',
])

export function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value)
    && !Array.isArray(value)
    && typeof value === 'object'
    && Object.values(value as Record<string, unknown>).every(entry => typeof entry === 'string')
}

export function isCardSortOption(value: unknown): value is CardSortOption {
  return typeof value === 'string' && LIST_CARD_SORT_OPTIONS.has(value as CardSortOption)
}

export function isListCardsOptions(value: unknown): value is ListCardsOptions {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false
  const candidate = value as Partial<ListCardsOptions> & Record<string, unknown>
  if ('metaFilter' in candidate && candidate.metaFilter !== undefined && !isStringRecord(candidate.metaFilter)) return false
  if ('sort' in candidate && candidate.sort !== undefined && !isCardSortOption(candidate.sort)) return false
  if ('searchQuery' in candidate && candidate.searchQuery !== undefined && typeof candidate.searchQuery !== 'string') return false
  if ('fuzzy' in candidate && candidate.fuzzy !== undefined && typeof candidate.fuzzy !== 'boolean') return false
  return 'metaFilter' in candidate || 'sort' in candidate || 'searchQuery' in candidate || 'fuzzy' in candidate
}

export function normalizeListCardsOptions(
  optionsOrMetaFilter?: ListCardsOptions | Record<string, string>,
  sort?: CardSortOption,
  searchQuery?: string,
  fuzzy?: boolean,
): ListCardsOptions {
  if (sort !== undefined || searchQuery !== undefined || fuzzy !== undefined) {
    return {
      metaFilter: optionsOrMetaFilter as Record<string, string> | undefined,
      sort,
      searchQuery,
      fuzzy,
    }
  }

  if (!optionsOrMetaFilter) return {}

  return isListCardsOptions(optionsOrMetaFilter)
    ? optionsOrMetaFilter
    : { metaFilter: optionsOrMetaFilter }
}

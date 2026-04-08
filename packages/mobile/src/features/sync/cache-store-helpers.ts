import type { JsonValue } from '../../lib/api/contracts'
import { createExpoSecureStoreStorage } from '../../lib/expo-secure-store'
import type {
  CacheNamespace, CacheStorage, MemoryCacheStorage, AnyDraftRecord, DraftLocation,
  PersistedEnvelopeV1, PersistedNamespaceIndex, DraftError, PurgeReason, PurgeResult,
  HydrateWithPurgeCleanupOptions, HydrationResult, AttachmentDraftRecord, CacheStore,
} from './cache-store-types'
import {
  DEFAULT_SESSION_NAMESPACE, CACHE_STORAGE_INDEX_KEY, CACHE_INDEX_VERSION,
} from './cache-store-types'
import {
  isJsonObject, collectItems, readNamespace, readEnvelopeV1, migrateEnvelopeV0,
  namespacesEqual, buildCacheStorageKey, normalizeNamespace,
} from './cache-store-read'

export function readIndex(value: string | null): PersistedNamespaceIndex {
  if (!value) {
    return {
      version: CACHE_INDEX_VERSION,
      namespaces: [],
    }
  }

  try {
    const parsed = JSON.parse(value) as JsonValue
    if (!isJsonObject(parsed) || parsed.version !== CACHE_INDEX_VERSION || !Array.isArray(parsed.namespaces)) {
      return {
        version: CACHE_INDEX_VERSION,
        namespaces: [],
      }
    }

    return {
      version: CACHE_INDEX_VERSION,
      namespaces: collectItems(parsed.namespaces, (item) =>
        readNamespace(item, {
          defaultSessionNamespace: DEFAULT_SESSION_NAMESPACE,
          requireSessionNamespace: true,
        }),
      ),
    }
  } catch {
    return {
      version: CACHE_INDEX_VERSION,
      namespaces: [],
    }
  }
}

export function normalizeInterruptedDraft<T extends AnyDraftRecord>(
  draft: T,
  nowIso: string,
  preserveSending: boolean,
): T {
  if (preserveSending || draft.status !== 'sending') {
    return draft
  }

  return {
    ...draft,
    status: 'failed',
    updatedAt: nowIso,
    lastError: {
      code: 'interrupted_send',
      message: 'The previous send was interrupted. Tap resend to try again.',
    },
  }
}

export function normalizeHydratedEnvelope(
  envelope: PersistedEnvelopeV1,
  nowIso: string,
  options: {
    shouldPreserveSending?: (draft: AnyDraftRecord) => boolean
  } = {},
): { changed: boolean; envelope: PersistedEnvelopeV1 } {
  let changed = false

  const normalizeList = <T extends AnyDraftRecord>(items: T[]): T[] => {
    return items.map((item) => {
      const normalized = normalizeInterruptedDraft(
        item,
        nowIso,
        options.shouldPreserveSending?.(item) ?? false,
      )
      if (normalized !== item) {
        changed = true
      }
      return normalized
    })
  }

  const normalized: PersistedEnvelopeV1 = {
    ...envelope,
    drafts: {
      comments: normalizeList(envelope.drafts.comments),
      forms: normalizeList(envelope.drafts.forms),
      checklists: normalizeList(envelope.drafts.checklists),
    },
    attachments: {
      items: normalizeList(envelope.attachments.items),
    },
  }

  return {
    changed,
    envelope: normalized,
  }
}

export function defaultErrorForOutcome(outcome: 'conflict' | 'failed'): DraftError {
  return outcome === 'conflict'
    ? {
        code: 'sync_conflict',
        message: 'This draft conflicts with newer server state. Refresh and resend.',
      }
    : {
        code: 'send_failed',
        message: 'This draft failed to send. Tap resend to try again.',
      }
}

export function cloneDraftForClaim(draft: AnyDraftRecord): AnyDraftRecord {
  return {
    ...draft,
    ...(draft.kind === 'form' ? { data: { ...draft.data } } : {}),
  }
}

export function findDraftLocation(envelope: PersistedEnvelopeV1, draftId: string): DraftLocation | null {
  const collections: Array<DraftLocation['collection']> = [
    'comments',
    'forms',
    'checklists',
    'attachments',
  ]

  for (const collection of collections) {
    const items =
      collection === 'attachments'
        ? envelope.attachments.items
        : envelope.drafts[collection]
    const index = items.findIndex((draft) => draft.draftId === draftId)
    if (index >= 0) {
      return {
        collection,
        index,
        draft: items[index],
      }
    }
  }

  return null
}

export function replaceDraftAtLocation(
  envelope: PersistedEnvelopeV1,
  location: DraftLocation,
  draft: AnyDraftRecord,
): PersistedEnvelopeV1 {
  if (location.collection === 'attachments') {
    const nextItems = [...envelope.attachments.items]
    nextItems[location.index] = draft as AttachmentDraftRecord
    return {
      ...envelope,
      attachments: {
        items: nextItems,
      },
    }
  }

  const nextItems = [...envelope.drafts[location.collection]]
  nextItems[location.index] = draft as never
  return {
    ...envelope,
    drafts: {
      ...envelope.drafts,
      [location.collection]: nextItems,
    },
  }
}

export function removeDraftAtLocation(
  envelope: PersistedEnvelopeV1,
  location: DraftLocation,
): PersistedEnvelopeV1 {
  if (location.collection === 'attachments') {
    return {
      ...envelope,
      attachments: {
        items: envelope.attachments.items.filter((_, index) => index !== location.index),
      },
    }
  }

  return {
    ...envelope,
    drafts: {
      ...envelope.drafts,
      [location.collection]: envelope.drafts[location.collection].filter((_, index) => index !== location.index),
    },
  }
}

export function upsertByDraftId<T extends AnyDraftRecord>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.draftId === nextItem.draftId)
  if (index === -1) {
    return [...items, nextItem]
  }

  const nextItems = [...items]
  nextItems[index] = nextItem
  return nextItems
}

export function createExpoCacheStorage(): CacheStorage {
  return createExpoSecureStoreStorage()
}

export function createMemoryCacheStorage(initial: Record<string, string> = {}): MemoryCacheStorage {
  const data = new Map(Object.entries(initial))

  return {
    async getItem(key) {
      return data.get(key) ?? null
    },
    async setItem(key, value) {
      data.set(key, value)
    },
    async removeItem(key) {
      data.delete(key)
    },
    dump() {
      return Object.fromEntries(data.entries())
    },
  }
}

export async function cleanupPurgedDurableAttachments(
  durableAttachmentUris: readonly string[],
  options: HydrateWithPurgeCleanupOptions = {},
): Promise<void> {
  const deleteDurableAttachment = options.deleteDurableAttachment
  if (!deleteDurableAttachment) {
    return
  }

  for (const durableAttachmentUri of durableAttachmentUris) {
    try {
      await deleteDurableAttachment(durableAttachmentUri)
    } catch {
      // Durable attachment cleanup is best-effort; cache purge should still win.
    }
  }
}

export async function hydrateWithPurgeCleanup(
  store: Pick<CacheStore, 'hydrate'>,
  input: { namespace: CacheNamespace; sessionValidated: boolean },
  options: HydrateWithPurgeCleanupOptions = {},
): Promise<HydrationResult> {
  const hydrated = await store.hydrate(input)

  if (hydrated.kind === 'purged') {
    await cleanupPurgedDurableAttachments(hydrated.durableAttachmentUris, options)
  }

  return hydrated
}

export async function readNamespaceAttachmentDrafts(
  store: Pick<CacheStore, 'hydrate'>,
  namespace: CacheNamespace,
  options: HydrateWithPurgeCleanupOptions = {},
): Promise<AttachmentDraftRecord[]> {
  const hydrated = await hydrateWithPurgeCleanup(
    store,
    {
      namespace,
      sessionValidated: true,
    },
    options,
  )

  return hydrated.kind === 'hydrated' ? hydrated.envelope.attachments.items : []
}


import type { JsonValue } from '../../lib/api/contracts'
import type { CacheNamespace, CacheStore, CacheStoreDependencies, PersistedEnvelopeV1, PersistedNamespaceIndex, AnyDraftRecord, EnvelopeLoadResult, DraftLocation, DraftStatus, PurgeReason, PurgeResult, DraftError, QueueDraftInput, QueueAttachmentDraftInput, HydrationResult, ClaimExplicitResendResult, ResolveExplicitResendInput, ResolveExplicitResendResult, DiscardDraftResult, AttachmentDraftRecord } from './cache-store-types'
import { DEFAULT_SESSION_NAMESPACE, CACHE_STORAGE_INDEX_KEY, CACHE_INDEX_VERSION, CACHE_STORAGE_VERSION } from './cache-store-types'
import { isJsonObject, namespacesEqual, buildCacheStorageKey, createEmptyEnvelope, readEnvelopeV1, readSnapshots, readNamespace, normalizeNamespace, migrateEnvelopeV0 } from './cache-store-read'
import { readIndex, normalizeInterruptedDraft, normalizeHydratedEnvelope, defaultErrorForOutcome, cloneDraftForClaim, findDraftLocation, replaceDraftAtLocation, removeDraftAtLocation, upsertByDraftId, createExpoCacheStorage } from './cache-store-helpers'
export type { MobileCacheSnapshots, MobileHomeSnapshot, MobileTaskDetailSnapshot } from '../../lib/api/contracts'
export { DEFAULT_SESSION_NAMESPACE, CACHE_STORAGE_INDEX_KEY, CACHE_STORAGE_KEY_PREFIX } from './cache-store-types'
export type { DraftStatus, PurgeReason, CacheNamespace, DraftError, QueueDraftInput, QueueAttachmentDraftInput, PersistedEnvelopeV1, CacheStorage, MemoryCacheStorage, HydrateWithPurgeCleanupOptions, HydrationResult, ClaimExplicitResendResult, ResolveExplicitResendInput, ResolveExplicitResendResult, DiscardDraftResult, PurgeResult, CacheStore, AttachmentDraftRecord, ChecklistDraftRecord, CommentDraftRecord, FormDraftRecord } from './cache-store-types'
export { buildCacheStorageKey } from './cache-store-read'
export { createExpoCacheStorage, createMemoryCacheStorage, cleanupPurgedDurableAttachments, hydrateWithPurgeCleanup, readNamespaceAttachmentDrafts } from './cache-store-helpers'

export function createCacheStore(dependencies: CacheStoreDependencies = {}): CacheStore {
  const storage = dependencies.storage ?? createExpoCacheStorage()
  const now = dependencies.now ?? (() => new Date())
  const defaultSessionNamespace =
    dependencies.defaultSessionNamespace ?? DEFAULT_SESSION_NAMESPACE
  const inFlightResends = new Set<string>()

  const nowIso = () => now().toISOString()

  const persistIndex = async (index: PersistedNamespaceIndex): Promise<void> => {
    if (index.namespaces.length === 0) {
      await storage.removeItem(CACHE_STORAGE_INDEX_KEY)
      return
    }

    await storage.setItem(CACHE_STORAGE_INDEX_KEY, JSON.stringify(index))
  }

  const addNamespaceToIndex = async (namespace: CacheNamespace): Promise<void> => {
    const current = readIndex(await storage.getItem(CACHE_STORAGE_INDEX_KEY))
    if (current.namespaces.some((item) => namespacesEqual(item, namespace))) {
      return
    }

    await persistIndex({
      version: CACHE_INDEX_VERSION,
      namespaces: [...current.namespaces, namespace],
    })
  }

  const removeNamespaceFromIndex = async (namespace: CacheNamespace): Promise<void> => {
    const current = readIndex(await storage.getItem(CACHE_STORAGE_INDEX_KEY))
    await persistIndex({
      version: CACHE_INDEX_VERSION,
      namespaces: current.namespaces.filter((item) => !namespacesEqual(item, namespace)),
    })
  }

  const persistEnvelope = async (envelope: PersistedEnvelopeV1): Promise<PersistedEnvelopeV1> => {
    const normalizedNamespace = normalizeNamespace(envelope.namespace, defaultSessionNamespace)
    const nextEnvelope: PersistedEnvelopeV1 = {
      ...envelope,
      namespace: normalizedNamespace,
      version: CACHE_STORAGE_VERSION,
      persistedAt: nowIso(),
    }

    await storage.setItem(buildCacheStorageKey(normalizedNamespace), JSON.stringify(nextEnvelope))
    await addNamespaceToIndex(normalizedNamespace)
    return nextEnvelope
  }

  const decodeEnvelope = (
    raw: string,
  ):
    | {
        kind: 'ready'
        envelope: PersistedEnvelopeV1
        migratedFromVersion?: 0
      }
    | {
        kind: 'error'
        reason: Extract<PurgeReason, 'corrupt' | 'migration-failed' | 'unknown-version'>
      } => {
    let parsed: JsonValue

    try {
      parsed = JSON.parse(raw) as JsonValue
    } catch {
      return {
        kind: 'error',
        reason: 'corrupt',
      }
    }

    if (!isJsonObject(parsed)) {
      return {
        kind: 'error',
        reason: 'corrupt',
      }
    }

    if (parsed.version === CACHE_STORAGE_VERSION) {
      const envelope = readEnvelopeV1(parsed, { defaultSessionNamespace })
      return envelope
        ? {
            kind: 'ready',
            envelope,
          }
        : {
            kind: 'error',
            reason: 'corrupt',
          }
    }

    if (parsed.version === 0) {
      const migrated = migrateEnvelopeV0(parsed, {
        defaultSessionNamespace,
        nowIso: nowIso(),
      })
      return migrated
        ? {
            kind: 'ready',
            envelope: migrated,
            migratedFromVersion: 0,
          }
        : {
            kind: 'error',
            reason: 'migration-failed',
          }
    }

    return {
      kind: 'error',
      reason: 'unknown-version',
    }
  }

  const loadEnvelope = async (namespace: CacheNamespace): Promise<EnvelopeLoadResult> => {
    const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
    const raw = await storage.getItem(buildCacheStorageKey(normalizedNamespace))
    if (!raw) {
      return {
        kind: 'empty',
      }
    }

    const decoded = decodeEnvelope(raw)
    if (decoded.kind === 'error') {
      await storage.removeItem(buildCacheStorageKey(normalizedNamespace))
      await removeNamespaceFromIndex(normalizedNamespace)
      return {
        kind: 'purged',
        reason: decoded.reason,
        durableAttachmentUris: [],
      }
    }

    return decoded.migratedFromVersion === undefined
      ? {
          kind: 'ready',
          envelope: decoded.envelope,
        }
      : {
          kind: 'ready',
          envelope: decoded.envelope,
          migratedFromVersion: decoded.migratedFromVersion,
        }
  }

  const loadOrCreateEnvelope = async (namespace: CacheNamespace): Promise<PersistedEnvelopeV1> => {
    const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
    const loaded = await loadEnvelope(normalizedNamespace)
    if (loaded.kind === 'ready') {
      const normalized = normalizeHydratedEnvelope(loaded.envelope, nowIso(), {
        shouldPreserveSending: (draft) => inFlightResends.has(buildInflightKey(normalizedNamespace, draft.draftId)),
      })
      if (loaded.migratedFromVersion !== undefined || normalized.changed) {
        return persistEnvelope(normalized.envelope)
      }
      return loaded.envelope
    }

    return createEmptyEnvelope(normalizedNamespace, nowIso())
  }

  const buildInflightKey = (namespace: CacheNamespace, draftId: string): string => {
    return `${buildCacheStorageKey(namespace)}::${draftId}`
  }

  const purgeNamespaceInternal = async (
    namespace: CacheNamespace,
    reason: PurgeReason,
  ): Promise<PurgeResult> => {
    const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
    const loaded = await loadEnvelope(normalizedNamespace)
    const durableAttachmentUris =
      loaded.kind === 'ready'
        ? loaded.envelope.attachments.items.map((item) => item.uri)
        : []

    await storage.removeItem(buildCacheStorageKey(normalizedNamespace))
    await removeNamespaceFromIndex(normalizedNamespace)

    for (const key of [...inFlightResends]) {
      if (key.startsWith(`${buildCacheStorageKey(normalizedNamespace)}::`)) {
        inFlightResends.delete(key)
      }
    }

    return {
      purged: loaded.kind !== 'empty',
      reason,
      durableAttachmentUris,
    }
  }

  return {
    async hydrate(input) {
      const normalizedNamespace = normalizeNamespace(input.namespace, defaultSessionNamespace)

      if (!input.sessionValidated) {
        return {
          kind: 'blocked',
        }
      }

      const loaded = await loadEnvelope(normalizedNamespace)
      if (loaded.kind === 'empty') {
        return {
          kind: 'empty',
        }
      }

      if (loaded.kind === 'purged') {
        return {
          kind: 'purged',
          reason: loaded.reason,
          durableAttachmentUris: loaded.durableAttachmentUris,
        }
      }

      if (!namespacesEqual(loaded.envelope.namespace, normalizedNamespace)) {
        const purge = await purgeNamespaceInternal(normalizedNamespace, 'namespace-mismatch')
        return {
          kind: 'purged',
          reason: 'namespace-mismatch',
          durableAttachmentUris: purge.durableAttachmentUris,
        }
      }

      const normalized = normalizeHydratedEnvelope(loaded.envelope, nowIso(), {
        shouldPreserveSending: (draft) => inFlightResends.has(buildInflightKey(normalizedNamespace, draft.draftId)),
      })
      const envelope =
        loaded.migratedFromVersion !== undefined || normalized.changed
          ? await persistEnvelope(normalized.envelope)
          : loaded.envelope

      return loaded.migratedFromVersion === undefined
        ? {
            kind: 'hydrated',
            envelope,
          }
        : {
            kind: 'hydrated',
            envelope,
            migratedFromVersion: loaded.migratedFromVersion,
          }
    },

    async replaceSnapshots(namespace, snapshots) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      return persistEnvelope({
        ...envelope,
        snapshots: {
          ...envelope.snapshots,
          ...snapshots,
        },
      })
    },

    async queueDraft(namespace, input) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      const timestamp = nowIso()
      const location = findDraftLocation(envelope, input.draftId)
      const existingCreatedAt = location?.draft.createdAt ?? timestamp

      if (input.kind === 'comment') {
        const operation = input.operation ?? 'create'
        const commentId = operation === 'update'
          ? (typeof input.commentId === 'string' ? input.commentId.trim() : '')
          : null

        if (operation === 'update' && (!commentId || commentId.length === 0)) {
          throw new Error('commentId is required for comment update drafts.')
        }

        return persistEnvelope({
          ...envelope,
          drafts: {
            ...envelope.drafts,
            comments: upsertByDraftId(envelope.drafts.comments, {
              kind: 'comment',
              draftId: input.draftId,
              taskId: input.taskId,
              operation,
              commentId,
              author: input.author,
              content: input.content,
              createdAt: existingCreatedAt,
              updatedAt: timestamp,
              status: 'draft',
              lastError: null,
            }),
          },
        })
      }

      if (input.kind === 'form') {
        return persistEnvelope({
          ...envelope,
          drafts: {
            ...envelope.drafts,
            forms: upsertByDraftId(envelope.drafts.forms, {
              kind: 'form',
              draftId: input.draftId,
              taskId: input.taskId,
              formId: input.formId,
              data: input.data,
              createdAt: existingCreatedAt,
              updatedAt: timestamp,
              status: 'draft',
              lastError: null,
            }),
          },
        })
      }

      return persistEnvelope({
        ...envelope,
        drafts: {
          ...envelope.drafts,
          checklists: upsertByDraftId(envelope.drafts.checklists, {
            kind: 'checklist',
            draftId: input.draftId,
            taskId: input.taskId,
            action: input.action,
            itemIndex: input.itemIndex ?? null,
            text: input.text ?? null,
            expectedRaw: input.expectedRaw ?? null,
            expectedToken: input.expectedToken ?? null,
            createdAt: existingCreatedAt,
            updatedAt: timestamp,
            status: 'draft',
            lastError: null,
          }),
        },
      })
    },

    async queueAttachmentDraft(namespace, input) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      const timestamp = nowIso()
      const location = findDraftLocation(envelope, input.draftId)
      const existingCreatedAt = location?.draft.createdAt ?? timestamp

      return persistEnvelope({
        ...envelope,
        attachments: {
          items: upsertByDraftId(envelope.attachments.items, {
            kind: 'attachment',
            draftId: input.draftId,
            taskId: input.taskId,
            workspaceOrigin: normalizedNamespace.workspaceOrigin,
            workspaceId: normalizedNamespace.workspaceId,
            subject: normalizedNamespace.subject,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256 ?? null,
            uri: input.uri,
            expiresAt: input.expiresAt,
            createdAt: existingCreatedAt,
            updatedAt: timestamp,
            status: 'draft',
            lastError: null,
          }),
        },
      })
    },

    async discardDraft(namespace, draftId) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      if (inFlightResends.has(buildInflightKey(normalizedNamespace, draftId))) {
        return {
          draft: null,
          removedAttachmentUri: null,
        }
      }

      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      const location = findDraftLocation(envelope, draftId)
      if (!location) {
        return {
          draft: null,
          removedAttachmentUri: null,
        }
      }

      const removedAttachmentUri =
        location.collection === 'attachments'
          ? (location.draft as AttachmentDraftRecord).uri
          : null

      await persistEnvelope(removeDraftAtLocation(envelope, location))

      return {
        draft: cloneDraftForClaim(location.draft),
        removedAttachmentUri,
      }
    },

    async claimExplicitResend(namespace, draftId) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      const inFlightKey = buildInflightKey(normalizedNamespace, draftId)
      if (inFlightResends.has(inFlightKey)) {
        return {
          claimed: false,
          reason: 'duplicate-send',
        }
      }

      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      const location = findDraftLocation(envelope, draftId)
      if (!location) {
        return {
          claimed: false,
          reason: 'draft-not-found',
        }
      }

      inFlightResends.add(inFlightKey)
      const claimedDraft: AnyDraftRecord = {
        ...location.draft,
        status: 'sending',
        updatedAt: nowIso(),
        lastError: null,
      }
      const persisted = await persistEnvelope(
        replaceDraftAtLocation(envelope, location, claimedDraft),
      )
      const refreshedLocation = findDraftLocation(persisted, draftId)

      return {
        claimed: true,
        draft: cloneDraftForClaim(refreshedLocation?.draft ?? claimedDraft),
      }
    },

    async resolveExplicitResend(namespace, draftId, input) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      inFlightResends.delete(buildInflightKey(normalizedNamespace, draftId))

      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      const location = findDraftLocation(envelope, draftId)
      if (!location) {
        return {
          draft: null,
          removedAttachmentUri: null,
        }
      }

      if (input.outcome === 'sent') {
        const removedAttachmentUri =
          location.collection === 'attachments' ? (location.draft as AttachmentDraftRecord).uri : null
        await persistEnvelope(removeDraftAtLocation(envelope, location))
        return {
          draft: null,
          removedAttachmentUri,
        }
      }

      const updatedDraft: AnyDraftRecord = {
        ...location.draft,
        status: input.outcome,
        updatedAt: nowIso(),
        lastError: input.error ?? defaultErrorForOutcome(input.outcome),
      }
      const persisted = await persistEnvelope(
        replaceDraftAtLocation(envelope, location, updatedDraft),
      )
      const refreshedLocation = findDraftLocation(persisted, draftId)

      return {
        draft: refreshedLocation?.draft ?? updatedDraft,
        removedAttachmentUri: null,
      }
    },

    async markAttachmentMissingLocalFile(namespace, draftId) {
      const normalizedNamespace = normalizeNamespace(namespace, defaultSessionNamespace)
      const envelope = await loadOrCreateEnvelope(normalizedNamespace)
      const location = findDraftLocation(envelope, draftId)
      if (!location || location.collection !== 'attachments') {
        return null
      }

      const updatedDraft: AttachmentDraftRecord = {
        ...(location.draft as AttachmentDraftRecord),
        status: 'failed',
        updatedAt: nowIso(),
        lastError: {
          code: 'missing_local_file',
          message: 'The durable local attachment copy is missing. Remove or recapture it.',
        },
      }
      const persisted = await persistEnvelope(
        replaceDraftAtLocation(envelope, location, updatedDraft),
      )
      const refreshedLocation = findDraftLocation(persisted, draftId)
      return refreshedLocation?.draft as AttachmentDraftRecord | null
    },

    async purgeNamespace(namespace, reason) {
      return purgeNamespaceInternal(namespace, reason)
    },

    async purgeForLogout(namespace) {
      return purgeNamespaceInternal(namespace, 'logout')
    },

    async purgeForReauth(previousNamespace, nextNamespace) {
      const previous = normalizeNamespace(previousNamespace, defaultSessionNamespace)
      const next = normalizeNamespace(nextNamespace, defaultSessionNamespace)
      if (namespacesEqual(previous, next)) {
        return {
          purged: false,
          reason: 'reauth',
          durableAttachmentUris: [],
        }
      }

      return purgeNamespaceInternal(previous, 'reauth')
    },

    async purgeForWorkspaceSwitch(previousNamespace, nextNamespace) {
      const previous = normalizeNamespace(previousNamespace, defaultSessionNamespace)
      const next = normalizeNamespace(nextNamespace, defaultSessionNamespace)
      if (
        previous.workspaceOrigin === next.workspaceOrigin &&
        previous.workspaceId === next.workspaceId
      ) {
        return {
          purged: false,
          reason: 'workspace-switch',
          durableAttachmentUris: [],
        }
      }

      return purgeNamespaceInternal(previous, 'workspace-switch')
    },

    async purgeForRevocation(namespace, status) {
      if (status !== 401 && status !== 403) {
        return {
          purged: false,
          reason: 'session-revoked',
          durableAttachmentUris: [],
        }
      }

      return purgeNamespaceInternal(namespace, 'session-revoked')
    },

    async clearAll() {
      const index = readIndex(await storage.getItem(CACHE_STORAGE_INDEX_KEY))
      const durableAttachmentUris: string[] = []
      let purged = false

      for (const namespace of index.namespaces) {
        const result = await purgeNamespaceInternal(namespace, 'manual-clear')
        purged = purged || result.purged
        durableAttachmentUris.push(...result.durableAttachmentUris)
      }

      await storage.removeItem(CACHE_STORAGE_INDEX_KEY)

      return {
        purged,
        reason: 'manual-clear',
        durableAttachmentUris,
      }
    },
  }
}

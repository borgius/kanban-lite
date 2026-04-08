import type {
  JsonObject,
  JsonValue,
  MobileCacheSnapshots,
} from '../../lib/api/contracts'
import { createExpoSecureStoreStorage } from '../../lib/expo-secure-store'

export type {
  MobileCacheSnapshots,
  MobileHomeSnapshot,
  MobileTaskDetailSnapshot,
} from '../../lib/api/contracts'

export const DEFAULT_SESSION_NAMESPACE = 'local-mobile-session-v1'
export const CACHE_STORAGE_INDEX_KEY = 'kanban-lite/mobile-sync-cache-index-v1'
export const CACHE_STORAGE_KEY_PREFIX = 'kanban-lite/mobile-sync-cache-v1:'

export const CACHE_STORAGE_VERSION = 1 as const
export const CACHE_INDEX_VERSION = 1 as const

export type DraftStatus = 'conflict' | 'draft' | 'failed' | 'sending' | 'sent'
export type PurgeReason =
  | 'corrupt'
  | 'logout'
  | 'manual-clear'
  | 'migration-failed'
  | 'namespace-mismatch'
  | 'reauth'
  | 'session-revoked'
  | 'unknown-version'
  | 'workspace-switch'

export interface CacheNamespace {
  workspaceOrigin: string
  workspaceId: string
  subject: string
  sessionNamespace: string
}

export interface DraftError {
  code: string
  message: string
}

export interface DraftBase {
  draftId: string
  taskId: string
  createdAt: string
  updatedAt: string
  status: DraftStatus
  lastError: DraftError | null
}

export interface CommentDraftRecord extends DraftBase {
  kind: 'comment'
  operation: 'create' | 'update'
  commentId: string | null
  author: string
  content: string
}

export interface FormDraftRecord extends DraftBase {
  kind: 'form'
  formId: string
  data: JsonObject
}

export interface ChecklistDraftRecord extends DraftBase {
  kind: 'checklist'
  action: 'add' | 'check' | 'delete' | 'edit' | 'uncheck'
  itemIndex: number | null
  text: string | null
  expectedRaw: string | null
  expectedToken: string | null
}

export interface AttachmentDraftRecord extends DraftBase {
  kind: 'attachment'
  workspaceOrigin: string
  workspaceId: string
  subject: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string | null
  uri: string
  expiresAt: string
}

export type QueueDraftInput =
  | {
      kind: 'comment'
      draftId: string
      taskId: string
      author: string
      content: string
      operation?: 'create'
      commentId?: null
    }
  | {
      kind: 'comment'
      draftId: string
      taskId: string
      author: string
      content: string
      operation: 'update'
      commentId: string
    }
  | {
      kind: 'form'
      draftId: string
      taskId: string
      formId: string
      data: JsonObject
    }
  | {
      kind: 'checklist'
      draftId: string
      taskId: string
      action: ChecklistDraftRecord['action']
      itemIndex?: number | null
      text?: string | null
      expectedRaw?: string | null
      expectedToken?: string | null
    }

export interface QueueAttachmentDraftInput {
  draftId: string
  taskId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256?: string | null
  uri: string
  expiresAt: string
}

export interface PersistedEnvelopeV1 {
  version: typeof CACHE_STORAGE_VERSION
  namespace: CacheNamespace
  persistedAt: string
  snapshots: MobileCacheSnapshots
  drafts: {
    comments: CommentDraftRecord[]
    forms: FormDraftRecord[]
    checklists: ChecklistDraftRecord[]
  }
  attachments: {
    items: AttachmentDraftRecord[]
  }
}

export interface CacheStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface MemoryCacheStorage extends CacheStorage {
  dump(): Record<string, string>
}

export interface HydrateWithPurgeCleanupOptions {
  deleteDurableAttachment?: (uri: string) => Promise<void>
}

export type HydrationResult =
  | { kind: 'blocked' }
  | { kind: 'empty' }
  | {
      kind: 'hydrated'
      envelope: PersistedEnvelopeV1
      migratedFromVersion?: 0
    }
  | {
      kind: 'purged'
      reason: Extract<PurgeReason, 'corrupt' | 'migration-failed' | 'namespace-mismatch' | 'unknown-version'>
      durableAttachmentUris: string[]
    }

export type ClaimExplicitResendResult =
  | {
      claimed: true
      draft: AnyDraftRecord
    }
  | {
      claimed: false
      reason: 'draft-not-found' | 'duplicate-send'
    }

export interface ResolveExplicitResendInput {
  outcome: 'conflict' | 'failed' | 'sent'
  error?: DraftError
}

export interface ResolveExplicitResendResult {
  draft: AnyDraftRecord | null
  removedAttachmentUri: string | null
}

export interface DiscardDraftResult {
  draft: AnyDraftRecord | null
  removedAttachmentUri: string | null
}

export interface PurgeResult {
  purged: boolean
  reason: PurgeReason
  durableAttachmentUris: string[]
}

export interface CacheStore {
  hydrate(input: { namespace: CacheNamespace; sessionValidated: boolean }): Promise<HydrationResult>
  replaceSnapshots(
    namespace: CacheNamespace,
    snapshots: MobileCacheSnapshots,
  ): Promise<PersistedEnvelopeV1>
  queueDraft(namespace: CacheNamespace, input: QueueDraftInput): Promise<PersistedEnvelopeV1>
  queueAttachmentDraft(
    namespace: CacheNamespace,
    input: QueueAttachmentDraftInput,
  ): Promise<PersistedEnvelopeV1>
  discardDraft(namespace: CacheNamespace, draftId: string): Promise<DiscardDraftResult>
  claimExplicitResend(
    namespace: CacheNamespace,
    draftId: string,
  ): Promise<ClaimExplicitResendResult>
  resolveExplicitResend(
    namespace: CacheNamespace,
    draftId: string,
    input: ResolveExplicitResendInput,
  ): Promise<ResolveExplicitResendResult>
  markAttachmentMissingLocalFile(
    namespace: CacheNamespace,
    draftId: string,
  ): Promise<AttachmentDraftRecord | null>
  purgeNamespace(namespace: CacheNamespace, reason: PurgeReason): Promise<PurgeResult>
  purgeForLogout(namespace: CacheNamespace): Promise<PurgeResult>
  purgeForReauth(previousNamespace: CacheNamespace, nextNamespace: CacheNamespace): Promise<PurgeResult>
  purgeForWorkspaceSwitch(
    previousNamespace: CacheNamespace,
    nextNamespace: CacheNamespace,
  ): Promise<PurgeResult>
  purgeForRevocation(namespace: CacheNamespace, status: number): Promise<PurgeResult>
  clearAll(): Promise<PurgeResult>
}

export interface CacheStoreDependencies {
  storage?: CacheStorage
  now?: () => Date
  defaultSessionNamespace?: string
}

export interface PersistedNamespaceIndex {
  version: typeof CACHE_INDEX_VERSION
  namespaces: CacheNamespace[]
}

export type AnyDraftRecord =
  | AttachmentDraftRecord
  | ChecklistDraftRecord
  | CommentDraftRecord
  | FormDraftRecord

export type EnvelopeLoadResult =
  | { kind: 'empty' }
  | {
      kind: 'ready'
      envelope: PersistedEnvelopeV1
      migratedFromVersion?: 0
    }
  | {
      kind: 'purged'
      reason: Extract<PurgeReason, 'corrupt' | 'migration-failed' | 'unknown-version'>
      durableAttachmentUris: string[]
    }

export interface DraftLocation {
  collection: 'attachments' | 'checklists' | 'comments' | 'forms'
  index: number
  draft: AnyDraftRecord
}

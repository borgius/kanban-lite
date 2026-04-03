import type {
  JsonObject,
  JsonValue,
  MobileCacheSnapshots,
} from '../../lib/api/contracts'

export type {
  MobileCacheSnapshots,
  MobileHomeSnapshot,
  MobileTaskDetailSnapshot,
} from '../../lib/api/contracts'

export const DEFAULT_SESSION_NAMESPACE = 'local-mobile-session-v1'
export const CACHE_STORAGE_INDEX_KEY = 'kanban-lite/mobile-sync-cache-index-v1'
export const CACHE_STORAGE_KEY_PREFIX = 'kanban-lite/mobile-sync-cache-v1:'

const CACHE_STORAGE_VERSION = 1 as const
const CACHE_INDEX_VERSION = 1 as const

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

interface DraftBase {
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

interface CacheStoreDependencies {
  storage?: CacheStorage
  now?: () => Date
  defaultSessionNamespace?: string
}

interface PersistedNamespaceIndex {
  version: typeof CACHE_INDEX_VERSION
  namespaces: CacheNamespace[]
}

type AnyDraftRecord =
  | AttachmentDraftRecord
  | ChecklistDraftRecord
  | CommentDraftRecord
  | FormDraftRecord

type EnvelopeLoadResult =
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

interface DraftLocation {
  collection: 'attachments' | 'checklists' | 'comments' | 'forms'
  index: number
  draft: AnyDraftRecord
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectItems<T>(values: JsonValue[] | undefined, parser: (value: JsonValue) => T | null): T[] {
  const items: T[] = []
  for (const value of values ?? []) {
    const parsed = parser(value)
    if (parsed) {
      items.push(parsed)
    }
  }
  return items
}

function readString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readOptionalString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readDraftStatus(value: JsonValue | undefined): DraftStatus | null {
  if (
    value === 'conflict' ||
    value === 'draft' ||
    value === 'failed' ||
    value === 'sending' ||
    value === 'sent'
  ) {
    return value
  }

  return null
}

function normalizeWorkspaceOrigin(workspaceOrigin: string): string {
  let parsed: URL

  try {
    parsed = new URL(workspaceOrigin.trim())
  } catch {
    throw new Error('workspaceOrigin must be an absolute URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('workspaceOrigin must use http or https.')
  }

  return parsed.origin.toLowerCase()
}

function normalizeNamespace(
  namespace: CacheNamespace,
  defaultSessionNamespace = DEFAULT_SESSION_NAMESPACE,
): CacheNamespace {
  const workspaceId = namespace.workspaceId.trim()
  const subject = namespace.subject.trim()
  const sessionNamespace = namespace.sessionNamespace.trim() || defaultSessionNamespace

  if (workspaceId.length === 0) {
    throw new Error('workspaceId is required.')
  }

  if (subject.length === 0) {
    throw new Error('subject is required.')
  }

  return {
    workspaceOrigin: normalizeWorkspaceOrigin(namespace.workspaceOrigin),
    workspaceId,
    subject,
    sessionNamespace,
  }
}

function namespacesEqual(left: CacheNamespace, right: CacheNamespace): boolean {
  return (
    left.workspaceOrigin === right.workspaceOrigin &&
    left.workspaceId === right.workspaceId &&
    left.subject === right.subject &&
    left.sessionNamespace === right.sessionNamespace
  )
}

export function buildCacheStorageKey(namespace: CacheNamespace): string {
  const normalized = normalizeNamespace(namespace)
  return [
    CACHE_STORAGE_KEY_PREFIX,
    encodeURIComponent(normalized.workspaceOrigin),
    ':',
    encodeURIComponent(normalized.workspaceId),
    ':',
    encodeURIComponent(normalized.subject),
    ':',
    encodeURIComponent(normalized.sessionNamespace),
  ].join('')
}

function createEmptyEnvelope(namespace: CacheNamespace, persistedAt: string): PersistedEnvelopeV1 {
  return {
    version: CACHE_STORAGE_VERSION,
    namespace,
    persistedAt,
    snapshots: {},
    drafts: {
      comments: [],
      forms: [],
      checklists: [],
    },
    attachments: {
      items: [],
    },
  }
}

function readDraftError(value: JsonValue | undefined): DraftError | null {
  if (!isJsonObject(value)) {
    return null
  }

  const code = readString(value.code)
  const message = readString(value.message)
  if (!code || !message) {
    return null
  }

  return {
    code,
    message,
  }
}

function readBaseDraft(value: JsonValue): DraftBase | null {
  if (!isJsonObject(value)) {
    return null
  }

  const draftId = readString(value.draftId)
  const taskId = readString(value.taskId)
  const createdAt = readString(value.createdAt)
  const updatedAt = readString(value.updatedAt)
  const status = readDraftStatus(value.status)

  if (!draftId || !taskId || !createdAt || !updatedAt || !status) {
    return null
  }

  return {
    draftId,
    taskId,
    createdAt,
    updatedAt,
    status,
    lastError: readDraftError(value.lastError),
  }
}

function readCommentDraft(value: JsonValue): CommentDraftRecord | null {
  const base = readBaseDraft(value)
  if (!base || !isJsonObject(value)) {
    return null
  }

  const author = readString(value.author)
  const content = readString(value.content)
  const rawOperation = readOptionalString(value.operation)
  const operation = rawOperation === 'update' ? 'update' : 'create'
  const commentId = readOptionalString(value.commentId)

  if (!author || !content || (operation === 'update' && !commentId)) {
    return null
  }

  return {
    ...base,
    kind: 'comment',
    operation,
    commentId: operation === 'update' ? commentId : null,
    author,
    content,
  }
}

function readFormDraft(value: JsonValue): FormDraftRecord | null {
  const base = readBaseDraft(value)
  if (!base || !isJsonObject(value)) {
    return null
  }

  const formId = readString(value.formId)
  const data = isJsonObject(value.data) ? value.data : null
  if (!formId || !data) {
    return null
  }

  return {
    ...base,
    kind: 'form',
    formId,
    data,
  }
}

function readChecklistDraft(value: JsonValue): ChecklistDraftRecord | null {
  const base = readBaseDraft(value)
  if (!base || !isJsonObject(value)) {
    return null
  }

  const action = readString(value.action)
  if (
    action !== 'add' &&
    action !== 'check' &&
    action !== 'delete' &&
    action !== 'edit' &&
    action !== 'uncheck'
  ) {
    return null
  }

  return {
    ...base,
    kind: 'checklist',
    action,
    itemIndex: readNumber(value.itemIndex),
    text: readOptionalString(value.text),
    expectedRaw: readOptionalString(value.expectedRaw),
    expectedToken: readOptionalString(value.expectedToken),
  }
}

function readAttachmentDraft(
  value: JsonValue,
  fallbackNamespace: CacheNamespace,
): AttachmentDraftRecord | null {
  const base = readBaseDraft(value)
  if (!base || !isJsonObject(value)) {
    return null
  }

  const fileName = readString(value.fileName)
  const mimeType = readString(value.mimeType)
  const sizeBytes = readNumber(value.sizeBytes)
  const uri = readString(value.uri)
  const expiresAt = readString(value.expiresAt)

  if (!fileName || !mimeType || sizeBytes === null || !uri || !expiresAt) {
    return null
  }

  return {
    ...base,
    kind: 'attachment',
    workspaceOrigin: readOptionalString(value.workspaceOrigin) ?? fallbackNamespace.workspaceOrigin,
    workspaceId: readOptionalString(value.workspaceId) ?? fallbackNamespace.workspaceId,
    subject: readOptionalString(value.subject) ?? fallbackNamespace.subject,
    fileName,
    mimeType,
    sizeBytes,
    sha256: readOptionalString(value.sha256),
    uri,
    expiresAt,
  }
}

function readNamespace(
  value: JsonValue | undefined,
  options: { defaultSessionNamespace: string; requireSessionNamespace: boolean },
): CacheNamespace | null {
  if (!isJsonObject(value)) {
    return null
  }

  const workspaceOrigin = readString(value.workspaceOrigin)
  const workspaceId = readString(value.workspaceId)
  const subject = readString(value.subject)
  const sessionNamespace = readString(value.sessionNamespace)

  if (!workspaceOrigin || !workspaceId || !subject) {
    return null
  }

  if (options.requireSessionNamespace && !sessionNamespace) {
    return null
  }

  return normalizeNamespace(
    {
      workspaceOrigin,
      workspaceId,
      subject,
      sessionNamespace: sessionNamespace ?? options.defaultSessionNamespace,
    },
    options.defaultSessionNamespace,
  )
}

function readSnapshots(value: JsonValue | undefined): MobileCacheSnapshots {
  return isJsonObject(value) ? value : {}
}

function migrateEnvelopeV0(
  raw: JsonObject,
  options: { defaultSessionNamespace: string; nowIso: string },
): PersistedEnvelopeV1 | null {
  const namespace = readNamespace(raw.namespace, {
    defaultSessionNamespace: options.defaultSessionNamespace,
    requireSessionNamespace: false,
  })
  if (!namespace) {
    return null
  }

  const draftsObject = isJsonObject(raw.drafts) ? raw.drafts : undefined
  const attachments = collectItems(raw.attachments as JsonValue[] | undefined, (item) =>
    readAttachmentDraft(item, namespace),
  )

  return {
    version: CACHE_STORAGE_VERSION,
    namespace,
    persistedAt: readString(raw.persistedAt) ?? options.nowIso,
    snapshots: readSnapshots(raw.snapshots),
    drafts: {
      comments: collectItems(draftsObject?.comments as JsonValue[] | undefined, readCommentDraft),
      forms: collectItems(draftsObject?.forms as JsonValue[] | undefined, readFormDraft),
      checklists: collectItems(
        draftsObject?.checklists as JsonValue[] | undefined,
        readChecklistDraft,
      ),
    },
    attachments: {
      items: attachments.map((draft) => ({
        ...draft,
        workspaceOrigin: namespace.workspaceOrigin,
        workspaceId: namespace.workspaceId,
        subject: namespace.subject,
      })),
    },
  }
}

function readEnvelopeV1(
  raw: JsonObject,
  options: { defaultSessionNamespace: string },
): PersistedEnvelopeV1 | null {
  const namespace = readNamespace(raw.namespace, {
    defaultSessionNamespace: options.defaultSessionNamespace,
    requireSessionNamespace: true,
  })
  if (!namespace) {
    return null
  }

  const drafts = isJsonObject(raw.drafts) ? raw.drafts : undefined
  const attachments = isJsonObject(raw.attachments) ? raw.attachments : undefined

  return {
    version: CACHE_STORAGE_VERSION,
    namespace,
    persistedAt: readString(raw.persistedAt) ?? new Date(0).toISOString(),
    snapshots: readSnapshots(raw.snapshots),
    drafts: {
      comments: collectItems(drafts?.comments as JsonValue[] | undefined, readCommentDraft),
      forms: collectItems(drafts?.forms as JsonValue[] | undefined, readFormDraft),
      checklists: collectItems(drafts?.checklists as JsonValue[] | undefined, readChecklistDraft),
    },
    attachments: {
      items: collectItems(attachments?.items as JsonValue[] | undefined, (item) =>
        readAttachmentDraft(item, namespace),
      ),
    },
  }
}

function readIndex(value: string | null): PersistedNamespaceIndex {
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

function normalizeInterruptedDraft<T extends AnyDraftRecord>(
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

function normalizeHydratedEnvelope(
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

function defaultErrorForOutcome(outcome: 'conflict' | 'failed'): DraftError {
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

function cloneDraftForClaim(draft: AnyDraftRecord): AnyDraftRecord {
  return {
    ...draft,
    ...(draft.kind === 'form' ? { data: { ...draft.data } } : {}),
  }
}

function findDraftLocation(envelope: PersistedEnvelopeV1, draftId: string): DraftLocation | null {
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

function replaceDraftAtLocation(
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

function removeDraftAtLocation(
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

function upsertByDraftId<T extends AnyDraftRecord>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.draftId === nextItem.draftId)
  if (index === -1) {
    return [...items, nextItem]
  }

  const nextItems = [...items]
  nextItems[index] = nextItem
  return nextItems
}

export function createExpoCacheStorage(): CacheStorage {
  return {
    async getItem(key) {
      const secureStore = await import('expo-secure-store')
      return secureStore.getItemAsync(key)
    },
    async setItem(key, value) {
      const secureStore = await import('expo-secure-store')
      await secureStore.setItemAsync(key, value)
    },
    async removeItem(key) {
      const secureStore = await import('expo-secure-store')
      await secureStore.deleteItemAsync(key)
    },
  }
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

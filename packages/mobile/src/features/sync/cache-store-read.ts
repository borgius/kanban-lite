import type { JsonObject, JsonValue } from '../../lib/api/contracts'
import type {
  DraftStatus, CacheNamespace, DraftError, DraftBase,
  CommentDraftRecord, FormDraftRecord, ChecklistDraftRecord, AttachmentDraftRecord,
  PersistedEnvelopeV1, CacheStorage, MemoryCacheStorage,
  MobileCacheSnapshots,
} from './cache-store-types'
import {
  DEFAULT_SESSION_NAMESPACE, CACHE_STORAGE_KEY_PREFIX, CACHE_STORAGE_VERSION,
} from './cache-store-types'


export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function collectItems<T>(values: JsonValue[] | undefined, parser: (value: JsonValue) => T | null): T[] {
  const items: T[] = []
  for (const value of values ?? []) {
    const parsed = parser(value)
    if (parsed) {
      items.push(parsed)
    }
  }
  return items
}

export function readString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function readOptionalString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function readNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readDraftStatus(value: JsonValue | undefined): DraftStatus | null {
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

export function normalizeWorkspaceOrigin(workspaceOrigin: string): string {
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

export function normalizeNamespace(
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

export function namespacesEqual(left: CacheNamespace, right: CacheNamespace): boolean {
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

export function createEmptyEnvelope(namespace: CacheNamespace, persistedAt: string): PersistedEnvelopeV1 {
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

export function readDraftError(value: JsonValue | undefined): DraftError | null {
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

export function readBaseDraft(value: JsonValue): DraftBase | null {
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

export function readCommentDraft(value: JsonValue): CommentDraftRecord | null {
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

export function readFormDraft(value: JsonValue): FormDraftRecord | null {
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

export function readChecklistDraft(value: JsonValue): ChecklistDraftRecord | null {
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

export function readAttachmentDraft(
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

export function readNamespace(
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

export function readSnapshots(value: JsonValue | undefined): MobileCacheSnapshots {
  return isJsonObject(value) ? value : {}
}

export function migrateEnvelopeV0(
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

export function readEnvelopeV1(
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


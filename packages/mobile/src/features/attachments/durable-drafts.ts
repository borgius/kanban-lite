import type { AttachmentDraftRecord, CacheNamespace, QueueAttachmentDraftInput } from '../sync/cache-store'

export const MAX_ATTACHMENT_DRAFT_BYTES = 25 * 1024 * 1024
export const MAX_NAMESPACE_ATTACHMENT_DRAFT_BYTES = 200 * 1024 * 1024
export const ATTACHMENT_DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

const ATTACHMENT_DRAFT_ROOT = 'kanban-lite/attachment-drafts'
const BASE64_ENCODING = 'base64'

interface AttachmentDraftFileInfo {
  exists: boolean
  isDirectory?: boolean
  size?: number | null
}

interface DefaultAttachmentDraftRuntime {
  base64Encoding: string
  fileSystem: AttachmentDraftFileSystem
}

let defaultAttachmentDraftRuntimePromise: Promise<DefaultAttachmentDraftRuntime> | null = null

export interface AttachmentDraftFileSystem {
  documentDirectory: string | null
  copyAsync(input: { from: string; to: string }): Promise<void>
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>
  getInfoAsync(uri: string): Promise<AttachmentDraftFileInfo>
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>
  readAsStringAsync(uri: string, options?: { encoding?: string }): Promise<string>
}

export interface PrepareDurableAttachmentDraftInput {
  namespace: Pick<CacheNamespace, 'subject' | 'workspaceId'>
  taskId: string
  source: {
    uri: string
    fileName?: string | null
    mimeType?: string | null
    sizeBytes?: number | null
  }
  existingDrafts: ReadonlyArray<Pick<AttachmentDraftRecord, 'sizeBytes'>>
  now?: Date
  randomSuffix?: () => string
  fileSystem?: AttachmentDraftFileSystem
}

export class AttachmentDraftError extends Error {
  public readonly code:
    | 'attachment_document_directory_unavailable'
    | 'attachment_file_too_large'
    | 'attachment_namespace_budget_exceeded'
    | 'attachment_source_invalid'

  constructor(
    code:
      | 'attachment_document_directory_unavailable'
      | 'attachment_file_too_large'
      | 'attachment_namespace_budget_exceeded'
      | 'attachment_source_invalid',
    message: string,
  ) {
    super(message)
    this.name = 'AttachmentDraftError'
    this.code = code
  }
}

async function loadDefaultAttachmentDraftRuntime(): Promise<DefaultAttachmentDraftRuntime> {
  defaultAttachmentDraftRuntimePromise ??= import('expo-file-system/legacy').then((expoFileSystem) => ({
    base64Encoding: expoFileSystem.EncodingType.Base64,
    fileSystem: {
      documentDirectory: expoFileSystem.documentDirectory,
      copyAsync: expoFileSystem.copyAsync,
      deleteAsync: expoFileSystem.deleteAsync,
      getInfoAsync: expoFileSystem.getInfoAsync,
      makeDirectoryAsync: expoFileSystem.makeDirectoryAsync,
      readAsStringAsync: expoFileSystem.readAsStringAsync,
    },
  }))

  return defaultAttachmentDraftRuntimePromise
}

async function resolveAttachmentDraftFileSystem(
  fileSystem?: AttachmentDraftFileSystem,
): Promise<AttachmentDraftFileSystem> {
  if (fileSystem) {
    return fileSystem
  }

  return (await loadDefaultAttachmentDraftRuntime()).fileSystem
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'unknown'
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function resolveSourceFileName(source: PrepareDurableAttachmentDraftInput['source']): string {
  const fromInput = source.fileName?.trim()
  if (fromInput) {
    return sanitizePathSegment(fromInput)
  }

  const rawSegment = source.uri.split('/').pop()?.trim() ?? ''
  return sanitizePathSegment(rawSegment || 'attachment')
}

function buildDraftDirectoryUri(
  documentDirectory: string,
  namespace: Pick<CacheNamespace, 'subject' | 'workspaceId'>,
): string {
  const normalizedDocumentDirectory = documentDirectory.endsWith('/')
    ? documentDirectory
    : `${documentDirectory}/`

  return `${normalizedDocumentDirectory}${ATTACHMENT_DRAFT_ROOT}/${sanitizePathSegment(namespace.workspaceId)}/${sanitizePathSegment(namespace.subject)}/`
}

function buildDraftId(now: Date, randomSuffix: () => string): string {
  return `attachment-${now.getTime()}-${randomSuffix()}`
}

async function resolveSourceSizeBytes(
  fileSystem: AttachmentDraftFileSystem,
  source: PrepareDurableAttachmentDraftInput['source'],
): Promise<number> {
  if (typeof source.sizeBytes === 'number' && Number.isFinite(source.sizeBytes) && source.sizeBytes >= 0) {
    return source.sizeBytes
  }

  const info = await fileSystem.getInfoAsync(source.uri)
  if (!info.exists || info.isDirectory || typeof info.size !== 'number' || !Number.isFinite(info.size)) {
    throw new AttachmentDraftError(
      'attachment_source_invalid',
      'The selected attachment could not be copied into durable storage.',
    )
  }

  return info.size
}

export async function prepareDurableAttachmentDraft(
  input: PrepareDurableAttachmentDraftInput,
): Promise<QueueAttachmentDraftInput> {
  const fileSystem = await resolveAttachmentDraftFileSystem(input.fileSystem)
  const documentDirectory = fileSystem.documentDirectory
  if (!documentDirectory) {
    throw new AttachmentDraftError(
      'attachment_document_directory_unavailable',
      'Durable attachment storage is unavailable on this device.',
    )
  }

  const sizeBytes = await resolveSourceSizeBytes(fileSystem, input.source)
  if (sizeBytes > MAX_ATTACHMENT_DRAFT_BYTES) {
    throw new AttachmentDraftError(
      'attachment_file_too_large',
      'This attachment is larger than the 25 MiB per-file limit.',
    )
  }

  const existingBytes = input.existingDrafts.reduce((total, draft) => total + draft.sizeBytes, 0)
  if (existingBytes + sizeBytes > MAX_NAMESPACE_ATTACHMENT_DRAFT_BYTES) {
    throw new AttachmentDraftError(
      'attachment_namespace_budget_exceeded',
      'Attachment drafts are over the device storage budget for this workspace.',
    )
  }

  const now = input.now ?? new Date()
  const randomSuffix = input.randomSuffix ?? (() => Math.random().toString(36).slice(2, 8))
  const draftId = buildDraftId(now, randomSuffix)
  const fileName = resolveSourceFileName(input.source)
  const directoryUri = buildDraftDirectoryUri(documentDirectory, input.namespace)
  const destinationUri = `${directoryUri}${draftId}-${fileName}`

  await fileSystem.makeDirectoryAsync(directoryUri, { intermediates: true })
  await fileSystem.copyAsync({
    from: input.source.uri,
    to: destinationUri,
  })

  return {
    draftId,
    taskId: input.taskId,
    fileName,
    mimeType: input.source.mimeType?.trim() || 'application/octet-stream',
    sizeBytes,
    sha256: null,
    uri: destinationUri,
    expiresAt: new Date(now.getTime() + ATTACHMENT_DRAFT_EXPIRY_MS).toISOString(),
  }
}

export async function readAttachmentDraftAsBase64(
  uri: string,
  fileSystem?: AttachmentDraftFileSystem,
): Promise<string> {
  if (fileSystem) {
    return fileSystem.readAsStringAsync(uri, {
      encoding: BASE64_ENCODING,
    })
  }

  const runtime = await loadDefaultAttachmentDraftRuntime()
  return runtime.fileSystem.readAsStringAsync(uri, {
    encoding: runtime.base64Encoding,
  })
}

export async function deleteDurableAttachmentDraft(
  uri: string,
  fileSystem?: AttachmentDraftFileSystem,
): Promise<void> {
  const resolvedFileSystem = await resolveAttachmentDraftFileSystem(fileSystem)
  await resolvedFileSystem.deleteAsync(uri, { idempotent: true })
}

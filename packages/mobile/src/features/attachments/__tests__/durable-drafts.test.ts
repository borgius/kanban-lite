import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CacheNamespace } from '../../sync/cache-store'
import type { AttachmentDraftFileSystem } from '../durable-drafts'

type DurableDraftsModule = typeof import('../durable-drafts')

const expoFileSystem = vi.hoisted(() => {
  const copyAsync = vi.fn().mockResolvedValue(undefined)
  const deleteAsync = vi.fn().mockResolvedValue(undefined)
  const getInfoAsync = vi.fn().mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: 1024,
    uri: 'file:///tmp/capture.jpg',
    modificationTime: 0,
  })
  const makeDirectoryAsync = vi.fn().mockResolvedValue(undefined)
  const readAsStringAsync = vi.fn().mockResolvedValue('base64-from-default-adapter')
  const load = vi.fn(() => ({
    documentDirectory: 'file:///documents/',
    copyAsync,
    deleteAsync,
    getInfoAsync,
    makeDirectoryAsync,
    readAsStringAsync,
    EncodingType: {
      Base64: 'base64',
    },
  }))

  return {
    copyAsync,
    deleteAsync,
    getInfoAsync,
    load,
    makeDirectoryAsync,
    readAsStringAsync,
  }
})

vi.mock('expo-file-system/legacy', () => expoFileSystem.load())

const namespace: Pick<CacheNamespace, 'subject' | 'workspaceId'> = {
  workspaceId: 'workspace_123',
  subject: 'worker',
}

function createFileSystem(
  overrides: Partial<AttachmentDraftFileSystem> = {},
): AttachmentDraftFileSystem {
  return {
    documentDirectory: 'file:///documents/',
    copyAsync: vi.fn().mockResolvedValue(undefined),
    deleteAsync: vi.fn().mockResolvedValue(undefined),
    getInfoAsync: vi.fn().mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: 1024,
      uri: 'file:///tmp/capture.jpg',
      modificationTime: 0,
    }),
    makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
    readAsStringAsync: vi.fn().mockResolvedValue('base64-payload'),
    ...overrides,
  }
}

async function loadDurableDraftsModule(): Promise<DurableDraftsModule> {
  return import('../durable-drafts')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('durable attachment draft helpers', () => {
  it('defers loading the Expo file-system adapter until the default runtime adapter is needed', async () => {
    const durableDrafts = await loadDurableDraftsModule()

    expect(expoFileSystem.load).not.toHaveBeenCalled()

    const payload = await durableDrafts.readAttachmentDraftAsBase64(
      'file:///documents/kanban-lite/attachment-drafts/workspace_123/worker/panel.jpg',
    )

    expect(payload).toBe('base64-from-default-adapter')
    expect(expoFileSystem.load).toHaveBeenCalledTimes(1)
    expect(expoFileSystem.readAsStringAsync).toHaveBeenCalledWith(
      'file:///documents/kanban-lite/attachment-drafts/workspace_123/worker/panel.jpg',
      { encoding: 'base64' },
    )
  })

  it('copies a picked file into app-owned durable storage and returns queueable draft metadata', async () => {
    const durableDrafts = await loadDurableDraftsModule()
    const fileSystem = createFileSystem()
    const now = new Date('2026-04-02T12:00:00.000Z')
    const expectedDraftId = `attachment-${now.getTime()}-abc123`
    const expectedDirectoryUri = 'file:///documents/kanban-lite/attachment-drafts/workspace_123/worker/'
    const expectedDestinationUri = `${expectedDirectoryUri}${expectedDraftId}-capture.jpg`

    const draft = await durableDrafts.prepareDurableAttachmentDraft({
      namespace,
      taskId: 'task-1',
      source: {
        uri: 'file:///tmp/capture.jpg',
        fileName: 'capture.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      },
      fileSystem,
      now,
      randomSuffix: () => 'abc123',
      existingDrafts: [],
    })

    expect(draft).toMatchObject({
      draftId: expectedDraftId,
      taskId: 'task-1',
      fileName: 'capture.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      sha256: null,
      uri: expectedDestinationUri,
      expiresAt: new Date(now.getTime() + durableDrafts.ATTACHMENT_DRAFT_EXPIRY_MS).toISOString(),
    })
    expect(expoFileSystem.load).not.toHaveBeenCalled()
    expect(fileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
      expectedDirectoryUri,
      { intermediates: true },
    )
    expect(fileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///tmp/capture.jpg',
      to: expectedDestinationUri,
    })
  })

  it('rejects files that exceed the durable draft limits before they enter resend flow', async () => {
    const durableDrafts = await loadDurableDraftsModule()
    const fileSystem = createFileSystem()

    await expect(
      durableDrafts.prepareDurableAttachmentDraft({
        namespace,
        taskId: 'task-1',
        source: {
          uri: 'file:///tmp/oversized.pdf',
          fileName: 'oversized.pdf',
          mimeType: 'application/pdf',
          sizeBytes: durableDrafts.MAX_ATTACHMENT_DRAFT_BYTES + 1,
        },
        fileSystem,
        existingDrafts: [],
      }),
    ).rejects.toMatchObject({
      code: 'attachment_file_too_large',
    })

    await expect(
      durableDrafts.prepareDurableAttachmentDraft({
        namespace,
        taskId: 'task-1',
        source: {
          uri: 'file:///tmp/ok.pdf',
          fileName: 'ok.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        },
        fileSystem,
        existingDrafts: [{ sizeBytes: durableDrafts.MAX_NAMESPACE_ATTACHMENT_DRAFT_BYTES }],
      }),
    ).rejects.toMatchObject({
      code: 'attachment_namespace_budget_exceeded',
    })

    expect(expoFileSystem.load).not.toHaveBeenCalled()
  })

  it('reads and deletes durable draft files through the injected file-system adapter', async () => {
    const durableDrafts = await loadDurableDraftsModule()
    const fileSystem = createFileSystem()

    const payload = await durableDrafts.readAttachmentDraftAsBase64(
      'file:///documents/kanban-lite/attachment-drafts/workspace_123/worker/panel.jpg',
      fileSystem,
    )
    await durableDrafts.deleteDurableAttachmentDraft(
      'file:///documents/kanban-lite/attachment-drafts/workspace_123/worker/panel.jpg',
      fileSystem,
    )

    expect(payload).toBe('base64-payload')
    expect(expoFileSystem.load).not.toHaveBeenCalled()
    expect(fileSystem.readAsStringAsync).toHaveBeenCalledTimes(1)
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/kanban-lite/attachment-drafts/workspace_123/worker/panel.jpg',
      { idempotent: true },
    )
  })
})

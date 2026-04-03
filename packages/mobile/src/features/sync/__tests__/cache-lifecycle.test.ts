import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SESSION_NAMESPACE,
  buildCacheStorageKey,
  hydrateWithPurgeCleanup,
  createCacheStore,
  createMemoryCacheStorage,
  readNamespaceAttachmentDrafts,
  type CacheNamespace,
} from '../cache-store'

const NOW = new Date('2026-04-02T12:00:00.000Z')

const namespace: CacheNamespace = {
  workspaceOrigin: 'https://field.example.com',
  workspaceId: 'workspace_123',
  subject: 'worker',
  sessionNamespace: DEFAULT_SESSION_NAMESPACE,
}

function createHarness(initial: Record<string, string> = {}) {
  const storage = createMemoryCacheStorage(initial)
  const store = createCacheStore({
    storage,
    now: () => NOW,
  })

  return {
    store,
    storage,
  }
}

describe('mobile cache lifecycle store', () => {
  it('blocks hydration until session and workspace validation succeed', async () => {
    const { store } = createHarness()

    await store.replaceSnapshots(namespace, {
      home: {
        workspaceId: namespace.workspaceId,
        totalVisibleTasks: 1,
      },
    })
    await store.queueDraft(namespace, {
      kind: 'comment',
      draftId: 'comment-1',
      taskId: 'task-1',
      author: 'worker',
      content: 'Need ladder access.',
    })

    const blocked = await store.hydrate({
      namespace,
      sessionValidated: false,
    })

    expect(blocked).toEqual({ kind: 'blocked' })

    const hydrated = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydrated.kind).toBe('hydrated')
    if (hydrated.kind !== 'hydrated') {
      throw new Error('Expected hydrated result')
    }

    expect(hydrated.envelope.snapshots).toMatchObject({
      home: {
        workspaceId: 'workspace_123',
        totalVisibleTasks: 1,
      },
    })
    expect(hydrated.envelope.drafts.comments).toMatchObject([
      {
        draftId: 'comment-1',
        status: 'draft',
      },
    ])
  })

  it('migrates a known older version forward into the v1 envelope', async () => {
    const { store, storage } = createHarness({
      [buildCacheStorageKey(namespace)]: JSON.stringify({
        version: 0,
        namespace: {
          workspaceOrigin: namespace.workspaceOrigin,
          workspaceId: namespace.workspaceId,
          subject: namespace.subject,
        },
        persistedAt: '2026-04-01T11:00:00.000Z',
        snapshots: {
          home: {
            workspaceId: namespace.workspaceId,
            totalVisibleTasks: 2,
          },
        },
        drafts: {
          comments: [
            {
              draftId: 'comment-legacy',
              taskId: 'task-1',
              author: 'worker',
              content: 'Legacy comment draft',
              status: 'draft',
              createdAt: '2026-04-01T11:00:00.000Z',
              updatedAt: '2026-04-01T11:00:00.000Z',
            },
          ],
          forms: [],
          checklists: [],
        },
        attachments: [
          {
            draftId: 'attachment-legacy',
            taskId: 'task-1',
            fileName: 'panel.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 42,
            sha256: 'abc123',
            uri: 'file:///drafts/panel.jpg',
            createdAt: '2026-04-01T11:00:00.000Z',
            updatedAt: '2026-04-01T11:00:00.000Z',
            expiresAt: '2026-04-08T11:00:00.000Z',
            status: 'draft',
          },
        ],
      }),
    })

    const hydrated = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydrated.kind).toBe('hydrated')
    if (hydrated.kind !== 'hydrated') {
      throw new Error('Expected hydrated result')
    }

    expect(hydrated.migratedFromVersion).toBe(0)
    expect(hydrated.envelope.version).toBe(1)
    expect(hydrated.envelope.namespace).toMatchObject({
      sessionNamespace: DEFAULT_SESSION_NAMESPACE,
    })
    expect(hydrated.envelope.attachments.items).toMatchObject([
      {
        draftId: 'attachment-legacy',
        workspaceOrigin: namespace.workspaceOrigin,
        workspaceId: namespace.workspaceId,
        subject: namespace.subject,
      },
    ])
    expect(storage.dump()[buildCacheStorageKey(namespace)]).toContain('"version":1')
  })

  it('purges unknown versions and corrupted payloads instead of partially hydrating', async () => {
    const unknownVersionHarness = createHarness({
      [buildCacheStorageKey(namespace)]: JSON.stringify({
        version: 99,
        namespace,
      }),
    })

    const unknownVersionResult = await unknownVersionHarness.store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(unknownVersionResult).toMatchObject({
      kind: 'purged',
      reason: 'unknown-version',
    })
    expect(unknownVersionHarness.storage.dump()[buildCacheStorageKey(namespace)]).toBeUndefined()

    const corruptHarness = createHarness({
      [buildCacheStorageKey(namespace)]: '{not-json',
    })

    const corruptResult = await corruptHarness.store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(corruptResult).toMatchObject({
      kind: 'purged',
      reason: 'corrupt',
    })
    expect(corruptHarness.storage.dump()[buildCacheStorageKey(namespace)]).toBeUndefined()
  })

  it('best-effort cleans durable attachment files when hydrate purges a mismatched namespace', async () => {
    const { store, storage } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-task-1',
      taskId: 'task-1',
      fileName: 'task-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 40,
      sha256: 'attachment-task-1-sha',
      uri: 'file:///drafts/task-1.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })
    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-task-2',
      taskId: 'task-2',
      fileName: 'task-2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 60,
      sha256: 'attachment-task-2-sha',
      uri: 'file:///drafts/task-2.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const cacheKey = buildCacheStorageKey(namespace)
    const envelope = JSON.parse(storage.dump()[cacheKey] ?? '{}') as {
      namespace?: CacheNamespace
    }
    envelope.namespace = {
      ...namespace,
      subject: 'worker-2',
    }
    await storage.setItem(cacheKey, JSON.stringify(envelope))

    const deleteDurableAttachment = vi
      .fn<((uri: string) => Promise<void>)>()
      .mockRejectedValueOnce(new Error('disk busy'))
      .mockResolvedValue(undefined)

    const hydrated = await hydrateWithPurgeCleanup(
      store,
      {
        namespace,
        sessionValidated: true,
      },
      {
        deleteDurableAttachment,
      },
    )

    expect(hydrated).toMatchObject({
      kind: 'purged',
      reason: 'namespace-mismatch',
      durableAttachmentUris: [
        'file:///drafts/task-1.jpg',
        'file:///drafts/task-2.jpg',
      ],
    })
    expect(deleteDurableAttachment.mock.calls).toEqual([
      ['file:///drafts/task-1.jpg'],
      ['file:///drafts/task-2.jpg'],
    ])
  })

  it('exposes explicit purge hooks for logout, reauth, workspace switch, and revocation', async () => {
    const reauthNamespace: CacheNamespace = {
      ...namespace,
      subject: 'worker-2',
    }
    const switchedWorkspaceNamespace: CacheNamespace = {
      ...reauthNamespace,
      workspaceId: 'workspace_456',
    }
    const { store, storage } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-logout',
      taskId: 'task-1',
      fileName: 'logout.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'logout-sha',
      uri: 'file:///drafts/logout.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const logoutPurge = await store.purgeForLogout(namespace)
    expect(logoutPurge).toMatchObject({
      purged: true,
      reason: 'logout',
      durableAttachmentUris: ['file:///drafts/logout.jpg'],
    })
    expect(storage.dump()[buildCacheStorageKey(namespace)]).toBeUndefined()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-reauth',
      taskId: 'task-1',
      fileName: 'reauth.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'reauth-sha',
      uri: 'file:///drafts/reauth.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const reauthPurge = await store.purgeForReauth(namespace, reauthNamespace)
    expect(reauthPurge).toMatchObject({
      purged: true,
      reason: 'reauth',
      durableAttachmentUris: ['file:///drafts/reauth.jpg'],
    })

    await store.queueAttachmentDraft(reauthNamespace, {
      draftId: 'attachment-workspace',
      taskId: 'task-1',
      fileName: 'workspace.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'workspace-sha',
      uri: 'file:///drafts/workspace.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const workspacePurge = await store.purgeForWorkspaceSwitch(
      reauthNamespace,
      switchedWorkspaceNamespace,
    )
    expect(workspacePurge).toMatchObject({
      purged: true,
      reason: 'workspace-switch',
      durableAttachmentUris: ['file:///drafts/workspace.jpg'],
    })

    await store.queueAttachmentDraft(switchedWorkspaceNamespace, {
      draftId: 'attachment-revoked',
      taskId: 'task-1',
      fileName: 'revoked.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'revoked-sha',
      uri: 'file:///drafts/revoked.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const revocationPurge = await store.purgeForRevocation(switchedWorkspaceNamespace, 401)
    expect(revocationPurge).toMatchObject({
      purged: true,
      reason: 'session-revoked',
      durableAttachmentUris: ['file:///drafts/revoked.jpg'],
    })
    expect(storage.dump()[buildCacheStorageKey(switchedWorkspaceNamespace)]).toBeUndefined()
  })

  it('requires explicit resend and guards against duplicate in-flight sends for one draft', async () => {
    const { store } = createHarness()

    await store.queueDraft(namespace, {
      kind: 'form',
      draftId: 'form-1',
      taskId: 'task-1',
      formId: 'safety-check',
      data: {
        answer: 'ok',
      },
    })

    const firstClaim = await store.claimExplicitResend(namespace, 'form-1')
    expect(firstClaim).toMatchObject({
      claimed: true,
      draft: {
        draftId: 'form-1',
        status: 'sending',
      },
    })

    const duplicateClaim = await store.claimExplicitResend(namespace, 'form-1')
    expect(duplicateClaim).toEqual({
      claimed: false,
      reason: 'duplicate-send',
    })

    await store.resolveExplicitResend(namespace, 'form-1', {
      outcome: 'failed',
      error: {
        code: 'network_offline',
        message: 'Needs connection.',
      },
    })

    const secondClaim = await store.claimExplicitResend(namespace, 'form-1')
    expect(secondClaim).toMatchObject({
      claimed: true,
      draft: {
        draftId: 'form-1',
        status: 'sending',
      },
    })
  })

  it('keeps claimed resend drafts non-discardable until resend resolves', async () => {
    const { store } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-inflight',
      taskId: 'task-1',
      fileName: 'panel.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'attachment-inflight-sha',
      uri: 'file:///drafts/inflight-panel.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const claim = await store.claimExplicitResend(namespace, 'attachment-inflight')
    expect(claim).toMatchObject({
      claimed: true,
      draft: {
        draftId: 'attachment-inflight',
        status: 'sending',
      },
    })

    const discardedWhileSending = await store.discardDraft(namespace, 'attachment-inflight')
    expect(discardedWhileSending).toEqual({
      draft: null,
      removedAttachmentUri: null,
    })

    const duplicateClaim = await store.claimExplicitResend(namespace, 'attachment-inflight')
    expect(duplicateClaim).toEqual({
      claimed: false,
      reason: 'duplicate-send',
    })

    const hydratedWhileSending = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydratedWhileSending.kind).toBe('hydrated')
    if (hydratedWhileSending.kind !== 'hydrated') {
      throw new Error('Expected hydrated result')
    }

    expect(hydratedWhileSending.envelope.attachments.items).toMatchObject([
      {
        draftId: 'attachment-inflight',
        status: 'sending',
      },
    ])

    await store.resolveExplicitResend(namespace, 'attachment-inflight', {
      outcome: 'failed',
      error: {
        code: 'network_offline',
        message: 'Needs connection.',
      },
    })

    const discardedAfterResolve = await store.discardDraft(namespace, 'attachment-inflight')
    expect(discardedAfterResolve).toMatchObject({
      draft: {
        kind: 'attachment',
        draftId: 'attachment-inflight',
        status: 'failed',
      },
      removedAttachmentUri: 'file:///drafts/inflight-panel.jpg',
    })
  })

  it('reads namespace attachment drafts across tasks for namespace-scoped budget checks', async () => {
    const { store } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-task-1',
      taskId: 'task-1',
      fileName: 'task-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 40,
      sha256: 'attachment-task-1-sha',
      uri: 'file:///drafts/task-1.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-task-2',
      taskId: 'task-2',
      fileName: 'task-2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 60,
      sha256: 'attachment-task-2-sha',
      uri: 'file:///drafts/task-2.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const drafts = await readNamespaceAttachmentDrafts(store, namespace)

    expect(drafts.map((draft) => ({
      draftId: draft.draftId,
      sizeBytes: draft.sizeBytes,
      taskId: draft.taskId,
    }))).toEqual([
      {
        draftId: 'attachment-task-1',
        sizeBytes: 40,
        taskId: 'task-1',
      },
      {
        draftId: 'attachment-task-2',
        sizeBytes: 60,
        taskId: 'task-2',
      },
    ])
  })

  it('cleans purged durable attachments when namespace attachment budget reads purge cache', async () => {
    const { store, storage } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-task-1',
      taskId: 'task-1',
      fileName: 'task-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 40,
      sha256: 'attachment-task-1-sha',
      uri: 'file:///drafts/task-1.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const cacheKey = buildCacheStorageKey(namespace)
    const envelope = JSON.parse(storage.dump()[cacheKey] ?? '{}') as {
      namespace?: CacheNamespace
    }
    envelope.namespace = {
      ...namespace,
      subject: 'worker-2',
    }
    await storage.setItem(cacheKey, JSON.stringify(envelope))

    const deleteDurableAttachment = vi.fn<((uri: string) => Promise<void>)>().mockResolvedValue()

    const drafts = await readNamespaceAttachmentDrafts(store, namespace, {
      deleteDurableAttachment,
    })

    expect(drafts).toEqual([])
    expect(deleteDurableAttachment).toHaveBeenCalledTimes(1)
    expect(deleteDurableAttachment).toHaveBeenCalledWith('file:///drafts/task-1.jpg')
  })

  it('stores comment create and update drafts distinctly for later explicit resend review', async () => {
    const { store } = createHarness()

    await store.queueDraft(namespace, {
      kind: 'comment',
      draftId: 'comment-create',
      taskId: 'task-1',
      author: 'worker',
      content: 'Need ladder access.',
      operation: 'create',
    })

    await store.queueDraft(namespace, {
      kind: 'comment',
      draftId: 'comment-edit',
      taskId: 'task-1',
      commentId: 'comment-1',
      author: 'worker',
      content: 'Updated with access code.',
      operation: 'update',
    })

    const hydrated = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydrated.kind).toBe('hydrated')
    if (hydrated.kind !== 'hydrated') {
      throw new Error('Expected hydrated result')
    }

    expect(hydrated.envelope.drafts.comments).toMatchObject([
      {
        draftId: 'comment-create',
        operation: 'create',
        commentId: null,
        status: 'draft',
      },
      {
        draftId: 'comment-edit',
        operation: 'update',
        commentId: 'comment-1',
        status: 'draft',
      },
    ])
  })

  it('discards local drafts and returns durable attachment cleanup metadata', async () => {
    const { store } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-discard',
      taskId: 'task-1',
      fileName: 'panel.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'attachment-sha',
      uri: 'file:///drafts/panel.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    const discarded = await store.discardDraft(namespace, 'attachment-discard')
    expect(discarded).toMatchObject({
      draft: {
        kind: 'attachment',
        draftId: 'attachment-discard',
      },
      removedAttachmentUri: 'file:///drafts/panel.jpg',
    })

    const hydrated = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydrated.kind).toBe('hydrated')
    if (hydrated.kind !== 'hydrated') {
      throw new Error('Expected hydrated result')
    }

    expect(hydrated.envelope.attachments.items).toEqual([])
  })

  it('persists attachment recovery metadata and marks missing durable files as failed instead of dropping them', async () => {
    const { store } = createHarness()

    await store.queueAttachmentDraft(namespace, {
      draftId: 'attachment-1',
      taskId: 'task-1',
      fileName: 'panel.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42,
      sha256: 'attachment-sha',
      uri: 'file:///drafts/panel.jpg',
      expiresAt: '2026-04-08T12:00:00.000Z',
    })

    await store.markAttachmentMissingLocalFile(namespace, 'attachment-1')

    const hydrated = await store.hydrate({
      namespace,
      sessionValidated: true,
    })

    expect(hydrated.kind).toBe('hydrated')
    if (hydrated.kind !== 'hydrated') {
      throw new Error('Expected hydrated result')
    }

    expect(hydrated.envelope.attachments.items).toMatchObject([
      {
        draftId: 'attachment-1',
        workspaceOrigin: namespace.workspaceOrigin,
        workspaceId: namespace.workspaceId,
        subject: namespace.subject,
        uri: 'file:///drafts/panel.jpg',
        sha256: 'attachment-sha',
        status: 'failed',
        lastError: {
          code: 'missing_local_file',
        },
      },
    ])
  })
})

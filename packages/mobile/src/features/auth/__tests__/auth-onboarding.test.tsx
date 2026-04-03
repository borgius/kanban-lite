import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SESSION_NAMESPACE } from '../../sync/cache-store'
import {
  MobileSessionClientError,
  SESSION_STORAGE_KEY,
  createMemorySessionStorage,
  createSessionController,
  type MobileSessionClient,
  type MobileSessionStatus,
  type ResolvedMobileBootstrap,
} from '../session-store'

const AUTHENTICATION = {
  provider: 'local' as const,
  browserLoginTransport: 'cookie-session' as const,
  mobileSessionTransport: 'opaque-bearer' as const,
  sessionKind: 'local-mobile-session-v1' as const,
}

function createStatus(overrides: Partial<MobileSessionStatus> = {}): MobileSessionStatus {
  return {
    workspaceOrigin: 'https://field.example.com',
    workspaceId: 'workspace_123',
    subject: 'worker',
    roles: ['user'],
    expiresAt: null,
    authentication: AUTHENTICATION,
    ...overrides,
  }
}

function createBootstrapResult(
  overrides: Partial<ResolvedMobileBootstrap> = {},
): ResolvedMobileBootstrap {
  return {
    workspaceOrigin: 'https://field.example.com',
    workspaceId: 'workspace_123',
    authentication: AUTHENTICATION,
    bootstrapToken: {
      provided: false,
      mode: 'none',
    },
    nextStep: 'local-login',
    ...overrides,
  }
}

function createClient(overrides: Partial<MobileSessionClient> = {}): MobileSessionClient {
  return {
    resolveBootstrap: vi.fn().mockResolvedValue(createBootstrapResult()),
    createSession: vi.fn().mockResolvedValue({
      session: {
        kind: 'local-mobile-session-v1',
        token: 'opaque-worker-token',
      },
      status: createStatus(),
    }),
    inspectSession: vi.fn().mockResolvedValue(createStatus()),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createCachePurgeHarness() {
  return {
    purgeNamespace: vi.fn().mockResolvedValue({
      purged: true,
      reason: 'workspace-switch',
      durableAttachmentUris: [],
    }),
    purgeForLogout: vi.fn().mockResolvedValue({
      purged: true,
      reason: 'logout',
      durableAttachmentUris: [],
    }),
    purgeForReauth: vi.fn().mockResolvedValue({
      purged: true,
      reason: 'reauth',
      durableAttachmentUris: [],
    }),
    purgeForWorkspaceSwitch: vi.fn().mockResolvedValue({
      purged: true,
      reason: 'workspace-switch',
      durableAttachmentUris: [],
    }),
    purgeForRevocation: vi.fn().mockResolvedValue({
      purged: true,
      reason: 'session-revoked',
      durableAttachmentUris: [],
    }),
  }
}

function createNamespace(overrides: Partial<MobileSessionStatus> = {}) {
  const status = createStatus(overrides)
  return {
    workspaceOrigin: status.workspaceOrigin,
    workspaceId: status.workspaceId,
    subject: status.subject,
    sessionNamespace: DEFAULT_SESSION_NAMESPACE,
  }
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined
  let reject: ((error?: unknown) => void) | undefined
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (error?: unknown) => reject?.(error),
  }
}

function createStoredSessionJson(
  overrides: {
    workspaceOrigin?: string
    workspaceId?: string | null
    omitWorkspaceId?: boolean
    subject?: string
    roles?: string[]
    expiresAt?: string | null
    token?: string
  } = {},
): string {
  const record: Record<string, unknown> = {
    version: 1,
    workspaceOrigin: overrides.workspaceOrigin ?? 'https://field.example.com',
    subject: overrides.subject ?? 'worker',
    roles: overrides.roles ?? ['user'],
    expiresAt: overrides.expiresAt ?? null,
    session: {
      kind: 'local-mobile-session-v1',
      token: overrides.token ?? 'opaque-worker-token',
    },
  }

  if (!overrides.omitWorkspaceId) {
    record.workspaceId = 'workspaceId' in overrides ? overrides.workspaceId ?? null : 'workspace_123'
  }

  return JSON.stringify(record)
}

describe('mobile auth onboarding controller', () => {
  it('resolves a typed workspace, signs in with local credentials, and persists only the allowed session fields', async () => {
    const storage = createMemorySessionStorage()
    const client = createClient()
    const controller = createSessionController({ client, storage })

    await controller.initialize()
    expect(controller.getState().phase).toBe('workspace-entry')

    await controller.submitWorkspace('https://Field.Example.com/mobile/')

    expect(client.resolveBootstrap).toHaveBeenCalledWith({
      workspaceOrigin: 'https://Field.Example.com/mobile/',
      bootstrapToken: null,
    })
    expect(controller.getState()).toMatchObject({
      phase: 'credentials',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      isProtectedReady: false,
    })

    await controller.submitCredentials({
      username: 'worker',
      password: 'super-secret-password',
    })

    expect(client.createSession).toHaveBeenCalledWith({
      workspaceOrigin: 'https://field.example.com',
      username: 'worker',
      password: 'super-secret-password',
    })
    expect(controller.getState()).toMatchObject({
      phase: 'authenticated',
      isProtectedReady: true,
      sessionStatus: {
        workspaceOrigin: 'https://field.example.com',
        workspaceId: 'workspace_123',
        subject: 'worker',
      },
    })

    const stored = storage.dump()[SESSION_STORAGE_KEY]
    expect(stored).toContain('opaque-worker-token')
    expect(stored).toContain('https://field.example.com')
    expect(stored).toContain('workspace_123')
    expect(stored).toContain('worker')
    expect(stored).not.toContain('super-secret-password')
    expect(stored).not.toContain('kanban_lite_session')
  })

  it('handles deep-link cold start with a bootstrap token through the bootstrap and mobile-session endpoints', async () => {
    const storage = createMemorySessionStorage()
    const client = createClient({
      resolveBootstrap: vi.fn().mockResolvedValue(
        createBootstrapResult({
          bootstrapToken: {
            provided: true,
            mode: 'one-time',
          },
          nextStep: 'redeem-bootstrap-token',
        }),
      ),
    })
    const controller = createSessionController({ client, storage })

    await controller.initialize(
      'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&bootstrapToken=bootstrap-token-1&target=%2Fcards%2F42',
    )

    expect(client.resolveBootstrap).toHaveBeenCalledWith({
      workspaceOrigin: 'https://field.example.com/mobile/',
      bootstrapToken: 'bootstrap-token-1',
    })
    expect(client.createSession).toHaveBeenCalledWith({
      workspaceOrigin: 'https://field.example.com',
      bootstrapToken: 'bootstrap-token-1',
    })
    expect(controller.getState()).toMatchObject({
      phase: 'authenticated',
      isProtectedReady: true,
      pendingTarget: '/cards/42',
      sessionStatus: {
        workspaceId: 'workspace_123',
      },
    })

    expect(storage.dump()[SESSION_STORAGE_KEY]).not.toContain('bootstrap-token-1')
    expect(storage.dump()[SESSION_STORAGE_KEY]).toContain('workspace_123')
  })

  it('routes QR payloads through the existing bootstrap and mobile-session pipeline', async () => {
    const storage = createMemorySessionStorage()
    const client = createClient({
      resolveBootstrap: vi.fn().mockResolvedValue(
        createBootstrapResult({
          bootstrapToken: {
            provided: true,
            mode: 'one-time',
          },
          nextStep: 'redeem-bootstrap-token',
        }),
      ),
    })
    const controller = createSessionController({ client, storage })

    await controller.initialize()
    await controller.handleIncomingEntry(
      'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&bootstrapToken=qr-bootstrap-token&target=%2Fcards%2F42',
      'qr',
    )

    expect(client.resolveBootstrap).toHaveBeenCalledWith({
      workspaceOrigin: 'https://field.example.com/mobile/',
      bootstrapToken: 'qr-bootstrap-token',
    })
    expect(client.createSession).toHaveBeenCalledWith({
      workspaceOrigin: 'https://field.example.com',
      bootstrapToken: 'qr-bootstrap-token',
    })
    expect(controller.getState()).toMatchObject({
      phase: 'authenticated',
      isProtectedReady: true,
      pendingTarget: '/cards/42',
      sessionStatus: {
        workspaceId: 'workspace_123',
      },
    })

    expect(storage.dump()[SESSION_STORAGE_KEY]).not.toContain('qr-bootstrap-token')
    expect(storage.dump()[SESSION_STORAGE_KEY]).toContain('workspace_123')
  })

  it('keeps QR cancel and denial outcomes explicit without entering a broken auth state', async () => {
    const controller = createSessionController({
      client: createClient(),
      storage: createMemorySessionStorage(),
    })

    await controller.initialize()

    controller.handleQrOutcome('cancelled')
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      banner: {
        kind: 'notice',
        message: 'QR entry cancelled.',
      },
    })

    controller.handleQrOutcome('denied')
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      banner: {
        kind: 'error',
        message: 'Camera access is required to scan a QR code. Paste the link instead.',
      },
    })
  })

  it('holds the no-stale-flash restore gate until the stored session is revalidated', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson(),
    })
    const deferred = createDeferred<MobileSessionStatus>()
    const client = createClient({
      inspectSession: vi.fn().mockReturnValue(deferred.promise),
    })
    const controller = createSessionController({ client, storage })

    const initializePromise = controller.initialize()

    expect(controller.getState()).toMatchObject({
      phase: 'restoring',
      isProtectedReady: false,
      sessionStatus: null,
    })

    deferred.resolve(createStatus())
    await initializePromise

    expect(controller.getState()).toMatchObject({
      phase: 'authenticated',
      isProtectedReady: true,
      sessionStatus: {
        workspaceOrigin: 'https://field.example.com',
        workspaceId: 'workspace_123',
        subject: 'worker',
      },
    })
  })

  it('purges stored sessions whose persisted workspaceId is null before restore runs', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson({ workspaceId: null }),
    })
    const client = createClient()
    const controller = createSessionController({ client, storage })

    await controller.initialize()

    expect(client.inspectSession).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      resolvedWorkspaceOrigin: null,
      isProtectedReady: false,
      sessionStatus: null,
    })
    expect(storage.dump()).toEqual({})
  })

  it('purges stored sessions whose persisted workspaceId is omitted before restore runs', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson({ omitWorkspaceId: true }),
    })
    const client = createClient()
    const controller = createSessionController({ client, storage })

    await controller.initialize()

    expect(client.inspectSession).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      resolvedWorkspaceOrigin: null,
      isProtectedReady: false,
      sessionStatus: null,
    })
    expect(storage.dump()).toEqual({})
  })

  it('purges stored sessions whose persisted workspaceId is blank before restore runs', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson({ workspaceId: '   ' }),
    })
    const client = createClient()
    const controller = createSessionController({ client, storage })

    await controller.initialize()

    expect(client.inspectSession).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      resolvedWorkspaceOrigin: null,
      isProtectedReady: false,
      sessionStatus: null,
    })
    expect(storage.dump()).toEqual({})
  })

  it('rewrites stored session metadata with the validated restore status while preserving the token', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson({
        roles: ['stale-role'],
        expiresAt: '2026-04-01T00:00:00.000Z',
      }),
    })
    const client = createClient({
      inspectSession: vi.fn().mockResolvedValue(
        createStatus({
          roles: ['user', 'supervisor'],
          expiresAt: '2026-04-02T12:34:56.000Z',
        }),
      ),
    })
    const controller = createSessionController({ client, storage })

    await controller.initialize()

    expect(controller.getState()).toMatchObject({
      phase: 'authenticated',
      isProtectedReady: true,
      sessionStatus: {
        workspaceId: 'workspace_123',
        roles: ['user', 'supervisor'],
        expiresAt: '2026-04-02T12:34:56.000Z',
      },
    })
    expect(JSON.parse(storage.dump()[SESSION_STORAGE_KEY] ?? 'null')).toEqual({
      version: 1,
      workspaceOrigin: 'https://field.example.com',
      workspaceId: 'workspace_123',
      subject: 'worker',
      roles: ['user', 'supervisor'],
      expiresAt: '2026-04-02T12:34:56.000Z',
      session: {
        kind: 'local-mobile-session-v1',
        token: 'opaque-worker-token',
      },
    })
  })

  it('purges invalidated stored sessions after relaunch and returns to a safe login step for the same workspace', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson({ token: 'stale-token' }),
    })
    const cacheStore = createCachePurgeHarness()
    cacheStore.purgeForRevocation.mockResolvedValueOnce({
      purged: true,
      reason: 'session-revoked',
      durableAttachmentUris: ['file:///drafts/revoked.jpg'],
    })
    const deleteDurableAttachment = vi.fn().mockResolvedValue(undefined)
    const client = createClient({
      inspectSession: vi.fn().mockRejectedValue(
        new MobileSessionClientError(401, 'ERR_MOBILE_SESSION_REQUIRED'),
      ),
    })
    const controller = createSessionController({
      client,
      storage,
      cacheStore,
      deleteDurableAttachment,
    })

    await controller.initialize()

    expect(cacheStore.purgeForRevocation).toHaveBeenCalledWith(
      createNamespace(),
      401,
    )
    expect(deleteDurableAttachment).toHaveBeenCalledWith('file:///drafts/revoked.jpg')
    expect(controller.getState()).toMatchObject({
      phase: 'credentials',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      isProtectedReady: false,
      banner: {
        kind: 'error',
        message: 'Your session expired. Sign in again to continue.',
      },
    })
    expect(storage.dump()).toEqual({})
  })

  it('purges stored sessions when restore validation resolves a different workspaceId for the same origin', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson(),
    })
    const cacheStore = createCachePurgeHarness()
    cacheStore.purgeForWorkspaceSwitch.mockResolvedValueOnce({
      purged: true,
      reason: 'workspace-switch',
      durableAttachmentUris: ['file:///drafts/workspace.jpg'],
    })
    const deleteDurableAttachment = vi.fn().mockResolvedValue(undefined)
    const client = createClient({
      inspectSession: vi.fn().mockResolvedValue(createStatus({ workspaceId: 'workspace_999' })),
    })
    const controller = createSessionController({
      client,
      storage,
      cacheStore,
      deleteDurableAttachment,
    })

    await controller.initialize()

    expect(cacheStore.purgeForWorkspaceSwitch).toHaveBeenCalledWith(
      createNamespace(),
      createNamespace({ workspaceId: 'workspace_999' }),
    )
    expect(deleteDurableAttachment).toHaveBeenCalledWith('file:///drafts/workspace.jpg')
    expect(controller.getState()).toMatchObject({
      phase: 'credentials',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      isProtectedReady: false,
      banner: {
        kind: 'error',
        message: 'Your session expired. Sign in again to continue.',
      },
    })
    expect(storage.dump()).toEqual({})
  })

  it('purges stored cache namespaces when restore validation resolves a different subject for the same workspace', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson(),
    })
    const cacheStore = createCachePurgeHarness()
    cacheStore.purgeForReauth.mockResolvedValueOnce({
      purged: true,
      reason: 'reauth',
      durableAttachmentUris: ['file:///drafts/reauth.jpg'],
    })
    const deleteDurableAttachment = vi.fn().mockResolvedValue(undefined)
    const client = createClient({
      inspectSession: vi.fn().mockResolvedValue(createStatus({ subject: 'worker-2' })),
    })
    const controller = createSessionController({
      client,
      storage,
      cacheStore,
      deleteDurableAttachment,
    })

    await controller.initialize()

    expect(cacheStore.purgeForReauth).toHaveBeenCalledWith(
      createNamespace(),
      createNamespace({ subject: 'worker-2' }),
    )
    expect(deleteDurableAttachment).toHaveBeenCalledWith('file:///drafts/reauth.jpg')
    expect(controller.getState()).toMatchObject({
      phase: 'credentials',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      isProtectedReady: false,
    })
    expect(storage.dump()).toEqual({})
  })

  it('cleans durable attachment files during an explicit workspace switch before returning to workspace entry', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson(),
    })
    const cacheStore = createCachePurgeHarness()
    cacheStore.purgeNamespace.mockResolvedValueOnce({
      purged: true,
      reason: 'workspace-switch',
      durableAttachmentUris: ['file:///drafts/reset-workspace.jpg'],
    })
    const deleteDurableAttachment = vi.fn().mockResolvedValue(undefined)
    const client = createClient()
    const controller = createSessionController({
      client,
      storage,
      cacheStore,
      deleteDurableAttachment,
    })

    await controller.initialize()
    await controller.resetWorkspace()

    expect(cacheStore.purgeNamespace).toHaveBeenCalledWith(
      createNamespace(),
      'workspace-switch',
    )
    expect(deleteDurableAttachment).toHaveBeenCalledWith('file:///drafts/reset-workspace.jpg')
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      isProtectedReady: false,
      banner: {
        kind: 'notice',
        message: 'Choose a workspace to continue.',
      },
    })
    expect(storage.dump()).toEqual({})
  })

  it('purges protected cache namespaces during explicit logout before returning to workspace entry', async () => {
    const storage = createMemorySessionStorage({
      [SESSION_STORAGE_KEY]: createStoredSessionJson(),
    })
    const cacheStore = createCachePurgeHarness()
    cacheStore.purgeForLogout.mockResolvedValueOnce({
      purged: true,
      reason: 'logout',
      durableAttachmentUris: [
        'file:///drafts/logout-1.jpg',
        'file:///drafts/logout-2.jpg',
      ],
    })
    const deleteDurableAttachment = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce(undefined)
    const client = createClient()
    const controller = createSessionController({
      client,
      storage,
      cacheStore,
      deleteDurableAttachment,
    })

    await controller.initialize()
    await controller.logout()

    expect(cacheStore.purgeForLogout).toHaveBeenCalledWith(createNamespace())
    expect(deleteDurableAttachment).toHaveBeenCalledTimes(2)
    expect(deleteDurableAttachment).toHaveBeenNthCalledWith(1, 'file:///drafts/logout-1.jpg')
    expect(deleteDurableAttachment).toHaveBeenNthCalledWith(2, 'file:///drafts/logout-2.jpg')
    expect(controller.getState()).toMatchObject({
      phase: 'workspace-entry',
      isProtectedReady: false,
      banner: {
        kind: 'notice',
        message: 'Signed out.',
      },
    })
    expect(storage.dump()).toEqual({})
  })
})
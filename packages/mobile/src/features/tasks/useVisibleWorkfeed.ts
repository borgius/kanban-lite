import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createMobileApiClient,
} from '../../lib/api/client'
import {
  DEFAULT_SESSION_NAMESPACE,
  createCacheStore,
  createExpoCacheStorage,
  hydrateWithPurgeCleanup,
} from '../sync/cache-store'
import { createExpoSessionStorage, readStoredSession } from '../auth/session-store'
import { isProtectedTaskAccessError } from './task-permissions'
import {
  buildVisibleWorkfeedModel, createVisibleHomeSnapshot,
  type WorkfeedLoadState,
  type UseVisibleWorkfeedOptions, type UseVisibleWorkfeedResult,
  type VisibleWorkfeedPhase, type VisibleWorkfeedSource, type DueBucket, type LandingStatus,
  type VisibleChecklistPreview, type VisibleTaskPreview, type VisibleWorkfeedSection,
  type VisibleWorkfeedCounts, type VisibleWorkfeedModel, type BuildVisibleWorkfeedInput,
  type CreateVisibleHomeSnapshotInput,
} from './workfeed-model'

export type { VisibleWorkfeedPhase, VisibleWorkfeedSource, DueBucket, LandingStatus }
export type { VisibleChecklistPreview, VisibleTaskPreview, VisibleWorkfeedSection }
export type { VisibleWorkfeedCounts, VisibleWorkfeedModel, BuildVisibleWorkfeedInput }
export type { CreateVisibleHomeSnapshotInput, UseVisibleWorkfeedOptions, UseVisibleWorkfeedResult }
export { createVisibleHomeSnapshot, buildVisibleWorkfeedModel }

const deleteDurableAttachmentDraftFile = async (uri: string): Promise<void> => {
  const { deleteDurableAttachmentDraft } = await import('../attachments/durable-drafts')
  await deleteDurableAttachmentDraft(uri)
}


export function useVisibleWorkfeed(
  options: UseVisibleWorkfeedOptions,
): UseVisibleWorkfeedResult {
  const sessionStorage = useMemo(
    () => options.sessionStorage ?? createExpoSessionStorage(),
    [options.sessionStorage],
  )
  const cacheStore = useMemo(
    () => options.cacheStore ?? createCacheStore({ storage: createExpoCacheStorage(), now: options.now }),
    [options.cacheStore, options.now],
  )
  const clientFactory = useMemo(
    () => options.createClient ?? createMobileApiClient,
    [options.createClient],
  )
  const [loadState, setLoadState] = useState<WorkfeedLoadState>({
    errorMessage: null,
    phase: 'blocked',
    source: 'none',
    tasks: [],
  })
  const loadIdRef = useRef(0)

  const load = useCallback(async () => {
    if (!options.authState.isProtectedReady || !options.authState.sessionStatus) {
      setLoadState({
        errorMessage: null,
        phase: 'blocked',
        source: 'none',
        tasks: [],
      })
      return
    }

    const currentLoadId = loadIdRef.current + 1
    loadIdRef.current = currentLoadId
    const isCurrent = () => loadIdRef.current === currentLoadId

    const storedSession = await readStoredSession(sessionStorage)
    if (!isCurrent()) {
      return
    }

    if (
      !storedSession ||
      storedSession.workspaceOrigin !== options.authState.sessionStatus.workspaceOrigin ||
      storedSession.workspaceId !== options.authState.sessionStatus.workspaceId ||
      storedSession.subject !== options.authState.sessionStatus.subject
    ) {
      setLoadState({
        errorMessage: 'ERR_MOBILE_SESSION_REQUIRED',
        phase: 'error',
        source: 'none',
        tasks: [],
      })
      return
    }

    const namespace = {
      sessionNamespace: DEFAULT_SESSION_NAMESPACE,
      subject: storedSession.subject,
      workspaceId: storedSession.workspaceId,
      workspaceOrigin: storedSession.workspaceOrigin,
    }

    const hydrated = await hydrateWithPurgeCleanup(
      cacheStore,
      {
        namespace,
        sessionValidated: true,
      },
      {
        deleteDurableAttachment: deleteDurableAttachmentDraftFile,
      },
    )

    const cachedTasks =
      hydrated.kind === 'hydrated' &&
      hydrated.envelope.snapshots.home?.workspaceId === namespace.workspaceId
        ? hydrated.envelope.snapshots.home.tasks ?? []
        : []

    if (cachedTasks.length > 0) {
      setLoadState({
        errorMessage: null,
        phase: 'loading',
        source: 'cache',
        tasks: cachedTasks,
      })
    } else {
      setLoadState({
        errorMessage: null,
        phase: 'loading',
        source: 'none',
        tasks: [],
      })
    }

    try {
      const client = clientFactory({
        token: storedSession.session.token,
        workspaceOrigin: storedSession.workspaceOrigin,
      })
      const liveTasks = await client.listTasks()
      if (!isCurrent()) {
        return
      }

      await cacheStore.replaceSnapshots(namespace, {
        home: createVisibleHomeSnapshot({
          pendingTarget: options.authState.pendingTarget,
          tasks: liveTasks,
          workspaceId: namespace.workspaceId,
        }),
      })

      if (!isCurrent()) {
        return
      }

      setLoadState({
        errorMessage: null,
        phase: liveTasks.length > 0 ? 'ready' : 'empty',
        source: 'live',
        tasks: liveTasks,
      })
    } catch (error) {
      if (!isCurrent()) {
        return
      }

      if (isProtectedTaskAccessError(error)) {
        await options.onProtectedError?.(error.status as 401 | 403)

        if (!isCurrent()) {
          return
        }

        setLoadState({
          errorMessage: error.message,
          phase: 'blocked',
          source: 'none',
          tasks: [],
        })
        return
      }

      if (cachedTasks.length > 0) {
        setLoadState({
          errorMessage: error instanceof Error ? error.message : 'Unable to refresh visible work.',
          phase: 'ready',
          source: 'cache',
          tasks: cachedTasks,
        })
        return
      }

      setLoadState({
        errorMessage: error instanceof Error ? error.message : 'Unable to load visible work.',
        phase: 'error',
        source: 'none',
        tasks: [],
      })
    }
  }, [
    cacheStore,
    clientFactory,
    options.authState.isProtectedReady,
    options.authState.pendingTarget,
    options.authState.sessionStatus,
    options.onProtectedError,
    sessionStorage,
  ])

  useEffect(() => {
    if (!options.authState.isProtectedReady || !options.authState.sessionStatus) {
      loadIdRef.current += 1
      return
    }

    void load()

    return () => {
      loadIdRef.current += 1
    }
  }, [load, options.authState.isProtectedReady, options.authState.sessionStatus])

  const model = useMemo(
    () =>
      buildVisibleWorkfeedModel({
        errorMessage: loadState.errorMessage,
        now: options.now?.() ?? new Date(),
        pendingTarget: options.authState.pendingTarget,
        phase: options.authState.isProtectedReady ? loadState.phase : 'blocked',
        protectedReady: options.authState.isProtectedReady,
        source: loadState.source,
        tasks: loadState.tasks,
        workspaceId: options.authState.sessionStatus?.workspaceId ?? null,
      }),
    [
      loadState.errorMessage,
      loadState.phase,
      loadState.source,
      loadState.tasks,
      options.authState.isProtectedReady,
      options.authState.pendingTarget,
      options.authState.sessionStatus?.workspaceId,
      options.now,
    ],
  )

  const reload = useCallback(async () => {
    await load()
  }, [load])

  return {
    ...model,
    reload,
  }
}

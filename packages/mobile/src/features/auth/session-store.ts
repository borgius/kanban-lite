import { createContext, createElement, type ReactNode, useContext, useRef, useSyncExternalStore } from 'react'
import type { AuthSessionState, AuthBanner, MobileSessionExchange, MobileSessionController, MobileSessionClient, MobileSessionStorage, AuthPhase, ParsedEntry, StoredSessionRecord, DeleteDurableAttachment } from './session-store-types'
import { SESSION_STORAGE_KEY, SESSION_STORAGE_VERSION, MOBILE_SESSION_KIND, deleteDurableAttachmentDraftFile, MobileSessionClientError } from './session-store-types'
import { createInitialState, createFetchMobileSessionClient, createExpoSessionStorage, normalizeWorkspaceInput, parseEntryInput, readStoredSession, clearStoredSession, persistStoredSession, toCacheNamespace, createSessionExpiredBanner, createWorkspaceBanner, createAuthLinkBanner, createRevokedSessionBanner, createCredentialBanner } from './session-store-utils'
import { buildMobileSessionController } from './session-store-controller'
import { DEFAULT_SESSION_NAMESPACE, createCacheStore, createExpoCacheStorage, type CacheNamespace, type CacheStore, type PurgeResult } from '../sync/cache-store'
export type { MobileAuthenticationContract, ResolvedMobileBootstrap, MobileSessionStatus, MobileSessionExchange, MobileSessionStorage, MemorySessionStorage, MobileSessionClient, AuthBanner, AuthSessionState, MobileSessionController } from './session-store-types'
export { SESSION_STORAGE_KEY, MobileSessionClientError } from './session-store-types'
export { readStoredSession, createFetchMobileSessionClient, createExpoSessionStorage, createMemorySessionStorage } from './session-store-utils'


interface ControllerDependencies {
  client?: MobileSessionClient
  storage?: MobileSessionStorage
  cacheStore?: Pick<
    CacheStore,
    'purgeForLogout' | 'purgeForReauth' | 'purgeForRevocation' | 'purgeForWorkspaceSwitch' | 'purgeNamespace'
  >
  deleteDurableAttachment?: DeleteDurableAttachment
}

const SessionControllerContext = createContext<MobileSessionController | null>(null)

export function createSessionController(
  dependencies: ControllerDependencies = {},
): MobileSessionController {
  const client = dependencies.client ?? createFetchMobileSessionClient()
  const storage = dependencies.storage ?? createExpoSessionStorage()
  const cacheStore =
    dependencies.cacheStore
    ?? createCacheStore({ storage: createExpoCacheStorage() })
  const deleteDurableAttachment =
    dependencies.deleteDurableAttachment ?? deleteDurableAttachmentDraftFile
  const listeners = new Set<() => void>()
  let state = createInitialState()
  let operationId = 0

  const emit = () => {
    listeners.forEach((listener) => listener())
  }

  const setState = (
    nextState:
      | AuthSessionState
      | ((previousState: AuthSessionState) => AuthSessionState),
  ) => {
    state = typeof nextState === 'function' ? nextState(state) : nextState
    emit()
  }

  const beginOperation = () => {
    operationId += 1
    return operationId
  }

  const isActiveOperation = (candidate: number) => candidate === operationId

  const cleanupDurableAttachments = async (durableAttachmentUris: readonly string[]) => {
    for (const durableAttachmentUri of durableAttachmentUris) {
      try {
        await deleteDurableAttachment(durableAttachmentUri)
      } catch {
        // Durable attachment cleanup is best-effort; auth/session purge must still win.
      }
    }
  }

  const purgeForProtectedTransition = async (
    input:
      | {
          reason: 'logout'
          namespace: CacheNamespace
        }
      | {
          reason: 'reauth'
          previousNamespace: CacheNamespace
          nextNamespace: CacheNamespace
        }
      | {
          reason: 'session-revoked'
          namespace: CacheNamespace
          status: 401 | 403
        }
      | {
          reason: 'workspace-switch'
          previousNamespace: CacheNamespace
          nextNamespace?: CacheNamespace
        },
  ): Promise<void> => {
    try {
      let purgeResult: PurgeResult

      if (input.reason === 'logout') {
        purgeResult = await cacheStore.purgeForLogout(input.namespace)
      } else if (input.reason === 'reauth') {
        purgeResult = await cacheStore.purgeForReauth(input.previousNamespace, input.nextNamespace)
      } else if (input.reason === 'session-revoked') {
        purgeResult = await cacheStore.purgeForRevocation(input.namespace, input.status)
      } else if (input.nextNamespace) {
        purgeResult = await cacheStore.purgeForWorkspaceSwitch(
          input.previousNamespace,
          input.nextNamespace,
        )
      } else {
        purgeResult = await cacheStore.purgeNamespace(input.previousNamespace, 'workspace-switch')
      }

      await cleanupDurableAttachments(purgeResult.durableAttachmentUris)
    } catch {
      // Cache purge is best-effort, but local session reset still wins.
    }
  }

  const showWorkspaceEntry = (banner: AuthBanner | null = null) => {
    setState((previousState) => ({
      ...previousState,
      phase: 'workspace-entry',
      statusMessage: null,
      resolvedWorkspaceOrigin: null,
      pendingTarget: null,
      banner,
      sessionStatus: null,
      isProtectedReady: false,
    }))
  }

  const showCredentials = (input: {
    workspaceInput: string
    workspaceOrigin: string
    pendingTarget?: string | null
    banner?: AuthBanner | null
  }) => {
    setState((previousState) => ({
      ...previousState,
      phase: 'credentials',
      statusMessage: null,
      workspaceInput: input.workspaceInput,
      resolvedWorkspaceOrigin: input.workspaceOrigin,
      pendingTarget: input.pendingTarget ?? null,
      banner: input.banner ?? null,
      sessionStatus: null,
      isProtectedReady: false,
    }))
  }

  const showBusy = (input: {
    phase: Extract<AuthPhase, 'restoring' | 'signing-in'>
    statusMessage: string
    workspaceInput?: string
    resolvedWorkspaceOrigin?: string | null
    pendingTarget?: string | null
  }) => {
    setState((previousState) => ({
      ...previousState,
      phase: input.phase,
      statusMessage: input.statusMessage,
      workspaceInput: input.workspaceInput ?? previousState.workspaceInput,
      resolvedWorkspaceOrigin:
        input.resolvedWorkspaceOrigin ?? previousState.resolvedWorkspaceOrigin,
      pendingTarget: input.pendingTarget ?? previousState.pendingTarget,
      banner: null,
      sessionStatus: null,
      isProtectedReady: false,
    }))
  }

  const showAuthenticated = (
    exchange: MobileSessionExchange,
    pendingTarget: string | null,
  ) => {
    setState((previousState) => ({
      ...previousState,
      phase: 'authenticated',
      statusMessage: null,
      workspaceInput: exchange.status.workspaceOrigin,
      resolvedWorkspaceOrigin: exchange.status.workspaceOrigin,
      pendingTarget,
      banner: null,
      sessionStatus: exchange.status,
      isProtectedReady: true,
    }))
  }

  const performExit = async (input: {
    reason: 'logout' | 'session-revoked' | 'workspace-switch'
    status?: 401 | 403
  }): Promise<AuthSessionState> => {
    const currentOperation = beginOperation()
    const storedSession = await readStoredSession(storage)
    const currentNamespace =
      storedSession
        ? toCacheNamespace(storedSession)
        : state.sessionStatus
          ? toCacheNamespace(state.sessionStatus)
          : null

    if (input.reason === 'logout' && storedSession) {
      try {
        await client.revokeSession({
          workspaceOrigin: storedSession.workspaceOrigin,
          token: storedSession.session.token,
        })
      } catch {
        // Best-effort revoke; local purge still wins.
      }
    }

    if (currentNamespace) {
      if (input.reason === 'logout') {
        await purgeForProtectedTransition({
          reason: 'logout',
          namespace: currentNamespace,
        })
      } else if (input.reason === 'session-revoked') {
        await purgeForProtectedTransition({
          reason: 'session-revoked',
          namespace: currentNamespace,
          status: input.status ?? 401,
        })
      } else {
        await purgeForProtectedTransition({
          reason: 'workspace-switch',
          previousNamespace: currentNamespace,
        })
      }
    }

    await clearStoredSession(storage)

    if (!isActiveOperation(currentOperation)) {
      return state
    }

    if (input.reason === 'logout') {
      showWorkspaceEntry({
        kind: 'notice',
        message: 'Signed out.',
      })
      return state
    }

    if (input.reason === 'workspace-switch') {
      showWorkspaceEntry({
        kind: 'notice',
        message: 'Choose a workspace to continue.',
      })
      return state
    }

    showWorkspaceEntry(createRevokedSessionBanner(input.status))
    return state
  }

  const restoreStoredSession = async (
    storedSession: StoredSessionRecord,
    input: {
      operation: number
      workspaceOrigin: string
      workspaceId?: string
      workspaceInput: string
      pendingTarget?: string | null
      bannerOnFailure?: AuthBanner
    },
  ) => {
    showBusy({
      phase: 'restoring',
      statusMessage: 'Checking session…',
      workspaceInput: input.workspaceInput,
      resolvedWorkspaceOrigin: input.workspaceOrigin,
      pendingTarget: input.pendingTarget,
    })

    try {
      const status = await client.inspectSession({
        workspaceOrigin: input.workspaceOrigin,
        token: storedSession.session.token,
      })

      if (!isActiveOperation(input.operation)) {
        return state
      }

      if (
        status.workspaceOrigin !== input.workspaceOrigin ||
        status.workspaceId !== storedSession.workspaceId ||
        status.subject !== storedSession.subject
      ) {
        const previousNamespace = toCacheNamespace(storedSession)
        const nextNamespace = toCacheNamespace(status)

        if (
          status.workspaceOrigin === storedSession.workspaceOrigin &&
          status.workspaceId === storedSession.workspaceId &&
          status.subject !== storedSession.subject
        ) {
          await purgeForProtectedTransition({
            reason: 'reauth',
            previousNamespace,
            nextNamespace,
          })
        } else {
          await purgeForProtectedTransition({
            reason: 'workspace-switch',
            previousNamespace,
            nextNamespace,
          })
        }

        await clearStoredSession(storage)

        if (!isActiveOperation(input.operation)) {
          return state
        }

        showCredentials({
          workspaceInput: input.workspaceInput,
          workspaceOrigin: input.workspaceOrigin,
          pendingTarget: input.pendingTarget,
          banner: input.bannerOnFailure ?? createSessionExpiredBanner(),
        })
        return state
      }

      const restoredExchange: MobileSessionExchange = {
        session: storedSession.session,
        status,
      }

      await persistStoredSession(storage, restoredExchange)

      if (!isActiveOperation(input.operation)) {
        return state
      }

      showAuthenticated(restoredExchange, input.pendingTarget ?? null)
      return state
    } catch (error) {
      if (
        error instanceof MobileSessionClientError &&
        (error.status === 401 || error.status === 403)
      ) {
        await purgeForProtectedTransition({
          reason: 'session-revoked',
          namespace: toCacheNamespace(storedSession),
          status: error.status,
        })
      }

      await clearStoredSession(storage)

      if (!isActiveOperation(input.operation)) {
        return state
      }

      showCredentials({
        workspaceInput: input.workspaceInput,
        workspaceOrigin: input.workspaceOrigin,
        pendingTarget: input.pendingTarget,
        banner: input.bannerOnFailure ?? createSessionExpiredBanner(),
      })
      return state
    }
  }

  const resolveEntry = async (
    entry: ParsedEntry,
    input: {
      operation: number
      source: 'typed' | 'deep-link' | 'qr'
      reuseStoredSession?: StoredSessionRecord | null
    },
  ) => {
    const workspaceInput = normalizeWorkspaceInput(entry.workspaceOrigin)
    if (!workspaceInput) {
      showWorkspaceEntry(createWorkspaceBanner(new Error('ERR_MOBILE_WORKSPACE_UNRESOLVED')))
      return state
    }

    showBusy({
      phase: 'restoring',
      statusMessage:
        input.source === 'typed' ? 'Opening workspace…' : 'Resolving sign-in link…',
      workspaceInput,
      resolvedWorkspaceOrigin: null,
      pendingTarget: entry.target,
    })

    try {
      const bootstrap = await client.resolveBootstrap({
        workspaceOrigin: workspaceInput,
        bootstrapToken: entry.bootstrapToken,
      })

      if (!isActiveOperation(input.operation)) {
        return state
      }

      if (bootstrap.nextStep === 'redeem-bootstrap-token' && entry.bootstrapToken) {
        showBusy({
          phase: 'signing-in',
          statusMessage: 'Redeeming sign-in link…',
          workspaceInput,
          resolvedWorkspaceOrigin: bootstrap.workspaceOrigin,
          pendingTarget: entry.target,
        })

        try {
          const exchange = await client.createSession({
            workspaceOrigin: bootstrap.workspaceOrigin,
            bootstrapToken: entry.bootstrapToken,
          })

          if (!isActiveOperation(input.operation)) {
            return state
          }

          await persistStoredSession(storage, exchange)

          if (!isActiveOperation(input.operation)) {
            return state
          }

          showAuthenticated(exchange, entry.target)
          return state
        } catch (error) {
          await clearStoredSession(storage)

          if (!isActiveOperation(input.operation)) {
            return state
          }

          showCredentials({
            workspaceInput,
            workspaceOrigin: bootstrap.workspaceOrigin,
            pendingTarget: entry.target,
            banner: createAuthLinkBanner(error),
          })
          return state
        }
      }

      const storedSession = input.reuseStoredSession ?? (await readStoredSession(storage))
      if (!isActiveOperation(input.operation)) {
        return state
      }

      if (storedSession) {
        return restoreStoredSession(storedSession, {
          operation: input.operation,
          workspaceOrigin: bootstrap.workspaceOrigin,
          workspaceId: bootstrap.workspaceId,
          workspaceInput,
          pendingTarget: entry.target,
        })
      }

      showCredentials({
        workspaceInput,
        workspaceOrigin: bootstrap.workspaceOrigin,
        pendingTarget: entry.target,
      })
      return state
    } catch (error) {
      if (!isActiveOperation(input.operation)) {
        return state
      }

      showWorkspaceEntry(createWorkspaceBanner(error))
      return state
    }
  }


  return buildMobileSessionController({
    getState: () => state,
    setState,
    listeners,
    beginOperation,
    isActiveOperation,
    storage,
    client,
    resolveEntry,
    restoreStoredSession,
    showWorkspaceEntry,
    showAuthenticated,
    showCredentials,
    showBusy,
    performExit,
  })
}


export function SessionControllerProvider({
  children,
  dependencies,
}: {
  children: ReactNode
  dependencies?: ControllerDependencies
}) {
  const controllerRef = useRef<MobileSessionController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createSessionController(dependencies)
  }

  return createElement(
    SessionControllerContext.Provider,
    { value: controllerRef.current },
    children,
  )
}

export function useSessionController(
  dependencies?: ControllerDependencies,
): { controller: MobileSessionController; state: AuthSessionState } {
  const sharedController = useContext(SessionControllerContext)
  const controllerRef = useRef<MobileSessionController | null>(null)
  if (!sharedController && !controllerRef.current) {
    controllerRef.current = createSessionController(dependencies)
  }

  const controller = sharedController ?? controllerRef.current
  if (!controller) {
    throw new Error('Mobile session controller is unavailable.')
  }

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  )

  return {
    controller,
    state: snapshot,
  }
}

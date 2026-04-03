import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react'

import {
  DEFAULT_SESSION_NAMESPACE,
  createCacheStore,
  createExpoCacheStorage,
  type CacheNamespace,
  type CacheStore,
  type PurgeResult,
} from '../sync/cache-store'

export const SESSION_STORAGE_KEY = 'kanban-lite/mobile-session-v1'
const SESSION_STORAGE_VERSION = 1 as const
const MOBILE_SESSION_KIND = 'local-mobile-session-v1' as const

type AuthPhase = 'restoring' | 'workspace-entry' | 'credentials' | 'signing-in' | 'authenticated'
type BannerKind = 'error' | 'notice'

export interface MobileAuthenticationContract {
  provider: 'local'
  browserLoginTransport: 'cookie-session'
  mobileSessionTransport: 'opaque-bearer'
  sessionKind: typeof MOBILE_SESSION_KIND
}

export interface ResolvedMobileBootstrap {
  workspaceOrigin: string
  workspaceId: string
  authentication: MobileAuthenticationContract
  bootstrapToken: {
    provided: boolean
    mode: 'none' | 'one-time'
  }
  nextStep: 'local-login' | 'redeem-bootstrap-token'
}

export interface MobileSessionStatus {
  workspaceOrigin: string
  workspaceId: string
  subject: string
  roles: string[]
  expiresAt: string | null
  authentication: MobileAuthenticationContract
}

export interface MobileSessionExchange {
  session: {
    kind: typeof MOBILE_SESSION_KIND
    token: string
  }
  status: MobileSessionStatus
}

export interface MobileSessionClient {
  resolveBootstrap(input: {
    workspaceOrigin: string
    bootstrapToken?: string | null
  }): Promise<ResolvedMobileBootstrap>
  createSession(input: {
    workspaceOrigin: string
    username?: string
    password?: string
    bootstrapToken?: string | null
  }): Promise<MobileSessionExchange>
  inspectSession(input: {
    workspaceOrigin: string
    token: string
  }): Promise<MobileSessionStatus>
  revokeSession(input: { workspaceOrigin: string; token: string }): Promise<void>
}

export interface MobileSessionStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface MemorySessionStorage extends MobileSessionStorage {
  dump(): Record<string, string>
}

export interface AuthBanner {
  kind: BannerKind
  message: string
  code?: string
}

export interface AuthSessionState {
  phase: AuthPhase
  statusMessage: string | null
  workspaceInput: string
  resolvedWorkspaceOrigin: string | null
  pendingTarget: string | null
  banner: AuthBanner | null
  sessionStatus: MobileSessionStatus | null
  isProtectedReady: boolean
}

interface StoredSessionRecord {
  version: typeof SESSION_STORAGE_VERSION
  workspaceOrigin: string
  workspaceId: string
  subject: string
  roles: string[]
  expiresAt: string | null
  session: {
    kind: typeof MOBILE_SESSION_KIND
    token: string
  }
}

interface ParsedEntry {
  workspaceOrigin: string
  bootstrapToken: string | null
  target: string | null
}

export interface MobileSessionController {
  getState(): AuthSessionState
  subscribe(listener: () => void): () => void
  setWorkspaceInput(workspaceInput: string): void
  initialize(initialEntry?: string | null): Promise<AuthSessionState>
  submitWorkspace(workspaceInput: string): Promise<AuthSessionState>
  submitCredentials(input: { username: string; password: string }): Promise<AuthSessionState>
  handleIncomingEntry(entryInput: string, source?: 'deep-link' | 'qr'): Promise<AuthSessionState>
  handleQrOutcome(outcome: 'cancelled' | 'denied'): void
  clearPendingTarget(): void
  resetWorkspace(): Promise<AuthSessionState>
  logout(input?: {
    reason?: 'logout' | 'session-revoked' | 'workspace-switch'
    status?: 401 | 403
  }): Promise<AuthSessionState>
}

type DeleteDurableAttachment = (uri: string) => Promise<void>

const deleteDurableAttachmentDraftFile: DeleteDurableAttachment = async (uri) => {
  const { deleteDurableAttachmentDraft } = await import('../attachments/durable-drafts')
  await deleteDurableAttachmentDraft(uri)
}

export class MobileSessionClientError extends Error {
  public readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'MobileSessionClientError'
    this.status = status
  }
}

function createInitialState(): AuthSessionState {
  return {
    phase: 'restoring',
    statusMessage: 'Checking session…',
    workspaceInput: '',
    resolvedWorkspaceOrigin: null,
    pendingTarget: null,
    banner: null,
    sessionStatus: null,
    isProtectedReady: false,
  }
}

function normalizeWorkspaceInput(workspaceInput: string): string {
  const trimmed = workspaceInput.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

function parseEntryInput(entryInput?: string | null): ParsedEntry | null {
  const trimmed = entryInput?.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    const workspaceOrigin = parsed.searchParams.get('workspaceOrigin')?.trim()
    const bootstrapToken = parsed.searchParams.get('bootstrapToken')?.trim() ?? null
    const target = parsed.searchParams.get('target')?.trim() ?? null

    if (workspaceOrigin) {
      return {
        workspaceOrigin: normalizeWorkspaceInput(workspaceOrigin),
        bootstrapToken,
        target,
      }
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return {
        workspaceOrigin: `${parsed.origin}${parsed.pathname}`,
        bootstrapToken,
        target,
      }
    }
  } catch {
    return {
      workspaceOrigin: normalizeWorkspaceInput(trimmed),
      bootstrapToken: null,
      target: null,
    }
  }

  return {
    workspaceOrigin: normalizeWorkspaceInput(trimmed),
    bootstrapToken: null,
    target: null,
  }
}

function toStoredSessionRecord(exchange: MobileSessionExchange): StoredSessionRecord {
  return {
    version: SESSION_STORAGE_VERSION,
    workspaceOrigin: exchange.status.workspaceOrigin,
    workspaceId: exchange.status.workspaceId,
    subject: exchange.status.subject,
    roles: [...exchange.status.roles],
    expiresAt: exchange.status.expiresAt,
    session: {
      kind: exchange.session.kind,
      token: exchange.session.token,
    },
  }
}

function readStoredWorkspaceId(workspaceId: unknown): string | null {
  if (typeof workspaceId !== 'string') {
    return null
  }

  const trimmed = workspaceId.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isStoredSessionRecord(value: unknown): value is StoredSessionRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<StoredSessionRecord>
  return (
    candidate.version === SESSION_STORAGE_VERSION &&
    typeof candidate.workspaceOrigin === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.subject === 'string' &&
    Array.isArray(candidate.roles) &&
    (candidate.expiresAt === null || typeof candidate.expiresAt === 'string') &&
    !!candidate.session &&
    candidate.session.kind === MOBILE_SESSION_KIND &&
    typeof candidate.session.token === 'string'
  )
}

export async function readStoredSession(
  storage: MobileSessionStorage,
): Promise<StoredSessionRecord | null> {
  const raw = await storage.getItem(SESSION_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isStoredSessionRecord(parsed)) {
      await storage.removeItem(SESSION_STORAGE_KEY)
      return null
    }

    const workspaceId = readStoredWorkspaceId(parsed.workspaceId)
    if (workspaceId === null) {
      await storage.removeItem(SESSION_STORAGE_KEY)
      return null
    }

    return {
      ...parsed,
      workspaceId,
    }
  } catch {
    await storage.removeItem(SESSION_STORAGE_KEY)
    return null
  }
}

async function persistStoredSession(
  storage: MobileSessionStorage,
  exchange: MobileSessionExchange,
): Promise<void> {
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toStoredSessionRecord(exchange)))
}

async function clearStoredSession(storage: MobileSessionStorage): Promise<void> {
  await storage.removeItem(SESSION_STORAGE_KEY)
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
}

function createSessionExpiredBanner(): AuthBanner {
  return {
    kind: 'error',
    message: 'Your session expired. Sign in again to continue.',
  }
}

function createWorkspaceBanner(error: unknown): AuthBanner {
  const message = toErrorMessage(error, 'ERR_MOBILE_WORKSPACE_UNRESOLVED')
  return {
    kind: 'error',
    code: message === 'ERR_MOBILE_WORKSPACE_UNRESOLVED' ? message : undefined,
    message:
      message === 'ERR_MOBILE_WORKSPACE_UNRESOLVED'
        ? 'Enter a valid workspace domain or mobile sign-in link.'
        : message,
  }
}

function createAuthLinkBanner(error: unknown): AuthBanner {
  const message = toErrorMessage(error, 'ERR_MOBILE_AUTH_LINK_INVALID')
  return {
    kind: 'error',
    code: message === 'ERR_MOBILE_AUTH_LINK_INVALID' ? message : undefined,
    message,
  }
}

function createCredentialBanner(): AuthBanner {
  return {
    kind: 'error',
    message: 'Sign in failed. Check your username and password and try again.',
  }
}

function createRevokedSessionBanner(status?: 401 | 403): AuthBanner {
  if (status === 403) {
    return {
      kind: 'error',
      message: 'This workspace session is no longer valid. Sign in again to continue.',
    }
  }

  return createSessionExpiredBanner()
}

function toCacheNamespace(input: {
  workspaceOrigin: string
  workspaceId: string
  subject: string
}): CacheNamespace {
  return {
    workspaceOrigin: input.workspaceOrigin,
    workspaceId: input.workspaceId,
    subject: input.subject,
    sessionNamespace: DEFAULT_SESSION_NAMESPACE,
  }
}

function resolveFetchImplementation(): typeof fetch {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch is not available in this runtime.')
  }

  return fetch
}

function resolveWorkspaceBaseUrl(workspaceOrigin: string): URL {
  const normalized = normalizeWorkspaceInput(workspaceOrigin)
  let parsed: URL

  try {
    parsed = new URL(normalized)
  } catch {
    throw new MobileSessionClientError(400, 'ERR_MOBILE_WORKSPACE_UNRESOLVED')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MobileSessionClientError(400, 'ERR_MOBILE_WORKSPACE_UNRESOLVED')
  }

  return parsed
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<T> {
  const response = await fetchImplementation(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const payload = (await response.json()) as { ok?: boolean; data?: T; error?: string }

  if (!response.ok) {
    throw new MobileSessionClientError(response.status, payload.error ?? response.statusText)
  }

  if (!payload || payload.ok !== true || payload.data === undefined) {
    throw new MobileSessionClientError(response.status, 'Invalid mobile auth response payload.')
  }

  return payload.data
}

async function requestOk(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<void> {
  const response = await fetchImplementation(url, init)
  const payload = (await response.json()) as { ok?: boolean; error?: string }

  if (!response.ok) {
    throw new MobileSessionClientError(response.status, payload.error ?? response.statusText)
  }

  if (!payload || payload.ok !== true) {
    throw new MobileSessionClientError(response.status, 'Invalid mobile auth response payload.')
  }
}

export function createFetchMobileSessionClient(
  fetchImplementation: typeof fetch = resolveFetchImplementation(),
): MobileSessionClient {
  return {
    async resolveBootstrap(input) {
      const endpoint = new URL('/api/mobile/bootstrap', resolveWorkspaceBaseUrl(input.workspaceOrigin))
      return requestJson<ResolvedMobileBootstrap>(
        endpoint.toString(),
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceOrigin: normalizeWorkspaceInput(input.workspaceOrigin),
            bootstrapToken: input.bootstrapToken ?? undefined,
          }),
        },
        fetchImplementation,
      )
    },
    async createSession(input) {
      const endpoint = new URL('/api/mobile/session', resolveWorkspaceBaseUrl(input.workspaceOrigin))
      return requestJson<MobileSessionExchange>(
        endpoint.toString(),
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceOrigin: normalizeWorkspaceInput(input.workspaceOrigin),
            username: input.username,
            password: input.password,
            bootstrapToken: input.bootstrapToken ?? undefined,
          }),
        },
        fetchImplementation,
      )
    },
    async inspectSession(input) {
      const endpoint = new URL('/api/mobile/session', resolveWorkspaceBaseUrl(input.workspaceOrigin))
      endpoint.searchParams.set('workspaceOrigin', normalizeWorkspaceInput(input.workspaceOrigin))
      return requestJson<MobileSessionStatus>(
        endpoint.toString(),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${input.token}`,
          },
        },
        fetchImplementation,
      )
    },
    async revokeSession(input) {
      const endpoint = new URL('/api/mobile/session', resolveWorkspaceBaseUrl(input.workspaceOrigin))
      await requestOk(
        endpoint.toString(),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${input.token}`,
          },
        },
        fetchImplementation,
      )
    },
  }
}

export function createExpoSessionStorage(): MobileSessionStorage {
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

export function createMemorySessionStorage(initial: Record<string, string> = {}): MemorySessionStorage {
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

  return {
    getState() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setWorkspaceInput(workspaceInput) {
      setState((previousState) => ({
        ...previousState,
        workspaceInput,
      }))
    },
    async initialize(initialEntry) {
      const currentOperation = beginOperation()
      const parsedEntry = parseEntryInput(initialEntry)
      const storedSession = await readStoredSession(storage)

      if (!isActiveOperation(currentOperation)) {
        return state
      }

      if (parsedEntry) {
        return resolveEntry(parsedEntry, {
          operation: currentOperation,
          source: 'deep-link',
          reuseStoredSession: storedSession,
        })
      }

      if (storedSession) {
        return restoreStoredSession(storedSession, {
          operation: currentOperation,
          workspaceOrigin: storedSession.workspaceOrigin,
          workspaceInput: storedSession.workspaceOrigin,
        })
      }

      showWorkspaceEntry()
      return state
    },
    async submitWorkspace(workspaceInput) {
      const currentOperation = beginOperation()
      return resolveEntry(
        {
          workspaceOrigin: workspaceInput,
          bootstrapToken: null,
          target: null,
        },
        {
          operation: currentOperation,
          source: 'typed',
        },
      )
    },
    async submitCredentials(input) {
      const currentOperation = beginOperation()
      const workspaceOrigin = state.resolvedWorkspaceOrigin

      if (!workspaceOrigin) {
        showWorkspaceEntry(createWorkspaceBanner(new Error('ERR_MOBILE_WORKSPACE_UNRESOLVED')))
        return state
      }

      showBusy({
        phase: 'signing-in',
        statusMessage: 'Signing in…',
        workspaceInput: state.workspaceInput,
        resolvedWorkspaceOrigin: workspaceOrigin,
        pendingTarget: state.pendingTarget,
      })

      try {
        const exchange = await client.createSession({
          workspaceOrigin,
          username: input.username,
          password: input.password,
        })

        if (!isActiveOperation(currentOperation)) {
          return state
        }

        await persistStoredSession(storage, exchange)

        if (!isActiveOperation(currentOperation)) {
          return state
        }

        showAuthenticated(exchange, state.pendingTarget)
        return state
      } catch {
        if (!isActiveOperation(currentOperation)) {
          return state
        }

        showCredentials({
          workspaceInput: state.workspaceInput,
          workspaceOrigin,
          pendingTarget: state.pendingTarget,
          banner: createCredentialBanner(),
        })
        return state
      }
    },
    async handleIncomingEntry(entryInput, source = 'deep-link') {
      const parsedEntry = parseEntryInput(entryInput)
      const currentOperation = beginOperation()

      if (!parsedEntry) {
        showWorkspaceEntry(createWorkspaceBanner(new Error('ERR_MOBILE_WORKSPACE_UNRESOLVED')))
        return state
      }

      return resolveEntry(parsedEntry, {
        operation: currentOperation,
        source,
      })
    },
    handleQrOutcome(outcome) {
      setState((previousState) => ({
        ...previousState,
        phase: 'workspace-entry',
        statusMessage: null,
        banner:
          outcome === 'cancelled'
            ? {
                kind: 'notice',
                message: 'QR entry cancelled.',
              }
            : {
                kind: 'error',
                message: 'Camera access is required to scan a QR code. Paste the link instead.',
              },
        sessionStatus: null,
        resolvedWorkspaceOrigin: null,
        pendingTarget: null,
        isProtectedReady: false,
      }))
    },
    clearPendingTarget() {
      setState((previousState) => ({
        ...previousState,
        pendingTarget: null,
      }))
    },
    async resetWorkspace() {
      return performExit({ reason: 'workspace-switch' })
    },
    async logout(input) {
      return performExit({
        reason: input?.reason ?? 'logout',
        status: input?.status,
      })
    },
  }
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
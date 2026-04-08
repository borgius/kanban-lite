import type {
  MobileAuthenticationContract,
  ResolvedMobileBootstrap,
  MobileSessionStatus,
  MobileSessionExchange,
  MobileSessionStorage,
  MemorySessionStorage,
  MobileSessionClient,
  AuthBanner,
  AuthSessionState,
  StoredSessionRecord,
  ParsedEntry,
} from './session-store-types'
import {
  SESSION_STORAGE_KEY, SESSION_STORAGE_VERSION, MOBILE_SESSION_KIND,
  MobileSessionClientError,
} from './session-store-types'
import { DEFAULT_SESSION_NAMESPACE, type CacheNamespace } from '../sync/cache-store'
import { createExpoSecureStoreStorage } from '../../lib/expo-secure-store'

export function createInitialState(): AuthSessionState {
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

export function normalizeWorkspaceInput(workspaceInput: string): string {
  const trimmed = workspaceInput.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

export function parseEntryInput(entryInput?: string | null): ParsedEntry | null {
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

export function toStoredSessionRecord(exchange: MobileSessionExchange): StoredSessionRecord {
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

export function readStoredWorkspaceId(workspaceId: unknown): string | null {
  if (typeof workspaceId !== 'string') {
    return null
  }

  const trimmed = workspaceId.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isStoredSessionRecord(value: unknown): value is StoredSessionRecord {
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

export async function persistStoredSession(
  storage: MobileSessionStorage,
  exchange: MobileSessionExchange,
): Promise<void> {
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toStoredSessionRecord(exchange)))
}

export async function clearStoredSession(storage: MobileSessionStorage): Promise<void> {
  await storage.removeItem(SESSION_STORAGE_KEY)
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
}

export function createSessionExpiredBanner(): AuthBanner {
  return {
    kind: 'error',
    message: 'Your session expired. Sign in again to continue.',
  }
}

export function createWorkspaceBanner(error: unknown): AuthBanner {
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

export function createAuthLinkBanner(error: unknown): AuthBanner {
  const message = toErrorMessage(error, 'ERR_MOBILE_AUTH_LINK_INVALID')
  return {
    kind: 'error',
    code: message === 'ERR_MOBILE_AUTH_LINK_INVALID' ? message : undefined,
    message,
  }
}

export function createCredentialBanner(): AuthBanner {
  return {
    kind: 'error',
    message: 'Sign in failed. Check your username and password and try again.',
  }
}

export function createRevokedSessionBanner(status?: 401 | 403): AuthBanner {
  if (status === 403) {
    return {
      kind: 'error',
      message: 'This workspace session is no longer valid. Sign in again to continue.',
    }
  }

  return createSessionExpiredBanner()
}

export function toCacheNamespace(input: {
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

export function resolveFetchImplementation(): typeof fetch {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch is not available in this runtime.')
  }

  return fetch
}

export function resolveWorkspaceBaseUrl(workspaceOrigin: string): URL {
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
  return createExpoSecureStoreStorage()
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

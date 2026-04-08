import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react'

import { createExpoSecureStoreStorage } from '../../lib/expo-secure-store'
import {
  DEFAULT_SESSION_NAMESPACE,
  createCacheStore,
  createExpoCacheStorage,
  type CacheNamespace,
  type CacheStore,
  type PurgeResult,
} from '../sync/cache-store'

export const SESSION_STORAGE_KEY = 'kanban-lite/mobile-session-v1'
export const SESSION_STORAGE_VERSION = 1 as const
export const MOBILE_SESSION_KIND = 'local-mobile-session-v1' as const

export type AuthPhase = 'restoring' | 'workspace-entry' | 'credentials' | 'signing-in' | 'authenticated'
export type BannerKind = 'error' | 'notice'

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

export interface StoredSessionRecord {
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

export interface ParsedEntry {
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

export type DeleteDurableAttachment = (uri: string) => Promise<void>

export const deleteDurableAttachmentDraftFile: DeleteDurableAttachment = async (uri) => {
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


export type ShowCredentialsInput = {
  workspaceInput: string
  workspaceOrigin: string
  pendingTarget?: string | null
  banner?: AuthBanner | null
}

export type ResolveEntryContext = {
  getState: () => AuthSessionState
  setState: (next: AuthSessionState | ((prev: AuthSessionState) => AuthSessionState)) => void
  listeners: Set<() => void>
  beginOperation: () => number
  isActiveOperation: (candidate: number) => boolean
  storage: MobileSessionStorage
  client: MobileSessionClient
  resolveEntry: (entry: ParsedEntry, input: { operation: number; source: 'typed' | 'deep-link' | 'qr'; reuseStoredSession?: StoredSessionRecord | null }) => Promise<AuthSessionState>
  restoreStoredSession: (stored: StoredSessionRecord, input: { operation: number; workspaceOrigin: string; workspaceId?: string; workspaceInput: string; pendingTarget?: string | null; bannerOnFailure?: AuthBanner }) => Promise<AuthSessionState>
  showWorkspaceEntry: (banner?: AuthBanner | null) => void
  showAuthenticated: (exchange: MobileSessionExchange, pendingTarget: string | null) => void
  showCredentials: (input: ShowCredentialsInput) => void
  showBusy: (input: { phase: Extract<AuthPhase, 'restoring' | 'signing-in'>; statusMessage: string; workspaceInput?: string; resolvedWorkspaceOrigin?: string | null; pendingTarget?: string | null }) => void
  performExit: (input: { reason: 'logout' | 'session-revoked' | 'workspace-switch'; status?: 401 | 403 }) => Promise<AuthSessionState>
}

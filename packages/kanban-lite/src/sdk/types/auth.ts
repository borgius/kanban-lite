import type { KanbanSDK } from '../KanbanSDK'

export type AuthErrorCategory =
  | 'auth.identity.missing'  // No token supplied when one is required
  | 'auth.identity.invalid'  // Token present but failed validation
  | 'auth.identity.expired'  // Token present but expired
  | 'auth.policy.denied'     // Identity resolved but action not permitted
  | 'auth.policy.unknown'    // Policy plugin could not evaluate the action
  | 'auth.provider.error'    // Internal error from an identity or policy provider

/**
 * Authorization decision returned by {@link AuthPolicyPlugin.checkPolicy}.
 *
 * When {@link allowed} is `false`, {@link reason} provides a machine-readable
 * denial code suitable for mapping to HTTP 401/403, CLI exit codes, or MCP
 * tool error payloads.
 */
export interface AuthDecision {
  /** Whether the action is permitted. */
  allowed: boolean
  /** Machine-readable reason code. Present when {@link allowed} is `false`. */
  reason?: AuthErrorCategory
  /** Resolved caller subject from the identity plugin. Present when identity was established. */
  actor?: string
  /** Optional provider-supplied audit metadata (safe for logging). */
  metadata?: Record<string, unknown>
}

/**
 * Shared auth context passed from host surfaces into SDK operations.
 *
 * Host adapters (standalone server, CLI, MCP, extension) extract tokens from
 * their respective transports and construct this object before exercising the
 * SDK authorization seam. Tokens are never persisted to `.kanban.json`.
 */
export interface AuthContext {
  /**
   * Opaque bearer token provided by the host.
   * Never logged or surfaced in error responses.
   */
  token?: string
  /**
    * Identifies how the token was sourced (e.g. `'request-header'`, `'env'`, `'config'`, `'secret-storage'`).
   * Informational only; used for diagnostics and logging.
   */
  tokenSource?: string
  /**
    * Transport mechanism of the incoming request (e.g. `'http'`, `'mcp'`, `'extension'`, `'cli'`).
    * Informational only; used for diagnostics and logging.
    */
  transport?: string
  /**
   * Pre-resolved identity supplied by a trusted host integration such as
   * standalone middleware after validating a cookie-backed session.
   */
  identity?: { subject: string; roles?: string[]; groups?: string[] }
  /**
    * Optional non-authoritative hint for the caller identity.
    * Never trusted for authorization decisions; used for diagnostics and logging only.
    */
  actorHint?: string
  /** Target board ID relevant to the action being authorized. */
  boardId?: string
  /** Target card ID relevant to the action being authorized. */
  cardId?: string
  /** Source board ID for transfer-style operations. */
  fromBoardId?: string
  /** Destination board ID for transfer-style operations. */
  toBoardId?: string
  /** Target column/status ID relevant to the action being authorized. */
  columnId?: string
  /** Target comment ID relevant to the action being authorized. */
  commentId?: string
  /** Target form ID relevant to the action being authorized. */
  formId?: string
  /** Attachment filename relevant to the action being authorized. */
  attachment?: string
  /** Label name relevant to the action being authorized. */
  labelName?: string
  /** Webhook ID relevant to the action being authorized. */
  webhookId?: string
  /** Action key/name relevant to the action being authorized. */
  actionKey?: string
}

/**
 * Shared mobile/local auth transport contract for Expo-facing integrations.
 *
 * This keeps the existing `local` auth semantics as the source of truth while
 * making the transport split explicit: browser login remains cookie-based,
 * while the mobile app expects an opaque bearer session credential after the
 * bootstrap/login flow completes.
 */
export interface MobileAuthenticationContract {
  /** Fixed v1 provider scope. Mobile does not introduce a provider-agnostic auth layer. */
  provider: 'local'
  /** Existing browser transport reused by the standalone `/auth/login` flow. */
  browserLoginTransport: 'cookie-session'
  /** Opaque Expo credential transport used after the local auth flow succeeds. */
  mobileSessionTransport: 'opaque-bearer'
  /** Stable mobile credential kind persisted by the app after successful login or token redemption. */
  sessionKind: 'local-mobile-session-v1'
}

/**
 * Input for {@link KanbanSDK.resolveMobileBootstrap}.
 *
 * The SDK normalizes the workspace origin into a canonical URL origin and marks
 * whether the caller supplied a one-time bootstrap token that should continue
 * through the redemption branch instead of the ordinary local login path.
 */
export interface ResolveMobileBootstrapInput {
  /** Workspace base URL, typed origin, or canonical link origin supplied by the mobile app. */
  workspaceOrigin: string
  /** Optional one-time bootstrap token carried by a deep link or QR code. */
  bootstrapToken?: string | null
}

/**
 * Canonical result from {@link KanbanSDK.resolveMobileBootstrap}.
 *
 * This is the SDK-owned source of truth for the minimal mobile bootstrap seam:
 * resolve workspace origin, keep the auth provider fixed to `local`, and state
 * whether the client should continue to local login or redeem a one-time token.
 */
export interface ResolveMobileBootstrapResult {
  /** Canonical URL origin for the resolved workspace. */
  workspaceOrigin: string
  /** Stable workspace identifier safe for cache, draft, and restore namespace keys. */
  workspaceId: string
  /** Reused local-auth contract plus the approved mobile credential transport. */
  authentication: MobileAuthenticationContract
  /** Whether a one-time bootstrap token was supplied and how it should be treated. */
  bootstrapToken: {
    /** `true` when the caller supplied a non-empty token value. */
    provided: boolean
    /** Token handling mode for this request. */
    mode: 'none' | 'one-time'
  }
  /** Next mobile auth step after workspace resolution. */
  nextStep: 'local-login' | 'redeem-bootstrap-token'
}

/**
 * Input for {@link KanbanSDK.inspectMobileSession}.
 *
 * Host layers call this after validating a mobile credential against the
 * server-owned session store and resolving the safe subject/workspace metadata
 * that may be returned to the app for restore gating.
 */
export interface InspectMobileSessionInput {
  /** Workspace base URL or canonical origin tied to the validated session. */
  workspaceOrigin: string
  /** Resolved authenticated subject identifier. */
  subject: string
  /** Optional resolved roles or permission scopes for the authenticated subject. */
  roles?: string[]
  /** Optional expiry hint surfaced for UX only. */
  expiresAt?: string | null
}

/**
 * Safe session-status payload for `GET /api/mobile/session` style restore checks.
 *
 * The payload intentionally contains only non-secret namespace metadata plus the
 * fixed mobile auth transport contract. It must never include the raw mobile
 * bearer token, a browser cookie value, or user credentials.
 */
export interface MobileSessionStatus {
  /** Canonical URL origin for the validated workspace. */
  workspaceOrigin: string
  /** Stable workspace identifier safe for cache, draft, and restore namespace keys. */
  workspaceId: string
  /** Resolved authenticated subject identifier. */
  subject: string
  /** Normalized role list safe to use for cache namespacing and UX hints. */
  roles: string[]
  /** Optional expiry hint surfaced for UX only. */
  expiresAt: string | null
  /** Reused local-auth contract plus the approved mobile credential transport. */
  authentication: MobileAuthenticationContract
}

/**
 * Typed error thrown by the SDK authorization seam when a policy plugin
 * denies an action.
 *
 * Host surfaces should catch this to return appropriate error responses
 * (HTTP 403, CLI error output, MCP tool error) without leaking token material.
 */
export class AuthError extends Error {
  /** Machine-readable error category. */
  public readonly category: AuthErrorCategory
  /** Resolved caller subject when available (safe to include in error responses). */
  public readonly actor?: string

  constructor(category: AuthErrorCategory, message: string, actor?: string) {
    super(message)
    this.name = 'AuthError'
    this.category = category
    this.actor = actor
  }
}

/** Stable machine-readable error for configured-auth card-state calls without a resolved identity. */

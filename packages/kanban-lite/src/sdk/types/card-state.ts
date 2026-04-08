import type { CardStateCursor } from '../plugins'

export const ERR_CARD_STATE_IDENTITY_UNAVAILABLE = 'ERR_CARD_STATE_IDENTITY_UNAVAILABLE'

/** Stable machine-readable error for card-state calls when no provider is active. */
export const ERR_CARD_STATE_UNAVAILABLE = 'ERR_CARD_STATE_UNAVAILABLE'

/** Public card-state error codes shared across SDK, API, CLI, and MCP hosts. */
export type CardStateErrorCode =
  | typeof ERR_CARD_STATE_IDENTITY_UNAVAILABLE
  | typeof ERR_CARD_STATE_UNAVAILABLE

/** Stable mode name for the auth-absent card-state default actor contract. */
export const CARD_STATE_DEFAULT_ACTOR_MODE = 'auth-absent-only'

/**
 * Shared default actor contract for auth-absent card-state mode.
 *
 * This actor is only valid when no real `auth.identity` provider is configured.
 * All host surfaces should treat this as a stable public contract for both the
 * built-in file-backed `builtin` backend and first-party compatibility backends
 * such as `sqlite`.
 */
export const DEFAULT_CARD_STATE_ACTOR = Object.freeze({
  id: 'default-user',
  source: 'default',
  mode: CARD_STATE_DEFAULT_ACTOR_MODE,
} as const)

/** Stable type of the shared auth-absent card-state fallback actor. */
export type DefaultCardStateActor = typeof DEFAULT_CARD_STATE_ACTOR

/** Host-facing availability states for the public card-state status surface. */
export type CardStateAvailability = 'available' | 'identity-unavailable' | 'unavailable'

/** Host-facing backend family names for the public card-state status surface. */
export type CardStateBackend = 'builtin' | 'external' | 'none'

/** Stable built-in domain name for unread/read cursor persistence. */
export const CARD_STATE_UNREAD_DOMAIN = 'unread'

/** Stable built-in domain name for explicit actor-scoped open-card state persistence. */
export const CARD_STATE_OPEN_DOMAIN = 'open'

/**
 * Value persisted for the built-in explicit open-card mutation.
 *
 * This records actor-scoped `card.state` data and is distinct from workspace
 * active-card UI state such as `.active-card.json`.
 */
export interface CardOpenStateValue extends Record<string, unknown> {
  /** When the actor explicitly opened the card. */
  openedAt: string
  /** Latest unread-driving activity cursor acknowledged by the open mutation. */
  readThrough: CardStateCursor | null
}

/**
 * Side-effect-free unread snapshot resolved for one actor/card pair.
 *
 * This summary models actor-scoped unread/open semantics only; it does not
 * describe which card the UI currently considers active/open.
 */
export interface CardUnreadSummary {
  /** Resolved actor id used for this read or mutation. */
  actorId: string
  /** Resolved board id for the target card. */
  boardId: string
  /** Resolved full card id. */
  cardId: string
  /** Latest unread-driving activity cursor derived from persisted logs. */
  latestActivity: CardStateCursor | null
  /** Persisted read-through cursor for the current actor, when any. */
  readThrough: CardStateCursor | null
  /** `true` when the actor has unread activity beyond `readThrough`. */
  unread: boolean
}

/**
 * Public provider/status snapshot for `card.state` host surfaces.
 *
 * Host layers should use `availability` and `errorCode` to distinguish a real
 * backend outage from configured-identity failures where the backend is healthy
 * but no actor could be resolved.
 */
export interface CardStateStatus {
  /** Active `card.state` provider id, or `'none'` when unavailable. */
  provider: string
  /** `true` when a card-state provider is active. */
  active: boolean
  /** Backend family for high-level diagnostics. */
  backend: CardStateBackend
  /** Current availability classification for callers. */
  availability: CardStateAvailability
  /** Stable contract for when the default actor may be used. */
  defaultActorMode: typeof CARD_STATE_DEFAULT_ACTOR_MODE
  /** Shared auth-absent single-user fallback actor contract. */
  defaultActor: DefaultCardStateActor
  /** `true` only when the current auth configuration permits the default actor. */
  defaultActorAvailable: boolean
  /** Machine-readable error code when `availability !== 'available'`. */
  errorCode?: CardStateErrorCode
}

/**
 * Typed public error for card-state availability and identity failures.
 *
 * `ERR_CARD_STATE_IDENTITY_UNAVAILABLE` means a configured `auth.identity`
 * provider did not yield an actor. `ERR_CARD_STATE_UNAVAILABLE` means no active
 * `card.state` backend is available.
 */
export class CardStateError extends Error {
  /** Machine-readable error code. */
  public readonly code: CardStateErrorCode
  /** Status classification derived from {@link code}. */
  public readonly availability: Exclude<CardStateAvailability, 'available'>

  constructor(code: CardStateErrorCode, message: string) {
    super(message)
    this.name = 'CardStateError'
    this.code = code
    this.availability = code === ERR_CARD_STATE_IDENTITY_UNAVAILABLE
      ? 'identity-unavailable'
      : 'unavailable'
  }
}

/**
 * @deprecated Use {@link KanbanSDK}. CLI plugin hosts now advertise the full
 * public SDK surface, including `getConfigSnapshot()`, instead of a narrowed
 * webhook-only facade.
 */

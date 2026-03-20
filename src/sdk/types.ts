import type { Card, CardFormAttachment, CardFormDataMap, Priority, ResolvedFormDescriptor } from '../shared/types'
import type { CapabilitySelections } from '../shared/config'
import type { StorageEngine, StorageEngineType } from './plugins/types'

export type { StorageEngine, StorageEngineType } from './plugins/types'
export { MarkdownStorageEngine } from './plugins/markdown'

/**
 * Input data for creating a new kanban card.
 */
export interface CreateCardInput {
  /** The markdown body content of the card (title and description). */
  content: string
  /** The initial status column for the card (e.g., `"backlog"`, `"in-progress"`). Defaults to the first column. */
  status?: string
  /** The priority level of the card. Defaults to `"medium"`. */
  priority?: Priority
  /** The username of the person assigned to the card, or `null` for unassigned. */
  assignee?: string | null
  /** The due date as an ISO 8601 date string (e.g., `"2026-03-01"`), or `null` for no due date. */
  dueDate?: string | null
  /** An array of label strings to categorize the card. */
  labels?: string[]
  /** An array of attachment filenames associated with the card. */
  attachments?: string[]
  /** The board identifier when working with multiple boards. */
  boardId?: string
  /** Arbitrary user-defined metadata to store in the card's frontmatter. */
  metadata?: Record<string, any>
  /** Named actions that can be triggered via the action webhook. */
  actions?: string[] | Record<string, string>
  /** Forms attached to this card (named config-form references or inline definitions). */
  forms?: CardFormAttachment[]
  /** Per-form persisted data keyed by resolved form ID. */
  formData?: CardFormDataMap
}

/**
 * All event types emitted by the SDK when data is mutated.
 *
 * These events are fired after every successful write operation
 * and can be used to trigger webhooks, logging, or other side effects.
 *
 * **Task events:** `task.created`, `task.updated`, `task.moved`, `task.deleted`
 *
 * **Comment events:** `comment.created`, `comment.updated`, `comment.deleted`
 *
 * **Column events:** `column.created`, `column.updated`, `column.deleted`
 *
 * **Attachment events:** `attachment.added`, `attachment.removed`
 *
 * **Settings events:** `settings.updated`
 *
 * **Board events:** `board.created`, `board.updated`, `board.deleted`
 */
export type SDKEventType =
  | 'task.created'
  | 'form.submit'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.deleted'
  | 'attachment.added'
  | 'attachment.removed'
  | 'settings.updated'
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'board.action'
  | 'board.log.added'
  | 'board.log.cleared'
  | 'log.added'
  | 'log.cleared'
  | 'storage.migrated'

/**
 * Callback invoked by the SDK after every mutating operation.
 *
 * @param event - The event type (e.g., `'task.created'`).
 * @param data - The event payload (sanitized card, column, comment, or board object).
 */
export type SDKEventHandler = (event: SDKEventType, data: unknown) => void

/**
 * Optional configuration for the {@link KanbanSDK} constructor.
 */
export interface SDKOptions {
  /**
   * Optional callback invoked after every mutating operation.
   * Useful for triggering webhooks, logging, or other side effects.
   */
  onEvent?: SDKEventHandler
  /**
   * Provide a fully constructed {@link StorageEngine} to use. Takes precedence
   * over `storageEngine` and `sqlitePath` when supplied.
   */
  storage?: StorageEngine
  /**
   * Override the storage engine type. Falls back to the value in `.kanban.json`
   * (`storageEngine` field), then to `'markdown'` if unset.
   */
  storageEngine?: StorageEngineType
  /**
   * Path to the SQLite database file (only relevant when `storageEngine` is
   * `'sqlite'`). If relative, resolved from the workspace root. Defaults to
   * `.kanban/kanban.db`.
   */
  sqlitePath?: string
  /**
   * Optional capability-provider overrides.
   * Any omitted namespace falls back to `.kanban.json` and legacy defaults.
   */
  capabilities?: CapabilitySelections
}

export interface SubmitFormInput {
  /** Card ID that owns the target attached form. */
  cardId: string
  /** Resolved form identifier (named config form id or inline generated id). */
  formId: string
  /** Submitted field values merged over the resolved base payload before validation. */
  data: Record<string, unknown>
  /** Optional board ID. Defaults to the workspace default board. */
  boardId?: string
}

export interface SubmitFormResult {
  /** Board that owns the submitted card/form. */
  boardId: string
  /** Sanitized persisted card snapshot after the successful form update. */
  card: Omit<Card, 'filePath'>
  /** Resolved form descriptor used for validation and downstream context. */
  form: ResolvedFormDescriptor
  /** Final validated payload that was persisted to `card.formData[form.id]`. */
  data: Record<string, unknown>
}

export type FormSubmitEvent = SubmitFormResult

/**
 * Strips the `filePath` property from a card before exposing it
 * in webhook payloads or API responses. The file path is an internal
 * implementation detail that should not be leaked externally.
 *
 * @param card - The card object to sanitize.
 * @returns A copy of the card without the `filePath` field.
 *
 * @example
 * const safe = sanitizeCard(card)
 * // safe.filePath is undefined
 */
export function sanitizeCard(card: Card): Omit<Card, 'filePath'> {
  const { filePath: _, ...rest } = card
  return rest
}

// ---------------------------------------------------------------------------
// Auth context, decision, and error vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical machine-readable auth error categories.
 *
 * Consumed by {@link AuthError} and {@link AuthDecision.reason} so that host
 * surfaces (HTTP API, CLI, MCP, extension) can map denial semantics to their
 * own error codes (e.g. HTTP 401 vs 403) without parsing error messages.
 */
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

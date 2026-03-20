import type { Card, CardFormAttachment, CardFormDataMap, Priority, ResolvedFormDescriptor } from '../shared/types'
import type { CapabilitySelections } from '../shared/config'
import type { StorageEngine, StorageEngineType } from './plugins/types'

export type { StorageEngine, StorageEngineType } from './plugins/types'
export { MarkdownStorageEngine } from './plugins/markdown'
export { SqliteStorageEngine } from './plugins/sqlite'

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

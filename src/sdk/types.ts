import type { Feature, Priority } from '../shared/types'

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
  /** Named action strings that can be triggered via the action webhook. */
  actions?: string[]
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
}

/**
 * Strips the `filePath` property from a card before exposing it
 * in webhook payloads or API responses. The file path is an internal
 * implementation detail that should not be leaked externally.
 *
 * @param feature - The card object to sanitize.
 * @returns A copy of the card without the `filePath` field.
 *
 * @example
 * const safe = sanitizeFeature(card)
 * // safe.filePath is undefined
 */
export function sanitizeFeature(feature: Feature): Omit<Feature, 'filePath'> {
  const { filePath: _, ...rest } = feature
  return rest
}

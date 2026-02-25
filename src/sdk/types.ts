import type { Priority } from '../shared/types'

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
}

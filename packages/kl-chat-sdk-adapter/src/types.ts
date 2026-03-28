// ---------------------------------------------------------------------------
// Shared types for the kl-chat-sdk-adapter package.
// These mirror the kanban-lite REST API response shapes so consumers never
// need to import types from the core `kanban-lite` package itself.
// ---------------------------------------------------------------------------

/** Card priority levels recognised by kanban-lite. */
export type Priority = 'critical' | 'high' | 'medium' | 'low'

/** A comment attached to a kanban card. */
export interface KanbanComment {
  id: string
  author: string
  created: string
  content: string
  streaming?: boolean
}

/** A form definition attached to a card. */
export interface KanbanFormAttachment {
  name?: string
  schema?: Record<string, unknown>
  ui?: Record<string, unknown>
  data?: Record<string, unknown>
}

/** A resolved form descriptor returned by the API. */
export interface KanbanResolvedForm {
  id: string
  label: string
  name?: string
  description?: string
  schema?: Record<string, unknown>
  ui?: Record<string, unknown>
}

/** Result of submitting a card form. */
export interface KanbanFormSubmitResult {
  boardId: string
  card: KanbanCard
  form: KanbanResolvedForm
  data: Record<string, unknown>
}

/** A log entry on a card or board. */
export interface KanbanLogEntry {
  timestamp: string
  source: string
  text: string
  object?: Record<string, unknown>
}

/** A kanban board column. */
export interface KanbanColumn {
  id: string
  name: string
  color: string
}

/** Board info summary. */
export interface KanbanBoardInfo {
  id: string
  name: string
  description?: string
  columns?: KanbanColumn[]
  actions?: Record<string, string>
  metadata?: string[]
  title?: string[]
  forms?: Record<string, unknown>
}

/** Full kanban card shape returned by the REST API. */
export interface KanbanCard {
  id: string
  title: string
  status: string
  priority: string
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
  metadata?: Record<string, unknown>
  actions?: string[] | Record<string, string>
  forms?: KanbanFormAttachment[]
  formData?: Record<string, Record<string, unknown>>
  comments?: KanbanComment[]
  created?: string
  modified?: string
  completedAt?: string | null
  body?: string
  content?: string
}

/** Options for card creation. */
export interface CreateCardOptions {
  assignee?: string | null
  status?: string
  dueDate?: string | null
  labels?: string[]
  metadata?: Record<string, unknown>
  actions?: string[] | Record<string, string>
  forms?: KanbanFormAttachment[]
  formData?: Record<string, Record<string, unknown>>
}

/** Standard kanban-lite JSON envelope. */
export interface ApiEnvelope<T> {
  ok: boolean
  data: T
  error?: string
}

/** Configuration for the KanbanClient. */
export interface KanbanClientConfig {
  /** Base URL of the kanban-lite standalone server. @default 'http://localhost:3000' */
  baseUrl?: string
  /** Board ID to operate on. @default 'default' */
  boardId?: string
  /** Optional Bearer token for auth-plugin-protected servers. */
  apiToken?: string
}

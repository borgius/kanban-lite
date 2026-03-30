// ---------------------------------------------------------------------------
// KanbanClient — configurable REST client for the kanban-lite standalone API.
//
// This module mirrors the functionality of
//   examples/chat-sdk-vercel-ai/lib/kanban.ts
// but is designed as a reusable, configuration-driven class suitable for
// packaging rather than a one-off example.
// ---------------------------------------------------------------------------

import type {
  ApiEnvelope,
  CreateCardOptions,
  KanbanBoardInfo,
  KanbanCard,
  KanbanClientConfig,
  KanbanColumn,
  KanbanComment,
  KanbanFormSubmitResult,
  KanbanLogEntry,
} from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCardContent(
  content: string | undefined,
  fallbackTitle: string,
): Pick<KanbanCard, 'title' | 'body'> {
  if (!content) return { title: fallbackTitle }
  const lines = content.split(/\r?\n/)
  const headingLine = lines.find((l) => l.startsWith('# '))
  const title = headingLine?.replace(/^#\s+/, '').trim() || fallbackTitle
  const body = lines
    .filter((l, i) => !(i === lines.indexOf(headingLine ?? '') && l === headingLine))
    .join('\n')
    .trim()
  return { title, ...(body ? { body } : {}) }
}

function normalizeCard(
  card: Partial<KanbanCard> & { id: string; status: string; priority: string },
): KanbanCard {
  const { title, body } = parseCardContent(card.content, card.id)
  return {
    id: card.id,
    title,
    status: card.status,
    priority: card.priority,
    ...(card.assignee !== undefined ? { assignee: card.assignee } : {}),
    ...(card.dueDate !== undefined ? { dueDate: card.dueDate } : {}),
    ...(card.labels ? { labels: card.labels } : {}),
    ...(card.metadata ? { metadata: card.metadata } : {}),
    ...(card.actions ? { actions: card.actions } : {}),
    ...(card.forms ? { forms: card.forms } : {}),
    ...(card.formData ? { formData: card.formData } : {}),
    ...(card.comments ? { comments: card.comments } : {}),
    ...(card.created ? { created: card.created } : {}),
    ...(card.modified ? { modified: card.modified } : {}),
    ...(card.completedAt !== undefined ? { completedAt: card.completedAt } : {}),
    ...(body ? { body } : {}),
    ...(card.content ? { content: card.content } : {}),
  }
}

// ---------------------------------------------------------------------------
// KanbanClient
// ---------------------------------------------------------------------------

/**
 * A configurable HTTP client for the kanban-lite REST API.
 *
 * Unlike the example-specific `lib/kanban.ts`, this client is designed to be
 * instantiated with explicit configuration and used across any consumer app.
 *
 * @example
 * ```ts
 * import { KanbanClient } from 'kl-adapter-vercel-ai'
 *
 * const client = new KanbanClient({
 *   baseUrl: 'http://localhost:3000',
 *   boardId: 'default',
 *   apiToken: process.env.KANBAN_API_TOKEN,
 * })
 *
 * const cards = await client.listCards()
 * ```
 */
export class KanbanClient {
  readonly baseUrl: string
  readonly boardId: string
  private readonly apiToken: string | undefined

  constructor(config: KanbanClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
    this.boardId = config.boardId ?? 'default'
    this.apiToken = config.apiToken
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helpers
  // -------------------------------------------------------------------------

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`
    }
    return headers
  }

  private async apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: { ...this.getHeaders(), ...(init?.headers ?? {}) },
    })
    const contentType = res.headers.get('content-type') ?? ''
    const json = contentType.includes('application/json')
      ? ((await res.json()) as ApiEnvelope<T>)
      : null
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error ?? `kanban-lite API error ${res.status} – ${url}`)
    }
    return json.data
  }

  private async apiNoContent(path: string, init?: RequestInit): Promise<void> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: { ...this.getHeaders(), ...(init?.headers ?? {}) },
    })
    if (res.ok) return
    const contentType = res.headers.get('content-type') ?? ''
    const json = contentType.includes('application/json')
      ? ((await res.json()) as ApiEnvelope<unknown>)
      : null
    throw new Error(json?.error ?? `kanban-lite API error ${res.status} – ${url}`)
  }

  // -------------------------------------------------------------------------
  // Board methods
  // -------------------------------------------------------------------------

  /** List all boards configured on the kanban-lite server. */
  async listBoards(): Promise<KanbanBoardInfo[]> {
    return this.apiFetch<KanbanBoardInfo[]>('/api/boards')
  }

  /** Get board configuration for a specific board. */
  async getBoard(boardId?: string): Promise<KanbanBoardInfo> {
    const id = boardId ?? this.boardId
    return this.apiFetch<KanbanBoardInfo>(`/api/boards/${encodeURIComponent(id)}`)
  }

  /** List columns for a board. */
  async listColumns(boardId?: string): Promise<KanbanColumn[]> {
    const id = boardId ?? this.boardId
    return this.apiFetch<KanbanColumn[]>(
      `/api/boards/${encodeURIComponent(id)}/columns`,
    )
  }

  // -------------------------------------------------------------------------
  // Card CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new card on the kanban board.
   *
   * The kanban-lite API derives a task's title from the first Markdown
   * `# heading` in the `content` field — this method builds it automatically.
   */
  async createCard(
    title: string,
    description?: string,
    priority: string = 'medium',
    options: CreateCardOptions = {},
  ): Promise<KanbanCard> {
    const content = description ? `# ${title}\n\n${description}` : `# ${title}`
    const card = await this.apiFetch<KanbanCard>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks`,
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          priority,
          ...(options.assignee !== undefined ? { assignee: options.assignee } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.dueDate !== undefined ? { dueDate: options.dueDate } : {}),
          ...(options.labels ? { labels: options.labels } : {}),
          ...(options.metadata ? { metadata: options.metadata } : {}),
          ...(options.actions ? { actions: options.actions } : {}),
          ...(options.forms ? { forms: options.forms } : {}),
          ...(options.formData ? { formData: options.formData } : {}),
        }),
      },
    )
    return normalizeCard(card)
  }

  /** List cards from the kanban board, optionally filtered by status column. */
  async listCards(status?: string): Promise<KanbanCard[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    const cards = await this.apiFetch<KanbanCard[]>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks${qs}`,
    )
    return cards.map((c) => normalizeCard(c))
  }

  /** Fetch one card with full metadata, attached forms/actions, and comments. */
  async getCard(cardId: string): Promise<KanbanCard> {
    const card = await this.apiFetch<KanbanCard>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}`,
    )
    return normalizeCard(card)
  }

  /**
   * Update an existing card.
   *
   * Accepts a partial card object – only provided fields are changed.
   */
  async updateCard(
    cardId: string,
    updates: Partial<Pick<KanbanCard, 'content' | 'priority' | 'assignee' | 'dueDate' | 'labels' | 'metadata' | 'actions' | 'forms' | 'formData'>>,
  ): Promise<KanbanCard> {
    const card = await this.apiFetch<KanbanCard>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      },
    )
    return normalizeCard(card)
  }

  /** Move a card to a different status column. Supports partial card ID. */
  async moveCard(cardId: string, status: string): Promise<KanbanCard> {
    const card = await this.apiFetch<KanbanCard>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}/move`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    )
    return normalizeCard(card)
  }

  /** Soft-delete a card (moves it to the deleted column). */
  async deleteCard(cardId: string): Promise<void> {
    await this.apiNoContent(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}`,
      { method: 'DELETE' },
    )
  }

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  /** List comments attached to a card. */
  async listComments(cardId: string): Promise<KanbanComment[]> {
    return this.apiFetch<KanbanComment[]>(
      `/api/tasks/${encodeURIComponent(cardId)}/comments`,
    )
  }

  /** Add a markdown comment to a card. */
  async addComment(
    cardId: string,
    author: string,
    content: string,
  ): Promise<KanbanComment> {
    return this.apiFetch<KanbanComment>(
      `/api/tasks/${encodeURIComponent(cardId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ author, content }),
      },
    )
  }

  /** Update an existing comment. */
  async updateComment(
    cardId: string,
    commentId: string,
    content: string,
  ): Promise<KanbanComment> {
    return this.apiFetch<KanbanComment>(
      `/api/tasks/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ content }),
      },
    )
  }

  /** Delete a comment from a card. */
  async deleteComment(cardId: string, commentId: string): Promise<void> {
    await this.apiNoContent(
      `/api/tasks/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    )
  }

  /**
   * Stream a comment to a card. The request body is sent as a plain-text stream;
   * connected WebSocket viewers will see the comment arrive incrementally.
   *
   * @param cardId  Card ID or partial ID
   * @param author  Comment author name
   * @param content Full comment text to stream word-by-word
   */
  async streamComment(
    cardId: string,
    author: string,
    content: string,
  ): Promise<KanbanComment> {
    const url = `${this.baseUrl}/api/tasks/${encodeURIComponent(cardId)}/comments/stream?author=${encodeURIComponent(author)}`
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: content,
    })
    const contentType = res.headers.get('content-type') ?? ''
    const json = contentType.includes('application/json')
      ? ((await res.json()) as ApiEnvelope<KanbanComment>)
      : null
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error ?? `kanban-lite stream comment error ${res.status}`)
    }
    return json.data
  }

  // -------------------------------------------------------------------------
  // Forms
  // -------------------------------------------------------------------------

  /** Submit a named card form and persist the validated payload. */
  async submitCardForm(
    cardId: string,
    formId: string,
    data: Record<string, unknown>,
  ): Promise<KanbanFormSubmitResult> {
    const result = await this.apiFetch<KanbanFormSubmitResult>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}/forms/${encodeURIComponent(formId)}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({ data }),
      },
    )
    return { ...result, card: normalizeCard(result.card) }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Trigger a card-level action webhook. */
  async triggerCardAction(cardId: string, action: string): Promise<void> {
    await this.apiNoContent(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}/actions/${encodeURIComponent(action)}`,
      { method: 'POST' },
    )
  }

  /** Get board-level actions. */
  async getBoardActions(boardId?: string): Promise<Record<string, string>> {
    const id = boardId ?? this.boardId
    return this.apiFetch<Record<string, string>>(
      `/api/boards/${encodeURIComponent(id)}/actions`,
    )
  }

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  /** List log entries for a card. */
  async listCardLogs(cardId: string): Promise<KanbanLogEntry[]> {
    return this.apiFetch<KanbanLogEntry[]>(
      `/api/boards/${encodeURIComponent(this.boardId)}/tasks/${encodeURIComponent(cardId)}/logs`,
    )
  }
}

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
import { createStandaloneApiClient } from 'kanban-lite/sdk'
import type { StandaloneApiPath } from 'kanban-lite/sdk'

const ADAPTER_API_PATHS = {
  boards: '/api/boards',
  board: '/api/boards/{boardId}',
  boardColumns: '/api/boards/{boardId}/columns',
  boardTasks: '/api/boards/{boardId}/tasks',
  boardTask: '/api/boards/{boardId}/tasks/{id}',
  boardTaskMove: '/api/boards/{boardId}/tasks/{id}/move',
  boardTaskFormSubmit: '/api/boards/{boardId}/tasks/{id}/forms/{formId}/submit',
  boardTaskAction: '/api/boards/{boardId}/tasks/{id}/actions/{action}',
  boardActions: '/api/boards/{boardId}/actions',
  taskLogs: '/api/tasks/{id}/logs',
  taskComments: '/api/tasks/{id}/comments',
  taskComment: '/api/tasks/{id}/comments/{commentId}',
  taskCommentStream: '/api/tasks/{id}/comments/stream',
} as const satisfies Record<string, StandaloneApiPath>

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
  private readonly apiClient: ReturnType<typeof createStandaloneApiClient>

  constructor(config: KanbanClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
    this.boardId = config.boardId ?? 'default'
    this.apiToken = config.apiToken
    this.apiClient = createStandaloneApiClient({
      baseUrl: this.baseUrl,
      token: this.apiToken,
    })
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helpers
  // -------------------------------------------------------------------------

  private async apiFetch<T>(
    method: 'get' | 'put' | 'post' | 'delete' | 'patch',
    path: StandaloneApiPath,
    options?: {
      path?: Record<string, string | number>
      query?: Record<string, boolean | number | string | undefined>
      body?: unknown
      contentType?: 'application/json' | 'text/plain'
    },
  ): Promise<T> {
    return await this.apiClient.request(method as never, path as never, options as never) as T
  }

  private async apiNoContent(
    method: 'get' | 'put' | 'post' | 'delete' | 'patch',
    path: StandaloneApiPath,
    options?: {
      path?: Record<string, string | number>
      query?: Record<string, boolean | number | string | undefined>
      body?: unknown
      contentType?: 'application/json' | 'text/plain'
    },
  ): Promise<void> {
    await this.apiClient.request(method as never, path as never, options as never)
  }

  // -------------------------------------------------------------------------
  // Board methods
  // -------------------------------------------------------------------------

  /** List all boards configured on the kanban-lite server. */
  async listBoards(): Promise<KanbanBoardInfo[]> {
    return this.apiFetch<KanbanBoardInfo[]>('get', ADAPTER_API_PATHS.boards)
  }

  /** Get board configuration for a specific board. */
  async getBoard(boardId?: string): Promise<KanbanBoardInfo> {
    const id = boardId ?? this.boardId
    return this.apiFetch<KanbanBoardInfo>('get', ADAPTER_API_PATHS.board, {
      path: { boardId: id },
    })
  }

  /** List columns for a board. */
  async listColumns(boardId?: string): Promise<KanbanColumn[]> {
    const id = boardId ?? this.boardId
    return this.apiFetch<KanbanColumn[]>('get', ADAPTER_API_PATHS.boardColumns, {
      path: { boardId: id },
    })
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
    const card = await this.apiFetch<KanbanCard>('post', ADAPTER_API_PATHS.boardTasks, {
      path: { boardId: this.boardId },
      body: {
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
      },
    })
    return normalizeCard(card)
  }

  /** List cards from the kanban board, optionally filtered by status column. */
  async listCards(status?: string): Promise<KanbanCard[]> {
    const cards = await this.apiFetch<KanbanCard[]>('get', ADAPTER_API_PATHS.boardTasks, {
      path: { boardId: this.boardId },
      query: status ? { status } : undefined,
    })
    return cards.map((c) => normalizeCard(c))
  }

  /** Fetch one card with full metadata, attached forms/actions, and comments. */
  async getCard(cardId: string): Promise<KanbanCard> {
    const card = await this.apiFetch<KanbanCard>('get', ADAPTER_API_PATHS.boardTask, {
      path: { boardId: this.boardId, id: cardId },
    })
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
    const card = await this.apiFetch<KanbanCard>('put', ADAPTER_API_PATHS.boardTask, {
      path: { boardId: this.boardId, id: cardId },
      body: updates,
    })
    return normalizeCard(card)
  }

  /** Move a card to a different status column. Supports partial card ID. */
  async moveCard(cardId: string, status: string): Promise<KanbanCard> {
    const card = await this.apiFetch<KanbanCard>('patch', ADAPTER_API_PATHS.boardTaskMove, {
      path: { boardId: this.boardId, id: cardId },
      body: { status },
    })
    return normalizeCard(card)
  }

  /** Soft-delete a card (moves it to the deleted column). */
  async deleteCard(cardId: string): Promise<void> {
    await this.apiNoContent('delete', ADAPTER_API_PATHS.boardTask, {
      path: { boardId: this.boardId, id: cardId },
    })
  }

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  /** List comments attached to a card. */
  async listComments(cardId: string): Promise<KanbanComment[]> {
    return this.apiFetch<KanbanComment[]>('get', ADAPTER_API_PATHS.taskComments, {
      path: { id: cardId },
    })
  }

  /** Add a markdown comment to a card. */
  async addComment(
    cardId: string,
    author: string,
    content: string,
  ): Promise<KanbanComment> {
    return this.apiFetch<KanbanComment>('post', ADAPTER_API_PATHS.taskComments, {
      path: { id: cardId },
      body: { author, content },
    })
  }

  /** Update an existing comment. */
  async updateComment(
    cardId: string,
    commentId: string,
    content: string,
  ): Promise<KanbanComment> {
    return this.apiFetch<KanbanComment>('put', ADAPTER_API_PATHS.taskComment, {
      path: { id: cardId, commentId },
      body: { content },
    })
  }

  /** Delete a comment from a card. */
  async deleteComment(cardId: string, commentId: string): Promise<void> {
    await this.apiNoContent('delete', ADAPTER_API_PATHS.taskComment, {
      path: { id: cardId, commentId },
    })
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
    return this.apiFetch<KanbanComment>('post', ADAPTER_API_PATHS.taskCommentStream, {
      path: { id: cardId },
      query: { author },
      body: content,
      contentType: 'text/plain',
    })
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
    const result = await this.apiFetch<KanbanFormSubmitResult>('post', ADAPTER_API_PATHS.boardTaskFormSubmit, {
      path: { boardId: this.boardId, id: cardId, formId },
      body: { data },
    })
    return { ...result, card: normalizeCard(result.card) }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Trigger a card-level action webhook. */
  async triggerCardAction(cardId: string, action: string): Promise<void> {
    await this.apiNoContent('post', ADAPTER_API_PATHS.boardTaskAction, {
      path: { boardId: this.boardId, id: cardId, action },
    })
  }

  /** Get board-level actions. */
  async getBoardActions(boardId?: string): Promise<Record<string, string>> {
    const id = boardId ?? this.boardId
    return this.apiFetch<Record<string, string>>('get', ADAPTER_API_PATHS.boardActions, {
      path: { boardId: id },
    })
  }

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  /** List log entries for a card. */
  async listCardLogs(cardId: string): Promise<KanbanLogEntry[]> {
    return this.apiFetch<KanbanLogEntry[]>('get', ADAPTER_API_PATHS.taskLogs, {
      path: { id: cardId },
    })
  }
}

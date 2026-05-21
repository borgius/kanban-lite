import type { Card, BoardInfo, Comment, KanbanColumn, Priority } from '../../shared/types'
import type { CreateCardInput } from '../types'
import type { SDKEvent, SDKEventListener } from '../types'
import type { EventBusAnyListener, EventBusWaitOptions } from '../eventBus'
import { EventBus } from '../eventBus'
import { createStandaloneApiClient } from './openapi-client'

const REMOTE_API_PATHS = {
  health: '/api/health',
  boards: '/api/boards',
  board: '/api/boards/{boardId}',
  boardTasks: '/api/boards/{boardId}/tasks',
  boardActiveTask: '/api/boards/{boardId}/tasks/active',
  boardTask: '/api/boards/{boardId}/tasks/{id}',
  boardTaskMove: '/api/boards/{boardId}/tasks/{id}/move',
  tasks: '/api/tasks',
  activeTask: '/api/tasks/active',
  task: '/api/tasks/{id}',
  taskMove: '/api/tasks/{id}/move',
  taskChecklist: '/api/tasks/{id}/checklist',
  taskChecklistItem: '/api/tasks/{id}/checklist/{index}',
  taskChecklistItemCheck: '/api/tasks/{id}/checklist/{index}/check',
  taskChecklistItemUncheck: '/api/tasks/{id}/checklist/{index}/uncheck',
  taskComments: '/api/tasks/{id}/comments',
  taskComment: '/api/tasks/{id}/comments/{commentId}',
  taskAttachments: '/api/tasks/{id}/attachments',
  taskAttachment: '/api/tasks/{id}/attachments/{filename}',
} as const

/**
 * SDK client that transparently proxies all operations to a remote
 * kanban-lite REST API. Use this instead of `KanbanSDK` when you want to
 * connect to a running kanban-lite server from a remote client (browser, CI,
 * agent) without any local filesystem access.
 *
 * @example
 * ```typescript
 * import { RemoteKanbanSDK } from "kanban-lite/sdk"
 *
 * const sdk = new RemoteKanbanSDK({
 *   remoteUrl: "http://localhost:3000",
 *   token: "my-bearer-token",
 * })
 *
 * await sdk.init()
 * const cards = await sdk.listCards()
 * const card = await sdk.createCard({ content: "# New task" })
 * ```
 */
export class RemoteKanbanSDK {
  private readonly _remoteUrl: string
  private readonly _token: string | undefined
  private readonly _eventBus: EventBus
  private readonly _client: ReturnType<typeof createStandaloneApiClient>

  /** Empty sentinel — no local filesystem in remote mode. */
  readonly kanbanDir: string = ''
  /** Empty sentinel — no local filesystem in remote mode. */
  readonly workspaceRoot: string = ''

  constructor(options: { remoteUrl: string; token?: string }) {
    this._remoteUrl = options.remoteUrl.replace(/\/$/, '')
    this._token = options.token
    this._eventBus = new EventBus()
    this._client = createStandaloneApiClient({
      baseUrl: this._remoteUrl,
      token: this._token,
    })
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP helper
  // ---------------------------------------------------------------------------

  private async _request<T>(
    method: 'get' | 'put' | 'post' | 'delete' | 'patch',
    path: typeof REMOTE_API_PATHS[keyof typeof REMOTE_API_PATHS],
    options?: {
      path?: Record<string, string | number>
      query?: Record<string, boolean | number | string | undefined>
      body?: unknown
      contentType?: 'application/json' | 'text/plain'
    },
  ): Promise<T> {
    return await this._client.request(method as never, path as never, options as never) as T
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Validate connectivity by hitting the health endpoint. */
  async init(): Promise<void> {
    await this._request<unknown>('get', REMOTE_API_PATHS.health)
  }

  // ---------------------------------------------------------------------------
  // Card (task) operations
  // ---------------------------------------------------------------------------

  async listCards(columns?: string[], boardId?: string): Promise<Card[]> {
    const query = columns?.length ? { status: columns.join(',') } : undefined
    if (boardId) {
      return this._request<Card[]>('get', REMOTE_API_PATHS.boardTasks, {
        path: { boardId },
        query,
      })
    }
    return this._request<Card[]>('get', REMOTE_API_PATHS.tasks, { query })
  }

  async getCard(cardId: string): Promise<Card | null> {
    try {
      return await this._request<Card>('get', REMOTE_API_PATHS.task, {
        path: { id: cardId },
      })
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('not found')) return null
      throw err
    }
  }

  async createCard(input: CreateCardInput): Promise<Card> {
    return this._request<Card>('post', REMOTE_API_PATHS.tasks, { body: input })
  }

  async updateCard(
    cardId: string,
    updates: Partial<CreateCardInput>,
  ): Promise<Card> {
    return this._request<Card>('put', REMOTE_API_PATHS.task, {
      path: { id: cardId },
      body: updates,
    })
  }

  async deleteCard(cardId: string): Promise<void> {
    await this._request<void>('delete', REMOTE_API_PATHS.task, {
      path: { id: cardId },
    })
  }

  async moveCard(cardId: string, newStatus: string): Promise<Card> {
    return this._request<Card>('patch', REMOTE_API_PATHS.taskMove, {
      path: { id: cardId },
      body: { status: newStatus },
    })
  }

  async getActiveCard(boardId?: string): Promise<Card | null> {
    try {
      if (boardId) {
        return await this._request<Card | null>('get', REMOTE_API_PATHS.boardActiveTask, {
          path: { boardId },
        })
      }
      return await this._request<Card | null>('get', REMOTE_API_PATHS.activeTask)
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Board operations
  // ---------------------------------------------------------------------------

  /**
   * List boards asynchronously.
   *
   * Note: The local `KanbanSDK.listBoards()` is synchronous. Use this async
   * variant when working in remote mode.
   */
  async listBoardsAsync(): Promise<BoardInfo[]> {
    return this._request<BoardInfo[]>('get', REMOTE_API_PATHS.boards)
  }

  /**
   * @deprecated Remote mode does not support a synchronous `listBoards()`.
   * Use `listBoardsAsync()` instead.
   */
  listBoards(): never {
    throw new Error(
      'listBoards() is synchronous and not supported in remote mode. Use listBoardsAsync() instead.',
    )
  }

  async getBoard(boardId: string): Promise<unknown> {
    return this._request('get', REMOTE_API_PATHS.board, {
      path: { boardId },
    })
  }

  async createBoard(
    id: string,
    name: string,
    options?: {
      description?: string
      columns?: KanbanColumn[]
      defaultStatus?: string
      defaultPriority?: Priority
    },
  ): Promise<BoardInfo> {
    return this._request<BoardInfo>('post', REMOTE_API_PATHS.boards, {
      body: { id, name, ...options },
    })
  }

  async updateBoard(boardId: string, updates: Record<string, unknown>): Promise<unknown> {
    return this._request('put', REMOTE_API_PATHS.board, {
      path: { boardId },
      body: updates,
    })
  }

  async deleteBoard(boardId: string): Promise<void> {
    await this._request<void>('delete', REMOTE_API_PATHS.board, {
      path: { boardId },
    })
  }

  // ---------------------------------------------------------------------------
  // Comment operations
  // ---------------------------------------------------------------------------

  async listComments(cardId: string): Promise<Comment[]> {
    return this._request<Comment[]>('get', REMOTE_API_PATHS.taskComments, {
      path: { id: cardId },
    })
  }

  async addComment(
    cardId: string,
    author: string,
    content: string,
  ): Promise<Card> {
    return this._request<Card>('post', REMOTE_API_PATHS.taskComments, {
      path: { id: cardId },
      body: { author, content },
    })
  }

  async updateComment(
    cardId: string,
    commentId: string,
    content: string,
  ): Promise<Card> {
    return this._request<Card>('put', REMOTE_API_PATHS.taskComment, {
      path: { id: cardId, commentId },
      body: { content },
    })
  }

  async deleteComment(
    cardId: string,
    commentId: string,
  ): Promise<Card> {
    return this._request<Card>('delete', REMOTE_API_PATHS.taskComment, {
      path: { id: cardId, commentId },
    })
  }

  // ---------------------------------------------------------------------------
  // Checklist operations
  // ---------------------------------------------------------------------------

  async addChecklistItem(cardId: string, title: string): Promise<Card> {
    const checklist = await this._request<{ token?: string }>('get', REMOTE_API_PATHS.taskChecklist, {
      path: { id: cardId },
    })
    return this._request<Card>('post', REMOTE_API_PATHS.taskChecklist, {
      path: { id: cardId },
      body: { title, expectedToken: checklist.token ?? '' },
    })
  }

  async editChecklistItem(
    cardId: string,
    index: number,
    title: string,
  ): Promise<Card> {
    return this._request<Card>('put', REMOTE_API_PATHS.taskChecklistItem, {
      path: { id: cardId, index },
      body: { title },
    })
  }

  async deleteChecklistItem(cardId: string, index: number): Promise<Card> {
    return this._request<Card>('delete', REMOTE_API_PATHS.taskChecklistItem, {
      path: { id: cardId, index },
    })
  }

  async checkChecklistItem(cardId: string, index: number): Promise<Card> {
    return this._request<Card>('post', REMOTE_API_PATHS.taskChecklistItemCheck, {
      path: { id: cardId, index },
    })
  }

  async uncheckChecklistItem(cardId: string, index: number): Promise<Card> {
    return this._request<Card>('post', REMOTE_API_PATHS.taskChecklistItemUncheck, {
      path: { id: cardId, index },
    })
  }

  // ---------------------------------------------------------------------------
  // Attachment operations
  // ---------------------------------------------------------------------------

  async addAttachmentData(
    cardId: string,
    filename: string,
    data: string | Uint8Array,
  ): Promise<Card> {
    const encodedData = typeof data === 'string'
      ? data
      : Buffer.from(data).toString('base64')
    return this._request<Card>('post', REMOTE_API_PATHS.taskAttachments, {
      path: { id: cardId },
      body: {
        files: [{ name: filename, data: encodedData }],
      },
    })
  }

  async removeAttachment(cardId: string, attachment: string): Promise<Card> {
    return this._request<Card>('delete', REMOTE_API_PATHS.taskAttachment, {
      path: { id: cardId, filename: attachment },
    })
  }

  async getAttachmentData(
    cardId: string,
    filename: string,
  ): Promise<{ data: Uint8Array; contentType?: string } | null> {
    return this._client.requestBinary('get', REMOTE_API_PATHS.taskAttachment, {
      path: { id: cardId, filename },
    })
  }

  /** Always returns `null` — no local filesystem paths in remote mode. */
  getLocalCardPath(_card: unknown): null { return null }

  /** Always returns `null` — no local filesystem paths in remote mode. */
  getAttachmentStoragePath(_card: unknown): null { return null }

  /** Always returns `null` — no local filesystem paths in remote mode. */
  async materializeAttachment(_card: unknown, _attachment: string): Promise<null> { return null }

  // ---------------------------------------------------------------------------
  // Event bus proxy
  // ---------------------------------------------------------------------------

  get eventBus(): EventBus { return this._eventBus }

  on(event: string, listener: SDKEventListener): () => void {
    return this._eventBus.on(event, listener)
  }

  once(event: string, listener: SDKEventListener): () => void {
    return this._eventBus.once(event, listener)
  }

  many(event: string, timesToListen: number, listener: SDKEventListener): () => void {
    return this._eventBus.many(event, timesToListen, listener)
  }

  off(event: string, listener: SDKEventListener): void {
    this._eventBus.off(event, listener)
  }

  onAny(listener: EventBusAnyListener): () => void {
    return this._eventBus.onAny(listener)
  }

  offAny(listener: EventBusAnyListener): void {
    this._eventBus.offAny(listener)
  }

  removeAllListeners(event?: string): void {
    this._eventBus.removeAllListeners(event)
  }

  eventNames(): string[] { return this._eventBus.eventNames() }

  listenerCount(event?: string): number { return this._eventBus.listenerCount(event) }

  hasListeners(event?: string): boolean { return this._eventBus.hasListeners(event) }

  waitFor(event: string, options?: EventBusWaitOptions): Promise<SDKEvent> {
    return this._eventBus.waitFor(event, options)
  }
}

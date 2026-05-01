import type { Card, BoardInfo, Comment, KanbanColumn, Priority } from '../../shared/types'
import type { CreateCardInput } from '../types'
import type { SDKEvent, SDKEventListener } from '../types'
import type { EventBusAnyListener, EventBusWaitOptions } from '../eventBus'
import { EventBus } from '../eventBus'

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

  /** Empty sentinel — no local filesystem in remote mode. */
  readonly kanbanDir: string = ''
  /** Empty sentinel — no local filesystem in remote mode. */
  readonly workspaceRoot: string = ''

  constructor(options: { remoteUrl: string; token?: string }) {
    this._remoteUrl = options.remoteUrl.replace(/\/$/, '')
    this._token = options.token
    this._eventBus = new EventBus()
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP helper
  // ---------------------------------------------------------------------------

  private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this._remoteUrl}${path}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string }
    if (!json.ok) throw new Error(json.error ?? `Remote API error ${res.status}`)
    return json.data as T
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Validate connectivity by hitting the health endpoint. */
  async init(): Promise<void> {
    await this._request<unknown>('GET', '/api/health')
  }

  // ---------------------------------------------------------------------------
  // Card (task) operations
  // ---------------------------------------------------------------------------

  async listCards(columns?: string[], boardId?: string): Promise<Card[]> {
    const params = new URLSearchParams()
    if (boardId) params.set('boardId', boardId)
    if (columns?.length) params.set('columns', columns.join(','))
    const qs = params.toString()
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    const path = qs ? `${base}?${qs}` : base
    return this._request<Card[]>('GET', path)
  }

  async getCard(cardId: string, boardId?: string): Promise<Card | null> {
    try {
      const base = boardId
        ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
        : '/api/tasks'
      return await this._request<Card>('GET', `${base}/${encodeURIComponent(cardId)}`)
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('not found')) return null
      throw err
    }
  }

  async createCard(input: CreateCardInput): Promise<Card> {
    return this._request<Card>('POST', '/api/tasks', input)
  }

  async updateCard(
    cardId: string,
    updates: Partial<CreateCardInput>,
    boardId?: string,
  ): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>('PATCH', `${base}/${encodeURIComponent(cardId)}`, updates)
  }

  async deleteCard(cardId: string, boardId?: string): Promise<void> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    await this._request<void>('DELETE', `${base}/${encodeURIComponent(cardId)}`)
  }

  async moveCard(cardId: string, newStatus: string, boardId?: string): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'POST',
      `${base}/${encodeURIComponent(cardId)}/move`,
      { status: newStatus },
    )
  }

  async getActiveCard(boardId?: string): Promise<Card | null> {
    try {
      const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : ''
      return await this._request<Card | null>('GET', `/api/tasks/active${qs}`)
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
    return this._request<BoardInfo[]>('GET', '/api/boards')
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
    return this._request('GET', `/api/boards/${encodeURIComponent(boardId)}`)
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
    return this._request<BoardInfo>('POST', '/api/boards', { id, name, ...options })
  }

  async updateBoard(boardId: string, updates: Record<string, unknown>): Promise<unknown> {
    return this._request('PUT', `/api/boards/${encodeURIComponent(boardId)}`, updates)
  }

  async deleteBoard(boardId: string): Promise<void> {
    await this._request<void>('DELETE', `/api/boards/${encodeURIComponent(boardId)}`)
  }

  // ---------------------------------------------------------------------------
  // Comment operations
  // ---------------------------------------------------------------------------

  async listComments(cardId: string, boardId?: string): Promise<Comment[]> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Comment[]>('GET', `${base}/${encodeURIComponent(cardId)}/comments`)
  }

  async addComment(
    cardId: string,
    author: string,
    content: string,
    boardId?: string,
  ): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'POST',
      `${base}/${encodeURIComponent(cardId)}/comments`,
      { author, content },
    )
  }

  async updateComment(
    cardId: string,
    commentId: string,
    content: string,
    boardId?: string,
  ): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'PATCH',
      `${base}/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}`,
      { content },
    )
  }

  async deleteComment(
    cardId: string,
    commentId: string,
    boardId?: string,
  ): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'DELETE',
      `${base}/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}`,
    )
  }

  // ---------------------------------------------------------------------------
  // Checklist operations
  // ---------------------------------------------------------------------------

  async addChecklistItem(cardId: string, title: string, boardId?: string): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'POST',
      `${base}/${encodeURIComponent(cardId)}/checklist`,
      { title },
    )
  }

  async editChecklistItem(
    cardId: string,
    index: number,
    title: string,
    boardId?: string,
  ): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'PATCH',
      `${base}/${encodeURIComponent(cardId)}/checklist/${index}`,
      { title },
    )
  }

  async deleteChecklistItem(cardId: string, index: number, boardId?: string): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'DELETE',
      `${base}/${encodeURIComponent(cardId)}/checklist/${index}`,
    )
  }

  async checkChecklistItem(cardId: string, index: number, boardId?: string): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'POST',
      `${base}/${encodeURIComponent(cardId)}/checklist/${index}/check`,
    )
  }

  async uncheckChecklistItem(cardId: string, index: number, boardId?: string): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'DELETE',
      `${base}/${encodeURIComponent(cardId)}/checklist/${index}/check`,
    )
  }

  // ---------------------------------------------------------------------------
  // Attachment operations
  // ---------------------------------------------------------------------------

  async addAttachmentData(
    cardId: string,
    filename: string,
    data: string | Uint8Array,
    boardId?: string,
  ): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    const url = `${this._remoteUrl}${base}/${encodeURIComponent(cardId)}/attachments`
    const headers: Record<string, string> = {}
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`
    const blob =
      typeof data === 'string'
        ? new Blob([data], { type: 'text/plain' })
        : new Blob([data], { type: 'application/octet-stream' })
    const form = new FormData()
    form.append('file', blob, filename)
    const res = await fetch(url, { method: 'POST', headers, body: form })
    const json = (await res.json()) as { ok: boolean; data?: Card; error?: string }
    if (!json.ok) throw new Error(json.error ?? `Remote API error ${res.status}`)
    return json.data as Card
  }

  async removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Card> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    return this._request<Card>(
      'DELETE',
      `${base}/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachment)}`,
    )
  }

  async getAttachmentData(
    cardId: string,
    filename: string,
    boardId?: string,
  ): Promise<{ data: Uint8Array; contentType?: string } | null> {
    const base = boardId
      ? `/api/boards/${encodeURIComponent(boardId)}/tasks`
      : '/api/tasks'
    const url =
      `${this._remoteUrl}${base}/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(filename)}`
    const headers: Record<string, string> = {}
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`
    const res = await fetch(url, { headers })
    if (res.status === 404) return null
    const buf = await res.arrayBuffer()
    return {
      data: new Uint8Array(buf),
      contentType: res.headers.get('content-type') ?? undefined,
    }
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

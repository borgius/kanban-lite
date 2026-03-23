/**
 * SDK transport adapter for Kanban Lite n8n nodes.
 *
 * Executes operations by delegating to a local {@link KanbanSdkLike} instance
 * and subscribes to events through the SDK's in-process event bus. Both
 * before-events (`sdkBefore=true`) and after-events (`sdkAfter=true`) are
 * available in this mode.
 *
 * The adapter accepts a duck-typed interface compatible with `KanbanSDK` so
 * that the n8n package does not require `kanban-lite` as a compile-time
 * dependency. At runtime the caller is responsible for instantiating and
 * passing a real `KanbanSDK` instance.
 *
 * @module transport/sdkAdapter
 */

import type {
  EventCapabilityEntry,
  KanbanLiteResult,
  KanbanLiteTransport,
  SubscribeOptions,
  TriggerRegistration,
} from './types'
import { KanbanTransportError } from './types'
import { DEFAULT_EVENT_CAPABILITIES, normalizeResult } from './normalize'

// ---------------------------------------------------------------------------
// Minimal duck-typed SDK interface
// ---------------------------------------------------------------------------

/**
 * Minimal duck-typed interface structurally compatible with `KanbanSDK`.
 *
 * Only the methods called by the transport adapter are declared here,
 * so any object satisfying this shape is a valid SDK instance for transport use.
 */
export interface KanbanSdkLike {
  // Event bus subscription
  on(event: string, listener: (payload: unknown) => void): () => void
  off(event: string, listener: (payload: unknown) => void): void

  // Board operations
  listBoards(): Promise<unknown>
  getBoard(boardId?: string): Promise<unknown>
  createBoard(params: Record<string, unknown>): Promise<unknown>
  updateBoard(boardId: string, params: Record<string, unknown>): Promise<unknown>
  deleteBoard(boardId: string): Promise<unknown>
  setDefaultBoard(boardId: string): Promise<unknown>
  triggerBoardAction(boardId: string, params: Record<string, unknown>): Promise<unknown>

  // Card operations
  listCards(boardId?: string, status?: string, options?: Record<string, unknown>): Promise<unknown>
  getCard(cardId: string, boardId?: string): Promise<unknown>
  createCard(params: Record<string, unknown>, boardId?: string): Promise<unknown>
  updateCard(cardId: string, params: Record<string, unknown>, boardId?: string): Promise<unknown>
  moveCard(cardId: string, status: string, boardId?: string): Promise<unknown>
  deleteCard(cardId: string, boardId?: string): Promise<unknown>
  transferCard(cardId: string, targetBoardId: string, params?: Record<string, unknown>): Promise<unknown>
  purgeDeletedCards(boardId?: string): Promise<unknown>
  triggerCardAction(cardId: string, params: Record<string, unknown>, boardId?: string): Promise<unknown>

  // Comment operations
  listComments(cardId: string, boardId?: string): Promise<unknown>
  addComment(cardId: string, params: Record<string, unknown>, boardId?: string): Promise<unknown>
  updateComment(cardId: string, commentId: string, params: Record<string, unknown>, boardId?: string): Promise<unknown>
  deleteComment(cardId: string, commentId: string, boardId?: string): Promise<unknown>

  // Attachment operations
  listAttachments(cardId: string, boardId?: string): Promise<unknown>
  addAttachment(cardId: string, attachment: string, boardId?: string): Promise<unknown>
  removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<unknown>

  // Column operations
  listColumns(boardId?: string): Promise<unknown>
  addColumn(params: Record<string, unknown>, boardId?: string): Promise<unknown>
  updateColumn(columnId: string, params: Record<string, unknown>, boardId?: string): Promise<unknown>
  removeColumn(columnId: string, boardId?: string): Promise<unknown>
  reorderColumns(columnIds: string[], boardId?: string): Promise<unknown>
  setMinimizedColumns(columnIds: string[], boardId?: string): Promise<unknown>
  cleanupColumn(columnId: string, boardId?: string): Promise<unknown>

  // Label operations
  listLabels(boardId?: string): Promise<unknown>
  setLabel(params: Record<string, unknown>, boardId?: string): Promise<unknown>
  renameLabel(name: string, newName: string, boardId?: string): Promise<unknown>
  deleteLabel(name: string, boardId?: string): Promise<unknown>

  // Settings operations
  getSettings(boardId?: string): Promise<unknown>
  updateSettings(params: Record<string, unknown>, boardId?: string): Promise<unknown>

  // Storage operations
  getStorageStatus(): unknown
  migrateToSqlite(params?: Record<string, unknown>): Promise<unknown>
  migrateToMarkdown(): Promise<unknown>

  // Webhook operations
  listWebhooks(): Promise<unknown>
  createWebhook(params: Record<string, unknown>): Promise<unknown>
  updateWebhook(webhookId: string, params: Record<string, unknown>): Promise<unknown>
  deleteWebhook(webhookId: string): Promise<unknown>

  // Workspace / auth
  getWorkspaceInfo?(): Promise<unknown>
  getAuthStatus(): unknown
}

// ---------------------------------------------------------------------------
// SDK Transport adapter
// ---------------------------------------------------------------------------

/** Options for constructing a {@link SdkTransport}. */
export interface SdkTransportOptions {
  /** Pre-instantiated SDK instance. The caller is responsible for lifecycle. */
  sdk: KanbanSdkLike
  /**
   * Optional event capability catalog. When omitted, the built-in
   * {@link DEFAULT_EVENT_CAPABILITIES} is used.
   */
  eventCapabilities?: readonly EventCapabilityEntry[]
}

/**
 * Local SDK transport adapter.
 *
 * Routes all action executions to SDK methods and subscribes to events through
 * the SDK's in-process event bus. Both before-events and after-events are
 * available in this mode.
 */
export class SdkTransport implements KanbanLiteTransport {
  readonly mode = 'sdk' as const

  private readonly sdk: KanbanSdkLike
  private readonly capabilities: Map<string, EventCapabilityEntry>

  constructor(options: SdkTransportOptions) {
    this.sdk = options.sdk
    const catalog = options.eventCapabilities ?? DEFAULT_EVENT_CAPABILITIES
    this.capabilities = new Map(catalog.map(e => [e.event, e]))
  }

  /** @inheritdoc */
  canSubscribe(eventName: string): boolean {
    const entry = this.capabilities.get(eventName)
    return entry !== undefined && (entry.sdkBefore || entry.sdkAfter)
  }

  /** @inheritdoc */
  async subscribe(
    eventName: string,
    handler: (payload: unknown) => void,
    _options?: SubscribeOptions,
  ): Promise<TriggerRegistration> {
    if (!this.canSubscribe(eventName)) {
      throw new KanbanTransportError(
        'transport.unsupported_event',
        `Event "${eventName}" is not available in SDK transport mode.`,
      )
    }

    const unsub = this.sdk.on(eventName, handler)
    let disposed = false

    return {
      id: `sdk:${eventName}:${Date.now()}`,
      dispose: async () => {
        if (disposed) return
        disposed = true
        unsub()
      },
    }
  }

  /** @inheritdoc */
  async execute(
    resource: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<KanbanLiteResult<unknown>> {
    const data = await this._dispatch(resource, operation, params)
    return normalizeResult(data)
  }

  // ---------------------------------------------------------------------------
  // Internal routing – maps resource/operation → SDK method call
  // ---------------------------------------------------------------------------

  private async _dispatch(
    resource: string,
    operation: string,
    p: Record<string, unknown>,
  ): Promise<unknown> {
    const s = this.sdk
    const id = typeof p['id'] === 'string' ? p['id'] : undefined
    const boardId = typeof p['boardId'] === 'string' ? p['boardId'] : undefined
    const cardId = typeof p['cardId'] === 'string' ? p['cardId'] : undefined

    switch (`${resource}/${operation}`) {
      // board
      case 'board/list':          return s.listBoards()
      case 'board/get':           return s.getBoard(id ?? boardId)
      case 'board/create':        return s.createBoard(p)
      case 'board/update':        return s.updateBoard(id!, p)
      case 'board/delete':        return s.deleteBoard(id!)
      case 'board/setDefault':    return s.setDefaultBoard(id!)
      case 'board/triggerAction': return s.triggerBoardAction(id!, p)
      // card
      case 'card/list':           return s.listCards(boardId, typeof p['status'] === 'string' ? p['status'] : undefined, p)
      case 'card/get':            return s.getCard(id!, boardId)
      case 'card/create':         return s.createCard(p, boardId)
      case 'card/update':         return s.updateCard(id!, p, boardId)
      case 'card/move':           return s.moveCard(id!, typeof p['status'] === 'string' ? p['status'] : '', boardId)
      case 'card/delete':         return s.deleteCard(id!, boardId)
      case 'card/transfer':       return s.transferCard(id!, typeof p['targetBoardId'] === 'string' ? p['targetBoardId'] : '', p)
      case 'card/purgeDeleted':   return s.purgeDeletedCards(boardId)
      case 'card/triggerAction':  return s.triggerCardAction(id!, p, boardId)
      // comment
      case 'comment/list':        return s.listComments(cardId!, boardId)
      case 'comment/add':         return s.addComment(cardId!, p, boardId)
      case 'comment/update':      return s.updateComment(cardId!, id!, p, boardId)
      case 'comment/delete':      return s.deleteComment(cardId!, id!, boardId)
      // attachment
      case 'attachment/list':     return s.listAttachments(cardId!, boardId)
      case 'attachment/add':      return s.addAttachment(cardId!, typeof p['attachment'] === 'string' ? p['attachment'] : '', boardId)
      case 'attachment/remove':   return s.removeAttachment(cardId!, typeof p['attachment'] === 'string' ? p['attachment'] : '', boardId)
      // column
      case 'column/list':         return s.listColumns(boardId)
      case 'column/add':          return s.addColumn(p, boardId)
      case 'column/update':       return s.updateColumn(id!, p, boardId)
      case 'column/remove':       return s.removeColumn(id!, boardId)
      case 'column/reorder':      return s.reorderColumns(Array.isArray(p['columnIds']) ? p['columnIds'] as string[] : [], boardId)
      case 'column/setMinimized': return s.setMinimizedColumns(Array.isArray(p['columnIds']) ? p['columnIds'] as string[] : [], boardId)
      case 'column/cleanup':      return s.cleanupColumn(id!, boardId)
      // label
      case 'label/list':          return s.listLabels(boardId)
      case 'label/set':           return s.setLabel(p, boardId)
      case 'label/rename':        return s.renameLabel(typeof p['name'] === 'string' ? p['name'] : '', typeof p['newName'] === 'string' ? p['newName'] : '', boardId)
      case 'label/delete':        return s.deleteLabel(typeof p['name'] === 'string' ? p['name'] : '', boardId)
      // settings
      case 'settings/get':        return s.getSettings(boardId)
      case 'settings/update':     return s.updateSettings(p, boardId)
      // storage
      case 'storage/getStatus':         return s.getStorageStatus()
      case 'storage/migrateToSqlite':   return s.migrateToSqlite(p)
      case 'storage/migrateToMarkdown': return s.migrateToMarkdown()
      // webhook
      case 'webhook/list':        return s.listWebhooks()
      case 'webhook/create':      return s.createWebhook(p)
      case 'webhook/update':      return s.updateWebhook(id!, p)
      case 'webhook/delete':      return s.deleteWebhook(id!)
      // workspace
      case 'workspace/getInfo':   return s.getWorkspaceInfo?.() ?? null
      // auth
      case 'auth/getStatus':      return s.getAuthStatus()
      // unsupported
      default:
        throw new KanbanTransportError(
          'transport.unsupported_operation',
          `Operation "${resource}/${operation}" is not supported by the SDK transport.`,
        )
    }
  }
}

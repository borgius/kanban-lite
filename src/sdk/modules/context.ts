import type { Card, CardSortOption, LogEntry } from '../../shared/types'
import type { StorageEngine } from '../storage/types'
import type { SDKEventType } from '../types'

/**
 * Minimal interface satisfied by KanbanSDK, used as the first argument to all
 * module-level functions so they can access storage, config helpers, and
 * cross-module SDK operations without circular imports.
 *
 * @internal
 */
export interface SDKContext {
  readonly workspaceRoot: string
  readonly kanbanDir: string
  _storage: StorageEngine

  /** @internal */
  _resolveBoardId(boardId?: string): string
  /** @internal */
  _boardDir(boardId?: string): string
  /** @internal */
  _isCompletedStatus(status: string, boardId?: string): boolean
  /** @internal */
  _ensureMigrated(): Promise<void>
  /** @internal */
  emitEvent(event: SDKEventType, data: unknown): void

  // Cross-module card operations (routed through KanbanSDK instance)
  listCards(
    columns?: string[],
    boardId?: string,
    metaFilter?: Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]>
  getCard(cardId: string, boardId?: string): Promise<Card | null>
  updateCard(cardId: string, updates: Partial<Card>, boardId?: string): Promise<Card>
  addLog(
    cardId: string,
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, any> },
    boardId?: string
  ): Promise<LogEntry>
  moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Card>
  permanentlyDeleteCard(cardId: string, boardId?: string): Promise<void>
}

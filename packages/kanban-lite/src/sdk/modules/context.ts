import type { Card, CardSortOption, LogEntry } from '../../shared/types'
import type { ResolvedCapabilityBag } from '../plugins'
import type { StorageEngine } from '../plugins/types'
import type { AuthContext, SDKEventType } from '../types'

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
  readonly capabilities: ResolvedCapabilityBag | null

  /** @internal */
  _resolveBoardId(boardId?: string): string
  /** @internal */
  _boardDir(boardId?: string): string
  /** @internal */
  _isCompletedStatus(status: string, boardId?: string): boolean
  /** @internal */
  _ensureMigrated(): Promise<void>
  /**
   * @internal
   * @deprecated Leaf modules must not own event timing. This method will be removed
   * once all mutation families are migrated to the SDK-owned action runner (T4–T7).
   * After migration, before/after event emission is handled exclusively by the
   * action runner in `KanbanSDK.ts`.
   */
  emitEvent(event: SDKEventType, data: unknown): void
  getLocalCardPath(card: Card): string | null
  getAttachmentStoragePath(card: Card): string | null
  appendAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>
  readAttachment(card: Card, attachment: string): Promise<{ data: Uint8Array; contentType?: string } | null>
  writeAttachment(card: Card, attachment: string, content: string | Uint8Array): Promise<void>
  materializeAttachment(card: Card, attachment: string): Promise<string | null>
  copyAttachment(sourcePath: string, card: Card): Promise<void>

  // Cross-module card operations (routed through KanbanSDK instance)
  listCards(
    columns?: string[],
    boardId?: string,
    metaFilter?: Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]>
  /** @internal Raw card listing that bypasses caller-scoped checklist projection and visibility filtering. */
  _listCardsRaw(columns?: string[], boardId?: string): Promise<Card[]>
  getCard(cardId: string, boardId?: string): Promise<Card | null>
  /** @internal Raw card lookup that bypasses caller-scoped checklist projection and visibility filtering. */
  _getCardRaw(cardId: string, boardId?: string): Promise<Card | null>
  canPerformAction(action: string, context?: AuthContext): Promise<boolean>
  getActiveCard(boardId?: string): Promise<Card | null>
  setActiveCard(cardId: string, boardId?: string): Promise<Card>
  clearActiveCard(boardId?: string): Promise<void>
  updateCard(cardId: string, updates: Partial<Card>, boardId?: string): Promise<Card>
  addLog(
    cardId: string,
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string
  ): Promise<LogEntry>
  moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Card>
  permanentlyDeleteCard(cardId: string, boardId?: string): Promise<void>
}

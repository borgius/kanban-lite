import type { Card } from '../../shared/types'

/**
 * Supported SDK constructor storage-engine override values.
 *
 * `sqlite` remains available here as a legacy compatibility alias so existing
 * constructor overrides continue to route through the external sqlite package.
 */
export type StorageEngineType = 'markdown' | 'sqlite'

/**
 * Pluggable storage engine interface for the KanbanSDK.
 *
 * Every card-storage provider returns an engine implementing this contract.
 * The SDK delegates all persistence I/O to the active engine, keeping business
 * logic engine-agnostic.
 */
export interface StorageEngine {
  /**
   * Engine type identifier.
    * Core built-in value: `'markdown'`.
    * Compatibility/external providers may use ids such as `'sqlite'`, `'mysql'`,
    * or any custom package/provider name.
   */
  readonly type: string
  /** Absolute path to the `.kanban` directory. */
  readonly kanbanDir: string

  // --- Lifecycle ---

  /** Initialises the storage engine (runs migration, creates schema, etc.). */
  init(): Promise<void>

  /** Releases all resources held by the engine (e.g. closes DB connections). */
  close(): void

  /** Performs any pending data migrations required by this engine. */
  migrate(): Promise<void>

  // --- Board storage management ---

  /** Creates the board directory and any required status subdirectories. */
  ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void>

  /** Removes all data associated with a board. */
  deleteBoardData(boardDir: string, boardId: string): Promise<void>

  // --- Card I/O ---

  /** Scans all cards for a board. */
  scanCards(boardDir: string, boardId: string): Promise<Card[]>

  /**
   * Retrieves a single card by ID.
   *
   * Implementations should perform a targeted lookup (e.g. `WHERE card_id = ?
   * AND board_id = ?`) instead of scanning the entire board.  The default
   * fallback in the SDK falls back to `scanCards` + `.find()` for engines
   * that do not override this method.
   */
  getCardById?(boardDir: string, boardId: string, cardId: string): Promise<Card | null>

  /** Persists a card (create or update). */
  writeCard(card: Card): Promise<void>

  /** Moves a card to a new status location. */
  moveCard(card: Card, boardDir: string, newStatus: string): Promise<string>

  /** Renames a card in place without changing status. */
  renameCard(card: Card, newFilename: string): Promise<string>

  /** Permanently removes a card from storage. */
  deleteCard(card: Card): Promise<void>

  // --- Attachments ---

  /** Returns the directory where attachment files for a card are stored. */
  getCardDir(card: Card): string

  /** Copies a file to the card's attachment directory. */
  copyAttachment(sourcePath: string, card: Card): Promise<void>
}

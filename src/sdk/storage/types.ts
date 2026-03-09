import type { Card } from '../../shared/types'

/**
 * Supported storage engine types.
 *
 * - `'markdown'` — default; cards stored as individual `.md` files under `.kanban/boards/`
 * - `'sqlite'` — cards stored in a single SQLite database file
 *
 * In both cases, workspace configuration (columns, labels, settings, webhooks, boards) is
 * stored in `.kanban.json` at the workspace root.
 */
export type StorageEngineType = 'markdown' | 'sqlite'

/**
 * Minimal bootstrap configuration read from `.kanban.json` before the full
 * storage engine is initialised. Only the fields needed to locate and open
 * the correct engine are required here.
 *
 * All other workspace configuration (boards, columns, labels, settings, webhooks)
 * continues to live in `.kanban.json` regardless of which engine is active.
 */
export interface BootstrapConfig {
  /**
   * Which storage engine to use.
   * @default 'markdown'
   */
  storageEngine?: StorageEngineType
  /**
   * Path to the SQLite database file when `storageEngine` is `'sqlite'`.
   * Relative paths are resolved from the workspace root.
   * @default '.kanban/kanban.db'
   */
  sqlitePath?: string
}

/**
 * Pluggable storage engine interface for the KanbanSDK.
 *
 * Every storage backend must implement this interface. The SDK delegates
 * all I/O to the active engine, keeping its own business logic engine-agnostic.
 *
 * Two implementations ship out of the box:
 * - {@link MarkdownStorageEngine} — stores cards as markdown files (default)
 * - {@link SqliteStorageEngine} — stores cards in a SQLite database
 *
 * Custom engines can be injected via `SDKOptions.storage`.
 *
 * @example
 * // Inject a pre-built SQLite engine
 * const engine = new SqliteStorageEngine(kanbanDir, '/path/to/kanban.db')
 * const sdk = new KanbanSDK(kanbanDir, { storage: engine })
 * await sdk.init()
 */
export interface StorageEngine {
  /** Engine type identifier. */
  readonly type: StorageEngineType
  /** Absolute path to the `.kanban` directory. */
  readonly kanbanDir: string

  // --- Lifecycle ---

  /**
   * Initialises the storage engine (runs migration, creates schema, etc.).
   * Must be called before any other method.
   */
  init(): Promise<void>

  /**
   * Releases all resources held by the engine (e.g. closes DB connections).
   * Safe to call multiple times.
   */
  close(): void

  /**
   * Performs any pending data migrations required by this engine.
   *
   * For markdown: migrates the legacy single-board flat layout to
   * `boards/default/` multi-board layout and moves root `.md` files
   * into their status subdirectories.
   *
   * For SQLite: creates or upgrades the database schema.
   */
  migrate(): Promise<void>

  // --- Board storage management ---

  /**
   * Creates the board directory and any required status subdirectories.
   *
   * For markdown: creates the actual directories under `.kanban/boards/{boardId}/`.
   * For SQLite: ensures the attachment directory exists; no-op for card storage.
   *
   * @param boardDir - Absolute path to the board directory.
   * @param extraStatuses - Additional status subdirectory names to ensure exist.
   */
  ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void>

  /**
   * Removes all data associated with a board.
   *
   * For markdown: recursively deletes the board directory.
   * For SQLite: deletes all card and comment rows for the board and removes
   * the attachment directory.
   *
   * @param boardDir - Absolute path to the board directory (used for markdown/attachments).
   * @param boardId - The board ID (used for SQLite queries).
   */
  deleteBoardData(boardDir: string, boardId: string): Promise<void>

  // --- Card I/O ---

  /**
   * Scans all cards for a board.
   *
   * For markdown: reads every `.md` file recursively under the board directory
   * and parses each file's YAML frontmatter, including internal reconciliation
   * of status/folder mismatches.
   *
   * For SQLite: queries the `cards` and `comments` tables and assembles
   * `Card` objects, with `filePath` set to `''`.
   *
   * @param boardDir - Absolute path to the board storage directory.
   * @param boardId - The board ID.
   * @returns Array of all cards for the board (including soft-deleted ones).
   */
  scanCards(boardDir: string, boardId: string): Promise<Card[]>

  /**
   * Persists a card (create or update).
   *
   * For markdown: serialises the card and writes it to `card.filePath`. If the
   * card does not yet have a `filePath`, one is derived from its status and ID.
   *
   * For SQLite: upserts the card and its comments into the database.
   * `card.filePath` is ignored and left unchanged/empty.
   *
   * @param card - The card to persist. `card.filePath` must be valid for markdown.
   */
  writeCard(card: Card): Promise<void>

  /**
   * Moves a card to a new status directory.
   *
   * For markdown: renames the containing directory and updates `card.filePath` in place.
   * Handles filename collisions by appending a numeric suffix. Co-moves any
   * referenced attachment files.
   *
   * For SQLite: updates `card.status` in the database. `card.filePath` is unchanged.
   *
   * @param card - The card to move (status must already be updated on the card object).
   * @param boardDir - Absolute path to the board directory root.
   * @param newStatus - The target status/column ID.
   * @returns The new absolute file path. For SQLite this is always `''`.
   */
  moveCard(card: Card, boardDir: string, newStatus: string): Promise<string>

  /**
   * Renames a card's file in place (does not change its directory/status).
   *
   * For markdown: renames the `.md` file and returns the new path.
   * For SQLite: no-op — card IDs/slugs do not affect storage; returns `''`.
   *
   * @param card - The card whose file should be renamed.
   * @param newFilename - New filename **without** the `.md` extension.
   * @returns The new absolute file path. For SQLite this is always `''`.
   */
  renameCard(card: Card, newFilename: string): Promise<string>

  /**
   * Permanently removes a card from storage.
   *
   * For markdown: unlinks the `.md` file from disk.
   * For SQLite: deletes the card row and all associated comment rows.
   *
   * @param card - The card to delete.
   */
  deleteCard(card: Card): Promise<void>

  // --- Attachments ---

  /**
   * Returns the directory where attachment files for a card are stored.
   *
   * For markdown: `path.dirname(card.filePath)` (same dir as the `.md` file).
   * For SQLite: `{kanbanDir}/boards/{boardId}/{status}/attachments/`.
   *
   * @param card - The card whose attachment directory to resolve.
   * @returns Absolute path to the attachment directory.
   */
  getCardDir(card: Card): string

  /**
   * Copies a file to the card's attachment directory.
   *
   * Creates the destination directory if it does not exist. Skips the copy
   * if the source is already inside the card's directory.
   *
   * @param sourcePath - Absolute or relative path of the file to copy.
   * @param card - The target card.
   */
  copyAttachment(sourcePath: string, card: Card): Promise<void>
}

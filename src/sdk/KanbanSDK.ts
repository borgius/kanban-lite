import * as path from 'path'
import type { Comment, Card, KanbanColumn, BoardInfo, LabelDefinition, CardSortOption, LogEntry } from '../shared/types'
import type { CardDisplaySettings, Priority } from '../shared/types'
import { DELETED_STATUS_ID } from '../shared/types'
import { readConfig, normalizeStorageCapabilities, normalizeAuthCapabilities } from '../shared/config'
import type { BoardConfig, ProviderRef, ResolvedCapabilities, Webhook } from '../shared/config'
import type { ResolvedAuthCapabilities } from '../shared/config'
import type { CreateCardInput, SDKEventHandler, SDKEventType, SDKOptions, SubmitFormInput, SubmitFormResult } from './types'
import type { StorageEngine } from './plugins/types'
import { fireWebhooks, loadWebhooks, createWebhook as _createWebhook, deleteWebhook as _deleteWebhook, updateWebhook as _updateWebhook } from './webhooks'
import { resolveKanbanDir } from './fileUtils'
import { resolveCapabilityBag } from './plugins'
import type { ResolvedCapabilityBag } from './plugins'
import * as Boards from './modules/boards'
import * as Cards from './modules/cards'
import * as Labels from './modules/labels'
import * as Attachments from './modules/attachments'
import * as Comments from './modules/comments'
import * as Logs from './modules/logs'
import * as Columns from './modules/columns'
import * as Settings from './modules/settings'
import * as Migration from './modules/migration'

/**
 * Resolved storage/provider metadata for diagnostics and host surfaces.
 *
 * This lightweight shape is designed for UI status banners, REST responses,
 * CLI diagnostics, and integration checks that need to know which providers
 * are active without reaching into the internal capability bag.
 */
export interface StorageStatus {
  /** Active `card.storage` provider id (also mirrored as the legacy storage-engine label). */
  storageEngine: string
  /** Fully resolved provider selections, or `null` when a pre-built storage engine was injected. */
  providers: ResolvedCapabilities | null
  /** Whether the active card provider stores cards as local files. */
  isFileBacked: boolean
  /** File-watcher glob for local card files, or `null` for non-file-backed providers. */
  watchGlob: string | null
}

/**
 * Optional search and sort inputs for {@link KanbanSDK.listCards}.
 *
 * The object form is the recommended public contract for new callers because it
 * keeps structured metadata filters, free-text search, fuzzy search, and sort
 * options in one explicit shape.
 *
 * @example
 * ```ts
 * const cards = await sdk.listCards(undefined, 'bugs', {
 *   searchQuery: 'release meta.team: backend',
 *   metaFilter: { 'links.jira': 'PROJ-' },
 *   sort: 'modified:desc',
 *   fuzzy: true,
 * })
 * ```
 */
export interface ListCardsOptions {
  /**
   * Optional map of dot-notation metadata paths to required values.
   * Each entry is AND-based and field-scoped.
   */
  metaFilter?: Record<string, string>
  /**
   * Optional sort order. Defaults to fractional board order.
   */
  sort?: CardSortOption
  /**
   * Optional free-text query. The query may also include inline
   * `meta.field: value` tokens, which are merged with `metaFilter`.
   */
  searchQuery?: string
  /**
   * Enables fuzzy matching when `true`. Exact substring matching remains the default.
   */
  fuzzy?: boolean
}

const LIST_CARD_SORT_OPTIONS: ReadonlySet<CardSortOption> = new Set([
  'created:asc',
  'created:desc',
  'modified:asc',
  'modified:desc',
])

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value)
    && !Array.isArray(value)
    && typeof value === 'object'
    && Object.values(value as Record<string, unknown>).every(entry => typeof entry === 'string')
}

function isCardSortOption(value: unknown): value is CardSortOption {
  return typeof value === 'string' && LIST_CARD_SORT_OPTIONS.has(value as CardSortOption)
}

function isListCardsOptions(value: unknown): value is ListCardsOptions {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false
  const candidate = value as Partial<ListCardsOptions> & Record<string, unknown>
  if ('metaFilter' in candidate && candidate.metaFilter !== undefined && !isStringRecord(candidate.metaFilter)) return false
  if ('sort' in candidate && candidate.sort !== undefined && !isCardSortOption(candidate.sort)) return false
  if ('searchQuery' in candidate && candidate.searchQuery !== undefined && typeof candidate.searchQuery !== 'string') return false
  if ('fuzzy' in candidate && candidate.fuzzy !== undefined && typeof candidate.fuzzy !== 'boolean') return false
  return 'metaFilter' in candidate || 'sort' in candidate || 'searchQuery' in candidate || 'fuzzy' in candidate
}

function normalizeListCardsOptions(
  optionsOrMetaFilter?: ListCardsOptions | Record<string, string>,
  sort?: CardSortOption,
  searchQuery?: string,
  fuzzy?: boolean
): ListCardsOptions {
  if (sort !== undefined || searchQuery !== undefined || fuzzy !== undefined) {
    return {
      metaFilter: optionsOrMetaFilter as Record<string, string> | undefined,
      sort,
      searchQuery,
      fuzzy,
    }
  }

  if (!optionsOrMetaFilter) return {}

  return isListCardsOptions(optionsOrMetaFilter)
    ? optionsOrMetaFilter
    : { metaFilter: optionsOrMetaFilter }
}

function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: { ...ref.options } }
    : { provider: ref.provider }
}

function resolveConfiguredAuthCapabilities(kanbanDir: string): ResolvedAuthCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  return normalizeAuthCapabilities(config)
}

function resolveConfiguredCapabilities(kanbanDir: string, options?: SDKOptions): ResolvedCapabilities {
  const config = readConfig(path.dirname(kanbanDir))
  const capabilities = normalizeStorageCapabilities(config)

  if (options?.storageEngine === 'sqlite') {
    capabilities['card.storage'] = {
      provider: 'sqlite',
      options: { sqlitePath: options.sqlitePath ?? config.sqlitePath ?? '.kanban/kanban.db' },
    }
  } else if (options?.storageEngine === 'markdown') {
    capabilities['card.storage'] = { provider: 'markdown' }
  }

  if (options?.capabilities?.['card.storage']) {
    capabilities['card.storage'] = cloneProviderRef(options.capabilities['card.storage'])
  }
  if (options?.capabilities?.['attachment.storage']) {
    capabilities['attachment.storage'] = cloneProviderRef(options.capabilities['attachment.storage'])
  }

  return capabilities
}

/**
 * Core SDK for managing kanban boards with provider-backed card storage.
 *
 * Provides full CRUD operations for boards, cards, columns, comments,
 * attachments, and display settings. By default cards are persisted as
 * markdown files with YAML frontmatter under the `.kanban/` directory,
 * organized by board and status column, but the resolved `card.storage`
 * provider may also route card/comment persistence to SQLite, MySQL, or an
 * external plugin.
 *
 * This class is the foundation that the CLI, MCP server, and standalone
 * HTTP server are all built on top of.
 *
 * @example
 * ```ts
 * const sdk = new KanbanSDK('/path/to/project/.kanban')
 * await sdk.init()
 * const cards = await sdk.listCards()
 * ```
 */
export class KanbanSDK {
  private _migrated = false
  private _onEvent?: SDKEventHandler
  /** @internal */ _storage: StorageEngine
  private _capabilities: ResolvedCapabilityBag | null = null

  /**
   * Absolute path to the `.kanban` kanban directory.
   * The parent of this directory is treated as the workspace root.
   */
  public readonly kanbanDir: string

  /**
   * Creates a new KanbanSDK instance.
   *
   * @param kanbanDir - Absolute path to the `.kanban` kanban directory.
   *   When omitted, the directory is auto-detected by walking up from
   *   `process.cwd()` to find the workspace root (via `.git`, `package.json`,
   *   or `.kanban.json`), then reading `kanbanDirectory` from `.kanban.json`
   *   (defaults to `'.kanban'`).
   * @param options - Optional configuration including an event handler callback
   *   and storage engine selection.
   *
   * @example
   * ```ts
   * // Auto-detect from process.cwd()
   * const sdk = new KanbanSDK()
   *
   * // Explicit path
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban')
   *
   * // With event handler for webhooks
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban', {
   *   onEvent: (event, data) => fireWebhooks(root, event, data)
   * })
   *
   * // Force SQLite storage
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban', {
   *   storageEngine: 'sqlite'
   * })
   * ```
   */
  constructor(kanbanDir?: string, options?: SDKOptions) {
    this.kanbanDir = kanbanDir ?? resolveKanbanDir()
    this._onEvent = options?.onEvent
    if (options?.storage) {
      this._storage = options.storage
      this._capabilities = null
      return
    }

    this._capabilities = resolveCapabilityBag(
      resolveConfiguredCapabilities(this.kanbanDir, options),
      this.kanbanDir,
      resolveConfiguredAuthCapabilities(this.kanbanDir),
    )
    this._storage = this._capabilities.cardStorage
  }

  /**
   * The active storage engine powering this SDK instance.
   * Returns the resolved `card.storage` provider implementation
   * (for example `markdown`, `sqlite`, or `mysql`).
   */
  get storageEngine(): StorageEngine {
    return this._storage
  }

  /**
   * The resolved storage/attachment capability bag for this SDK instance.
   * Returns `null` when a pre-built storage engine was injected directly.
   */
  get capabilities(): ResolvedCapabilityBag | null {
    return this._capabilities
  }

  /**
   * Returns storage/provider metadata for host surfaces and diagnostics.
   *
   * Use this to inspect resolved provider ids, file-backed status, and
   * watcher behavior without reaching into capability internals.
   *
   * @returns A {@link StorageStatus} snapshot containing the active provider id,
   *   resolved provider selections (when available), whether cards are backed by
   *   local files, and the watcher glob used by file-backed hosts.
   *
   * @example
   * ```ts
   * const status = sdk.getStorageStatus()
   * console.log(status.storageEngine) // 'markdown' | 'sqlite' | 'mysql' | ...
  * console.log(status.watchGlob) // e.g. markdown card glob for board/status directories
   * ```
   */
  getStorageStatus(): StorageStatus {
    return {
      storageEngine: this._storage.type,
      providers: this._capabilities?.providers ?? null,
      isFileBacked: this._capabilities?.isFileBacked ?? this._storage.type === 'markdown',
      watchGlob: this._capabilities?.getWatchGlob() ?? (this._storage.type === 'markdown' ? 'boards/**/*.md' : null),
    }
  }

  /**
   * Returns the local file path for a card when the active provider exposes one.
   *
   * This is most useful for editor integrations or diagnostics that need to open
   * or reveal the underlying source file. Providers that do not expose stable
   * local card files return `null`.
   *
   * @param card - The resolved card object.
   * @returns The absolute on-disk card path, or `null` when the active provider
   *   does not expose one.
   *
   * @example
   * ```ts
   * const card = await sdk.getCard('42')
   * if (card) {
   *   console.log(sdk.getLocalCardPath(card))
   * }
   * ```
   */
  getLocalCardPath(card: Card): string | null {
    return this._capabilities?.getLocalCardPath(card) ?? (card.filePath || null)
  }

  /**
   * Returns the local attachment directory for a card when the active
   * attachment provider exposes one.
   *
   * File-backed providers typically return an absolute directory under the
   * workspace, while database-backed or remote attachment providers may return
   * `null` when attachments are not directly browseable on disk.
   *
   * @param card - The resolved card object.
   * @returns The absolute attachment directory, or `null` when the active
   *   attachment provider cannot expose one.
   */
  getAttachmentStoragePath(card: Card): string | null {
    if (this._capabilities) {
      return this._capabilities.getAttachmentDir(card)
    }

    try {
      return this._storage.getCardDir(card)
    } catch {
      return null
    }
  }

  /**
   * Resolves or materializes a safe local file path for a named attachment.
   *
   * For simple file-backed providers this usually returns the existing file.
   * Other providers may need to materialize a temporary local copy first.
   * The method also guards against invalid attachment names and only resolves
   * files already attached to the card.
   *
   * @param card - The resolved card object.
   * @param attachment - Attachment filename exactly as stored on the card.
   * @returns An absolute local path, or `null` when the attachment cannot be
   *   safely exposed by the current provider.
   *
   * @example
   * ```ts
   * const card = await sdk.getCard('42')
   * const pdfPath = card ? await sdk.materializeAttachment(card, 'report.pdf') : null
   * ```
   */
  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    if (this._capabilities) {
      return this._capabilities.materializeAttachment(card, attachment)
    }

    const normalized = attachment.replace(/\\/g, '/')
    if (!normalized || normalized.includes('/')) return null
    if (!Array.isArray(card.attachments) || !card.attachments.includes(normalized)) return null

    const attachmentDir = this.getAttachmentStoragePath(card)
    if (!attachmentDir) return null
    return path.join(attachmentDir, normalized)
  }

  /**
   * Copies an attachment through the resolved attachment-storage capability.
   *
   * This is a low-level helper used by higher-level attachment flows. It writes
   * the supplied source file into the active attachment provider for the given
   * card, whether that provider is local filesystem storage or a custom plugin.
   *
   * @param sourcePath - Absolute or relative path to the source file to copy.
   * @param card - The target card that should own the copied attachment.
   */
  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    if (this._capabilities) {
      await this._capabilities.attachmentStorage.copyAttachment(sourcePath, card)
      return
    }
    await this._storage.copyAttachment(sourcePath, card)
  }

  /**
   * Closes the storage engine and releases any held resources (e.g. database
   * connections). Call this when the SDK instance is no longer needed.
   */
  close(): void {
    this._storage.close()
  }

  /**
   * Emits an event to the registered handler, if one exists.
   * Called internally after every successful mutating operation.
   */
  /** @internal */
  emitEvent(event: SDKEventType, data: unknown): void {
    if (this._onEvent) {
      try {
        this._onEvent(event, data)
      } catch (err) {
        console.error(`SDK event handler error for ${event}:`, err)
      }
    } else {
      fireWebhooks(this.workspaceRoot, event, data)
    }
  }

  /**
   * The workspace root directory (parent of the kanban directory).
   *
   * This is the project root where `.kanban.json` configuration lives.
   *
   * @returns The absolute path to the workspace root directory.
   *
   * @example
   * ```ts
   * const sdk = new KanbanSDK('/home/user/my-project/.kanban')
   * console.log(sdk.workspaceRoot) // '/home/user/my-project'
   * ```
   */
  get workspaceRoot(): string {
    return path.dirname(this.kanbanDir)
  }

  // --- Board resolution helpers ---

  /** @internal */
  _resolveBoardId(boardId?: string): string {
    const config = readConfig(this.workspaceRoot)
    return boardId || config.defaultBoard
  }

  /** @internal */
  _boardDir(boardId?: string): string {
    const resolvedId = this._resolveBoardId(boardId)
    return path.join(this.kanbanDir, 'boards', resolvedId)
  }

  /** @internal */
  _isCompletedStatus(status: string, boardId?: string): boolean {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board || board.columns.length === 0) return status === 'done'
    return board.columns[board.columns.length - 1].id === status
  }

  /** @internal */
  async _ensureMigrated(): Promise<void> {
    if (this._migrated) return
    await this._storage.migrate()
    this._migrated = true
  }

  /**
   * Initializes the SDK by running any pending filesystem migrations and
   * ensuring the default board's directory structure exists.
   *
   * This should be called once before performing any operations, especially
   * on a fresh workspace or after upgrading from a single-board layout.
   *
   * @returns A promise that resolves when initialization is complete.
   *
   * @example
   * ```ts
   * const sdk = new KanbanSDK('/path/to/project/.kanban')
   * await sdk.init()
   * ```
   */
  async init(): Promise<void> {
    await this._storage.init()
    this._migrated = true
    const boardDir = this._boardDir()
    await this._storage.ensureBoardDirs(boardDir, [DELETED_STATUS_ID])
  }

  // --- Board management ---

  /**
   * Lists all boards defined in the workspace configuration.
   *
   * @returns An array of {@link BoardInfo} objects containing each board's
   *   `id`, `name`, and optional `description`.
   *
   * @example
   * ```ts
   * const boards = sdk.listBoards()
   * // [{ id: 'default', name: 'Default Board', description: undefined }]
   * ```
   */
  listBoards(): BoardInfo[] {
    return Boards.listBoards(this)
  }

  /**
   * Creates a new board with the given ID and name.
   *
   * If no columns are specified, the new board inherits columns from the
   * default board. If the default board has no columns, a standard set of
   * five columns (Backlog, To Do, In Progress, Review, Done) is used.
   *
   * @param id - Unique identifier for the board (used in file paths and API calls).
   * @param name - Human-readable display name for the board.
   * @param options - Optional configuration for the new board.
   * @param options.description - A short description of the board's purpose.
   * @param options.columns - Custom column definitions. Defaults to the default board's columns.
   * @param options.defaultStatus - The default status for new cards. Defaults to the first column's ID.
   * @param options.defaultPriority - The default priority for new cards. Defaults to the workspace default.
   * @returns A {@link BoardInfo} object for the newly created board.
   * @throws {Error} If a board with the given `id` already exists.
   *
   * @example
   * ```ts
   * const board = sdk.createBoard('bugs', 'Bug Tracker', {
   *   description: 'Track and triage bugs',
   *   defaultStatus: 'triage'
   * })
   * ```
   */
  createBoard(id: string, name: string, options?: {
    description?: string
    columns?: KanbanColumn[]
    defaultStatus?: string
    defaultPriority?: Priority
  }): BoardInfo {
    return Boards.createBoard(this, id, name, options)
  }

  /**
   * Deletes a board and its directory from the filesystem.
   *
   * The board must be empty (no cards) and must not be the default board.
   * The board's directory is removed recursively from disk, and the board
   * entry is removed from the workspace configuration.
   *
   * @param boardId - The ID of the board to delete.
   * @returns A promise that resolves when the board has been deleted.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the board is the default board.
   * @throws {Error} If the board still contains cards.
   *
   * @example
   * ```ts
   * await sdk.deleteBoard('old-sprint')
   * ```
   */
  async deleteBoard(boardId: string): Promise<void> {
    return Boards.deleteBoard(this, boardId)
  }

  /**
   * Retrieves the full configuration for a specific board.
   *
   * @param boardId - The ID of the board to retrieve.
   * @returns The {@link BoardConfig} object containing columns, settings, and metadata.
   * @throws {Error} If the board does not exist.
   *
   * @example
   * ```ts
   * const config = sdk.getBoard('default')
   * console.log(config.columns) // [{ id: 'backlog', name: 'Backlog', ... }, ...]
   * ```
   */
  getBoard(boardId: string): BoardConfig {
    return Boards.getBoard(this, boardId)
  }

  /**
   * Updates properties of an existing board.
   *
   * Only the provided fields are updated; omitted fields remain unchanged.
   * The `nextCardId` counter cannot be modified through this method.
   *
   * @param boardId - The ID of the board to update.
   * @param updates - A partial object containing the fields to update.
   * @param updates.name - New display name for the board.
   * @param updates.description - New description for the board.
   * @param updates.columns - Replacement column definitions.
   * @param updates.defaultStatus - New default status for new cards.
   * @param updates.defaultPriority - New default priority for new cards.
   * @returns The updated {@link BoardConfig} object.
   * @throws {Error} If the board does not exist.
   *
   * @example
   * ```ts
   * const updated = sdk.updateBoard('bugs', {
   *   name: 'Bug Tracker v2',
   *   defaultPriority: 'high'
   * })
   * ```
   */
  updateBoard(boardId: string, updates: Partial<Omit<BoardConfig, 'nextCardId'>>): BoardConfig {
    return Boards.updateBoard(this, boardId, updates)
  }

  /**
   * Returns the named actions defined on a board.
   *
   * @param boardId - Board ID. Defaults to the active board when omitted.
   * @returns A map of action key to display title.
   * @throws {Error} If the board does not exist.
    *
    * @example
    * ```ts
    * const actions = sdk.getBoardActions('deployments')
    * console.log(actions.deploy) // 'Deploy now'
    * ```
   */
  getBoardActions(boardId?: string): Record<string, string> {
    return Boards.getBoardActions(this, boardId)
  }

  /**
   * Adds or updates a named action on a board.
   *
   * @param boardId - Board ID.
   * @param key - Unique action key (used as identifier).
   * @param title - Human-readable display title for the action.
   * @returns The updated actions map.
   * @throws {Error} If the board does not exist.
    *
    * @example
    * ```ts
    * sdk.addBoardAction('deployments', 'deploy', 'Deploy now')
    * ```
   */
  addBoardAction(boardId: string, key: string, title: string): Record<string, string> {
    return Boards.addBoardAction(this, boardId, key, title)
  }

  /**
   * Removes a named action from a board.
   *
   * @param boardId - Board ID.
   * @param key - The action key to remove.
   * @returns The updated actions map.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the action key is not found on the board.
    *
    * @example
    * ```ts
    * sdk.removeBoardAction('deployments', 'deploy')
    * ```
   */
  removeBoardAction(boardId: string, key: string): Record<string, string> {
    return Boards.removeBoardAction(this, boardId, key)
  }

  /**
   * Fires the `board.action` webhook event for a named board action.
   *
   * @param boardId - The board that owns the action.
   * @param actionKey - The key of the action to trigger.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the action key is not defined on the board.
    *
    * @example
    * ```ts
    * await sdk.triggerBoardAction('deployments', 'deploy')
    * ```
   */
  async triggerBoardAction(boardId: string, actionKey: string): Promise<void> {
    return Boards.triggerBoardAction(this, boardId, actionKey)
  }

  /**
   * Transfers a card from one board to another.
   *
   * The card file is physically moved to the target board's directory. If a
   * target status is not specified, the card is placed in the target board's
   * default status column. The card's order is recalculated to place it at
   * the end of the target column. Timestamps (`modified`, `completedAt`)
   * are updated accordingly.
   *
   * @param cardId - The ID of the card to transfer.
   * @param fromBoardId - The ID of the source board.
   * @param toBoardId - The ID of the destination board.
   * @param targetStatus - Optional status column in the destination board.
   *   Defaults to the destination board's default status.
   * @returns A promise resolving to the updated {@link Card} card object.
   * @throws {Error} If either board does not exist.
   * @throws {Error} If the card is not found in the source board.
   *
   * @example
   * ```ts
   * const card = await sdk.transferCard('42', 'inbox', 'bugs', 'triage')
   * console.log(card.boardId) // 'bugs'
   * console.log(card.status)  // 'triage'
   * ```
   */
  async transferCard(cardId: string, fromBoardId: string, toBoardId: string, targetStatus?: string): Promise<Card> {
    return Boards.transferCard(this, cardId, fromBoardId, toBoardId, targetStatus)
  }

  // --- Card CRUD ---

  /**
   * Lists all cards on a board, optionally filtered by column/status and search criteria.
   *
   * **Note:** This includes soft-deleted cards (status `'deleted'`).
   * Filter them out if you need only active cards.
   *
   * This method performs several housekeeping tasks during loading:
   * - Migrates flat root-level `.md` files into their proper status subdirectories
   * - Reconciles status/folder mismatches (moves files to match their frontmatter status)
   * - Migrates legacy integer ordering to fractional indexing
   * - Syncs the card ID counter with existing cards
   *
  * By default cards are returned sorted by their fractional order key (board order).
  * Pass a {@link CardSortOption} to sort by creation or modification date instead.
  *
  * Search behavior is storage-agnostic and is the same for markdown and SQLite workspaces:
  * - Exact mode is the default.
  * - Exact free-text search checks the legacy text fields: `content`, `id`, `assignee`, and `labels`.
  * - Inline `meta.field: value` tokens and `metaFilter` entries are always field-scoped and AND-based.
  * - In exact mode, metadata matching uses case-insensitive substring matching.
  * - In fuzzy mode, free-text search also considers metadata values, and field-scoped metadata checks gain fuzzy fallback matching.
  *
  * New code should prefer the object overload so search and sort options stay explicit.
  * The legacy positional parameters remain supported for backward compatibility.
   *
   * @param columns - Optional array of status/column IDs to filter by.
   *   When provided, ensures those subdirectories exist on disk.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
  * @param optionsOrMetaFilter - Either the recommended {@link ListCardsOptions} object,
  *   or the legacy positional `metaFilter` map for backward compatibility.
  * @param sort - Legacy positional sort order. One of `'created:asc'`, `'created:desc'`,
  *   `'modified:asc'`, `'modified:desc'`. Defaults to fractional board order.
  * @param searchQuery - Legacy positional free-text query, which may include
  *   `meta.field: value` tokens.
  * @param fuzzy - Legacy positional fuzzy-search toggle. Defaults to `false`.
   * @returns A promise resolving to an array of {@link Card} card objects.
   *
   * @example
   * ```ts
   * // List all cards on the default board
   * const allCards = await sdk.listCards()
   *
   * // List only cards in 'todo' and 'in-progress' columns on the 'bugs' board
   * const filtered = await sdk.listCards(['todo', 'in-progress'], 'bugs')
   *
   * // Preferred object form: exact metadata-aware search using inline meta tokens
   * const releaseCards = await sdk.listCards(undefined, undefined, {
   *   searchQuery: 'release meta.team: backend'
   * })
   *
   * // Preferred object form: fuzzy search across free text and metadata values
   * const fuzzyMatches = await sdk.listCards(undefined, undefined, {
   *   searchQuery: 'meta.team: backnd api plumbng',
   *   fuzzy: true
   * })
   *
   * // Structured metadata filters remain supported and are merged with inline meta tokens
   * const q1Jira = await sdk.listCards(undefined, undefined, {
   *   metaFilter: { sprint: 'Q1', 'links.jira': 'PROJ' },
   *   sort: 'created:desc'
   * })
   *
   * // Legacy positional form still works for existing callers
   * const newest = await sdk.listCards(undefined, undefined, undefined, 'created:desc', 'meta.team: backend', true)
   * ```
   */
  async listCards(columns?: string[], boardId?: string, options?: ListCardsOptions): Promise<Card[]>
  async listCards(
    columns?: string[],
    boardId?: string,
    metaFilter?: Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]>
  async listCards(
    columns?: string[],
    boardId?: string,
    optionsOrMetaFilter?: ListCardsOptions | Record<string, string>,
    sort?: CardSortOption,
    searchQuery?: string,
    fuzzy?: boolean
  ): Promise<Card[]> {
    const options = normalizeListCardsOptions(optionsOrMetaFilter, sort, searchQuery, fuzzy)

    return Cards.listCards(
      this,
      columns,
      boardId,
      options.metaFilter,
      options.sort,
      options.searchQuery,
      options.fuzzy
    )
  }

  /**
   * Retrieves a single card by its ID.
   *
   * Supports partial ID matching -- the provided `cardId` is matched against
   * all cards on the board.
   *
   * @param cardId - The full or partial ID of the card to retrieve.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the matching {@link Card} card, or `null` if not found.
   *
   * @example
   * ```ts
   * const card = await sdk.getCard('42')
   * if (card) {
   *   console.log(card.content)
   * }
   * ```
   */
  async getCard(cardId: string, boardId?: string): Promise<Card | null> {
    return Cards.getCard(this, cardId, boardId)
  }

  /**
   * Retrieves the card currently marked as active/open in this workspace.
   *
   * Active-card state is persisted in the workspace so other interfaces
   * (standalone server, CLI, MCP, and VS Code) can query the same card.
   * Returns `null` when no card is currently active.
   *
   * @param boardId - Optional board ID. When provided, returns the active card
   *   only if it belongs to that board.
   * @returns A promise resolving to the active {@link Card}, or `null`.
   *
   * @example
   * ```ts
   * const active = await sdk.getActiveCard()
   * if (active) {
   *   console.log(active.id)
   * }
   * ```
   */
  async getActiveCard(boardId?: string): Promise<Card | null> {
    return Cards.getActiveCard(this, boardId)
  }

  /** @internal */
  async setActiveCard(cardId: string, boardId?: string): Promise<Card> {
    return Cards.setActiveCard(this, cardId, boardId)
  }

  /** @internal */
  async clearActiveCard(boardId?: string): Promise<void> {
    return Cards.clearActiveCard(this, boardId)
  }

  /**
   * Creates a new card on a board.
   *
   * The card is assigned an auto-incrementing numeric ID, placed at the end
   * of its target status column using fractional indexing, and persisted as a
   * markdown file with YAML frontmatter. If no status or priority is provided,
   * the board's defaults are used.
   *
   * @param data - The card creation input. See {@link CreateCardInput}.
   * @param data.content - Markdown content for the card. The first `# Heading` becomes the title.
   * @param data.status - Optional status column. Defaults to the board's default status.
   * @param data.priority - Optional priority level. Defaults to the board's default priority.
   * @param data.assignee - Optional assignee name.
   * @param data.dueDate - Optional due date as an ISO 8601 string.
   * @param data.labels - Optional array of label strings.
   * @param data.attachments - Optional array of attachment filenames.
   * @param data.metadata - Optional arbitrary key-value metadata stored in the card's frontmatter.
   * @param data.actions - Optional per-card actions as action keys or key-to-title map.
   * @param data.forms - Optional attached forms, using workspace-form references or inline definitions.
   * @param data.formData - Optional per-form persisted values keyed by resolved form ID.
   * @param data.boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the newly created {@link Card} card.
   *
   * @example
   * ```ts
   * const card = await sdk.createCard({
   *   content: '# Fix login bug\n\nUsers cannot log in with email.',
   *   status: 'todo',
   *   priority: 'high',
   *   labels: ['bug', 'auth'],
   *   boardId: 'bugs'
   * })
   * console.log(card.id) // '7'
   * ```
   */
  async createCard(data: CreateCardInput): Promise<Card> {
    return Cards.createCard(this, data)
  }

  /**
   * Updates an existing card's properties.
   *
   * Only the provided fields are updated; omitted fields remain unchanged.
   * The `filePath`, `id`, and `boardId` fields are protected and cannot be
   * overwritten. If the card's title changes, the underlying file is renamed.
   * If the status changes, the file is moved to the new status subdirectory
   * and `completedAt` is updated accordingly.
  *
  * Common update fields include `content`, `status`, `priority`, `assignee`,
  * `dueDate`, `labels`, `metadata`, `actions`, `forms`, and `formData`.
   *
   * @param cardId - The ID of the card to update.
   * @param updates - A partial {@link Card} object with the fields to update.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const updated = await sdk.updateCard('42', {
   *   priority: 'critical',
   *   assignee: 'alice',
   *   labels: ['urgent', 'backend']
   * })
   * ```
   */
  async updateCard(cardId: string, updates: Partial<Card>, boardId?: string): Promise<Card> {
    return Cards.updateCard(this, cardId, updates, boardId)
  }

  /**
   * Validates and persists a form submission for a card, then emits `form.submit`
   * through the normal SDK event/webhook pipeline.
   *
   * The target form must already be attached to the card, either as an inline
   * card-local form or as a named reusable workspace form reference.
   *
   * **Partial-at-rest semantics:** `card.formData[formId]` may be a partial
   * record at rest (containing only previously submitted or pre-seeded fields).
   * The merge below always produces a full canonical object, and that full
   * object is what gets persisted and returned as `result.data`.
   *
   * Merge order for the resolved base payload (lowest → highest priority):
   * 1. Workspace-config form defaults (`KanbanConfig.forms[formName].data`)
   * 2. Card-scoped attachment defaults (`attachment.data`)
   * 3. Persisted per-card form data (`card.formData[formId]`, may be partial)
   * 4. Card metadata fields that are declared in the form schema
   * 5. The submitted payload passed to this method
   *
   * Before the merge, string values in each source layer are prepared via
   * `prepareFormData()` (from `src/shared/formDataPreparation`), which resolves
   * `${path}` placeholders against the full card interpolation context.
   *
   * Validation happens authoritatively in the SDK before persistence and before
   * any event/webhook emission, so CLI/API/MCP/UI callers all share the same rules.
  * After a successful submit, the SDK also appends a system card log entry that
  * records the submitted payload under `payload` for audit/debug visibility.
   *
   * @param input - The form submission input.
   * @param input.cardId - ID of the card that owns the target form.
   * @param input.formId - Resolved form ID/name to submit.
   * @param input.data - Submitted field values to merge over the resolved base payload.
   * @param input.boardId - Optional board ID. Defaults to the workspace default board.
   * @returns The canonical persisted payload and event context. `result.data` is
   *   always the full merged and validated object (never a partial snapshot).
   * @throws {Error} If the card or form cannot be found, or if validation fails.
   *
   * @example
   * ```ts
   * const result = await sdk.submitForm({
   *   cardId: '42',
   *   formId: 'bug-report',
   *   data: { severity: 'high', title: 'Crash on save' }
   * })
   * console.log(result.data.severity) // 'high'
   * ```
   */
  async submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
    return Cards.submitForm(this, input)
  }

  /**
   * Triggers a named action for a card by POSTing to the global `actionWebhookUrl`
   * configured in `.kanban.json`.
   *
   * The payload sent to the webhook is:
   * ```json
   * { "action": "retry", "board": "default", "list": "in-progress", "card": { ...sanitizedCard } }
   * ```
   *
   * @param cardId - The ID of the card to trigger the action for.
   * @param action - The action name string (e.g. `'retry'`, `'sendEmail'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving when the webhook responds with 2xx.
   * @throws {Error} If no `actionWebhookUrl` is configured in `.kanban.json`.
   * @throws {Error} If the card is not found.
   * @throws {Error} If the webhook responds with a non-2xx status.
   *
   * @example
   * ```ts
   * await sdk.triggerAction('42', 'retry')
   * await sdk.triggerAction('42', 'sendEmail', 'bugs')
   * ```
   */
  async triggerAction(cardId: string, action: string, boardId?: string): Promise<void> {
    return Cards.triggerAction(this, cardId, action, boardId)
  }

  /**
   * Moves a card to a different status column and/or position within that column.
   *
   * The card's fractional order key is recalculated based on the target
   * position. If the status changes, the underlying file is moved to the
   * corresponding subdirectory and `completedAt` is updated accordingly.
   *
   * @param cardId - The ID of the card to move.
   * @param newStatus - The target status/column ID.
   * @param position - Optional zero-based index within the target column.
   *   Defaults to the end of the column.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * // Move card to 'in-progress' at position 0 (top of column)
   * const card = await sdk.moveCard('42', 'in-progress', 0)
   *
   * // Move card to 'done' at the end (default)
   * const done = await sdk.moveCard('42', 'done')
   * ```
   */
  async moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Card> {
    return Cards.moveCard(this, cardId, newStatus, position, boardId)
  }

  /**
   * Soft-deletes a card by moving it to the `deleted` status column.
   * The file remains on disk and can be restored.
   *
   * @param cardId - The ID of the card to soft-delete.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the card has been moved to deleted status.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.deleteCard('42', 'bugs')
   * ```
   */
  async deleteCard(cardId: string, boardId?: string): Promise<void> {
    return Cards.deleteCard(this, cardId, boardId)
  }

  /**
   * Permanently deletes a card's markdown file from disk.
   * This cannot be undone.
   *
   * @param cardId - The ID of the card to permanently delete.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the card file has been removed from disk.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.permanentlyDeleteCard('42', 'bugs')
   * ```
   */
  async permanentlyDeleteCard(cardId: string, boardId?: string): Promise<void> {
    return Cards.permanentlyDeleteCard(this, cardId, boardId)
  }

  /**
   * Returns all cards in a specific status column.
   *
   * This is a convenience wrapper around {@link listCards} that filters
   * by a single status value.
   *
   * @param status - The status/column ID to filter by (e.g., `'todo'`, `'in-progress'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of {@link Card} cards in the given status.
   *
   * @example
   * ```ts
   * const inProgress = await sdk.getCardsByStatus('in-progress')
   * console.log(`${inProgress.length} cards in progress`)
   * ```
   */
  async getCardsByStatus(status: string, boardId?: string): Promise<Card[]> {
    return Cards.getCardsByStatus(this, status, boardId)
  }

  /**
   * Returns a sorted list of unique assignee names across all cards on a board.
   *
   * Cards with no assignee are excluded from the result.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to a sorted array of unique assignee name strings.
   *
   * @example
   * ```ts
   * const assignees = await sdk.getUniqueAssignees('bugs')
   * // ['alice', 'bob', 'charlie']
   * ```
   */
  async getUniqueAssignees(boardId?: string): Promise<string[]> {
    return Cards.getUniqueAssignees(this, boardId)
  }

  /**
   * Returns a sorted list of unique labels across all cards on a board.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to a sorted array of unique label strings.
   *
   * @example
   * ```ts
   * const labels = await sdk.getUniqueLabels()
   * // ['bug', 'enhancement', 'frontend', 'urgent']
   * ```
   */
  async getUniqueLabels(boardId?: string): Promise<string[]> {
    return Cards.getUniqueLabels(this, boardId)
  }

  // --- Label definition management ---

  /**
   * Returns all label definitions from the workspace configuration.
   *
   * Label definitions map label names to their color and optional group.
   * Labels on cards that have no definition will render with default gray styling.
   *
   * @returns A record mapping label names to {@link LabelDefinition} objects.
   *
   * @example
   * ```ts
   * const labels = sdk.getLabels()
   * // { bug: { color: '#e11d48', group: 'Type' }, docs: { color: '#16a34a' } }
   * ```
   */
  getLabels(): Record<string, LabelDefinition> {
    return Labels.getLabels(this)
  }

  /**
   * Creates or updates a label definition in the workspace configuration.
   *
   * If the label already exists, its definition is replaced entirely.
   * The change is persisted to `.kanban.json` immediately.
   *
   * @param name - The label name (e.g. `'bug'`, `'frontend'`).
   * @param definition - The label definition with color and optional group.
   *
   * @example
   * ```ts
   * sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
   * sdk.setLabel('docs', { color: '#16a34a' })
   * ```
   */
  setLabel(name: string, definition: LabelDefinition): void {
    Labels.setLabel(this, name, definition)
  }

  /**
   * Removes a label definition from the workspace configuration and cascades
   * the deletion to all cards by removing the label from their `labels` array.
   *
   * @param name - The label name to remove.
   *
   * @example
   * ```ts
   * await sdk.deleteLabel('bug')
   * ```
   */
  async deleteLabel(name: string): Promise<void> {
    return Labels.deleteLabel(this, name)
  }

  /**
   * Renames a label in the configuration and cascades the change to all cards.
   *
   * Updates the label key in `.kanban.json` and replaces the old label name
   * with the new one on every card that uses it.
   *
   * @param oldName - The current label name.
   * @param newName - The new label name.
   *
   * @example
   * ```ts
   * await sdk.renameLabel('bug', 'defect')
   * // Config updated: 'defect' now has bug's color/group
   * // All cards with 'bug' label now have 'defect' instead
   * ```
   */
  async renameLabel(oldName: string, newName: string): Promise<void> {
    return Labels.renameLabel(this, oldName, newName)
  }

  /**
   * Returns a sorted list of label names that belong to the given group.
   *
   * Labels without an explicit `group` property are not matched by any
   * group name (they are considered ungrouped).
   *
   * @param group - The group name to filter by (e.g. `'Type'`, `'Priority'`).
   * @returns A sorted array of label names in the group.
   *
   * @example
   * ```ts
   * sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
   * sdk.setLabel('feature', { color: '#2563eb', group: 'Type' })
   *
   * sdk.getLabelsInGroup('Type')
   * // ['bug', 'feature']
   * ```
   */
  getLabelsInGroup(group: string): string[] {
    return Labels.getLabelsInGroup(this, group)
  }

  /**
   * Returns all cards that have at least one label belonging to the given group.
   *
   * Looks up all labels in the group via {@link getLabelsInGroup}, then filters
   * cards to those containing any of those labels.
   *
   * @param group - The group name to filter by.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of matching {@link Card} cards.
   *
   * @example
   * ```ts
   * const typeCards = await sdk.filterCardsByLabelGroup('Type')
   * // Returns all cards with 'bug', 'feature', or any other 'Type' label
   * ```
   */
  async filterCardsByLabelGroup(group: string, boardId?: string): Promise<Card[]> {
    return Labels.filterCardsByLabelGroup(this, group, boardId)
  }

  // --- Attachment management ---

  /**
   * Adds a file attachment to a card.
   *
   * The source file is copied into the card's directory (alongside its
   * markdown file) unless it already resides there. The attachment filename
   * is added to the card's `attachments` array if not already present.
   *
   * @param cardId - The ID of the card to attach the file to.
   * @param sourcePath - Path to the file to attach. Can be absolute or relative.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.addAttachment('42', '/tmp/screenshot.png')
   * console.log(card.attachments) // ['screenshot.png']
   * ```
   */
  async addAttachment(cardId: string, sourcePath: string, boardId?: string): Promise<Card> {
    return Attachments.addAttachment(this, cardId, sourcePath, boardId)
  }

  /**
   * Removes an attachment reference from a card's metadata.
   *
   * This removes the attachment filename from the card's `attachments` array
   * but does not delete the physical file from disk.
   *
   * @param cardId - The ID of the card to remove the attachment from.
   * @param attachment - The attachment filename to remove (e.g., `'screenshot.png'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.removeAttachment('42', 'old-screenshot.png')
   * ```
   */
  async removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Card> {
    return Attachments.removeAttachment(this, cardId, attachment, boardId)
  }

  /**
   * Lists all attachment filenames for a card.
   *
   * @param cardId - The ID of the card whose attachments to list.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of attachment filename strings.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const files = await sdk.listAttachments('42')
   * // ['screenshot.png', 'debug-log.txt']
   * ```
   */
  async listAttachments(cardId: string, boardId?: string): Promise<string[]> {
    return Attachments.listAttachments(this, cardId, boardId)
  }

  /**
   * Returns the absolute path to the attachment directory for a card.
   *
   * For the markdown engine this is `{column_dir}/attachments/`.
   * For the SQLite engine this is `.kanban/boards/{boardId}/attachments/{cardId}/`.
   *
   * @param cardId - The ID of the card.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the absolute directory path, or `null` if the card is not found.
   *
   * @example
   * ```ts
   * const dir = await sdk.getAttachmentDir('42')
   * // '/workspace/.kanban/boards/default/backlog/attachments'
   * ```
   */
  async getAttachmentDir(cardId: string, boardId?: string): Promise<string | null> {
    return Attachments.getAttachmentDir(this, cardId, boardId)
  }

  // --- Comment management ---

  /**
   * Lists all comments on a card.
   *
   * @param cardId - The ID of the card whose comments to list.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of {@link Comment} objects.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const comments = await sdk.listComments('42')
   * for (const c of comments) {
   *   console.log(`${c.author}: ${c.content}`)
   * }
   * ```
   */
  async listComments(cardId: string, boardId?: string): Promise<Comment[]> {
    return Comments.listComments(this, cardId, boardId)
  }

  /**
   * Adds a comment to a card.
   *
   * The comment is assigned an auto-incrementing ID (e.g., `'c1'`, `'c2'`)
   * based on the existing comments. The card's `modified` timestamp is updated.
   *
   * @param cardId - The ID of the card to comment on.
   * @param author - The name of the comment author.
   * @param content - The comment text content.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card (including the new comment).
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.addComment('42', 'alice', 'This needs more investigation.')
   * console.log(card.comments.length) // 1
   * ```
   */
  async addComment(cardId: string, author: string, content: string, boardId?: string): Promise<Card> {
    return Comments.addComment(this, cardId, author, content, boardId)
  }

  /**
   * Updates the content of an existing comment on a card.
   *
   * @param cardId - The ID of the card containing the comment.
   * @param commentId - The ID of the comment to update (e.g., `'c1'`).
   * @param content - The new content for the comment.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   * @throws {Error} If the comment is not found on the card.
   *
   * @example
   * ```ts
   * const card = await sdk.updateComment('42', 'c1', 'Updated: this is now resolved.')
   * ```
   */
  async updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<Card> {
    return Comments.updateComment(this, cardId, commentId, content, boardId)
  }

  /**
   * Deletes a comment from a card.
   *
   * @param cardId - The ID of the card containing the comment.
   * @param commentId - The ID of the comment to delete (e.g., `'c1'`).
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated {@link Card} card.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const card = await sdk.deleteComment('42', 'c2')
   * ```
   */
  async deleteComment(cardId: string, commentId: string, boardId?: string): Promise<Card> {
    return Comments.deleteComment(this, cardId, commentId, boardId)
  }

  // --- Log management ---

  /**
   * Returns the absolute path to the log file for a card.
   *
   * The log file is stored alongside the card's markdown file (or in the
   * card's attachment directory for SQLite) as `<cardId>.log`.
   *
   * @param cardId - The ID of the card.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the log file path, or `null` if the card is not found.
   */
  async getLogFilePath(cardId: string, boardId?: string): Promise<string | null> {
    return Logs.getLogFilePath(this, cardId, boardId)
  }

  /**
   * Lists all log entries for a card.
   *
   * Reads the card's `.log` file and parses each line into a {@link LogEntry}.
   * Returns an empty array if no log file exists.
   *
   * @param cardId - The ID of the card whose logs to list.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to an array of {@link LogEntry} objects.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const logs = await sdk.listLogs('42')
   * for (const entry of logs) {
   *   console.log(`[${entry.source}] ${entry.text}`)
   * }
   * ```
   */
  async listLogs(cardId: string, boardId?: string): Promise<LogEntry[]> {
    return Logs.listLogs(this, cardId, boardId)
  }

  /**
   * Adds a log entry to a card.
   *
   * Appends a new line to the card's `.log` file. If the file does not exist,
   * it is created and automatically added to the card's attachments array.
   * The timestamp defaults to the current time if not provided.
   * The source defaults to `'default'` if not provided.
   *
   * @param cardId - The ID of the card to add the log to.
   * @param text - The log message text. Supports inline markdown.
   * @param options - Optional log entry parameters.
   * @param options.source - Source/origin label. Defaults to `'default'`.
   * @param options.timestamp - ISO 8601 timestamp. Defaults to current time.
   * @param options.object - Optional structured data to attach as JSON.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the created {@link LogEntry}.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * const entry = await sdk.addLog('42', 'Build started')
   * const entry2 = await sdk.addLog('42', 'Deploy complete', {
   *   source: 'ci',
   *   object: { version: '1.2.3', duration: 42 }
   * })
   * ```
   */
  async addLog(
    cardId: string,
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string
  ): Promise<LogEntry> {
    return Logs.addLog(this, cardId, text, options, boardId)
  }

  /**
   * Clears all log entries for a card by deleting the `.log` file.
   *
   * The log file is removed from disk and from the card's attachments array.
   * New log entries will recreate the file automatically.
   *
   * @param cardId - The ID of the card whose logs to clear.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the logs have been cleared.
   * @throws {Error} If the card is not found.
   *
   * @example
   * ```ts
   * await sdk.clearLogs('42')
   * ```
   */
  async clearLogs(cardId: string, boardId?: string): Promise<void> {
    return Logs.clearLogs(this, cardId, boardId)
  }

  // --- Board-level log management ---

  /**
   * Returns the absolute path to the board-level log file for a given board.
   *
   * The board log file is located at `.kanban/boards/<boardId>/board.log`,
   * at the same level as the column folders.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The absolute path to `board.log` for the specified board.
   *
   * @example
   * ```ts
   * const logPath = sdk.getBoardLogFilePath()
   * // '/workspace/.kanban/boards/default/board.log'
   * ```
   */
  getBoardLogFilePath(boardId?: string): string {
    return Logs.getBoardLogFilePath(this, boardId)
  }

  /**
   * Lists all log entries from the board-level log file.
   *
   * Returns an empty array if the log file does not exist yet.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves to an array of {@link LogEntry} objects, oldest first.
   *
   * @example
   * ```ts
   * const logs = await sdk.listBoardLogs()
   * // [{ timestamp: '2024-01-01T00:00:00.000Z', source: 'api', text: 'Card created' }]
   * ```
   */
  async listBoardLogs(boardId?: string): Promise<LogEntry[]> {
    return Logs.listBoardLogs(this, boardId)
  }

  /**
   * Appends a new log entry to the board-level log file.
   *
   * Creates the log file if it does not yet exist.
   *
   * @param text - The human-readable log message.
   * @param options - Optional entry metadata: source label, ISO timestamp override, and structured object.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves to the created {@link LogEntry}.
   *
   * @example
   * ```ts
   * const entry = await sdk.addBoardLog('Board archived', { source: 'cli' })
   * ```
   */
  async addBoardLog(
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string
  ): Promise<LogEntry> {
    return Logs.addBoardLog(this, text, options, boardId)
  }

  /**
   * Clears all log entries for a board by deleting the board-level `board.log` file.
   *
   * New log entries will recreate the file automatically.
   * No error is thrown if the file does not exist.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise that resolves when the logs have been cleared.
   *
   * @example
   * ```ts
   * await sdk.clearBoardLogs()
   * ```
   */
  async clearBoardLogs(boardId?: string): Promise<void> {
    return Logs.clearBoardLogs(this, boardId)
  }

  // --- Column management (board-scoped) ---

  /**
   * Lists all columns defined for a board.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns An array of {@link KanbanColumn} objects in their current order.
   *
   * @example
   * ```ts
   * const columns = sdk.listColumns('bugs')
   * // [{ id: 'triage', name: 'Triage', color: '#ef4444' }, ...]
   * ```
   */
  listColumns(boardId?: string): KanbanColumn[] {
    return Columns.listColumns(this, boardId)
  }

  /**
   * Adds a new column to a board.
   *
   * The column is appended to the end of the board's column list.
   *
   * @param column - The column definition to add.
   * @param column.id - Unique identifier for the column (used as status values on cards).
   * @param column.name - Human-readable display name.
   * @param column.color - CSS color string for the column header.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The full updated array of {@link KanbanColumn} objects for the board.
   * @throws {Error} If the board is not found.
   * @throws {Error} If a column with the same ID already exists.
   * @throws {Error} If the column ID is `'deleted'` (reserved for soft-delete).
   *
   * @example
   * ```ts
   * const columns = sdk.addColumn(
   *   { id: 'blocked', name: 'Blocked', color: '#ef4444' },
   *   'default'
   * )
   * ```
   */
  addColumn(column: KanbanColumn, boardId?: string): KanbanColumn[] {
    return Columns.addColumn(this, column, boardId)
  }

  /**
   * Updates the properties of an existing column.
   *
   * Only the provided fields (`name`, `color`) are updated; the column's
   * `id` cannot be changed.
   *
   * @param columnId - The ID of the column to update.
   * @param updates - A partial object with the fields to update.
   * @param updates.name - New display name for the column.
   * @param updates.color - New CSS color string for the column.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The full updated array of {@link KanbanColumn} objects for the board.
   * @throws {Error} If the board is not found.
   * @throws {Error} If the column is not found.
   *
   * @example
   * ```ts
   * const columns = sdk.updateColumn('in-progress', {
   *   name: 'Working On',
   *   color: '#f97316'
   * })
   * ```
   */
  updateColumn(columnId: string, updates: Partial<Omit<KanbanColumn, 'id'>>, boardId?: string): KanbanColumn[] {
    return Columns.updateColumn(this, columnId, updates, boardId)
  }

  /**
   * Removes a column from a board.
   *
   * The column must be empty (no cards currently assigned to it).
   * This operation cannot be undone.
   *
   * @param columnId - The ID of the column to remove.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the updated array of {@link KanbanColumn} objects.
   * @throws {Error} If the board is not found.
   * @throws {Error} If the column is not found.
   * @throws {Error} If the column still contains cards.
   * @throws {Error} If the column ID is `'deleted'` (reserved for soft-delete).
   *
   * @example
   * ```ts
   * const columns = await sdk.removeColumn('blocked', 'default')
   * ```
   */
  async removeColumn(columnId: string, boardId?: string): Promise<KanbanColumn[]> {
    return Columns.removeColumn(this, columnId, boardId)
  }

  /**
   * Moves all cards in the specified column to the `deleted` (soft-delete) column.
   *
   * This is a non-destructive operation — cards are moved to the reserved
   * `deleted` status and can be restored or permanently deleted later.
   * The column itself is not removed.
   *
   * @param columnId - The ID of the column whose cards should be moved to `deleted`.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the number of cards that were moved.
   * @throws {Error} If the column is `'deleted'` (no-op protection).
   *
   * @example
   * ```ts
   * const moved = await sdk.cleanupColumn('blocked')
   * console.log(`Moved ${moved} cards to deleted`)
   * ```
   */
  async cleanupColumn(columnId: string, boardId?: string): Promise<number> {
    return Columns.cleanupColumn(this, columnId, boardId)
  }

  /**
   * Permanently deletes all cards currently in the `deleted` column.
   *
   * This is equivalent to "empty trash". All soft-deleted cards are
   * removed from disk. This operation cannot be undone.
   *
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns A promise resolving to the number of cards that were permanently deleted.
   *
   * @example
   * ```ts
   * const count = await sdk.purgeDeletedCards()
   * console.log(`Permanently deleted ${count} cards`)
   * ```
   */
  async purgeDeletedCards(boardId?: string): Promise<number> {
    return Columns.purgeDeletedCards(this, boardId)
  }

  /**
   * Reorders the columns of a board.
   *
   * The `columnIds` array must contain every existing column ID exactly once,
   * in the desired new order.
   *
   * @param columnIds - An array of all column IDs in the desired order.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @returns The reordered array of {@link KanbanColumn} objects.
   * @throws {Error} If the board is not found.
   * @throws {Error} If any column ID in the array does not exist.
   * @throws {Error} If the array does not include all column IDs.
   *
   * @example
   * ```ts
   * const columns = sdk.reorderColumns(
   *   ['backlog', 'todo', 'blocked', 'in-progress', 'review', 'done'],
   *   'default'
   * )
   * ```
   */
  reorderColumns(columnIds: string[], boardId?: string): KanbanColumn[] {
    return Columns.reorderColumns(this, columnIds, boardId)
  }

  /**
   * Returns the minimized column IDs for a board.
   *
   * @param boardId - Board to query (uses default board if omitted).
   * @returns Array of column IDs currently marked as minimized.
   */
  getMinimizedColumns(boardId?: string): string[] {
    return Columns.getMinimizedColumns(this, boardId)
  }

  /**
   * Sets the minimized column IDs for a board, persisting the state to the
   * workspace config file. Stale or invalid IDs are silently dropped.
   *
   * @param columnIds - Column IDs to mark as minimized.
   * @param boardId - Board to update (uses default board if omitted).
   * @returns The sanitized list of minimized column IDs that was saved.
   */
  setMinimizedColumns(columnIds: string[], boardId?: string): string[] {
    return Columns.setMinimizedColumns(this, columnIds, boardId)
  }

  // --- Settings management (global) ---

  /**
   * Returns the global card display settings for the workspace.
   *
   * Display settings control which fields are shown on card previews
   * (e.g., priority badges, assignee avatars, due dates, labels).
   *
   * @returns The current {@link CardDisplaySettings} object.
   *
   * @example
   * ```ts
   * const settings = sdk.getSettings()
   * console.log(settings.showPriority) // true
   * ```
   */
  getSettings(): CardDisplaySettings {
    return Settings.getSettings(this)
  }

  /**
   * Updates the global card display settings for the workspace.
   *
   * The provided settings object fully replaces the display settings
   * in the workspace configuration file (`.kanban.json`).
   *
   * @param settings - The new {@link CardDisplaySettings} to apply.
   *
   * @example
   * ```ts
   * sdk.updateSettings({
   *   showPriority: true,
   *   showAssignee: true,
   *   showDueDate: false,
   *   showLabels: true
   * })
   * ```
   */
  updateSettings(settings: CardDisplaySettings): void {
    Settings.updateSettings(this, settings)
  }

  // ---------------------------------------------------------------------------
  // Storage migration
  // ---------------------------------------------------------------------------

  /**
   * Migrates all card data from the current storage engine to SQLite.
   *
   * Cards are scanned from every board using the active engine, then written
   * to a new {@link SqliteStorageEngine}. After all data has been copied the
   * workspace `.kanban.json` is updated with `storageEngine: 'sqlite'` and
   * `sqlitePath` so that subsequent SDK instances use the new engine.
   *
   * The existing markdown files are **not** deleted; they serve as a manual
   * backup until the caller explicitly removes them.
   *
   * @param dbPath - Path to the SQLite database file. Relative paths are
   *   resolved from the workspace root. Defaults to `'.kanban/kanban.db'`.
   * @returns The total number of cards migrated.
   * @throws {Error} If the current engine is already `'sqlite'`.
   *
   * @example
   * ```ts
   * const count = await sdk.migrateToSqlite()
   * console.log(`Migrated ${count} cards to SQLite`)
   * ```
   */
  async migrateToSqlite(dbPath?: string): Promise<number> {
    return Migration.migrateToSqlite(this, dbPath)
  }

  /**
   * Migrates all card data from the current SQLite engine back to markdown files.
   *
   * Cards are scanned from every board in the SQLite database and written as
   * individual `.md` files under `.kanban/boards/<boardId>/<status>/`. After
   * migration the workspace `.kanban.json` is updated to remove the
   * `storageEngine`/`sqlitePath` overrides so the default markdown engine is
   * used by subsequent SDK instances.
   *
   * The SQLite database file is **not** deleted; it serves as a manual backup.
   *
   * @returns The total number of cards migrated.
   * @throws {Error} If the current engine is already `'markdown'`.
   *
   * @example
   * ```ts
   * const count = await sdk.migrateToMarkdown()
   * console.log(`Migrated ${count} cards to markdown`)
   * ```
   */
  async migrateToMarkdown(): Promise<number> {
    return Migration.migrateToMarkdown(this)
  }

  /**
   * Sets the default board for the workspace.
   *
   * @param boardId - The ID of the board to set as the default.
   * @throws {Error} If the board does not exist.
   *
   * @example
   * ```ts
   * sdk.setDefaultBoard('sprint-2')
   * ```
   */
  setDefaultBoard(boardId: string): void {
    Settings.setDefaultBoard(this, boardId)
  }

  /**
   * Lists all registered webhooks.
   *
   * @returns Array of {@link Webhook} objects.
   */
  listWebhooks(): Webhook[] {
    return loadWebhooks(this.workspaceRoot)
  }

  /**
   * Creates and persists a new webhook.
   *
   * @param webhookConfig - The webhook configuration.
   * @returns The newly created {@link Webhook}.
   */
  createWebhook(webhookConfig: { url: string; events: string[]; secret?: string }): Webhook {
    return _createWebhook(this.workspaceRoot, webhookConfig)
  }

  /**
   * Deletes a webhook by its ID.
   *
   * @param id - The webhook ID to delete.
   * @returns `true` if deleted, `false` if not found.
   */
  deleteWebhook(id: string): boolean {
    return _deleteWebhook(this.workspaceRoot, id)
  }

  /**
   * Updates an existing webhook's configuration.
   *
   * @param id - The webhook ID to update.
   * @param updates - Partial webhook fields to merge.
   * @returns The updated {@link Webhook}, or `null` if not found.
   */
  updateWebhook(id: string, updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>): Webhook | null {
    return _updateWebhook(this.workspaceRoot, id, updates)
  }

}

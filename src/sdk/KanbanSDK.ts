import * as path from 'path'
import * as fs from 'fs/promises'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Comment, Card, KanbanColumn, BoardInfo, LabelDefinition, CardSortOption, LogEntry } from '../shared/types'
import { getTitleFromContent, generateCardFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION } from '../shared/types'
import { readConfig, writeConfig, configToSettings, settingsToConfig, allocateCardId, syncCardIdCounter, getBoardConfig } from '../shared/config'
import type { BoardConfig } from '../shared/config'
import type { CardDisplaySettings } from '../shared/types'
import type { Priority } from '../shared/types'
import { getCardFilePath } from './fileUtils'
import type { CreateCardInput, SDKEventHandler, SDKEventType, SDKOptions } from './types'
import { sanitizeCard } from './types'
import type { StorageEngine } from './storage/types'
import { createStorageEngine } from './storage'
import { matchesMetaFilter } from './metaUtils'
import { fireWebhooks } from './webhooks'

/**
 * Core SDK for managing kanban boards stored as markdown files.
 *
 * Provides full CRUD operations for boards, cards, columns, comments,
 * attachments, and display settings. Cards are persisted as markdown files
 * with YAML frontmatter under the `.kanban/` directory, organized by board
 * and status column.
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
  private _storage: StorageEngine

  /**
   * Creates a new KanbanSDK instance.
   *
   * @param kanbanDir - Absolute path to the `.kanban` kanban directory.
   *   The parent of this directory is treated as the workspace root.
   * @param options - Optional configuration including an event handler callback
   *   and storage engine selection.
   *
   * @example
   * ```ts
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
  constructor(public readonly kanbanDir: string, options?: SDKOptions) {
    this._onEvent = options?.onEvent
    this._storage = options?.storage ?? createStorageEngine(kanbanDir, {
      storageEngine: options?.storageEngine,
      sqlitePath: options?.sqlitePath,
    })
  }

  /**
   * The active storage engine powering this SDK instance.
   * Returns `'markdown'` or `'sqlite'`.
   */
  get storageEngine(): StorageEngine {
    return this._storage
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
  private emitEvent(event: SDKEventType, data: unknown): void {
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

  private _resolveBoardId(boardId?: string): string {
    const config = readConfig(this.workspaceRoot)
    return boardId || config.defaultBoard
  }

  private _boardDir(boardId?: string): string {
    const resolvedId = this._resolveBoardId(boardId)
    return path.join(this.kanbanDir, 'boards', resolvedId)
  }

  private _isCompletedStatus(status: string, boardId?: string): boolean {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board || board.columns.length === 0) return status === 'done'
    return board.columns[board.columns.length - 1].id === status
  }

  private async _ensureMigrated(): Promise<void> {
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
    const config = readConfig(this.workspaceRoot)
    return Object.entries(config.boards).map(([id, board]) => ({
      id,
      name: board.name,
      description: board.description,
      columns: board.columns,
      actions: board.actions
    }))
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
    const config = readConfig(this.workspaceRoot)
    if (config.boards[id]) {
      throw new Error(`Board already exists: ${id}`)
    }

    const columns = options?.columns || [...config.boards[config.defaultBoard]?.columns || [
      { id: 'backlog', name: 'Backlog', color: '#6b7280' },
      { id: 'todo', name: 'To Do', color: '#3b82f6' },
      { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
      { id: 'review', name: 'Review', color: '#8b5cf6' },
      { id: 'done', name: 'Done', color: '#22c55e' }
    ]]

    config.boards[id] = {
      name,
      description: options?.description,
      columns,
      nextCardId: 1,
      defaultStatus: options?.defaultStatus || columns[0]?.id || 'backlog',
      defaultPriority: options?.defaultPriority || config.defaultPriority
    }
    writeConfig(this.workspaceRoot, config)

    const boardInfo = { id, name, description: options?.description }
    this.emitEvent('board.created', boardInfo)
    return boardInfo
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
    const config = readConfig(this.workspaceRoot)
    if (!config.boards[boardId]) {
      throw new Error(`Board not found: ${boardId}`)
    }
    if (config.defaultBoard === boardId) {
      throw new Error(`Cannot delete the default board: ${boardId}`)
    }

    // Check if board has cards
    const cards = await this.listCards(undefined, boardId)
    if (cards.length > 0) {
      throw new Error(`Cannot delete board "${boardId}": ${cards.length} card(s) still exist`)
    }

    // Remove board data from storage
    const boardDir = this._boardDir(boardId)
    await this._storage.deleteBoardData(boardDir, boardId)

    delete config.boards[boardId]
    writeConfig(this.workspaceRoot, config)
    this.emitEvent('board.deleted', { id: boardId })
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
    return getBoardConfig(this.workspaceRoot, boardId)
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
    const config = readConfig(this.workspaceRoot)
    const board = config.boards[boardId]
    if (!board) {
      throw new Error(`Board not found: ${boardId}`)
    }

    if (updates.name !== undefined) board.name = updates.name
    if (updates.description !== undefined) board.description = updates.description
    if (updates.columns !== undefined) board.columns = updates.columns
    if (updates.defaultStatus !== undefined) board.defaultStatus = updates.defaultStatus
    if (updates.defaultPriority !== undefined) board.defaultPriority = updates.defaultPriority

    writeConfig(this.workspaceRoot, config)
    this.emitEvent('board.updated', { id: boardId, ...board })
    return board
  }

  /**
   * Returns the named actions defined on a board.
   *
   * @param boardId - Board ID. Defaults to the active board when omitted.
   * @returns A map of action key to display title.
   * @throws {Error} If the board does not exist.
   */
  getBoardActions(boardId?: string): Record<string, string> {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    return board.actions ?? {}
  }

  /**
   * Adds or updates a named action on a board.
   *
   * @param boardId - Board ID.
   * @param key - Unique action key (used as identifier).
   * @param title - Human-readable display title for the action.
   * @returns The updated actions map.
   * @throws {Error} If the board does not exist.
   */
  addBoardAction(boardId: string, key: string, title: string): Record<string, string> {
    const config = readConfig(this.workspaceRoot)
    const board = config.boards[boardId]
    if (!board) throw new Error(`Board not found: ${boardId}`)
    board.actions ??= {}
    board.actions[key] = title
    writeConfig(this.workspaceRoot, config)
    this.emitEvent('board.updated', { id: boardId, ...board })
    return board.actions
  }

  /**
   * Removes a named action from a board.
   *
   * @param boardId - Board ID.
   * @param key - The action key to remove.
   * @returns The updated actions map.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the action key is not found on the board.
   */
  removeBoardAction(boardId: string, key: string): Record<string, string> {
    const config = readConfig(this.workspaceRoot)
    const board = config.boards[boardId]
    if (!board) throw new Error(`Board not found: ${boardId}`)
    if (!board.actions || !(key in board.actions)) {
      throw new Error(`Action "${key}" not found on board "${boardId}"`)
    }
    delete board.actions[key]
    if (Object.keys(board.actions).length === 0) delete board.actions
    writeConfig(this.workspaceRoot, config)
    this.emitEvent('board.updated', { id: boardId, ...board })
    return board.actions ?? {}
  }

  /**
   * Fires the `board.action` webhook event for a named board action.
   *
   * @param boardId - The board that owns the action.
   * @param actionKey - The key of the action to trigger.
   * @throws {Error} If the board does not exist.
   * @throws {Error} If the action key is not defined on the board.
   */
  async triggerBoardAction(boardId: string, actionKey: string): Promise<void> {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    const actions = board.actions ?? {}
    if (!(actionKey in actions)) {
      throw new Error(`Action "${actionKey}" not defined on board "${resolvedId}"`)
    }
    const actionTitle = actions[actionKey]
    this.emitEvent('board.action', { boardId: resolvedId, action: actionKey, title: actionTitle })
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
    const toBoardDir = this._boardDir(toBoardId)

    const config = readConfig(this.workspaceRoot)
    if (!config.boards[fromBoardId]) throw new Error(`Board not found: ${fromBoardId}`)
    if (!config.boards[toBoardId]) throw new Error(`Board not found: ${toBoardId}`)

    // Find card in source board
    const card = await this.getCard(cardId, fromBoardId)
    if (!card) throw new Error(`Card not found: ${cardId} in board ${fromBoardId}`)
    const previousStatus = card.status

    // Determine target status
    const toBoard = config.boards[toBoardId]
    const newStatus = targetStatus || toBoard.defaultStatus || toBoard.columns[0]?.id || 'backlog'

    // Ensure target directory exists (no-op for SQLite)
    await this._storage.ensureBoardDirs(toBoardDir, [newStatus])

    // Capture source attachment directory before mutating the card
    const srcAttachDir = this._storage.getCardDir(card)

    // Remove card from source board storage
    await this._storage.deleteCard(card)

    // Update card metadata
    card.status = newStatus
    card.boardId = toBoardId
    card.modified = new Date().toISOString()
    card.completedAt = this._isCompletedStatus(newStatus, toBoardId) ? new Date().toISOString() : null

    // Update filePath for markdown engine
    if (this._storage.type === 'markdown') {
      card.filePath = path.join(toBoardDir, newStatus, path.basename(card.filePath))
    } else {
      card.filePath = ''
    }

    // Recompute order for target column
    const targetCards = await this.listCards(undefined, toBoardId)
    const cardsInStatus = targetCards
      .filter(c => c.status === newStatus && c.id !== cardId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = cardsInStatus.length > 0 ? cardsInStatus[cardsInStatus.length - 1].order : null
    card.order = generateKeyBetween(lastOrder, null)

    await this._storage.writeCard(card)

    // Move attachment files (including auto-attached log) to the new location
    if (card.attachments.length > 0) {
      const dstAttachDir = this._storage.getCardDir(card)
      if (srcAttachDir !== dstAttachDir) {
        await fs.mkdir(dstAttachDir, { recursive: true })
        await Promise.all(
          card.attachments.map(async (filename) => {
            const src = path.join(srcAttachDir, filename)
            const dst = path.join(dstAttachDir, filename)
            await fs.rename(src, dst).catch(() => {})
          })
        )
      }
    }

    this.emitEvent('task.moved', { ...sanitizeCard(card), previousStatus, fromBoard: fromBoardId, toBoard: toBoardId })
    if (previousStatus !== newStatus) {
      await this.addLog(card.id, `Status changed: \`${previousStatus}\` → \`${newStatus}\``, { source: 'system' }, toBoardId).catch(() => {})
    }
    return card
  }

  // --- Card CRUD ---

  /**
   * Lists all cards on a board, optionally filtered by column/status.
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
   * @param columns - Optional array of status/column IDs to filter by.
   *   When provided, ensures those subdirectories exist on disk.
   * @param boardId - Optional board ID. Defaults to the workspace's default board.
   * @param metaFilter - Optional map of dot-notation metadata paths to required substrings.
   *   Only cards whose metadata contains all specified values (case-insensitive substring match)
   *   are returned.
   * @param sort - Optional sort order. One of `'created:asc'`, `'created:desc'`,
   *   `'modified:asc'`, `'modified:desc'`. Defaults to fractional board order.
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
   * // List cards where metadata.sprint contains 'Q1' and metadata.links.jira contains 'PROJ'
   * const q1Jira = await sdk.listCards(undefined, undefined, { 'sprint': 'Q1', 'links.jira': 'PROJ' })
   *
   * // List all cards sorted by creation date, newest first
   * const newest = await sdk.listCards(undefined, undefined, undefined, 'created:desc')
   * ```
   */
  async listCards(columns?: string[], boardId?: string, metaFilter?: Record<string, string>, sort?: CardSortOption): Promise<Card[]> {
    await this._ensureMigrated()
    const boardDir = this._boardDir(boardId)
    const resolvedBoardId = this._resolveBoardId(boardId)

    await this._storage.ensureBoardDirs(boardDir, columns)

    // Load all cards from the storage engine
    const cards = await this._storage.scanCards(boardDir, resolvedBoardId)

    // Migrate legacy integer order values to fractional indices
    const hasLegacyOrder = cards.some(c => /^\d+$/.test(c.order))
    if (hasLegacyOrder) {
      const byStatus = new Map<string, Card[]>()
      for (const c of cards) {
        const list = byStatus.get(c.status) || []
        list.push(c)
        byStatus.set(c.status, list)
      }
      for (const columnCards of byStatus.values()) {
        columnCards.sort((a, b) => parseInt(a.order) - parseInt(b.order))
        const keys = generateNKeysBetween(null, null, columnCards.length)
        for (let i = 0; i < columnCards.length; i++) {
          columnCards[i].order = keys[i]
          await this._storage.writeCard(columnCards[i])
        }
      }
    }

    // Sync ID counter with existing cards
    const numericIds = cards
      .map(c => parseInt(c.id, 10))
      .filter(n => !Number.isNaN(n))
    if (numericIds.length > 0) {
      syncCardIdCounter(this.workspaceRoot, resolvedBoardId, numericIds)
    }

    const filtered = metaFilter && Object.keys(metaFilter).length > 0
      ? cards.filter(c => matchesMetaFilter(c.metadata, metaFilter))
      : cards
    if (sort) {
      const [field, dir] = sort.split(':')
      return filtered.sort((a, b) => {
        const aVal = field === 'created' ? a.created : a.modified
        const bVal = field === 'created' ? b.created : b.modified
        return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      })
    }
    return filtered.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
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
    const cards = await this.listCards(undefined, boardId)
    return cards.find(c => c.id === cardId) || null
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
    await this._ensureMigrated()
    const resolvedBoardId = this._resolveBoardId(data.boardId)
    const boardDir = this._boardDir(resolvedBoardId)
    await this._storage.ensureBoardDirs(boardDir)

    const config = readConfig(this.workspaceRoot)
    const board = config.boards[resolvedBoardId]

    const status = data.status || board?.defaultStatus || config.defaultStatus || 'backlog'
    const priority = data.priority || board?.defaultPriority || config.defaultPriority || 'medium'
    const title = getTitleFromContent(data.content)
    const numericId = allocateCardId(this.workspaceRoot, resolvedBoardId)
    const filename = generateCardFilename(numericId, title)
    const now = new Date().toISOString()

    // Compute order: place at end of target column
    const cards = await this.listCards(undefined, resolvedBoardId)
    const cardsInStatus = cards
      .filter(c => c.status === status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = cardsInStatus.length > 0
      ? cardsInStatus[cardsInStatus.length - 1].order
      : null

    const card: Card = {
      version: CARD_FORMAT_VERSION,
      id: String(numericId),
      boardId: resolvedBoardId,
      status,
      priority,
      assignee: data.assignee ?? null,
      dueDate: data.dueDate ?? null,
      created: now,
      modified: now,
      completedAt: this._isCompletedStatus(status, resolvedBoardId) ? now : null,
      labels: data.labels || [],
      attachments: data.attachments || [],
      comments: [],
      order: generateKeyBetween(lastOrder, null),
      content: data.content,
      ...(data.metadata && Object.keys(data.metadata).length > 0 ? { metadata: data.metadata } : {}),
      ...(data.actions && (Array.isArray(data.actions) ? data.actions.length > 0 : Object.keys(data.actions).length > 0) ? { actions: data.actions } : {}),
      filePath: this._storage.type === 'markdown'
        ? getCardFilePath(boardDir, status, filename)
        : ''
    }

    await this._storage.writeCard(card)

    this.emitEvent('task.created', sanitizeCard(card))
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const resolvedBoardId = card.boardId || this._resolveBoardId(boardId)
    const boardDir = this._boardDir(resolvedBoardId)
    const oldStatus = card.status
    const oldTitle = getTitleFromContent(card.content)

    // Merge updates (exclude filePath/id/boardId from being overwritten)
    const { filePath: _fp, id: _id, boardId: _bid, ...safeUpdates } = updates
    Object.assign(card, safeUpdates)
    card.modified = new Date().toISOString()

    if (oldStatus !== card.status) {
      card.completedAt = this._isCompletedStatus(card.status, resolvedBoardId) ? new Date().toISOString() : null
    }

    // Write updated content
    await this._storage.writeCard(card)

    // Rename file if title changed (numeric-ID cards, markdown engine only)
    const newTitle = getTitleFromContent(card.content)
    const numericId = extractNumericId(card.id)
    if (numericId !== null && newTitle !== oldTitle) {
      const newFilename = generateCardFilename(numericId, newTitle)
      const newPath = await this._storage.renameCard(card, newFilename)
      if (newPath) card.filePath = newPath
    }

    // Move card if status changed
    if (oldStatus !== card.status) {
      const newPath = await this._storage.moveCard(card, boardDir, card.status)
      if (newPath) card.filePath = newPath
    }

    this.emitEvent('task.updated', sanitizeCard(card))
    if (oldStatus !== card.status) {
      await this.addLog(card.id, `Status changed: \`${oldStatus}\` → \`${card.status}\``, { source: 'system' }, resolvedBoardId).catch(() => {})
    }
    return card
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
    const config = readConfig(this.workspaceRoot)
    const { actionWebhookUrl } = config
    if (!actionWebhookUrl) {
      throw new Error('No action webhook URL configured. Set actionWebhookUrl in .kanban.json')
    }

    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const resolvedBoardId = card.boardId || this._resolveBoardId(boardId)

    const payload = {
      action,
      board: resolvedBoardId,
      list: card.status,
      card: sanitizeCard(card),
    }

    const response = await fetch(actionWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Action webhook responded with ${response.status}: ${response.statusText}`)
    }
    await this.addLog(cardId, `Action triggered: \`${action}\``, { source: 'system' }, resolvedBoardId).catch(() => {})
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
    const cards = await this.listCards(undefined, boardId)
    const card = cards.find(c => c.id === cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const resolvedBoardId = card.boardId || this._resolveBoardId(boardId)
    const boardDir = this._boardDir(resolvedBoardId)
    const oldStatus = card.status
    card.status = newStatus
    card.modified = new Date().toISOString()

    if (oldStatus !== newStatus) {
      card.completedAt = this._isCompletedStatus(newStatus, resolvedBoardId) ? new Date().toISOString() : null
    }

    // Compute new fractional order
    const targetColumnCards = cards
      .filter(c => c.status === newStatus && c.id !== cardId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

    const pos = position !== undefined
      ? Math.max(0, Math.min(position, targetColumnCards.length))
      : targetColumnCards.length
    const before = pos > 0 ? targetColumnCards[pos - 1].order : null
    const after = pos < targetColumnCards.length ? targetColumnCards[pos].order : null
    card.order = generateKeyBetween(before, after)

    // Write updated content (order + timestamps)
    await this._storage.writeCard(card)

    // Move to new status directory (no-op for SQLite)
    if (oldStatus !== newStatus) {
      const newPath = await this._storage.moveCard(card, boardDir, newStatus)
      if (newPath) card.filePath = newPath
    }

    this.emitEvent('task.moved', { ...sanitizeCard(card), previousStatus: oldStatus })
    if (oldStatus !== newStatus) {
      await this.addLog(card.id, `Status changed: \`${oldStatus}\` → \`${newStatus}\``, { source: 'system' }, resolvedBoardId).catch(() => {})
    }
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    if (card.status === DELETED_STATUS_ID) return
    await this.updateCard(cardId, { status: DELETED_STATUS_ID }, boardId)
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    const snapshot = sanitizeCard(card)
    await this._storage.deleteCard(card)
    this.emitEvent('task.deleted', snapshot)
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
    const cards = await this.listCards(undefined, boardId)
    return cards.filter(c => c.status === status)
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
    const cards = await this.listCards(undefined, boardId)
    const assignees = new Set<string>()
    for (const c of cards) {
      if (c.assignee) assignees.add(c.assignee)
    }
    return [...assignees].sort()
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
    const cards = await this.listCards(undefined, boardId)
    const labels = new Set<string>()
    for (const c of cards) {
      for (const l of c.labels) labels.add(l)
    }
    return [...labels].sort()
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
    const config = readConfig(this.workspaceRoot)
    return config.labels || {}
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
    const config = readConfig(this.workspaceRoot)
    if (!config.labels) config.labels = {}
    config.labels[name] = definition
    writeConfig(this.workspaceRoot, config)
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
    const config = readConfig(this.workspaceRoot)
    if (config.labels) {
      delete config.labels[name]
      writeConfig(this.workspaceRoot, config)
    }

    // Cascade to all cards
    const cards = await this.listCards()
    for (const card of cards) {
      if (card.labels.includes(name)) {
        await this.updateCard(card.id, { labels: card.labels.filter(l => l !== name) })
      }
    }
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
    const config = readConfig(this.workspaceRoot)
    if (config.labels && config.labels[oldName]) {
      config.labels[newName] = config.labels[oldName]
      delete config.labels[oldName]
      writeConfig(this.workspaceRoot, config)
    }

    // Cascade to all cards
    const cards = await this.listCards()
    for (const card of cards) {
      if (card.labels.includes(oldName)) {
        const newLabels = card.labels.map(l => l === oldName ? newName : l)
        await this.updateCard(card.id, { labels: newLabels })
      }
    }
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
    const labels = this.getLabels()
    return Object.entries(labels)
      .filter(([, def]) => def.group === group)
      .map(([name]) => name)
      .sort()
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
    const groupLabels = this.getLabelsInGroup(group)
    if (groupLabels.length === 0) return []
    const cards = await this.listCards(undefined, boardId)
    return cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const fileName = path.basename(sourcePath)

    // Copy file into the card's attachment directory
    await this._storage.copyAttachment(sourcePath, card)

    // Add to attachments if not already present
    if (!card.attachments.includes(fileName)) {
      card.attachments.push(fileName)
    }

    card.modified = new Date().toISOString()
    await this._storage.writeCard(card)

    this.emitEvent('attachment.added', { cardId, attachment: fileName })
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    card.attachments = card.attachments.filter(a => a !== attachment)
    card.modified = new Date().toISOString()
    await this._storage.writeCard(card)

    this.emitEvent('attachment.removed', { cardId, attachment })
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return card.attachments
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
    const card = await this.getCard(cardId, boardId)
    if (!card) return null
    return this._storage.getCardDir(card)
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return card.comments || []
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
    if (!content?.trim()) throw new Error('Comment content cannot be empty')
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    if (!card.comments) card.comments = []

    // Generate next comment ID
    const maxId = card.comments.reduce((max, c) => {
      const num = parseInt(c.id.replace('c', ''), 10)
      return Number.isNaN(num) ? max : Math.max(max, num)
    }, 0)

    const comment: Comment = {
      id: `c${maxId + 1}`,
      author,
      created: new Date().toISOString(),
      content
    }

    card.comments.push(comment)
    card.modified = new Date().toISOString()
    await this._storage.writeCard(card)

    this.emitEvent('comment.created', { ...comment, cardId })
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const comment = (card.comments || []).find(c => c.id === commentId)
    if (!comment) throw new Error(`Comment not found: ${commentId}`)

    comment.content = content
    card.modified = new Date().toISOString()
    await this._storage.writeCard(card)

    this.emitEvent('comment.updated', { ...comment, cardId })
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const comment = (card.comments || []).find(c => c.id === commentId)
    card.comments = (card.comments || []).filter(c => c.id !== commentId)
    card.modified = new Date().toISOString()
    await this._storage.writeCard(card)

    if (comment) {
      this.emitEvent('comment.deleted', { ...comment, cardId })
    }
    return card
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
    const card = await this.getCard(cardId, boardId)
    if (!card) return null
    const dir = this._storage.getCardDir(card)
    return path.join(dir, `${card.id}.log`)
  }

  /**
   * Parses a single log line into a {@link LogEntry}.
   *
   * Expected format: `timestamp [source] text {json}`
   */
  private _parseLogLine(line: string): LogEntry | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    const match = trimmed.match(/^(\S+)\s+\[([^\]]+)\]\s+(.+)$/)
    if (!match) return null
    const [, timestamp, source, rest] = match
    // Try to extract trailing JSON object
    const jsonMatch = rest.match(/^(.*?)\s+(\{.+\})\s*$/)
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[2])
        return { timestamp, source, text: jsonMatch[1], object: obj }
      } catch {
        // Not valid JSON, treat entire rest as text
      }
    }
    return { timestamp, source, text: rest }
  }

  /**
   * Serializes a {@link LogEntry} into a single log line.
   */
  private _serializeLogEntry(entry: LogEntry): string {
    let line = `${entry.timestamp} [${entry.source}] ${entry.text}`
    if (entry.object && Object.keys(entry.object).length > 0) {
      line += ` ${JSON.stringify(entry.object)}`
    }
    return line
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
    const logPath = await this.getLogFilePath(cardId, boardId)
    if (!logPath) throw new Error(`Card not found: ${cardId}`)
    try {
      const content = await fs.readFile(logPath, 'utf-8')
      const entries: LogEntry[] = []
      for (const line of content.split('\n')) {
        const entry = this._parseLogLine(line)
        if (entry) entries.push(entry)
      }
      return entries
    } catch {
      return []
    }
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
    options?: { source?: string; timestamp?: string; object?: Record<string, any> },
    boardId?: string
  ): Promise<LogEntry> {
    if (!text?.trim()) throw new Error('Log text cannot be empty')
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const entry: LogEntry = {
      timestamp: options?.timestamp || new Date().toISOString(),
      source: options?.source || 'default',
      text: text.trim(),
      ...(options?.object && Object.keys(options.object).length > 0 ? { object: options.object } : {}),
    }

    const dir = this._storage.getCardDir(card)
    const logFileName = `${card.id}.log`
    const logPath = path.join(dir, logFileName)

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true })

    // Append entry line
    const line = this._serializeLogEntry(entry) + '\n'
    await fs.appendFile(logPath, line, 'utf-8')

    // Auto-add log file as attachment if not already present
    if (!card.attachments.includes(logFileName)) {
      card.attachments.push(logFileName)
      card.modified = new Date().toISOString()
      await this._storage.writeCard(card)
    }

    this.emitEvent('log.added', { cardId, entry })
    return entry
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
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const logFileName = `${card.id}.log`
    const dir = this._storage.getCardDir(card)
    const logPath = path.join(dir, logFileName)

    // Delete the file
    try {
      await fs.unlink(logPath)
    } catch {
      // File may not exist — that's fine
    }

    // Remove from attachments
    if (card.attachments.includes(logFileName)) {
      card.attachments = card.attachments.filter(a => a !== logFileName)
      card.modified = new Date().toISOString()
      await this._storage.writeCard(card)
    }

    this.emitEvent('log.cleared', { cardId })
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
    return path.join(this._boardDir(boardId), 'board.log')
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
    const logPath = this.getBoardLogFilePath(boardId)
    let content: string
    try {
      content = await fs.readFile(logPath, 'utf-8')
    } catch {
      return []
    }
    const entries: LogEntry[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const entry = this._parseLogLine(trimmed)
      if (entry) entries.push(entry)
    }
    return entries
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
    const entry: LogEntry = {
      timestamp: options?.timestamp ?? new Date().toISOString(),
      source: options?.source ?? 'sdk',
      text,
      ...(options?.object ? { object: options.object } : {}),
    }
    const logPath = this.getBoardLogFilePath(boardId)
    // Ensure board directory exists
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    const line = this._serializeLogEntry(entry) + '\n'
    await fs.appendFile(logPath, line, 'utf-8')
    this.emitEvent('board.log.added', { boardId, entry })
    return entry
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
    const logPath = this.getBoardLogFilePath(boardId)
    try {
      await fs.unlink(logPath)
    } catch {
      // File may not exist — that's fine
    }
    this.emitEvent('board.log.cleared', { boardId })
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
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    return board?.columns || []
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
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    if (column.id === DELETED_STATUS_ID) throw new Error(`"${DELETED_STATUS_ID}" is a reserved column ID`)
    if (board.columns.some(c => c.id === column.id)) {
      throw new Error(`Column already exists: ${column.id}`)
    }
    board.columns.push(column)
    writeConfig(this.workspaceRoot, config)
    this.emitEvent('column.created', column)
    return board.columns
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
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    const col = board.columns.find(c => c.id === columnId)
    if (!col) throw new Error(`Column not found: ${columnId}`)
    if (updates.name !== undefined) col.name = updates.name
    if (updates.color !== undefined) col.color = updates.color
    writeConfig(this.workspaceRoot, config)
    this.emitEvent('column.updated', col)
    return board.columns
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
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    if (columnId === DELETED_STATUS_ID) throw new Error(`Cannot remove the reserved "${DELETED_STATUS_ID}" column`)
    const idx = board.columns.findIndex(c => c.id === columnId)
    if (idx === -1) throw new Error(`Column not found: ${columnId}`)

    // Check if any cards use this column
    const cards = await this.listCards(undefined, resolvedId)
    const cardsInColumn = cards.filter(c => c.status === columnId)
    if (cardsInColumn.length > 0) {
      throw new Error(`Cannot remove column "${columnId}": ${cardsInColumn.length} card(s) still in this column`)
    }

    const removed = board.columns[idx]
    board.columns.splice(idx, 1)
    writeConfig(this.workspaceRoot, config)
    this.emitEvent('column.deleted', removed)
    return board.columns
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
    if (columnId === DELETED_STATUS_ID) return 0
    const cards = await this.listCards(undefined, boardId)
    const cardsToMove = cards.filter(c => c.status === columnId)
    for (const card of cardsToMove) {
      await this.moveCard(card.id, DELETED_STATUS_ID, 0, boardId)
    }
    return cardsToMove.length
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
    const cards = await this.listCards(undefined, boardId)
    const deleted = cards.filter(c => c.status === DELETED_STATUS_ID)
    for (const card of deleted) {
      await this.permanentlyDeleteCard(card.id, boardId)
    }
    return deleted.length
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
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    const colMap = new Map(board.columns.map(c => [c.id, c]))

    // Validate all IDs exist
    for (const id of columnIds) {
      if (!colMap.has(id)) throw new Error(`Column not found: ${id}`)
    }
    if (columnIds.length !== board.columns.length) {
      throw new Error('Must include all column IDs when reordering')
    }

    board.columns = columnIds.map(id => colMap.get(id) as KanbanColumn)
    writeConfig(this.workspaceRoot, config)
    return board.columns
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
    return configToSettings(readConfig(this.workspaceRoot))
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
    const config = readConfig(this.workspaceRoot)
    writeConfig(this.workspaceRoot, settingsToConfig(config, settings))
    this.emitEvent('settings.updated', settings)
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
    if (this._storage.type === 'sqlite') {
      throw new Error('Storage engine is already sqlite')
    }
    await this._ensureMigrated()

    const resolvedDbPath = dbPath ?? '.kanban/kanban.db'
    const absDbPath = path.resolve(this.workspaceRoot, resolvedDbPath)

    const { SqliteStorageEngine } = await import('./storage/sqlite')
    const sqliteEngine = new SqliteStorageEngine(this._storage.kanbanDir, absDbPath)
    await sqliteEngine.init()

    const config = readConfig(this.workspaceRoot)
    const boardIds = Object.keys(config.boards)

    let count = 0
    for (const boardId of boardIds) {
      const boardDir = path.join(this._storage.kanbanDir, 'boards', boardId)
      const cards = await this._storage.scanCards(boardDir, boardId)
      for (const card of cards) {
        await sqliteEngine.writeCard({ ...card, filePath: '' })
        count++
      }
    }

    sqliteEngine.close()

    writeConfig(this.workspaceRoot, { ...config, storageEngine: 'sqlite', sqlitePath: resolvedDbPath })
    this.emitEvent('storage.migrated', { from: 'markdown', to: 'sqlite', count })
    return count
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
    if (this._storage.type === 'markdown') {
      throw new Error('Storage engine is already markdown')
    }
    await this._ensureMigrated()

    const { MarkdownStorageEngine } = await import('./storage/markdown')
    const mdEngine = new MarkdownStorageEngine(this._storage.kanbanDir)
    await mdEngine.init()

    const config = readConfig(this.workspaceRoot)
    const boardIds = Object.keys(config.boards)

    let count = 0
    for (const boardId of boardIds) {
      const boardDir = path.join(this._storage.kanbanDir, 'boards', boardId)
      const cards = await this._storage.scanCards(boardDir, boardId)
      for (const card of cards) {
        const numericId = Number(card.id) || 0
        const title = getTitleFromContent(card.content) || card.id
        const filename = generateCardFilename(numericId, title)
        const filePath = getCardFilePath(boardDir, card.status, filename)
        await mdEngine.writeCard({ ...card, filePath })
        count++
      }
    }

    mdEngine.close()

    const { storageEngine: _se, sqlitePath: _sp, ...restConfig } = config as typeof config & { storageEngine?: string; sqlitePath?: string }
    writeConfig(this.workspaceRoot, restConfig as typeof config)
    this.emitEvent('storage.migrated', { from: 'sqlite', to: 'markdown', count })
    return count
  }

}

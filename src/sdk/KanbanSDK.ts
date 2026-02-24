import * as fs from 'fs/promises'
import * as path from 'path'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Comment, Feature, KanbanColumn, BoardInfo } from '../shared/types'
import { getTitleFromContent, generateFeatureFilename, extractNumericId } from '../shared/types'
import { readConfig, writeConfig, configToSettings, settingsToConfig, allocateCardId, syncCardIdCounter, getBoardConfig } from '../shared/config'
import type { BoardConfig } from '../shared/config'
import type { CardDisplaySettings } from '../shared/types'
import type { Priority } from '../shared/types'
import { parseFeatureFile, serializeFeature } from './parser'
import { ensureDirectories, ensureStatusSubfolders, getFeatureFilePath, getStatusFromPath, moveFeatureFile, renameFeatureFile } from './fileUtils'
import type { CreateCardInput } from './types'
import { migrateFileSystemToMultiBoard } from './migration'

export class KanbanSDK {
  private _migrated = false

  constructor(public readonly featuresDir: string) {}

  get workspaceRoot(): string {
    return path.dirname(this.featuresDir)
  }

  // --- Board resolution helpers ---

  private _resolveBoardId(boardId?: string): string {
    const config = readConfig(this.workspaceRoot)
    return boardId || config.defaultBoard
  }

  private _boardDir(boardId?: string): string {
    const resolvedId = this._resolveBoardId(boardId)
    return path.join(this.featuresDir, 'boards', resolvedId)
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
    await migrateFileSystemToMultiBoard(this.featuresDir)
    this._migrated = true
  }

  async init(): Promise<void> {
    await this._ensureMigrated()
    const boardDir = this._boardDir()
    await ensureDirectories(boardDir)
  }

  // --- Board management ---

  listBoards(): BoardInfo[] {
    const config = readConfig(this.workspaceRoot)
    return Object.entries(config.boards).map(([id, board]) => ({
      id,
      name: board.name,
      description: board.description,
      columns: board.columns
    }))
  }

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

    return { id, name, description: options?.description }
  }

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

    // Remove board directory
    const boardDir = this._boardDir(boardId)
    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // Directory might not exist
    }

    delete config.boards[boardId]
    writeConfig(this.workspaceRoot, config)
  }

  getBoard(boardId: string): BoardConfig {
    return getBoardConfig(this.workspaceRoot, boardId)
  }

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
    return board
  }

  async transferCard(cardId: string, fromBoardId: string, toBoardId: string, targetStatus?: string): Promise<Feature> {
    const toBoardDir = this._boardDir(toBoardId)

    const config = readConfig(this.workspaceRoot)
    if (!config.boards[fromBoardId]) throw new Error(`Board not found: ${fromBoardId}`)
    if (!config.boards[toBoardId]) throw new Error(`Board not found: ${toBoardId}`)

    // Find card in source board
    const card = await this.getCard(cardId, fromBoardId)
    if (!card) throw new Error(`Card not found: ${cardId} in board ${fromBoardId}`)

    // Determine target status
    const toBoard = config.boards[toBoardId]
    const newStatus = targetStatus || toBoard.defaultStatus || toBoard.columns[0]?.id || 'backlog'

    // Ensure target directory exists
    const targetDir = path.join(toBoardDir, newStatus)
    await fs.mkdir(targetDir, { recursive: true })

    // Move file
    const oldPath = card.filePath
    const filename = path.basename(oldPath)
    const newPath = path.join(targetDir, filename)
    await fs.rename(oldPath, newPath)

    // Update card metadata
    card.status = newStatus
    card.boardId = toBoardId
    card.filePath = newPath
    card.modified = new Date().toISOString()
    card.completedAt = this._isCompletedStatus(newStatus, toBoardId) ? new Date().toISOString() : null

    // Recompute order for target column
    const targetCards = await this.listCards(undefined, toBoardId)
    const cardsInStatus = targetCards
      .filter(c => c.status === newStatus && c.id !== cardId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = cardsInStatus.length > 0 ? cardsInStatus[cardsInStatus.length - 1].order : null
    card.order = generateKeyBetween(lastOrder, null)

    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  // --- Card CRUD ---

  async listCards(columns?: string[], boardId?: string): Promise<Feature[]> {
    await this._ensureMigrated()
    const boardDir = this._boardDir(boardId)
    const resolvedBoardId = this._resolveBoardId(boardId)

    await ensureDirectories(boardDir)
    if (columns) {
      await ensureStatusSubfolders(boardDir, columns)
    }

    // Phase 1: Migrate flat root .md files into their status subfolder
    try {
      const rootFiles = await this._readMdFiles(boardDir)
      for (const filePath of rootFiles) {
        try {
          const card = await this._loadCard(filePath)
          if (card) {
            await moveFeatureFile(filePath, boardDir, card.status, card.attachments)
          }
        } catch {
          // Skip files that fail to migrate
        }
      }
    } catch {
      // Skip
    }

    // Phase 2: Load .md files from ALL subdirectories
    const cards: Feature[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(boardDir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return []
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const subdir = path.join(boardDir, entry.name)
      try {
        const mdFiles = await this._readMdFiles(subdir)
        for (const filePath of mdFiles) {
          const card = await this._loadCard(filePath)
          if (card) {
            card.boardId = resolvedBoardId
            cards.push(card)
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }

    // Phase 3: Reconcile status ↔ folder mismatches
    for (const card of cards) {
      const pathStatus = getStatusFromPath(card.filePath, boardDir)
      if (pathStatus !== null && pathStatus !== card.status) {
        try {
          card.filePath = await moveFeatureFile(card.filePath, boardDir, card.status, card.attachments)
        } catch {
          // Will retry on next load
        }
      }
    }

    // Migrate legacy integer order values to fractional indices
    const hasLegacyOrder = cards.some(c => /^\d+$/.test(c.order))
    if (hasLegacyOrder) {
      const byStatus = new Map<string, Feature[]>()
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
          await fs.writeFile(columnCards[i].filePath, serializeFeature(columnCards[i]), 'utf-8')
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

    return cards.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  }

  async getCard(cardId: string, boardId?: string): Promise<Feature | null> {
    const cards = await this.listCards(undefined, boardId)
    return cards.find(c => c.id === cardId) || null
  }

  async createCard(data: CreateCardInput): Promise<Feature> {
    await this._ensureMigrated()
    const resolvedBoardId = this._resolveBoardId(data.boardId)
    const boardDir = this._boardDir(resolvedBoardId)
    await ensureDirectories(boardDir)

    const config = readConfig(this.workspaceRoot)
    const board = config.boards[resolvedBoardId]

    const status = data.status || board?.defaultStatus || config.defaultStatus || 'backlog'
    const priority = data.priority || board?.defaultPriority || config.defaultPriority || 'medium'
    const title = getTitleFromContent(data.content)
    const numericId = allocateCardId(this.workspaceRoot, resolvedBoardId)
    const filename = generateFeatureFilename(numericId, title)
    const now = new Date().toISOString()

    // Compute order: place at end of target column
    const cards = await this.listCards(undefined, resolvedBoardId)
    const cardsInStatus = cards
      .filter(c => c.status === status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = cardsInStatus.length > 0
      ? cardsInStatus[cardsInStatus.length - 1].order
      : null

    const card: Feature = {
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
      filePath: getFeatureFilePath(boardDir, status, filename)
    }

    await fs.mkdir(path.dirname(card.filePath), { recursive: true })
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async updateCard(cardId: string, updates: Partial<Feature>, boardId?: string): Promise<Feature> {
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
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    // Rename file if title changed (numeric-ID cards only)
    const newTitle = getTitleFromContent(card.content)
    const numericId = extractNumericId(card.id)
    if (numericId !== null && newTitle !== oldTitle) {
      const newFilename = generateFeatureFilename(numericId, newTitle)
      card.filePath = await renameFeatureFile(card.filePath, newFilename)
    }

    // Move file if status changed
    if (oldStatus !== card.status) {
      const newPath = await moveFeatureFile(card.filePath, boardDir, card.status, card.attachments)
      card.filePath = newPath
    }

    return card
  }

  async moveCard(cardId: string, newStatus: string, position?: number, boardId?: string): Promise<Feature> {
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

    // Write updated content
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    // Move file if status changed
    if (oldStatus !== newStatus) {
      const newPath = await moveFeatureFile(card.filePath, boardDir, newStatus, card.attachments)
      card.filePath = newPath
    }

    return card
  }

  async deleteCard(cardId: string, boardId?: string): Promise<void> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    await fs.unlink(card.filePath)
  }

  async getCardsByStatus(status: string, boardId?: string): Promise<Feature[]> {
    const cards = await this.listCards(undefined, boardId)
    return cards.filter(c => c.status === status)
  }

  async getUniqueAssignees(boardId?: string): Promise<string[]> {
    const cards = await this.listCards(undefined, boardId)
    const assignees = new Set<string>()
    for (const c of cards) {
      if (c.assignee) assignees.add(c.assignee)
    }
    return [...assignees].sort()
  }

  async getUniqueLabels(boardId?: string): Promise<string[]> {
    const cards = await this.listCards(undefined, boardId)
    const labels = new Set<string>()
    for (const c of cards) {
      for (const l of c.labels) labels.add(l)
    }
    return [...labels].sort()
  }

  // --- Attachment management ---

  async addAttachment(cardId: string, sourcePath: string, boardId?: string): Promise<Feature> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const fileName = path.basename(sourcePath)
    const cardDir = path.dirname(card.filePath)
    const destPath = path.join(cardDir, fileName)

    // Copy file if it's not already in the card's directory
    const sourceDir = path.dirname(path.resolve(sourcePath))
    if (sourceDir !== cardDir) {
      await fs.copyFile(path.resolve(sourcePath), destPath)
    }

    // Add to attachments if not already present
    if (!card.attachments.includes(fileName)) {
      card.attachments.push(fileName)
    }

    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Feature> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    card.attachments = card.attachments.filter(a => a !== attachment)
    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async listAttachments(cardId: string, boardId?: string): Promise<string[]> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return card.attachments
  }

  // --- Comment management ---

  async listComments(cardId: string, boardId?: string): Promise<Comment[]> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return card.comments || []
  }

  async addComment(cardId: string, author: string, content: string, boardId?: string): Promise<Feature> {
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
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<Feature> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const comment = (card.comments || []).find(c => c.id === commentId)
    if (!comment) throw new Error(`Comment not found: ${commentId}`)

    comment.content = content
    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async deleteComment(cardId: string, commentId: string, boardId?: string): Promise<Feature> {
    const card = await this.getCard(cardId, boardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    card.comments = (card.comments || []).filter(c => c.id !== commentId)
    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  // --- Column management (board-scoped) ---

  listColumns(boardId?: string): KanbanColumn[] {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    return board?.columns || []
  }

  addColumn(column: KanbanColumn, boardId?: string): KanbanColumn[] {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    if (board.columns.some(c => c.id === column.id)) {
      throw new Error(`Column already exists: ${column.id}`)
    }
    board.columns.push(column)
    writeConfig(this.workspaceRoot, config)
    return board.columns
  }

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
    return board.columns
  }

  async removeColumn(columnId: string, boardId?: string): Promise<KanbanColumn[]> {
    const config = readConfig(this.workspaceRoot)
    const resolvedId = boardId || config.defaultBoard
    const board = config.boards[resolvedId]
    if (!board) throw new Error(`Board not found: ${resolvedId}`)
    const idx = board.columns.findIndex(c => c.id === columnId)
    if (idx === -1) throw new Error(`Column not found: ${columnId}`)

    // Check if any cards use this column
    const cards = await this.listCards(undefined, resolvedId)
    const cardsInColumn = cards.filter(c => c.status === columnId)
    if (cardsInColumn.length > 0) {
      throw new Error(`Cannot remove column "${columnId}": ${cardsInColumn.length} card(s) still in this column`)
    }

    board.columns.splice(idx, 1)
    writeConfig(this.workspaceRoot, config)
    return board.columns
  }

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

  getSettings(): CardDisplaySettings {
    return configToSettings(readConfig(this.workspaceRoot))
  }

  updateSettings(settings: CardDisplaySettings): void {
    const config = readConfig(this.workspaceRoot)
    writeConfig(this.workspaceRoot, settingsToConfig(config, settings))
  }

  // --- Private helpers ---

  private async _readMdFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => path.join(dir, e.name))
  }

  private async _loadCard(filePath: string): Promise<Feature | null> {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseFeatureFile(content, filePath)
  }

}

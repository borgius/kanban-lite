import * as fs from 'fs/promises'
import * as path from 'path'
import { generateKeyBetween } from 'fractional-indexing'
import type { Comment, Feature, FeatureStatus, KanbanColumn } from '../shared/types'
import { getTitleFromContent, generateFeatureFilename, extractNumericId, DEFAULT_COLUMNS } from '../shared/types'
import { allocateCardId, syncCardIdCounter } from '../shared/config'
import { parseFeatureFile, serializeFeature } from './parser'
import { ensureDirectories, getFeatureFilePath, moveFeatureFile, renameFeatureFile } from './fileUtils'
import type { CreateCardInput, BoardConfig } from './types'

const BOARD_CONFIG_FILE = 'board.json'

export class KanbanSDK {
  constructor(public readonly featuresDir: string) {}

  async init(): Promise<void> {
    await ensureDirectories(this.featuresDir)
  }

  // --- Card CRUD ---

  async listCards(): Promise<Feature[]> {
    await ensureDirectories(this.featuresDir)
    const cards: Feature[] = []

    // Scan all subdirectories for .md files
    const entries = await fs.readdir(this.featuresDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const subdir = path.join(this.featuresDir, entry.name)
      try {
        const mdFiles = await this._readMdFiles(subdir)
        for (const filePath of mdFiles) {
          const card = await this._loadCard(filePath)
          if (card) cards.push(card)
        }
      } catch {
        // Skip unreadable directories
      }
    }

    // Also load any orphaned root-level .md files (backward compat)
    try {
      const rootFiles = await this._readMdFiles(this.featuresDir)
      for (const filePath of rootFiles) {
        const card = await this._loadCard(filePath)
        if (card) cards.push(card)
      }
    } catch {
      // Skip
    }

    // Sync ID counter with existing cards
    const numericIds = cards
      .map(c => parseInt(c.id, 10))
      .filter(n => !Number.isNaN(n))
    if (numericIds.length > 0) {
      syncCardIdCounter(path.dirname(this.featuresDir), numericIds)
    }

    return cards.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  }

  async getCard(cardId: string): Promise<Feature | null> {
    const cards = await this.listCards()
    return cards.find(c => c.id === cardId) || null
  }

  async createCard(data: CreateCardInput): Promise<Feature> {
    await ensureDirectories(this.featuresDir)

    const status = data.status || 'backlog'
    const priority = data.priority || 'medium'
    const title = getTitleFromContent(data.content)
    const workspaceRoot = path.dirname(this.featuresDir)
    const numericId = allocateCardId(workspaceRoot)
    const filename = generateFeatureFilename(numericId, title)
    const now = new Date().toISOString()

    // Compute order: place at end of target column
    const cards = await this.listCards()
    const cardsInStatus = cards
      .filter(c => c.status === status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const lastOrder = cardsInStatus.length > 0
      ? cardsInStatus[cardsInStatus.length - 1].order
      : null

    const card: Feature = {
      id: String(numericId),
      status,
      priority,
      assignee: data.assignee ?? null,
      dueDate: data.dueDate ?? null,
      created: now,
      modified: now,
      completedAt: status === 'done' ? now : null,
      labels: data.labels || [],
      attachments: data.attachments || [],
      comments: [],
      order: generateKeyBetween(lastOrder, null),
      content: data.content,
      filePath: getFeatureFilePath(this.featuresDir, status, filename)
    }

    await fs.mkdir(path.dirname(card.filePath), { recursive: true })
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async updateCard(cardId: string, updates: Partial<Feature>): Promise<Feature> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const oldStatus = card.status
    const oldTitle = getTitleFromContent(card.content)

    // Merge updates (exclude filePath/id from being overwritten)
    const { filePath: _fp, id: _id, ...safeUpdates } = updates
    Object.assign(card, safeUpdates)
    card.modified = new Date().toISOString()

    if (oldStatus !== card.status) {
      card.completedAt = card.status === 'done' ? new Date().toISOString() : null
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
      const newPath = await moveFeatureFile(card.filePath, this.featuresDir, card.status, card.attachments)
      card.filePath = newPath
    }

    return card
  }

  async moveCard(cardId: string, newStatus: FeatureStatus, position?: number): Promise<Feature> {
    const cards = await this.listCards()
    const card = cards.find(c => c.id === cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const oldStatus = card.status
    card.status = newStatus
    card.modified = new Date().toISOString()

    if (oldStatus !== newStatus) {
      card.completedAt = newStatus === 'done' ? new Date().toISOString() : null
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
      const newPath = await moveFeatureFile(card.filePath, this.featuresDir, newStatus, card.attachments)
      card.filePath = newPath
    }

    return card
  }

  async deleteCard(cardId: string): Promise<void> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    await fs.unlink(card.filePath)
  }

  async getCardsByStatus(status: FeatureStatus): Promise<Feature[]> {
    const cards = await this.listCards()
    return cards.filter(c => c.status === status)
  }

  async getUniqueAssignees(): Promise<string[]> {
    const cards = await this.listCards()
    const assignees = new Set<string>()
    for (const c of cards) {
      if (c.assignee) assignees.add(c.assignee)
    }
    return [...assignees].sort()
  }

  async getUniqueLabels(): Promise<string[]> {
    const cards = await this.listCards()
    const labels = new Set<string>()
    for (const c of cards) {
      for (const l of c.labels) labels.add(l)
    }
    return [...labels].sort()
  }

  // --- Attachment management ---

  async addAttachment(cardId: string, sourcePath: string): Promise<Feature> {
    const card = await this.getCard(cardId)
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

  async removeAttachment(cardId: string, attachment: string): Promise<Feature> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    card.attachments = card.attachments.filter(a => a !== attachment)
    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async listAttachments(cardId: string): Promise<string[]> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return card.attachments
  }

  // --- Comment management ---

  async listComments(cardId: string): Promise<Comment[]> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)
    return card.comments || []
  }

  async addComment(cardId: string, author: string, content: string): Promise<Feature> {
    const card = await this.getCard(cardId)
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

  async updateComment(cardId: string, commentId: string, content: string): Promise<Feature> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    const comment = (card.comments || []).find(c => c.id === commentId)
    if (!comment) throw new Error(`Comment not found: ${commentId}`)

    comment.content = content
    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  async deleteComment(cardId: string, commentId: string): Promise<Feature> {
    const card = await this.getCard(cardId)
    if (!card) throw new Error(`Card not found: ${cardId}`)

    card.comments = (card.comments || []).filter(c => c.id !== commentId)
    card.modified = new Date().toISOString()
    await fs.writeFile(card.filePath, serializeFeature(card), 'utf-8')

    return card
  }

  // --- Column management ---

  async listColumns(): Promise<KanbanColumn[]> {
    const config = await this._readBoardConfig()
    return config.columns
  }

  async addColumn(column: KanbanColumn): Promise<KanbanColumn[]> {
    const config = await this._readBoardConfig()
    if (config.columns.some(c => c.id === column.id)) {
      throw new Error(`Column already exists: ${column.id}`)
    }
    config.columns.push(column)
    await this._writeBoardConfig(config)
    return config.columns
  }

  async updateColumn(columnId: string, updates: Partial<Omit<KanbanColumn, 'id'>>): Promise<KanbanColumn[]> {
    const config = await this._readBoardConfig()
    const col = config.columns.find(c => c.id === columnId)
    if (!col) throw new Error(`Column not found: ${columnId}`)
    if (updates.name !== undefined) col.name = updates.name
    if (updates.color !== undefined) col.color = updates.color
    await this._writeBoardConfig(config)
    return config.columns
  }

  async removeColumn(columnId: string): Promise<KanbanColumn[]> {
    const config = await this._readBoardConfig()
    const idx = config.columns.findIndex(c => c.id === columnId)
    if (idx === -1) throw new Error(`Column not found: ${columnId}`)

    // Check if any cards use this column
    const cards = await this.listCards()
    const cardsInColumn = cards.filter(c => c.status === columnId)
    if (cardsInColumn.length > 0) {
      throw new Error(`Cannot remove column "${columnId}": ${cardsInColumn.length} card(s) still in this column`)
    }

    config.columns.splice(idx, 1)
    await this._writeBoardConfig(config)
    return config.columns
  }

  async reorderColumns(columnIds: string[]): Promise<KanbanColumn[]> {
    const config = await this._readBoardConfig()
    const colMap = new Map(config.columns.map(c => [c.id, c]))

    // Validate all IDs exist
    for (const id of columnIds) {
      if (!colMap.has(id)) throw new Error(`Column not found: ${id}`)
    }
    if (columnIds.length !== config.columns.length) {
      throw new Error('Must include all column IDs when reordering')
    }

    config.columns = columnIds.map(id => colMap.get(id) as KanbanColumn)
    await this._writeBoardConfig(config)
    return config.columns
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

  private _boardConfigPath(): string {
    return path.join(this.featuresDir, BOARD_CONFIG_FILE)
  }

  private async _readBoardConfig(): Promise<BoardConfig> {
    try {
      const raw = await fs.readFile(this._boardConfigPath(), 'utf-8')
      return JSON.parse(raw) as BoardConfig
    } catch {
      return { columns: [...DEFAULT_COLUMNS] }
    }
  }

  private async _writeBoardConfig(config: BoardConfig): Promise<void> {
    await ensureDirectories(this.featuresDir)
    await fs.writeFile(this._boardConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
  }
}

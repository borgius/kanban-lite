import type { BoardConfig, Webhook } from '../shared/config'
import type { CardDisplaySettings, KanbanColumn, BoardInfo, Priority } from '../shared/types'
import { DELETED_STATUS_ID } from '../shared/types'
import * as Boards from './modules/boards'
import * as Columns from './modules/columns'
import * as Settings from './modules/settings'
import * as Migration from './modules/migration'
import type { MethodInput } from './KanbanSDK-types'
import type { SDKContext } from './modules/context'
import { KanbanSDKCardState } from './KanbanSDK-card-state'

/**
 * Extends KanbanSDKCardState with init, board/column management, workspace
 * settings, and storage migration.
 */
export class KanbanSDKBoards extends KanbanSDKCardState {
  /** @internal */
  protected get _ctx(): SDKContext { return this as unknown as SDKContext }

  // --- Lifecycle init ---

  async init(): Promise<void> {
    await this._storage.init()
    this._migrated = true
    const boardDir = this._boardDir()
    await this._storage.ensureBoardDirs(boardDir, [DELETED_STATUS_ID])
  }

  // --- Board management ---

  listBoards(): BoardInfo[] {
    return Boards.listBoards(this._ctx)
  }

  async createBoard(id: string, name: string, options?: {
    description?: string
    columns?: KanbanColumn[]
    defaultStatus?: string
    defaultPriority?: Priority
  }): Promise<BoardInfo> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.createBoard>>('board.create', { id, name, options }, undefined, id)
    const board = Boards.createBoard(this._ctx, mergedInput)
    this._runAfterEvent('board.created', board, undefined, board.id)
    return board
  }

  async deleteBoard(boardId: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.deleteBoard>>('board.delete', { boardId }, undefined, boardId)
    await Boards.deleteBoard(this._ctx, mergedInput)
    this._runAfterEvent('board.deleted', { id: mergedInput.boardId }, undefined, mergedInput.boardId)
  }

  getBoard(boardId: string): BoardConfig {
    return Boards.getBoard(this._ctx, { boardId })
  }

  async updateBoard(boardId: string, updates: Partial<Omit<BoardConfig, 'nextCardId'>>): Promise<BoardConfig> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.updateBoard>>('board.update', { boardId, updates }, undefined, boardId)
    const board = Boards.updateBoard(this._ctx, mergedInput)
    this._runAfterEvent('board.updated', { id: mergedInput.boardId, ...board }, undefined, mergedInput.boardId)
    return board
  }

  // --- Board actions ---

  getBoardActions(boardId?: string): Record<string, string> {
    return Boards.getBoardActions(this._ctx, { boardId })
  }

  async addBoardAction(boardId: string, key: string, title: string): Promise<Record<string, string>> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.addBoardAction>>('board.action.config.add', { boardId, key, title }, undefined, boardId)
    const actions = Boards.addBoardAction(this._ctx, mergedInput)
    this._runAfterEvent('board.updated', { id: mergedInput.boardId, actions }, undefined, mergedInput.boardId)
    return actions
  }

  async removeBoardAction(boardId: string, key: string): Promise<Record<string, string>> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.removeBoardAction>>('board.action.config.remove', { boardId, key }, undefined, boardId)
    const actions = Boards.removeBoardAction(this._ctx, mergedInput)
    this._runAfterEvent('board.updated', { id: mergedInput.boardId, actions }, undefined, mergedInput.boardId)
    return actions
  }

  async triggerBoardAction(boardId: string, actionKey: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Boards.triggerBoardAction>>('board.action.trigger', { boardId, actionKey }, undefined, boardId)
    const actionData = await Boards.triggerBoardAction(this._ctx, mergedInput)
    this._runAfterEvent('board.action', actionData, undefined, actionData.boardId)
  }

  // --- Column management ---

  listColumns(boardId?: string): KanbanColumn[] {
    return Columns.listColumns(this._ctx, { boardId })
  }

  async addColumn(column: KanbanColumn, boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.addColumn>>('column.create', { column, boardId }, undefined, boardId)
    const columns = Columns.addColumn(this._ctx, mergedInput)
    const added = columns.find(c => c.id === mergedInput.column.id) ?? columns[columns.length - 1]
    if (added) this._runAfterEvent('column.created', added, undefined, this._resolveBoardId(mergedInput.boardId))
    return columns
  }

  async updateColumn(columnId: string, updates: Partial<Omit<KanbanColumn, 'id'>>, boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.updateColumn>>('column.update', { columnId, updates, boardId }, undefined, boardId)
    const columns = Columns.updateColumn(this._ctx, mergedInput)
    const updated = columns.find(c => c.id === mergedInput.columnId)
    if (updated) this._runAfterEvent('column.updated', updated, undefined, this._resolveBoardId(mergedInput.boardId))
    return columns
  }

  async removeColumn(columnId: string, boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.removeColumn>>('column.delete', { columnId, boardId }, undefined, boardId)
    const colSnapshot = Columns.listColumns(this._ctx, { boardId: mergedInput.boardId }).find(c => c.id === mergedInput.columnId)
    const columns = await Columns.removeColumn(this._ctx, mergedInput)
    if (colSnapshot) this._runAfterEvent('column.deleted', colSnapshot, undefined, this._resolveBoardId(mergedInput.boardId))
    return columns
  }

  async cleanupColumn(columnId: string, boardId?: string): Promise<number> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.cleanupColumn>>('column.cleanup', { columnId, boardId }, undefined, boardId)
    return Columns.cleanupColumn(this._ctx, mergedInput)
  }

  async purgeDeletedCards(boardId?: string): Promise<number> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.purgeDeletedCards>>('card.purgeDeleted', { boardId }, undefined, boardId)
    return Columns.purgeDeletedCards(this._ctx, mergedInput)
  }

  async reorderColumns(columnIds: string[], boardId?: string): Promise<KanbanColumn[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.reorderColumns>>('column.reorder', { columnIds, boardId }, undefined, boardId)
    return Columns.reorderColumns(this._ctx, mergedInput)
  }

  getMinimizedColumns(boardId?: string): string[] {
    return Columns.getMinimizedColumns(this._ctx, { boardId })
  }

  async setMinimizedColumns(columnIds: string[], boardId?: string): Promise<string[]> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Columns.setMinimizedColumns>>('column.setMinimized', { columnIds, boardId }, undefined, boardId)
    return Columns.setMinimizedColumns(this._ctx, mergedInput)
  }

  // --- Global settings ---

  getSettings(): CardDisplaySettings {
    return Settings.getSettings(this._ctx)
  }

  async updateSettings(settings: CardDisplaySettings): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Settings.updateSettings>>('settings.update', { settings })
    Settings.updateSettings(this._ctx, mergedInput)
    this._runAfterEvent('settings.updated', mergedInput.settings)
  }

  async setDefaultBoard(boardId: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Settings.setDefaultBoard>>('board.setDefault', { boardId }, undefined, boardId)
    Settings.setDefaultBoard(this._ctx, mergedInput)
  }

  // --- Storage migration ---

  async migrateToSqlite(dbPath?: string): Promise<number> {
    const from = this._capabilities?.providers['card.storage'].provider ?? this._storage.type
    const mergedInput = await this._runBeforeEvent<{ to: string; from: string; dbPath?: string }>('storage.migrate', { to: 'sqlite', from, dbPath })
    const count = await Migration.migrateToSqlite(this._ctx, { dbPath: mergedInput.dbPath })
    this._runAfterEvent('storage.migrated', { from, to: 'sqlite', count })
    return count
  }

  async migrateToMarkdown(): Promise<number> {
    const from = this._capabilities?.providers['card.storage'].provider ?? this._storage.type
    await this._runBeforeEvent<{ to: string; from: string }>('storage.migrate', { to: 'markdown', from })
    const count = await Migration.migrateToMarkdown(this._ctx)
    this._runAfterEvent('storage.migrated', { from, to: 'markdown', count })
    return count
  }

  // --- Webhooks ---

  listWebhooks(): Webhook[] {
    if (this._capabilities?.webhookProvider) {
      return this._capabilities.webhookProvider.listWebhooks(this.workspaceRoot)
    }
    throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
  }

  async createWebhook(webhookConfig: { url: string; events: string[]; secret?: string }): Promise<Webhook> {
    if (!this._capabilities?.webhookProvider) {
      throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
    }
    const mergedInput = await this._runBeforeEvent<{ url: string; events: string[]; secret?: string }>('webhook.create', { ...webhookConfig })
    return this._capabilities.webhookProvider.createWebhook(this.workspaceRoot, mergedInput)
  }

  async deleteWebhook(id: string): Promise<boolean> {
    if (!this._capabilities?.webhookProvider) {
      throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
    }
    const mergedInput = await this._runBeforeEvent<{ id: string }>('webhook.delete', { id })
    return this._capabilities.webhookProvider.deleteWebhook(this.workspaceRoot, mergedInput.id)
  }

  async updateWebhook(id: string, updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>): Promise<Webhook | null> {
    if (!this._capabilities?.webhookProvider) {
      throw new Error('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook')
    }
    const mergedInput = await this._runBeforeEvent<{ id: string; url?: string; events?: string[]; secret?: string; active?: boolean }>('webhook.update', { id, ...updates })
    const { id: resolvedId, ...resolvedUpdates } = mergedInput
    return this._capabilities.webhookProvider.updateWebhook(this.workspaceRoot, resolvedId, resolvedUpdates)
  }
}

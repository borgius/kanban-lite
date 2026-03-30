import { readConfig, writeConfig } from '../../shared/config'
import type { KanbanColumn } from '../../shared/types'
import { DELETED_STATUS_ID, generateSlug } from '../../shared/types'
import type { SDKContext } from './context'

// --- Column management ---

/**
 * Lists all columns defined for a board.
 */
export function listColumns(ctx: SDKContext, { boardId }: { boardId?: string } = {}): KanbanColumn[] {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  return board?.columns || []
}

/**
 * Adds a new column to a board.
 */
export function addColumn(ctx: SDKContext, { column, boardId }: { column: KanbanColumn; boardId?: string }): KanbanColumn[] {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  if (!column.id) {
    const base = generateSlug(column.name) || 'column'
    let uniqueId = base
    let counter = 1
    while (board.columns.some(c => c.id === uniqueId)) { uniqueId = `${base}-${counter++}` }
    column = { ...column, id: uniqueId }
  }
  if (column.id === DELETED_STATUS_ID) throw new Error(`"${DELETED_STATUS_ID}" is a reserved column ID`)
  if (board.columns.some(c => c.id === column.id)) {
    throw new Error(`Column already exists: ${column.id}`)
  }
  board.columns.push(column)
  writeConfig(ctx.workspaceRoot, config)
  return board.columns
}

/**
 * Updates the properties of an existing column.
 */
export function updateColumn(
  ctx: SDKContext,
  { columnId, updates, boardId }: { columnId: string; updates: Partial<Omit<KanbanColumn, 'id'>>; boardId?: string }
): KanbanColumn[] {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  const col = board.columns.find(c => c.id === columnId)
  if (!col) throw new Error(`Column not found: ${columnId}`)
  if (updates.name !== undefined) col.name = updates.name
  if (updates.color !== undefined) col.color = updates.color
  writeConfig(ctx.workspaceRoot, config)
  return board.columns
}

/**
 * Removes a column from a board. The column must be empty.
 */
export async function removeColumn(ctx: SDKContext, { columnId, boardId }: { columnId: string; boardId?: string }): Promise<KanbanColumn[]> {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  if (columnId === DELETED_STATUS_ID) throw new Error(`Cannot remove the reserved "${DELETED_STATUS_ID}" column`)
  const idx = board.columns.findIndex(c => c.id === columnId)
  if (idx === -1) throw new Error(`Column not found: ${columnId}`)

  const cards = await ctx.listCards(undefined, resolvedId)
  const cardsInColumn = cards.filter(c => c.status === columnId)
  if (cardsInColumn.length > 0) {
    throw new Error(`Cannot remove column "${columnId}": ${cardsInColumn.length} card(s) still in this column`)
  }

  board.columns.splice(idx, 1)
  writeConfig(ctx.workspaceRoot, config)
  return board.columns
}

/**
 * Moves all cards in the specified column to the `deleted` (soft-delete) column.
 */
export async function cleanupColumn(ctx: SDKContext, { columnId, boardId }: { columnId: string; boardId?: string }): Promise<number> {
  if (columnId === DELETED_STATUS_ID) return 0
  const cards = await ctx.listCards(undefined, boardId)
  const cardsToMove = cards.filter(c => c.status === columnId)
  for (const card of cardsToMove) {
    await ctx.moveCard(card.id, DELETED_STATUS_ID, 0, boardId)
  }
  return cardsToMove.length
}

/**
 * Permanently deletes all cards currently in the `deleted` column.
 */
export async function purgeDeletedCards(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<number> {
  const cards = await ctx.listCards(undefined, boardId)
  const deleted = cards.filter(c => c.status === DELETED_STATUS_ID)
  for (const card of deleted) {
    await ctx.permanentlyDeleteCard(card.id, boardId)
  }
  return deleted.length
}

/**
 * Reorders the columns of a board.
 */
export function reorderColumns(ctx: SDKContext, { columnIds, boardId }: { columnIds: string[]; boardId?: string }): KanbanColumn[] {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  const colMap = new Map(board.columns.map(c => [c.id, c]))

  for (const id of columnIds) {
    if (!colMap.has(id)) throw new Error(`Column not found: ${id}`)
  }
  if (columnIds.length !== board.columns.length) {
    throw new Error('Must include all column IDs when reordering')
  }

  board.columns = columnIds.map(id => colMap.get(id) as KanbanColumn)
  writeConfig(ctx.workspaceRoot, config)
  return board.columns
}

/**
 * Returns the minimized column IDs for a board.
 */
export function getMinimizedColumns(ctx: SDKContext, { boardId }: { boardId?: string } = {}): string[] {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  return board.minimizedColumnIds ?? []
}

/**
 * Sets the minimized column IDs for a board, persisting the state to config.
 * Only IDs that correspond to existing columns are retained.
 */
export function setMinimizedColumns(ctx: SDKContext, { columnIds, boardId }: { columnIds: string[]; boardId?: string }): string[] {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  const validIds = new Set(board.columns.map(c => c.id))
  const sanitized = [...new Set(columnIds.filter(id => validIds.has(id)))]
  board.minimizedColumnIds = sanitized.length > 0 ? sanitized : undefined
  writeConfig(ctx.workspaceRoot, config)
  return sanitized
}

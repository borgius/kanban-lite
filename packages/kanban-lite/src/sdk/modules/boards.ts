import * as path from 'path'
import * as fs from 'fs/promises'
import { generateKeyBetween } from 'fractional-indexing'
import type { Card, KanbanColumn, BoardInfo } from '../../shared/types'
import { generateSlug } from '../../shared/types'
import { readConfig, writeConfig, getBoardConfig } from '../../shared/config'
import type { BoardConfig } from '../../shared/config'
import type { Priority } from '../../shared/types'
import { sanitizeCard } from '../types'
import type { SDKContext } from './context'

// --- Board management ---

/**
 * Lists all boards defined in the workspace configuration.
 */
export function listBoards(ctx: SDKContext): BoardInfo[] {
  const config = readConfig(ctx.workspaceRoot)
  return Object.entries(config.boards).map(([id, board]) => ({
    id,
    name: board.name,
    description: board.description,
    columns: board.columns,
    actions: board.actions,
    metadata: board.metadata,
    forms: config.forms
  }))
}

/**
 * Creates a new board with the given ID and name.
 */
export function createBoard(
  ctx: SDKContext,
  { id, name, options }: {
    id: string
    name: string
    options?: {
      description?: string
      columns?: KanbanColumn[]
      defaultStatus?: string
      defaultPriority?: Priority
    }
  }
): BoardInfo {
  const config = readConfig(ctx.workspaceRoot)
  if (!id) {
    const base = generateSlug(name) || 'board'
    let uniqueId = base
    let counter = 1
    while (config.boards[uniqueId]) { uniqueId = `${base}-${counter++}` }
    id = uniqueId
  }
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
  writeConfig(ctx.workspaceRoot, config)

  const boardInfo = { id, name, description: options?.description }
  return boardInfo
}

/**
 * Deletes a board and its directory from the filesystem.
 */
export async function deleteBoard(ctx: SDKContext, { boardId }: { boardId: string }): Promise<void> {
  const config = readConfig(ctx.workspaceRoot)
  if (!config.boards[boardId]) {
    throw new Error(`Board not found: ${boardId}`)
  }
  if (config.defaultBoard === boardId) {
    throw new Error(`Cannot delete the default board: ${boardId}`)
  }

  const cards = await ctx.listCards(undefined, boardId)
  if (cards.length > 0) {
    throw new Error(`Cannot delete board "${boardId}": ${cards.length} card(s) still exist`)
  }

  const boardDir = ctx._boardDir(boardId)
  await ctx._storage.deleteBoardData(boardDir, boardId)

  delete config.boards[boardId]
  writeConfig(ctx.workspaceRoot, config)
}

/**
 * Retrieves the full configuration for a specific board.
 */
export function getBoard(ctx: SDKContext, { boardId }: { boardId: string }): BoardConfig {
  return getBoardConfig(ctx.workspaceRoot, boardId)
}

/**
 * Updates properties of an existing board.
 */
export function updateBoard(
  ctx: SDKContext,
  { boardId, updates }: { boardId: string; updates: Partial<Omit<BoardConfig, 'nextCardId'>> }
): BoardConfig {
  const config = readConfig(ctx.workspaceRoot)
  const board = config.boards[boardId]
  if (!board) {
    throw new Error(`Board not found: ${boardId}`)
  }

  if (updates.name !== undefined) board.name = updates.name
  if (updates.description !== undefined) board.description = updates.description
  if (updates.columns !== undefined) board.columns = updates.columns
  if (updates.defaultStatus !== undefined) board.defaultStatus = updates.defaultStatus
  if (updates.defaultPriority !== undefined) board.defaultPriority = updates.defaultPriority
  if (updates.metadata !== undefined) board.metadata = updates.metadata

  writeConfig(ctx.workspaceRoot, config)
  return board
}

/**
 * Returns the named actions defined on a board.
 */
export function getBoardActions(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Record<string, string> {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  return board.actions ?? {}
}

/**
 * Adds or updates a named action on a board.
 */
export function addBoardAction(ctx: SDKContext, { boardId, key, title }: { boardId: string; key: string; title: string }): Record<string, string> {
  const config = readConfig(ctx.workspaceRoot)
  const board = config.boards[boardId]
  if (!board) throw new Error(`Board not found: ${boardId}`)
  board.actions ??= {}
  board.actions[key] = title
  writeConfig(ctx.workspaceRoot, config)
  return board.actions
}

/**
 * Removes a named action from a board.
 */
export function removeBoardAction(ctx: SDKContext, { boardId, key }: { boardId: string; key: string }): Record<string, string> {
  const config = readConfig(ctx.workspaceRoot)
  const board = config.boards[boardId]
  if (!board) throw new Error(`Board not found: ${boardId}`)
  if (!board.actions || !(key in board.actions)) {
    throw new Error(`Action "${key}" not found on board "${boardId}"`)
  }
  delete board.actions[key]
  if (Object.keys(board.actions).length === 0) delete board.actions
  writeConfig(ctx.workspaceRoot, config)
  return board.actions ?? {}
}

/**
 * Fires the `board.action` webhook event for a named board action.
 * Returns the resolved boardId and action title so the SDK can emit the after-event.
 */
export async function triggerBoardAction(ctx: SDKContext, { boardId, actionKey }: { boardId: string; actionKey: string }): Promise<{ boardId: string; action: string; title: string }> {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) throw new Error(`Board not found: ${resolvedId}`)
  const actions = board.actions ?? {}
  if (!(actionKey in actions)) {
    throw new Error(`Action "${actionKey}" not defined on board "${resolvedId}"`)
  }
  return { boardId: resolvedId, action: actionKey, title: actions[actionKey] }
}

/**
 * Transfers a card from one board to another.
 */
export async function transferCard(
  ctx: SDKContext,
  { cardId, fromBoardId, toBoardId, targetStatus }: { cardId: string; fromBoardId: string; toBoardId: string; targetStatus?: string }
): Promise<Card> {
  const toBoardDir = ctx._boardDir(toBoardId)

  const config = readConfig(ctx.workspaceRoot)
  if (!config.boards[fromBoardId]) throw new Error(`Board not found: ${fromBoardId}`)
  if (!config.boards[toBoardId]) throw new Error(`Board not found: ${toBoardId}`)

  const card = await ctx.getCard(cardId, fromBoardId)
  if (!card) throw new Error(`Card not found: ${cardId} in board ${fromBoardId}`)
  const previousStatus = card.status

  const toBoard = config.boards[toBoardId]
  const newStatus = targetStatus || toBoard.defaultStatus || toBoard.columns[0]?.id || 'backlog'

  await ctx._storage.ensureBoardDirs(toBoardDir, [newStatus])

  const srcAttachDir = ctx.getAttachmentStoragePath(card)

  await ctx._storage.deleteCard(card)

  card.status = newStatus
  card.boardId = toBoardId
  card.modified = new Date().toISOString()
  card.completedAt = ctx._isCompletedStatus(newStatus, toBoardId) ? new Date().toISOString() : null

  if (ctx._storage.type === 'markdown') {
    card.filePath = path.join(toBoardDir, newStatus, path.basename(card.filePath))
  } else {
    card.filePath = ''
  }

  const targetCards = await ctx.listCards(undefined, toBoardId)
  const cardsInStatus = targetCards
    .filter(c => c.status === newStatus && c.id !== cardId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const lastOrder = cardsInStatus.length > 0 ? cardsInStatus[cardsInStatus.length - 1].order : null
  card.order = generateKeyBetween(lastOrder, null)

  await ctx._storage.writeCard(card)

  if (card.attachments.length > 0) {
    const dstAttachDir = ctx.getAttachmentStoragePath(card)
    if (srcAttachDir && dstAttachDir && srcAttachDir !== dstAttachDir) {
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

  await ctx.addLog(card.id, `Status changed: \`${previousStatus}\` → \`${newStatus}\``, { source: 'system' }, toBoardId).catch(() => {})
  return card
}

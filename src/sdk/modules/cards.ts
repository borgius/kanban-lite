import * as path from 'path'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Card, CardSortOption } from '../../shared/types'
import { getTitleFromContent, generateCardFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION } from '../../shared/types'
import { readConfig, allocateCardId, syncCardIdCounter } from '../../shared/config'
import { getCardFilePath } from '../fileUtils'
import { matchesCardSearch } from '../metaUtils'
import { sanitizeCard } from '../types'
import type { CreateCardInput } from '../types'
import type { SDKContext } from './context'

// --- Card CRUD ---

/**
 * Lists all cards on a board, optionally filtered by column/status, metadata,
 * and an internal exact/fuzzy search query.
 */
export async function listCards(
  ctx: SDKContext,
  columns?: string[],
  boardId?: string,
  metaFilter?: Record<string, string>,
  sort?: CardSortOption,
  searchQuery?: string,
  fuzzy?: boolean
): Promise<Card[]> {
  await ctx._ensureMigrated()
  const boardDir = ctx._boardDir(boardId)
  const resolvedBoardId = ctx._resolveBoardId(boardId)

  await ctx._storage.ensureBoardDirs(boardDir, columns)

  const cards = await ctx._storage.scanCards(boardDir, resolvedBoardId)

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
        await ctx._storage.writeCard(columnCards[i])
      }
    }
  }

  // Sync ID counter with existing cards
  const numericIds = cards
    .map(c => parseInt(c.id, 10))
    .filter(n => !Number.isNaN(n))
  if (numericIds.length > 0) {
    syncCardIdCounter(ctx.workspaceRoot, resolvedBoardId, numericIds)
  }

  const hasSearch = Boolean(searchQuery && searchQuery.trim().length > 0)
  const hasMetaFilter = Boolean(metaFilter && Object.keys(metaFilter).length > 0)
  const filtered = hasMetaFilter || hasSearch
    ? cards.filter(c => matchesCardSearch(c, searchQuery, metaFilter, fuzzy))
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
 * Retrieves a single card by its ID. Supports partial ID matching.
 */
export async function getCard(ctx: SDKContext, cardId: string, boardId?: string): Promise<Card | null> {
  const cards = await listCards(ctx, undefined, boardId)
  return cards.find(c => c.id === cardId) || null
}

/**
 * Creates a new card on a board.
 */
export async function createCard(ctx: SDKContext, data: CreateCardInput): Promise<Card> {
  await ctx._ensureMigrated()
  const resolvedBoardId = ctx._resolveBoardId(data.boardId)
  const boardDir = ctx._boardDir(resolvedBoardId)
  await ctx._storage.ensureBoardDirs(boardDir)

  const config = readConfig(ctx.workspaceRoot)
  const board = config.boards[resolvedBoardId]

  const status = data.status || board?.defaultStatus || config.defaultStatus || 'backlog'
  const priority = data.priority || board?.defaultPriority || config.defaultPriority || 'medium'
  const title = getTitleFromContent(data.content)
  const numericId = allocateCardId(ctx.workspaceRoot, resolvedBoardId)
  const filename = generateCardFilename(numericId, title)
  const now = new Date().toISOString()

  const cards = await listCards(ctx, undefined, resolvedBoardId)
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
    completedAt: ctx._isCompletedStatus(status, resolvedBoardId) ? now : null,
    labels: data.labels || [],
    attachments: data.attachments || [],
    comments: [],
    order: generateKeyBetween(lastOrder, null),
    content: data.content,
    ...(data.metadata && Object.keys(data.metadata).length > 0 ? { metadata: data.metadata } : {}),
    ...(data.actions && (Array.isArray(data.actions) ? data.actions.length > 0 : Object.keys(data.actions).length > 0) ? { actions: data.actions } : {}),
    filePath: ctx._storage.type === 'markdown'
      ? getCardFilePath(boardDir, status, filename)
      : ''
  }

  await ctx._storage.writeCard(card)

  ctx.emitEvent('task.created', sanitizeCard(card))
  return card
}

/**
 * Updates an existing card's properties.
 */
export async function updateCard(
  ctx: SDKContext,
  cardId: string,
  updates: Partial<Card>,
  boardId?: string
): Promise<Card> {
  const card = await getCard(ctx, cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)
  const boardDir = ctx._boardDir(resolvedBoardId)
  const oldStatus = card.status
  const oldTitle = getTitleFromContent(card.content)

  const { filePath: _fp, id: _id, boardId: _bid, ...safeUpdates } = updates
  Object.assign(card, safeUpdates)
  card.modified = new Date().toISOString()

  if (oldStatus !== card.status) {
    card.completedAt = ctx._isCompletedStatus(card.status, resolvedBoardId) ? new Date().toISOString() : null
  }

  await ctx._storage.writeCard(card)

  const newTitle = getTitleFromContent(card.content)
  const numericId = extractNumericId(card.id)
  if (numericId !== null && newTitle !== oldTitle) {
    const newFilename = generateCardFilename(numericId, newTitle)
    const newPath = await ctx._storage.renameCard(card, newFilename)
    if (newPath) card.filePath = newPath
  }

  if (oldStatus !== card.status) {
    const newPath = await ctx._storage.moveCard(card, boardDir, card.status)
    if (newPath) card.filePath = newPath
  }

  ctx.emitEvent('task.updated', sanitizeCard(card))
  if (oldStatus !== card.status) {
    await ctx.addLog(card.id, `Status changed: \`${oldStatus}\` → \`${card.status}\``, { source: 'system' }, resolvedBoardId).catch(() => {})
  }
  return card
}

/**
 * Triggers a named action for a card by POSTing to the global `actionWebhookUrl`.
 */
export async function triggerAction(
  ctx: SDKContext,
  cardId: string,
  action: string,
  boardId?: string
): Promise<void> {
  const config = readConfig(ctx.workspaceRoot)
  const { actionWebhookUrl } = config
  if (!actionWebhookUrl) {
    throw new Error('No action webhook URL configured. Set actionWebhookUrl in .kanban.json')
  }

  const card = await getCard(ctx, cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)

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
  await ctx.addLog(cardId, `Action triggered: \`${action}\``, { source: 'system' }, resolvedBoardId).catch(() => {})
}

/**
 * Moves a card to a different status column and/or position within that column.
 */
export async function moveCard(
  ctx: SDKContext,
  cardId: string,
  newStatus: string,
  position?: number,
  boardId?: string
): Promise<Card> {
  const cards = await listCards(ctx, undefined, boardId)
  const card = cards.find(c => c.id === cardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)
  const boardDir = ctx._boardDir(resolvedBoardId)
  const oldStatus = card.status
  card.status = newStatus
  card.modified = new Date().toISOString()

  if (oldStatus !== newStatus) {
    card.completedAt = ctx._isCompletedStatus(newStatus, resolvedBoardId) ? new Date().toISOString() : null
  }

  const targetColumnCards = cards
    .filter(c => c.status === newStatus && c.id !== cardId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

  const pos = position !== undefined
    ? Math.max(0, Math.min(position, targetColumnCards.length))
    : targetColumnCards.length
  const before = pos > 0 ? targetColumnCards[pos - 1].order : null
  const after = pos < targetColumnCards.length ? targetColumnCards[pos].order : null
  card.order = generateKeyBetween(before, after)

  await ctx._storage.writeCard(card)

  if (oldStatus !== newStatus) {
    const newPath = await ctx._storage.moveCard(card, boardDir, newStatus)
    if (newPath) card.filePath = newPath
  }

  ctx.emitEvent('task.moved', { ...sanitizeCard(card), previousStatus: oldStatus })
  if (oldStatus !== newStatus) {
    await ctx.addLog(card.id, `Status changed: \`${oldStatus}\` → \`${newStatus}\``, { source: 'system' }, resolvedBoardId).catch(() => {})
  }
  return card
}

/**
 * Soft-deletes a card by moving it to the `deleted` status column.
 */
export async function deleteCard(ctx: SDKContext, cardId: string, boardId?: string): Promise<void> {
  const card = await getCard(ctx, cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  if (card.status === DELETED_STATUS_ID) return
  await updateCard(ctx, cardId, { status: DELETED_STATUS_ID }, boardId)
}

/**
 * Permanently deletes a card's file from disk.
 */
export async function permanentlyDeleteCard(ctx: SDKContext, cardId: string, boardId?: string): Promise<void> {
  const card = await getCard(ctx, cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  const snapshot = sanitizeCard(card)
  await ctx._storage.deleteCard(card)
  ctx.emitEvent('task.deleted', snapshot)
}

/**
 * Returns all cards in a specific status column.
 */
export async function getCardsByStatus(ctx: SDKContext, status: string, boardId?: string): Promise<Card[]> {
  const cards = await listCards(ctx, undefined, boardId)
  return cards.filter(c => c.status === status)
}

/**
 * Returns a sorted list of unique assignee names across all cards on a board.
 */
export async function getUniqueAssignees(ctx: SDKContext, boardId?: string): Promise<string[]> {
  const cards = await listCards(ctx, undefined, boardId)
  const assignees = new Set<string>()
  for (const c of cards) {
    if (c.assignee) assignees.add(c.assignee)
  }
  return [...assignees].sort()
}

/**
 * Returns a sorted list of unique labels across all cards on a board.
 */
export async function getUniqueLabels(ctx: SDKContext, boardId?: string): Promise<string[]> {
  const cards = await listCards(ctx, undefined, boardId)
  const labels = new Set<string>()
  for (const c of cards) {
    for (const l of c.labels) labels.add(l)
  }
  return [...labels].sort()
}

import * as fs from 'fs/promises'
import * as path from 'path'
import { createAjv } from '@jsonforms/core'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Card, CardFormAttachment, CardSortOption, CardTask, ResolvedFormDescriptor, TaskPermissionsReadModel } from '../../../shared/types'
import { getTitleFromContent, generateCardFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION, generateSlug, formatFormDisplayName } from '../../../shared/types'
import { readConfig, allocateCardId, syncCardIdCounter } from '../../../shared/config'
import { buildCardInterpolationContext, prepareFormData } from '../../../shared/formDataPreparation'
import { getCardFilePath } from '../../fileUtils'
import { matchesCardSearch } from '../../metaUtils'
import type { AuthIdentity, AuthVisibilityFilterInput } from '../../plugins'
import { sanitizeCard } from '../../types'
import type { AuthContext, CreateCardInput, FormSubmitEvent, SubmitFormInput, SubmitFormResult } from '../../types'
import type { SDKContext } from '../context'
import { buildChecklistTask, buildChecklistToken, isReservedChecklistLabel, normalizeCardChecklistState, normalizeChecklistTasks, projectCardChecklistState } from '../checklist'
import { appendActivityLog } from '../logs'

import { type ActiveCardState, getActiveCardStateFilePath, writeActiveCardState, readActiveCardState, resolveCardForms, buildTaskPermissionsReadModel, assertChecklistReservedLabelUpdateAllowed, canShowChecklist, applyCardVisibilityFilter, getQualifyingCardEditFields, requireExpectedChecklistToken, requireExpectedModifiedAt } from './helpers'

// --- Card CRUD ---

/**
 * Lists all cards on a board, optionally filtered by column/status, metadata,
 * and an internal exact/fuzzy search query.
 */
export async function listCards(
  ctx: SDKContext,
  { columns, boardId, metaFilter, sort, searchQuery, fuzzy }: {
    columns?: string[]
    boardId?: string
    metaFilter?: Record<string, string>
    sort?: CardSortOption
    searchQuery?: string
    fuzzy?: boolean
  } = {}
): Promise<Card[]> {
  const cards = await listCardsRaw(ctx, { columns, boardId })
  const checklistVisible = await canShowChecklist(ctx)
  const projectedCards = cards.map((card) => projectCardChecklistState(card, checklistVisible))

  const visibleCards = await applyCardVisibilityFilter(ctx, projectedCards)

  const hasSearch = Boolean(searchQuery && searchQuery.trim().length > 0)
  const hasMetaFilter = Boolean(metaFilter && Object.keys(metaFilter).length > 0)
  const filtered = hasMetaFilter || hasSearch
    ? visibleCards.filter(c => matchesCardSearch(c, searchQuery, metaFilter, fuzzy))
    : visibleCards
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

export async function listCardsRaw(
  ctx: SDKContext,
  { columns, boardId }: {
    columns?: string[]
    boardId?: string
  } = {}
): Promise<Card[]> {
  await ctx._ensureMigrated()
  const boardDir = ctx._boardDir(boardId)
  const resolvedBoardId = ctx._resolveBoardId(boardId)

  await ctx._storage.ensureBoardDirs(boardDir, columns)

  const cards = (await ctx._storage.scanCards(boardDir, resolvedBoardId)).map((card) => normalizeCardChecklistState(card))

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

  return cards
}

/**
 * Retrieves a single card by its ID. Supports partial ID matching.
 */
export async function getCard(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<Card | null> {
  const cards = await listCards(ctx, { boardId })
  return cards.find(c => c.id === cardId) || null
}

export async function getCardRaw(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<Card | null> {
  const cards = await listCardsRaw(ctx, { boardId })
  return cards.find(c => c.id === cardId) || null
}

export async function getMutableCard(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<Card | null> {
  const visibleCard = await getCard(ctx, { cardId, boardId })
  if (!visibleCard) {
    return null
  }

  return getCardRaw(ctx, { cardId, boardId })
}

/**
 * Retrieves the card currently marked as active/open in this workspace.
 */
export async function getActiveCard(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<Card | null> {
  const state = await readActiveCardState(ctx)
  if (!state) return null

  if (boardId && state.boardId !== ctx._resolveBoardId(boardId)) {
    return null
  }

  const card = await getCard(ctx, { cardId: state.cardId, boardId: state.boardId })
  if (!card) {
    await clearActiveCard(ctx, { boardId: state.boardId })
    return null
  }

  return card
}

/**
 * Marks a card as the active/open card for this workspace.
 */
export async function setActiveCard(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<Card> {
  const card = await getCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  await writeActiveCardState(ctx, {
    cardId: card.id,
    boardId: card.boardId || ctx._resolveBoardId(boardId),
    updatedAt: new Date().toISOString(),
  })

  return card
}

/**
 * Clears the tracked active/open card for this workspace.
 */
export async function clearActiveCard(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<void> {
  const state = await readActiveCardState(ctx)
  if (!state) return

  if (boardId && state.boardId !== ctx._resolveBoardId(boardId)) {
    return
  }

  try {
    await fs.unlink(getActiveCardStateFilePath(ctx))
  } catch {
    // ignore missing files
  }
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

  const cards = await listCardsRaw(ctx, { boardId: resolvedBoardId })
  const cardsInStatus = cards
    .filter(c => c.status === status)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const lastOrder = cardsInStatus.length > 0
    ? cardsInStatus[cardsInStatus.length - 1].order
    : null
  const seededTasks = data.tasks && data.tasks.length > 0 ? [...data.tasks] : undefined

  const card = normalizeCardChecklistState({
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
    ...(seededTasks ? { tasks: seededTasks } : {}),
    comments: [],
    order: generateKeyBetween(lastOrder, null),
    content: data.content,
    ...(data.metadata && Object.keys(data.metadata).length > 0 ? { metadata: data.metadata } : {}),
    ...(data.actions && (Array.isArray(data.actions) ? data.actions.length > 0 : Object.keys(data.actions).length > 0) ? { actions: data.actions } : {}),
    ...(data.forms && data.forms.length > 0 ? { forms: data.forms } : {}),
    ...(data.formData && Object.keys(data.formData).length > 0 ? { formData: data.formData } : {}),
    filePath: ctx._storage.type === 'markdown'
      ? getCardFilePath(boardDir, status, filename)
      : ''
  })

  await ctx._storage.writeCard(card)

  return card
}

/**
 * Updates an existing card's properties.
 */
export async function updateCard(
  ctx: SDKContext,
  { cardId, updates, boardId }: { cardId: string; updates: Partial<Card>; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)
  const boardDir = ctx._boardDir(resolvedBoardId)
  const oldStatus = card.status
  const oldTitle = getTitleFromContent(card.content)

  const safeUpdates = { ...updates }
  delete safeUpdates.filePath
  delete safeUpdates.id
  delete safeUpdates.boardId
  if (Object.prototype.hasOwnProperty.call(safeUpdates, 'tasks')) {
    throw new Error('Card tasks can only be changed through checklist operations')
  }
  if (Array.isArray(safeUpdates.labels)) {
    await assertChecklistReservedLabelUpdateAllowed(ctx, card, safeUpdates.labels)
  }
  const qualifyingFields = getQualifyingCardEditFields(safeUpdates)
  Object.assign(card, safeUpdates)
  card.modified = new Date().toISOString()

  if (oldStatus !== card.status) {
    card.completedAt = ctx._isCompletedStatus(card.status, resolvedBoardId) ? new Date().toISOString() : null
  }

  const nextCard = normalizeCardChecklistState(card)

  await ctx._storage.writeCard(nextCard)

  const newTitle = getTitleFromContent(nextCard.content)
  const numericId = extractNumericId(nextCard.id)
  if (numericId !== null && newTitle !== oldTitle) {
    const newFilename = generateCardFilename(numericId, newTitle)
    const newPath = await ctx._storage.renameCard(nextCard, newFilename)
    if (newPath) nextCard.filePath = newPath
  }

  if (oldStatus !== nextCard.status) {
    const newPath = await ctx._storage.moveCard(nextCard, boardDir, nextCard.status)
    if (newPath) nextCard.filePath = newPath
  }

  if (oldStatus !== nextCard.status) {
    await appendActivityLog(ctx, {
      cardId: nextCard.id,
      boardId: resolvedBoardId,
      eventType: 'card.status.changed',
      text: `Status changed: \`${oldStatus}\` → \`${nextCard.status}\``,
      metadata: {
        previousStatus: oldStatus,
        status: nextCard.status,
      },
    }).catch(() => {})
  } else if (qualifyingFields.length > 0) {
    await appendActivityLog(ctx, {
      cardId: nextCard.id,
      boardId: resolvedBoardId,
      eventType: 'card.updated',
      text: `Card updated: ${qualifyingFields.join(', ')}`,
      metadata: {
        fields: qualifyingFields,
      },
    }).catch(() => {})
  }
  return nextCard
}

function getChecklistTaskAt(card: Card, index: number): CardTask {
  const tasks = card.tasks ?? []
  if (!Number.isInteger(index) || index < 0 || index >= tasks.length) {
    throw new Error(`Checklist item not found at index ${index}`)
  }

  return tasks[index]
}

async function writeChecklistCard(ctx: SDKContext, card: Card): Promise<Card> {
  card.modified = new Date().toISOString()
  const nextCard = normalizeCardChecklistState(card)
  await ctx._storage.writeCard(nextCard)
  return nextCard
}

/** Adds a new checklist item to a card. */
export async function addChecklistItem(
  ctx: SDKContext,
  { cardId, title, description = '', createdBy = '', expectedToken, boardId }: { cardId: string; title: string; description?: string; createdBy?: string; expectedToken?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const currentTasks = normalizeChecklistTasks(card.tasks) ?? []
  requireExpectedChecklistToken(currentTasks, expectedToken)

  card.tasks = [...currentTasks, buildChecklistTask(title, description, createdBy)]
  return writeChecklistCard(ctx, card)
}

/** Edits the title/description of an existing checklist item while preserving its checked state. */
export async function editChecklistItem(
  ctx: SDKContext,
  { cardId, index, title, description = '', modifiedBy = '', modifiedAt, boardId }: { cardId: string; index: number; title: string; description?: string; modifiedBy?: string; modifiedAt?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedModifiedAt(current, modifiedAt)

  const now = new Date().toISOString()
  const updatedTask = buildChecklistTask(title, description, modifiedBy, now)
  const nextTasks = [...(card.tasks ?? [])]
  nextTasks[index] = { ...updatedTask, checked: current.checked, createdAt: current.createdAt, createdBy: current.createdBy }
  card.tasks = nextTasks
  return writeChecklistCard(ctx, card)
}

/** Deletes an existing checklist item by index with stale-write protection. */
export async function deleteChecklistItem(
  ctx: SDKContext,
  { cardId, index, modifiedAt, boardId }: { cardId: string; index: number; modifiedAt?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedModifiedAt(current, modifiedAt)

  const nextTasks = [...(card.tasks ?? [])]
  nextTasks.splice(index, 1)
  if (nextTasks.length > 0) {
    card.tasks = nextTasks
  } else {
    delete card.tasks
  }

  return writeChecklistCard(ctx, card)
}

/** Marks an existing checklist item complete with stale-write protection. */
export async function checkChecklistItem(
  ctx: SDKContext,
  { cardId, index, modifiedAt, modifiedBy = '', boardId }: { cardId: string; index: number; modifiedAt?: string; modifiedBy?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedModifiedAt(current, modifiedAt)

  const nextTasks = [...(card.tasks ?? [])]
  nextTasks[index] = { ...current, checked: true, modifiedAt: new Date().toISOString(), modifiedBy }
  card.tasks = nextTasks
  return writeChecklistCard(ctx, card)
}

/** Marks an existing checklist item incomplete with stale-write protection. */
export async function uncheckChecklistItem(
  ctx: SDKContext,
  { cardId, index, modifiedAt, modifiedBy = '', boardId }: { cardId: string; index: number; modifiedAt?: string; modifiedBy?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedModifiedAt(current, modifiedAt)

  const nextTasks = [...(card.tasks ?? [])]
  nextTasks[index] = { ...current, checked: false, modifiedAt: new Date().toISOString(), modifiedBy }
  card.tasks = nextTasks
  return writeChecklistCard(ctx, card)
}

/**
 * Triggers a named action for a card.
 *
 * Validates the card exists, appends an activity log entry, and returns the
 * action payload. Webhook delivery is handled by the webhook plugin via the
 * `card.action.triggered` after-event emitted by {@link KanbanSDK.triggerAction}.
 */


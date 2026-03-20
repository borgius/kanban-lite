import * as fs from 'fs/promises'
import * as path from 'path'
import { createAjv } from '@jsonforms/core'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Card, CardFormAttachment, CardSortOption, ResolvedFormDescriptor } from '../../shared/types'
import { getTitleFromContent, generateCardFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION, generateSlug } from '../../shared/types'
import { readConfig, allocateCardId, syncCardIdCounter } from '../../shared/config'
import { getCardFilePath } from '../fileUtils'
import { matchesCardSearch } from '../metaUtils'
import { sanitizeCard } from '../types'
import type { CreateCardInput, FormSubmitEvent, SubmitFormInput, SubmitFormResult } from '../types'
import type { SDKContext } from './context'

interface ActiveCardState {
  cardId: string
  boardId: string
  updatedAt: string
}

function getActiveCardStateFilePath(ctx: SDKContext): string {
  return path.join(ctx.kanbanDir, '.active-card.json')
}

const formAjv = createAjv({ allErrors: true, strict: false })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? { ...value } : {}
}

function getSchemaProperties(schema: Record<string, unknown>): Set<string> {
  return isRecord(schema.properties)
    ? new Set(Object.keys(schema.properties))
    : new Set<string>()
}

function getMetadataOverlay(card: Card, schema: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(card.metadata)) return {}

  const properties = getSchemaProperties(schema)
  if (properties.size === 0) return {}

  return Object.fromEntries(
    Object.entries(card.metadata).filter(([key]) => properties.has(key))
  )
}

function getInlineFormLabel(schema: Record<string, unknown>, fallbackId: string): string {
  return typeof schema.title === 'string' && schema.title.trim().length > 0
    ? schema.title.trim()
    : fallbackId
}

function createInlineFormIdResolver(): (attachment: CardFormAttachment, index: number) => string {
  const usedIds = new Set<string>()

  return (attachment: CardFormAttachment, index: number): string => {
    const schema = isRecord(attachment.schema) ? attachment.schema : undefined
    const baseId = attachment.name
      ?? (schema && typeof schema.title === 'string' && schema.title.trim().length > 0
        ? generateSlug(schema.title)
        : `form-${index}`)

    let candidate = baseId || `form-${index}`
    let suffix = 2
    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix++}`
    }
    usedIds.add(candidate)
    return candidate
  }
}

function resolveCardForms(ctx: SDKContext, card: Card): ResolvedFormDescriptor[] {
  const config = readConfig(ctx.workspaceRoot)
  const workspaceForms = config.forms ?? {}
  const attachments = card.forms ?? []
  const resolveInlineId = createInlineFormIdResolver()

  return attachments.flatMap((attachment, index) => {
    const configForm = attachment.name ? workspaceForms[attachment.name] : undefined
    const schema = isRecord(attachment.schema)
      ? attachment.schema
      : isRecord(configForm?.schema)
        ? configForm.schema
        : undefined

    if (!schema) return []

    const formId = resolveInlineId(attachment, index)
    const label = attachment.name
      ?? (typeof configForm?.schema?.title === 'string' && configForm.schema.title.trim().length > 0
        ? configForm.schema.title.trim()
        : getInlineFormLabel(schema, formId))

    const initialData = {
      ...cloneRecord(configForm?.data),
      ...cloneRecord(isRecord(attachment.data) ? attachment.data : undefined),
      ...cloneRecord(card.formData?.[formId]),
      ...getMetadataOverlay(card, schema),
    }

    const descriptor: ResolvedFormDescriptor = {
      id: formId,
      label,
      schema,
      ...(isRecord(attachment.ui)
        ? { ui: attachment.ui }
        : isRecord(configForm?.ui)
          ? { ui: configForm.ui }
          : {}),
      initialData,
      fromConfig: Boolean(attachment.name && configForm),
    }

    return [descriptor]
  })
}

function formatValidationErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'Invalid form submission'
  }

  return errors
    .map((error) => {
      if (!isRecord(error)) return 'validation error'
      const instancePath = typeof error.instancePath === 'string' ? error.instancePath : ''
      const missingProperty = isRecord(error.params) && typeof error.params.missingProperty === 'string'
        ? error.params.missingProperty
        : ''
      const target = missingProperty || instancePath || '/'
      const message = typeof error.message === 'string' ? error.message : 'is invalid'
      return `${target} ${message}`.trim()
    })
    .join('; ')
}

async function readActiveCardState(ctx: SDKContext): Promise<ActiveCardState | null> {
  try {
    const raw = await fs.readFile(getActiveCardStateFilePath(ctx), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ActiveCardState>
    if (typeof parsed.cardId !== 'string' || typeof parsed.boardId !== 'string') return null
    return {
      cardId: parsed.cardId,
      boardId: parsed.boardId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

async function writeActiveCardState(ctx: SDKContext, state: ActiveCardState): Promise<void> {
  await fs.mkdir(ctx.kanbanDir, { recursive: true })
  await fs.writeFile(getActiveCardStateFilePath(ctx), JSON.stringify(state, null, 2), 'utf-8')
}

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
 * Retrieves the card currently marked as active/open in this workspace.
 */
export async function getActiveCard(ctx: SDKContext, boardId?: string): Promise<Card | null> {
  const state = await readActiveCardState(ctx)
  if (!state) return null

  if (boardId && state.boardId !== ctx._resolveBoardId(boardId)) {
    return null
  }

  const card = await getCard(ctx, state.cardId, state.boardId)
  if (!card) {
    await clearActiveCard(ctx, state.boardId)
    return null
  }

  return card
}

/**
 * Marks a card as the active/open card for this workspace.
 */
export async function setActiveCard(ctx: SDKContext, cardId: string, boardId?: string): Promise<Card> {
  const card = await getCard(ctx, cardId, boardId)
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
export async function clearActiveCard(ctx: SDKContext, boardId?: string): Promise<void> {
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
    ...(data.forms && data.forms.length > 0 ? { forms: data.forms } : {}),
    ...(data.formData && Object.keys(data.formData).length > 0 ? { formData: data.formData } : {}),
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

  const safeUpdates = { ...updates }
  delete safeUpdates.filePath
  delete safeUpdates.id
  delete safeUpdates.boardId
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
 * Validates and persists a card form submission, then emits `form.submit`.
 */
export async function submitForm(ctx: SDKContext, input: SubmitFormInput): Promise<SubmitFormResult> {
  const card = await getCard(ctx, input.cardId, input.boardId)
  if (!card) throw new Error(`Card not found: ${input.cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(input.boardId)
  const form = resolveCardForms(ctx, card).find(candidate => candidate.id === input.formId)
  if (!form) {
    throw new Error(`Form not found on card ${card.id}: ${input.formId}`)
  }

  const submittedData = {
    ...cloneRecord(form.initialData),
    ...cloneRecord(input.data),
  }

  const validate = formAjv.compile(form.schema)
  const valid = validate(submittedData)
  if (!valid) {
    throw new Error(`Invalid form submission for ${form.id}: ${formatValidationErrors(validate.errors)}`)
  }

  card.formData = {
    ...(card.formData ?? {}),
    [form.id]: submittedData,
  }
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  const event: FormSubmitEvent = {
    boardId: resolvedBoardId,
    card: sanitizeCard(card),
    form,
    data: submittedData,
  }
  ctx.emitEvent('form.submit', event)

  return event
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

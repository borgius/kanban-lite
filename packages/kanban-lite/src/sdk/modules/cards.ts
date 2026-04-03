import * as fs from 'fs/promises'
import * as path from 'path'
import { createAjv } from '@jsonforms/core'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Card, CardFormAttachment, CardSortOption, ResolvedFormDescriptor, TaskPermissionsReadModel } from '../../shared/types'
import { getTitleFromContent, generateCardFilename, extractNumericId, DELETED_STATUS_ID, CARD_FORMAT_VERSION, generateSlug, formatFormDisplayName } from '../../shared/types'
import { readConfig, allocateCardId, syncCardIdCounter } from '../../shared/config'
import { buildCardInterpolationContext, prepareFormData } from '../../shared/formDataPreparation'
import { getCardFilePath } from '../fileUtils'
import { matchesCardSearch } from '../metaUtils'
import type { AuthIdentity, AuthVisibilityFilterInput } from '../plugins'
import { sanitizeCard } from '../types'
import type { AuthContext, CreateCardInput, FormSubmitEvent, SubmitFormInput, SubmitFormResult } from '../types'
import type { SDKContext } from './context'
import { buildChecklistTask, buildChecklistToken, isReservedChecklistLabel, normalizeCardChecklistState, normalizeChecklistSeedTasks, normalizeChecklistTaskLine, normalizeChecklistTasks, projectCardChecklistState } from './checklist'
import { appendActivityLog } from './logs'

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

type AuthScopedCardsContext = SDKContext & {
  readonly _currentAuthContext?: AuthContext
}

function setChecklistTaskChecked(task: string, checked: boolean): string {
  return normalizeChecklistTaskLine(task).replace(/^- \[(?: |x)\]/, `- [${checked ? 'x' : ' '}]`)
}

function requireExpectedRaw(current: string, expectedRaw: string | undefined): void {
  if (typeof expectedRaw !== 'string' || expectedRaw.trim().length === 0) {
    throw new Error('Checklist mutations for existing items require expectedRaw')
  }

  if (normalizeChecklistTaskLine(expectedRaw) !== current) {
    throw new Error('Checklist item is stale: expectedRaw does not match current value')
  }
}

function requireExpectedChecklistToken(currentTasks: readonly string[] | undefined, expectedToken: string | undefined): void {
  if (typeof expectedToken !== 'string' || expectedToken.trim().length === 0) {
    throw new Error('Checklist additions require expectedToken from the latest checklist read model')
  }

  if (expectedToken !== buildChecklistToken(currentTasks)) {
    throw new Error('Checklist is stale: expectedToken does not match current checklist state')
  }
}

const CARD_EDIT_ACTIVITY_FIELDS = new Set<keyof Card>([
  'content',
  'priority',
  'assignee',
  'dueDate',
  'labels',
  'metadata',
])

function getQualifyingCardEditFields(updates: Partial<Card>): string[] {
  return Object.keys(updates).filter((key) => CARD_EDIT_ACTIVITY_FIELDS.has(key as keyof Card))
}

function hasSameReservedChecklistLabels(left: readonly string[], right: readonly string[]): boolean {
  const leftReserved = new Set(left.filter((label) => isReservedChecklistLabel(label)))
  const rightReserved = new Set(right.filter((label) => isReservedChecklistLabel(label)))

  if (leftReserved.size !== rightReserved.size) {
    return false
  }

  for (const label of leftReserved) {
    if (!rightReserved.has(label)) {
      return false
    }
  }

  return true
}

async function assertChecklistReservedLabelUpdateAllowed(ctx: SDKContext, card: Card, labels: readonly string[]): Promise<void> {
  const visibleReservedLabels = (await canShowChecklist(ctx))
    ? card.labels.filter((label) => isReservedChecklistLabel(label))
    : []

  if (!hasSameReservedChecklistLabels(labels, visibleReservedLabels)) {
    throw new Error('Checklist-derived labels cannot be edited directly')
  }
}

function getSchemaProperties(schema: Record<string, unknown>): Set<string> {
  return isRecord(schema.properties)
    ? new Set(Object.keys(schema.properties))
    : new Set<string>()
}

function getMetadataOverlay(card: Omit<Card, 'filePath'>, schema: Record<string, unknown>): Record<string, unknown> {
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

function getConfigFormName(formKey: string, configForm: { name?: string } | undefined): string {
  return typeof configForm?.name === 'string' && configForm.name.trim().length > 0
    ? configForm.name.trim()
    : formatFormDisplayName(formKey)
}

function getConfigFormDescription(configForm: { description?: string } | undefined): string {
  return typeof configForm?.description === 'string'
    ? configForm.description.trim()
    : ''
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

export function resolveCardForms(ctx: SDKContext, card: Omit<Card, 'filePath'>): ResolvedFormDescriptor[] {
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
    const name = attachment.name
      ? getConfigFormName(attachment.name, configForm)
      : getInlineFormLabel(schema, formatFormDisplayName(formId))
    const description = attachment.name
      ? getConfigFormDescription(configForm)
      : ''

    const interpolationCtx = buildCardInterpolationContext(
      card,
      card.boardId || ctx._resolveBoardId(undefined),
    )
    const rawData = {
      ...cloneRecord(configForm?.data),
      ...cloneRecord(isRecord(attachment.data) ? attachment.data : undefined),
      ...cloneRecord(card.formData?.[formId]),
    }
    const initialData = {
      ...prepareFormData(rawData, interpolationCtx),
      ...getMetadataOverlay(card, schema),
    }

    const descriptor: ResolvedFormDescriptor = {
      id: formId,
      name,
      description,
      label: name,
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

function normalizeResolvedRoles(identity: AuthIdentity | null): string[] {
  if (!Array.isArray(identity?.roles)) return []

  return identity.roles
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    .map((role) => role.trim())
}

function buildVisibilityAuthContext(
  auth: AuthContext,
  identity: AuthIdentity | null,
  roles: readonly string[],
): AuthContext {
  const restAuth = { ...auth }
  delete restAuth.identity
  if (!identity?.subject) return restAuth

  const groups = Array.isArray(identity.groups)
    ? identity.groups
      .filter((group): group is string => typeof group === 'string' && group.trim().length > 0)
      .map((group) => group.trim())
    : []

  return {
    ...restAuth,
    identity: {
      subject: identity.subject,
      roles: [...roles],
      ...(groups.length > 0 ? { groups } : {}),
    },
  }
}

async function applyCardVisibilityFilter(ctx: SDKContext, cards: Card[]): Promise<Card[]> {
  const capabilities = ctx.capabilities
  const visibilityProvider = capabilities?.authVisibility
  if (!visibilityProvider || cards.length === 0) {
    return cards
  }

  const activeAuthContext = (ctx as AuthScopedCardsContext)._currentAuthContext ?? {}
  if (Object.keys(activeAuthContext).length === 0) {
    return cards
  }

  const identity = await capabilities.authIdentity.resolveIdentity(activeAuthContext)
  const roles = normalizeResolvedRoles(identity)
  const input: AuthVisibilityFilterInput = {
    identity,
    roles,
    auth: buildVisibilityAuthContext(activeAuthContext, identity, roles),
  }

  return visibilityProvider.filterVisibleCards(cards, input)
}

async function canShowChecklist(ctx: SDKContext): Promise<boolean> {
  const capabilities = ctx.capabilities
  if (!capabilities) {
    return true
  }

  const activeAuthContext = (ctx as AuthScopedCardsContext)._currentAuthContext ?? {}

  try {
    const identity = await capabilities.authIdentity.resolveIdentity(activeAuthContext)
    const decision = await capabilities.authPolicy.checkPolicy(identity, 'card.checklist.show', activeAuthContext)
    return decision.allowed
  } catch {
    return false
  }
}

function buildTaskPermissionAuthContext(ctx: SDKContext, card: Omit<Card, 'filePath'>, overrides: Partial<AuthContext> = {}): AuthContext {
  const currentAuth = (ctx as AuthScopedCardsContext)._currentAuthContext ?? {}
  return {
    ...currentAuth,
    boardId: card.boardId || ctx._resolveBoardId(undefined),
    cardId: card.id,
    ...overrides,
  }
}

function getCardActionKeys(actions: Card['actions'] | undefined): string[] {
  const keys = Array.isArray(actions)
    ? actions
    : isRecord(actions)
      ? Object.keys(actions)
      : []

  return [...new Set(
    keys
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(value => value.length > 0),
  )]
}

/**
 * Builds the server-owned task permission read model for the current caller.
 *
 * This keeps policy evaluation on the server so downstream surfaces can render
 * task affordances without re-implementing auth checks on the client.
 */
export async function buildTaskPermissionsReadModel(ctx: SDKContext, card: Omit<Card, 'filePath'>): Promise<TaskPermissionsReadModel> {
  const baseContext = buildTaskPermissionAuthContext(ctx, card)
  const commentEntries = await Promise.all((card.comments ?? []).map(async (comment) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { commentId: comment.id })
    return [comment.id, {
      update: await ctx.canPerformAction('comment.update', authContext),
      delete: await ctx.canPerformAction('comment.delete', authContext),
    }] as const
  }))

  const attachmentEntries = await Promise.all((card.attachments ?? []).map(async (attachment) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { attachment })
    return [attachment, {
      remove: await ctx.canPerformAction('attachment.remove', authContext),
    }] as const
  }))

  const resolvedForms = resolveCardForms(ctx, card)
  const formEntries = await Promise.all(resolvedForms.map(async (form) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { formId: form.id })
    return [form.id, {
      submit: await ctx.canPerformAction('form.submit', authContext),
    }] as const
  }))

  const actionEntries = await Promise.all(getCardActionKeys(card.actions).map(async (actionKey) => {
    const authContext = buildTaskPermissionAuthContext(ctx, card, { actionKey })
    return [actionKey, {
      trigger: await ctx.canPerformAction('card.action.trigger', authContext),
    }] as const
  }))

  const commentById = Object.fromEntries(commentEntries)
  const attachmentByName = Object.fromEntries(attachmentEntries)
  const formById = Object.fromEntries(formEntries)
  const actionByKey = Object.fromEntries(actionEntries)

  const commentPermissions = Object.values(commentById)
  const attachmentPermissions = Object.values(attachmentByName)
  const formPermissions = Object.values(formById)
  const actionPermissions = Object.values(actionByKey)

  return {
    comment: {
      create: await ctx.canPerformAction('comment.create', baseContext),
      update: commentPermissions.some(entry => entry.update),
      delete: commentPermissions.some(entry => entry.delete),
      ...(commentEntries.length > 0 ? { byId: commentById } : {}),
    },
    attachment: {
      add: await ctx.canPerformAction('attachment.add', baseContext),
      remove: attachmentPermissions.some(entry => entry.remove),
      ...(attachmentEntries.length > 0 ? { byName: attachmentByName } : {}),
    },
    form: {
      submit: formPermissions.some(entry => entry.submit),
      ...(formEntries.length > 0 ? { byId: formById } : {}),
    },
    checklist: {
      show: await ctx.canPerformAction('card.checklist.show', baseContext),
      add: await ctx.canPerformAction('card.checklist.add', baseContext),
      edit: await ctx.canPerformAction('card.checklist.edit', baseContext),
      delete: await ctx.canPerformAction('card.checklist.delete', baseContext),
      check: await ctx.canPerformAction('card.checklist.check', baseContext),
      uncheck: await ctx.canPerformAction('card.checklist.uncheck', baseContext),
    },
    cardAction: {
      trigger: actionPermissions.some(entry => entry.trigger),
      ...(actionEntries.length > 0 ? { byKey: actionByKey } : {}),
    },
  }
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

async function getMutableCard(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<Card | null> {
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
  const seededTasks = normalizeChecklistSeedTasks(data.tasks)

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

function getChecklistTaskAt(card: Card, index: number): string {
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
  { cardId, text, expectedToken, boardId }: { cardId: string; text: string; expectedToken?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const currentTasks = normalizeChecklistTasks(card.tasks) ?? []
  requireExpectedChecklistToken(currentTasks, expectedToken)

  card.tasks = [...currentTasks, buildChecklistTask(text)]
  return writeChecklistCard(ctx, card)
}

/** Edits the text of an existing checklist item while preserving its checked state. */
export async function editChecklistItem(
  ctx: SDKContext,
  { cardId, index, text, expectedRaw, boardId }: { cardId: string; index: number; text: string; expectedRaw?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedRaw(current, expectedRaw)

  const nextTasks = [...(card.tasks ?? [])]
  nextTasks[index] = buildChecklistTask(text, current.startsWith('- [x]'))
  card.tasks = nextTasks
  return writeChecklistCard(ctx, card)
}

/** Deletes an existing checklist item by index with stale-write protection. */
export async function deleteChecklistItem(
  ctx: SDKContext,
  { cardId, index, expectedRaw, boardId }: { cardId: string; index: number; expectedRaw?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedRaw(current, expectedRaw)

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
  { cardId, index, expectedRaw, boardId }: { cardId: string; index: number; expectedRaw?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedRaw(current, expectedRaw)

  const nextTasks = [...(card.tasks ?? [])]
  nextTasks[index] = setChecklistTaskChecked(current, true)
  card.tasks = nextTasks
  return writeChecklistCard(ctx, card)
}

/** Marks an existing checklist item incomplete with stale-write protection. */
export async function uncheckChecklistItem(
  ctx: SDKContext,
  { cardId, index, expectedRaw, boardId }: { cardId: string; index: number; expectedRaw?: string; boardId?: string }
): Promise<Card> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const current = getChecklistTaskAt(card, index)
  requireExpectedRaw(current, expectedRaw)

  const nextTasks = [...(card.tasks ?? [])]
  nextTasks[index] = setChecklistTaskChecked(current, false)
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
export async function triggerAction(
  ctx: SDKContext,
  { cardId, action, boardId }: { cardId: string; action: string; boardId?: string }
): Promise<{ action: string; board: string; list: string; card: Omit<Card, 'filePath'> }> {
  const card = await getCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const resolvedBoardId = card.boardId || ctx._resolveBoardId(boardId)

  await appendActivityLog(ctx, {
    cardId,
    boardId: resolvedBoardId,
    eventType: 'card.action.triggered',
    text: `Action triggered: \`${action}\``,
    metadata: {
      action,
    },
  }).catch(() => {})

  return {
    action,
    board: resolvedBoardId,
    list: card.status,
    card: sanitizeCard(card),
  }
}

/**
 * Validates and persists a card form submission, then emits `form.submit`.
 */
export async function submitForm(ctx: SDKContext, input: SubmitFormInput): Promise<SubmitFormResult> {
  const card = await getMutableCard(ctx, { cardId: input.cardId, boardId: input.boardId })
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
  const nextCard = normalizeCardChecklistState(card)
  await ctx._storage.writeCard(nextCard)
  await appendActivityLog(ctx, {
    cardId: nextCard.id,
    boardId: resolvedBoardId,
    eventType: 'form.submitted',
    text: `Form submitted: \`${form.name}\``,
    metadata: {
      formId: form.id,
      formName: form.name,
      payload: submittedData,
    },
  }).catch(() => {})

  const persistedCard = await ctx.getCard(nextCard.id, resolvedBoardId) ?? nextCard

  const event: FormSubmitEvent = {
    boardId: resolvedBoardId,
    card: sanitizeCard(persistedCard),
    form,
    data: submittedData,
  }

  return event
}

/**
 * Moves a card to a different status column and/or position within that column.
 */
export async function moveCard(
  ctx: SDKContext,
  { cardId, newStatus, position, boardId }: { cardId: string; newStatus: string; position?: number; boardId?: string }
): Promise<Card> {
  const visibleCard = await getCard(ctx, { cardId, boardId })
  if (!visibleCard) throw new Error(`Card not found: ${cardId}`)

  const cards = await listCardsRaw(ctx, { boardId })
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

  const nextCard = normalizeCardChecklistState(card)

  await ctx._storage.writeCard(nextCard)

  if (oldStatus !== newStatus) {
    const newPath = await ctx._storage.moveCard(nextCard, boardDir, newStatus)
    if (newPath) nextCard.filePath = newPath
  }

  if (oldStatus !== newStatus) {
    await appendActivityLog(ctx, {
      cardId: nextCard.id,
      boardId: resolvedBoardId,
      eventType: 'card.status.changed',
      text: `Status changed: \`${oldStatus}\` → \`${newStatus}\``,
      metadata: {
        previousStatus: oldStatus,
        status: newStatus,
      },
    }).catch(() => {})
  }
  return nextCard
}

/**
 * Soft-deletes a card by moving it to the `deleted` status column.
 */
export async function deleteCard(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<void> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)
  if (card.status === DELETED_STATUS_ID) return
  await updateCard(ctx, { cardId, updates: { status: DELETED_STATUS_ID }, boardId })
}

/**
 * Permanently deletes a card's file from disk.
 */
export async function permanentlyDeleteCard(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<void> {
  const card = await getMutableCard(ctx, { cardId, boardId })
  if (!card) throw new Error(`Card not found: ${cardId}`)
  await ctx._storage.deleteCard(card)
}

/**
 * Returns all cards in a specific status column.
 */
export async function getCardsByStatus(ctx: SDKContext, { status, boardId }: { status: string; boardId?: string }): Promise<Card[]> {
  const cards = await listCards(ctx, { boardId })
  return cards.filter(c => c.status === status)
}

/**
 * Returns a sorted list of unique assignee names across all cards on a board.
 */
export async function getUniqueAssignees(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<string[]> {
  const cards = await listCards(ctx, { boardId })
  const assignees = new Set<string>()
  for (const c of cards) {
    if (c.assignee) assignees.add(c.assignee)
  }
  return [...assignees].sort()
}

/**
 * Returns a sorted list of unique labels across all cards on a board.
 */
export async function getUniqueLabels(ctx: SDKContext, { boardId }: { boardId?: string } = {}): Promise<string[]> {
  const cards = await listCards(ctx, { boardId })
  const labels = new Set<string>()
  for (const c of cards) {
    for (const l of c.labels) labels.add(l)
  }
  return [...labels].sort()
}

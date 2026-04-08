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

import { resolveCardForms, cloneRecord, formAjv, formatValidationErrors } from './helpers'
import { getMutableCard, updateCard, getCard, listCards, listCardsRaw } from './crud'

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


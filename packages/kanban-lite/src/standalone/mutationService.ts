import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { type Comment, type Card, type CardTask, type KanbanColumn, type CardDisplaySettings, type CreateCardPayload } from '../shared/types'
import { serializeCard } from '../sdk/parser'
import { coerceChecklistSeedTasks } from '../sdk/modules/checklist'
import { type SubmitFormInput, type SubmitFormResult } from '../sdk/types'
import type { StandaloneContext } from './context'
import { getAuthErrorLike } from './authUtils'
import { broadcast, buildInitMessage, loadCards } from './broadcastService'
import { buildCardFrontmatter } from './cardHelpers'

/**
 * Reloads `ctx.cards` and broadcasts an init to all WebSocket clients.
 * Skipped when `ctx.skipMutationBroadcast` is set (HTTP sync path) because
 * the pseudo-client is not in `ctx.wss.clients` and the post-sync rebuild
 * handles state refresh.
 */
async function reloadAndBroadcast(ctx: StandaloneContext): Promise<void> {
  if (ctx.skipMutationBroadcast) return
  await loadCards(ctx)
  broadcast(ctx, buildInitMessage(ctx))
}

export type CreateCardData = Omit<CreateCardPayload, 'tasks'> & {
  tasks?: Array<CardTask | string>
}

export async function doCreateCard(ctx: StandaloneContext, data: CreateCardData): Promise<Card> {
  return doCreateCardForBoard(ctx, data)
}

export async function doCreateCardForBoard(ctx: StandaloneContext, data: CreateCardData, boardId = ctx.currentBoardId): Promise<Card> {
  ctx.migrating = true
  try {
    const card = await ctx.sdk.createCard({
      content: data.content,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      dueDate: data.dueDate,
      labels: data.labels,
      tasks: coerceChecklistSeedTasks(data.tasks),
      metadata: data.metadata,
      actions: data.actions,
      forms: data.forms,
      formData: data.formData,
      boardId,
    })
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return card
  } finally {
    ctx.migrating = false
  }
}

export async function doMoveCard(ctx: StandaloneContext, cardId: string, newStatus: string, newOrder: number): Promise<Card | null> {
  const card = await ctx.sdk.getCard(cardId, ctx.currentBoardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.moveCard(cardId, newStatus, newOrder, ctx.currentBoardId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return updated
  } finally {
    ctx.migrating = false
  }
}

export async function doUpdateCard(ctx: StandaloneContext, cardId: string, updates: Partial<Card>): Promise<Card | null> {
  return doUpdateCardForBoard(ctx, cardId, updates)
}

export async function doUpdateCardForBoard(
  ctx: StandaloneContext,
  cardId: string,
  updates: Partial<Card>,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  const card = await ctx.sdk.getCard(cardId, boardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.updateCard(cardId, updates, boardId)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return updated
  } finally {
    ctx.migrating = false
  }
}

async function doChecklistMutationForBoard(
  ctx: StandaloneContext,
  cardId: string,
  mutate: () => Promise<Card>,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  const card = await ctx.sdk.getCard(cardId, boardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await mutate()
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return updated
  } finally {
    ctx.migrating = false
  }
}

export async function doAddChecklistItem(
  ctx: StandaloneContext,
  cardId: string,
  title: string,
  description: string,
  expectedToken: string,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  return doChecklistMutationForBoard(ctx, cardId, () => ctx.sdk.addChecklistItem(cardId, title, description, expectedToken, boardId), boardId)
}

export async function doEditChecklistItem(
  ctx: StandaloneContext,
  cardId: string,
  index: number,
  title: string,
  description: string,
  modifiedAt?: string,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  return doChecklistMutationForBoard(ctx, cardId, () => ctx.sdk.editChecklistItem(cardId, index, title, description, modifiedAt, boardId), boardId)
}

export async function doDeleteChecklistItem(
  ctx: StandaloneContext,
  cardId: string,
  index: number,
  modifiedAt?: string,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  return doChecklistMutationForBoard(ctx, cardId, () => ctx.sdk.deleteChecklistItem(cardId, index, modifiedAt, boardId), boardId)
}

export async function doCheckChecklistItem(
  ctx: StandaloneContext,
  cardId: string,
  index: number,
  modifiedAt?: string,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  return doChecklistMutationForBoard(ctx, cardId, () => ctx.sdk.checkChecklistItem(cardId, index, modifiedAt, boardId), boardId)
}

export async function doUncheckChecklistItem(
  ctx: StandaloneContext,
  cardId: string,
  index: number,
  modifiedAt?: string,
  boardId = ctx.currentBoardId,
): Promise<Card | null> {
  return doChecklistMutationForBoard(ctx, cardId, () => ctx.sdk.uncheckChecklistItem(cardId, index, modifiedAt, boardId), boardId)
}

export async function doSubmitForm(ctx: StandaloneContext, input: SubmitFormInput): Promise<SubmitFormResult> {
  ctx.migrating = true
  try {
    const result = await ctx.sdk.submitForm({
      ...input,
      boardId: input.boardId ?? ctx.currentBoardId,
    })
    await reloadAndBroadcast(ctx)
    return result
  } finally {
    ctx.migrating = false
  }
}

export async function doDeleteCard(ctx: StandaloneContext, cardId: string): Promise<boolean> {
  const card = await ctx.sdk.getCard(cardId, ctx.currentBoardId)
  if (!card) return false

  try {
    await ctx.sdk.deleteCard(cardId, ctx.currentBoardId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return true
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    console.error('Failed to delete card:', err)
    return false
  }
}

export async function doPermanentDeleteCard(ctx: StandaloneContext, cardId: string): Promise<boolean> {
  const card = await ctx.sdk.getCard(cardId, ctx.currentBoardId)
  if (!card) return false

  try {
    await ctx.sdk.permanentlyDeleteCard(cardId, ctx.currentBoardId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return true
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    console.error('Failed to permanently delete card:', err)
    return false
  }
}

export async function doPurgeDeletedCards(ctx: StandaloneContext): Promise<boolean> {
  try {
    await ctx.sdk.purgeDeletedCards(ctx.currentBoardId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return true
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    console.error('Failed to purge deleted cards:', err)
    return false
  }
}

export async function doAddColumn(ctx: StandaloneContext, name: string, color: string): Promise<KanbanColumn> {
  const columns = await ctx.sdk.addColumn({ id: '', name, color }, ctx.currentBoardId)
  const column = columns[columns.length - 1]
  if (!ctx.skipMutationBroadcast) broadcast(ctx, buildInitMessage(ctx))
  return column
}

export async function doEditColumn(ctx: StandaloneContext, columnId: string, updates: { name: string; color: string }): Promise<KanbanColumn | null> {
  try {
    const columns = await ctx.sdk.updateColumn(columnId, { name: updates.name, color: updates.color }, ctx.currentBoardId)
    const updated = columns.find(c => c.id === columnId) ?? null
    if (!ctx.skipMutationBroadcast) broadcast(ctx, buildInitMessage(ctx))
    return updated
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return null
  }
}

export async function doRemoveColumn(ctx: StandaloneContext, columnId: string): Promise<{ removed: boolean; error?: string }> {
  try {
    const columns = ctx.sdk.listColumns(ctx.currentBoardId)
    if (columns.length <= 1) return { removed: false, error: 'Cannot remove last column' }
    const col = columns.find(c => c.id === columnId)
    if (!col) return { removed: false, error: 'Column not found' }
    await ctx.sdk.removeColumn(columnId, ctx.currentBoardId)
    if (!ctx.skipMutationBroadcast) broadcast(ctx, buildInitMessage(ctx))
    return { removed: true }
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return { removed: false, error: String(err) }
  }
}

export async function doCleanupColumn(ctx: StandaloneContext, columnId: string): Promise<boolean> {
  try {
    ctx.migrating = true
    await ctx.sdk.cleanupColumn(columnId, ctx.currentBoardId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return true
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    console.error('Failed to cleanup column:', err)
    return false
  } finally {
    ctx.migrating = false
  }
}

export async function doSaveSettings(ctx: StandaloneContext, newSettings: CardDisplaySettings): Promise<void> {
  await ctx.sdk.updateSettings(newSettings)
  if (!ctx.skipMutationBroadcast) broadcast(ctx, buildInitMessage(ctx))
}

export async function doAddAttachment(ctx: StandaloneContext, cardId: string, filename: string, fileData: Buffer): Promise<boolean> {
  const card = await ctx.sdk.getCard(cardId, ctx.currentBoardId)
  if (!card) return false

  const safeFilename = path.basename(filename) || 'upload.bin'
  ctx.migrating = true
  try {
    const updated = await ctx.sdk.addAttachmentData(cardId, safeFilename, fileData, ctx.currentBoardId)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    if (!ctx.skipMutationBroadcast) await loadCards(ctx)
    return true
  } finally {
    ctx.migrating = false
  }
}

export async function doRemoveAttachment(ctx: StandaloneContext, cardId: string, attachment: string): Promise<Card | null> {
  const card = await ctx.sdk.getCard(cardId, ctx.currentBoardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.removeAttachment(cardId, attachment, ctx.currentBoardId)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return updated
  } finally {
    ctx.migrating = false
  }
}

export async function doAddComment(ctx: StandaloneContext, cardId: string, author: string, content: string): Promise<Comment | null> {
  ctx.migrating = true
  try {
    const updated = await ctx.sdk.addComment(cardId, author, content, ctx.currentBoardId)
    ctx.lastWrittenContent = serializeCard(updated)
    const comment = updated.comments[updated.comments.length - 1]
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return comment
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return null
  } finally {
    ctx.migrating = false
  }
}

export async function doUpdateComment(ctx: StandaloneContext, cardId: string, commentId: string, content: string): Promise<Comment | null> {
  ctx.migrating = true
  try {
    const updated = await ctx.sdk.updateComment(cardId, commentId, content, ctx.currentBoardId)
    ctx.lastWrittenContent = serializeCard(updated)
    const comment = (updated.comments || []).find(c => c.id === commentId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return comment ?? null
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return null
  } finally {
    ctx.migrating = false
  }
}

export async function doDeleteComment(ctx: StandaloneContext, cardId: string, commentId: string): Promise<boolean> {
  const card = await ctx.sdk.getCard(cardId, ctx.currentBoardId)
  if (!card) return false
  const comment = (card.comments || []).find(c => c.id === commentId)
  if (!comment) return false

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.deleteComment(cardId, commentId, ctx.currentBoardId)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await reloadAndBroadcast(ctx)
    return true
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return false
  } finally {
    ctx.migrating = false
  }
}

export async function doAddLog(ctx: StandaloneContext, cardId: string, text: string, source?: string, object?: Record<string, unknown>, timestamp?: string) {
  ctx.migrating = true
  try {
    const entry = await ctx.sdk.addLog(cardId, text, { source, timestamp, object }, ctx.currentBoardId)
    await reloadAndBroadcast(ctx)
    return entry
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return null
  } finally {
    ctx.migrating = false
  }
}

export async function doClearLogs(ctx: StandaloneContext, cardId: string): Promise<boolean> {
  ctx.migrating = true
  try {
    await ctx.sdk.clearLogs(cardId, ctx.currentBoardId)
    await reloadAndBroadcast(ctx)
    return true
  } catch (err) {
    if (getAuthErrorLike(err)) throw err
    return false
  } finally {
    ctx.migrating = false
  }
}

// Re-export type alias for callers
export { buildCardFrontmatter }

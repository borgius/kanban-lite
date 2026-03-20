import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { type Comment, type Card, type KanbanColumn, type CardDisplaySettings, type CreateCardPayload } from '../shared/types'
import { serializeCard } from '../sdk/parser'
import { AuthError, type AuthContext, type SubmitFormInput, type SubmitFormResult } from '../sdk/types'
import type { StandaloneContext } from './context'
import { broadcast, buildInitMessage, loadCards } from './broadcastService'
import { buildCardFrontmatter } from './cardHelpers'

type CreateCardData = CreateCardPayload

export async function doCreateCard(ctx: StandaloneContext, data: CreateCardData, auth?: AuthContext): Promise<Card> {
  ctx.migrating = true
  try {
    const card = await ctx.sdk.createCard({
      content: data.content,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      dueDate: data.dueDate,
      labels: data.labels,
      metadata: data.metadata,
      actions: data.actions,
      forms: data.forms,
      formData: data.formData,
      boardId: ctx.currentBoardId,
    }, auth)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return card
  } finally {
    ctx.migrating = false
  }
}

export async function doMoveCard(ctx: StandaloneContext, cardId: string, newStatus: string, newOrder: number, auth?: AuthContext): Promise<Card | null> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.moveCard(cardId, newStatus, newOrder, ctx.currentBoardId, auth)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return updated
  } finally {
    ctx.migrating = false
  }
}

export async function doUpdateCard(ctx: StandaloneContext, cardId: string, updates: Partial<Card>, auth?: AuthContext): Promise<Card | null> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.updateCard(cardId, updates, ctx.currentBoardId, auth)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return updated
  } finally {
    ctx.migrating = false
  }
}

export async function doSubmitForm(ctx: StandaloneContext, input: SubmitFormInput, auth?: AuthContext): Promise<SubmitFormResult> {
  ctx.migrating = true
  try {
    const result = await ctx.sdk.submitForm({
      ...input,
      boardId: input.boardId ?? ctx.currentBoardId,
    }, auth)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return result
  } finally {
    ctx.migrating = false
  }
}

export async function doDeleteCard(ctx: StandaloneContext, cardId: string, auth?: AuthContext): Promise<boolean> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return false

  try {
    await ctx.sdk.deleteCard(cardId, ctx.currentBoardId, auth)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    console.error('Failed to delete card:', err)
    return false
  }
}

export async function doPermanentDeleteCard(ctx: StandaloneContext, cardId: string, auth?: AuthContext): Promise<boolean> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return false

  try {
    await ctx.sdk.permanentlyDeleteCard(cardId, ctx.currentBoardId, auth)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    console.error('Failed to permanently delete card:', err)
    return false
  }
}

export async function doPurgeDeletedCards(ctx: StandaloneContext, auth?: AuthContext): Promise<boolean> {
  try {
    await ctx.sdk.purgeDeletedCards(ctx.currentBoardId, auth)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return true
  } catch (err) {
    console.error('Failed to purge deleted cards:', err)
    return false
  }
}

export function doAddColumn(ctx: StandaloneContext, name: string, color: string): KanbanColumn {
  const columns = ctx.sdk.addColumn({ id: '', name, color }, ctx.currentBoardId)
  const column = columns[columns.length - 1]
  broadcast(ctx, buildInitMessage(ctx))
  return column
}

export function doEditColumn(ctx: StandaloneContext, columnId: string, updates: { name: string; color: string }): KanbanColumn | null {
  try {
    const columns = ctx.sdk.updateColumn(columnId, { name: updates.name, color: updates.color }, ctx.currentBoardId)
    const updated = columns.find(c => c.id === columnId) ?? null
    broadcast(ctx, buildInitMessage(ctx))
    return updated
  } catch {
    return null
  }
}

export async function doRemoveColumn(ctx: StandaloneContext, columnId: string, auth?: AuthContext): Promise<{ removed: boolean; error?: string }> {
  try {
    const columns = ctx.sdk.listColumns(ctx.currentBoardId)
    if (columns.length <= 1) return { removed: false, error: 'Cannot remove last column' }
    const col = columns.find(c => c.id === columnId)
    if (!col) return { removed: false, error: 'Column not found' }
    await ctx.sdk.removeColumn(columnId, ctx.currentBoardId, auth)
    broadcast(ctx, buildInitMessage(ctx))
    return { removed: true }
  } catch (err) {
    if (err instanceof AuthError) throw err
    return { removed: false, error: String(err) }
  }
}

export async function doCleanupColumn(ctx: StandaloneContext, columnId: string, auth?: AuthContext): Promise<boolean> {
  try {
    ctx.migrating = true
    await ctx.sdk.cleanupColumn(columnId, ctx.currentBoardId, auth)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return true
  } catch (err) {
    console.error('Failed to cleanup column:', err)
    return false
  } finally {
    ctx.migrating = false
  }
}

export function doSaveSettings(ctx: StandaloneContext, newSettings: CardDisplaySettings): void {
  ctx.sdk.updateSettings(newSettings)
  broadcast(ctx, buildInitMessage(ctx))
}

export async function doAddAttachment(ctx: StandaloneContext, cardId: string, filename: string, fileData: Buffer, auth?: AuthContext): Promise<boolean> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return false

  const tempUploadPath = path.join(os.tmpdir(), `kanban-upload-${card.id}-${Date.now()}-${filename}`)
  ctx.migrating = true
  try {
    fs.writeFileSync(tempUploadPath, fileData)
    const updated = await ctx.sdk.addAttachment(cardId, tempUploadPath, ctx.currentBoardId, auth)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    return true
  } finally {
    try { fs.unlinkSync(tempUploadPath) } catch { /* ignore */ }
    ctx.migrating = false
  }
}

export async function doRemoveAttachment(ctx: StandaloneContext, cardId: string, attachment: string, auth?: AuthContext): Promise<Card | null> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return null

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.removeAttachment(cardId, attachment, ctx.currentBoardId, auth)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return updated
  } finally {
    ctx.migrating = false
  }
}

export async function doAddComment(ctx: StandaloneContext, cardId: string, author: string, content: string, auth?: AuthContext): Promise<Comment | null> {
  ctx.migrating = true
  try {
    const updated = await ctx.sdk.addComment(cardId, author, content, ctx.currentBoardId, auth)
    ctx.lastWrittenContent = serializeCard(updated)
    const comment = updated.comments[updated.comments.length - 1]
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return comment
  } catch (err) {
    if (err instanceof AuthError) throw err
    return null
  } finally {
    ctx.migrating = false
  }
}

export async function doUpdateComment(ctx: StandaloneContext, cardId: string, commentId: string, content: string, auth?: AuthContext): Promise<Comment | null> {
  ctx.migrating = true
  try {
    const updated = await ctx.sdk.updateComment(cardId, commentId, content, ctx.currentBoardId, auth)
    ctx.lastWrittenContent = serializeCard(updated)
    const comment = (updated.comments || []).find(c => c.id === commentId)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return comment ?? null
  } catch (err) {
    if (err instanceof AuthError) throw err
    return null
  } finally {
    ctx.migrating = false
  }
}

export async function doDeleteComment(ctx: StandaloneContext, cardId: string, commentId: string, auth?: AuthContext): Promise<boolean> {
  const card = ctx.cards.find(f => f.id === cardId)
  if (!card) return false
  const comment = (card.comments || []).find(c => c.id === commentId)
  if (!comment) return false

  ctx.migrating = true
  try {
    const updated = await ctx.sdk.deleteComment(cardId, commentId, ctx.currentBoardId, auth)
    ctx.lastWrittenContent = serializeCard(updated)
    ctx.suppressWatcherEventsUntil = Math.max(ctx.suppressWatcherEventsUntil, Date.now() + 500)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    return false
  } finally {
    ctx.migrating = false
  }
}

export async function doAddLog(ctx: StandaloneContext, cardId: string, text: string, source?: string, object?: Record<string, unknown>, timestamp?: string, auth?: AuthContext) {
  ctx.migrating = true
  try {
    const entry = await ctx.sdk.addLog(cardId, text, { source, timestamp, object }, ctx.currentBoardId, auth)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return entry
  } catch {
    return null
  } finally {
    ctx.migrating = false
  }
}

export async function doClearLogs(ctx: StandaloneContext, cardId: string, auth?: AuthContext): Promise<boolean> {
  ctx.migrating = true
  try {
    await ctx.sdk.clearLogs(cardId, ctx.currentBoardId, auth)
    await loadCards(ctx)
    broadcast(ctx, buildInitMessage(ctx))
    return true
  } catch {
    return false
  } finally {
    ctx.migrating = false
  }
}

// Re-export type alias for callers
export type { CreateCardData }
export { buildCardFrontmatter }

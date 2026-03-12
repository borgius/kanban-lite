import * as path from 'path'
import type { Card } from '../../shared/types'
import type { SDKContext } from './context'

// --- Attachment management ---

/**
 * Adds a file attachment to a card.
 */
export async function addAttachment(ctx: SDKContext, cardId: string, sourcePath: string, boardId?: string): Promise<Card> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const fileName = path.basename(sourcePath)

  await ctx._storage.copyAttachment(sourcePath, card)

  if (!card.attachments.includes(fileName)) {
    card.attachments.push(fileName)
  }

  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  ctx.emitEvent('attachment.added', { cardId, attachment: fileName })
  return card
}

/**
 * Removes an attachment reference from a card's metadata.
 */
export async function removeAttachment(ctx: SDKContext, cardId: string, attachment: string, boardId?: string): Promise<Card> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  card.attachments = card.attachments.filter(a => a !== attachment)
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  ctx.emitEvent('attachment.removed', { cardId, attachment })
  return card
}

/**
 * Lists all attachment filenames for a card.
 */
export async function listAttachments(ctx: SDKContext, cardId: string, boardId?: string): Promise<string[]> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  return card.attachments
}

/**
 * Returns the absolute path to the attachment directory for a card.
 */
export async function getAttachmentDir(ctx: SDKContext, cardId: string, boardId?: string): Promise<string | null> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) return null
  return ctx._storage.getCardDir(card)
}

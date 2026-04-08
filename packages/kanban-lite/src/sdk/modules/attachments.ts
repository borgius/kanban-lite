import * as fs from 'node:fs/promises'
import * as path from 'path'
import type { Card } from '../../shared/types'
import type { SDKContext } from './context'

// --- Attachment management ---

/**
 * Adds a file attachment to a card.
 */
export async function addAttachment(ctx: SDKContext, { cardId, sourcePath, boardId }: { cardId: string; sourcePath: string; boardId?: string }): Promise<Card> {
  const fileName = path.basename(sourcePath)
  const data = await fs.readFile(sourcePath)
  return addAttachmentData(ctx, { cardId, filename: fileName, data, boardId })
}

/**
 * Adds raw attachment data to a card.
 */
export async function addAttachmentData(
  ctx: SDKContext,
  {
    cardId,
    filename,
    data,
    boardId,
  }: { cardId: string; filename: string; data: string | Uint8Array; boardId?: string },
): Promise<Card> {
  const visibleCard = await ctx.getCard(cardId, boardId)
  if (!visibleCard) throw new Error(`Card not found: ${cardId}`)
  const card = await ctx._getCardRaw(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const fileName = path.basename(filename)

  await ctx.writeAttachment(card, fileName, data)

  if (!card.attachments.includes(fileName)) {
    card.attachments.push(fileName)
  }

  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  return card
}

/**
 * Removes an attachment reference from a card's metadata.
 */
export async function removeAttachment(ctx: SDKContext, { cardId, attachment, boardId }: { cardId: string; attachment: string; boardId?: string }): Promise<Card> {
  const visibleCard = await ctx.getCard(cardId, boardId)
  if (!visibleCard) throw new Error(`Card not found: ${cardId}`)
  const card = await ctx._getCardRaw(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  card.attachments = card.attachments.filter(a => a !== attachment)
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  return card
}

/**
 * Lists all attachment filenames for a card.
 */
export async function listAttachments(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<string[]> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  return card.attachments
}

/**
 * Reads raw attachment data for a card.
 */
export async function getAttachmentData(
  ctx: SDKContext,
  { cardId, filename, boardId }: { cardId: string; filename: string; boardId?: string },
): Promise<{ data: Uint8Array; contentType?: string } | null> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  if (!card.attachments.includes(filename)) {
    return null
  }
  return ctx.readAttachment(card, filename)
}

/**
 * Returns the absolute path to the attachment directory for a card.
 */
export async function getAttachmentDir(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<string | null> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) return null
  return ctx.getAttachmentStoragePath(card)
}

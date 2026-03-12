import type { Card, Comment } from '../../shared/types'
import type { SDKContext } from './context'

// --- Comment management ---

/**
 * Lists all comments on a card.
 */
export async function listComments(ctx: SDKContext, cardId: string, boardId?: string): Promise<Comment[]> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  return card.comments || []
}

/**
 * Adds a comment to a card.
 */
export async function addComment(
  ctx: SDKContext,
  cardId: string,
  author: string,
  content: string,
  boardId?: string
): Promise<Card> {
  if (!content?.trim()) throw new Error('Comment content cannot be empty')
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  if (!card.comments) card.comments = []

  const maxId = card.comments.reduce((max, c) => {
    const num = parseInt(c.id.replace('c', ''), 10)
    return Number.isNaN(num) ? max : Math.max(max, num)
  }, 0)

  const comment: Comment = {
    id: `c${maxId + 1}`,
    author,
    created: new Date().toISOString(),
    content
  }

  card.comments.push(comment)
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  ctx.emitEvent('comment.created', { ...comment, cardId })
  return card
}

/**
 * Updates the content of an existing comment on a card.
 */
export async function updateComment(
  ctx: SDKContext,
  cardId: string,
  commentId: string,
  content: string,
  boardId?: string
): Promise<Card> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const comment = (card.comments || []).find(c => c.id === commentId)
  if (!comment) throw new Error(`Comment not found: ${commentId}`)

  comment.content = content
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  ctx.emitEvent('comment.updated', { ...comment, cardId })
  return card
}

/**
 * Deletes a comment from a card.
 */
export async function deleteComment(
  ctx: SDKContext,
  cardId: string,
  commentId: string,
  boardId?: string
): Promise<Card> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const comment = (card.comments || []).find(c => c.id === commentId)
  card.comments = (card.comments || []).filter(c => c.id !== commentId)
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)

  if (comment) {
    ctx.emitEvent('comment.deleted', { ...comment, cardId })
  }
  return card
}

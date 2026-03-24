import type { Card, Comment } from '../../shared/types'
import type { SDKContext } from './context'
import { appendActivityLog } from './logs'

// --- Comment management ---

/**
 * Lists all comments on a card.
 */
export async function listComments(ctx: SDKContext, { cardId, boardId }: { cardId: string; boardId?: string }): Promise<Comment[]> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)
  return card.comments || []
}

/**
 * Adds a comment to a card.
 */
export async function addComment(
  ctx: SDKContext,
  { cardId, author, content, boardId }: { cardId: string; author: string; content: string; boardId?: string }
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
  await appendActivityLog(ctx, {
    cardId: card.id,
    boardId: card.boardId || ctx._resolveBoardId(boardId),
    eventType: 'comment.created',
    text: `Comment added by \`${author}\``,
    metadata: {
      commentId: comment.id,
      author,
      created: comment.created,
    },
  }).catch(() => {})

  return card
}

/**
 * Updates the content of an existing comment on a card.
 */
export async function updateComment(
  ctx: SDKContext,
  { cardId, commentId, content, boardId }: { cardId: string; commentId: string; content: string; boardId?: string }
): Promise<Card> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const comment = (card.comments || []).find(c => c.id === commentId)
  if (!comment) throw new Error(`Comment not found: ${commentId}`)

  const previousContent = comment.content
  comment.content = content
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)
  await appendActivityLog(ctx, {
    cardId: card.id,
    boardId: card.boardId || ctx._resolveBoardId(boardId),
    eventType: 'comment.updated',
    text: `Comment updated: \`${comment.id}\``,
    metadata: {
      commentId: comment.id,
      author: comment.author,
      previousContent,
      content,
    },
  }).catch(() => {})

  return card
}

/**
 * Deletes a comment from a card.
 */
export async function deleteComment(
  ctx: SDKContext,
  { cardId, commentId, boardId }: { cardId: string; commentId: string; boardId?: string }
): Promise<Card> {
  const card = await ctx.getCard(cardId, boardId)
  if (!card) throw new Error(`Card not found: ${cardId}`)

  const comment = (card.comments || []).find(c => c.id === commentId)
  card.comments = (card.comments || []).filter(c => c.id !== commentId)
  card.modified = new Date().toISOString()
  await ctx._storage.writeCard(card)
  if (comment) {
    await appendActivityLog(ctx, {
      cardId: card.id,
      boardId: card.boardId || ctx._resolveBoardId(boardId),
      eventType: 'comment.deleted',
      text: `Comment deleted: \`${comment.id}\``,
      metadata: {
        commentId: comment.id,
        author: comment.author,
      },
    }).catch(() => {})
  }

  return card
}

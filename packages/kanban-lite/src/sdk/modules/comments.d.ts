import type { Card, Comment } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Lists all comments on a card.
 */
export declare function listComments(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<Comment[]>;
/**
 * Adds a comment to a card.
 */
export declare function addComment(ctx: SDKContext, { cardId, author, content, boardId }: {
    cardId: string;
    author: string;
    content: string;
    boardId?: string;
}): Promise<Card>;
/**
 * Updates the content of an existing comment on a card.
 */
export declare function updateComment(ctx: SDKContext, { cardId, commentId, content, boardId }: {
    cardId: string;
    commentId: string;
    content: string;
    boardId?: string;
}): Promise<Card>;
/**
 * Creates a comment on a card from a streaming text source.
 *
 * Allocates a comment ID immediately, then reads text chunks from the given
 * `AsyncIterable<string>`. After each chunk the optional `onChunk` callback is
 * invoked so callers can broadcast partial content in real-time. When the
 * iterable is exhausted the complete comment is persisted to storage.
 *
 * @param ctx - SDK context.
 * @param options.cardId - ID of the card to comment on.
 * @param options.author - Display name of the author.
 * @param options.stream - Async iterable that yields text chunks.
 * @param options.boardId - Optional board ID override.
 * @param options.onStart - Called once before iteration with the allocated
 *   comment ID and author so the caller can broadcast a stream-start event.
 * @param options.onChunk - Called for each chunk with the comment ID and the
 *   raw chunk string so the caller can broadcast partial content.
 * @returns The updated card after the comment has been persisted.
 *
 * @example
 * // Stream an AI response as a comment
 * await sdk.streamComment('42', 'agent', aiTextStream, {
 *   onChunk: (commentId, chunk) => broadcastCommentChunk(ctx, cardId, commentId, chunk),
 * })
 */
export declare function streamComment(ctx: SDKContext, { cardId, author, boardId, stream, onStart, onChunk, }: {
    cardId: string;
    author: string;
    boardId?: string;
    stream: AsyncIterable<string>;
    onStart?: (commentId: string, author: string, created: string) => void;
    onChunk?: (commentId: string, chunk: string) => void;
}): Promise<Card>;
/**
 * Deletes a comment from a card.
 */
export declare function deleteComment(ctx: SDKContext, { cardId, commentId, boardId }: {
    cardId: string;
    commentId: string;
    boardId?: string;
}): Promise<Card>;

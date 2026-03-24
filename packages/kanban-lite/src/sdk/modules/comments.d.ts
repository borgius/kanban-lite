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
 * Deletes a comment from a card.
 */
export declare function deleteComment(ctx: SDKContext, { cardId, commentId, boardId }: {
    cardId: string;
    commentId: string;
    boardId?: string;
}): Promise<Card>;

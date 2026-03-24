import type { Card } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Adds a file attachment to a card.
 */
export declare function addAttachment(ctx: SDKContext, { cardId, sourcePath, boardId }: {
    cardId: string;
    sourcePath: string;
    boardId?: string;
}): Promise<Card>;
/**
 * Removes an attachment reference from a card's metadata.
 */
export declare function removeAttachment(ctx: SDKContext, { cardId, attachment, boardId }: {
    cardId: string;
    attachment: string;
    boardId?: string;
}): Promise<Card>;
/**
 * Lists all attachment filenames for a card.
 */
export declare function listAttachments(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<string[]>;
/**
 * Returns the absolute path to the attachment directory for a card.
 */
export declare function getAttachmentDir(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<string | null>;

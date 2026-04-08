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
 * Adds raw attachment data to a card.
 */
export declare function addAttachmentData(ctx: SDKContext, { cardId, filename, data, boardId }: {
    cardId: string;
    filename: string;
    data: string | Uint8Array;
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
 * Reads raw attachment data for a card.
 */
export declare function getAttachmentData(ctx: SDKContext, { cardId, filename, boardId }: {
    cardId: string;
    filename: string;
    boardId?: string;
}): Promise<{
    data: Uint8Array;
    contentType?: string;
} | null>;
/**
 * Returns the absolute path to the attachment directory for a card.
 */
export declare function getAttachmentDir(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<string | null>;

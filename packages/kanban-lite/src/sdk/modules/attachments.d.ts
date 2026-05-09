import type { Card } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Adds a file attachment to a card.
 */
export declare function addAttachment(ctx: SDKContext, { cardId, sourcePath }: {
    cardId: string;
    sourcePath: string;
}): Promise<Card>;
/**
 * Adds raw attachment data to a card.
 */
export declare function addAttachmentData(ctx: SDKContext, { cardId, filename, data }: {
    cardId: string;
    filename: string;
    data: string | Uint8Array;
}): Promise<Card>;
/**
 * Removes an attachment reference from a card's metadata.
 */
export declare function removeAttachment(ctx: SDKContext, { cardId, attachment }: {
    cardId: string;
    attachment: string;
}): Promise<Card>;
/**
 * Lists all attachment filenames for a card.
 */
export declare function listAttachments(ctx: SDKContext, { cardId }: {
    cardId: string;
}): Promise<string[]>;
/**
 * Reads raw attachment data for a card.
 */
export declare function getAttachmentData(ctx: SDKContext, { cardId, filename }: {
    cardId: string;
    filename: string;
}): Promise<{
    data: Uint8Array;
    contentType?: string;
} | null>;
/**
 * Returns the absolute path to the attachment directory for a card.
 */
export declare function getAttachmentDir(ctx: SDKContext, { cardId }: {
    cardId: string;
}): Promise<string | null>;

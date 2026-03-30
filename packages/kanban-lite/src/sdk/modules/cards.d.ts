import type { Card, CardSortOption } from '../../shared/types';
import type { CreateCardInput, SubmitFormInput, SubmitFormResult } from '../types';
import type { SDKContext } from './context';
/**
 * Lists all cards on a board, optionally filtered by column/status, metadata,
 * and an internal exact/fuzzy search query.
 */
export declare function listCards(ctx: SDKContext, { columns, boardId, metaFilter, sort, searchQuery, fuzzy }?: {
    columns?: string[];
    boardId?: string;
    metaFilter?: Record<string, string>;
    sort?: CardSortOption;
    searchQuery?: string;
    fuzzy?: boolean;
}): Promise<Card[]>;
/**
 * Retrieves a single card by its ID. Supports partial ID matching.
 */
export declare function getCard(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<Card | null>;
/**
 * Retrieves the card currently marked as active/open in this workspace.
 */
export declare function getActiveCard(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<Card | null>;
/**
 * Marks a card as the active/open card for this workspace.
 */
export declare function setActiveCard(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<Card>;
/**
 * Clears the tracked active/open card for this workspace.
 */
export declare function clearActiveCard(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<void>;
/**
 * Creates a new card on a board.
 */
export declare function createCard(ctx: SDKContext, data: CreateCardInput): Promise<Card>;
/**
 * Updates an existing card's properties.
 */
export declare function updateCard(ctx: SDKContext, { cardId, updates, boardId }: {
    cardId: string;
    updates: Partial<Card>;
    boardId?: string;
}): Promise<Card>;
/**
 * Triggers a named action for a card.
 *
 * Validates the card exists, appends an activity log entry, and returns the
 * action payload. Webhook delivery is handled by the webhook plugin via the
 * `card.action.triggered` after-event emitted by {@link KanbanSDK.triggerAction}.
 */
export declare function triggerAction(ctx: SDKContext, { cardId, action, boardId }: {
    cardId: string;
    action: string;
    boardId?: string;
}): Promise<{
    action: string;
    board: string;
    list: string;
    card: Omit<Card, 'filePath'>;
}>;
/**
 * Validates and persists a card form submission, then emits `form.submit`.
 */
export declare function submitForm(ctx: SDKContext, input: SubmitFormInput): Promise<SubmitFormResult>;
/**
 * Moves a card to a different status column and/or position within that column.
 */
export declare function moveCard(ctx: SDKContext, { cardId, newStatus, position, boardId }: {
    cardId: string;
    newStatus: string;
    position?: number;
    boardId?: string;
}): Promise<Card>;
/**
 * Soft-deletes a card by moving it to the `deleted` status column.
 */
export declare function deleteCard(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<void>;
/**
 * Permanently deletes a card's file from disk.
 */
export declare function permanentlyDeleteCard(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<void>;
/**
 * Returns all cards in a specific status column.
 */
export declare function getCardsByStatus(ctx: SDKContext, { status, boardId }: {
    status: string;
    boardId?: string;
}): Promise<Card[]>;
/**
 * Returns a sorted list of unique assignee names across all cards on a board.
 */
export declare function getUniqueAssignees(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<string[]>;
/**
 * Returns a sorted list of unique labels across all cards on a board.
 */
export declare function getUniqueLabels(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<string[]>;

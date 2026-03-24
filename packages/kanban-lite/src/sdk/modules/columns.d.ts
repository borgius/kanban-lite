import type { KanbanColumn } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Lists all columns defined for a board.
 */
export declare function listColumns(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): KanbanColumn[];
/**
 * Adds a new column to a board.
 */
export declare function addColumn(ctx: SDKContext, { column, boardId }: {
    column: KanbanColumn;
    boardId?: string;
}): KanbanColumn[];
/**
 * Updates the properties of an existing column.
 */
export declare function updateColumn(ctx: SDKContext, { columnId, updates, boardId }: {
    columnId: string;
    updates: Partial<Omit<KanbanColumn, 'id'>>;
    boardId?: string;
}): KanbanColumn[];
/**
 * Removes a column from a board. The column must be empty.
 */
export declare function removeColumn(ctx: SDKContext, { columnId, boardId }: {
    columnId: string;
    boardId?: string;
}): Promise<KanbanColumn[]>;
/**
 * Moves all cards in the specified column to the `deleted` (soft-delete) column.
 */
export declare function cleanupColumn(ctx: SDKContext, { columnId, boardId }: {
    columnId: string;
    boardId?: string;
}): Promise<number>;
/**
 * Permanently deletes all cards currently in the `deleted` column.
 */
export declare function purgeDeletedCards(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<number>;
/**
 * Reorders the columns of a board.
 */
export declare function reorderColumns(ctx: SDKContext, { columnIds, boardId }: {
    columnIds: string[];
    boardId?: string;
}): KanbanColumn[];
/**
 * Returns the minimized column IDs for a board.
 */
export declare function getMinimizedColumns(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): string[];
/**
 * Sets the minimized column IDs for a board, persisting the state to config.
 * Only IDs that correspond to existing columns are retained.
 */
export declare function setMinimizedColumns(ctx: SDKContext, { columnIds, boardId }: {
    columnIds: string[];
    boardId?: string;
}): string[];

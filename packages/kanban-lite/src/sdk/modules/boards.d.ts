import type { Card, KanbanColumn, BoardInfo } from '../../shared/types';
import type { BoardConfig } from '../../shared/config';
import type { Priority } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Lists all boards defined in the workspace configuration.
 */
export declare function listBoards(ctx: SDKContext): BoardInfo[];
/**
 * Creates a new board with the given ID and name.
 */
export declare function createBoard(ctx: SDKContext, { id, name, options }: {
    id: string;
    name: string;
    options?: {
        description?: string;
        columns?: KanbanColumn[];
        defaultStatus?: string;
        defaultPriority?: Priority;
    };
}): BoardInfo;
/**
 * Deletes a board and its directory from the filesystem.
 */
export declare function deleteBoard(ctx: SDKContext, { boardId }: {
    boardId: string;
}): Promise<void>;
/**
 * Retrieves the full configuration for a specific board.
 */
export declare function getBoard(ctx: SDKContext, { boardId }: {
    boardId: string;
}): BoardConfig;
/**
 * Updates properties of an existing board.
 */
export declare function updateBoard(ctx: SDKContext, { boardId, updates }: {
    boardId: string;
    updates: Partial<Omit<BoardConfig, 'nextCardId'>>;
}): BoardConfig;
/**
 * Returns the named actions defined on a board.
 */
export declare function getBoardActions(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Record<string, string>;
/**
 * Adds or updates a named action on a board.
 */
export declare function addBoardAction(ctx: SDKContext, { boardId, key, title }: {
    boardId: string;
    key: string;
    title: string;
}): Record<string, string>;
/**
 * Removes a named action from a board.
 */
export declare function removeBoardAction(ctx: SDKContext, { boardId, key }: {
    boardId: string;
    key: string;
}): Record<string, string>;
/**
 * Fires the `board.action` webhook event for a named board action.
 * Returns the resolved boardId and action title so the SDK can emit the after-event.
 */
export declare function triggerBoardAction(ctx: SDKContext, { boardId, actionKey }: {
    boardId: string;
    actionKey: string;
}): Promise<{
    boardId: string;
    action: string;
    title: string;
}>;
/**
 * Transfers a card from one board to another.
 */
export declare function transferCard(ctx: SDKContext, { cardId, fromBoardId, toBoardId, targetStatus }: {
    cardId: string;
    fromBoardId: string;
    toBoardId: string;
    targetStatus?: string;
}): Promise<Card>;

import type { Card } from '../../shared/types';
import type { LogEntry } from '../../shared/types';
import type { SDKContext } from './context';
export interface PersistedActivityBoundary {
    cardId: string;
    boardId: string;
    logEntry: LogEntry;
    qualifiesForUnread: true;
}
/**
 * Returns the absolute path to the log file for a card.
 */
export declare function getLogFilePath(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<string | null>;
/**
 * Lists all log entries for a card.
 */
export declare function listLogs(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<LogEntry[]>;
/**
 * Lists all log entries for a pre-loaded card without an extra getCard round-trip.
 *
 * Use this in batch operations where the caller already holds the Card object to
 * avoid the redundant listCards scan that the regular listLogs performs internally.
 */
export declare function listLogsForCard(ctx: SDKContext, card: Card): Promise<LogEntry[]>;
/**
 * Adds a log entry to a card.
 */
export declare function addLog(ctx: SDKContext, { cardId, text, options, boardId }: {
    cardId: string;
    text: string;
    options?: {
        source?: string;
        timestamp?: string;
        object?: Record<string, unknown>;
    };
    boardId?: string;
}): Promise<LogEntry>;
/**
 * Appends a readable persisted activity entry that participates in the shared
 * unread-driving log surface.
 */
export declare function appendActivityLog(ctx: SDKContext, { cardId, text, eventType, metadata, boardId, source, timestamp, }: {
    cardId: string;
    text: string;
    eventType: string;
    metadata?: Record<string, unknown>;
    boardId?: string;
    source?: string;
    timestamp?: string;
}): Promise<PersistedActivityBoundary>;
/**
 * Clears all log entries for a card by deleting the `.log` file.
 */
export declare function clearLogs(ctx: SDKContext, { cardId, boardId }: {
    cardId: string;
    boardId?: string;
}): Promise<void>;
/**
 * Returns the absolute path to the board-level log file for a given board.
 */
export declare function getBoardLogFilePath(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): string;
/**
 * Lists all log entries from the board-level log file.
 */
export declare function listBoardLogs(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<LogEntry[]>;
/**
 * Appends a new log entry to the board-level log file.
 */
export declare function addBoardLog(ctx: SDKContext, { text, options, boardId }: {
    text: string;
    options?: {
        source?: string;
        timestamp?: string;
        object?: Record<string, unknown>;
    };
    boardId?: string;
}): Promise<LogEntry>;
/**
 * Clears all log entries for a board by deleting the board-level `board.log` file.
 */
export declare function clearBoardLogs(ctx: SDKContext, { boardId }?: {
    boardId?: string;
}): Promise<void>;

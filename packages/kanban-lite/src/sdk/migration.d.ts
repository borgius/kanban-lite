/**
 * Migrate a v1 single-board file system layout to v2 multi-board layout.
 * Moves status subdirectories from .kanban/{status}/ into .kanban/boards/default/{status}/.
 * Idempotent: if boards/ already exists, this is a no-op.
 */
export declare function migrateFileSystemToMultiBoard(kanbanDir: string): Promise<void>;

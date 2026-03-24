import type { SDKContext } from './context';
/**
 * Migrates all card data from the current storage engine to SQLite.
 */
export declare function migrateToSqlite(ctx: SDKContext, { dbPath }?: {
    dbPath?: string;
}): Promise<number>;
/**
 * Migrates all card data from the current SQLite engine back to markdown files.
 */
export declare function migrateToMarkdown(ctx: SDKContext): Promise<number>;

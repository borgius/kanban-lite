import type { Card } from '../../shared/types';
import type { StorageEngine, StorageEngineType } from './types';
import type { AttachmentStoragePlugin } from './index';
/**
 * Default (markdown-based) storage engine.
 *
 * Cards are persisted as individual `.md` files with YAML frontmatter under
 * `.kanban/boards/{boardId}/{status}/{id}-{slug}.md`. Workspace configuration
 * is stored in `.kanban.json` at the workspace root.
 *
 * @example
 * ```ts
 * const engine = new MarkdownStorageEngine('/path/to/.kanban')
 * await engine.init()
 * ```
 */
export declare class MarkdownStorageEngine implements StorageEngine {
    readonly type: StorageEngineType;
    /** Absolute path to the `.kanban` directory. */
    readonly kanbanDir: string;
    constructor(kanbanDir: string);
    init(): Promise<void>;
    close(): void;
    migrate(): Promise<void>;
    ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void>;
    deleteBoardData(boardDir: string, _boardId: string): Promise<void>;
    /**
     * Scans all card markdown files in a board directory.
     *
     * Reads every `.md` file from every status subdirectory under `boardDir`.
     * Cards whose frontmatter `status` does not match the containing directory
     * are automatically moved to the correct subfolder (reconciliation).
     */
    scanCards(boardDir: string, boardId: string): Promise<Card[]>;
    writeCard(card: Card): Promise<void>;
    moveCard(card: Card, boardDir: string, newStatus: string): Promise<string>;
    renameCard(card: Card, newFilename: string): Promise<string>;
    deleteCard(card: Card): Promise<void>;
    getCardDir(card: Card): string;
    copyAttachment(sourcePath: string, card: Card): Promise<void>;
    private _readMdFiles;
    private _loadCard;
}
/**
 * Built-in attachment-storage plugin for the markdown provider.
 *
 * Delegates attachment directory resolution and file copying to the markdown
 * card-storage engine.
 *
 * @internal
 */
export declare function createMarkdownAttachmentPlugin(engine: MarkdownStorageEngine): AttachmentStoragePlugin;
/**
 * Built-in card-storage plugin for the default markdown (file-backed) provider.
 *
 * Cards are persisted as individual `.md` files under `.kanban/boards/`.
 * This is the default provider when no `plugins['card.storage']` override is set.
 *
 * @internal
 */
export declare const MARKDOWN_PLUGIN: {
    manifest: {
        id: string;
        provides: readonly ["card.storage"];
    };
    createEngine(kanbanDir: string): StorageEngine;
    nodeCapabilities: {
        isFileBacked: boolean;
        getLocalCardPath(card: Card): string | null;
        getWatchGlob(): string | null;
    };
};

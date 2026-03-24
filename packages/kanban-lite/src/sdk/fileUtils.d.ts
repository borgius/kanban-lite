/**
 * Synchronously walks up from `startDir` looking for a workspace root.
 *
 * Preference order:
 * 1. A directory containing `.git` (authoritative project root)
 * 2. The nearest directory containing `.kanban.json`
 * 3. The nearest directory containing `package.json`
 *
 * This ensures monorepo package folders do not shadow the actual repository
 * root when a `.git` directory exists higher up the tree.
 *
 * @param startDir - Directory to start scanning from.
 * @returns The detected workspace root, or `startDir` on no match.
 */
export declare function findWorkspaceRootSync(startDir: string): string;
/**
 * Resolves the workspace root from either an explicit config file path or the
 * current directory tree.
 *
 * @param startDir - Optional directory to start scanning from. Defaults to `process.cwd()`.
 * @param configFilePath - Optional path to a specific `.kanban.json` file.
 * @returns The absolute workspace root path.
 */
export declare function resolveWorkspaceRoot(startDir?: string, configFilePath?: string): string;
/**
 * Resolves the kanban directory without an explicit path by locating the
 * workspace root, then reading `kanbanDirectory` from the effective
 * `.kanban.json` file (defaults to `'.kanban'`).
 *
 * @param startDir - Optional directory to start scanning from. Defaults to `process.cwd()`.
 * @param configFilePath - Optional path to a specific `.kanban.json` file.
 * @returns The absolute path to the kanban directory.
 */
export declare function resolveKanbanDir(startDir?: string, configFilePath?: string): string;
/**
 * Constructs the full file path for a card markdown file.
 *
 * @param kanbanDir - The root kanban directory (e.g., `.kanban`).
 * @param status - The status subdirectory name (e.g., `backlog`, `in-progress`).
 * @param filename - The card filename without the `.md` extension.
 * @returns The absolute path to the card file, including the `.md` extension.
 */
export declare function getCardFilePath(kanbanDir: string, status: string, filename: string): string;
/**
 * Creates the kanban directory if it does not already exist.
 *
 * @param kanbanDir - The root kanban directory path to ensure exists.
 * @returns A promise that resolves when the directory has been created or already exists.
 */
export declare function ensureDirectories(kanbanDir: string): Promise<void>;
/**
 * Creates subdirectories for each status column under the kanban directory.
 *
 * @param kanbanDir - The root kanban directory containing status subdirectories.
 * @param statuses - An array of status names to create as subdirectories.
 * @returns A promise that resolves when all status subdirectories have been created.
 */
export declare function ensureStatusSubfolders(kanbanDir: string, statuses: string[]): Promise<void>;
/**
 * Moves a card file to a new status directory, handling name collisions by
 * appending a numeric suffix (e.g., `card-1.md`, `card-2.md`). Optionally
 * co-moves attachment files from the source directory to the target directory.
 *
 * @param currentPath - The current absolute path of the card file.
 * @param kanbanDir - The root kanban directory.
 * @param newStatus - The target status subdirectory to move the card into.
 * @param attachments - Optional array of attachment filenames to co-move alongside the card.
 * @returns A promise that resolves to the new absolute path of the moved card file.
 */
export declare function moveCardFile(currentPath: string, kanbanDir: string, newStatus: string, attachments?: string[]): Promise<string>;
/**
 * Renames a card file in place within its current directory.
 *
 * @param currentPath - The current absolute path of the card file.
 * @param newFilename - The new filename without the `.md` extension.
 * @returns A promise that resolves to the new absolute path of the renamed card file.
 */
export declare function renameCardFile(currentPath: string, newFilename: string): Promise<string>;
/**
 * Extracts the status from a card's file path by examining the directory structure.
 *
 * Expects the file to be located at `{kanbanDir}/{status}/{filename}.md`. If the
 * relative path does not match this two-level structure, returns `null`.
 *
 * @param filePath - The absolute path to the card file.
 * @param kanbanDir - The root kanban directory used to compute the relative path.
 * @returns The status string extracted from the path, or `null` if the path structure is unexpected.
 */
export declare function getStatusFromPath(filePath: string, kanbanDir: string): string | null;

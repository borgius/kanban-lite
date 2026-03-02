import * as fs from 'fs/promises'
import * as path from 'path'
import type { Card } from '../../shared/types'
import {
  ensureDirectories,
  ensureStatusSubfolders,
  moveCardFile,
  renameCardFile,
} from '../fileUtils'
import { parseCardFile, serializeCard } from '../parser'
import { migrateFileSystemToMultiBoard } from '../migration'
import type { StorageEngine, StorageEngineType } from './types'

/**
 * Default (markdown-based) storage engine.
 *
 * Cards are persisted as individual `.md` files with YAML frontmatter under
 * `.kanban/boards/{boardId}/{status}/{id}-{slug}.md`. Workspace configuration
 * is stored in `.kanban.json` at the workspace root.
 *
 * This engine is backward-compatible with all existing kanban-markdown workspaces.
 *
 * Workspace configuration (boards, columns, labels, settings, webhooks) is stored
 * in `.kanban.json` — the same as it always has been.
 *
 * @example
 * ```ts
 * const engine = new MarkdownStorageEngine('/path/to/.kanban')
 * await engine.init()
 * ```
 */
export class MarkdownStorageEngine implements StorageEngine {
  readonly type: StorageEngineType = 'markdown'

  /**
   * Absolute path to the `.kanban` directory.
   */
  readonly kanbanDir: string

  constructor(kanbanDir: string) {
    this.kanbanDir = kanbanDir
  }

  // --- Lifecycle ---

  async init(): Promise<void> {
    await this.migrate()
  }

  close(): void {
    // No-op – no persistent connections to close for a file-based engine.
  }

  async migrate(): Promise<void> {
    await migrateFileSystemToMultiBoard(this.kanbanDir)
  }

  // --- Board management ---

  async ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void> {
    await ensureDirectories(boardDir)
    if (extraStatuses && extraStatuses.length > 0) {
      await ensureStatusSubfolders(boardDir, extraStatuses)
    }
  }

  async deleteBoardData(boardDir: string, _boardId: string): Promise<void> {
    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // Directory may not exist yet
    }
  }

  // --- Card I/O ---

  /**
   * Scans all card markdown files in a board directory.
   *
   * Reads every `.md` file from every status subdirectory under `boardDir`.
   * Cards whose frontmatter `status` does not match the containing directory
   * are automatically moved to the correct subfolder (reconciliation).
   */
  async scanCards(boardDir: string, boardId: string): Promise<Card[]> {
    // Migrate any flat root .md files into status subdirs (legacy single-board layout)
    try {
      const rootFiles = await this._readMdFiles(boardDir)
      for (const filePath of rootFiles) {
        try {
          const card = await this._loadCard(filePath)
          if (card) {
            await moveCardFile(filePath, boardDir, card.status, card.attachments)
          }
        } catch {
          // best-effort
        }
      }
    } catch {
      // boardDir may not exist yet
    }

    // Load all .md files from subdirectories
    const cards: Card[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(boardDir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return []
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const subdir = path.join(boardDir, entry.name)
      try {
        const mdFiles = await this._readMdFiles(subdir)
        for (const filePath of mdFiles) {
          const card = await this._loadCard(filePath)
          if (card) {
            card.boardId = boardId
            cards.push(card)
          }
        }
      } catch {
        // skip unreadable directories
      }
    }

    // Reconcile status/folder mismatches
    const { getStatusFromPath } = await import('../fileUtils')
    for (const card of cards) {
      const pathStatus = getStatusFromPath(card.filePath, boardDir)
      if (pathStatus !== null && pathStatus !== card.status) {
        try {
          card.filePath = await moveCardFile(card.filePath, boardDir, card.status, card.attachments)
        } catch {
          // retry on next load
        }
      }
    }

    return cards
  }

  async writeCard(card: Card): Promise<void> {
    await fs.mkdir(path.dirname(card.filePath), { recursive: true })
    await fs.writeFile(card.filePath, serializeCard(card), 'utf-8')
  }

  async moveCard(card: Card, boardDir: string, newStatus: string): Promise<string> {
    return moveCardFile(card.filePath, boardDir, newStatus, card.attachments)
  }

  async renameCard(card: Card, newFilename: string): Promise<string> {
    return renameCardFile(card.filePath, newFilename)
  }

  async deleteCard(card: Card): Promise<void> {
    await fs.unlink(card.filePath)
  }

  // --- Attachments ---

  getCardDir(card: Card): string {
    return path.dirname(card.filePath)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const filename = path.basename(sourcePath)
    const cardDir = this.getCardDir(card)
    const destPath = path.join(cardDir, filename)
    const sourceDir = path.dirname(path.resolve(sourcePath))
    if (sourceDir !== cardDir) {
      await fs.copyFile(path.resolve(sourcePath), destPath)
    }
  }

  // --- Private helpers ---

  private async _readMdFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return (entries as import('fs').Dirent[])
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => path.join(dir, e.name))
  }

  private async _loadCard(filePath: string): Promise<Card | null> {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseCardFile(content, filePath)
  }
}

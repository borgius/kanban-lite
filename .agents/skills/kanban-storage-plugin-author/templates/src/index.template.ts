import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface Card {
  id: string
  boardId?: string
  status: string
  filePath?: string
  attachments?: string[]
  [key: string]: unknown
}

export interface StorageEngine {
  readonly type: string
  readonly kanbanDir: string
  init(): Promise<void>
  close(): void
  migrate(): Promise<void>
  ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void>
  deleteBoardData(boardDir: string, boardId: string): Promise<void>
  scanCards(boardDir: string, boardId: string): Promise<Card[]>
  writeCard(card: Card): Promise<void>
  moveCard(card: Card, boardDir: string, newStatus: string): Promise<string>
  renameCard(card: Card, newFilename: string): Promise<string>
  deleteCard(card: Card): Promise<void>
  getCardDir(card: Card): string
  copyAttachment(sourcePath: string, card: Card): Promise<void>
}

interface PluginManifest {
  id: string
  provides: readonly ('card.storage' | 'attachment.storage')[]
}

interface CardStoragePlugin {
  manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  nodeCapabilities?: {
    isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}

interface AttachmentStoragePlugin {
  manifest: PluginManifest
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  getCardDir?(card: Card): string | null
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}

export interface __ENGINE_OPTIONS_NAME__ {
  // Replace with real backend-specific options.
  basePath?: string
}

export class __ENGINE_CLASS_NAME__ implements StorageEngine {
  readonly type = '__PROVIDER_ID__'
  readonly kanbanDir: string

  constructor(kanbanDir: string, private readonly options: __ENGINE_OPTIONS_NAME__ = {}) {
    this.kanbanDir = kanbanDir
  }

  async init(): Promise<void> {
    await this.migrate()
  }

  close(): void {
    // Close pools, DB handles, or network clients here when needed.
  }

  async migrate(): Promise<void> {
    // Create schema or bootstrap storage here.
  }

  async ensureBoardDirs(boardDir: string, _extraStatuses?: string[]): Promise<void> {
    await fs.mkdir(boardDir, { recursive: true })
  }

  async deleteBoardData(_boardDir: string, _boardId: string): Promise<void> {
    // Delete board data from the backing store.
  }

  async scanCards(_boardDir: string, _boardId: string): Promise<Card[]> {
    return []
  }

  async writeCard(_card: Card): Promise<void> {
    // Persist the card here.
  }

  async moveCard(_card: Card, _boardDir: string, _newStatus: string): Promise<string> {
    return ''
  }

  async renameCard(_card: Card, _newFilename: string): Promise<string> {
    return ''
  }

  async deleteCard(_card: Card): Promise<void> {
    // Remove the card from the backing store.
  }

  getCardDir(card: Card): string {
    return path.join(this.kanbanDir, 'attachments', card.boardId ?? 'default', card.status)
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const dir = this.getCardDir(card)
    await fs.mkdir(dir, { recursive: true })
    const filename = path.basename(sourcePath)
    await fs.copyFile(sourcePath, path.join(dir, filename))
  }
}

export const cardStoragePlugin: CardStoragePlugin = {
  manifest: {
    id: '__PROVIDER_ID__',
    provides: ['card.storage'],
  },
  createEngine(kanbanDir: string, options?: Record<string, unknown>) {
    return new __ENGINE_CLASS_NAME__(kanbanDir, (options ?? {}) as __ENGINE_OPTIONS_NAME__)
  },
  nodeCapabilities: {
    isFileBacked: false,
    getLocalCardPath(): string | null {
      return null
    },
    getWatchGlob(): string | null {
      return null
    },
  },
}

// Keep this export only if the same package should also provide attachment.storage.
export const attachmentStoragePlugin: AttachmentStoragePlugin = {
  manifest: {
    id: '__PROVIDER_ID__',
    provides: ['attachment.storage'],
  },
  getCardDir(card: Card): string | null {
    return path.join('__ATTACHMENT_ROOT__', card.boardId ?? 'default', card.status)
  },
  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const dir = path.join('__ATTACHMENT_ROOT__', card.boardId ?? 'default', card.status)
    await fs.mkdir(dir, { recursive: true })
    const filename = path.basename(sourcePath)
    await fs.copyFile(sourcePath, path.join(dir, filename))
  },
}

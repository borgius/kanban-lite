import * as path from 'path'
import { readConfig, writeConfig } from '../../shared/config'
import { getTitleFromContent, generateCardFilename } from '../../shared/types'
import { getCardFilePath } from '../fileUtils'
import type { SDKContext } from './context'

// --- Storage migration ---

/**
 * Migrates all card data from the current storage engine to SQLite.
 */
export async function migrateToSqlite(ctx: SDKContext, dbPath?: string): Promise<number> {
  if (ctx._storage.type === 'sqlite') {
    throw new Error('Storage engine is already sqlite')
  }
  await ctx._ensureMigrated()

  const resolvedDbPath = dbPath ?? '.kanban/kanban.db'
  const absDbPath = path.resolve(ctx.workspaceRoot, resolvedDbPath)

  const { SqliteStorageEngine } = await import('../storage/sqlite')
  const sqliteEngine = new SqliteStorageEngine(ctx._storage.kanbanDir, absDbPath)
  await sqliteEngine.init()

  const config = readConfig(ctx.workspaceRoot)
  const boardIds = Object.keys(config.boards)

  let count = 0
  for (const boardId of boardIds) {
    const boardDir = path.join(ctx._storage.kanbanDir, 'boards', boardId)
    const cards = await ctx._storage.scanCards(boardDir, boardId)
    for (const card of cards) {
      await sqliteEngine.writeCard({ ...card, filePath: '' })
      count++
    }
  }

  sqliteEngine.close()

  writeConfig(ctx.workspaceRoot, { ...config, storageEngine: 'sqlite', sqlitePath: resolvedDbPath })
  ctx.emitEvent('storage.migrated', { from: 'markdown', to: 'sqlite', count })
  return count
}

/**
 * Migrates all card data from the current SQLite engine back to markdown files.
 */
export async function migrateToMarkdown(ctx: SDKContext): Promise<number> {
  if (ctx._storage.type === 'markdown') {
    throw new Error('Storage engine is already markdown')
  }
  await ctx._ensureMigrated()

  const { MarkdownStorageEngine } = await import('../storage/markdown')
  const mdEngine = new MarkdownStorageEngine(ctx._storage.kanbanDir)
  await mdEngine.init()

  const config = readConfig(ctx.workspaceRoot)
  const boardIds = Object.keys(config.boards)

  let count = 0
  for (const boardId of boardIds) {
    const boardDir = path.join(ctx._storage.kanbanDir, 'boards', boardId)
    const cards = await ctx._storage.scanCards(boardDir, boardId)
    for (const card of cards) {
      const numericId = Number(card.id) || 0
      const title = getTitleFromContent(card.content) || card.id
      const filename = generateCardFilename(numericId, title)
      const filePath = getCardFilePath(boardDir, card.status, filename)
      await mdEngine.writeCard({ ...card, filePath })
      count++
    }
  }

  mdEngine.close()

  const { storageEngine: _se, sqlitePath: _sp, ...restConfig } = config as typeof config & { storageEngine?: string; sqlitePath?: string }
  writeConfig(ctx.workspaceRoot, restConfig as typeof config)
  ctx.emitEvent('storage.migrated', { from: 'sqlite', to: 'markdown', count })
  return count
}

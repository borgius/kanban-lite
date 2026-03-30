import * as path from 'path'
import { readConfig, writeConfig } from '../../shared/config'
import type { KanbanConfig } from '../../shared/config'
import { getTitleFromContent, generateCardFilename } from '../../shared/types'
import { getCardFilePath } from '../fileUtils'
import { resolveCapabilityBag } from '../plugins'
import type { StorageEngine } from '../plugins/types'
import type { SDKContext } from './context'

const CARD_BOUND_ATTACHMENT_PROVIDERS = new Set(['sqlite', 'mysql'])

function removeCardStoragePlugin(config: KanbanConfig): KanbanConfig {
  if (!config.plugins?.['card.storage']) return config
  const nextPlugins = { ...config.plugins }
  delete nextPlugins['card.storage']
  return {
    ...config,
    ...(Object.keys(nextPlugins).length > 0 ? { plugins: nextPlugins } : { plugins: undefined }),
  }
}

function removeIncompatibleBuiltInAttachmentPlugin(config: KanbanConfig, targetCardProvider: string): KanbanConfig {
  const attachmentProvider = config.plugins?.['attachment.storage']?.provider
  if (!attachmentProvider || !CARD_BOUND_ATTACHMENT_PROVIDERS.has(attachmentProvider)) return config
  if (attachmentProvider === targetCardProvider) return config

  const nextPlugins = { ...config.plugins }
  delete nextPlugins['attachment.storage']
  return {
    ...config,
    ...(Object.keys(nextPlugins).length > 0 ? { plugins: nextPlugins } : { plugins: undefined }),
  }
}

function getMigrationAttachmentProvider(targetCardProvider: string): { provider: string } {
  return CARD_BOUND_ATTACHMENT_PROVIDERS.has(targetCardProvider)
    ? { provider: targetCardProvider }
    : { provider: 'localfs' }
}

function toTargetCard(card: Awaited<ReturnType<StorageEngine['scanCards']>>[number], boardDir: string, targetEngine: StorageEngine) {
  if (targetEngine.type !== 'markdown') {
    return { ...card, filePath: '' }
  }

  const numericId = Number(card.id) || 0
  const title = getTitleFromContent(card.content) || card.id
  const filename = generateCardFilename(numericId, title)
  const filePath = getCardFilePath(boardDir, card.status, filename)
  return { ...card, filePath }
}

async function migrateToProvider(
  ctx: SDKContext,
  targetProvider: { provider: string; options?: Record<string, unknown> },
): Promise<{ count: number; targetEngine: StorageEngine }> {
  await ctx._ensureMigrated()

  const targetBag = resolveCapabilityBag(
    {
      'card.storage': targetProvider,
      'attachment.storage': getMigrationAttachmentProvider(targetProvider.provider),
    },
    ctx.kanbanDir,
  )
  const targetEngine = targetBag.cardStorage
  await targetEngine.init()

  const config = readConfig(ctx.workspaceRoot)
  const boardIds = Object.keys(config.boards)
  let count = 0

  try {
    for (const boardId of boardIds) {
      const sourceBoardDir = path.join(ctx._storage.kanbanDir, 'boards', boardId)
      const targetBoardDir = path.join(ctx.kanbanDir, 'boards', boardId)
      const cards = await ctx._storage.scanCards(sourceBoardDir, boardId)
      for (const card of cards) {
        await targetEngine.writeCard(toTargetCard(card, targetBoardDir, targetEngine))
        count++
      }
    }

    return { count, targetEngine }
  } catch (err) {
    targetEngine.close()
    throw err
  }
}

// --- Storage migration ---

/**
 * Migrates all card data from the current storage engine to SQLite.
 */
export async function migrateToSqlite(ctx: SDKContext, { dbPath }: { dbPath?: string } = {}): Promise<number> {
  if (ctx._storage.type === 'sqlite') {
    throw new Error('Storage engine is already sqlite')
  }

  const resolvedDbPath = dbPath ?? '.kanban/kanban.db'
  const { count, targetEngine } = await migrateToProvider(ctx, {
    provider: 'sqlite',
    options: { sqlitePath: resolvedDbPath },
  })

  const config = readConfig(ctx.workspaceRoot)
  writeConfig(ctx.workspaceRoot, {
    ...removeIncompatibleBuiltInAttachmentPlugin(removeCardStoragePlugin(config), 'sqlite'),
    storageEngine: 'sqlite',
    sqlitePath: resolvedDbPath,
  })
  targetEngine.close()
  return count
}

/**
 * Migrates all card data from the current SQLite engine back to markdown files.
 */
export async function migrateToMarkdown(ctx: SDKContext): Promise<number> {
  if (ctx._storage.type === 'markdown') {
    throw new Error('Storage engine is already markdown')
  }
  const { count, targetEngine } = await migrateToProvider(ctx, { provider: 'localfs' })

  const config = readConfig(ctx.workspaceRoot)
  targetEngine.close()

  const cleanedConfig = removeIncompatibleBuiltInAttachmentPlugin(removeCardStoragePlugin(config), 'localfs')
  const restConfig = { ...cleanedConfig } as typeof config & { storageEngine?: string; sqlitePath?: string }
  delete restConfig.storageEngine
  delete restConfig.sqlitePath
  writeConfig(ctx.workspaceRoot, restConfig as typeof config)
  return count
}

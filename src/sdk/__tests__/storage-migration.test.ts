import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { readConfig } from '../../shared/config'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-migration-test-'))
}

describe('Storage Engine Migration', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  describe('migrateToSqlite', () => {
    it('migrates cards from markdown to SQLite and updates config', async () => {
      // Set up markdown SDK and create some cards
      const mdSdk = new KanbanSDK(kanbanDir)
      await mdSdk.init()

      await mdSdk.createCard({ content: '# Card A\n\nFirst card.' })
      await mdSdk.createCard({ content: '# Card B\n\nSecond card.', status: 'in-progress' })

      const originalCards = await mdSdk.listCards()
      expect(originalCards).toHaveLength(2)
      expect(mdSdk.storageEngine.type).toBe('markdown')

      // Migrate to SQLite
      const dbPath = path.join(kanbanDir, 'kanban.db')
      const count = await mdSdk.migrateToSqlite(path.relative(workspaceDir, dbPath))
      expect(count).toBe(2)

      // Config should be updated
      const cfg = readConfig(workspaceDir)
      expect(cfg.storageEngine).toBe('sqlite')

      // New SDK instance should use SQLite and see the same cards
      const sqlSdk = new KanbanSDK(kanbanDir)
      await sqlSdk.init()
      expect(sqlSdk.storageEngine.type).toBe('sqlite')

      const migratedCards = await sqlSdk.listCards()
      expect(migratedCards).toHaveLength(2)
      const titles = migratedCards.map(c => c.content.split('\n')[0].replace('# ', ''))
      expect(titles).toContain('Card A')
      expect(titles).toContain('Card B')
      sqlSdk.close()
    })

    it('throws if already using SQLite', async () => {
      const dbPath = path.join(kanbanDir, 'kanban.db')
      const sdk = new KanbanSDK(kanbanDir, { storageEngine: 'sqlite', sqlitePath: dbPath })
      await sdk.init()
      await expect(sdk.migrateToSqlite()).rejects.toThrow('already sqlite')
      sdk.close()
    })
  })

  describe('migrateToMarkdown', () => {
    it('migrates cards from SQLite to markdown and updates config', async () => {
      const dbPath = path.join(kanbanDir, 'kanban.db')
      const sqlSdk = new KanbanSDK(kanbanDir, {
        storageEngine: 'sqlite',
        sqlitePath: path.relative(workspaceDir, dbPath),
      })
      await sqlSdk.init()

      await sqlSdk.createCard({ content: '# Card X\n\nSQLite card.' })
      await sqlSdk.createCard({ content: '# Card Y\n\nAnother card.' })

      const originalCards = await sqlSdk.listCards()
      expect(originalCards).toHaveLength(2)

      const count = await sqlSdk.migrateToMarkdown()
      expect(count).toBe(2)
      sqlSdk.close()

      // Config should be updated (no storageEngine key or 'markdown')
      const cfg = readConfig(workspaceDir)
      expect(cfg.storageEngine).toBeUndefined()

      // New SDK instance should use markdown
      const mdSdk = new KanbanSDK(kanbanDir)
      await mdSdk.init()
      expect(mdSdk.storageEngine.type).toBe('markdown')

      const migratedCards = await mdSdk.listCards()
      expect(migratedCards).toHaveLength(2)
      // All cards should have file paths
      expect(migratedCards.every(c => c.filePath.endsWith('.md'))).toBe(true)
    })

    it('throws if already using markdown', async () => {
      const sdk = new KanbanSDK(kanbanDir)
      await sdk.init()
      await expect(sdk.migrateToMarkdown()).rejects.toThrow('already markdown')
    })
  })

  describe('round-trip migration', () => {
    it('preserves card data through markdown → sqlite → markdown', async () => {
      const sdk = new KanbanSDK(kanbanDir)
      await sdk.init()

      await sdk.createCard({
        content: '# Round Trip Card\n\nBody text.',
        priority: 'high',
        assignee: 'alice',
        labels: ['important'],
      })

      // Markdown → SQLite
      const dbPath = path.join(kanbanDir, 'kanban.db')
      await sdk.migrateToSqlite(path.relative(workspaceDir, dbPath))

      const sqlSdk = new KanbanSDK(kanbanDir)
      await sqlSdk.init()
      const afterSqlite = await sqlSdk.listCards()
      expect(afterSqlite).toHaveLength(1)
      expect(afterSqlite[0].priority).toBe('high')
      expect(afterSqlite[0].assignee).toBe('alice')
      expect(afterSqlite[0].labels).toEqual(['important'])

      // SQLite → Markdown
      await sqlSdk.migrateToMarkdown()
      sqlSdk.close()

      const mdSdk2 = new KanbanSDK(kanbanDir)
      await mdSdk2.init()
      const afterMarkdown = await mdSdk2.listCards()
      expect(afterMarkdown).toHaveLength(1)
      expect(afterMarkdown[0].priority).toBe('high')
      expect(afterMarkdown[0].assignee).toBe('alice')
      expect(afterMarkdown[0].labels).toEqual(['important'])
    })
  })
})

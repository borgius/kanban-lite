/**
 * Live integration tests for kl-mysql-storage.
 *
 * Prerequisites:
 *   - A running MySQL server accessible via the environment variables below.
 *   - mysql2 installed: npm install mysql2
 *
 * Environment variables (all optional, with safe defaults for local dev):
 *   MYSQL_HOST      (default: '127.0.0.1')
 *   MYSQL_PORT      (default: '3306')
 *   MYSQL_USER      (default: 'root')
 *   MYSQL_PASSWORD  (default: '')
 *   MYSQL_DATABASE  (default: 'kanban_test')
 *
 * Run with:
 *   npm run test:integration
 *
 * Or with docker-compose:
 *   docker compose -f docker-compose.test.yml up -d
 *   npm run test:integration
 *   docker compose -f docker-compose.test.yml down
 */

import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MysqlStorageEngine, cardStoragePlugin, attachmentStoragePlugin, createMysqlAttachmentPlugin } from './index.js'
import type { Card } from './index.js'

// ---------------------------------------------------------------------------
// Skip guard — skip all tests when MySQL is not reachable
// ---------------------------------------------------------------------------

const MYSQL_HOST = process.env['MYSQL_HOST'] ?? '127.0.0.1'
const MYSQL_PORT = parseInt(process.env['MYSQL_PORT'] ?? '3306', 10)
const MYSQL_USER = process.env['MYSQL_USER'] ?? 'root'
const MYSQL_PASSWORD = process.env['MYSQL_PASSWORD'] ?? ''
const MYSQL_DATABASE = process.env['MYSQL_DATABASE'] ?? 'kanban_test'

const CONN_CONFIG = {
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
}

async function isMysqlAvailable(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mysql2 = require('mysql2/promise') as { createPool: (c: Record<string, unknown>) => { execute: (s: string) => Promise<unknown>; end: () => Promise<void> } }
    const pool = mysql2.createPool({ ...CONN_CONFIG, connectionLimit: 1 })
    await pool.execute('SELECT 1')
    await pool.end()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('kl-mysql-storage integration', () => {
  let available = false
  let kanbanDir: string
  let engine: MysqlStorageEngine

  beforeAll(async () => {
    available = await isMysqlAvailable()
    if (!available) {
      console.warn(
        '[kl-mysql-storage] MySQL not reachable at ' +
        `${MYSQL_HOST}:${MYSQL_PORT} — skipping live integration tests.\n` +
        'Start MySQL with: docker compose -f docker-compose.test.yml up -d'
      )
      return
    }

    kanbanDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-mysql-test-'))
    engine = new MysqlStorageEngine(kanbanDir, CONN_CONFIG)
    await engine.init()

    // Clean test data from any previous run
    const pool = (engine as unknown as { _pool: { execute: (s: string, p?: unknown[]) => Promise<unknown> } })._pool
    if (pool) {
      await pool.execute('DELETE FROM kanban_cards WHERE board_id = ?', ['test-board'])
      await pool.execute('DELETE FROM kanban_comments WHERE board_id = ?', ['test-board'])
    }
  })

  afterAll(async () => {
    if (!available) return
    engine.close()
    await fs.rm(kanbanDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    if (!available) return
  })

  // ---------------------------------------------------------------------------
  // Plugin manifest shape
  // ---------------------------------------------------------------------------

  it('cardStoragePlugin has correct manifest', () => {
    expect(cardStoragePlugin.manifest.id).toBe('mysql')
    expect(cardStoragePlugin.manifest.provides).toContain('card.storage')
  })

  it('attachmentStoragePlugin has correct manifest', () => {
    expect(attachmentStoragePlugin.manifest.id).toBe('mysql')
    expect(attachmentStoragePlugin.manifest.provides).toContain('attachment.storage')
  })

  it('cardStoragePlugin.nodeCapabilities are non-file-backed', () => {
    expect(cardStoragePlugin.nodeCapabilities?.isFileBacked).toBe(false)
    expect(cardStoragePlugin.nodeCapabilities?.getLocalCardPath({} as Card)).toBeNull()
    expect(cardStoragePlugin.nodeCapabilities?.getWatchGlob()).toBeNull()
  })

  it('cardStoragePlugin.createEngine throws when database option is missing', () => {
    expect(() => cardStoragePlugin.createEngine('/tmp/test', {})).toThrow('database')
  })

  it('cardStoragePlugin.createEngine creates a MysqlStorageEngine', () => {
    const eng = cardStoragePlugin.createEngine('/tmp/test', { database: 'test_db' })
    expect(eng.type).toBe('mysql')
    eng.close()
  })

  it('createMysqlAttachmentPlugin throws when engine type is not mysql', () => {
    const fakeEngine = { type: 'sqlite' } as MysqlStorageEngine
    expect(() => createMysqlAttachmentPlugin(fakeEngine)).toThrow('mysql')
  })

  // ---------------------------------------------------------------------------
  // Live backend tests (skipped when MySQL is not available)
  // ---------------------------------------------------------------------------

  it('engine type is mysql', () => {
    if (!available) return
    expect(engine.type).toBe('mysql')
  })

  it('creates schema tables without error', async () => {
    if (!available) return
    // migrate() is idempotent — running again must not throw
    await expect(engine.migrate()).resolves.not.toThrow()
  })

  it('writes and reads a card round-trip', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const card: Card = {
      id: 'card-rt-01',
      boardId: 'test-board',
      version: 2,
      status: 'backlog',
      priority: 'medium',
      created: now,
      modified: now,
      labels: ['tag-a', 'tag-b'],
      attachments: [],
      order: 'a1',
      content: '# Hello\nworld',
      comments: [],
    }

    await engine.writeCard(card)
    const cards = await engine.scanCards('', 'test-board')
    const found = cards.find(c => c.id === 'card-rt-01')
    expect(found).toBeDefined()
    expect(found?.content).toBe('# Hello\nworld')
    expect(found?.labels).toEqual(['tag-a', 'tag-b'])
    expect(found?.priority).toBe('medium')
    await engine.deleteCard(card)
  })

  it('updates a card via upsert', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const card: Card = {
      id: 'card-upsert-01',
      boardId: 'test-board',
      version: 2,
      status: 'backlog',
      priority: 'low',
      created: now,
      modified: now,
      labels: [],
      attachments: [],
      content: 'original',
      comments: [],
    }

    await engine.writeCard(card)
    const updated: Card = { ...card, content: 'updated', modified: new Date().toISOString() }
    await engine.writeCard(updated)

    const cards = await engine.scanCards('', 'test-board')
    const found = cards.find(c => c.id === 'card-upsert-01')
    expect(found?.content).toBe('updated')
    await engine.deleteCard(card)
  })

  it('moves a card to a new status', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const card: Card = {
      id: 'card-move-01',
      boardId: 'test-board',
      version: 2,
      status: 'backlog',
      priority: 'medium',
      created: now,
      modified: now,
      labels: [],
      attachments: [],
      content: '',
      comments: [],
    }

    await engine.writeCard(card)
    await engine.moveCard({ ...card }, '', 'in-progress')
    const cards = await engine.scanCards('', 'test-board')
    const found = cards.find(c => c.id === 'card-move-01')
    expect(found?.status).toBe('in-progress')
    await engine.deleteCard({ ...card, status: 'in-progress' })
  })

  it('deletes a card', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const card: Card = {
      id: 'card-del-01',
      boardId: 'test-board',
      version: 2,
      status: 'backlog',
      priority: 'high',
      created: now,
      modified: now,
      labels: [],
      attachments: [],
      content: '',
      comments: [],
    }

    await engine.writeCard(card)
    await engine.deleteCard(card)
    const cards = await engine.scanCards('', 'test-board')
    expect(cards.find(c => c.id === 'card-del-01')).toBeUndefined()
  })

  it('stores and retrieves comments', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const card: Card = {
      id: 'card-cmt-01',
      boardId: 'test-board',
      version: 2,
      status: 'backlog',
      priority: 'medium',
      created: now,
      modified: now,
      labels: [],
      attachments: [],
      content: '',
      comments: [
        { id: 'cmt-1', author: 'alice', created: now, content: 'First comment' },
        { id: 'cmt-2', author: 'bob', created: now, content: 'Second comment' },
      ],
    }

    await engine.writeCard(card)
    const cards = await engine.scanCards('', 'test-board')
    const found = cards.find(c => c.id === 'card-cmt-01')
    expect(found?.comments).toHaveLength(2)
    expect(found?.comments?.[0]?.author).toBe('alice')
    expect(found?.comments?.[1]?.content).toBe('Second comment')
    await engine.deleteCard(card)
  })

  it('stores and retrieves metadata', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const card: Card = {
      id: 'card-meta-01',
      boardId: 'test-board',
      version: 2,
      status: 'backlog',
      priority: 'medium',
      created: now,
      modified: now,
      labels: [],
      attachments: [],
      content: '',
      comments: [],
      metadata: { jira: 'PROJ-123', sprint: 42 },
    }

    await engine.writeCard(card)
    const cards = await engine.scanCards('', 'test-board')
    const found = cards.find(c => c.id === 'card-meta-01')
    expect(found?.metadata?.['jira']).toBe('PROJ-123')
    expect(found?.metadata?.['sprint']).toBe(42)
    await engine.deleteCard(card)
  })

  it('deleteBoardData removes all board cards', async () => {
    if (!available) return
    const now = new Date().toISOString()
    const boardId = 'test-board-del'

    for (const id of ['del-01', 'del-02']) {
      await engine.writeCard({
        id,
        boardId,
        version: 2,
        status: 'backlog',
        priority: 'low',
        created: now,
        modified: now,
        labels: [],
        attachments: [],
        content: '',
        comments: [],
      })
    }

    const boardDir = path.join(kanbanDir, 'boards', boardId)
    await engine.deleteBoardData(boardDir, boardId)
    const remaining = await engine.scanCards('', boardId)
    expect(remaining).toHaveLength(0)
  })

  it('attachment plugin getCardDir returns local path', async () => {
    if (!available) return
    const attPlugin = createMysqlAttachmentPlugin(engine)
    const card: Card = {
      id: 'card-att-01',
      boardId: 'test-board',
      status: 'backlog',
      priority: 'medium',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    }
    const dir = attPlugin.getCardDir?.(card)
    expect(dir).toContain('attachments')
    expect(dir).toContain('test-board')
  })

  it('attachment plugin copies a file to local dir', async () => {
    if (!available) return
    const attPlugin = createMysqlAttachmentPlugin(engine)
    const card: Card = {
      id: 'card-att-copy-01',
      boardId: 'test-board',
      status: 'backlog',
      priority: 'medium',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    }

    const tmpFile = path.join(os.tmpdir(), 'kl-mysql-att-test.txt')
    await fs.writeFile(tmpFile, 'hello attachment')

    await attPlugin.copyAttachment(tmpFile, card)

    const cardDir = attPlugin.getCardDir!(card)!
    const files = await fs.readdir(cardDir)
    expect(files).toContain('kl-mysql-att-test.txt')

    // Cleanup
    await fs.rm(path.dirname(cardDir), { recursive: true, force: true })
    await fs.rm(tmpFile, { force: true })
  })
})

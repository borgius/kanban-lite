/**
 * Live integration tests for kl-plugin-storage-postgresql.
 *
 * Prerequisites:
 *   - A running PostgreSQL server accessible via the environment variables below.
 *   - pg installed: npm install pg
 *
 * Environment variables (all optional, with safe defaults for local dev):
 *   PG_HOST      (default: '127.0.0.1')
 *   PG_PORT      (default: '5432')
 *   PG_USER      (default: 'postgres')
 *   PG_PASSWORD  (default: 'postgres')
 *   PG_DATABASE  (default: 'kanban_test')
 *
 * Run with:
 *   npm run test:integration:service
 *
 * Or with docker-compose:
 *   docker compose -f docker-compose.test.yml up -d
 *   npm run test:integration:service
 *   docker compose -f docker-compose.test.yml down
 */

import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgresqlStorageEngine, cardStoragePlugin, attachmentStoragePlugin, createPostgresqlAttachmentPlugin } from './index.js'
import type { Card } from './index.js'

// ---------------------------------------------------------------------------
// Skip guard — skip all tests when PostgreSQL is not reachable
// ---------------------------------------------------------------------------

const PG_HOST = process.env['PG_HOST'] ?? '127.0.0.1'
const PG_PORT = parseInt(process.env['PG_PORT'] ?? '5432', 10)
const PG_USER = process.env['PG_USER'] ?? 'postgres'
const PG_PASSWORD = process.env['PG_PASSWORD'] ?? 'postgres'
const PG_DATABASE = process.env['PG_DATABASE'] ?? 'kanban_test'

const CONN_CONFIG = {
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

async function isPostgresAvailable(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as { Pool: new (c: Record<string, unknown>) => { query: (s: string) => Promise<unknown>; end: () => Promise<void> } }
    const pool = new Pool({ ...CONN_CONFIG, max: 1 })
    await pool.query('SELECT 1')
    await pool.end()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('kl-plugin-storage-postgresql integration', () => {
  let available = false
  let kanbanDir: string
  let engine: PostgresqlStorageEngine

  beforeAll(async () => {
    available = await isPostgresAvailable()
    if (!available) {
      console.warn(
        '[kl-plugin-storage-postgresql] PostgreSQL not reachable at ' +
        `${PG_HOST}:${PG_PORT} — skipping live integration tests.\n` +
        'Start PostgreSQL with: docker compose -f docker-compose.test.yml up -d'
      )
      return
    }

    kanbanDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-pg-test-'))
    engine = new PostgresqlStorageEngine(kanbanDir, CONN_CONFIG)
    await engine.init()

    // Clean test data from any previous run
    const pool = (engine as unknown as { _pool: { query: (s: string, p?: unknown[]) => Promise<unknown> } })._pool
    if (pool) {
      await pool.query('DELETE FROM kanban_cards WHERE board_id = $1', ['test-board'])
      await pool.query('DELETE FROM kanban_comments WHERE board_id = $1', ['test-board'])
    }
  })

  afterAll(async () => {
    if (!available) return
    engine.close()
    await fs.rm(kanbanDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // Plugin manifest shape
  // ---------------------------------------------------------------------------

  it('cardStoragePlugin has correct manifest', () => {
    expect(cardStoragePlugin.manifest.id).toBe('postgresql')
    expect(cardStoragePlugin.manifest.provides).toContain('card.storage')
  })

  it('attachmentStoragePlugin has correct manifest', () => {
    expect(attachmentStoragePlugin.manifest.id).toBe('postgresql')
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

  it('cardStoragePlugin.createEngine creates a PostgresqlStorageEngine', () => {
    const eng = cardStoragePlugin.createEngine('/tmp/test', { database: 'test_db' })
    expect(eng.type).toBe('postgresql')
    eng.close()
  })

  it('createPostgresqlAttachmentPlugin throws when engine type is not postgresql', () => {
    const fakeEngine = { type: 'sqlite' } as PostgresqlStorageEngine
    expect(() => createPostgresqlAttachmentPlugin(fakeEngine)).toThrow('postgresql')
  })

  // ---------------------------------------------------------------------------
  // Live backend tests (skipped when PostgreSQL is not available)
  // ---------------------------------------------------------------------------

  it('engine type is postgresql', () => {
    if (!available) return
    expect(engine.type).toBe('postgresql')
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
    const attPlugin = createPostgresqlAttachmentPlugin(engine)
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
    const attPlugin = createPostgresqlAttachmentPlugin(engine)
    const card: Card = {
      id: 'card-att-copy-01',
      boardId: 'test-board',
      status: 'backlog',
      priority: 'medium',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    }

    const tmpFile = path.join(os.tmpdir(), 'kl-pg-att-test.txt')
    await fs.writeFile(tmpFile, 'hello attachment')

    await attPlugin.copyAttachment(tmpFile, card)

    const cardDir = attPlugin.getCardDir!(card)!
    const files = await fs.readdir(cardDir)
    expect(files).toContain('kl-pg-att-test.txt')

    // Cleanup
    await fs.rm(path.dirname(cardDir), { recursive: true, force: true })
    await fs.rm(tmpFile, { force: true })
  })
})

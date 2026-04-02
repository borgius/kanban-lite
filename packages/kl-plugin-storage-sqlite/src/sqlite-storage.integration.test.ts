import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachmentStoragePlugin, cardStoragePlugin, SqliteStorageEngine, type Card } from './index'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-storage-sqlite-test-'))
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 1,
    id: '1',
    boardId: 'default',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    tasks: undefined,
    comments: [],
    order: 'a0',
    content: '# Test Card\n\nDescription.',
    filePath: '',
    ...overrides,
  }
}

describe('kl-plugin-storage-sqlite integration', () => {
  let workspaceDir: string
  let kanbanDir: string
  let dbPath: string
  let engine: SqliteStorageEngine

  beforeEach(async () => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    dbPath = path.join(kanbanDir, 'kanban.db')
    fs.mkdirSync(kanbanDir, { recursive: true })
    engine = cardStoragePlugin.createEngine(kanbanDir, { sqlitePath: dbPath })
    await engine.init()
  })

  afterEach(() => {
    engine.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('exports both plugins with provider id sqlite', () => {
    expect(cardStoragePlugin.manifest.id).toBe('sqlite')
    expect(cardStoragePlugin.manifest.provides).toEqual(['card.storage'])
    expect(cardStoragePlugin.nodeCapabilities.isFileBacked).toBe(false)
    expect(cardStoragePlugin.nodeCapabilities.getLocalCardPath(makeCard())).toBeNull()
    expect(cardStoragePlugin.nodeCapabilities.getWatchGlob()).toBeNull()

    expect(attachmentStoragePlugin.manifest.id).toBe('sqlite')
    expect(attachmentStoragePlugin.manifest.provides).toEqual(['attachment.storage'])
  })

  it('has type === sqlite', () => {
    expect(engine.type).toBe('sqlite')
  })

  it('creates the database file on init', () => {
    expect(fs.existsSync(dbPath)).toBe(true)
  })

  it('creates the expected schema and schema version', () => {
    const db = new Database(dbPath, { readonly: true })
    const versionRow = db.prepare('SELECT version FROM schema_version').get() as { version: number }
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    const cardColumns = (db.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>).map((row) => row.name)
    db.close()

    expect(versionRow.version).toBe(3)
    expect(tables).toEqual(expect.arrayContaining([
      'schema_version',
      'workspace',
      'boards',
      'cards',
      'comments',
      'labels',
      'webhooks',
    ]))
    expect(cardColumns).toContain('tasks')
  })

  it('writes a card and reads it back', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    await engine.writeCard(makeCard())

    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe('1')
    expect(cards[0].status).toBe('backlog')
    expect(cards[0].filePath).toBe('')
  })

  it('upserts a card on repeated write', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    const card = makeCard()
    await engine.writeCard(card)
    await engine.writeCard({ ...card, priority: 'high' })

    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards).toHaveLength(1)
    expect(cards[0].priority).toBe('high')
  })

  it('round-trips labels and metadata', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    await engine.writeCard(makeCard({ labels: ['bug', 'urgent'], metadata: { sprint: '2026-Q1', estimate: 5 } }))

    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards[0].labels).toEqual(['bug', 'urgent'])
    expect(cards[0].metadata).toEqual({ sprint: '2026-Q1', estimate: 5 })
  })

  it('round-trips checklist tasks', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    await engine.writeCard(makeCard({
      labels: ['tasks', 'in-progress'],
      tasks: ['- [ ] reproduce', '- [x] verify'],
    }))

    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards[0].tasks).toEqual(['- [ ] reproduce', '- [x] verify'])
    expect(cards[0].labels).toEqual(['tasks', 'in-progress'])
  })

  it('round-trips forms and formData', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    const card = makeCard({
      forms: [
        { name: 'bug-report' },
        {
          schema: {
            type: 'object',
            title: 'Inline Form',
            properties: {
              severity: { type: 'string' },
            },
          },
          ui: { type: 'VerticalLayout' },
          data: { severity: 'medium' },
        },
      ],
      formData: {
        'bug-report': { severity: 'high' },
        'inline-form': { severity: 'medium' },
      },
    })

    await engine.writeCard(card)
    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards[0].forms).toEqual(card.forms)
    expect(cards[0].formData).toEqual(card.formData)
  })

  it('upserts nested form-aware fields without losing structure', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    const original = makeCard({
      id: 'form-upsert',
      forms: [{
        name: 'triage',
        schema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
          },
        },
      }],
      formData: {
        triage: {
          owner: 'alice',
          checklist: ['repro'],
          details: { severity: 'medium' },
        },
      },
    })
    await engine.writeCard(original)

    const updated = {
      ...original,
      forms: [
        ...original.forms!,
        {
          schema: {
            type: 'object',
            title: 'Resolution',
            properties: {
              summary: { type: 'string' },
            },
          },
        },
      ],
      formData: {
        triage: {
          owner: 'bob',
          checklist: ['repro', 'fix-verified'],
          details: { severity: 'high', escalated: true },
        },
        resolution: {
          summary: 'Patched',
        },
      },
    }

    await engine.writeCard(updated)
    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards).toHaveLength(1)
    expect(cards[0].forms).toEqual(updated.forms)
    expect(cards[0].formData).toEqual(updated.formData)
  })

  it('round-trips comments', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    const card = makeCard({
      comments: [{
        id: 'c1',
        author: 'alice',
        created: '2025-01-01T00:00:00.000Z',
        content: 'Hello!',
      }],
    })

    await engine.writeCard(card)
    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards[0].comments).toHaveLength(1)
    expect(cards[0].comments[0].id).toBe('c1')
    expect(cards[0].comments[0].content).toBe('Hello!')
  })

  it('scans only cards for the requested board', async () => {
    const boardDirA = path.join(kanbanDir, 'boards', 'default')
    const boardDirB = path.join(kanbanDir, 'boards', 'other')
    await engine.writeCard(makeCard({ id: '1', boardId: 'default' }))
    await engine.writeCard(makeCard({ id: '2', boardId: 'other' }))

    const cardsA = await engine.scanCards(boardDirA, 'default')
    const cardsB = await engine.scanCards(boardDirB, 'other')
    expect(cardsA).toHaveLength(1)
    expect(cardsA[0].id).toBe('1')
    expect(cardsB).toHaveLength(1)
    expect(cardsB[0].id).toBe('2')
  })

  it('updates card status in the database when moved', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    const card = makeCard({ status: 'backlog' })
    await engine.writeCard(card)

    const movedCard = { ...card, status: 'in-progress' }
    const newPath = await engine.moveCard(movedCard, boardDir, 'in-progress')
    expect(newPath).toBe('')

    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards[0].status).toBe('in-progress')
  })

  it('renameCard is a no-op and returns empty string', async () => {
    const card = makeCard()
    await engine.writeCard(card)
    await expect(engine.renameCard(card, 'new-name')).resolves.toBe('')
  })

  it('deletes cards and associated comments', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    const card = makeCard({
      comments: [{ id: 'c1', author: 'alice', created: '2025-01-01T00:00:00.000Z', content: 'Hi' }],
    })
    await engine.writeCard(card)

    await engine.deleteCard(card)
    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards).toHaveLength(0)
  })

  it('removes all cards for a board via deleteBoardData', async () => {
    const boardDir = path.join(kanbanDir, 'boards', 'default')
    await engine.writeCard(makeCard({ id: '1', boardId: 'default' }))
    await engine.writeCard(makeCard({ id: '2', boardId: 'default' }))

    await engine.deleteBoardData(boardDir, 'default')
    const cards = await engine.scanCards(boardDir, 'default')
    expect(cards).toHaveLength(0)
  })

  it('returns the attachments directory for a card', () => {
    const dir = engine.getCardDir(makeCard({ boardId: 'default', id: '1', status: 'backlog' }))
    expect(dir).toContain('attachments')
    expect(dir).toContain('default')
    expect(dir).toContain('backlog')
  })

  it('copies and materializes attachments through the sqlite attachment plugin', async () => {
    const sourcePath = path.join(workspaceDir, 'sample.txt')
    await fsp.writeFile(sourcePath, 'hello sqlite attachment', 'utf-8')

    const card = makeCard({ attachments: ['sample.txt'] })
    await attachmentStoragePlugin.copyAttachment(sourcePath, card)

    const localPath = await attachmentStoragePlugin.materializeAttachment?.(card, 'sample.txt')
    expect(localPath).not.toBeNull()
    expect(localPath).toContain(path.join('default', 'backlog', 'attachments'))
    await expect(fsp.readFile(localPath!, 'utf-8')).resolves.toBe('hello sqlite attachment')
  })

  it('returns null when an attachment is missing on disk', async () => {
    const card = makeCard({ attachments: ['missing.txt'] })
    await expect(attachmentStoragePlugin.materializeAttachment?.(card, 'missing.txt')).resolves.toBeNull()
  })
})

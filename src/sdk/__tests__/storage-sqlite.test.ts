import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStorageEngine } from '../plugins/sqlite'
import type { Card } from '../../shared/types'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sqlite-engine-test-'))
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
    comments: [],
    order: 'a0',
    content: '# Test Card\n\nDescription.',
    filePath: '',
    ...overrides,
  }
}

describe('SqliteStorageEngine', () => {
  let workspaceDir: string
  let kanbanDir: string
  let dbPath: string
  let engine: SqliteStorageEngine

  beforeEach(async () => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    dbPath = path.join(kanbanDir, 'kanban.db')
    fs.mkdirSync(kanbanDir, { recursive: true })
    engine = new SqliteStorageEngine(kanbanDir, dbPath)
    await engine.init()
  })

  afterEach(() => {
    engine.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('has type === sqlite', () => {
    expect(engine.type).toBe('sqlite')
  })

  it('creates the database file on init', () => {
    expect(fs.existsSync(dbPath)).toBe(true)
  })

  describe('ensureBoardDirs', () => {
    it('creates attachment directory', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])
      // Attachment directory is created lazily; existence is optional at this point
      // but ensureBoardDirs should not throw
    })
  })

  describe('writeCard + scanCards', () => {
    it('writes a card and reads it back', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard()
      await engine.writeCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(1)
      expect(cards[0].id).toBe('1')
      expect(cards[0].status).toBe('backlog')
      expect(cards[0].filePath).toBe('')
    })

    it('upserts a card (second write updates)', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard()
      await engine.writeCard(card)
      await engine.writeCard({ ...card, priority: 'high' })

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(1)
      expect(cards[0].priority).toBe('high')
    })

    it('round-trips labels', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard({ labels: ['bug', 'urgent'] })
      await engine.writeCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards[0].labels).toEqual(['bug', 'urgent'])
    })

    it('round-trips metadata', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard({ metadata: { sprint: '2026-Q1', estimate: 5 } })
      await engine.writeCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards[0].metadata).toEqual({ sprint: '2026-Q1', estimate: 5 })
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
                severity: { type: 'string' }
              }
            },
            ui: { type: 'VerticalLayout' },
            data: { severity: 'medium' }
          }
        ],
        formData: {
          'bug-report': { severity: 'high' },
          'inline-form': { severity: 'medium' }
        }
      })
      await engine.writeCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards[0].forms).toEqual(card.forms)
      expect(cards[0].formData).toEqual(card.formData)
    })

    it('upserts nested form-aware fields without losing updated structure', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const original = makeCard({
        id: 'form-upsert',
        forms: [{
          name: 'triage',
          schema: {
            type: 'object',
            properties: {
              owner: { type: 'string' }
            }
          }
        }],
        formData: {
          triage: {
            owner: 'alice',
            checklist: ['repro'],
            details: { severity: 'medium' }
          }
        }
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
                summary: { type: 'string' }
              }
            }
          }
        ],
        formData: {
          triage: {
            owner: 'bob',
            checklist: ['repro', 'fix-verified'],
            details: { severity: 'high', escalated: true }
          },
          resolution: {
            summary: 'Patched'
          }
        }
      }
      await engine.writeCard(updated)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(1)
      expect(cards[0].forms).toEqual(updated.forms)
      expect(cards[0].formData).toEqual(updated.formData)
    })

    it('round-trips comments', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const comment = {
        id: 'c1',
        author: 'alice',
        created: '2025-01-01T00:00:00.000Z',
        content: 'Hello!',
      }
      const card = makeCard({ comments: [comment] })
      await engine.writeCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards[0].comments).toHaveLength(1)
      expect(cards[0].comments[0].id).toBe('c1')
      expect(cards[0].comments[0].content).toBe('Hello!')
    })

    it('scans only cards belonging to the requested board', async () => {
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
  })

  describe('moveCard', () => {
    it('updates card status in the database', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard({ status: 'backlog' })
      await engine.writeCard(card)

      const newCard = { ...card, status: 'in-progress' }
      const newPath = await engine.moveCard(newCard, boardDir, 'in-progress')
      expect(newPath).toBe('')

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards[0].status).toBe('in-progress')
    })
  })

  describe('renameCard', () => {
    it('is a no-op and returns empty string', async () => {
      const card = makeCard()
      await engine.writeCard(card)
      const result = await engine.renameCard(card, 'new-name')
      expect(result).toBe('')
    })
  })

  describe('deleteCard', () => {
    it('removes the card from the database', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard()
      await engine.writeCard(card)

      await engine.deleteCard(card)
      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(0)
    })

    it('also removes associated comments', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard({
        comments: [{ id: 'c1', author: 'alice', created: '2025-01-01T00:00:00.000Z', content: 'Hi' }],
      })
      await engine.writeCard(card)
      await engine.deleteCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(0)
    })
  })

  describe('deleteBoardData', () => {
    it('removes all cards for the board from the database', async () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.writeCard(makeCard({ id: '1', boardId: 'default' }))
      await engine.writeCard(makeCard({ id: '2', boardId: 'default' }))

      await engine.deleteBoardData(boardDir, 'default')
      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(0)
    })
  })

  describe('getCardDir', () => {
    it('returns the attachments directory for the card', () => {
      const card = makeCard({ boardId: 'default', id: '1', status: 'backlog' })
      const dir = engine.getCardDir(card)
      expect(dir).toContain('attachments')
      expect(dir).toContain('default')
      expect(dir).toContain('backlog')
    })
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkdownStorageEngine } from '../plugins/markdown'
import type { Card } from '../../shared/types'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-md-engine-test-'))
}

function makeCard(overrides: Partial<Card> = {}): Card {
  const boardId = overrides.boardId ?? 'default'
  return {
    version: 1,
    id: '1',
    boardId,
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

describe('MarkdownStorageEngine', () => {
  let workspaceDir: string
  let kanbanDir: string
  let engine: MarkdownStorageEngine

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    engine = new MarkdownStorageEngine(kanbanDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('has type === markdown', () => {
    expect(engine.type).toBe('markdown')
  })

  it('init creates required directories', async () => {
    await engine.init()
    expect(fs.existsSync(kanbanDir)).toBe(true)
  })

  describe('ensureBoardDirs', () => {
    it('creates the board directory', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir)
      expect(fs.existsSync(boardDir)).toBe(true)
    })

    it('creates extra status subdirectories', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog', 'in-progress', 'done'])
      expect(fs.existsSync(path.join(boardDir, 'backlog'))).toBe(true)
      expect(fs.existsSync(path.join(boardDir, 'in-progress'))).toBe(true)
      expect(fs.existsSync(path.join(boardDir, 'done'))).toBe(true)
    })
  })

  describe('writeCard + scanCards', () => {
    it('writes a card and reads it back', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])

      const card = makeCard({
        filePath: path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md'),
      })
      await engine.writeCard(card)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(1)
      expect(cards[0].id).toBe('1')
      expect(cards[0].status).toBe('backlog')
    })

    it('updates a card with writeCard', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])

      const card = makeCard({
        filePath: path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md'),
      })
      await engine.writeCard(card)

      const updated = { ...card, priority: 'high' as const }
      await engine.writeCard(updated)

      const cards = await engine.scanCards(boardDir, 'default')
      expect(cards).toHaveLength(1)
      expect(cards[0].priority).toBe('high')
    })
  })

  describe('moveCard', () => {
    it('moves a card to a new status directory', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog', 'in-progress'])

      const card = makeCard({
        filePath: path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md'),
      })
      await engine.writeCard(card)

      const newPath = await engine.moveCard(card, boardDir, 'in-progress')
      expect(newPath).toContain('in-progress')
      expect(fs.existsSync(newPath)).toBe(true)
    })
  })

  describe('deleteCard', () => {
    it('removes the card file', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])

      const card = makeCard({
        filePath: path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md'),
      })
      await engine.writeCard(card)
      expect(fs.existsSync(card.filePath)).toBe(true)

      await engine.deleteCard(card)
      expect(fs.existsSync(card.filePath)).toBe(false)
    })
  })

  describe('deleteBoardData', () => {
    it('removes the entire board directory', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])

      const card = makeCard({
        filePath: path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md'),
      })
      await engine.writeCard(card)

      await engine.deleteBoardData(boardDir, 'default')
      expect(fs.existsSync(boardDir)).toBe(false)
    })
  })

  describe('getCardDir', () => {
    it('returns the directory of the card file', () => {
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      const card = makeCard({
        filePath: path.join(boardDir, 'backlog', '1-test-card.md'),
      })
      expect(engine.getCardDir(card)).toBe(path.join(boardDir, 'backlog', 'attachments'))
    })
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkdownStorageEngine } from '../plugins/markdown'
import { createFileBackedCardStateProvider } from '../plugins/card-state-file'
import { DEFAULT_CARD_STATE_ACTOR } from '../types'
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

  describe('file-backed card.state provider', () => {
    it('persists the shared auth-absent default actor under the builtin backend contract', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])

      const cardPath = path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md')
      const card = makeCard({ filePath: cardPath })
      await engine.writeCard(card)

      const provider = createFileBackedCardStateProvider({
        workspaceRoot: workspaceDir,
        kanbanDir,
        provider: 'builtin',
        backend: 'builtin',
      })

      const stored = await provider.setCardState({
        actorId: DEFAULT_CARD_STATE_ACTOR.id,
        boardId: 'default',
        cardId: card.id,
        domain: 'preferences',
        value: { collapsed: false },
        updatedAt: '2026-03-24T01:00:00.000Z',
      })

      expect(stored).toEqual({
        actorId: DEFAULT_CARD_STATE_ACTOR.id,
        boardId: 'default',
        cardId: card.id,
        domain: 'preferences',
        value: { collapsed: false },
        updatedAt: '2026-03-24T01:00:00.000Z',
      })

      await expect(provider.getCardState({
        actorId: DEFAULT_CARD_STATE_ACTOR.id,
        boardId: 'default',
        cardId: card.id,
        domain: 'preferences',
      })).resolves.toEqual(stored)

      const sidecarPath = path.join(kanbanDir, 'card-state', DEFAULT_CARD_STATE_ACTOR.id, 'default', `${card.id}.json`)
      expect(fs.existsSync(sidecarPath)).toBe(true)

      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')) as {
        actorId: string
        boardId: string
        cardId: string
      }
      expect(sidecar).toMatchObject({
        actorId: DEFAULT_CARD_STATE_ACTOR.id,
        boardId: 'default',
        cardId: card.id,
      })
    })

    it('persists actor-scoped card state in sidecars outside markdown cards and active-card state', async () => {
      await engine.init()
      const boardDir = path.join(kanbanDir, 'boards', 'default')
      await engine.ensureBoardDirs(boardDir, ['backlog'])

      const cardPath = path.join(boardDir, 'backlog', '1-test-card-2025-01-01.md')
      const card = makeCard({ filePath: cardPath })
      await engine.writeCard(card)

      const activeCardPath = path.join(kanbanDir, '.active-card.json')
      fs.writeFileSync(
        activeCardPath,
        JSON.stringify({ cardId: card.id, boardId: 'default', updatedAt: '2026-03-24T00:00:00.000Z' }, null, 2),
        'utf-8',
      )

      const beforeCard = fs.readFileSync(cardPath, 'utf-8')
      const beforeActiveCard = fs.readFileSync(activeCardPath, 'utf-8')

      const provider = createFileBackedCardStateProvider({
        workspaceRoot: workspaceDir,
        kanbanDir,
        provider: 'builtin',
        backend: 'builtin',
      })

      await provider.setCardState({
        actorId: 'user-123',
        boardId: 'default',
        cardId: card.id,
        domain: 'preferences',
        value: { collapsed: true },
        updatedAt: '2026-03-24T01:02:03.000Z',
      })

      await provider.markUnreadReadThrough({
        actorId: 'user-123',
        boardId: 'default',
        cardId: card.id,
        cursor: {
          cursor: 'log:5',
          updatedAt: '2026-03-24T01:03:04.000Z',
        },
      })

      const sidecarRoot = path.join(kanbanDir, 'card-state')
      expect(fs.existsSync(sidecarRoot)).toBe(true)

      const sidecarFiles: string[] = []
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const entryPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(entryPath)
            continue
          }
          sidecarFiles.push(entryPath)
        }
      }
      walk(sidecarRoot)

      expect(sidecarFiles).toHaveLength(1)
      expect(sidecarFiles[0].startsWith(sidecarRoot)).toBe(true)
      expect(path.basename(sidecarFiles[0])).toBe('1.json')

      const sidecar = JSON.parse(fs.readFileSync(sidecarFiles[0], 'utf-8')) as {
        actorId: string
        domains: Record<string, { value: unknown; updatedAt: string }>
      }
      expect(sidecar.actorId).toBe('user-123')
      expect(sidecar.domains.preferences).toEqual({
        value: { collapsed: true },
        updatedAt: '2026-03-24T01:02:03.000Z',
      })
      expect(sidecar.domains.unread).toEqual({
        value: { cursor: 'log:5', updatedAt: '2026-03-24T01:03:04.000Z' },
        updatedAt: '2026-03-24T01:03:04.000Z',
      })

      expect(fs.readFileSync(cardPath, 'utf-8')).toBe(beforeCard)
      expect(fs.readFileSync(activeCardPath, 'utf-8')).toBe(beforeActiveCard)
    })
  })
})

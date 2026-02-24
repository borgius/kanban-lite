import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { DEFAULT_COLUMNS } from '../../shared/types'
import type { KanbanConfig } from '../../shared/config'

function createV2Config(overrides?: Partial<KanbanConfig>): KanbanConfig {
  return {
    version: 2,
    boards: {
      default: {
        name: 'Default',
        columns: [...DEFAULT_COLUMNS],
        nextCardId: 1,
        defaultStatus: 'backlog',
        defaultPriority: 'medium'
      }
    },
    defaultBoard: 'default',
    featuresDirectory: '.kanban',
    aiAgent: 'claude',
    defaultPriority: 'medium',
    defaultStatus: 'backlog',
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: true,
    showLabels: true,
    showBuildWithAI: true,
    showFileName: false,
    compactMode: false,
    markdownEditorMode: false,
    ...overrides
  }
}

describe('Multi-board SDK operations', () => {
  let workspaceDir: string
  let featuresDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-multi-board-'))
    featuresDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(featuresDir, { recursive: true })
    // Write v2 config
    const config = createV2Config()
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config, null, 2))
    sdk = new KanbanSDK(featuresDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  describe('listBoards', () => {
    it('should return boards from config', () => {
      const boards = sdk.listBoards()
      expect(boards).toHaveLength(1)
      expect(boards[0].id).toBe('default')
      expect(boards[0].name).toBe('Default')
    })

    it('should return multiple boards when configured', () => {
      const config = createV2Config()
      config.boards['sprint'] = {
        name: 'Sprint Board',
        columns: [...DEFAULT_COLUMNS],
        nextCardId: 1,
        defaultStatus: 'backlog',
        defaultPriority: 'medium'
      }
      fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config, null, 2))

      const boards = sdk.listBoards()
      expect(boards).toHaveLength(2)
      const boardIds = boards.map(b => b.id).sort()
      expect(boardIds).toEqual(['default', 'sprint'])
    })
  })

  describe('createBoard', () => {
    it('should create a board dir and add to config', () => {
      const board = sdk.createBoard('sprint', 'Sprint Board')

      expect(board.id).toBe('sprint')
      expect(board.name).toBe('Sprint Board')

      // Verify config was updated
      const raw = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'))
      expect(raw.boards.sprint).toBeDefined()
      expect(raw.boards.sprint.name).toBe('Sprint Board')
      expect(raw.boards.sprint.columns).toEqual(DEFAULT_COLUMNS)
      expect(raw.boards.sprint.nextCardId).toBe(1)
    })

    it('should create a board with custom options', () => {
      const customColumns = [
        { id: 'new', name: 'New', color: '#ff0000' },
        { id: 'wip', name: 'WIP', color: '#00ff00' },
        { id: 'finished', name: 'Finished', color: '#0000ff' }
      ]
      const board = sdk.createBoard('custom', 'Custom Board', {
        description: 'A custom board',
        columns: customColumns,
        defaultStatus: 'new',
        defaultPriority: 'high'
      })

      expect(board.id).toBe('custom')
      expect(board.name).toBe('Custom Board')
      expect(board.description).toBe('A custom board')

      const raw = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'))
      expect(raw.boards.custom.columns).toEqual(customColumns)
      expect(raw.boards.custom.defaultStatus).toBe('new')
      expect(raw.boards.custom.defaultPriority).toBe('high')
    })

    it('should throw if board already exists', () => {
      expect(() => sdk.createBoard('default', 'Another Default')).toThrow('Board already exists: default')
    })
  })

  describe('deleteBoard', () => {
    it('should remove an empty board', async () => {
      sdk.createBoard('temp', 'Temporary')

      // Create the board directory so deletion can clean it up
      fs.mkdirSync(path.join(featuresDir, 'boards', 'temp'), { recursive: true })

      await sdk.deleteBoard('temp')

      const boards = sdk.listBoards()
      expect(boards.find(b => b.id === 'temp')).toBeUndefined()

      const raw = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'))
      expect(raw.boards.temp).toBeUndefined()
    })

    it('should throw when deleting the default board', async () => {
      await expect(sdk.deleteBoard('default')).rejects.toThrow('Cannot delete the default board')
    })

    it('should throw when deleting a non-existent board', async () => {
      await expect(sdk.deleteBoard('nonexistent')).rejects.toThrow('Board not found')
    })

    it('should throw when deleting a board with cards', async () => {
      sdk.createBoard('has-cards', 'Has Cards')
      await sdk.createCard({ content: '# Card', boardId: 'has-cards' })

      await expect(sdk.deleteBoard('has-cards')).rejects.toThrow('card(s) still exist')
    })
  })

  describe('getBoard', () => {
    it('should return board config', () => {
      const board = sdk.getBoard('default')

      expect(board.name).toBe('Default')
      expect(board.columns).toEqual(DEFAULT_COLUMNS)
      expect(board.nextCardId).toBeGreaterThanOrEqual(1)
      expect(board.defaultStatus).toBe('backlog')
      expect(board.defaultPriority).toBe('medium')
    })

    it('should throw for non-existent board', () => {
      expect(() => sdk.getBoard('nonexistent')).toThrow("Board 'nonexistent' not found")
    })
  })

  describe('createCard with boardId', () => {
    it('should create a card file in the correct board dir', async () => {
      sdk.createBoard('sprint', 'Sprint')

      const card = await sdk.createCard({
        content: '# Sprint Task',
        status: 'todo',
        boardId: 'sprint'
      })

      expect(card.boardId).toBe('sprint')
      expect(card.status).toBe('todo')
      expect(card.filePath).toContain(path.join('boards', 'sprint', 'todo'))
      expect(fs.existsSync(card.filePath)).toBe(true)
    })

    it('should use default board when boardId is not specified', async () => {
      const card = await sdk.createCard({ content: '# Default Card' })

      expect(card.boardId).toBe('default')
      expect(card.filePath).toContain(path.join('boards', 'default'))
      expect(fs.existsSync(card.filePath)).toBe(true)
    })
  })

  describe('listCards with boardId', () => {
    it('should only return cards from the specified board', async () => {
      sdk.createBoard('sprint', 'Sprint')

      await sdk.createCard({ content: '# Default Card', boardId: 'default' })
      await sdk.createCard({ content: '# Sprint Card', boardId: 'sprint' })

      const defaultCards = await sdk.listCards(undefined, 'default')
      expect(defaultCards).toHaveLength(1)
      expect(defaultCards[0].content).toContain('Default Card')

      const sprintCards = await sdk.listCards(undefined, 'sprint')
      expect(sprintCards).toHaveLength(1)
      expect(sprintCards[0].content).toContain('Sprint Card')
    })

    it('should return empty array for board with no cards', async () => {
      sdk.createBoard('empty', 'Empty Board')

      const cards = await sdk.listCards(undefined, 'empty')
      expect(cards).toEqual([])
    })
  })

  describe('moveCard with boardId', () => {
    it('should move a card within a board', async () => {
      const card = await sdk.createCard({
        content: '# Move Me',
        status: 'backlog',
        boardId: 'default'
      })

      const moved = await sdk.moveCard(card.id, 'in-progress', undefined, 'default')

      expect(moved.status).toBe('in-progress')
      expect(moved.filePath).toContain(path.join('boards', 'default', 'in-progress'))
      expect(fs.existsSync(moved.filePath)).toBe(true)
    })
  })

  describe('transferCard', () => {
    it('should move a card file between boards', async () => {
      sdk.createBoard('sprint', 'Sprint')

      const card = await sdk.createCard({
        content: '# Transfer Me',
        status: 'backlog',
        boardId: 'default'
      })
      const oldPath = card.filePath
      expect(oldPath).toContain(path.join('boards', 'default'))

      const transferred = await sdk.transferCard(card.id, 'default', 'sprint')

      expect(transferred.boardId).toBe('sprint')
      expect(transferred.filePath).toContain(path.join('boards', 'sprint'))
      expect(fs.existsSync(transferred.filePath)).toBe(true)
      expect(fs.existsSync(oldPath)).toBe(false)
    })

    it('should use target board default status when no targetStatus provided', async () => {
      sdk.createBoard('sprint', 'Sprint')

      const card = await sdk.createCard({
        content: '# Transfer Default Status',
        status: 'todo',
        boardId: 'default'
      })

      const transferred = await sdk.transferCard(card.id, 'default', 'sprint')

      // Sprint board defaultStatus is 'backlog' (inherited from default columns)
      expect(transferred.status).toBe('backlog')
    })

    it('should use specified targetStatus', async () => {
      sdk.createBoard('sprint', 'Sprint')

      const card = await sdk.createCard({
        content: '# Transfer With Status',
        status: 'backlog',
        boardId: 'default'
      })

      const transferred = await sdk.transferCard(card.id, 'default', 'sprint', 'in-progress')

      expect(transferred.status).toBe('in-progress')
      expect(transferred.filePath).toContain(path.join('boards', 'sprint', 'in-progress'))
    })

    it('should throw for non-existent source board', async () => {
      await expect(sdk.transferCard('1', 'nonexistent', 'default')).rejects.toThrow('Board not found')
    })

    it('should throw for non-existent target board', async () => {
      await expect(sdk.transferCard('1', 'default', 'nonexistent')).rejects.toThrow('Board not found')
    })
  })

  describe('per-board card IDs', () => {
    it('should assign independent numeric IDs per board', async () => {
      sdk.createBoard('sprint', 'Sprint')

      const defaultCard = await sdk.createCard({
        content: '# Default Card',
        boardId: 'default'
      })
      const sprintCard = await sdk.createCard({
        content: '# Sprint Card',
        boardId: 'sprint'
      })

      // Both boards start at ID 1, so both should get "1" as their first card ID
      expect(defaultCard.id).toBe('1')
      expect(sprintCard.id).toBe('1')

      // They should be in different directories
      expect(defaultCard.filePath).toContain(path.join('boards', 'default'))
      expect(sprintCard.filePath).toContain(path.join('boards', 'sprint'))
    })
  })

  describe('listColumns with boardId', () => {
    it('should return board-specific columns', () => {
      sdk.createBoard('sprint', 'Sprint', {
        columns: [
          { id: 'new', name: 'New', color: '#ff0000' },
          { id: 'wip', name: 'WIP', color: '#00ff00' }
        ]
      })

      const defaultColumns = sdk.listColumns('default')
      expect(defaultColumns).toEqual(DEFAULT_COLUMNS)

      const sprintColumns = sdk.listColumns('sprint')
      expect(sprintColumns).toHaveLength(2)
      expect(sprintColumns[0].id).toBe('new')
      expect(sprintColumns[1].id).toBe('wip')
    })

    it('should return default board columns when boardId is omitted', () => {
      const columns = sdk.listColumns()
      expect(columns).toEqual(DEFAULT_COLUMNS)
    })
  })

  describe('addColumn with boardId', () => {
    it('should add a column to a specific board', () => {
      sdk.createBoard('sprint', 'Sprint')

      const columns = sdk.addColumn({ id: 'staging', name: 'Staging', color: '#aabbcc' }, 'sprint')

      // Sprint board inherits default columns + the new one
      expect(columns.find(c => c.id === 'staging')).toBeDefined()

      // Default board should not have the new column
      const defaultColumns = sdk.listColumns('default')
      expect(defaultColumns.find(c => c.id === 'staging')).toBeUndefined()
    })

    it('should throw if column already exists in that board', () => {
      expect(() => sdk.addColumn({ id: 'backlog', name: 'Backlog Again', color: '#000' }, 'default'))
        .toThrow('Column already exists: backlog')
    })
  })

  describe('_isCompletedStatus logic', () => {
    it('should set completedAt when moving to the last column', async () => {
      // Default columns: backlog, todo, in-progress, review, done
      // "done" is the last column
      const card = await sdk.createCard({
        content: '# Complete Me',
        status: 'review',
        boardId: 'default'
      })
      expect(card.completedAt).toBeNull()

      const moved = await sdk.moveCard(card.id, 'done', undefined, 'default')
      expect(moved.completedAt).not.toBeNull()
    })

    it('should clear completedAt when moving away from the last column', async () => {
      const card = await sdk.createCard({
        content: '# Uncomplete Me',
        status: 'done',
        boardId: 'default'
      })
      expect(card.completedAt).not.toBeNull()

      const moved = await sdk.moveCard(card.id, 'backlog', undefined, 'default')
      expect(moved.completedAt).toBeNull()
    })

    it('should use the last column of a custom board for completed status', async () => {
      sdk.createBoard('custom', 'Custom', {
        columns: [
          { id: 'open', name: 'Open', color: '#ff0000' },
          { id: 'closed', name: 'Closed', color: '#00ff00' }
        ],
        defaultStatus: 'open'
      })

      const card = await sdk.createCard({
        content: '# Custom Complete',
        status: 'open',
        boardId: 'custom'
      })
      expect(card.completedAt).toBeNull()

      const moved = await sdk.moveCard(card.id, 'closed', undefined, 'custom')
      expect(moved.completedAt).not.toBeNull()
    })
  })

  describe('board isolation', () => {
    it('should not find cards across boards with getCard', async () => {
      sdk.createBoard('sprint', 'Sprint')

      const card = await sdk.createCard({
        content: '# Only In Default',
        boardId: 'default'
      })

      // Should find in default board
      const found = await sdk.getCard(card.id, 'default')
      expect(found).not.toBeNull()
      expect(found?.id).toBe(card.id)

      // Should not find in sprint board
      const notFound = await sdk.getCard(card.id, 'sprint')
      expect(notFound).toBeNull()
    })

    it('should keep cards in separate board directories on disk', async () => {
      sdk.createBoard('sprint', 'Sprint')

      await sdk.createCard({ content: '# Default Task', boardId: 'default' })
      await sdk.createCard({ content: '# Sprint Task', boardId: 'sprint' })

      const defaultBoardDir = path.join(featuresDir, 'boards', 'default')
      const sprintBoardDir = path.join(featuresDir, 'boards', 'sprint')

      // Each board dir should have its own card files
      const defaultFiles = fs.readdirSync(path.join(defaultBoardDir, 'backlog')).filter(f => f.endsWith('.md'))
      const sprintFiles = fs.readdirSync(path.join(sprintBoardDir, 'backlog')).filter(f => f.endsWith('.md'))

      expect(defaultFiles).toHaveLength(1)
      expect(sprintFiles).toHaveLength(1)
    })
  })
})

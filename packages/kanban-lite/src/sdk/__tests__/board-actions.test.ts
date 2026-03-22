import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-board-actions-test-'))
}

function writeKanbanJson(workspaceRoot: string, config: object): void {
  fs.writeFileSync(path.join(workspaceRoot, '.kanban.json'), JSON.stringify(config, null, 2), 'utf-8')
}

const BASE_CONFIG = {
  version: 2,
  boards: {
    default: {
      name: 'Default Board',
      columns: [
        { id: 'backlog', name: 'Backlog', color: '#94a3b8' },
        { id: 'done', name: 'Done', color: '#22c55e' }
      ],
      nextCardId: 1,
      defaultStatus: 'backlog',
      defaultPriority: 'medium'
    }
  },
  defaultBoard: 'default',
  kanbanDirectory: '.kanban',
  aiAgent: 'claude',
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  nextCardId: 1
}

describe('Board Actions', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    writeKanbanJson(workspaceDir, BASE_CONFIG)
    sdk = new KanbanSDK(kanbanDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  describe('getBoardActions', () => {
    it('returns empty object when no actions defined', () => {
      const actions = sdk.getBoardActions('default')
      expect(actions).toEqual({})
    })

    it('returns defined actions', () => {
      writeKanbanJson(workspaceDir, {
        ...BASE_CONFIG,
        boards: {
          default: { ...BASE_CONFIG.boards.default, actions: { deploy: 'Deploy to Production' } }
        }
      })
      sdk = new KanbanSDK(kanbanDir)
      const actions = sdk.getBoardActions('default')
      expect(actions).toEqual({ deploy: 'Deploy to Production' })
    })

    it('uses active board when boardId is omitted', () => {
      writeKanbanJson(workspaceDir, {
        ...BASE_CONFIG,
        boards: {
          default: { ...BASE_CONFIG.boards.default, actions: { build: 'Build Project' } }
        }
      })
      sdk = new KanbanSDK(kanbanDir)
      const actions = sdk.getBoardActions()
      expect(actions).toEqual({ build: 'Build Project' })
    })

    it('throws when board not found', () => {
      expect(() => sdk.getBoardActions('nonexistent')).toThrow(/not found/)
    })
  })

  describe('addBoardAction', () => {
    it('adds a new action', () => {
      const result = sdk.addBoardAction('default', 'deploy', 'Deploy to Production')
      expect(result).toEqual({ deploy: 'Deploy to Production' })
    })

    it('persists the action to config', () => {
      sdk.addBoardAction('default', 'deploy', 'Deploy to Production')
      sdk = new KanbanSDK(kanbanDir)
      expect(sdk.getBoardActions('default')).toEqual({ deploy: 'Deploy to Production' })
    })

    it('adds multiple actions', () => {
      sdk.addBoardAction('default', 'deploy', 'Deploy')
      sdk.addBoardAction('default', 'build', 'Build')
      const actions = sdk.getBoardActions('default')
      expect(actions).toEqual({ deploy: 'Deploy', build: 'Build' })
    })

    it('overwrites an existing action with the same key', () => {
      sdk.addBoardAction('default', 'deploy', 'Deploy to Staging')
      const result = sdk.addBoardAction('default', 'deploy', 'Deploy to Production')
      expect(result).toEqual({ deploy: 'Deploy to Production' })
    })

    it('throws when board not found', () => {
      expect(() => sdk.addBoardAction('nonexistent', 'k', 't')).toThrow(/not found/)
    })
  })

  describe('removeBoardAction', () => {
    it('removes an existing action', () => {
      sdk.addBoardAction('default', 'deploy', 'Deploy')
      sdk.addBoardAction('default', 'build', 'Build')
      const result = sdk.removeBoardAction('default', 'deploy')
      expect(result).toEqual({ build: 'Build' })
    })

    it('removes actions key from config when last action deleted', () => {
      sdk.addBoardAction('default', 'deploy', 'Deploy')
      sdk.removeBoardAction('default', 'deploy')
      sdk = new KanbanSDK(kanbanDir)
      const actions = sdk.getBoardActions('default')
      expect(actions).toEqual({})
    })

    it('throws when action key not found', () => {
      expect(() => sdk.removeBoardAction('default', 'nonexistent')).toThrow(/not found/)
    })

    it('throws when board not found', () => {
      expect(() => sdk.removeBoardAction('nonexistent', 'k')).toThrow(/not found/)
    })
  })

  describe('triggerBoardAction', () => {
    it('emits board.action event with correct data', async () => {
      const events: Array<{ type: string; data: unknown }> = []
      const sdkWithEvents = new KanbanSDK(kanbanDir, {
        onEvent: (type, data) => events.push({ type, data })
      })
      sdkWithEvents.addBoardAction('default', 'deploy', 'Deploy to Production')
      await sdkWithEvents.triggerBoardAction('default', 'deploy')
      expect(events.some(e => e.type === 'board.action')).toBe(true)
      const actionEvent = events.find(e => e.type === 'board.action')!
      expect(actionEvent.data).toMatchObject({
        boardId: 'default',
        action: 'deploy',
        title: 'Deploy to Production'
      })
    })

    it('throws when action key not found', async () => {
      await expect(sdk.triggerBoardAction('default', 'nonexistent')).rejects.toThrow()
    })

    it('throws when board not found', async () => {
      await expect(sdk.triggerBoardAction('nonexistent', 'k')).rejects.toThrow(/not found/)
    })
  })

  describe('listBoards includes actions', () => {
    it('includes actions in BoardInfo', async () => {
      writeKanbanJson(workspaceDir, {
        ...BASE_CONFIG,
        boards: {
          default: { ...BASE_CONFIG.boards.default, actions: { deploy: 'Deploy' } }
        }
      })
      sdk = new KanbanSDK(kanbanDir)
      const boards = await sdk.listBoards()
      expect(boards[0].actions).toEqual({ deploy: 'Deploy' })
    })

    it('includes undefined actions when none defined', async () => {
      const boards = await sdk.listBoards()
      expect(boards[0].actions).toBeUndefined()
    })

    it('includes workspace forms in BoardInfo', async () => {
      writeKanbanJson(workspaceDir, {
        ...BASE_CONFIG,
        forms: {
          'bug-report': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' }
              }
            },
            data: {
              title: 'Default title'
            }
          }
        }
      })
      sdk = new KanbanSDK(kanbanDir)

      const boards = await sdk.listBoards()
      expect(boards[0].forms).toEqual({
        'bug-report': {
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' }
            }
          },
          data: {
            title: 'Default title'
          }
        }
      })
    })
  })
})

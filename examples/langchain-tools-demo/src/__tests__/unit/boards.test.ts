/**
 * Unit tests — board tools.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ListBoardsTool,
  GetBoardTool,
  CreateBoardTool,
  DeleteBoardTool,
  UpdateBoardTool,
  GetBoardActionsTool,
  createBoardTools,
} from 'kl-adapter-langchain'
import { createMockSDK } from '../helpers'

describe('Board tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createBoardTools returns 6 tools', () => {
    expect(createBoardTools(sdk)).toHaveLength(6)
  })

  describe('ListBoardsTool', () => {
    it('lists boards', async () => {
      const tool = new ListBoardsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('default')
      expect(result[0].name).toBe('Default Board')
    })
  })

  describe('GetBoardTool', () => {
    it('gets board details', async () => {
      const tool = new GetBoardTool(sdk)
      const result = JSON.parse(await tool.invoke({ boardId: 'default' }))
      expect(result.id).toBe('default')
      expect(sdk.getBoard).toHaveBeenCalledWith('default')
    })
  })

  describe('CreateBoardTool', () => {
    it('creates with id and name', async () => {
      const tool = new CreateBoardTool(sdk)
      const result = JSON.parse(await tool.invoke({ id: 'sprint-1', name: 'Sprint 1' }))
      expect(result.id).toBe('sprint-1')
      expect(sdk.createBoard).toHaveBeenCalledWith('sprint-1', 'Sprint 1', {})
    })

    it('creates with description and columns', async () => {
      const tool = new CreateBoardTool(sdk)
      await tool.invoke({
        id: 'bugs', name: 'Bugs',
        description: 'Bug tracker',
        columns: [{ id: 'open', name: 'Open' }, { id: 'closed', name: 'Closed' }],
      })
      expect(sdk.createBoard).toHaveBeenCalledWith('bugs', 'Bugs', {
        description: 'Bug tracker',
        columns: [{ id: 'open', name: 'Open' }, { id: 'closed', name: 'Closed' }],
      })
    })
  })

  describe('DeleteBoardTool', () => {
    it('deletes a board', async () => {
      const tool = new DeleteBoardTool(sdk)
      const result = JSON.parse(await tool.invoke({ boardId: 'sprint-1' }))
      expect(result.deleted).toBe(true)
      expect(sdk.deleteBoard).toHaveBeenCalledWith('sprint-1')
    })
  })

  describe('UpdateBoardTool', () => {
    it('updates board name', async () => {
      const tool = new UpdateBoardTool(sdk)
      const result = JSON.parse(await tool.invoke({ boardId: 'default', name: 'Updated Board' }))
      expect(result.name).toBe('Updated')
      expect(sdk.updateBoard).toHaveBeenCalledWith('default', { name: 'Updated Board' })
    })

    it('updates description', async () => {
      const tool = new UpdateBoardTool(sdk)
      await tool.invoke({ boardId: 'default', description: 'New description' })
      expect(sdk.updateBoard).toHaveBeenCalledWith('default', { description: 'New description' })
    })
  })

  describe('GetBoardActionsTool', () => {
    it('returns board actions', async () => {
      const tool = new GetBoardActionsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toHaveProperty('deploy')
      expect(sdk.getBoardActions).toHaveBeenCalledWith(undefined)
    })

    it('passes boardId', async () => {
      const tool = new GetBoardActionsTool(sdk)
      await tool.invoke({ boardId: 'b1' })
      expect(sdk.getBoardActions).toHaveBeenCalledWith('b1')
    })
  })
})

/**
 * Unit tests — column tools.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ListColumnsTool,
  AddColumnTool,
  UpdateColumnTool,
  RemoveColumnTool,
  ReorderColumnsTool,
  createColumnTools,
} from 'kl-langchain-tools'
import { createMockSDK } from '../helpers'

describe('Column tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createColumnTools returns 5 tools', () => {
    expect(createColumnTools(sdk)).toHaveLength(5)
  })

  describe('ListColumnsTool', () => {
    it('lists columns', async () => {
      const tool = new ListColumnsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('todo')
      expect(sdk.listColumns).toHaveBeenCalledWith(undefined)
    })

    it('passes boardId', async () => {
      const tool = new ListColumnsTool(sdk)
      await tool.invoke({ boardId: 'sprint-1' })
      expect(sdk.listColumns).toHaveBeenCalledWith('sprint-1')
    })
  })

  describe('AddColumnTool', () => {
    it('adds a column', async () => {
      const tool = new AddColumnTool(sdk)
      const result = JSON.parse(await tool.invoke({ id: 'testing', name: 'QA', color: '#06b6d4' }))
      expect(result.id).toBe('testing')
      expect(sdk.addColumn).toHaveBeenCalledWith({ id: 'testing', name: 'QA', color: '#06b6d4' }, undefined)
    })

    it('adds without color', async () => {
      const tool = new AddColumnTool(sdk)
      await tool.invoke({ id: 'staging', name: 'Staging' })
      expect(sdk.addColumn).toHaveBeenCalledWith({ id: 'staging', name: 'Staging' }, undefined)
    })
  })

  describe('UpdateColumnTool', () => {
    it('updates column name', async () => {
      const tool = new UpdateColumnTool(sdk)
      const result = JSON.parse(await tool.invoke({ columnId: 'todo', name: 'Backlog' }))
      expect(result.name).toBe('Backlog')
      expect(sdk.updateColumn).toHaveBeenCalledWith('todo', { name: 'Backlog' }, undefined)
    })

    it('updates color with boardId', async () => {
      const tool = new UpdateColumnTool(sdk)
      await tool.invoke({ columnId: 'todo', color: '#ff0000', boardId: 'b1' })
      expect(sdk.updateColumn).toHaveBeenCalledWith('todo', { color: '#ff0000' }, 'b1')
    })
  })

  describe('RemoveColumnTool', () => {
    it('removes a column', async () => {
      const tool = new RemoveColumnTool(sdk)
      const result = JSON.parse(await tool.invoke({ columnId: 'done' }))
      expect(result.removed).toBe(true)
      expect(sdk.removeColumn).toHaveBeenCalledWith('done', undefined)
    })
  })

  describe('ReorderColumnsTool', () => {
    it('reorders columns', async () => {
      const tool = new ReorderColumnsTool(sdk)
      const ids = ['done', 'in-progress', 'todo']
      const result = JSON.parse(await tool.invoke({ columnIds: ids }))
      expect(result.reordered).toBe(true)
      expect(result.columnIds).toEqual(ids)
      expect(sdk.reorderColumns).toHaveBeenCalledWith(ids, undefined)
    })
  })
})

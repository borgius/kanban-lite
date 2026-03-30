/**
 * Unit tests — label tools.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GetLabelsTool,
  SetLabelTool,
  DeleteLabelTool,
  RenameLabelTool,
  GetUniqueAssigneesTool,
  GetUniqueLabelsTool,
  FilterCardsByLabelGroupTool,
  createLabelTools,
} from 'kl-adapter-langchain'
import { createMockSDK } from '../helpers'

describe('Label tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createLabelTools returns 7 tools', () => {
    expect(createLabelTools(sdk)).toHaveLength(7)
  })

  describe('GetLabelsTool', () => {
    it('returns label definitions', async () => {
      const tool = new GetLabelsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toHaveProperty('bug')
      expect(result).toHaveProperty('feature')
    })
  })

  describe('SetLabelTool', () => {
    it('creates a label with color and group', async () => {
      const tool = new SetLabelTool(sdk)
      const result = JSON.parse(await tool.invoke({
        name: 'urgent', color: '#ff0000', group: 'priority',
      }))
      expect(result.set).toBe(true)
      expect(result.name).toBe('urgent')
      expect(sdk.setLabel).toHaveBeenCalledWith('urgent', { color: '#ff0000', group: 'priority' })
    })

    it('creates a label with description', async () => {
      const tool = new SetLabelTool(sdk)
      await tool.invoke({ name: 'wontfix', description: 'Will not be fixed' })
      expect(sdk.setLabel).toHaveBeenCalledWith('wontfix', { description: 'Will not be fixed' })
    })
  })

  describe('DeleteLabelTool', () => {
    it('deletes a label', async () => {
      const tool = new DeleteLabelTool(sdk)
      const result = JSON.parse(await tool.invoke({ name: 'bug' }))
      expect(result.deleted).toBe(true)
      expect(sdk.deleteLabel).toHaveBeenCalledWith('bug')
    })
  })

  describe('RenameLabelTool', () => {
    it('renames a label', async () => {
      const tool = new RenameLabelTool(sdk)
      const result = JSON.parse(await tool.invoke({ oldName: 'bug', newName: 'defect' }))
      expect(result.renamed).toBe(true)
      expect(result.from).toBe('bug')
      expect(result.to).toBe('defect')
      expect(sdk.renameLabel).toHaveBeenCalledWith('bug', 'defect')
    })
  })

  describe('GetUniqueAssigneesTool', () => {
    it('returns unique assignees', async () => {
      const tool = new GetUniqueAssigneesTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toEqual(['alice', 'bob'])
    })

    it('passes boardId', async () => {
      const tool = new GetUniqueAssigneesTool(sdk)
      await tool.invoke({ boardId: 'b1' })
      expect(sdk.getUniqueAssignees).toHaveBeenCalledWith('b1')
    })
  })

  describe('GetUniqueLabelsTool', () => {
    it('returns unique labels', async () => {
      const tool = new GetUniqueLabelsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toEqual(['bug', 'feature'])
    })
  })

  describe('FilterCardsByLabelGroupTool', () => {
    it('filters by label group', async () => {
      const tool = new FilterCardsByLabelGroupTool(sdk)
      const result = JSON.parse(await tool.invoke({ group: 'type' }))
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('title')
      expect(result[0]).toHaveProperty('labels')
      expect(sdk.filterCardsByLabelGroup).toHaveBeenCalledWith('type', undefined)
    })
  })
})

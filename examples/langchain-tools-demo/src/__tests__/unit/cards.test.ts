/**
 * Unit tests — card tools.
 *
 * Validates every card tool against a mock SDK with full input/output coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ListCardsTool,
  GetCardTool,
  CreateCardTool,
  UpdateCardTool,
  MoveCardTool,
  DeleteCardTool,
  GetCardsByStatusTool,
  TriggerActionTool,
  createCardTools,
} from 'kl-adapter-langchain'
import { createMockSDK } from '../helpers'

describe('Card tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createCardTools returns 8 tools', () => {
    expect(createCardTools(sdk)).toHaveLength(8)
  })

  describe('ListCardsTool', () => {
    it('lists all cards', async () => {
      const tool = new ListCardsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result).toHaveLength(2)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('title')
      expect(result[0]).toHaveProperty('status')
      expect(result[0]).toHaveProperty('priority')
      expect(sdk.listCards).toHaveBeenCalled()
    })

    it('filters by status', async () => {
      const tool = new ListCardsTool(sdk)
      const result = JSON.parse(await tool.invoke({ status: 'todo' }))
      expect(result.every((c: any) => c.status === 'todo')).toBe(true)
    })

    it('passes sortBy to SDK', async () => {
      const tool = new ListCardsTool(sdk)
      await tool.invoke({ sortBy: 'created:desc' })
      expect(sdk.listCards).toHaveBeenCalledWith('created:desc', undefined)
    })

    it('passes boardId to SDK', async () => {
      const tool = new ListCardsTool(sdk)
      await tool.invoke({ boardId: 'sprint-1' })
      expect(sdk.listCards).toHaveBeenCalledWith(undefined, 'sprint-1')
    })

    it('extracts title from content', async () => {
      const tool = new ListCardsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result[0].title).toBe('Fix auth bug')
    })

    it('includes comment count', async () => {
      const tool = new ListCardsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(result[0].commentCount).toBe(1)
    })
  })

  describe('GetCardTool', () => {
    it('returns full card details', async () => {
      const tool = new GetCardTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1' }))
      expect(result.id).toBe('1')
      expect(sdk.getCard).toHaveBeenCalledWith('1', undefined)
    })

    it('passes boardId', async () => {
      const tool = new GetCardTool(sdk)
      await tool.invoke({ cardId: '1', boardId: 'bugs' })
      expect(sdk.getCard).toHaveBeenCalledWith('1', 'bugs')
    })
  })

  describe('CreateCardTool', () => {
    it('creates a card with title only', async () => {
      const tool = new CreateCardTool(sdk)
      const result = JSON.parse(await tool.invoke({ title: 'New Task' }))
      expect(result.id).toBeDefined()
      expect(sdk.createCard).toHaveBeenCalledWith(expect.objectContaining({
        content: '# New Task',
      }))
    })

    it('creates a card with all fields', async () => {
      const tool = new CreateCardTool(sdk)
      await tool.invoke({
        title: 'Bug', content: 'Details here', status: 'todo',
        priority: 'high', assignee: 'alice', labels: ['bug'], dueDate: '2025-12-31',
        metadata: { severity: 'P1' },
      })
      expect(sdk.createCard).toHaveBeenCalledWith(expect.objectContaining({
        content: '# Bug\n\nDetails here',
        status: 'todo',
        priority: 'high',
        assignee: 'alice',
        labels: ['bug'],
        dueDate: '2025-12-31',
        metadata: { severity: 'P1' },
      }))
    })

    it('defaults optional fields', async () => {
      const tool = new CreateCardTool(sdk)
      await tool.invoke({ title: 'Simple' })
      expect(sdk.createCard).toHaveBeenCalledWith(expect.objectContaining({
        assignee: null,
        labels: [],
        dueDate: null,
      }))
    })
  })

  describe('UpdateCardTool', () => {
    it('updates card fields', async () => {
      const tool = new UpdateCardTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', priority: 'critical' }))
      expect(result.id).toBe('1')
      expect(sdk.updateCard).toHaveBeenCalledWith('1', { priority: 'critical' }, undefined)
    })

    it('passes boardId', async () => {
      const tool = new UpdateCardTool(sdk)
      await tool.invoke({ cardId: '1', labels: ['bug'], boardId: 'b1' })
      expect(sdk.updateCard).toHaveBeenCalledWith('1', { labels: ['bug'] }, 'b1')
    })

    it('handles nullable assignee', async () => {
      const tool = new UpdateCardTool(sdk)
      await tool.invoke({ cardId: '1', assignee: null })
      expect(sdk.updateCard).toHaveBeenCalledWith('1', { assignee: null }, undefined)
    })
  })

  describe('MoveCardTool', () => {
    it('moves card to new status', async () => {
      const tool = new MoveCardTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', newStatus: 'done' }))
      expect(result.status).toBe('done')
      expect(sdk.moveCard).toHaveBeenCalledWith('1', 'done', undefined, undefined)
    })

    it('moves with position', async () => {
      const tool = new MoveCardTool(sdk)
      await tool.invoke({ cardId: '1', newStatus: 'todo', position: 'top' })
      expect(sdk.moveCard).toHaveBeenCalledWith('1', 'todo', 'top', undefined)
    })
  })

  describe('DeleteCardTool', () => {
    it('soft-deletes a card', async () => {
      const tool = new DeleteCardTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1' }))
      expect(result.deleted).toBe(true)
      expect(result.cardId).toBe('1')
      expect(sdk.deleteCard).toHaveBeenCalledWith('1', undefined)
    })
  })

  describe('GetCardsByStatusTool', () => {
    it('returns cards in status', async () => {
      const tool = new GetCardsByStatusTool(sdk)
      const result = JSON.parse(await tool.invoke({ status: 'todo' }))
      expect(Array.isArray(result)).toBe(true)
      expect(sdk.getCardsByStatus).toHaveBeenCalledWith('todo', undefined)
    })
  })

  describe('TriggerActionTool', () => {
    it('triggers an action', async () => {
      const tool = new TriggerActionTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', action: 'deploy' }))
      expect(result.success).toBe(true)
      expect(sdk.triggerAction).toHaveBeenCalledWith('1', 'deploy', undefined)
    })
  })
})

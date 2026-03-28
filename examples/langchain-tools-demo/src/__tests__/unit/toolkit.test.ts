/**
 * Unit tests — toolkit and LangGraph helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createKanbanToolkit,
  createRefreshBoardNode,
  createKanbanToolNode,
} from 'kl-langchain-tools'
import { createMockSDK } from '../helpers'

describe('Toolkit (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('returns all 39 tools by default', () => {
    const tools = createKanbanToolkit(sdk)
    expect(tools).toHaveLength(39)
  })

  it('all tool names are unique', () => {
    const tools = createKanbanToolkit(sdk)
    const names = tools.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('all tool names start with kanban_', () => {
    const tools = createKanbanToolkit(sdk)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^kanban_/)
    }
  })

  it('all tools have a description', () => {
    const tools = createKanbanToolkit(sdk)
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })

  it('filters cards only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: true, comments: false, columns: false,
      labels: false, boards: false, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(8)
    expect(tools.every(t => t.name.startsWith('kanban_'))).toBe(true)
  })

  it('filters comments only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: true, columns: false,
      labels: false, boards: false, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(5)
  })

  it('filters columns only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: false, columns: true,
      labels: false, boards: false, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(5)
  })

  it('filters labels only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: false, columns: false,
      labels: true, boards: false, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(7)
  })

  it('filters boards only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: false, columns: false,
      labels: false, boards: true, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(6)
  })

  it('filters logs only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: false, columns: false,
      labels: false, boards: false, logs: true, attachments: false,
    })
    expect(tools).toHaveLength(5)
  })

  it('filters attachments only', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: false, columns: false,
      labels: false, boards: false, logs: false, attachments: true,
    })
    expect(tools).toHaveLength(3)
  })

  it('returns empty array when all disabled', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: false, comments: false, columns: false,
      labels: false, boards: false, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(0)
  })

  it('combines multiple categories', () => {
    const tools = createKanbanToolkit(sdk, {
      cards: true, comments: true, columns: false,
      labels: false, boards: false, logs: false, attachments: false,
    })
    expect(tools).toHaveLength(13) // 8 + 5
  })
})

describe('LangGraph helpers (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  describe('createRefreshBoardNode', () => {
    it('returns a board snapshot', async () => {
      const node = createRefreshBoardNode(sdk)
      const result = await node({})
      expect(result.board).toBeDefined()
      expect(result.board.boardId).toBe('default')
      expect(result.board.cards).toHaveLength(2)
      expect(result.board.columns).toHaveLength(3)
      expect(result.board.labels).toHaveProperty('bug')
      expect(result.board.lastRefreshed).toBeTruthy()
    })

    it('passes custom boardId', async () => {
      const node = createRefreshBoardNode(sdk, 'sprint-1')
      const result = await node({})
      expect(result.board.boardId).toBe('sprint-1')
      expect(sdk.listCards).toHaveBeenCalledWith(undefined, 'sprint-1')
      expect(sdk.listColumns).toHaveBeenCalledWith('sprint-1')
    })

    it('card summaries have expected fields', async () => {
      const node = createRefreshBoardNode(sdk)
      const result = await node({})
      const card = result.board.cards[0]
      expect(card).toHaveProperty('id')
      expect(card).toHaveProperty('title')
      expect(card).toHaveProperty('status')
      expect(card).toHaveProperty('priority')
      expect(card).toHaveProperty('assignee')
      expect(card).toHaveProperty('labels')
      expect(card).toHaveProperty('dueDate')
      expect(card).toHaveProperty('commentCount')
    })
  })

  describe('createKanbanToolNode', () => {
    it('processes a single tool call', async () => {
      const node = createKanbanToolNode(sdk)
      const result = await node({
        messages: [{
          tool_calls: [{ id: 'tc_1', name: 'kanban_list_boards', args: {} }],
        }],
      })
      expect(result.messages).toHaveLength(1)
      const msg = result.messages[0] as any
      expect(msg.role).toBe('tool')
      expect(msg.tool_call_id).toBe('tc_1')
      const content = JSON.parse(msg.content)
      expect(content).toHaveLength(1)
      expect(content[0].id).toBe('default')
    })

    it('processes multiple tool calls', async () => {
      const node = createKanbanToolNode(sdk)
      const result = await node({
        messages: [{
          tool_calls: [
            { id: 'tc_1', name: 'kanban_list_boards', args: {} },
            { id: 'tc_2', name: 'kanban_list_columns', args: {} },
          ],
        }],
      })
      expect(result.messages).toHaveLength(2)
    })

    it('returns error for unknown tool', async () => {
      const node = createKanbanToolNode(sdk)
      const result = await node({
        messages: [{
          tool_calls: [{ id: 'tc_1', name: 'nonexistent', args: {} }],
        }],
      })
      expect((result.messages[0] as any).content).toContain('Tool not found')
    })

    it('returns empty when no tool_calls', async () => {
      const node = createKanbanToolNode(sdk)
      const result = await node({ messages: [{ role: 'user', content: 'hello' }] })
      expect(result.messages).toEqual([])
    })

    it('returns empty for empty messages', async () => {
      const node = createKanbanToolNode(sdk)
      const result = await node({ messages: [] })
      expect(result.messages).toEqual([])
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KanbanSDK } from '../tools/types'
import { createKanbanToolkit } from '../toolkit'
import {
  ListCardsTool,
  GetCardTool,
  CreateCardTool,
  UpdateCardTool,
  MoveCardTool,
  DeleteCardTool,
  GetCardsByStatusTool,
  TriggerActionTool,
} from '../tools/cards'
import {
  ListCommentsTool,
  AddCommentTool,
  UpdateCommentTool,
  DeleteCommentTool,
  StreamCommentTool,
  streamCommentDirect,
} from '../tools/comments'
import {
  ListColumnsTool,
  AddColumnTool,
  UpdateColumnTool,
  RemoveColumnTool,
  ReorderColumnsTool,
} from '../tools/columns'
import {
  GetLabelsTool,
  SetLabelTool,
  DeleteLabelTool,
  RenameLabelTool,
  GetUniqueAssigneesTool,
  GetUniqueLabelsTool,
  FilterCardsByLabelGroupTool,
} from '../tools/labels'
import {
  ListBoardsTool,
  GetBoardTool,
  CreateBoardTool,
  DeleteBoardTool,
  UpdateBoardTool,
  GetBoardActionsTool,
} from '../tools/boards'
import {
  ListLogsTool,
  AddLogTool,
  ClearLogsTool,
  ListBoardLogsTool,
  AddBoardLogTool,
} from '../tools/logs'
import {
  ListAttachmentsTool,
  AddAttachmentTool,
  RemoveAttachmentTool,
} from '../tools/attachments'

// ---------------------------------------------------------------------------
// Mock SDK factory
// ---------------------------------------------------------------------------

function createMockSDK(): KanbanSDK {
  return {
    workspaceRoot: '/tmp/test-workspace',
    init: vi.fn().mockResolvedValue(undefined),

    // Board
    listBoards: vi.fn().mockReturnValue([{ id: 'default', name: 'Default Board' }]),
    getBoard: vi.fn().mockReturnValue({ id: 'default', name: 'Default Board', columns: [] }),
    createBoard: vi.fn().mockReturnValue({ id: 'bugs', name: 'Bugs' }),
    deleteBoard: vi.fn(),
    updateBoard: vi.fn().mockReturnValue({ id: 'default', name: 'Updated' }),
    getBoardActions: vi.fn().mockReturnValue({ deploy: 'Deploy to prod' }),

    // Card
    listCards: vi.fn().mockResolvedValue([
      {
        id: '1', content: '# Test Card\n\nBody', status: 'todo', priority: 'medium',
        assignee: 'alice', labels: ['bug'], dueDate: null, comments: [{ id: 'c1' }],
        created: '2025-01-01T00:00:00Z', modified: '2025-01-02T00:00:00Z',
      },
    ]),
    getCard: vi.fn().mockResolvedValue({
      id: '1', content: '# Test Card', status: 'todo', priority: 'medium',
      assignee: 'alice', labels: ['bug'], comments: [],
    }),
    createCard: vi.fn().mockResolvedValue({ id: '2', status: 'todo', created: '2025-01-01T00:00:00Z' }),
    updateCard: vi.fn().mockResolvedValue({ id: '1', modified: '2025-01-02T00:00:00Z' }),
    moveCard: vi.fn().mockResolvedValue({ id: '1', status: 'done', modified: '2025-01-02T00:00:00Z' }),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    triggerAction: vi.fn().mockResolvedValue({ success: true }),
    getCardsByStatus: vi.fn().mockResolvedValue([
      { id: '1', content: '# Card', status: 'todo', priority: 'medium', assignee: null, labels: [] },
    ]),
    getUniqueAssignees: vi.fn().mockResolvedValue(['alice', 'bob']),
    getUniqueLabels: vi.fn().mockResolvedValue(['bug', 'feature']),

    // Comment
    listComments: vi.fn().mockResolvedValue([{ id: 'c1', author: 'alice', content: 'Hello', created: '2025-01-01T00:00:00Z' }]),
    addComment: vi.fn().mockResolvedValue({
      comments: [{ id: 'c1', author: 'bot', content: 'Hi there', created: '2025-01-01T00:00:00Z' }],
    }),
    updateComment: vi.fn().mockResolvedValue({
      comments: [{ id: 'c1', author: 'bot', content: 'Updated content', created: '2025-01-01T00:00:00Z' }],
    }),
    deleteComment: vi.fn().mockResolvedValue({ comments: [] }),
    streamComment: vi.fn().mockResolvedValue({
      comments: [{ id: 'c2', author: 'agent', content: 'Streamed text', created: '2025-01-01T00:00:00Z' }],
    }),

    // Column
    listColumns: vi.fn().mockReturnValue([{ id: 'todo', name: 'To Do', color: '#3b82f6' }]),
    addColumn: vi.fn().mockReturnValue({ id: 'review', name: 'Review' }),
    updateColumn: vi.fn().mockReturnValue({ id: 'todo', name: 'Backlog' }),
    removeColumn: vi.fn(),
    reorderColumns: vi.fn(),

    // Label
    getLabels: vi.fn().mockReturnValue({ bug: { color: '#ef4444' }, feature: { color: '#22c55e' } }),
    setLabel: vi.fn(),
    deleteLabel: vi.fn(),
    renameLabel: vi.fn(),
    filterCardsByLabelGroup: vi.fn().mockResolvedValue([
      { id: '1', content: '# Card', labels: ['bug'] },
    ]),

    // Attachment
    listAttachments: vi.fn().mockResolvedValue(['screenshot.png']),
    addAttachment: vi.fn().mockResolvedValue({ filename: 'file.txt', cardId: '1' }),
    removeAttachment: vi.fn().mockResolvedValue(undefined),

    // Log
    listLogs: vi.fn().mockResolvedValue([{ timestamp: '2025-01-01T00:00:00Z', source: 'ci', text: 'Build passed' }]),
    addLog: vi.fn().mockResolvedValue({ timestamp: '2025-01-01T00:00:00Z', source: 'agent', text: 'Deployed' }),
    clearLogs: vi.fn().mockResolvedValue(undefined),
    listBoardLogs: vi.fn().mockResolvedValue([]),
    addBoardLog: vi.fn().mockResolvedValue({ timestamp: '2025-01-01T00:00:00Z', source: 'system', text: 'Board created' }),
    clearBoardLogs: vi.fn().mockResolvedValue(undefined),

    // Settings
    getSettings: vi.fn().mockReturnValue({ zoom: 1 }),
    updateSettings: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Toolkit tests
// ---------------------------------------------------------------------------

describe('createKanbanToolkit', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('returns all tools by default', () => {
    const tools = createKanbanToolkit(sdk)
    // 8 card + 5 comment + 5 column + 7 label + 6 board + 5 log + 3 attachment = 39
    expect(tools.length).toBe(39)
  })

  it('respects category filters', () => {
    const tools = createKanbanToolkit(sdk, { cards: true, comments: false, columns: false, labels: false, boards: false, logs: false, attachments: false })
    expect(tools.length).toBe(8) // only card tools
  })

  it('all tools have name and description', () => {
    const tools = createKanbanToolkit(sdk)
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.name).toMatch(/^kanban_/)
    }
  })

  it('all tool names are unique', () => {
    const tools = createKanbanToolkit(sdk)
    const names = tools.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

// ---------------------------------------------------------------------------
// Card tools
// ---------------------------------------------------------------------------

describe('Card tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('ListCardsTool calls sdk.listCards and returns JSON', async () => {
    const tool = new ListCardsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
    expect(result[0].title).toBe('Test Card')
    expect(sdk.listCards).toHaveBeenCalled()
  })

  it('ListCardsTool filters by status', async () => {
    const tool = new ListCardsTool(sdk)
    const result = JSON.parse(await tool.invoke({ status: 'done' }))
    expect(result).toHaveLength(0) // mock card is 'todo'
  })

  it('GetCardTool calls sdk.getCard', async () => {
    const tool = new GetCardTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1' }))
    expect(result.id).toBe('1')
    expect(sdk.getCard).toHaveBeenCalledWith('1', undefined)
  })

  it('CreateCardTool creates a card', async () => {
    const tool = new CreateCardTool(sdk)
    const result = JSON.parse(await tool.invoke({ title: 'New Card' }))
    expect(result.id).toBe('2')
    expect(sdk.createCard).toHaveBeenCalledWith(expect.objectContaining({
      content: '# New Card',
    }))
  })

  it('CreateCardTool includes body content', async () => {
    const tool = new CreateCardTool(sdk)
    await tool.invoke({ title: 'Title', content: 'Body text' })
    expect(sdk.createCard).toHaveBeenCalledWith(expect.objectContaining({
      content: '# Title\n\nBody text',
    }))
  })

  it('UpdateCardTool updates a card', async () => {
    const tool = new UpdateCardTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', priority: 'high' }))
    expect(result.id).toBe('1')
    expect(sdk.updateCard).toHaveBeenCalledWith('1', { priority: 'high' }, undefined)
  })

  it('MoveCardTool moves a card', async () => {
    const tool = new MoveCardTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', newStatus: 'done' }))
    expect(result.status).toBe('done')
    expect(sdk.moveCard).toHaveBeenCalledWith('1', 'done', undefined, undefined)
  })

  it('DeleteCardTool deletes a card', async () => {
    const tool = new DeleteCardTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1' }))
    expect(result.deleted).toBe(true)
    expect(sdk.deleteCard).toHaveBeenCalledWith('1', undefined)
  })

  it('GetCardsByStatusTool filters by status', async () => {
    const tool = new GetCardsByStatusTool(sdk)
    const result = JSON.parse(await tool.invoke({ status: 'todo' }))
    expect(result).toHaveLength(1)
    expect(sdk.getCardsByStatus).toHaveBeenCalledWith('todo', undefined)
  })

  it('TriggerActionTool triggers an action', async () => {
    const tool = new TriggerActionTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', action: 'deploy' }))
    expect(result.success).toBe(true)
    expect(sdk.triggerAction).toHaveBeenCalledWith('1', 'deploy', undefined)
  })
})

// ---------------------------------------------------------------------------
// Comment tools
// ---------------------------------------------------------------------------

describe('Comment tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('ListCommentsTool lists comments', async () => {
    const tool = new ListCommentsTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1' }))
    expect(result).toHaveLength(1)
    expect(result[0].author).toBe('alice')
  })

  it('AddCommentTool adds a comment', async () => {
    const tool = new AddCommentTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', author: 'bot', content: 'Hi there' }))
    expect(result.author).toBe('bot')
    expect(sdk.addComment).toHaveBeenCalledWith('1', 'bot', 'Hi there', undefined)
  })

  it('UpdateCommentTool updates a comment', async () => {
    const tool = new UpdateCommentTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', commentId: 'c1', content: 'Updated content' }))
    expect(result.content).toBe('Updated content')
  })

  it('DeleteCommentTool deletes a comment', async () => {
    const tool = new DeleteCommentTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', commentId: 'c1' }))
    expect(result.deleted).toBe(true)
    expect(sdk.deleteComment).toHaveBeenCalledWith('1', 'c1', undefined)
  })

  it('StreamCommentTool streams a comment', async () => {
    const tool = new StreamCommentTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', author: 'agent', content: 'Streamed text' }))
    expect(result.content).toBe('Streamed text')
    expect(sdk.streamComment).toHaveBeenCalled()
  })

  it('streamCommentDirect passes through to sdk.streamComment', async () => {
    async function* gen() { yield 'hello' }
    const onStart = vi.fn()
    const onChunk = vi.fn()
    await streamCommentDirect(sdk, {
      cardId: '1', author: 'bot', stream: gen(),
      onStart, onChunk,
    })
    expect(sdk.streamComment).toHaveBeenCalledWith('1', 'bot', expect.anything(), {
      boardId: undefined,
      onStart,
      onChunk,
    })
  })
})

// ---------------------------------------------------------------------------
// Column tools
// ---------------------------------------------------------------------------

describe('Column tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('ListColumnsTool lists columns', async () => {
    const tool = new ListColumnsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('todo')
  })

  it('AddColumnTool adds a column', async () => {
    const tool = new AddColumnTool(sdk)
    const result = JSON.parse(await tool.invoke({ id: 'review', name: 'Review' }))
    expect(result.id).toBe('review')
  })

  it('UpdateColumnTool updates a column', async () => {
    const tool = new UpdateColumnTool(sdk)
    const result = JSON.parse(await tool.invoke({ columnId: 'todo', name: 'Backlog' }))
    expect(result.name).toBe('Backlog')
  })

  it('RemoveColumnTool removes a column', async () => {
    const tool = new RemoveColumnTool(sdk)
    const result = JSON.parse(await tool.invoke({ columnId: 'todo' }))
    expect(result.removed).toBe(true)
    expect(sdk.removeColumn).toHaveBeenCalledWith('todo', undefined)
  })

  it('ReorderColumnsTool reorders columns', async () => {
    const tool = new ReorderColumnsTool(sdk)
    const result = JSON.parse(await tool.invoke({ columnIds: ['done', 'todo'] }))
    expect(result.reordered).toBe(true)
    expect(sdk.reorderColumns).toHaveBeenCalledWith(['done', 'todo'], undefined)
  })
})

// ---------------------------------------------------------------------------
// Label tools
// ---------------------------------------------------------------------------

describe('Label tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('GetLabelsTool gets labels', async () => {
    const tool = new GetLabelsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result.bug).toBeDefined()
  })

  it('SetLabelTool sets a label', async () => {
    const tool = new SetLabelTool(sdk)
    const result = JSON.parse(await tool.invoke({ name: 'urgent', color: '#ff0000' }))
    expect(result.set).toBe(true)
    expect(sdk.setLabel).toHaveBeenCalledWith('urgent', { color: '#ff0000' })
  })

  it('DeleteLabelTool deletes a label', async () => {
    const tool = new DeleteLabelTool(sdk)
    const result = JSON.parse(await tool.invoke({ name: 'bug' }))
    expect(result.deleted).toBe(true)
  })

  it('RenameLabelTool renames a label', async () => {
    const tool = new RenameLabelTool(sdk)
    const result = JSON.parse(await tool.invoke({ oldName: 'bug', newName: 'defect' }))
    expect(result.renamed).toBe(true)
    expect(sdk.renameLabel).toHaveBeenCalledWith('bug', 'defect')
  })

  it('GetUniqueAssigneesTool returns assignees', async () => {
    const tool = new GetUniqueAssigneesTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toEqual(['alice', 'bob'])
  })

  it('GetUniqueLabelsTool returns labels', async () => {
    const tool = new GetUniqueLabelsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toEqual(['bug', 'feature'])
  })

  it('FilterCardsByLabelGroupTool filters', async () => {
    const tool = new FilterCardsByLabelGroupTool(sdk)
    const result = JSON.parse(await tool.invoke({ group: 'type' }))
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Board tools
// ---------------------------------------------------------------------------

describe('Board tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('ListBoardsTool lists boards', async () => {
    const tool = new ListBoardsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('default')
  })

  it('GetBoardTool gets a board', async () => {
    const tool = new GetBoardTool(sdk)
    const result = JSON.parse(await tool.invoke({ boardId: 'default' }))
    expect(result.id).toBe('default')
  })

  it('CreateBoardTool creates a board', async () => {
    const tool = new CreateBoardTool(sdk)
    const result = JSON.parse(await tool.invoke({ id: 'bugs', name: 'Bugs' }))
    expect(result.id).toBe('bugs')
  })

  it('DeleteBoardTool deletes a board', async () => {
    const tool = new DeleteBoardTool(sdk)
    const result = JSON.parse(await tool.invoke({ boardId: 'bugs' }))
    expect(result.deleted).toBe(true)
  })

  it('UpdateBoardTool updates a board', async () => {
    const tool = new UpdateBoardTool(sdk)
    const result = JSON.parse(await tool.invoke({ boardId: 'default', name: 'Updated' }))
    expect(result.name).toBe('Updated')
  })

  it('GetBoardActionsTool returns board actions', async () => {
    const tool = new GetBoardActionsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result.deploy).toBe('Deploy to prod')
  })
})

// ---------------------------------------------------------------------------
// Log tools
// ---------------------------------------------------------------------------

describe('Log tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('ListLogsTool lists logs', async () => {
    const tool = new ListLogsTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1' }))
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Build passed')
  })

  it('AddLogTool adds a log entry', async () => {
    const tool = new AddLogTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', text: 'Deployed', source: 'agent' }))
    expect(result.text).toBe('Deployed')
  })

  it('ClearLogsTool clears logs', async () => {
    const tool = new ClearLogsTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1' }))
    expect(result.cleared).toBe(true)
  })

  it('ListBoardLogsTool lists board logs', async () => {
    const tool = new ListBoardLogsTool(sdk)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toEqual([])
  })

  it('AddBoardLogTool adds a board log', async () => {
    const tool = new AddBoardLogTool(sdk)
    const result = JSON.parse(await tool.invoke({ text: 'Board created', source: 'system' }))
    expect(result.text).toBe('Board created')
  })
})

// ---------------------------------------------------------------------------
// Attachment tools
// ---------------------------------------------------------------------------

describe('Attachment tools', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('ListAttachmentsTool lists attachments', async () => {
    const tool = new ListAttachmentsTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1' }))
    expect(result).toEqual(['screenshot.png'])
  })

  it('AddAttachmentTool adds an attachment', async () => {
    const tool = new AddAttachmentTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', sourcePath: '/tmp/file.txt' }))
    expect(result.filename).toBe('file.txt')
  })

  it('RemoveAttachmentTool removes an attachment', async () => {
    const tool = new RemoveAttachmentTool(sdk)
    const result = JSON.parse(await tool.invoke({ cardId: '1', attachment: 'screenshot.png' }))
    expect(result.removed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LangGraph helpers
// ---------------------------------------------------------------------------

describe('LangGraph helpers', () => {
  let sdk: KanbanSDK

  beforeEach(() => { sdk = createMockSDK() })

  it('createRefreshBoardNode builds a board snapshot', async () => {
    const { createRefreshBoardNode } = await import('../langgraph')
    const node = createRefreshBoardNode(sdk)
    const result = await node({})
    expect(result.board).toBeDefined()
    expect(result.board.cards).toHaveLength(1)
    expect(result.board.columns).toHaveLength(1)
    expect(result.board.labels).toHaveProperty('bug')
    expect(result.board.lastRefreshed).toBeTruthy()
  })

  it('createKanbanToolNode processes tool calls from messages', async () => {
    const { createKanbanToolNode } = await import('../langgraph')
    const node = createKanbanToolNode(sdk)

    const state = {
      messages: [{
        tool_calls: [
          { id: 'tc_1', name: 'kanban_list_boards', args: {} },
        ],
      }],
    }
    const result = await node(state)
    expect(result.messages).toHaveLength(1)
    const parsed = JSON.parse((result.messages[0] as any).content)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('default')
  })

  it('createKanbanToolNode returns error for unknown tool', async () => {
    const { createKanbanToolNode } = await import('../langgraph')
    const node = createKanbanToolNode(sdk)

    const state = {
      messages: [{
        tool_calls: [{ id: 'tc_1', name: 'nonexistent_tool', args: {} }],
      }],
    }
    const result = await node(state)
    expect((result.messages[0] as any).content).toContain('Tool not found')
  })

  it('createKanbanToolNode returns empty when no tool_calls', async () => {
    const { createKanbanToolNode } = await import('../langgraph')
    const node = createKanbanToolNode(sdk)

    const result = await node({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result.messages).toEqual([])
  })
})

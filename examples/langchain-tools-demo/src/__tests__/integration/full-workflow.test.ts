/**
 * Integration tests — exercises every adapter feature against a real KanbanSDK
 * workspace with actual file-based storage.
 *
 * These tests create a temporary workspace, initialise the SDK, and invoke
 * every tool category to verify end-to-end behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Use source path (kanban-lite may not be built)
import { KanbanSDK } from '../../../../../packages/kanban-lite/src/sdk/index'
import {
  createKanbanToolkit,
  CreateCardTool,
  ListCardsTool,
  GetCardTool,
  UpdateCardTool,
  MoveCardTool,
  DeleteCardTool,
  GetCardsByStatusTool,
  ListCommentsTool,
  AddCommentTool,
  UpdateCommentTool,
  DeleteCommentTool,
  StreamCommentTool,
  streamCommentDirect,
  ListColumnsTool,
  AddColumnTool,
  UpdateColumnTool,
  RemoveColumnTool,
  ReorderColumnsTool,
  GetLabelsTool,
  SetLabelTool,
  DeleteLabelTool,
  RenameLabelTool,
  GetUniqueAssigneesTool,
  GetUniqueLabelsTool,
  ListBoardsTool,
  GetBoardTool,
  CreateBoardTool,
  DeleteBoardTool,
  UpdateBoardTool,
  GetBoardActionsTool,
  ListLogsTool,
  AddLogTool,
  ClearLogsTool,
  ListBoardLogsTool,
  AddBoardLogTool,
  ListAttachmentsTool,
  AddAttachmentTool,
  RemoveAttachmentTool,
  createRefreshBoardNode,
  createKanbanToolNode,
} from 'kl-adapter-langchain'

// ---------------------------------------------------------------------------
// Test workspace lifecycle
// ---------------------------------------------------------------------------

let sdk: KanbanSDK
let kanbanDir: string
let tmpDir: string

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-integration-'))
  kanbanDir = path.join(tmpDir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    path.join(tmpDir, '.kanban.json'),
    JSON.stringify({
      $schema: 'kanban-lite',
      defaultBoard: 'default',
      boards: {
        default: {
          name: 'Integration Test Board',
          columns: [
            { id: 'backlog', name: 'Backlog', color: '#94a3b8' },
            { id: 'todo', name: 'To Do', color: '#3b82f6' },
            { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
            { id: 'done', name: 'Done', color: '#22c55e' },
          ],
        },
      },
    }, null, 2),
  )
  sdk = new KanbanSDK(kanbanDir)
  await sdk.init()
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

describe('Toolkit (integration)', () => {
  it('creates all 39 tools from a real SDK', () => {
    const tools = createKanbanToolkit(sdk)
    expect(tools).toHaveLength(39)
    const names = tools.map(t => t.name)
    expect(new Set(names).size).toBe(39)
  })
})

// ---------------------------------------------------------------------------
// Board tools
// ---------------------------------------------------------------------------

describe('Board tools (integration)', () => {
  it('lists boards', async () => {
    const tool = new ListBoardsTool(sdk as any)
    const result = JSON.parse(await tool.invoke({}))
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.find((b: any) => b.id === 'default')).toBeDefined()
  })

  it('gets a board', async () => {
    const tool = new GetBoardTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ boardId: 'default' }))
    expect(result.name).toBe('Integration Test Board')
  })

  it('creates, updates, and deletes a board', async () => {
    const create = new CreateBoardTool(sdk as any)
    const created = JSON.parse(await create.invoke({ id: 'test-board', name: 'Test Board' }))
    // createBoard returns the board info (may not include id in the return value)
    expect(created).toBeDefined()

    const update = new UpdateBoardTool(sdk as any)
    const updated = JSON.parse(await update.invoke({ boardId: 'test-board', name: 'Updated Test' }))
    expect(updated).toBeDefined()

    const del = new DeleteBoardTool(sdk as any)
    const deleted = JSON.parse(await del.invoke({ boardId: 'test-board' }))
    expect(deleted.deleted).toBe(true)
  })

  it('gets board actions', async () => {
    const tool = new GetBoardActionsTool(sdk as any)
    const result = JSON.parse(await tool.invoke({}))
    expect(typeof result).toBe('object')
  })
})

// ---------------------------------------------------------------------------
// Column tools
// ---------------------------------------------------------------------------

describe('Column tools (integration)', () => {
  it('lists columns', async () => {
    const tool = new ListColumnsTool(sdk as any)
    const result = JSON.parse(await tool.invoke({}))
    expect(result.length).toBeGreaterThanOrEqual(4)
    expect(result.find((c: any) => c.id === 'todo')).toBeDefined()
  })

  it('adds, updates, and removes a column', async () => {
    const add = new AddColumnTool(sdk as any)
    const added = JSON.parse(await add.invoke({ id: 'testing', name: 'Testing', color: '#06b6d4' }))
    // addColumn may return void-like; verify column was actually added
    expect(added).toBeDefined()

    // Verify column exists now
    const list = new ListColumnsTool(sdk as any)
    const columns = JSON.parse(await list.invoke({}))
    expect(columns.find((c: any) => c.id === 'testing')).toBeDefined()

    const update = new UpdateColumnTool(sdk as any)
    const updated = JSON.parse(await update.invoke({ columnId: 'testing', name: 'QA Testing' }))
    expect(updated).toBeDefined()

    const remove = new RemoveColumnTool(sdk as any)
    const removed = JSON.parse(await remove.invoke({ columnId: 'testing' }))
    expect(removed.removed).toBe(true)
  })

  it('reorders columns', async () => {
    const list = new ListColumnsTool(sdk as any)
    const columns = JSON.parse(await list.invoke({}))
    const ids = columns.map((c: any) => c.id).reverse()

    const reorder = new ReorderColumnsTool(sdk as any)
    const result = JSON.parse(await reorder.invoke({ columnIds: ids }))
    expect(result.reordered).toBe(true)

    // Restore original order
    await reorder.invoke({ columnIds: columns.map((c: any) => c.id) })
  })
})

// ---------------------------------------------------------------------------
// Label tools
// ---------------------------------------------------------------------------

describe('Label tools (integration)', () => {
  it('sets and gets labels', async () => {
    const set = new SetLabelTool(sdk as any)
    await set.invoke({ name: 'bug', color: '#ef4444', group: 'type' })
    await set.invoke({ name: 'feature', color: '#22c55e', group: 'type' })

    const get = new GetLabelsTool(sdk as any)
    const labels = JSON.parse(await get.invoke({}))
    expect(labels).toHaveProperty('bug')
    expect(labels).toHaveProperty('feature')
  })

  it('renames and deletes a label', async () => {
    const set = new SetLabelTool(sdk as any)
    await set.invoke({ name: 'temp-label', color: '#999' })

    const rename = new RenameLabelTool(sdk as any)
    const renamed = JSON.parse(await rename.invoke({ oldName: 'temp-label', newName: 'renamed-label' }))
    expect(renamed.renamed).toBe(true)

    const del = new DeleteLabelTool(sdk as any)
    const deleted = JSON.parse(await del.invoke({ name: 'renamed-label' }))
    expect(deleted.deleted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Card tools
// ---------------------------------------------------------------------------

let testCardId: string

describe('Card tools (integration)', () => {
  it('creates a card', async () => {
    const tool = new CreateCardTool(sdk as any)
    const result = JSON.parse(await tool.invoke({
      title: 'Integration test card',
      content: 'Created by the integration test suite.',
      status: 'todo',
      priority: 'high',
      assignee: 'tester',
      labels: ['bug'],
    }))
    expect(result.id).toBeDefined()
    testCardId = result.id
  })

  it('lists cards', async () => {
    const tool = new ListCardsTool(sdk as any)
    const result = JSON.parse(await tool.invoke({}))
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.find((c: any) => c.id === testCardId)).toBeDefined()
  })

  it('gets card details', async () => {
    const tool = new GetCardTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ cardId: testCardId }))
    expect(result.id).toBe(testCardId)
    expect(result.content).toContain('Integration test card')
  })

  it('updates a card', async () => {
    const tool = new UpdateCardTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ cardId: testCardId, priority: 'critical' }))
    expect(result.id).toBe(testCardId)
  })

  it('moves a card', async () => {
    const tool = new MoveCardTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ cardId: testCardId, newStatus: 'in-progress' }))
    expect(result.status).toBe('in-progress')
  })

  it('gets cards by status', async () => {
    const tool = new GetCardsByStatusTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ status: 'in-progress' }))
    expect(result.find((c: any) => c.id === testCardId)).toBeDefined()
  })

  it('gets unique assignees', async () => {
    const tool = new GetUniqueAssigneesTool(sdk as any)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toContain('tester')
  })

  it('gets unique labels', async () => {
    const tool = new GetUniqueLabelsTool(sdk as any)
    const result = JSON.parse(await tool.invoke({}))
    expect(result).toContain('bug')
  })
})

// ---------------------------------------------------------------------------
// Comment tools (including streaming)
// ---------------------------------------------------------------------------

describe('Comment tools (integration)', () => {
  it('adds a comment', async () => {
    const tool = new AddCommentTool(sdk as any)
    const result = JSON.parse(await tool.invoke({
      cardId: testCardId, author: 'test-agent', content: 'First comment',
    }))
    expect(result.author).toBe('test-agent')
    expect(result.content).toBe('First comment')
  })

  it('lists comments', async () => {
    const tool = new ListCommentsTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ cardId: testCardId }))
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].author).toBe('test-agent')
  })

  it('updates a comment', async () => {
    const tool = new UpdateCommentTool(sdk as any)
    const result = JSON.parse(await tool.invoke({
      cardId: testCardId, commentId: 'c1', content: 'Updated comment',
    }))
    expect(result.content).toBe('Updated comment')
  })

  it('streams a comment via tool', async () => {
    const tool = new StreamCommentTool(sdk as any)
    const result = JSON.parse(await tool.invoke({
      cardId: testCardId, author: 'stream-agent', content: 'Streamed via tool',
    }))
    expect(result.content).toBe('Streamed via tool')
    expect(result.author).toBe('stream-agent')
  })

  it('streams a comment via streamCommentDirect', async () => {
    const chunks: string[] = []
    let startedCommentId: string | undefined

    async function* generateChunks(): AsyncIterable<string> {
      yield 'Hello '
      yield 'from '
      yield 'direct stream!'
    }

    const card = await streamCommentDirect(sdk as any, {
      cardId: testCardId,
      author: 'direct-streamer',
      stream: generateChunks(),
      onStart: (commentId) => { startedCommentId = commentId },
      onChunk: (_id, chunk) => { chunks.push(chunk) },
    })

    expect(startedCommentId).toBeDefined()
    expect(chunks).toEqual(['Hello ', 'from ', 'direct stream!'])
    expect(card.comments.length).toBeGreaterThanOrEqual(3)
    const lastComment = card.comments[card.comments.length - 1]
    expect(lastComment.content).toBe('Hello from direct stream!')
    expect(lastComment.author).toBe('direct-streamer')
  })

  it('deletes a comment', async () => {
    const tool = new DeleteCommentTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ cardId: testCardId, commentId: 'c1' }))
    expect(result.deleted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Log tools
// ---------------------------------------------------------------------------

describe('Log tools (integration)', () => {
  it('adds and lists card logs', async () => {
    const add = new AddLogTool(sdk as any)
    const entry = JSON.parse(await add.invoke({
      cardId: testCardId, text: 'Deployed to staging', source: 'ci',
      object: { commit: 'abc123' },
    }))
    expect(entry.text).toBe('Deployed to staging')

    const list = new ListLogsTool(sdk as any)
    const logs = JSON.parse(await list.invoke({ cardId: testCardId }))
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs.find((l: any) => l.text === 'Deployed to staging')).toBeDefined()
  })

  it('clears card logs', async () => {
    const clear = new ClearLogsTool(sdk as any)
    const result = JSON.parse(await clear.invoke({ cardId: testCardId }))
    expect(result.cleared).toBe(true)

    const list = new ListLogsTool(sdk as any)
    const logs = JSON.parse(await list.invoke({ cardId: testCardId }))
    expect(logs).toHaveLength(0)
  })

  it('adds and lists board logs', async () => {
    const add = new AddBoardLogTool(sdk as any)
    const entry = JSON.parse(await add.invoke({ text: 'Board created', source: 'system' }))
    expect(entry.text).toBe('Board created')

    const list = new ListBoardLogsTool(sdk as any)
    const logs = JSON.parse(await list.invoke({}))
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Attachment tools
// ---------------------------------------------------------------------------

describe('Attachment tools (integration)', () => {
  const tmpFile = path.join(os.tmpdir(), 'kl-test-attach.txt')

  beforeAll(() => {
    fs.writeFileSync(tmpFile, 'test attachment content')
  })

  afterAll(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('adds and lists an attachment', async () => {
    const add = new AddAttachmentTool(sdk as any)
    await add.invoke({ cardId: testCardId, sourcePath: tmpFile })

    const list = new ListAttachmentsTool(sdk as any)
    const result = JSON.parse(await list.invoke({ cardId: testCardId }))
    expect(result).toContain('kl-test-attach.txt')
  })

  it('removes an attachment', async () => {
    const remove = new RemoveAttachmentTool(sdk as any)
    const result = JSON.parse(await remove.invoke({
      cardId: testCardId, attachment: 'kl-test-attach.txt',
    }))
    expect(result.removed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LangGraph helpers
// ---------------------------------------------------------------------------

describe('LangGraph helpers (integration)', () => {
  it('refreshBoardNode returns live board snapshot', async () => {
    const node = createRefreshBoardNode(sdk as any)
    const result = await node({})
    expect(result.board).toBeDefined()
    expect(result.board.cards.length).toBeGreaterThanOrEqual(1)
    expect(result.board.columns.length).toBeGreaterThanOrEqual(4)
    expect(result.board.lastRefreshed).toBeTruthy()

    // Verify card summaries have expected fields
    const card = result.board.cards.find((c: any) => c.id === testCardId)
    expect(card).toBeDefined()
    expect(card!.title).toBe('Integration test card')
    expect(card!.status).toBe('in-progress')
  })

  it('toolNode processes list_cards via tool call', async () => {
    const node = createKanbanToolNode(sdk as any)
    const result = await node({
      messages: [{
        tool_calls: [{ id: 'tc_1', name: 'kanban_list_cards', args: {} }],
      }],
    })
    expect(result.messages).toHaveLength(1)
    const cards = JSON.parse((result.messages[0] as any).content)
    expect(cards.length).toBeGreaterThanOrEqual(1)
  })

  it('toolNode processes multiple tool calls', async () => {
    const node = createKanbanToolNode(sdk as any)
    const result = await node({
      messages: [{
        tool_calls: [
          { id: 'tc_1', name: 'kanban_list_boards', args: {} },
          { id: 'tc_2', name: 'kanban_list_columns', args: {} },
          { id: 'tc_3', name: 'kanban_get_labels', args: {} },
        ],
      }],
    })
    expect(result.messages).toHaveLength(3)
    // Verify each response is valid JSON
    for (const msg of result.messages) {
      expect(() => JSON.parse((msg as any).content)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// Cleanup: delete card at the end
// ---------------------------------------------------------------------------

describe('Cleanup (integration)', () => {
  it('deletes the test card', async () => {
    const tool = new DeleteCardTool(sdk as any)
    const result = JSON.parse(await tool.invoke({ cardId: testCardId }))
    expect(result.deleted).toBe(true)
  })
})

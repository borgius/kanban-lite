/**
 * Agent demo — exercises every tool category from kl-adapter-langchain.
 *
 * This script creates a temporary kanban workspace, initialises the SDK,
 * builds the full toolkit, and invokes each tool to demonstrate the complete
 * adapter surface area.
 *
 * Run:
 *   npx tsx src/agent-demo.ts
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
// Use source path (kanban-lite may not be built)
import { KanbanSDK } from '../../packages/kanban-lite/src/sdk/index'
import {
  createKanbanToolkit,
  // Individual tools
  ListCardsTool,
  GetCardTool,
  CreateCardTool,
  UpdateCardTool,
  MoveCardTool,
  DeleteCardTool,
  GetCardsByStatusTool,
  TriggerActionTool,
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
  FilterCardsByLabelGroupTool,
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
  // LangGraph
  createRefreshBoardNode,
  createKanbanToolNode,
} from 'kl-adapter-langchain'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-langchain-demo-'))
  const kanbanDir = path.join(dir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.kanban.json'),
    JSON.stringify({
      $schema: 'kanban-lite',
      defaultBoard: 'default',
      boards: {
        default: {
          name: 'Demo Board',
          columns: [
            { id: 'backlog', name: 'Backlog', color: '#94a3b8' },
            { id: 'todo', name: 'To Do', color: '#3b82f6' },
            { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
            { id: 'review', name: 'Review', color: '#8b5cf6' },
            { id: 'done', name: 'Done', color: '#22c55e' },
          ],
        },
      },
    }, null, 2),
  )
  return kanbanDir
}

function log(section: string, message: string) {
  console.log(`\n  [${section}] ${message}`)
}

function logResult(label: string, result: string) {
  const parsed = JSON.parse(result)
  console.log(`    ${label}:`, JSON.stringify(parsed, null, 2).split('\n').join('\n    '))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const kanbanDir = createTempWorkspace()
  console.log(`\n🗂  Workspace: ${kanbanDir}\n`)

  const sdk = new KanbanSDK(kanbanDir)
  await sdk.init()

  // --- Full toolkit ---
  const allTools = createKanbanToolkit(sdk)
  console.log(`✅ Loaded ${allTools.length} tools`)
  console.log(`   Tool names: ${allTools.map(t => t.name).join(', ')}`)

  // --- Selective toolkit ---
  const cardOnly = createKanbanToolkit(sdk, {
    cards: true, comments: false, columns: false,
    labels: false, boards: false, logs: false, attachments: false,
  })
  console.log(`\n✅ Selective load (cards only): ${cardOnly.length} tools`)

  // ===================== BOARDS =====================
  log('Boards', 'List boards')
  const listBoards = new ListBoardsTool(sdk)
  logResult('boards', await listBoards.invoke({}))

  log('Boards', 'Get board')
  const getBoard = new GetBoardTool(sdk)
  logResult('board', await getBoard.invoke({ boardId: 'default' }))

  log('Boards', 'Create board')
  const createBoard = new CreateBoardTool(sdk)
  logResult('created', await createBoard.invoke({ id: 'sprint-1', name: 'Sprint 1' }))

  log('Boards', 'Update board')
  const updateBoard = new UpdateBoardTool(sdk)
  logResult('updated', await updateBoard.invoke({ boardId: 'sprint-1', name: 'Sprint 1 (updated)' }))

  log('Boards', 'Get board actions')
  const getBoardActions = new GetBoardActionsTool(sdk)
  logResult('actions', await getBoardActions.invoke({}))

  log('Boards', 'Delete board')
  const deleteBoard = new DeleteBoardTool(sdk)
  logResult('deleted', await deleteBoard.invoke({ boardId: 'sprint-1' }))

  // ===================== COLUMNS =====================
  log('Columns', 'List columns')
  const listColumns = new ListColumnsTool(sdk)
  logResult('columns', await listColumns.invoke({}))

  log('Columns', 'Add column')
  const addColumn = new AddColumnTool(sdk)
  logResult('added', await addColumn.invoke({ id: 'testing', name: 'Testing', color: '#06b6d4' }))

  log('Columns', 'Update column')
  const updateColumn = new UpdateColumnTool(sdk)
  logResult('updated', await updateColumn.invoke({ columnId: 'testing', name: 'QA Testing' }))

  log('Columns', 'Reorder columns')
  const reorderColumns = new ReorderColumnsTool(sdk)
  logResult('reordered', await reorderColumns.invoke({
    columnIds: ['backlog', 'todo', 'in-progress', 'testing', 'review', 'done'],
  }))

  log('Columns', 'Remove column')
  const removeColumn = new RemoveColumnTool(sdk)
  logResult('removed', await removeColumn.invoke({ columnId: 'testing' }))

  // ===================== LABELS =====================
  log('Labels', 'Set labels')
  const setLabel = new SetLabelTool(sdk)
  logResult('set bug', await setLabel.invoke({ name: 'bug', color: '#ef4444', group: 'type' }))
  logResult('set feature', await setLabel.invoke({ name: 'feature', color: '#22c55e', group: 'type' }))
  logResult('set urgent', await setLabel.invoke({ name: 'urgent', color: '#f97316', group: 'priority' }))

  log('Labels', 'Get all labels')
  const getLabels = new GetLabelsTool(sdk)
  logResult('labels', await getLabels.invoke({}))

  log('Labels', 'Rename label')
  const renameLabel = new RenameLabelTool(sdk)
  logResult('renamed', await renameLabel.invoke({ oldName: 'urgent', newName: 'critical-priority' }))

  log('Labels', 'Delete label')
  const deleteLabel = new DeleteLabelTool(sdk)
  logResult('deleted', await deleteLabel.invoke({ name: 'critical-priority' }))

  // ===================== CARDS =====================
  log('Cards', 'Create cards')
  const createCard = new CreateCardTool(sdk)
  const card1 = JSON.parse(await createCard.invoke({
    title: 'Fix authentication bug',
    content: 'Users report intermittent login failures on the /auth endpoint.',
    status: 'todo',
    priority: 'high',
    assignee: 'alice',
    labels: ['bug'],
  }))
  console.log(`    Created card: ${card1.id}`)

  const card2 = JSON.parse(await createCard.invoke({
    title: 'Add dark mode support',
    content: 'Implement dark mode toggle in the settings page.',
    status: 'backlog',
    priority: 'medium',
    assignee: 'bob',
    labels: ['feature'],
  }))
  console.log(`    Created card: ${card2.id}`)

  log('Cards', 'List all cards')
  const listCards = new ListCardsTool(sdk)
  logResult('cards', await listCards.invoke({}))

  log('Cards', 'Get card details')
  const getCard = new GetCardTool(sdk)
  logResult('card', await getCard.invoke({ cardId: card1.id }))

  log('Cards', 'Filter cards by status')
  const getByStatus = new GetCardsByStatusTool(sdk)
  logResult('todo cards', await getByStatus.invoke({ status: 'todo' }))

  log('Cards', 'Update card')
  const updateCard = new UpdateCardTool(sdk)
  logResult('updated', await updateCard.invoke({ cardId: card1.id, priority: 'critical' }))

  log('Cards', 'Move card')
  const moveCard = new MoveCardTool(sdk)
  logResult('moved', await moveCard.invoke({ cardId: card1.id, newStatus: 'in-progress' }))

  log('Cards', 'Get unique assignees')
  const getAssignees = new GetUniqueAssigneesTool(sdk)
  logResult('assignees', await getAssignees.invoke({}))

  log('Cards', 'Get unique labels')
  const getUniqueLabels = new GetUniqueLabelsTool(sdk)
  logResult('labels', await getUniqueLabels.invoke({}))

  log('Cards', 'Filter by label group')
  const filterByGroup = new FilterCardsByLabelGroupTool(sdk)
  logResult('type-group', await filterByGroup.invoke({ group: 'type' }))

  // ===================== COMMENTS =====================
  log('Comments', 'Add comment')
  const addComment = new AddCommentTool(sdk)
  logResult('comment', await addComment.invoke({
    cardId: card1.id, author: 'agent', content: 'Investigating root cause.',
  }))

  log('Comments', 'List comments')
  const listComments = new ListCommentsTool(sdk)
  logResult('comments', await listComments.invoke({ cardId: card1.id }))

  log('Comments', 'Update comment')
  const updateComment = new UpdateCommentTool(sdk)
  logResult('updated', await updateComment.invoke({
    cardId: card1.id, commentId: 'c1', content: 'Root cause identified: token expiration race condition.',
  }))

  log('Comments', 'Stream comment (tool)')
  const streamComment = new StreamCommentTool(sdk)
  logResult('streamed', await streamComment.invoke({
    cardId: card1.id, author: 'ai-agent', content: 'This comment was streamed via the StreamCommentTool.',
  }))

  log('Comments', 'Stream comment (direct)')
  async function* generateChunks(): AsyncIterable<string> {
    yield 'Analyzing '
    yield 'the '
    yield 'authentication flow... '
    yield 'Found a race condition in token refresh.'
  }
  const chunks: string[] = []
  await streamCommentDirect(sdk, {
    cardId: card1.id,
    author: 'ai-streamer',
    stream: generateChunks(),
    onStart: (commentId, author, created) => {
      console.log(`    Stream started: commentId=${commentId}, author=${author}, created=${created}`)
    },
    onChunk: (_commentId, chunk) => {
      chunks.push(chunk)
    },
  })
  console.log(`    Chunks received: ${chunks.length} (${chunks.join('')})`)

  log('Comments', 'Delete comment')
  const deleteComment = new DeleteCommentTool(sdk)
  logResult('deleted', await deleteComment.invoke({ cardId: card1.id, commentId: 'c1' }))

  // ===================== LOGS =====================
  log('Logs', 'Add card log')
  const addLog = new AddLogTool(sdk)
  logResult('log', await addLog.invoke({
    cardId: card1.id, text: 'Deployed hotfix to staging', source: 'ci',
    object: { commit: 'abc123', env: 'staging' },
  }))

  log('Logs', 'List card logs')
  const listLogs = new ListLogsTool(sdk)
  logResult('logs', await listLogs.invoke({ cardId: card1.id }))

  log('Logs', 'Add board log')
  const addBoardLog = new AddBoardLogTool(sdk)
  logResult('board-log', await addBoardLog.invoke({
    text: 'Sprint planning completed', source: 'system',
  }))

  log('Logs', 'List board logs')
  const listBoardLogs = new ListBoardLogsTool(sdk)
  logResult('board-logs', await listBoardLogs.invoke({}))

  log('Logs', 'Clear card logs')
  const clearLogs = new ClearLogsTool(sdk)
  logResult('cleared', await clearLogs.invoke({ cardId: card1.id }))

  // ===================== ATTACHMENTS =====================
  log('Attachments', 'Add attachment')
  const tmpFile = path.join(os.tmpdir(), 'kl-demo-attachment.txt')
  fs.writeFileSync(tmpFile, 'Demo attachment content')
  const addAttachment = new AddAttachmentTool(sdk)
  logResult('attached', await addAttachment.invoke({ cardId: card1.id, sourcePath: tmpFile }))

  log('Attachments', 'List attachments')
  const listAttachments = new ListAttachmentsTool(sdk)
  logResult('attachments', await listAttachments.invoke({ cardId: card1.id }))

  log('Attachments', 'Remove attachment')
  const removeAttachment = new RemoveAttachmentTool(sdk)
  logResult('removed', await removeAttachment.invoke({
    cardId: card1.id, attachment: 'kl-demo-attachment.txt',
  }))

  // ===================== LANGGRAPH =====================
  log('LangGraph', 'Refresh board node')
  const refreshNode = createRefreshBoardNode(sdk)
  const snapshot = await refreshNode({})
  console.log(`    Board snapshot: ${snapshot.board.cards.length} cards, ${snapshot.board.columns.length} columns`)

  log('LangGraph', 'Tool node (process tool calls)')
  const toolNode = createKanbanToolNode(sdk)
  const toolResult = await toolNode({
    messages: [{
      tool_calls: [{ id: 'tc_1', name: 'kanban_list_boards', args: {} }],
    }],
  })
  console.log(`    Tool results: ${toolResult.messages.length} message(s)`)

  // ===================== CLEANUP =====================
  log('Cards', 'Delete card')
  const deleteCard = new DeleteCardTool(sdk)
  logResult('deleted', await deleteCard.invoke({ cardId: card1.id }))

  // Clean up temp files
  fs.unlinkSync(tmpFile)
  fs.rmSync(path.dirname(kanbanDir), { recursive: true, force: true })

  console.log('\n🎉 All adapter features demonstrated successfully!\n')
}

main().catch(err => {
  console.error('Demo failed:', err)
  process.exit(1)
})

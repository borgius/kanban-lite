/**
 * LangGraph demo — shows how to build a kanban-aware agent graph.
 *
 * Uses the board state annotation and pre-built graph nodes from
 * kl-langchain-tools to compose a stateful workflow.
 *
 * Run:
 *   npx tsx src/langgraph-demo.ts
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
// Use source path (kanban-lite may not be built)
import { KanbanSDK } from '../../packages/kanban-lite/src/sdk/index'
import {
  createKanbanToolkit,
  createRefreshBoardNode,
  createKanbanToolNode,
  type BoardSnapshot,
} from 'kl-langchain-tools'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-langgraph-demo-'))
  const kanbanDir = path.join(dir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.kanban.json'),
    JSON.stringify({
      $schema: 'kanban-lite',
      defaultBoard: 'default',
      boards: {
        default: {
          name: 'Sprint Board',
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
  return kanbanDir
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const kanbanDir = createTempWorkspace()
  console.log(`\n🗂  Workspace: ${kanbanDir}`)

  const sdk = new KanbanSDK(kanbanDir)
  await sdk.init()

  // Seed some cards
  await sdk.createCard({ content: '# Implement user auth\n\nOAuth2 + JWT', status: 'todo' as any, priority: 'high' as any, assignee: 'alice', labels: ['backend'], dueDate: null })
  await sdk.createCard({ content: '# Design landing page\n\nNew marketing site', status: 'in-progress' as any, priority: 'medium' as any, assignee: 'bob', labels: ['design'], dueDate: null })
  await sdk.createCard({ content: '# Write API docs\n\nOpenAPI spec', status: 'backlog' as any, priority: 'low' as any, assignee: null, labels: ['docs'], dueDate: null })

  console.log('✅ Seeded 3 cards\n')

  // Get the full toolkit
  const tools = createKanbanToolkit(sdk)
  console.log(`✅ Loaded ${tools.length} tools`)

  // === Step 1: Refresh board state ===
  console.log('\n--- Step 1: Refresh board state ---')
  const refreshNode = createRefreshBoardNode(sdk)
  const state = await refreshNode({})
  const board = state.board as BoardSnapshot

  console.log(`Board: ${board.boardId}`)
  console.log(`Columns: ${board.columns.map(c => c.name).join(' → ')}`)
  console.log(`Cards:`)
  for (const card of board.cards) {
    console.log(`  [${card.status}] ${card.title} (${card.priority}) → ${card.assignee ?? 'unassigned'}`)
  }

  // === Step 2: Process tool calls ===
  console.log('\n--- Step 2: Process tool calls via ToolNode ---')
  const toolNode = createKanbanToolNode(sdk)

  // Simulate an LLM that wants to list cards in the todo column
  const listResult = await toolNode({
    messages: [{
      tool_calls: [{
        id: 'tc_list', name: 'kanban_get_cards_by_status',
        args: { status: 'todo' },
      }],
    }],
  })
  const todoCards = JSON.parse((listResult.messages[0] as any).content)
  console.log(`Todo cards: ${todoCards.length}`)
  for (const c of todoCards) {
    console.log(`  - ${c.title} (${c.priority})`)
  }

  // Simulate moving the todo card to in-progress
  if (todoCards.length > 0) {
    const moveResult = await toolNode({
      messages: [{
        tool_calls: [{
          id: 'tc_move', name: 'kanban_move_card',
          args: { cardId: todoCards[0].id, newStatus: 'in-progress' },
        }],
      }],
    })
    console.log(`\nMoved card: ${JSON.parse((moveResult.messages[0] as any).content).status}`)
  }

  // === Step 3: Add a comment via tool call ===
  console.log('\n--- Step 3: Add comment via tool call ---')
  const commentResult = await toolNode({
    messages: [{
      tool_calls: [{
        id: 'tc_comment', name: 'kanban_add_comment',
        args: { cardId: todoCards[0].id, author: 'langgraph-agent', content: 'Started working on this task.' },
      }],
    }],
  })
  console.log(`Comment added: ${JSON.parse((commentResult.messages[0] as any).content).content}`)

  // === Step 4: Final board state ===
  console.log('\n--- Step 4: Final board state ---')
  const finalState = await refreshNode({})
  const finalBoard = finalState.board as BoardSnapshot
  for (const card of finalBoard.cards) {
    console.log(`  [${card.status}] ${card.title} — comments: ${card.commentCount}`)
  }

  // Cleanup
  fs.rmSync(path.dirname(kanbanDir), { recursive: true, force: true })
  console.log('\n🎉 LangGraph demo completed successfully!\n')
}

main().catch(err => {
  console.error('Demo failed:', err)
  process.exit(1)
})

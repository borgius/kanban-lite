/**
 * LangGraph integration helpers for kanban-lite.
 *
 * Provides a board-state annotation and pre-built graph nodes so that
 * LangGraph agents can read and mutate kanban state inside a `StateGraph`.
 *
 * @example
 * ```ts
 * import { StateGraph } from '@langchain/langgraph'
 * import { KanbanSDK } from 'kanban-lite/sdk'
 * import { KanbanBoardState, createRefreshBoardNode, createKanbanToolNode } from 'kl-langchain-tools'
 *
 * const sdk = new KanbanSDK('/path/to/.kanban')
 * await sdk.init()
 *
 * const graph = new StateGraph(KanbanBoardState)
 *   .addNode('refresh', createRefreshBoardNode(sdk))
 *   .addNode('tools', createKanbanToolNode(sdk))
 *   .addEdge('__start__', 'refresh')
 *   .addEdge('refresh', 'tools')
 *   .addEdge('tools', '__end__')
 *   .compile()
 * ```
 *
 * @module
 */

import type { KanbanSDK } from './tools/types'
import { createKanbanToolkit } from './toolkit'

// ---------------------------------------------------------------------------
// LangGraph Annotation (lazy – only resolves when @langchain/langgraph is
// installed, which is an optional peer dependency).
// ---------------------------------------------------------------------------

/**
 * Tries to load `Annotation` from `@langchain/langgraph`.
 * Returns `undefined` when the optional peer is missing.
 */
function tryLoadAnnotation(): any | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@langchain/langgraph').Annotation
  } catch {
    return undefined
  }
}

/** Card summary stored inside graph state. */
export interface CardSummary {
  id: string
  title: string
  status: string
  priority: string
  assignee: string | null
  labels: string[]
  dueDate: string | null
  commentCount: number
}

/** Column definition stored inside graph state. */
export interface ColumnSummary {
  id: string
  name: string
  color?: string
}

/** Board snapshot carried through a LangGraph state. */
export interface BoardSnapshot {
  boardId: string
  columns: ColumnSummary[]
  cards: CardSummary[]
  labels: Record<string, unknown>
  lastRefreshed: string
}

let _KanbanBoardState: ReturnType<typeof createKanbanBoardState> | undefined

function createKanbanBoardState() {
  const Annotation = tryLoadAnnotation()
  if (!Annotation) {
    throw new Error(
      'kl-langchain-tools: @langchain/langgraph is required for KanbanBoardState. ' +
      'Install it with: npm install @langchain/langgraph',
    )
  }

  // Annotation is dynamically loaded; call without TS type parameters.
  const boardChannel = (Annotation as any)({
    reducer: (_prev: BoardSnapshot | null, next: BoardSnapshot | null) => next,
    default: () => null as BoardSnapshot | null,
  })

  const messagesChannel = (Annotation as any)({
    reducer: (prev: unknown[], next: unknown[]) => [...prev, ...next],
    default: () => [] as unknown[],
  })

  return Annotation.Root({
    board: boardChannel,
    messages: messagesChannel,
  })
}

/**
 * LangGraph state annotation for kanban board workflows.
 *
 * Includes a `board` snapshot (cards, columns, labels) and a `messages`
 * accumulator for conversational agent patterns.
 *
 * @throws If `@langchain/langgraph` is not installed.
 */
export function getKanbanBoardState() {
  if (!_KanbanBoardState) _KanbanBoardState = createKanbanBoardState()
  return _KanbanBoardState
}

// ---------------------------------------------------------------------------
// Pre-built graph nodes
// ---------------------------------------------------------------------------

/**
 * Creates a LangGraph node that refreshes the board snapshot in state.
 *
 * @example
 * ```ts
 * graph.addNode('refresh', createRefreshBoardNode(sdk))
 * ```
 */
export function createRefreshBoardNode(sdk: KanbanSDK, boardId?: string) {
  return async (_state: Record<string, unknown>) => {
    const cards = await sdk.listCards(undefined, boardId)
    const columns = sdk.listColumns(boardId)
    const labels = sdk.getLabels()

    const snapshot: BoardSnapshot = {
      boardId: boardId ?? 'default',
      columns: columns.map((c: any) => ({ id: c.id, name: c.name, color: c.color })),
      cards: cards.map((c: any) => ({
        id: c.id,
        title: c.content?.split('\n')[0]?.replace(/^#\s*/, '') ?? '',
        status: c.status,
        priority: c.priority,
        assignee: c.assignee,
        labels: c.labels,
        dueDate: c.dueDate,
        commentCount: c.comments?.length ?? 0,
      })),
      labels,
      lastRefreshed: new Date().toISOString(),
    }

    return { board: snapshot }
  }
}

/**
 * Creates a LangGraph `ToolNode`-compatible function that invokes
 * the full kanban-lite toolkit.
 *
 * Callers should pass this to `new ToolNode(createKanbanToolkit(sdk))` or
 * use it as a standalone node that processes tool calls from messages.
 */
export function createKanbanToolNode(sdk: KanbanSDK) {
  const tools = createKanbanToolkit(sdk)

  return async (state: { messages: any[] }) => {
    const lastMsg = state.messages[state.messages.length - 1]
    if (!lastMsg?.tool_calls?.length) return { messages: [] }

    const results: unknown[] = []
    for (const call of lastMsg.tool_calls) {
      const tool = tools.find(t => t.name === call.name)
      if (!tool) {
        results.push({ role: 'tool', content: `Tool not found: ${call.name}`, tool_call_id: call.id })
        continue
      }
      const output = await tool.invoke(call.args)
      results.push({ role: 'tool', content: output, tool_call_id: call.id })
    }
    return { messages: results }
  }
}

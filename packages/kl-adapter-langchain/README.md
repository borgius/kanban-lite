# kl-adapter-langchain

A [kanban-lite](https://github.com/borgius/kanban-lite) adapter package for **LangChain** and **LangGraph**. Exposes all kanban-lite features as LangChain `StructuredTool` instances — including streaming comments, labels, actions, logs, attachments, and more.

## Install

```sh
npm install kl-adapter-langchain @langchain/core
# optional – for LangGraph state/nodes:
npm install @langchain/langgraph
```

## Provider id

`langchain` (adapter, not a storage plugin)

## Capabilities

| Feature | Tools |
|---|---|
| **Cards** | `kanban_list_cards`, `kanban_get_card`, `kanban_create_card`, `kanban_update_card`, `kanban_move_card`, `kanban_delete_card`, `kanban_get_cards_by_status`, `kanban_trigger_action` |
| **Comments** | `kanban_list_comments`, `kanban_add_comment`, `kanban_update_comment`, `kanban_delete_comment`, `kanban_stream_comment` |
| **Columns** | `kanban_list_columns`, `kanban_add_column`, `kanban_update_column`, `kanban_remove_column`, `kanban_reorder_columns` |
| **Labels** | `kanban_get_labels`, `kanban_set_label`, `kanban_delete_label`, `kanban_rename_label`, `kanban_get_unique_assignees`, `kanban_get_unique_labels`, `kanban_filter_cards_by_label_group` |
| **Boards** | `kanban_list_boards`, `kanban_get_board`, `kanban_create_board`, `kanban_delete_board`, `kanban_update_board`, `kanban_get_board_actions` |
| **Logs** | `kanban_list_logs`, `kanban_add_log`, `kanban_clear_logs`, `kanban_list_board_logs`, `kanban_add_board_log` |
| **Attachments** | `kanban_list_attachments`, `kanban_add_attachment`, `kanban_remove_attachment` |

**39 tools** covering the full kanban-lite API surface.

## Quick Start – LangChain Agent

```ts
import { KanbanSDK } from 'kanban-lite/sdk'
import { createKanbanToolkit } from 'kl-adapter-langchain'
import { ChatOpenAI } from '@langchain/openai'
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents'
import { ChatPromptTemplate } from '@langchain/core/prompts'

const sdk = new KanbanSDK('/path/to/project/.kanban')
await sdk.init()

// Get all 39 kanban tools
const tools = createKanbanToolkit(sdk)

const llm = new ChatOpenAI({ model: 'gpt-4o' })
const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a project management assistant with access to a kanban board.'],
  ['human', '{input}'],
  ['placeholder', '{agent_scratchpad}'],
])

const agent = await createOpenAIToolsAgent({ llm, tools, prompt })
const executor = new AgentExecutor({ agent, tools })

const result = await executor.invoke({
  input: 'Create a high-priority bug card titled "Fix login timeout" and assign it to alice',
})
```

## Selective Tool Loading

You can load only the tool categories you need:

```ts
const tools = createKanbanToolkit(sdk, {
  cards: true,
  comments: true,
  columns: false,    // skip column tools
  labels: false,     // skip label tools
  boards: false,     // skip board tools
  logs: true,
  attachments: false, // skip attachment tools
})
```

## Streaming Comments

The `kanban_stream_comment` tool accepts a full comment text and persists it via the SDK streaming path. For true chunk-by-chunk streaming (e.g. from an LLM textStream), use the `streamCommentDirect` helper:

```ts
import { streamCommentDirect } from 'kl-adapter-langchain'
import { streamText } from 'ai'

const { textStream } = await streamText({ model, prompt: 'Summarize the PR' })

await streamCommentDirect(sdk, {
  cardId: '42',
  author: 'ai-agent',
  stream: textStream,
  onStart: (commentId, author, created) => {
    broadcast({ type: 'commentStreamStart', commentId, author, created })
  },
  onChunk: (commentId, chunk) => {
    broadcast({ type: 'commentChunk', commentId, chunk })
  },
})
```

## LangGraph Integration

The package provides optional LangGraph helpers when `@langchain/langgraph` is installed:

```ts
import { StateGraph } from '@langchain/langgraph'
import { KanbanSDK } from 'kanban-lite/sdk'
import {
  getKanbanBoardState,
  createRefreshBoardNode,
  createKanbanToolNode,
  createKanbanToolkit,
} from 'kl-adapter-langchain'

const sdk = new KanbanSDK('/path/to/.kanban')
await sdk.init()

// State annotation with board snapshot + messages
const KanbanBoardState = getKanbanBoardState()

const graph = new StateGraph(KanbanBoardState)
  .addNode('refresh', createRefreshBoardNode(sdk))
  .addNode('tools', createKanbanToolNode(sdk))
  .addEdge('__start__', 'refresh')
  .addEdge('refresh', 'tools')
  .addEdge('tools', '__end__')
  .compile()
```

### Board State

The `getKanbanBoardState()` annotation includes:

- **`board`** – A snapshot of the current board (cards, columns, labels, last refresh time)
- **`messages`** – Accumulator for conversational messages

### Graph Nodes

| Node factory | Description |
|---|---|
| `createRefreshBoardNode(sdk, boardId?)` | Reads the current board state and returns a `{ board }` update |
| `createKanbanToolNode(sdk)` | Processes `tool_calls` from the last message and returns tool results |

## Individual Tool Classes

All tool classes are exported individually for custom composition:

```ts
import { ListCardsTool, CreateCardTool, StreamCommentTool } from 'kl-adapter-langchain'

const listCards = new ListCardsTool(sdk)
const createCard = new CreateCardTool(sdk)
const streamComment = new StreamCommentTool(sdk)
```

## Build Output

CommonJS bundle (`dist/index.cjs`) + TypeScript declarations (`dist/index.d.ts`).

## Development

```sh
npm run build       # esbuild bundle + tsc declarations
npm run typecheck   # type-check only
npm run test        # vitest
npm run test:watch  # vitest watch
```

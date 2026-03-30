# langchain-tools-demo

Example app demonstrating **kl-adapter-langchain** — the LangChain / LangGraph adapter for [kanban-lite](https://github.com/borgius/kanban-lite).

## What This Example Shows

- **All 39 LangChain tools** exercised against a real kanban-lite workspace
- **Streaming comments** via both `StreamCommentTool` and `streamCommentDirect()`
- **LangGraph integration** with `createRefreshBoardNode()` and `createKanbanToolNode()`
- **Selective toolkit loading** via category filters
- **Full unit test coverage** with mock SDK (8 test files, every tool category)
- **Full integration test coverage** against a live file-backed workspace

## Quick Start

```bash
cd examples/langchain-tools-demo
npm install

# Run the agent demo (exercises all tools)
npm run demo

# Run the LangGraph demo (stateful workflow)
npm run demo:langgraph

# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

## Project Structure

```
src/
├── agent-demo.ts          # Full demo exercising every tool
├── langgraph-demo.ts      # LangGraph workflow demo
└── __tests__/
    ├── helpers.ts          # Shared mock SDK factory
    ├── unit/
    │   ├── cards.test.ts       # 8 card tools (18 tests)
    │   ├── comments.test.ts    # 5 comment tools + streaming (9 tests)
    │   ├── columns.test.ts     # 5 column tools (9 tests)
    │   ├── labels.test.ts      # 7 label tools (10 tests)
    │   ├── boards.test.ts      # 6 board tools (10 tests)
    │   ├── logs.test.ts        # 5 log tools (7 tests)
    │   ├── attachments.test.ts # 3 attachment tools (5 tests)
    │   └── toolkit.test.ts     # toolkit + LangGraph helpers (22 tests)
    └── integration/
        └── full-workflow.test.ts  # End-to-end with real SDK
```

## Tool Coverage

| Category | Tools | Unit Tests | Integration Tests |
|----------|-------|-----------|-------------------|
| Cards | 8 | ✅ | ✅ |
| Comments | 5 + `streamCommentDirect` | ✅ | ✅ |
| Columns | 5 | ✅ | ✅ |
| Labels | 7 | ✅ | ✅ |
| Boards | 6 | ✅ | ✅ |
| Logs | 5 | ✅ | ✅ |
| Attachments | 3 | ✅ | ✅ |
| Toolkit | `createKanbanToolkit` | ✅ | ✅ |
| LangGraph | `createRefreshBoardNode`, `createKanbanToolNode` | ✅ | ✅ |

## Demo Scripts

### `agent-demo.ts`

Exercises every adapter feature in sequence:
1. **Toolkit** — creates full (39 tools) and selective (cards-only) toolkits
2. **Boards** — list, get, create, update, get actions, delete
3. **Columns** — list, add, update, reorder, remove
4. **Labels** — set, get all, rename, delete
5. **Cards** — create, list, get, filter by status, update, move, unique assignees/labels, filter by group
6. **Comments** — add, list, update, stream (tool + direct with callbacks), delete
7. **Logs** — add card log, list, add board log, list board logs, clear
8. **Attachments** — add, list, remove
9. **LangGraph** — refresh board node, tool node with simulated tool calls
10. **Cleanup** — delete card, remove temp files

### `langgraph-demo.ts`

Shows a stateful LangGraph-style workflow:
1. Seeds a board with 3 cards
2. Refreshes board state via `createRefreshBoardNode`
3. Processes tool calls via `createKanbanToolNode` (list by status, move card, add comment)
4. Refreshes final state to show changes

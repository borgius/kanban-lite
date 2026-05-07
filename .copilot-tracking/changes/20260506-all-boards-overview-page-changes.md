# Changes: All Boards Overview Page

## Status

In progress.

## Files Changed

_(updated as implementation progresses)_

### New Files

- `packages/kanban-lite/src/sdk/modules/board-overview.ts` — SDK aggregation helper
- `packages/kanban-lite/src/webview/components/AllBoardsPage.tsx` — overview page UI
- `packages/kanban-lite/src/sdk/__tests__/board-overview.test.ts` — SDK unit tests
- `packages/kanban-lite/e2e/standalone.all-boards-overview.spec.ts` — E2E tests

### Modified Files

- `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts` — added `listBoardsOverview()`
- `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts` — added `GET /api/boards/overview`
- `packages/kanban-lite/src/standalone/internal/openapi-spec/paths-boards.ts` — added OpenAPI metadata
- `packages/kanban-lite/src/cli/commands/boards.ts` — added `overview` subcommand
- `packages/kanban-lite/src/mcp-server/tools/boards.ts` — added `list_boards_overview`
- `packages/kanban-lite/src/shared/types/messages.ts` — added `loadBoardsOverview` / `boardsOverview` messages
- `packages/kanban-lite/src/extension/KanbanPanel.ts` — handles `loadBoardsOverview`
- `packages/kanban-lite/src/webview/standalone-shim.ts` — intercepts `loadBoardsOverview` and fetches REST endpoint
- `packages/kanban-lite/src/webview/store/state.ts` — added overview state fields/actions
- `packages/kanban-lite/src/webview/store/store.ts` — implemented overview state
- `packages/kanban-lite/src/webview/router.tsx` — added `/workspace/boards` route
- `packages/kanban-lite/src/webview/App.tsx` — wired overview page, message handler, stage switching
- `packages/kanban-lite/src/webview/components/Toolbar.tsx` — added `onOpenAllBoards` prop and menu item
- `README.md` — documented All Boards overview page
- `CHANGELOG.md` — added feature entry

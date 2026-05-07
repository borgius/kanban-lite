<!-- markdownlint-disable-file -->

# Research: All Boards Overview Page

## Summary

Add an **All Boards** overview page to the webview/standalone app that shows one
card per board with:

- total active cards
- cards with notifications
- per-column card counts
- per-column notification counts

The page should be reachable from the existing toolbar board-options dropdown,
adjacent to the current **Settings** action. The current frontend only receives
cards for the active board, so this is **not** a UI-only change: it needs a new
SDK-backed aggregation seam and a thin transport path for the webview.

---

## 1. Research validation and tool findings

### 1.1 Existing planning state

- `file_search` found no task-specific research for an all-boards overview page.
- Existing planning artifacts in `.copilot-tracking/` cover other tasks only,
  including:
  - `20260501-sdk-remote-mode-*`
  - `20260502-board-import-export-settings-*`
- `file_search` for `**/task-researcher.agent.md` returned no results, so the
  dedicated research-agent file referenced by Task Planner mode is not present
  in this workspace.

### 1.2 Verified repo investigation

- The toolbar board-options dropdown already contains the **Settings** entry in
  `packages/kanban-lite/src/webview/components/Toolbar.tsx`.
- Routing is handled in `packages/kanban-lite/src/webview/router.tsx` with
  TanStack Router, and the file explicitly says the Zustand store is the source
  of truth for UI state.
- `packages/kanban-lite/src/webview/App.tsx` currently renders the active board,
  settings dialog, board logs drawer, and empty-boards state, but no all-boards
  overview page.
- The webview store tracks `currentBoard`, filters, settings, and selection, but
  it has no page/view state or board-summary cache for an overview route.
- The init payload already carries `boards`, but the card list is scoped to the
  active board in both the VS Code host and standalone runtime.

### 1.3 External source research gathered

- TanStack Router navigation guide:
  `https://tanstack.com/router/latest/docs/framework/react/guide/navigation`
- TanStack Router routing concepts:
  `https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts`
- TanStack Router outlets guide:
  `https://tanstack.com/router/latest/docs/framework/react/guide/outlets`

These sources confirm:

- route state should be represented as explicit route definitions rather than ad
  hoc component-only toggles
- nested layouts and `<Outlet />` are the intended way to render alternate pages
  under a shared shell
- user-visible navigation can be route-driven, while imperative navigation is
  still appropriate for side effects and existing callback-based UI seams

---

## 2. Current repo structure and implementation seams

### 2.1 Toolbar dropdown seam

The requested entry point already exists in the board-options menu.

- `packages/kanban-lite/src/webview/components/Toolbar.tsx:649-708`
  renders the **Board Menu — theme, settings, logs** dropdown.
- `packages/kanban-lite/src/webview/components/Toolbar.tsx:708`
  is the existing `onOpenSettings()` menu item callback.
- `packages/kanban-lite/src/webview/components/Toolbar.tsx:654`
  provides the stable board-options button label.
- `packages/kanban-lite/src/webview/components/Toolbar.test.tsx:112-126`
  already verifies stable markup/labels for board navigation entry points.

Implication:

- the user-requested link belongs in this existing board-options dropdown,
  likely as a new menu item near **Settings**
- the cleanest wiring pattern is another callback prop on `Toolbar`, not a
  special-case DOM query or direct host call from inside the menu component

### 2.2 Board switcher seam

There is already a board-search dropdown, but it is a selector, not a summary
page.

- `packages/kanban-lite/src/webview/components/BoardSwitcher.tsx:13-128`
  shows the searchable board list.
- `packages/kanban-lite/src/webview/components/BoardSwitcher.tsx:107-123`
  labels the unstarred section as **All boards**, but it is still just a list of
  board names.

Implication:

- the requested feature should be a separate overview page, not a retrofit of
  the board switcher dropdown

### 2.3 Router and URL-sync seam

The router currently models only board routes and settings routes.

- `packages/kanban-lite/src/webview/router.tsx:16`
  says: **The Zustand store is always the source of truth for UI state.**
- `packages/kanban-lite/src/webview/router.tsx:63-326`
  contains `URLSync()`, which currently bridges:
  - board route state
  - card route state
  - settings route state
- `packages/kanban-lite/src/webview/router.tsx:360`
  defines the root `/$boardId` board route.
- `packages/kanban-lite/src/webview/router.tsx:388-494`
  defines the settings route tree.

Implication:

- an all-boards page should be added as an explicit route plus store-backed UI
  state, not as a local boolean hidden inside `App.tsx`
- because the app already relies on store ↔ URL synchronization, the overview
  page should extend that same pattern

### 2.4 App rendering seam

`App.tsx` currently has no place where an overview page could appear without a
small shell change.

- `packages/kanban-lite/src/webview/App.tsx:111`
  defines the main app component.
- `packages/kanban-lite/src/webview/App.tsx:154-156`
  computes active-card export counts by excluding `DELETED_STATUS_ID`.
- `packages/kanban-lite/src/webview/App.tsx:179`
  stores board-log drawer visibility in local state.
- `packages/kanban-lite/src/webview/App.tsx:1107-1115`
  renders loading / empty-boards states.
- `packages/kanban-lite/src/webview/App.tsx:1126-1157`
  renders `<Toolbar />` and `<KanbanBoard />` for the normal board view.
- `packages/kanban-lite/src/webview/App.tsx:1160-1405`
  conditionally renders the board-logs drawer and card editor.
- `packages/kanban-lite/src/webview/App.tsx:1406-1479`
  renders `EmptyBoardsScreen` when there are no boards.

Implication:

- the all-boards page is best introduced as a sibling to `KanbanBoard`, inside
  the existing board-stage shell, with logs/editor/settings behavior left alone

### 2.5 Store seam

The store contains board/filter/editor state, but no overview-state support.

- `packages/kanban-lite/src/webview/store/store.ts:20-59`
  initializes cards, columns, boards, `currentBoard`, settings, and filters.
- `packages/kanban-lite/src/webview/store/store.ts:157-164`
  defines `setCurrentBoard(...)`.
- `packages/kanban-lite/src/webview/store/store.ts:329-331`
  merges card-state payloads into board cards.
- `packages/kanban-lite/src/webview/store/store.ts:341-401`
  filters current-board cards by status and unread label state.
- `packages/kanban-lite/src/webview/store/state.ts:7-95`
  defines the `KanbanState` contract exposed to the UI.

Implication:

- the overview page needs additional state, such as:
  - current page/view mode or overview-open state
  - fetched board-summary data
  - optional loading/error status for that summary request

### 2.6 Current data availability: boards are global, cards are board-scoped

This is the key architectural constraint.

- `packages/kanban-lite/src/shared/types/messages.ts:132`
  defines the `init` message with `boards?: BoardInfo[]` and `cards: Card[]`.
- `packages/kanban-lite/src/extension/KanbanPanel.ts:1120`
  loads cards with `sdk.listCards(columns, this._currentBoardId)`.
- `packages/kanban-lite/src/extension/KanbanPanel.ts:1889-1914`
  posts the `init` payload using `this._cards` for the current board.
- `packages/kanban-lite/src/standalone/broadcastService.ts:197-218`
  builds the standalone `init` payload from `ctx.currentBoardId` and decorated
  current-board cards.

Implication:

- the webview cannot compute all-board stats from existing client state alone
- a new board-summary data flow is needed for both VS Code host and standalone

### 2.7 Board metadata/type seam

The repo already has a good shape for board summary cards.

- `packages/kanban-lite/src/shared/types/card.ts:207-220`
  defines `BoardInfo` with:
  - `id`
  - `name`
  - `description`
  - `columns`
  - `actions`
  - `metadata`
  - `title`
  - `titleTemplate`
  - `forms`
- `packages/kanban-lite/src/sdk/modules/boards.ts:22-32`
  builds `BoardInfo[]` from the workspace config.
- `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts:33-34`
  exposes `listBoards()` on the public SDK.

Implication:

- board cards can be driven from existing `BoardInfo` plus new aggregate counts
  without redefining board identity/config basics

### 2.8 Existing parity seams

Board capabilities already exist across SDK, REST, CLI, and MCP.

- SDK:
  - `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts:33-86`
  - `packages/kanban-lite/src/sdk/modules/boards.ts:22-197`
- REST/OpenAPI:
  - `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts:61-232`
  - `packages/kanban-lite/src/standalone/internal/openapi-spec/paths-boards.ts:17-210`
- CLI:
  - `packages/kanban-lite/src/cli/commands/boards.ts:25-156`
- MCP:
  - `packages/kanban-lite/src/mcp-server/tools/boards.ts:19-243`

Implication:

- if board-summary aggregation is introduced in the SDK, repo guidance strongly
  suggests exposing it in REST, CLI, and MCP as well

### 2.9 Notification/unread seam

The requested “notifications” count maps cleanly to existing unread state.

- `packages/kanban-lite/src/webview/components/Toolbar.tsx:123`
  already treats unread as a virtual label.
- `packages/kanban-lite/src/webview/store/store.ts:381`
  filters cards via `f.cardState?.unread?.unread`.
- `packages/kanban-lite/src/extension/cardStateUi.ts:67-114`
  decorates card payloads with `cardState` using batched SDK reads.
- `packages/kanban-lite/src/sdk/KanbanSDK-card-state.ts:141-187`
  groups cards by board and uses `batchGetCardStates` when available.

Important semantics:

- unread/notification state is **actor-scoped**, not a workspace-global badge
- unread state may be **unavailable** depending on identity/provider setup
- the overview page should therefore distinguish **0 notifications** from
  **notification counts unavailable** when possible

### 2.10 Existing column-scope conventions

The current board-facing UI excludes the deleted column in summary-style areas.

- `packages/kanban-lite/src/webview/App.tsx:154-156`
  excludes deleted cards when computing export counts.
- `packages/kanban-lite/src/webview/components/Toolbar.tsx:171-172`
  excludes `DELETED_STATUS_ID` from the board menu’s column list.

Implication:

- a safe v1 interpretation is to count **active** cards/columns only and leave
  deleted-card reporting for a separate follow-up

### 2.11 Testing anchors already in the repo

- `packages/kanban-lite/src/webview/components/Toolbar.test.tsx:107-145`
  covers board-menu markup and stable labels.
- `packages/kanban-lite/src/webview/store/index.test.ts`
  already exercises store behavior and is the natural place for new overview
  selectors/state tests.
- `packages/kanban-lite/src/webview/App.test.tsx`
  is the existing app-shell test anchor.
- `packages/kanban-lite/e2e/standalone.board-settings.spec.ts:32-106`
  already drives route-aware settings flows.
- `packages/kanban-lite/e2e/standalone.plugin-options.spec.ts:21-24`
  already opens the board-options menu and clicks **Settings**.

---

## 3. What the feature means in this repo

### 3.1 Requested UX, translated into repo terms

The user request maps to:

1. a new route-backed page inside the existing webview shell
2. one card per board
3. each board card showing:
   - board name
   - optional description
   - total active cards
   - active cards with unread/notification state
   - each visible board column with:
     - card count
     - unread/notification count
4. a new menu item in the board-options dropdown near **Settings**
5. clicking a board card should navigate to that board’s normal board view

### 3.2 Evidence-based scope recommendation

Keep v1 focused on a **read-only overview page**.

Recommended v1 behavior:

- show summary cards only
- make board cards clickable to open the target board
- do not add inline board editing from the overview page
- do not turn the overview into a second board-management settings surface

Why this scope fits the repo:

- `Toolbar.tsx` already has a navigation/action dropdown, so adding one more
  entry is cheap
- `App.tsx` already supports alternate major surfaces (board view, settings,
  board logs), so another page is structurally consistent
- summary aggregation belongs in the SDK, not in a giant TSX file

### 3.3 Notification semantics recommendation

Use the existing unread model as the meaning of “notifications”.

Recommended labels in implementation/docs:

- transport and SDK naming: `unread`, because that is the actual data model
- UI copy: `Notifications` or `With notifications`, if product wording wants it

Recommended count rules:

- `totalCards` = active non-deleted cards on that board
- `notificationCards` = active cards where `cardState.unread.unread === true`
- per-column `notificationCount` = same unread predicate within the column

If unread state is unavailable:

- surface a status in the summary payload
- avoid silently presenting `0` as if there are definitely no notifications

### 3.4 Deleted-column recommendation

Exclude deleted cards/columns from the overview counts in v1.

Why:

- current UI summary-style surfaces already exclude deleted content
- user request talks about columns and overall view, which usually implies the
  live workflow board rather than the hidden trash lane

---

## 4. Recommended implementation approach

### 4.1 SDK-first board overview helper

Add a focused helper module, for example:

- `packages/kanban-lite/src/sdk/modules/board-overview.ts`

Recommended public SDK wrapper:

- `listBoardsOverview()`

Recommended output shape:

```ts
type BoardOverviewSummary = {
  board: BoardInfo
  totalCards: number
  notificationCards: number | null
  cardStateStatus: {
    backend: string
    availability: string
    configured: boolean
    errorCode?: string
  }
  columns: Array<{
    id: string
    name: string
    color: string
    cardCount: number
    notificationCount: number | null
  }>
}
```

Recommended SDK algorithm:

1. call `sdk.listBoards()`
2. for each board:
   - resolve visible columns from `board.columns ?? sdk.listColumns(board.id)`
   - call `sdk.listCards(columnIds, board.id)`
   - filter out `DELETED_STATUS_ID`
   - call `sdk.getCardStateReadModelForCards(cards, board.id)` once for that
     board
   - compute total and per-column counts
3. return a stable array ordered the same way as `listBoards()`

Why this is the best fit:

- it reuses existing board/card APIs
- it leverages the SDK’s existing card-state batching by board
- it keeps unread semantics consistent with the rest of the app

### 4.2 REST, CLI, and MCP parity

Because board-summary logic is reusable and user-facing, expose it outside the
webview too.

Recommended additions:

- REST:
  - `GET /api/boards/overview`
- CLI:
  - `kl boards overview [--json]`
- MCP:
  - `list_boards_overview`

That follows the same repo pattern already used for board import/export.

### 4.3 Webview transport recommendation

Do **not** bloat the normal `init` payload with full overview data.

Recommended transport:

- add a lazy request message such as:

```ts
type WebviewMessage =
  | { type: 'loadBoardsOverview' }
```

- add a matching extension message such as:

```ts
type ExtensionMessage =
  | { type: 'boardsOverview'; summaries: BoardOverviewSummary[] }
  | { type: 'boardsOverview'; summaries: []; error: string }
```

Why lazy load is preferable here:

- current init is optimized around the active board only
- the overview page is optional, not always visible
- it avoids extra work on every initial board load when the user never opens the
  overview page

### 4.4 Store and router changes

Add store-backed view state so URLSync can own the route bridge.

Recommended store additions:

- `workspaceView: 'board' | 'allBoards'`
- `boardsOverview: BoardOverviewSummary[]`
- `boardsOverviewStatus: 'idle' | 'loading' | 'ready' | 'error'`
- `boardsOverviewError: string | null`

Recommended route addition:

- a dedicated overview route, ideally not overloading `/$boardId`

Suggested safe path:

- `/workspace/boards`

Reasoning:

- current board routes already occupy a root dynamic segment (`/$boardId`)
- a two-segment static route avoids mixing the overview page with board-id
  resolution logic

### 4.5 UI component structure

Recommended new components:

- `packages/kanban-lite/src/webview/components/AllBoardsPage.tsx`
- optionally `packages/kanban-lite/src/webview/components/BoardOverviewCard.tsx`

Recommended UI layout:

- responsive grid of board cards
- each card contains:
  - board title / description
  - total cards badge
  - notifications badge
  - compact column list with counts
  - an explicit CTA such as **Open board**

Recommended toolbar change:

- add `onOpenAllBoards` prop to `Toolbar`
- render an **All Boards** menu item beside/near **Settings** in the board menu

### 4.6 Refresh strategy recommendation

Keep the overview data request demand-driven.

Recommended behavior:

- when the overview route opens, request summaries
- while the overview route is active, request summaries again after:
  - board switches
  - board create/delete
  - current-board card mutations that already trigger `cardsUpdated` / `init`

This avoids a large always-on push channel while still keeping the page fresh.

---

## 5. Testing guidance from existing patterns

### 5.1 Unit and integration tests to add

1. **SDK tests**
   - summary includes one entry per board
   - totals exclude deleted cards
   - unread counts use card-state read models
   - unavailable card-state produces `null` notification counts plus status

2. **Toolbar test**
   - board menu includes an **All Boards** item near **Settings**

3. **Store/router/app tests**
   - overview route updates store view state correctly
   - opening a board from the overview returns to the board route
   - overview loading/error/result states render correctly

4. **Host/runtime tests**
   - extension handles `loadBoardsOverview`
   - standalone REST route returns the same summary payload shape

5. **CLI/MCP tests**
   - `boards overview` / `list_boards_overview` serialize the SDK result

### 5.2 E2E recommendation

Extend standalone browser coverage with either:

- a new `standalone.all-boards-overview.spec.ts`, or
- an extension of `standalone.board-settings.spec.ts` plus a focused overview
  scenario file

Suggested E2E assertions:

- open board-options menu
- click **All Boards**
- verify route changes to the overview page
- verify multiple board cards and per-column counts render
- click one board card
- verify navigation returns to the selected board view

---

## 6. External implementation references

### 6.1 TanStack Router navigation

The navigation guide confirms:

- route navigation is expressed with `to`, `params`, and `search`
- `useNavigate()` is appropriate for side-effect-driven navigation
- user-facing navigation can be route-driven rather than manual DOM state

Reference:

- `https://tanstack.com/router/latest/docs/framework/react/guide/navigation`

### 6.2 TanStack Router route structure

The routing concepts and outlet docs confirm:

- root routes always render
- nested child routes render through `<Outlet />`
- explicit route definitions are the intended mechanism for alternate app pages

References:

- `https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts`
- `https://tanstack.com/router/latest/docs/framework/react/guide/outlets`

---

## 7. Implementation guidance

- Keep aggregation logic in the SDK first.
- Keep UI files focused; avoid growing `App.tsx` or `Toolbar.tsx` with heavy
  summary math.
- Treat notification counts as actor-scoped unread counts.
- Prefer `null` + status over fake zeroes when unread state is unavailable.
- Exclude deleted cards/columns in v1 to match current UI conventions.
- Update `README.md` and `CHANGELOG.md` because this is user-facing.
- If REST/OpenAPI or SDK JSDoc changes, regenerate docs from source instead of
  editing generated docs directly.

---

## 8. Recommended task breakdown

1. Add SDK board-overview summary types and helper.
2. Add REST/CLI/MCP parity for the summary capability.
3. Add shared transport messages for lazy overview loading.
4. Extend store + router with an all-boards view state/route.
5. Add `AllBoardsPage` UI and toolbar menu entry.
6. Add SDK, UI, host/runtime, and E2E tests.
7. Update README / CHANGELOG and regenerate any source-driven docs if needed.

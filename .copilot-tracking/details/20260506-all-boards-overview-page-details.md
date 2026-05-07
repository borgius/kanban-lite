<!-- markdownlint-disable-file -->

# Task Details: All Boards Overview Page

## Research Reference

**Source Research**: #file:../research/20260506-all-boards-overview-page-research.md

---

## Phase 1: SDK board-summary capability

### Task 1.1: Add an SDK-first all-boards summary helper

Create a focused SDK helper that returns one summary object per board.

- **Files**:
  - `packages/kanban-lite/src/sdk/modules/board-overview.ts` - new aggregation helper for board/card/unread counts
  - `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts` - thin public wrapper, for example `listBoardsOverview()`
  - `packages/kanban-lite/src/sdk/KanbanSDK.d.ts` / JSDoc-bearing sources - public API documentation if needed for generated SDK docs
- **Implementation**:
  - Define a `BoardOverviewSummary` type that includes:
    - `board: BoardInfo`
    - `totalCards`
    - `notificationCards`
    - `columns[]` with `cardCount` and `notificationCount`
    - card-state availability/status metadata so the UI can distinguish `0` from unavailable
  - Aggregate board data by reusing the existing SDK seams:
    - `listBoards()`
    - `listCards(columnIds, boardId)`
    - `getCardStateReadModelForCards(cards, boardId)`
  - Exclude `DELETED_STATUS_ID` cards/columns in v1 to match current summary-style UI conventions.
  - Keep ordering stable and aligned with `listBoards()`.
- **Success**:
  - SDK returns one stable summary per board.
  - Totals exclude deleted cards.
  - Notification counts are actor-scoped unread counts, not guessed client badges.
  - Unavailable unread state is represented explicitly instead of silently treated as zero.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 178-190) - current client data is board-scoped, so the summary must be computed outside the existing webview state
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 242-275) - unread semantics and deleted-column conventions
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 364-414) - recommended summary shape and SDK algorithm
- **Dependencies**:
  - Existing board and card SDK surfaces remain the source of truth
  - `core-surface.instructions.md` applies because this is a new SDK capability

### Task 1.2: Expose the summary capability in REST, CLI, and MCP

Keep the new board-summary capability in parity across the repo’s supported user-facing surfaces.

- **Files**:
  - `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts` - add `GET /api/boards/overview`
  - `packages/kanban-lite/src/standalone/internal/openapi-spec/paths-boards.ts` - add source OpenAPI metadata for the route
  - `packages/kanban-lite/src/cli/commands/boards.ts` - add `boards overview`
  - `packages/kanban-lite/src/mcp-server/tools/boards.ts` - add `list_boards_overview`
- **Implementation**:
  - Add a REST route returning the SDK summary payload directly.
  - Add a CLI command that prints the summary in JSON and/or human-readable tabular form.
  - Add an MCP tool that returns the same payload as JSON text.
  - Keep error handling aligned with existing board export/import behavior.
- **Success**:
  - REST, CLI, and MCP all invoke the same SDK helper.
  - OpenAPI source metadata documents the new route.
  - Board-overview logic is not duplicated in each surface.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 222-241) - existing parity seams already exist for board capabilities
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 415-430) - recommended REST/CLI/MCP additions
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 595-606) - docs and generated-doc guidance
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 2: Transport, store, and routing

### Task 2.1: Add lazy overview transport for VS Code host and standalone browser

Introduce a demand-driven transport path so the overview page can request summary data without inflating the normal init payload.

- **Files**:
  - `packages/kanban-lite/src/shared/types/messages.ts` - add `loadBoardsOverview` request and `boardsOverview` response messages
  - `packages/kanban-lite/src/extension/KanbanPanel.ts` - handle `loadBoardsOverview` and reply with summary data
  - `packages/kanban-lite/src/webview/standalone-shim.ts` - intercept `loadBoardsOverview` and call the REST summary endpoint
  - `packages/kanban-lite/src/webview/App.tsx` - consume the response message and update view state
- **Implementation**:
  - Add a lazy message request rather than expanding `init` with all-board aggregate data.
  - In the VS Code host, call the new SDK helper directly and post the result back to the webview.
  - In standalone mode, fetch `GET /api/boards/overview` from the shim and post the same response shape back into the app.
  - Include an error path so the overview page can render a useful failure state.
- **Success**:
  - Opening the overview page triggers a summary load on demand.
  - VS Code and standalone return the same payload shape to the webview.
  - Summary loading does not require overloading the normal board init message.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 178-190) - current `init` payload cannot support this page by itself
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 431-458) - lazy transport recommendation and proposed message shapes
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 506-520) - demand-driven refresh guidance
- **Dependencies**:
  - Phase 1 completion

### Task 2.2: Extend the store and router with an all-boards view state

Make the overview page a first-class routed view rather than a hidden component toggle.

- **Files**:
  - `packages/kanban-lite/src/webview/store/state.ts` - add overview state contract fields/actions
  - `packages/kanban-lite/src/webview/store/store.ts` - implement overview state and mutations
  - `packages/kanban-lite/src/webview/router.tsx` - add a new overview route and URLSync bridging
  - `packages/kanban-lite/src/webview/App.tsx` - switch the main stage between board view and all-boards view
- **Implementation**:
  - Add store state such as:
    - `workspaceView: 'board' | 'allBoards'`
    - `boardsOverview`
    - `boardsOverviewStatus`
    - `boardsOverviewError`
  - Add a dedicated route for the overview page; prefer a safe static path such as `/workspace/boards` so the route does not overload `/$boardId`.
  - Extend URLSync so overview route state participates in the same store ↔ URL bridge as board/settings state.
  - Keep existing board, settings, and card routes working unchanged.
- **Success**:
  - The overview page has a stable route.
  - Reloading on the overview route restores the overview page instead of silently dropping back to a board.
  - Navigating from overview back to a board returns the normal board route/state.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 108-130) - current router architecture uses store-backed URL sync
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 156-177) - store currently has no overview state
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 459-483) - recommended store fields and route path
- **Dependencies**:
  - Task 2.1 completion
  - `react-tsx.instructions.md` applies to the webview changes

---

## Phase 3: Overview page UI and toolbar entry

### Task 3.1: Add the all-boards page and board-summary cards

Render the requested overview as a responsive page inside the existing app shell.

- **Files**:
  - `packages/kanban-lite/src/webview/components/AllBoardsPage.tsx` - overview page container
  - `packages/kanban-lite/src/webview/components/BoardOverviewCard.tsx` - optional extracted summary card component
  - `packages/kanban-lite/src/webview/App.tsx` - mount the overview page in the board-stage area
- **Implementation**:
  - Render one card per board using the new summary payload.
  - Show:
    - board name
    - optional description
    - total active cards
    - cards with notifications
    - per-column counts and notification counts
  - Add a CTA or card click behavior that opens the selected board.
  - Render loading, empty, and error states for the overview request.
- **Success**:
  - The page visually matches the requested information architecture.
  - Clicking a board card takes the user back to that board.
  - The component stays focused and does not pack aggregation logic into JSX.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 294-361) - requested UX, scope, notification semantics, and deleted-column scope
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 484-505) - recommended UI component structure
- **Dependencies**:
  - Phase 2 completion

### Task 3.2: Add the toolbar dropdown entry next to Settings

Expose the overview page through the existing board-options dropdown.

- **Files**:
  - `packages/kanban-lite/src/webview/components/Toolbar.tsx` - add the menu item and callback prop
  - `packages/kanban-lite/src/webview/App.tsx` - pass the callback from the app shell
- **Implementation**:
  - Add a new `onOpenAllBoards` prop to `Toolbar`.
  - Render an **All Boards** item in the board-options menu, adjacent to the existing **Settings** action.
  - Keep the existing board-options menu structure and close-on-click behavior intact.
- **Success**:
  - Users can reach the overview page from the requested dropdown location.
  - The toolbar API stays consistent with the existing callback-driven structure.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 72-91) - toolbar menu seam and settings anchor
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 294-309) - requested entry point
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 499-505) - recommended toolbar change
- **Dependencies**:
  - Task 2.2 completion

---

## Phase 4: Automated tests

### Task 4.1: Add SDK, surface, and UI tests

Cover the new summary logic and its transport/UI wiring with targeted tests.

- **Files**:
  - `packages/kanban-lite/src/sdk/__tests__/board-overview.test.ts` - new SDK summary tests
  - `packages/kanban-lite/src/webview/store/index.test.ts` - overview state/selectors
  - `packages/kanban-lite/src/webview/App.test.tsx` - stage switching / response handling
  - `packages/kanban-lite/src/webview/components/Toolbar.test.tsx` - board menu entry assertion
  - `packages/kanban-lite/src/extension/KanbanPanel.test.ts` - `loadBoardsOverview` host handling
  - `packages/kanban-lite/src/webview/standalone-shim.test.ts` - REST-backed standalone summary loading
  - `packages/kanban-lite/src/cli/**` / `packages/kanban-lite/src/mcp-server/**` tests if those surfaces already have suitable anchors
- **Implementation**:
  - Assert the SDK returns expected totals and per-column counts.
  - Assert deleted cards are excluded in v1 counts.
  - Assert notification counts become `null` when unread state is unavailable.
  - Assert the toolbar renders the new menu item.
  - Assert transport handlers load and return the summary payload.
- **Success**:
  - The new summary logic is covered outside of E2E.
  - Routing/menu regressions are caught by frontend tests.
  - Host/runtime regressions are caught before manual verification.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 276-291) - existing test anchors
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 522-565) - recommended unit/integration coverage
- **Dependencies**:
  - Phases 1-3 complete enough for testable code paths

### Task 4.2: Add standalone browser E2E coverage for the overview flow

Validate the user-visible route and navigation flow end to end.

- **Files**:
  - `packages/kanban-lite/e2e/standalone.all-boards-overview.spec.ts` - preferred new spec
  - or `packages/kanban-lite/e2e/standalone.board-settings.spec.ts` if the scenario fits better there
- **Implementation**:
  - Open the board-options menu.
  - Click **All Boards**.
  - Verify the route changes to the overview page.
  - Verify multiple board cards and per-column counts render.
  - Click a board card and verify navigation returns to that board’s main view.
- **Success**:
  - The new page is reachable from the requested menu location.
  - Board-card navigation back to a board works in the browser runtime.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 276-291) - existing E2E anchors around settings/menu flows
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 547-565) - recommended overview E2E assertions
- **Dependencies**:
  - Task 4.1 completion

---

## Phase 5: Docs and verification

### Task 5.1: Update docs and changelog for the new overview page

Document the new overview page and its summary semantics.

- **Files**:
  - `README.md` - add a short user-facing description of the new All Boards view
  - `CHANGELOG.md` - add a feature entry
  - source JSDoc / route metadata if the SDK or REST surface gains new public summary endpoints
- **Implementation**:
  - Document that notification counts are based on unread state.
  - Document that v1 totals exclude deleted cards/columns.
  - Regenerate source-driven docs if SDK or OpenAPI comments change.
- **Success**:
  - User-facing docs mention the page and how its counts are interpreted.
  - Generated docs stay source-driven rather than manually patched.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 595-606) - implementation/documentation guidance
- **Dependencies**:
  - Phase 4 completion

### Task 5.2: Run the required verification commands

Validate the feature against repo rules before considering it complete.

- **Files**:
  - No source files; verification only
- **Implementation**:
  - Run `pnpm exec tsc --noEmit`
  - Run `nr build`
  - Run `nr test`
  - Run `nr e2e`
  - Fix any newly introduced failures before closing the task.
- **Success**:
  - TypeScript, build, unit tests, and E2E all pass with no new failures.
- **Research References**:
  - #file:../research/20260506-all-boards-overview-page-research.md (Lines 595-614) - final guidance and task breakdown
  - #file:../../AGENTS.md - mandatory post-change verification order
- **Dependencies**:
  - Task 5.1 completion

---

## Dependencies

- SDK is the source of truth for reusable aggregation logic.
- `core-surface.instructions.md` applies because SDK/REST/CLI/MCP surfaces are affected.
- `react-tsx.instructions.md` applies because new TSX UI components and existing TSX files will change.
- The overview page depends on actor-scoped unread state when available, so the UI must tolerate unavailable notification counts.

## Success Criteria

- Users can open an All Boards overview page from the toolbar board-options dropdown.
- The page shows per-board totals and per-column counts using SDK-backed data.
- Notification counts reflect unread state semantics without guessing when the backend is unavailable.
- SDK, REST, CLI, and MCP expose the same summary capability.
- Tests, docs, and required verification commands are all updated and passing.

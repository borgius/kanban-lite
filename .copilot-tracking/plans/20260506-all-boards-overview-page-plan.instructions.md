---
applyTo: ".copilot-tracking/changes/20260506-all-boards-overview-page-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: All Boards Overview Page

## Overview

Add a routed All Boards overview page that shows per-board and per-column card/notification counts, and expose it from the toolbar board-options dropdown next to the existing Settings entry.

## Objectives

- Create an SDK-first board-summary capability that can aggregate board totals and unread-based notification counts across all boards.
- Add a routed overview page in the webview with one summary card per board and a toolbar menu entry to open it.
- Keep REST, CLI, and MCP in parity with the new summary capability.
- Cover the new summary, transport, route, and menu behavior with automated tests.
- Update user-facing docs and complete the required repo verification commands.

## Research Summary

### Project Files

- `packages/kanban-lite/src/webview/components/Toolbar.tsx` - existing board-options dropdown and Settings menu item anchor
- `packages/kanban-lite/src/webview/router.tsx` - store-backed route tree and URLSync bridge that must gain an overview route
- `packages/kanban-lite/src/webview/App.tsx` - current app shell that renders the active board, settings, logs, and empty state
- `packages/kanban-lite/src/webview/store/store.ts` - current board/filter/editor state with no all-boards view state yet
- `packages/kanban-lite/src/shared/types/messages.ts` - shared transport contract for lazy overview loading
- `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts` - public board surface where the new summary helper should be exposed
- `packages/kanban-lite/src/sdk/KanbanSDK-card-state.ts` - existing by-board card-state batching used to compute notification counts efficiently
- `packages/kanban-lite/src/extension/KanbanPanel.ts` - VS Code host side of the webview transport
- `packages/kanban-lite/src/webview/standalone-shim.ts` - standalone browser transport seam
- `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts` - REST board routes that need summary parity

### External References

- #file:../research/20260506-all-boards-overview-page-research.md - validated repo and external research for this task
- #fetch:https://tanstack.com/router/latest/docs/framework/react/guide/navigation - TanStack Router navigation patterns for route-driven page changes
- #fetch:https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts - route structure guidance for adding an overview route
- #fetch:https://tanstack.com/router/latest/docs/framework/react/guide/outlets - nested rendering guidance for route-backed app pages

### Standards References

- #file:../../AGENTS.md - SDK-first architecture, parity expectations, docs updates, and mandatory verification commands
- #file:../../.github/instructions/core-surface.instructions.md - SDK/API/CLI/MCP sequencing and generated-doc rules
- #file:../../.github/instructions/react-tsx.instructions.md - lint-safe TSX component changes for the overview page and toolbar

## Implementation Checklist

### [ ] Phase 1: SDK board-summary capability

- [ ] Task 1.1: Add an SDK-first all-boards summary helper
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 13-46)

- [ ] Task 1.2: Expose the summary capability in REST, CLI, and MCP
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 47-73)

### [ ] Phase 2: Transport, store, and routing

- [ ] Task 2.1: Add lazy overview transport for VS Code host and standalone browser
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 76-100)

- [ ] Task 2.2: Extend the store and router with an all-boards view state
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 101-132)

### [ ] Phase 3: Overview page UI and toolbar entry

- [ ] Task 3.1: Add the all-boards page and board-summary cards
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 135-162)

- [ ] Task 3.2: Add the toolbar dropdown entry next to Settings
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 163-185)

### [ ] Phase 4: Automated tests

- [ ] Task 4.1: Add SDK, surface, and UI tests
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 188-215)

- [ ] Task 4.2: Add standalone browser E2E coverage for the overview flow
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 216-239)

### [ ] Phase 5: Docs and verification

- [ ] Task 5.1: Update docs and changelog for the new overview page
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 242-261)

- [ ] Task 5.2: Run the required verification commands
  - Details: .copilot-tracking/details/20260506-all-boards-overview-page-details.md (Lines 262-283)

## Dependencies

- Existing board/card SDK helpers and board-scoped card-state batching
- Shared message transport between webview and host runtimes
- TanStack Router route tree and URLSync architecture
- README / CHANGELOG updates for user-facing behavior
- Required repo verification commands from `AGENTS.md`

## Success Criteria

- An All Boards page exists and is reachable from the toolbar board-options dropdown.
- Each board card shows total active cards, notification counts, and per-column counts.
- Notification counts reflect unread state semantics and degrade gracefully when unavailable.
- SDK, REST, CLI, and MCP expose the same board-summary capability.
- Tests and mandatory verification commands pass with no new failures.

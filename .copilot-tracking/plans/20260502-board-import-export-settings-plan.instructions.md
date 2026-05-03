---
applyTo: ".copilot-tracking/changes/20260502-board-import-export-settings-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Board Import/Export in Settings Page

## Overview

Add JSON-based board settings export/import to the board settings page, with SDK-first persistence helpers and parity across the standalone API, CLI, MCP, VS Code host, and standalone browser flows.

## Objectives

- Export the current board’s structure and supported board-related config as a versioned JSON archive.
- Import that JSON archive to restore a board’s columns, defaults, actions, labels, metadata, forms, and supported hook-related config fragments.
- Keep the implementation SDK-first and wire API, CLI, and MCP surfaces in parity.
- Add automated tests for SDK behavior, host wiring, settings UI rendering, and standalone end-to-end flow.
- Update user-facing documentation and pass the required verification commands.

## Research Summary

### Project Files

- `packages/kanban-lite/src/webview/components/SettingsPanel.tsx` - current board settings tab render seam
- `packages/kanban-lite/src/webview/App.tsx` - settings callbacks and `vscode.postMessage(...)` wiring
- `packages/kanban-lite/src/shared/types/messages.ts` - shared message contract to extend
- `packages/kanban-lite/src/sdk/modules/boards.ts` - existing board config persistence
- `packages/kanban-lite/src/sdk/KanbanSDK-core.ts` - `getConfigSnapshot()` export helper seam
- `packages/kanban-lite/src/extension/KanbanPanel.ts` - VS Code save/open dialog host patterns
- `packages/kanban-lite/src/webview/standalone-shim.ts` - standalone browser interception seam
- `packages/kanban-lite/e2e/standalone.board-settings.spec.ts` - existing board settings E2E anchor

### External References

- #file:../research/20260502-board-import-export-settings-research.md - validated repo and external research for this task
- #fetch:https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications - browser file input/download patterns for standalone import/export
- #fetch:https://developer.mozilla.org/en-US/docs/Web/API/Blob - JSON blob creation pattern for browser downloads
- #fetch:https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static - object URL download flow
- #fetch:https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static - object URL cleanup requirement

### Standards References

- #file:../../AGENTS.md - SDK-first architecture, 600-line source-file rule, README/CHANGELOG updates, and mandatory verification commands
- #file:../../.github/instructions/core-surface.instructions.md - SDK/API/CLI/MCP parity and generated-doc guidance
- #file:../../.github/instructions/react-tsx.instructions.md - lint-safe React/TSX patterns for extracted settings UI controls

## Implementation Checklist

### [ ] Phase 1: SDK export/import contract

- [ ] Task 1.1: Add a versioned board-settings archive contract and SDK wrappers
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 13-40)

- [ ] Task 1.2: Implement validation and deterministic import semantics
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 41-72)

### [ ] Phase 2: API, CLI, and MCP parity

- [ ] Task 2.1: Add standalone REST endpoints and OpenAPI metadata
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 75-96)

- [ ] Task 2.2: Add CLI and MCP commands that mirror the SDK helper
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 97-120)

### [ ] Phase 3: Settings UI and host file workflows

- [ ] Task 3.1: Add webview message types and extracted board import/export controls
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 123-147)

- [ ] Task 3.2: Implement VS Code host save/open dialog handling
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 148-173)

- [ ] Task 3.3: Implement standalone browser download/upload handling
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 174-204)

### [ ] Phase 4: Tests

- [ ] Task 4.1: Add SDK, webview, and host unit tests
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 207-228)

- [ ] Task 4.2: Extend standalone board-settings E2E coverage
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 229-249)

### [ ] Phase 5: Docs and verification

- [ ] Task 5.1: Update user-facing docs and changelog
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 252-271)

- [ ] Task 5.2: Run the required verification commands
  - Details: .copilot-tracking/details/20260502-board-import-export-settings-details.md (Lines 272-295)

## Dependencies

- Existing SDK board/config helpers and `getConfigSnapshot()`
- Existing board settings webview transport wiring in `App.tsx`
- VS Code host file APIs (`showSaveDialog`, `showOpenDialog`, `workspace.fs.*`)
- Browser file APIs (`Blob`, object URLs, file input / file text reading)
- Existing test harnesses for `SettingsPanel`, `KanbanPanel`, standalone shim, and standalone board-settings E2E

## Success Criteria

- Users can export board settings from the settings page as a JSON archive.
- Users can import that JSON archive and restore supported board settings/config in a fresh workspace.
- SDK, standalone API, CLI, and MCP surfaces expose the same archive behavior.
- Automated tests cover serialization, host wiring, UI visibility, and end-to-end restore behavior.
- README / CHANGELOG are updated and the required verification commands pass with no new failures.

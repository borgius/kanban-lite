<!-- markdownlint-disable-file -->

# Task Details: Board Import/Export in Settings Page

## Research Reference

**Source Research**: #file:../research/20260502-board-import-export-settings-research.md

---

## Phase 1: SDK export/import contract

### Task 1.1: Add a versioned board-settings archive contract and SDK wrappers

Create a focused SDK-first implementation for JSON board settings import/export.

- **Files**:
  - `packages/kanban-lite/src/sdk/modules/board-import-export.ts` - new pure helper module for payload assembly, parsing, and config merge logic
  - `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts` - thin public wrappers that delegate to the helper module
  - `packages/kanban-lite/src/shared/types/card.ts` or a new shared SDK type file - payload type export if shared across SDK/API/UI is needed
- **Implementation**:
  - Define a versioned payload such as `BoardSettingsExportV1` with `kind`, `version`, `exportedAt`, `board`, and `workspace` sections.
  - Export the current board config from `getBoard(...)` plus selected workspace fragments from `getConfigSnapshot()`.
  - Keep v1 scope to **board settings/config only**; do not add card-content/archive behavior in this task.
  - Expose public SDK methods, for example:
    - `exportBoardSettings(boardId?: string)`
    - `importBoardSettings(payload: unknown, options?: { overwrite?: boolean })`
  - Keep the heavy logic out of existing large files.
- **Success**:
  - SDK can produce a JSON-safe archive for a board.
  - SDK can import a valid archive and persist a new board.
  - The public API is documented with JSDoc because SDK docs are source-driven.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 53-149) - Existing SDK/config seams and file targets
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 150-239) - Evidence-based scope and payload contents
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 240-282) - SDK-first implementation recommendation
- **Dependencies**:
  - Existing board helpers in `sdk/modules/boards.ts`
  - Existing config snapshot helper in `sdk/KanbanSDK-core.ts`

### Task 1.2: Implement validation and deterministic import semantics

Make import fail closed and keep merge behavior explicit.

- **Files**:
  - `packages/kanban-lite/src/sdk/modules/board-import-export.ts` - validation and merge helpers
  - `packages/kanban-lite/src/shared/config/types.ts` - only if a reusable exported type is necessary
- **Implementation**:
  - Validate `kind`, `version`, `board.id`, `board.config`, and the expected object shapes before writing config.
  - Default to rejecting duplicate board IDs (`Board already exists: <id>`) unless the final implementation explicitly adds an overwrite flag.
  - Merge only board-related workspace fragments:
    - `labels`
    - `forms`
    - `plugins['webhook.delivery']`
    - `plugins['callback.runtime']`
    - `plugins['cron.runtime']`
    - compatibility fields `webhookPlugin` and `webhooks`
  - Do **not** mutate unrelated global selections such as auth or storage.
  - Write the updated config once after all merge decisions are finalized.
- **Success**:
  - Malformed payloads throw clear errors.
  - Duplicate board IDs do not silently overwrite existing boards.
  - Hook-like config survives export/import for supported sections.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 179-239) - Required workspace fragments and scope boundaries
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 283-338) - Import semantics and extraction guidance
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 427-439) - Fail-closed validation guidance
- **Dependencies**:
  - Task 1.1 completion

---

## Phase 2: API, CLI, and MCP parity

### Task 2.1: Add standalone REST endpoints and OpenAPI metadata

Expose the new SDK behavior through the standalone server.

- **Files**:
  - `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts` - add board export/import handlers
  - `packages/kanban-lite/src/standalone/internal/openapi-spec/paths-boards.ts` - add source metadata for the new endpoints
- **Implementation**:
  - Add `GET /api/boards/:boardId/export` returning JSON export payload.
  - Add `POST /api/boards/import` accepting a JSON payload and invoking the SDK import helper.
  - Keep route behavior thin: parse input, call SDK, return `{ ok, data }` / `{ ok, error }`.
  - Refresh/broadcast the authoritative board snapshot after a successful import so the web UI updates.
- **Success**:
  - Export route returns the same payload shape as the SDK helper.
  - Import route persists config and refreshes the active board state.
  - OpenAPI source metadata covers both routes.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 126-149) - Existing standalone parity seams
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 283-300) - Recommended REST route shapes
- **Dependencies**:
  - Phase 1 completion

### Task 2.2: Add CLI and MCP commands that mirror the SDK helper

Keep the core-surface contract aligned across supported hosts.

- **Files**:
  - `packages/kanban-lite/src/cli/commands/boards.ts` - add `export` / `import` subcommands
  - `packages/kanban-lite/src/mcp-server/tools/boards.ts` - add `export_board` / `import_board` tools
  - `packages/kanban-lite/src/cli/cli-main.ts` - only if command dispatch text/help needs updates
- **Implementation**:
  - CLI export should either print JSON or write to `--out`.
  - CLI import should read JSON from a file and call the SDK helper.
  - MCP export should return JSON text content.
  - MCP import should accept JSON text or structured input and return the imported board summary.
- **Success**:
  - CLI and MCP can invoke the same SDK-backed archive behavior.
  - Error behavior stays consistent with existing board commands.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 126-149) - Existing CLI/MCP file locations
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 301-320) - Recommended CLI/MCP parity behavior
- **Dependencies**:
  - Phase 1 completion

---

## Phase 3: Settings UI and host file workflows

### Task 3.1: Add webview message types and extracted board import/export controls

Add UI affordances without growing the already-large settings file more than necessary.

- **Files**:
  - `packages/kanban-lite/src/shared/types/messages.ts` - add webview messages for board export/import
  - `packages/kanban-lite/src/webview/components/BoardImportExportControls.tsx` - new extracted UI component
  - `packages/kanban-lite/src/webview/components/SettingsPanel.tsx` - minimal integration point for the new controls
  - `packages/kanban-lite/src/webview/App.tsx` - pass callbacks from the app shell
- **Implementation**:
  - Add transport messages such as:
    - `{ type: 'exportBoardSettings'; boardId?: string }`
    - `{ type: 'importBoardSettings'; boardId?: string }`
  - Render `Export board` and `Import board` controls inside the board tab, preferably as a small utility row above the existing sub-tab content.
  - Keep `SettingsPanel.tsx` changes small by delegating the new UI to a child component.
- **Success**:
  - The board tab renders clear import/export controls.
  - Clicking the controls dispatches new webview messages via the existing app wiring pattern.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 57-75) - Current board settings UI seam
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 110-125) - Shared message seam
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 321-338) - UI placement and extraction guidance
- **Dependencies**:
  - Phase 1 completion

### Task 3.2: Implement VS Code host save/open dialog handling

Mirror the existing `downloadCard` and attachment-import patterns in the extension host.

- **Files**:
  - `packages/kanban-lite/src/extension/KanbanPanel.ts` - handle new board import/export messages
- **Implementation**:
  - For export:
    - call the SDK export helper
    - show a save dialog with a `.json` default filename
    - write the serialized JSON using `workspace.fs.writeFile`
  - For import:
    - show an open dialog for JSON files
    - read the file bytes using `workspace.fs.readFile`
    - parse JSON and call the SDK import helper
    - refresh the webview/init payload afterward
  - Keep everything JSON-serializable across the webview boundary.
- **Success**:
  - Extension-host export writes a JSON file without involving the webview filesystem.
  - Extension-host import restores the board and refreshes the visible state.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 76-96) - Existing save/open dialog precedents in `KanbanPanel.ts`
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 380-407) - VS Code host file-handling reference
- **Dependencies**:
  - Task 3.1 completion

### Task 3.3: Implement standalone browser download/upload handling

Use browser-native file APIs in the standalone shim while keeping server writes in the API.

- **Files**:
  - `packages/kanban-lite/src/webview/standalone-shim.ts` - intercept new board import/export messages
- **Implementation**:
  - For export:
    - fetch `GET /api/boards/:boardId/export`
    - create a JSON `Blob`
    - create an object URL, trigger download via an anchor, then revoke the URL
  - For import:
    - open a hidden file input limited to JSON
    - read the selected file as text
    - `JSON.parse(...)` the payload
    - POST it to `/api/boards/import`
    - refresh the current state afterward
  - Reuse existing shim interception patterns instead of pushing raw `File` objects through websocket messages.
- **Success**:
  - Standalone export triggers a browser JSON download.
  - Standalone import reads a selected JSON file and restores the board.
  - Object URLs are revoked after use.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 97-109) - Existing standalone shim interception seam
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 408-426) - Browser Blob/object URL/file-input reference
- **Dependencies**:
  - Task 2.1 completion
  - Task 3.1 completion

---

## Phase 4: Tests

### Task 4.1: Add SDK, webview, and host unit tests

Cover payload shape, host flows, and rendered UI.

- **Files**:
  - `packages/kanban-lite/src/sdk/__tests__/board-import-export.test.ts` - new SDK-focused tests
  - `packages/kanban-lite/src/webview/components/SettingsPanel.test.tsx` - render board-tab controls
  - `packages/kanban-lite/src/extension/KanbanPanel.test.ts` - message-handling tests for save/open dialogs
  - `packages/kanban-lite/src/webview/standalone-shim.test.ts` - optional shim interception tests if the new browser flow is non-trivial
- **Implementation**:
  - Assert export payload includes board config plus the intended workspace fragments.
  - Assert import rejects malformed payloads and duplicate board IDs.
  - Assert the settings board tab renders the new controls.
  - Assert extension export/import uses the correct VS Code file APIs.
- **Success**:
  - Unit coverage exists for both serialization logic and host behavior.
  - Regressions around duplicate IDs and malformed JSON are caught by tests.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 339-379) - Existing test anchors and recommended additions
- **Dependencies**:
  - Phases 1-3 complete enough for testable code paths

### Task 4.2: Extend standalone board-settings E2E coverage

Validate the complete settings-page flow in the standalone browser.

- **Files**:
  - `packages/kanban-lite/e2e/standalone.board-settings.spec.ts` - extend with import/export scenarios
- **Implementation**:
  - Add an export test that downloads a JSON archive from the settings page.
  - Add an import test that restores a board into a fresh scenario/workspace.
  - Reuse the existing `readConfig(...)` helper to verify `.kanban.json` state after import.
  - Assert restored board actions/title/meta/defaults/labels are present after import.
- **Success**:
  - Playwright verifies the browser-visible workflow end to end.
  - Imported config matches the exported board settings archive.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 339-379) - Existing board-settings E2E anchor
- **Dependencies**:
  - Task 3.3 completion

---

## Phase 5: Docs and verification

### Task 5.1: Update user-facing docs and changelog

Document the new archive behavior where users already look for it.

- **Files**:
  - `README.md` - mention board settings import/export and JSON archive scope
  - `CHANGELOG.md` - add user-facing entry
  - SDK/API source docs or metadata comments if new public SDK/API surfaces are added
- **Implementation**:
  - Document that v1 import/export covers board settings/config, not card-content archives.
  - Document CLI/MCP/API entry points if those are added.
  - Regenerate any source-driven docs affected by new JSDoc/OpenAPI metadata instead of editing generated docs directly.
- **Success**:
  - README and changelog reflect the feature.
  - Source-driven docs remain consistent with the new public contract.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 427-439) - Documentation and generated-doc guidance
- **Dependencies**:
  - Phases 1-4 complete

### Task 5.2: Run the required verification commands

Validate the feature against repo standards before considering it complete.

- **Files**:
  - No source files; verification only
- **Implementation**:
  - Run `pnpm exec tsc --noEmit`
  - Run `nr build`
  - Run `nr test`
  - Run `nr e2e`
  - Fix any issues introduced by the change before closing the task.
- **Success**:
  - TypeScript, build, unit tests, and E2E tests all pass with no new failures.
- **Research References**:
  - #file:../research/20260502-board-import-export-settings-research.md (Lines 427-446) - Final guidance and task breakdown
  - #file:../../AGENTS.md - Mandatory post-change verification order
- **Dependencies**:
  - Task 5.1 completion

---

## Dependencies

- SDK is the source of truth for shared behavior.
- `core-surface.instructions.md` applies because SDK/API/CLI/MCP surfaces are affected.
- `react-tsx.instructions.md` applies because a new TSX child component is recommended.
- Browser import/export in standalone must use JSON-safe webview messaging and browser file APIs.

## Success Criteria

- A board settings JSON archive can be exported from the settings page.
- Import restores board structure and supported board-related config fragments.
- SDK, API, CLI, MCP, extension host, and standalone browser flows stay aligned.
- README / CHANGELOG are updated and the required verification commands pass.

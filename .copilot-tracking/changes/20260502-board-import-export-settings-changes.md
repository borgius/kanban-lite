# Board Import/Export Settings — Changes

**Date:** 2025-05-02
**Feature:** Board settings export/import
**Branch:** copilot/add-cron-capability-plugin

## Summary

Added the ability to export and import board settings (columns, defaults, actions, labels, forms, hook-related plugin config) as versioned JSON archives across all surfaces.

## New Files

- `packages/kanban-lite/src/sdk/modules/board-import-export.ts` — Pure helper module with `exportBoardSettings` and `importBoardSettings` functions plus the `BoardSettingsExportV1` type.
- `packages/kanban-lite/src/sdk/__tests__/board-import-export.test.ts` — SDK unit tests for both functions.
- `packages/kanban-lite/src/webview/components/BoardImportExportControls.tsx` — UI strip component with Export/Import buttons.

## Modified Files

### SDK / Core
- `packages/kanban-lite/src/sdk/KanbanSDK-boards.ts` — Added `exportBoardSettings()` and `importBoardSettings()` wrapper methods.

### Standalone REST API
- `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts` — Added `GET /api/boards/:boardId/export` and `POST /api/boards/import` routes.
- `packages/kanban-lite/src/standalone/internal/openapi-spec/paths-boards.ts` — Added OpenAPI path entries for both new routes.

### CLI
- `packages/kanban-lite/src/cli/commands/boards.ts` — Added `export` and `import` subcommands under `kl boards`.

### MCP
- `packages/kanban-lite/src/mcp-server/tools/boards.ts` — Added `export_board` and `import_board` tools.

### Webview / Settings UI
- `packages/kanban-lite/src/shared/types/messages.ts` — Added `exportBoardSettings`/`importBoardSettings` to `WebviewMessage` union; added `boardSettingsExportResult`/`boardSettingsImportResult` to `ExtensionMessage` union.
- `packages/kanban-lite/src/webview/components/SettingsPanel.tsx` — Added `onExportBoardSettings`/`onImportBoardSettings` props and `BoardImportExportControls` strip in the board tab.
- `packages/kanban-lite/src/webview/App.tsx` — Wired `onExportBoardSettings`/`onImportBoardSettings` via `vscode.postMessage`.

### VS Code Extension Host
- `packages/kanban-lite/src/extension/KanbanPanel.ts` — Added `exportBoardSettings` and `importBoardSettings` message handler cases with file save/open dialogs.

### Standalone Browser Shim
- `packages/kanban-lite/src/webview/standalone-shim.ts` — Added `handleExportBoardSettings` (fetch → Blob download) and `handleImportBoardSettings` (file input → POST) functions; intercepted both message types before WebSocket forwarding.

## Behavior Notes

- **Export** includes: board config (columns, defaults, actions, metadata, title, titleTemplate, description), labels, forms, `webhook.delivery`, `callback.runtime`, `cron.runtime` plugin fragments, `webhookPlugin`, and top-level `webhooks`.
- **Export excludes**: card content, comments, attachments, logs, auth/storage plugin config, and other global workspace settings.
- **Import** merges workspace fragments (labels, forms, hook plugin config) without touching unrelated global settings (auth, storage, server config).
- **Duplicate board IDs** are rejected by default; pass `overwrite: true` to replace.
- **Single config write**: All merge decisions are made in memory before calling `writeConfig` once.
- **Validation** is fail-closed: invalid `kind`, `version`, or shape throws before any write.

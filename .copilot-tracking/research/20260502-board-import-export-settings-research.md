<!-- markdownlint-disable-file -->

# Research: Board Import/Export in Settings Page

## Summary

Add JSON-based board import/export to the board settings UI using SDK-first
helpers, then wire the feature through the standalone API, CLI, MCP, VS Code
host, and standalone browser shim. The current settings surface edits board
configuration, not card content, so the smallest evidence-based v1 scope is a
**board settings archive** rather than a full board-and-cards backup.

---

## 1. Research validation and tool findings

### 1.1 Existing planning state

- `file_search` found no task-specific research for board import/export.
- Only one prior research file exists: `.copilot-tracking/research/20260501-sdk-remote-mode-research.md`.
- `file_search` for `**/task-researcher.agent.md` returned no results, so the
  workspace does not currently include the dedicated research-agent file
  referenced by Task Planner mode.

### 1.2 Verified repo investigation

- The settings page lives in the webview, primarily
  `packages/kanban-lite/src/webview/components/SettingsPanel.tsx`.
- Board settings routing and persistence are already covered by
  `packages/kanban-lite/e2e/standalone.board-settings.spec.ts`.
- Board config persistence is SDK-owned in
  `packages/kanban-lite/src/sdk/modules/boards.ts` and `shared/config/*`.
- The current board settings flow uses `vscode.postMessage(...)` from the
  webview and host-specific handlers in the extension / standalone shim.

### 1.3 External source research gathered

- VS Code API reference for webview message passing and file save dialogs.
- MDN docs for `Blob`, `URL.createObjectURL()`, `URL.revokeObjectURL()`,
  `FileReader.readAsText()`, and file-input handling from web apps.

These sources confirm:

- VS Code webviews can only send JSON-serializable messages; file dialogs must
  live in the extension host.
- Browser export can use `Blob` + `URL.createObjectURL()` + a temporary anchor.
- Browser import can use a hidden `<input type="file">` and read JSON as text
  with `Blob.text()` or `FileReader.readAsText()`.
- Object URLs should be explicitly revoked after download-trigger flows.

---

## 2. Current repo structure and implementation seams

### 2.1 Board settings UI seam

The board settings UI is rendered in `SettingsPanel.tsx`.

- `packages/kanban-lite/src/webview/components/SettingsPanel.tsx:2131-2209`
  renders the board tab with the existing sub-tabs:
  `defaults`, `title`, `actions`, `labels`, `meta`.
- There are currently **no** import/export controls in that area.
- `packages/kanban-lite/src/webview/App.tsx:1290-1343` wires the settings panel
  callbacks using `vscode.postMessage(...)`, including
  `updateBoardMeta`, `updateBoardTitle`, and `updateBoardActions`.
- `packages/kanban-lite/src/shared/types/messages.ts:132-196` defines existing
  webview transport messages. No board import/export message types exist yet.

### 2.2 Host-specific file handling seam

The repo already has a split pattern for file-related UI actions.

- `packages/kanban-lite/src/extension/KanbanPanel.ts:291-307` handles
  `downloadCard` by calling:
  - `vscode.window.showSaveDialog(...)`
  - `vscode.workspace.fs.readFile(...)`
  - `vscode.workspace.fs.writeFile(...)`
- `packages/kanban-lite/src/extension/KanbanPanel.ts:1496-1503` shows a current
  `showOpenDialog(...)` flow in `_addAttachment()`, which is a natural precedent
  for JSON import.
- `packages/kanban-lite/src/webview/standalone-shim.ts:481-620` already
  intercepts browser-only actions before sending websocket / HTTP-sync traffic.

This means board import/export should follow the existing split:

- **VS Code host**: file dialogs in `KanbanPanel.ts`
- **Standalone browser**: file input / blob download in `standalone-shim.ts`

### 2.3 SDK-owned board persistence seam

Board persistence already lives in the SDK.

- `packages/kanban-lite/src/sdk/modules/boards.ts:22-34`
  `listBoards()` returns `BoardInfo[]` from config.
- `packages/kanban-lite/src/sdk/modules/boards.ts:112-143`
  `getBoard()` and `updateBoard()` read/write board config.
- `packages/kanban-lite/src/sdk/modules/boards.ts:145-177`
  `getBoardActions()`, `addBoardAction()`, and `removeBoardAction()` manage
  board actions.
- `packages/kanban-lite/src/sdk/KanbanSDK-core.ts:308-310`
  `getConfigSnapshot()` returns a deep-cloned config snapshot via
  `structuredClone(readConfig(...))`.

Because `getConfigSnapshot()` is already public and cloned, it is the safest
source for export payload assembly.

### 2.4 Board/config type seam

The config model shows what can be exported today.

- `packages/kanban-lite/src/shared/config/types.ts:208-291`
  `BoardConfig` includes:
  - `columns`
  - `defaultStatus`
  - `defaultPriority`
  - `actions`
  - `metadata`
  - `title`
  - `titleTemplate`
  - `minimizedColumnIds`
- `packages/kanban-lite/src/shared/config/types.ts:292-399`
  `KanbanConfig` includes workspace-level config relevant to board behavior:
  - `labels`
  - `forms`
  - `plugins`
  - `webhooks`
  - `webhookPlugin`
  - other global display/server fields
- `packages/kanban-lite/src/shared/types/card.ts:207-220`
  `BoardInfo` already exposes `actions`, `metadata`, `title`, `titleTemplate`,
  and `forms`.

### 2.5 Existing parity seams

Board capabilities already exist across all host surfaces.

- CLI: `packages/kanban-lite/src/cli/commands/boards.ts:24-98`
- MCP: `packages/kanban-lite/src/mcp-server/tools/boards.ts:12-60`
- Standalone REST board routes:
  `packages/kanban-lite/src/standalone/internal/routes/boards/board-routes.ts:61-207`
- OpenAPI metadata:
  `packages/kanban-lite/src/standalone/internal/openapi-spec/paths-boards.ts:17-207`

This matches the repo rule in `AGENTS.md` and
`.github/instructions/core-surface.instructions.md`: shared behavior belongs in
the SDK first, then API, CLI, and MCP should stay in parity.

---

## 3. What “board export/import” means in this repo today

### 3.1 Evidence-based scope

The current settings page only edits board configuration, labels, and related
metadata. It does **not** manage board card content, comments, attachment bytes,
or logs.

Relevant evidence:

- `SettingsPanel.tsx:2131-2209` only exposes defaults, title, actions, labels,
  and metadata.
- `board-dispatch.ts:220-249` only handles websocket board-setting mutations for
  title/actions/meta and label CRUD in this settings path.
- The current SDK board module is config-oriented rather than archival.

### 3.2 Recommended v1 scope

Implement **board settings export/import**, not a full board-with-cards archive.

That keeps the feature aligned with the settings page and avoids introducing a
much larger asset migration system for:

- card markdown/content
- comment histories
- attachment file bytes
- checklist versions/tokens
- board logs

Those data flows would require new transport and restore semantics far beyond
what the current settings page edits.

### 3.3 Recommended payload contents

To satisfy the user request for columns and “actions, hooks, etc.”, the export
payload should include the board config plus the minimal workspace-level
fragments that drive board behavior today.

Recommended payload:

```json
{
  "kind": "kanban-lite.board-settings",
  "version": 1,
  "exportedAt": "2026-05-02T00:00:00.000Z",
  "board": {
    "id": "default",
    "config": {
      "name": "Default",
      "columns": [],
      "defaultStatus": "backlog",
      "defaultPriority": "medium",
      "actions": {},
      "metadata": {},
      "title": [],
      "titleTemplate": "${title}"
    }
  },
  "workspace": {
    "labels": {},
    "forms": {},
    "plugins": {
      "webhook.delivery": { "provider": "webhooks", "options": {} },
      "callback.runtime": { "provider": "callbacks", "options": {} },
      "cron.runtime": { "provider": "cron", "options": {} }
    },
    "webhookPlugin": {
      "webhook.delivery": { "provider": "webhooks" }
    },
    "webhooks": []
  }
}
```

### 3.4 Why these workspace fragments belong in the payload

- `labels`: board settings UI exposes labels directly.
- `forms`: `BoardInfo` already surfaces config forms as board-available data.
- `plugins['webhook.delivery']`, `plugins['callback.runtime']`,
  `plugins['cron.runtime']`: these are the persisted “hook-like” capability
  selections/options in the current architecture.
- `webhookPlugin` and top-level `webhooks`: compatibility fields still matter in
  this repo and are explicitly preserved elsewhere.

Avoid exporting unrelated workspace-global selections such as auth or storage in
v1. They are not board-specific and could make a board import unexpectedly
mutate unrelated workspace infrastructure.

---

## 4. Recommended implementation approach

### 4.1 SDK-first helpers

Add new SDK helpers first, ideally in a small dedicated module so large files do
not grow further:

- `packages/kanban-lite/src/sdk/modules/board-import-export.ts` (new)
- Thin method wrappers on the SDK board surface:
  - `exportBoardSettings(boardId?: string)`
  - `importBoardSettings(payload, options?)`

Why a new module:

- `SettingsPanel.tsx` already spans well beyond the repo’s 600-line target.
- The repo rule says to avoid growing oversized source files; extracting new
  logic into focused files is the safer path.

Suggested SDK responsibilities:

1. Resolve the board ID.
2. Read `board = getBoard(...)`.
3. Read `snapshot = getConfigSnapshot()`.
4. Build the JSON payload from the board plus selected workspace fragments.
5. Validate import payload shape.
6. Reject malformed payloads and unsupported versions.
7. Reject existing board IDs by default (`Board already exists: <id>`) to keep
   import deterministic and safe.
8. Merge labels/forms/hook-related config fragments into the current config.
9. Persist with one config write.

### 4.2 Standalone API parity

Add standalone REST routes on top of the SDK helpers:

- `GET /api/boards/:boardId/export`
- `POST /api/boards/import`

Why REST is useful even though the UI also has websocket messaging:

- standalone browser export/download is easiest from a plain JSON response
- standalone browser import is easiest by posting parsed JSON from the shim
- API parity is required by repo guidance for user-facing SDK features

### 4.3 CLI parity

Add CLI board subcommands in `cli/commands/boards.ts`:

- `kl boards export <id> [--out path] [--json]`
- `kl boards import <path>`

Likely behavior:

- export prints JSON to stdout when `--out` is omitted or `--json` is set
- import reads JSON from file and invokes the SDK helper

### 4.4 MCP parity

Add MCP tools in `mcp-server/tools/boards.ts`:

- `export_board`
- `import_board`

Suggested MCP contract:

- export returns JSON text content
- import accepts JSON text or structured object input and returns the imported
  board summary

### 4.5 Webview and host wiring

Add new message types in `shared/types/messages.ts`:

- `exportBoardSettings`
- `importBoardSettings`

Then wire both hosts:

- **VS Code extension**
  - `exportBoardSettings` → call SDK helper → `showSaveDialog` → `writeFile`
  - `importBoardSettings` → `showOpenDialog` → `readFile` → SDK helper → refresh
- **Standalone shim**
  - export → fetch export REST route → `Blob` download → `revokeObjectURL`
  - import → hidden file input → read JSON text → POST import REST route → refresh

### 4.6 UI placement

The current board tab has no action row, so the cleanest low-risk UI is a small
header or utility strip above the board sub-tab content.

Recommendation:

- add a focused child component, for example
  `BoardImportExportControls.tsx`
- render it at the top of the right-side board settings content area
- keep `SettingsPanel.tsx` changes minimal: pass current board ID and callbacks

---

## 5. Testing guidance from existing patterns

### 5.1 Existing test anchors

- `packages/kanban-lite/src/webview/components/SettingsPanel.test.tsx:633-707`
  already asserts board settings markup.
- `packages/kanban-lite/e2e/standalone.board-settings.spec.ts:42-102`
  already drives the board settings routes and validates `.kanban.json`
  persistence.
- `packages/kanban-lite/src/standalone/messageHandlers/board-dispatch.test.ts:16-68`
  already covers board-related webview message handling with mocked SDK calls.
- `packages/kanban-lite/src/extension/KanbanPanel.test.ts:901-944`
  already covers host-side `openFile` / `downloadCard` behavior.

### 5.2 Recommended tests to add

1. **SDK unit tests**
   - export includes board config + labels + forms + hook-related config
   - import persists those sections correctly
   - invalid `kind` / `version` rejects
   - duplicate board ID rejects

2. **Webview markup test**
   - board settings tab renders `Export board` / `Import board` controls

3. **Extension host unit tests**
   - export uses `showSaveDialog` + `workspace.fs.writeFile`
   - import uses `showOpenDialog` + `workspace.fs.readFile`
   - both paths refresh webview state after successful import

4. **Standalone route or shim tests**
   - export route returns JSON payload
   - import route applies config and triggers refresh/broadcast

5. **Playwright E2E**
   - export current board settings to JSON
   - import into a fresh scenario/workspace
   - verify actions/title/meta/defaults/labels are restored in `.kanban.json`

---

## 6. External implementation references

### 6.1 VS Code host file workflow

From VS Code API research:

- webviews post only JSON-serializable messages
- `window.showSaveDialog()` is the supported save-file flow
- `workspace.fs.writeFile()` writes bytes to the selected URI

Confirmed usage pattern already exists in this repo:

```ts
const saveUri = await vscode.window.showSaveDialog({ ... })
if (saveUri) {
  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(json, 'utf8'))
}
```

### 6.2 Browser export workflow

MDN documents JSON download via `Blob` and `URL.createObjectURL()`.

```ts
const blob = new Blob([JSON.stringify(payload, null, 2)], {
  type: 'application/json',
})
const url = URL.createObjectURL(blob)
// attach to <a download>, click, then revoke
URL.revokeObjectURL(url)
```

### 6.3 Browser import workflow

MDN documents hidden file inputs and reading selected files as text.

```ts
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  const text = await file.text()
  const payload = JSON.parse(text)
})
```

---

## 7. Implementation guidance

- Keep the payload versioned (`kind` + numeric `version`) so future upgrades can
  evolve safely.
- Keep import validation fail-closed; do not silently accept malformed JSON.
- Preserve webhook compatibility fields when exporting/importing because the repo
  already maintains both top-level and plugin-backed webhook storage.
- Avoid adding more inline logic to `SettingsPanel.tsx`; extract a new child
  component and any pure helpers.
- Update `README.md` and `CHANGELOG.md` because this is a user-facing feature.
- If SDK JSDoc or REST metadata changes, regenerate source-driven docs instead
  of editing generated docs directly.

## 8. Recommended task breakdown

1. Add shared payload types + SDK export/import helpers.
2. Add standalone REST endpoints and parity CLI/MCP surfaces.
3. Add new webview message types and host-specific file flows.
4. Add board-tab controls in a new TSX child component.
5. Add SDK, host, and E2E tests.
6. Update README / CHANGELOG and regenerate any source-driven docs if needed.

# Changelog

All notable changes to the Kanban Lite extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Card actions**: `actions` field now accepts either an array of action keys (`string[]`) or an object mapping action keys to display titles (`Record<string, string>`). The "Run Action" dropdown shows the title when the object form is used; the action key is always what's sent to the webhook. Fully backward-compatible — existing array-form cards are unchanged.

### Added
- **Card logs**: Append timestamped log entries to any card, stored as a `<cardId>.log` text file auto-added as an attachment. Each entry has timestamp (auto-generated), source label (defaults to `"default"`), markdown text, and optional structured data object (stored as compact JSON). Supports markdown formatting (bold, italic, emoji) in log text.
- **SDK**: `listLogs(cardId, boardId?)`, `addLog(cardId, text, options?, boardId?)`, `clearLogs(cardId, boardId?)` methods on `KanbanSDK`
- **REST API**: `GET /api/tasks/:id/logs`, `POST /api/tasks/:id/logs`, `DELETE /api/tasks/:id/logs`
- **CLI**: `kl log list <id>`, `kl log add <id> --text <msg> [--source <src>] [--object <json>]`, `kl log clear <id>`
- **MCP**: `list_logs`, `add_log`, `clear_logs` tools
- **UI**: Logs tab in card editor with toolbar (clear, limit, order, source filter, show/hide toggles for timestamp/source/objects), YAML-rendered objects
- **Attachments subfolder**: attachments for the markdown storage engine are now stored in an `attachments/` subdirectory inside each column folder (e.g. `.kanban/boards/default/backlog/attachments/`) instead of alongside the card `.md` files
- **Browser-viewable attachments**: PDFs and other binary attachments now open with the OS/browser default viewer in the VS Code extension; the standalone server now serves PDF, JPEG, GIF, WebP, CSV, plain-text, and XML attachments with correct `Content-Type` headers so browsers render them inline in a new tab
- **KanbanSDK.getAttachmentDir(cardId, boardId?)**: new public SDK method that returns the absolute path to the attachment directory for a card (delegates to the active storage engine)
- **Pluggable storage engine**: new `StorageEngine` interface (`src/sdk/storage/types.ts`) decouples all card I/O from the SDK business logic
- **SQLite storage engine**: `SqliteStorageEngine` stores cards and comments in a single `.kanban/kanban.db` file using `better-sqlite3`; config (boards, columns, labels, webhooks) always stays in `.kanban.json`
- **Markdown storage engine**: `MarkdownStorageEngine` wraps the existing file-based I/O, unchanged default behavior
- **Storage engine configuration**: `storageEngine` (`"markdown"` | `"sqlite"`) and `sqlitePath` fields in `.kanban.json`
- **KanbanSDK.migrateToSqlite(dbPath?)**: migrates all markdown cards to SQLite and updates `.kanban.json`
- **KanbanSDK.migrateToMarkdown()**: migrates all SQLite cards back to markdown files and updates `.kanban.json`
- **KanbanSDK.close()**: releases storage engine resources (e.g. closes SQLite DB connection)
- **KanbanSDK.storageEngine** getter: exposes the active `StorageEngine` instance
- **CLI storage commands**: `kl storage status`, `kl storage migrate-to-sqlite [--sqlite-path <path>]`, `kl storage migrate-to-markdown`
- **REST API storage endpoints**: `GET /api/storage`, `POST /api/storage/migrate-to-sqlite`, `POST /api/storage/migrate-to-markdown`; `/api/workspace` now includes `storageEngine` and `sqlitePath`
- **MCP storage tools**: `get_storage_status`, `migrate_to_sqlite`, `migrate_to_markdown`
- **Storage engine tests**: `storage-markdown.test.ts` (10 tests), `storage-sqlite.test.ts` (15 tests), `storage-migration.test.ts` (5 tests)

### Changed
- `src/standalone/server.ts`: chokidar file watcher is skipped when the active storage engine is `sqlite` (no `.md` files to watch)
- **Multi-select cards**: Cmd/Ctrl+click to toggle individual cards, Shift+click to select a range, "Select All" in column menu
- **Bulk actions bar**: floating toolbar when multiple cards are selected with Move to, Priority, Assign, Labels, and Delete actions
- Multi-card drag & drop to move selected cards to another column
- `kl mcp` CLI command — starts the MCP server over stdio, allowing `kanban-lite` to be used as the `command` in MCP client config (e.g. `npx kanban-lite mcp`)

### Changed
- Renamed all internal "Feature" terminology to "Card" across the entire codebase (types, functions, variables, components, CLI, MCP, REST API, extension commands)
- `FeatureCard` component → `CardItem`, `FeatureEditor` → `CardEditor`, `CreateFeatureDialog` → `CreateCardDialog`, `FeatureHeaderProvider` → `CardHeaderProvider`
- `featuresDir` → `kanbanDir` throughout SDK, CLI, standalone server, and MCP server
- `KANBAN_FEATURES_DIR` env var → `KANBAN_DIR` (old name kept as fallback alias)
- VS Code command `kanban-lite.addFeature` → `kanban-lite.addCard`
- Zustand store: `features` → `cards`, `setFeatures` → `setCards`, `addFeature` → `addCard`, etc.
- All WebSocket/extension message types updated (`createFeature` → `createCard`, etc.)

## [2.1.0] - 2026-02-27

### Added
- Board and card detail zoom settings with slider UI (75–150%) stored in `.kanban.json`
- Keyboard shortcuts for adjusting board/card zoom level (Ctrl/Cmd `+`/`-`)
- CSS custom properties (`--board-zoom`, `--card-zoom`) with `calc()` multipliers for smooth font scaling
- Smooth scrolling to the selected feature card in the kanban board
- Sorting options in the column context menu
- Default zoom level configuration for both board and card detail views

## [2.0.0] - 2026-02-26

### Added
- Per-card actions (named string labels) that trigger a global `actionWebhookUrl` via `POST` on demand
- Run Actions dropdown in the card editor and action input in CreateFeatureDialog
- `triggerAction` method in KanbanSDK with full support across REST API, WebSocket, MCP (`trigger_action` tool), and CLI (`--actions` flag)
- Comment editor component with Write / Preview tabs and a markdown formatting toolbar
- GitHub-style comment editing using the new CommentEditor in CommentsSection
- Settings panel split into three tabs: **General**, **Defaults**, and **Labels**
- `version` field on card frontmatter schema for format tracking
- Metadata filtering for card list/search operations across all interfaces
- Creation and modification date display with hover tooltips on FeatureCard and FeatureEditor
- Sort order filter for card queries

### Fixed
- `version` field now included in all FeatureFrontmatter constructions in the server

## [1.9.0] - 2026-02-25

### Added
- Card metadata support — arbitrary key-value data stored as a native YAML block in frontmatter (`metadata` field)
- Metadata UI: key-count chip `{N}` on card grid and collapsible tree view in the card detail panel
- Label definitions with color picker in the Settings panel (create, rename, delete labels)
- Colored labels rendered on cards, in the editor, create dialog, and toolbar
- Label group filtering across SDK (`filterCardsByLabelGroup`), CLI (`--label-group`), REST API, and MCP tools
- SDK label management methods: `getLabels`, `setLabel`, `renameLabel`, `deleteLabel`
- Soft-delete support: hidden **Deleted** column with per-card restore or permanent delete
- Purge deleted cards functionality to permanently remove all soft-deleted cards
- `--metadata` flag for CLI `create` and `edit` commands (accepts JSON string)
- Metadata support in MCP `create_card` and `update_card` tools
- Metadata support in REST API create/update routes
- Workspace info section in the Settings panel showing project path and `.kanban.json` parameters
- `js-yaml` dependency for robust YAML metadata parsing

### Fixed
- Comment parser no longer breaks on horizontal rules (`---`) inside comment blocks
- Blank lines in metadata YAML parsed correctly; scalar edge cases handled

## [1.8.0] - 2026-02-24

### Added
- Multi-board support: board selector dropdown to switch between boards and create new boards
- Card transfer between boards via a StatusDropdown with a nested board-and-column tree
- `transferCard` message type and `BoardInfo.columns` field in the extension/standalone protocol
- Webhooks system: CRUD operations (`create`, `get`, `update`, `delete`, `list`) stored in `.kanban-webhooks.json`
- Webhook event delivery on card create/update/delete/move with configurable `url`, `events`, and `secret`
- Webhook management commands in CLI and MCP server
- Comments functionality: add, edit, and delete comments on feature cards
- Markdown rendering for comment content
- Auto-generated SDK docs (`docs/sdk.md`) and REST API docs (`docs/api.md`) from JSDoc / route metadata
- `npm run docs` script to regenerate all documentation
- Theme toggle (light / dark) in the board toolbar
- Release scripts for versioning, changelog generation, and GitHub release creation

### Fixed
- SDK export paths updated to support both CommonJS and ESM module formats
- SDK import paths corrected; server feature loading logic improved

## [1.7.0] - 2026-02-20

### Added
- Settings button in the toolbar to quickly open extension settings
- Markdown editor mode for opening features in the native VS Code editor
- Kanban skill installation instructions to README

### Changed
- Replaced PNG icons with SVG versions for better quality and smaller file size

## [1.6.4] - 2026-02-20

### Changed
- Added new SVG icon and updated PNG icon

## [1.6.3] - 2026-02-19

### Added
- Allow saving features without a title (falls back to description)

### Fixed
- Activity bar incorrectly opening on ALT key press

## [1.6.2] - 2026-02-19

### Fixed
- Removed incorrect `fontSize` configuration from KanbanPanel

## [1.6.1] - 2026-02-19

### Fixed
- Focus must leave the webview before `focusMenuBar` works (VS Code limitation)

## [1.6.0] - 2026-02-14

### Added
- Undo delete functionality with a stack-based history
- Rich text editor in the CreateFeatureDialog

## [1.5.0] - 2026-02-14

### Added
- Keyboard shortcut for saving and closing the CreateFeatureDialog

## [1.4.0] - 2026-02-14

### Added
- File name display on cards with a toggle setting

## [1.3.0] - 2026-02-13

### Added
- Automatic cleanup of empty old status folders during board updates
- CONTRIBUTING.md guide for new contributors

## [1.2.0] - 2026-02-13

### Added
- `completedAt` frontmatter field that records when a feature was marked as done, displayed as relative time on cards (e.g. "completed 2 days ago")

### Changed
- Simplified status subfolders to use only a `done` folder instead of per-status folders

### Dependencies
- Bumped `qs` from 6.14.1 to 6.14.2

## [1.1.0] - 2026-02-13

### Added
- Open file button in editor to quickly jump to the underlying markdown file ([#19](https://github.com/LachyFS/kanban-lite/issues/19))
- External change detection in editor — reloads content when the file is modified outside the extension ([#19](https://github.com/LachyFS/kanban-lite/issues/19))

### Fixed
- CRLF line endings no longer break markdown frontmatter parsing ([#20](https://github.com/LachyFS/kanban-lite/issues/20))
- Order collisions when deleting features in KanbanPanel ([0f11a00](https://github.com/LachyFS/kanban-lite/commit/0f11a00))

### Changed
- Removed delete button from feature cards for a cleaner card layout ([086e738](https://github.com/LachyFS/kanban-lite/commit/086e738))

### Thanks
- [@hodanli](https://github.com/hodanli) for requesting the open file button and external change detection ([#19](https://github.com/LachyFS/kanban-lite/issues/19)), and reporting the CRLF line ending bug ([#20](https://github.com/LachyFS/kanban-lite/issues/20))

## [1.0.0] - 2026-02-12

### Added
- Sidebar view for Kanban board in the activity bar ([#9](https://github.com/LachyFS/kanban-lite/issues/9))
- Drag-and-drop card reordering within columns ([#16](https://github.com/LachyFS/kanban-lite/issues/16))
- Label management with suggestions in CreateFeatureDialog and FeatureEditor ([#4](https://github.com/LachyFS/kanban-lite/issues/4))
- `showLabels` setting to toggle label visibility on cards and in editors
- Assignee input with suggestions in feature creation and editing
- Due date and label fields in feature creation dialog
- "Build with AI" feature toggle (`showBuildWithAI` setting) that respects `disableAIFeatures` ([#5](https://github.com/LachyFS/kanban-lite/issues/5))
- Status subfolders support with automatic migration of existing feature files ([#3](https://github.com/LachyFS/kanban-lite/issues/3))
- Auto-save functionality in FeatureEditor

### Fixed
- Broken label selector in edit view
- `n` hotkey no longer triggers when modifier keys are held ([#7](https://github.com/LachyFS/kanban-lite/issues/7))
- Alt key no longer blocked from opening the menu bar ([#8](https://github.com/LachyFS/kanban-lite/issues/8))
- Missing activation event for sidebar webview ([#14](https://github.com/LachyFS/kanban-lite/issues/14))
- Date selection no longer rendered off-screen ([#10](https://github.com/LachyFS/kanban-lite/issues/10))
- Input handling now correctly ignores contentEditable elements
- Due date hidden on cards with "done" status ([#17](https://github.com/LachyFS/kanban-lite/issues/17))

### Changed
- Removed QuickAdd functionality in favor of the full CreateFeatureDialog
- Consistent card height across all columns
- Replaced `Buffer` with `TextEncoder` for file writing (browser compatibility)
- Replaced Node `fs` module with `vscode.workspace.fs` for file operations (virtual filesystem support)

### Thanks
- [@ungive](https://github.com/ungive) for requesting the sidebar view ([#9](https://github.com/LachyFS/kanban-lite/issues/9)) and card reordering ([#16](https://github.com/LachyFS/kanban-lite/issues/16)), and reporting numerous bugs around hotkeys ([#7](https://github.com/LachyFS/kanban-lite/issues/7)), activation ([#14](https://github.com/LachyFS/kanban-lite/issues/14)), date rendering ([#10](https://github.com/LachyFS/kanban-lite/issues/10), [#17](https://github.com/LachyFS/kanban-lite/issues/17)), and the menu bar ([#8](https://github.com/LachyFS/kanban-lite/issues/8))
- [@hodanli](https://github.com/hodanli) for requesting label management from the UI ([#4](https://github.com/LachyFS/kanban-lite/issues/4)) and status subfolders for done items ([#3](https://github.com/LachyFS/kanban-lite/issues/3))

## [0.1.6] - 2026-02-09

### Added
- Live settings updates: webview now instantly reflects VS Code setting changes without reopening
- Configuration change listener for KanbanPanel (columns, display settings, defaults)
- Configuration change listener for FeatureHeaderProvider (features directory re-evaluation)

### Fixed
- File watcher now properly disposes when features directory setting changes

## [0.1.5] - 2026-02-09

### Fixed
- VS Code configuration settings (columns, priority badges, assignee, due date, compact mode, default priority/status) now correctly propagate to the webview ([#2](https://github.com/LachyFS/kanban-lite/issues/2))
- Quick add input uses configured default priority instead of hardcoded value
- Create feature dialog uses configured default priority and status

### Changed
- Removed obsolete macOS entitlements and icon files from the build directory

### Thanks
- [@hodanli](https://github.com/hodanli) for reporting the priority badges settings bug ([#2](https://github.com/LachyFS/kanban-lite/issues/2))

## [0.1.4] - 2026-01-29

### Added
- Pressing `enter` in the title input field moves cursor to the description textarea, `shift-enter` creates a new line

### Fixed
- Prevent opening new feature panel when editing an existing feature with `n` hotkey
- Use `resourceLangId` instead of hardcoded path for kanban-lite command ([#1](https://github.com/LachyFS/kanban-lite/issues/1))
- Remove hardcoded devtool resource path for `editor/title/run` menu item ([#1](https://github.com/LachyFS/kanban-lite/issues/1))
- Removed redundant tile heading in edit view UI, (title is already visible in markdown editor)

### Thanks
- [@SuperbDotHub](https://github.com/SuperbDotHub) for reporting the features directory path bug ([#1](https://github.com/LachyFS/kanban-lite/issues/1))

## [0.1.1] - 2026-01-28

### Added
- AI agent integration for starting feature creation with Claude, Codex, or OpenCode
- Keyboard shortcuts for AI actions
- Configurable kanban columns with custom colors
- Priority badges, assignee, and due date display options
- Compact mode setting for feature cards
- Marketplace publishing support (VS Code + Open VSX)

### Changed
- Updated repository URLs to reflect new ownership
- Replaced SVG icons with PNG formats for better compatibility
- Enhanced README with installation instructions and images

## [0.1.0] - 2026-01-27

### Added
- Initial release
- Kanban board view for managing features as markdown files
- Drag-and-drop between columns (Backlog, To Do, In Progress, Review, Done)
- Feature cards with frontmatter metadata (status, priority, assignee, due date)
- Create, edit, and delete features from the board
- Configurable features directory
- Rich markdown editor with Tiptap
- VS Code webview integration

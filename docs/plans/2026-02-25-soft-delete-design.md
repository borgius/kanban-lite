# Soft Delete with Hidden "Deleted" Column

## Summary

Replace permanent card deletion with soft-delete. The delete button moves cards to a hidden "Deleted" column (status `deleted`). Only explicitly "permanently deleting" from the Deleted column removes the file from disk. A new setting toggle controls visibility of the Deleted column.

## Approach

**Approach 1 (chosen):** `deleted` is a reserved status ID. Cards with status `deleted` live in `.kanban/{board}/deleted/` like any other status subfolder. The Deleted column is not part of the board's `columns` array — it is rendered as a special system column appended after all user columns, controlled by a `showDeletedColumn` boolean setting.

Alternatives considered:
- Adding a `system` flag to `KanbanColumn` type (rejected: type change + migration + guards everywhere)
- Separate `.trash/` storage (rejected: duplicates card infrastructure)

## Data Layer (SDK + Config)

### Config Changes

- New field `showDeletedColumn: boolean` on `KanbanConfig` (default: `false`)
- Exposed via `CardDisplaySettings` so the settings panel toggle controls it
- `DELETED_COLUMN_ID = 'deleted'` constant

### SDK Changes

- `deleteCard(cardId, boardId)` — changes from `fs.unlink()` to `updateCard(id, { status: 'deleted' })`
- New `permanentlyDeleteCard(cardId, boardId)` — performs `fs.unlink()`, emits `task.deleted` event
- `removeColumn()` — rejects removing the `deleted` column
- `addColumn()` — rejects creating a column with id `deleted`
- `listCards()` — returns all cards including deleted. Filtering is the caller's responsibility.

### Filesystem

Cards in deleted status live at `.kanban/{board}/deleted/*.md` — same as any other status subfolder. No special storage.

## UI Layer (Webview)

### Board Rendering

- After all user columns, if `showDeletedColumn` is enabled, append a "Deleted" column with:
  - Gray color (`#991b1b` or similar muted red)
  - Trash icon in header
  - No edit/remove/add-card buttons
  - Card count badge

### Delete Button (FeatureEditor)

- Changes label from "Delete" to "Move to Deleted" (or similar)
- Calls soft-delete (move to `deleted` status)
- No undo toast needed — card is just in another column
- Remove existing undo toast mechanism for this action

### Cards in Deleted Column

- **Restore button** — moves card to the board's `defaultStatus` column
- **Permanent delete button** — shows confirmation dialog: "This will permanently delete the card from disk. Are you sure?" Then calls `permanentlyDeleteCard()`

### Drag & Drop

- Cards can be dragged out of the Deleted column into any column (restore)
- Cards can be dragged into the Deleted column from any column (soft delete)

### Settings Panel

- New toggle: "Show Deleted Column" with description "Show the deleted cards column on the board"
- Placed in the "Card Display" section

## CLI / MCP / API Parity

### CLI

- `delete <id>` — soft-deletes (moves to `deleted` status)
- New `permanent-delete <id>` — actually removes from disk
- `list` — excludes deleted by default, add `--include-deleted` flag

### MCP Server

- `delete_card` tool — soft-deletes
- New `permanent_delete_card` tool — removes from disk
- `list_cards` tool — excludes deleted by default, add `includeDeleted` parameter

### Standalone API

- `DELETE /api/cards/:id` — soft-deletes
- New `DELETE /api/cards/:id/permanent` — removes from disk
- `GET /api/cards` — excludes deleted by default, add `?includeDeleted=true` query param

## Events

- Soft delete emits `task.updated` (status change to `deleted`)
- Permanent delete emits `task.deleted` (existing event)
- Restore emits `task.updated` (status change from `deleted` to target)

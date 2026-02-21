# Move Config to .kanban.json

## Summary

Move all kanban board configuration from VSCode settings (`contributes.configuration`) to a dedicated `.kanban.json` file at the project root. Auto-create the file with full defaults on first settings change.

## File Format

`.kanban.json` at workspace root:

```json
{
  "featuresDirectory": ".kanban",
  "defaultPriority": "medium",
  "defaultStatus": "backlog",
  "columns": [
    { "id": "backlog", "name": "Backlog", "color": "#6b7280" },
    { "id": "todo", "name": "To Do", "color": "#3b82f6" },
    { "id": "in-progress", "name": "In Progress", "color": "#f59e0b" },
    { "id": "review", "name": "Review", "color": "#8b5cf6" },
    { "id": "done", "name": "Done", "color": "#22c55e" }
  ],
  "aiAgent": "claude",
  "showPriorityBadges": true,
  "showAssignee": true,
  "showDueDate": true,
  "showLabels": true,
  "showBuildWithAI": true,
  "showFileName": false,
  "compactMode": false,
  "markdownEditorMode": false
}
```

## Architecture

### New: `src/shared/config.ts`

Centralized config module shared by extension and standalone:

- `KanbanConfig` interface matching JSON shape
- `DEFAULT_CONFIG` constant with all defaults
- `readConfig(dir: string)` — reads `.kanban.json`, merges with defaults
- `writeConfig(dir: string, config: KanbanConfig)` — writes full config
- `configPath(dir: string)` — returns the `.kanban.json` path

### Changes

**`package.json`** — Remove `contributes.configuration` section entirely.

**`src/extension/KanbanPanel.ts`**:
- Replace `getConfiguration('kanban-lite')` with `readConfig(workspaceRoot)`
- Replace `_updateConfig()` / `_saveSettings()` with `writeConfig()`
- Replace `onDidChangeConfiguration` with `vscode.workspace.createFileSystemWatcher` on `.kanban.json`

**`src/extension/SidebarViewProvider.ts`**:
- Use `readConfig()` instead of `getConfiguration()`
- Watch `.kanban.json` for changes

**`src/extension/FeatureHeaderProvider.ts`**:
- Read `featuresDirectory` from `readConfig()`

**`src/extension/index.ts`**:
- Read `featuresDirectory` from `readConfig()` at activation

**`src/standalone/server.ts`**:
- Replace custom `.kanban-settings.json` with shared `readConfig()`/`writeConfig()`
- Settings file moves from `.kanban/.kanban-settings.json` to `.kanban.json` at project root

### Auto-create Behavior

1. On activation, `readConfig()` returns defaults if no `.kanban.json` exists (no file created)
2. On first settings save, `writeConfig()` creates `.kanban.json` with ALL settings
3. File watcher detects external edits and refreshes the board

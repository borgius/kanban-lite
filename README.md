# Kanban Lite

A VSCode/Cursor extension that brings a full-featured kanban board directly into your editor. Features are stored as human-readable markdown files, making them version-controllable and easy to edit outside the board.

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/borgius.kanban-lite?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=borgius.kanban-lite)
[![Open VSX](https://img.shields.io/open-vsx/v/borgius/kanban-lite?label=Open%20VSX&logo=vscodium)](https://open-vsx.org/extension/borgius/kanban-lite)
![License](https://img.shields.io/badge/license-MIT-green)

![Kanban Board Overview](https://raw.githubusercontent.com/borgius/kanban-lite/main/docs/images/board-overview.png)

## Kanban Skill

Install the kanban skill via [skills.sh](https://skills.sh) to give your AI agent full context of your board and the ability to create, update, and move features directly from the terminal. Works with Claude Code, Codex, OpenCode, and any skills.sh-compatible agent.

```bash
npx skills add https://github.com/borgius/kanban-lite
```

See [SKILL.md](SKILL.md) for the full skill reference covering MCP tools, CLI, and REST API.

## Features

### Kanban Board

- **5-column workflow**: Backlog, To Do, In Progress, Review, Done
- **Sidebar view**: Access the board from the activity bar without opening a panel
- **Drag-and-drop**: Move cards between columns and reorder within columns
- **Split-view editor**: Board on left, inline markdown editor on right
- **Layout toggle**: Switch between horizontal and vertical board layouts
- **Keyboard shortcuts**:
  - `N` - Create new feature
  - `Esc` - Close dialogs
  - `Cmd/Ctrl + Enter` - Submit create dialog
  - `Enter` in title - Move to description field
  - `Shift + Enter` in title - Add new line


### Feature Cards

![Editor View](https://raw.githubusercontent.com/borgius/kanban-lite/main/docs/images/editor-view.png)


- **Priority levels**: Critical, High, Medium, Low (color-coded badges)
- **Assignees**: Assign team members to features
- **Due dates**: Smart formatting (Overdue, Today, Tomorrow, "5d", etc.)
- **Labels**: Tag features with multiple labels (shows up to 3 with "+X more")
- **Auto-generated IDs**: Based on title and timestamp (e.g., `implement-dark-mode-2026-01-29`)
- **Timestamps**: Created and modified dates tracked automatically

### Filtering & Search
- **Full-text search**: Search across content, IDs, assignees, and labels
- **Priority filter**: Show only critical, high, medium, or low items
- **Assignee filter**: Filter by team member or show unassigned items
- **Label filter**: Filter by specific labels
- **Due date filters**: Overdue, due today, due this week, or no due date
- **Clear filters button**: Reset all filters at once

### File Organization
- **Status subfolders**: Features are automatically organized into subfolders by status (with migration of existing files)

### Editor Integration
- Rich text editing with Tiptap markdown editor
- Inline frontmatter editing (dropdowns for status/priority, inputs for assignee/due date/labels)
- Auto-save functionality
- Live settings updates without reopening the board
- Auto-refresh when files change externally
- Theme integration with VSCode/Cursor (light & dark mode)

### AI Agent Integration
- **Claude Code**: Default, Plan, Auto-edit, and Full Auto modes
- **Codex**: Suggest, Auto-edit, and Full Auto modes
- **OpenCode**: Agent integration support
- AI receives feature context (title, priority, labels, description) for informed assistance

## Installation

### VS Code Marketplace
Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=borgius.kanban-lite) or search for "Kanban Lite" in the Extensions view.

### Open VSX (VSCodium, Cursor, etc.)
Install from [Open VSX](https://open-vsx.org/extension/borgius/kanban-lite) or search for "Kanban Lite" in the Extensions view.

### From VSIX (Manual)
1. Download the `.vsix` file from the releases
2. In VSCode: Extensions > `...` > Install from VSIX
3. Select the downloaded file

## Usage

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **"Open Kanban Board"**
3. Start creating and managing features

Features are stored as markdown files in `.kanban/` within your workspace, organized into status subfolders:

```markdown
---
id: "implement-dark-mode-toggle-2026-01-25"
status: "todo"
priority: "high"
assignee: "john"
dueDate: "2026-01-25"
created: "2026-01-25T10:30:00.000Z"
modified: "2026-01-25T14:20:00.000Z"
labels: ["feature", "ui"]
order: 0
---

# Implement dark mode toggle

Add a toggle in settings to switch between light and dark themes...
```

## Configuration

Board configuration is stored in `.kanban.json` at your workspace root. This file is shared across all interfaces (VSCode extension, standalone server, CLI).

```json
{
  "columns": [
    { "id": "backlog", "name": "Backlog", "color": "#6b7280" },
    { "id": "todo", "name": "To Do", "color": "#3b82f6" },
    { "id": "in-progress", "name": "In Progress", "color": "#f59e0b" },
    { "id": "review", "name": "Review", "color": "#8b5cf6" },
    { "id": "done", "name": "Done", "color": "#22c55e" }
  ],
  "showPriorityBadges": true,
  "showAssignee": true,
  "showDueDate": true,
  "showLabels": true,
  "compactMode": false
}
```

Columns are fully customizable — add, remove, rename, or recolor them from the board UI, CLI, or REST API.

## CLI

Manage your kanban board from the terminal. After installing with `npm install -g kanban-lite`, use `kanban-lite` or the shorthand `kl`:

```bash
# List all cards
kl list

# List with filters
kl list --status todo --priority high

# Create a card
kl add --title "Implement search" --priority high --label "frontend,search"

# Show card details
kl show implement-search

# Move to a different column
kl move implement-search in-progress

# Update fields
kl edit implement-search --assignee alice --due 2026-03-01

# Delete a card
kl delete implement-search

# Attachments
kl attach implement-search                              # List attachments
kl attach add implement-search ./screenshot.png         # Attach a file
kl attach remove implement-search screenshot.png        # Remove attachment

# Manage columns
kl columns                                              # List columns
kl columns add --id testing --name Testing              # Add column
kl columns update testing --color "#ff9900"             # Update column
kl columns remove testing                               # Remove column

# Webhooks
kl webhooks                                             # List webhooks
kl webhooks add --url https://example.com/hook          # Register webhook
kl webhooks add --url https://example.com/hook \
  --events task.created,task.moved --secret mykey       # With event filter and secret
kl webhooks remove wh_abc123                            # Remove webhook

# Settings
kl settings                                             # Show current settings
kl settings update --compactMode true                   # Update a setting

# Workspace
kl pwd                                                  # Print workspace root path

# Start standalone web server
kl serve                                                # Start on port 3000
kl serve --port 8080 --no-browser                       # Custom port, no auto-open

# Initialize features directory
kl init
```

Use `--json` for machine-readable output. Use `--dir <path>` to specify a custom features directory.

## Standalone Server

Run the kanban board as a standalone web application with a full REST API, outside of VSCode:

```bash
# Using the CLI
kl serve

# Or directly
kanban-md

# With options
kanban-md --port 8080 --dir .kanban --no-browser
```

The server provides:
- **Web UI** at `http://localhost:3000` — the same React board as the VSCode extension
- **REST API** at `http://localhost:3000/api` — full programmatic access
- **WebSocket** — real-time updates for connected clients

### REST API

All responses follow the format `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "message" }`. CORS is enabled for all origins.

#### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List all tasks (query: `?status=&priority=&assignee=&label=`) |
| `GET` | `/api/tasks/:id` | Get a single task |
| `POST` | `/api/tasks` | Create a task |
| `PUT` | `/api/tasks/:id` | Update task properties |
| `PATCH` | `/api/tasks/:id/move` | Move task to column/position |
| `DELETE` | `/api/tasks/:id` | Delete a task |

#### Columns

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/columns` | List all columns |
| `POST` | `/api/columns` | Add a column |
| `PUT` | `/api/columns/:id` | Update a column |
| `DELETE` | `/api/columns/:id` | Delete a column |

#### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | Get board settings |
| `PUT` | `/api/settings` | Update board settings |

#### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/webhooks` | List registered webhooks |
| `POST` | `/api/webhooks` | Register a webhook |
| `DELETE` | `/api/webhooks/:id` | Remove a webhook |

#### Workspace

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workspace` | Get workspace root path |

#### Attachments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks/:id/attachments` | Upload attachment(s) |
| `GET` | `/api/tasks/:id/attachments/:filename` | Download an attachment |
| `DELETE` | `/api/tasks/:id/attachments/:filename` | Remove an attachment |

### Example: Create a task via API

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"content": "# My Task\n\nDescription here", "status": "todo", "priority": "high"}'
```

## Webhooks

Register webhooks to receive HTTP POST notifications when tasks or columns change. Webhooks work with both the standalone server and the CLI.

### Events

| Event | Trigger |
|-------|---------|
| `task.created` | A new task is created |
| `task.updated` | Task properties are changed |
| `task.moved` | Task is moved to a different column |
| `task.deleted` | A task is deleted |
| `column.created` | A new column is added |
| `column.updated` | Column name or color is changed |
| `column.deleted` | A column is removed |

### Payload

```json
{
  "event": "task.created",
  "timestamp": "2026-02-21T10:30:00.000Z",
  "data": { "id": "my-task", "status": "todo", "priority": "high", "..." : "..." }
}
```

### Headers

- `Content-Type: application/json`
- `X-Webhook-Event: task.created`
- `X-Webhook-Signature: sha256=<hmac>` (if a secret is configured)

### Register via CLI or API

```bash
# CLI
kl webhooks add --url https://example.com/hook --events task.created,task.moved --secret mykey

# API
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/hook", "events": ["task.created", "task.moved"], "secret": "mykey"}'
```

Webhook registrations are stored in `.kanban-webhooks.json` at the workspace root.

## MCP Server

Expose your kanban board to AI agents (Claude, Cursor, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io/).

### Setup with Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "npx",
      "args": ["kanban-lite", "kanban-mcp"],
      "env": {
        "KANBAN_FEATURES_DIR": "/path/to/your/project/.kanban"
      }
    }
  }
}
```

Or run directly:

```bash
kanban-mcp --dir .kanban
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_cards` | List/filter cards by status, priority, assignee, or label |
| `get_card` | Get full details of a card (supports partial ID matching) |
| `create_card` | Create a new card with title, body, status, priority, etc. |
| `update_card` | Update fields of an existing card |
| `move_card` | Move a card to a different status column |
| `delete_card` | Permanently delete a card |
| `list_attachments` | List attachments on a card |
| `add_attachment` | Attach a file to a card (copies to card directory) |
| `remove_attachment` | Remove an attachment reference from a card |
| `list_columns` | List all board columns |
| `add_column` | Add a new column to the board |
| `update_column` | Update a column's name or color |
| `remove_column` | Remove a column (must be empty) |
| `get_settings` | Get board display settings |
| `update_settings` | Update board display settings |
| `list_webhooks` | List registered webhooks |
| `add_webhook` | Register a new webhook |
| `remove_webhook` | Remove a webhook |
| `get_workspace_info` | Get workspace root path and features directory |

## SDK

Use the kanban SDK programmatically in your own tools:

```typescript
import { KanbanSDK } from 'kanban-lite/dist/sdk'

const sdk = new KanbanSDK('/path/to/.kanban')

// List all cards
const cards = await sdk.listCards()

// Create a card
const card = await sdk.createCard({
  content: '# My Card\n\nDescription here.',
  status: 'todo',
  priority: 'high',
  labels: ['backend']
})

// Move a card
await sdk.moveCard('card-id', 'in-progress')

// Update fields
await sdk.updateCard('card-id', { assignee: 'alice' })

// Delete
await sdk.deleteCard('card-id')

// Attachments
await sdk.addAttachment('card-id', '/path/to/file.png')
await sdk.removeAttachment('card-id', 'file.png')
const attachments = await sdk.listAttachments('card-id')

// Manage columns
const columns = await sdk.listColumns()
await sdk.addColumn({ id: 'testing', name: 'Testing', color: '#ff9900' })
await sdk.updateColumn('testing', { name: 'QA' })
await sdk.removeColumn('testing')
```

## Development

### Prerequisites
- Node.js 18+
- pnpm

### Setup

```bash
# Install dependencies
pnpm install

# Start development (watch mode)
pnpm dev

# Build for production (extension + CLI + MCP server)
pnpm build

# Build individually
pnpm build:extension
pnpm build:cli
pnpm build:mcp

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Debugging

1. Press `F5` in VSCode to launch the Extension Development Host
2. Open the command palette and run "Open Kanban Board"
3. Make changes and reload the window (`Cmd+R`) to see updates

### Tech Stack

**Extension**: TypeScript, VSCode API, esbuild
**Webview**: React 18, Vite, Tailwind CSS, Zustand, Tiptap
**SDK/CLI/MCP**: TypeScript, Node.js, @modelcontextprotocol/sdk

### Architecture

```
src/
  sdk/           # Standalone SDK (no VSCode dependency)
  cli/           # CLI tool (built on SDK)
  mcp-server/    # MCP server (built on SDK)
  extension/     # VSCode extension (uses SDK for parsing)
  standalone/    # Standalone web server (uses SDK for parsing)
  webview/       # React frontend (shared by extension + standalone)
  shared/        # Shared types
```

## Acknowledgments

This project was originally created by [LachyFS](https://github.com/LachyFS). Thank you for building the foundation that made Kanban Lite possible.

## License

MIT

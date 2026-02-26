# Kanban Lite

A lightweight kanban board stored as plain markdown files. Manage your tasks via a **web UI**, **CLI**, **REST API**, or **MCP server** for AI agents. Everything is human-readable, version-controllable, and lives right in your project.

[![npm](https://img.shields.io/npm/v/kanban-lite)](https://www.npmjs.com/package/kanban-lite)
![License](https://img.shields.io/badge/license-MIT-green)

![Kanban Board Overview](https://raw.githubusercontent.com/borgius/kanban-lite/main/docs/images/board-overview.png)

## Kanban Skill

Install the kanban skill via [skills.sh](https://skills.sh) to give your AI agent full context of your board and the ability to create, update, and move features directly from the terminal. Works with Claude Code, Codex, OpenCode, and any skills.sh-compatible agent.

```bash
npx skills add https://github.com/borgius/kanban-lite
```

See [SKILL.md](SKILL.md) for the full skill reference covering MCP tools, CLI, and REST API.

## Quick Start

```bash
# Install globally
npm install -g kanban-lite

# Initialize a board in your project
kl init

# Start the web UI
kl serve

# Or create your first card from the terminal
kl add --title "My first task" --priority high
```

## Features

### Web UI

- **Multi-board support**: Create multiple boards with independent columns and settings
- **5-column workflow**: Backlog, To Do, In Progress, Review, Done (fully customizable per board)
- **Drag-and-drop**: Move cards between columns and reorder within columns
- **Split-view editor**: Board on left, inline markdown editor on right
- **Layout toggle**: Switch between horizontal and vertical board layouts
- **Real-time updates**: WebSocket-powered live sync across clients
- **Light & dark mode** support
- **Keyboard shortcuts**:
  - `N` - Create new feature
  - `Esc` - Close dialogs
  - `Cmd/Ctrl + Enter` - Submit create dialog

### Feature Cards

![Editor View](https://raw.githubusercontent.com/borgius/kanban-lite/main/docs/images/editor-view.png)

- **Priority levels**: Critical, High, Medium, Low (color-coded badges)
- **Assignees**: Assign team members to features
- **Due dates**: Smart formatting (Overdue, Today, Tomorrow, "5d", etc.)
- **Labels**: Tag features with multiple labels
- **Attachments**: Attach files to cards
- **Comments**: Add discussion threads to cards (stored in the same markdown file)
- **Actions**: Attach named triggers to a card (e.g. `retry`, `deploy`, `notify`) and fire them from the UI, CLI, API, or MCP server — calls a configured webhook with the card's full context
- **Auto-generated IDs**: Based on title and timestamp (e.g., `implement-dark-mode-2026-01-29`)
- **Timestamps**: Created and modified dates tracked automatically

### Filtering & Search
- **Full-text search**: Search across content, IDs, assignees, and labels
- **Priority filter**: Show only critical, high, medium, or low items
- **Assignee filter**: Filter by team member or show unassigned items
- **Label filter**: Filter by specific labels
- **Due date filters**: Overdue, due today, due this week, or no due date

### File Organization
- **Plain markdown**: Cards are standard markdown files with YAML frontmatter
- **Status subfolders**: Automatically organized into subfolders by status
- **Git-friendly**: Everything is version-controllable

## Installation

```bash
npm install -g kanban-lite
```

## CLI

Manage your kanban board from the terminal using `kanban-lite` or the shorthand `kl`:

```bash
# List all cards
kl list

# List with filters
kl list --status todo --priority high

# Create a card
kl add --title "Implement search" --priority high --label "frontend,search"

# Create a card with actions
kl add --title "Deploy service" --actions "retry,rollback,notify"

# Show card details
kl show implement-search

# Move to a different column
kl move implement-search in-progress

# Update fields
kl edit implement-search --assignee alice --due 2026-03-01

# Add actions to an existing card
kl edit deploy-service --actions "retry,rollback,notify"

# Trigger an action
kl action trigger deploy-service retry

# Delete a card
kl delete implement-search

# Attachments
kl attach implement-search                              # List attachments
kl attach add implement-search ./screenshot.png         # Attach a file
kl attach remove implement-search screenshot.png        # Remove attachment

# Comments
kl comment implement-search                             # List comments
kl comment add implement-search --author alice \
  --body "Looks good, needs tests"                      # Add a comment
kl comment edit implement-search c1 --body "Updated"    # Edit a comment
kl comment remove implement-search c1                   # Remove a comment

# Boards
kl boards                                               # List boards
kl boards add --id bugs --name "Bug Tracker"            # Create a board
kl boards show bugs                                     # Show board details
kl boards remove bugs                                   # Remove an empty board
kl boards default bugs                                  # Set default board
kl transfer card-42 --from default --to bugs            # Transfer card between boards

# Target a specific board (works with most commands)
kl list --board bugs                                    # List cards in a board
kl add --title "Login bug" --board bugs                 # Create card in a board

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
kl webhooks update wh_abc123 --active false             # Disable a webhook
kl webhooks update wh_abc123 --events task.created      # Change subscribed events
kl webhooks remove wh_abc123                            # Remove webhook

# Settings
kl settings                                             # Show current settings
kl settings update --compactMode true                   # Update a setting

# Workspace
kl pwd                                                  # Print workspace root path

# Start web server
kl serve                                                # Start on port 3000
kl serve --port 8080 --no-browser                       # Custom port, no auto-open

# Initialize features directory
kl init

# Other
kl version                                              # Print version
kl help                                                 # Show help
kl help sdk                                             # Show SDK documentation
kl help api                                             # Show REST API documentation
```

Use `--json` for machine-readable output. Use `--dir <path>` to specify a custom features directory. Use `--board <id>` to target a specific board.

## Standalone Server

Run the kanban board as a web application with a full REST API:

```bash
# Using the CLI
kl serve

# Or directly
kanban-md

# With options
kanban-md --port 8080 --dir .kanban --no-browser
```

The server provides:
- **Web UI** at `http://localhost:3000` — a full React-based kanban board
- **REST API** at `http://localhost:3000/api` — full programmatic access
- **WebSocket** — real-time updates for connected clients

### REST API

All responses follow the format `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "message" }`. CORS is enabled for all origins.

> See the [full REST API documentation](docs/api.md) for detailed endpoint reference, request/response examples, and board-scoped routes.

#### Boards

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/boards` | List all boards |
| `POST` | `/api/boards` | Create a board |
| `GET` | `/api/boards/:boardId` | Get board configuration |
| `PUT` | `/api/boards/:boardId` | Update board configuration |
| `DELETE` | `/api/boards/:boardId` | Delete an empty board |

#### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List all tasks (query: `?status=&priority=&assignee=&label=`) |
| `GET` | `/api/tasks/:id` | Get a single task |
| `POST` | `/api/tasks` | Create a task |
| `PUT` | `/api/tasks/:id` | Update task properties |
| `PATCH` | `/api/tasks/:id/move` | Move task to column/position |
| `DELETE` | `/api/tasks/:id` | Delete a task |

Board-scoped equivalents are available at `/api/boards/:boardId/tasks/...`.

#### Transfer

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/boards/:boardId/tasks/:id/transfer` | Transfer a task to another board |

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
| `PUT` | `/api/webhooks/:id` | Update a webhook |
| `DELETE` | `/api/webhooks/:id` | Remove a webhook |

#### Workspace

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workspace` | Get workspace root path |

#### Comments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks/:id/comments` | List comments on a task |
| `POST` | `/api/tasks/:id/comments` | Add a comment (`{ author, content }`) |
| `PUT` | `/api/tasks/:id/comments/:commentId` | Update a comment (`{ content }`) |
| `DELETE` | `/api/tasks/:id/comments/:commentId` | Delete a comment |

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

Register webhooks to receive HTTP POST notifications when data changes. Webhooks fire from **all interfaces** — REST API, CLI, MCP server, and the web UI — ensuring consistent event delivery regardless of how a mutation is triggered.

> See the [full Webhooks documentation](docs/webhooks.md) for detailed event payloads, signature verification, and delivery behavior.

### Events

| Event | Trigger |
|-------|---------|
| `task.created` | A new task is created |
| `task.updated` | Task properties are changed |
| `task.moved` | Task is moved to a different column or transferred between boards |
| `task.deleted` | A task is deleted |
| `comment.created` | A comment is added to a task |
| `comment.updated` | A comment is edited |
| `comment.deleted` | A comment is removed |
| `column.created` | A new column is added |
| `column.updated` | Column name or color is changed |
| `column.deleted` | A column is removed |
| `attachment.added` | A file is attached to a task |
| `attachment.removed` | An attachment is removed from a task |
| `settings.updated` | Board display settings are changed |
| `board.created` | A new board is created |
| `board.updated` | Board configuration is changed |
| `board.deleted` | A board is deleted |

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

### Manage via CLI or API

```bash
# Register
kl webhooks add --url https://example.com/hook --events task.created,task.moved --secret mykey

# Update
kl webhooks update wh_abc123 --active false
kl webhooks update wh_abc123 --events task.created,task.deleted

# API
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/hook", "events": ["task.created", "task.moved"], "secret": "mykey"}'
```

Webhook registrations are stored in `.kanban.json` at the workspace root and persist across server restarts.

## Card Actions

Actions let you attach named triggers to a card — things like `retry`, `deploy`, `rollback`, or `notify`. When triggered, the system sends an HTTP POST to a single global **action webhook URL** configured in `.kanban.json`, with the action name and the full card context. Your webhook handles the actual work.

### How it works

1. **Configure the webhook URL** in `.kanban.json`:

```json
{
  "actionWebhookUrl": "https://example.com/kanban-actions"
}
```

2. **Add actions to a card** — as a list of simple strings stored in the card's frontmatter:

```yaml
---
id: "42-deploy-v2"
status: "in-progress"
actions: ["retry", "rollback", "notify-slack"]
---
# Deploy v2.0
```

3. **Trigger an action** from any interface:

- **UI**: Open a card in the editor — a "Run Action" dropdown appears in the header when the card has actions. Click to select and fire.
- **CLI**: `kl action trigger <cardId> <action>`
- **REST API**: `POST /api/tasks/:id/actions/:action`
- **SDK**: `await sdk.triggerAction(cardId, action)`
- **MCP**: `trigger_action` tool

### Webhook payload

```json
{
  "action": "notify-slack",
  "board": "default",
  "list": "in-progress",
  "card": {
    "id": "42-deploy-v2",
    "status": "in-progress",
    "priority": "high",
    "assignee": "alice",
    "labels": ["deploy"],
    "content": "# Deploy v2.0\n...",
    "actions": ["retry", "rollback", "notify-slack"]
  }
}
```

The webhook receives the full card object (same shape as the SDK `Feature` type, minus `filePath`). Your server responds with any 2xx status to acknowledge; non-2xx responses are treated as errors.

### Managing actions

Actions are plain strings in the `actions` array of the card's YAML frontmatter. Edit them directly in the markdown file, or use any interface:

```bash
# Add actions when creating a card
kl add --title "Deploy service" --priority high --actions "retry,rollback,notify-slack"

# Update actions on an existing card
kl edit 42 --actions "retry,rollback,notify-slack,promote"

# Trigger
kl action trigger 42 notify-slack
```

```bash
# Via REST API
curl -X POST http://localhost:3000/api/tasks/42/actions/notify-slack

# Create card with actions via API
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"content": "# Deploy v2.0", "status": "todo", "actions": ["retry", "rollback"]}'
```

### Notes

- There is **one global webhook URL** for all actions across all boards. The `action` field in the payload tells your server which action was triggered; the `board` and `list` fields provide context.
- If `actionWebhookUrl` is not set, triggering an action returns an error.
- Actions are **fire-and-forget** — no retry logic or delivery guarantees are built in. Implement idempotency and retries in your own webhook handler if needed.
- Action strings have no special meaning to Kanban Lite; you define the vocabulary.

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
| `list_boards` | List all boards in the workspace |
| `create_board` | Create a new board with optional custom columns |
| `get_board` | Get board configuration and details |
| `delete_board` | Delete an empty board |
| `transfer_card` | Move a card from one board to another |
| `list_cards` | List/filter cards by status, priority, assignee, or label |
| `get_card` | Get full details of a card (supports partial ID matching) |
| `create_card` | Create a new card with title, body, status, priority, etc. |
| `update_card` | Update fields of an existing card |
| `move_card` | Move a card to a different status column |
| `delete_card` | Permanently delete a card |
| `trigger_action` | Trigger a named action on a card, calling the configured action webhook |
| `list_attachments` | List attachments on a card |
| `add_attachment` | Attach a file to a card (copies to card directory) |
| `remove_attachment` | Remove an attachment reference from a card |
| `list_comments` | List comments on a card |
| `add_comment` | Add a comment to a card |
| `update_comment` | Edit a comment's content |
| `delete_comment` | Remove a comment from a card |
| `list_columns` | List all board columns |
| `add_column` | Add a new column to the board |
| `update_column` | Update a column's name or color |
| `remove_column` | Remove a column (must be empty) |
| `get_settings` | Get board display settings |
| `update_settings` | Update board display settings |
| `list_webhooks` | List registered webhooks |
| `add_webhook` | Register a new webhook |
| `update_webhook` | Update a webhook (url, events, secret, active) |
| `remove_webhook` | Remove a webhook |
| `get_workspace_info` | Get workspace root path and features directory |

All card, column, comment, and attachment tools accept an optional `boardId` parameter to target a specific board.

## SDK

Use the kanban SDK programmatically in your own tools. The `KanbanSDK` class is the single source of truth — the CLI, MCP server, VSCode extension, and standalone server all delegate to it.

```typescript
import { KanbanSDK } from 'kanban-lite/sdk'

const sdk = new KanbanSDK('/path/to/.kanban')

// Boards
const boards = sdk.listBoards()
sdk.createBoard('bugs', 'Bug Tracker', { description: 'Track production bugs' })
await sdk.transferCard('42', 'default', 'bugs')
await sdk.deleteBoard('bugs')

// Cards (all accept optional boardId as last argument)
const cards = await sdk.listCards()
const card = await sdk.createCard({ content: '# My Task', status: 'todo', priority: 'high' })
await sdk.moveCard(card.id, 'in-progress')
await sdk.updateCard(card.id, { assignee: 'alice' })
await sdk.deleteCard(card.id)

// Cards with actions
const deployCard = await sdk.createCard({
  content: '# Deploy v2.0',
  status: 'todo',
  priority: 'high',
  actions: ['retry', 'rollback', 'notify-slack']
})

// Trigger an action (POSTs to the actionWebhookUrl in .kanban.json)
await sdk.triggerAction(deployCard.id, 'notify-slack')

// Add/replace actions on an existing card
await sdk.updateCard(deployCard.id, { actions: ['retry', 'rollback', 'notify-slack', 'promote'] })

// Comments
await sdk.addComment('card-id', 'alice', 'Looks good!')
await sdk.updateComment('card-id', 'c1', 'Updated')
await sdk.deleteComment('card-id', 'c1')

// Attachments
await sdk.addAttachment('card-id', '/path/to/file.png')
await sdk.removeAttachment('card-id', 'file.png')

// Columns
const columns = sdk.listColumns()
sdk.addColumn({ id: 'testing', name: 'Testing', color: '#ff9900' })
sdk.updateColumn('testing', { name: 'QA' })
await sdk.removeColumn('testing')

// Settings
const settings = sdk.getSettings()
sdk.updateSettings({ ...settings, compactMode: true })
```

See the [full SDK documentation](docs/sdk.md) for detailed API reference, types, error handling, and file layout.

## Data Storage

Cards are stored as markdown files with YAML frontmatter in `.kanban/boards/<boardId>/` within your project:

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
actions: ["retry", "notify-slack"]
order: 0
---

# Implement dark mode toggle

Add a toggle in settings to switch between light and dark themes...

---
comment: true
id: "c1"
author: "alice"
created: "2026-01-25T15:00:00.000Z"
---
Should we support system preference detection too?

---
comment: true
id: "c2"
author: "john"
created: "2026-01-25T15:30:00.000Z"
---
Yes, good idea. I'll add that as a follow-up.
```

Comments are stored as additional YAML documents in the same file, keeping everything in one place and version-controllable.

## Configuration

Board configuration is stored in `.kanban.json` at your project root. It supports multiple boards, each with their own columns and settings:

```json
{
  "version": 2,
  "defaultBoard": "default",
  "boards": {
    "default": {
      "name": "Default Board",
      "columns": [
        { "id": "backlog", "name": "Backlog", "color": "#6b7280" },
        { "id": "todo", "name": "To Do", "color": "#3b82f6" },
        { "id": "in-progress", "name": "In Progress", "color": "#f59e0b" },
        { "id": "review", "name": "Review", "color": "#8b5cf6" },
        { "id": "done", "name": "Done", "color": "#22c55e" }
      ],
      "nextCardId": 1,
      "defaultStatus": "backlog",
      "defaultPriority": "medium"
    }
  },
  "showPriorityBadges": true,
  "showAssignee": true,
  "showDueDate": true,
  "showLabels": true,
  "compactMode": false,
  "actionWebhookUrl": "https://example.com/kanban-actions"
}
```

Columns are fully customizable per board — add, remove, rename, or recolor them from the web UI, CLI, or REST API.

## AI Agent Integration
- **Claude Code**: Default, Plan, Auto-edit, and Full Auto modes
- **Codex**: Suggest, Auto-edit, and Full Auto modes
- **OpenCode**: Agent integration support
- AI receives feature context (title, priority, labels, description) for informed assistance

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

# Build for production
pnpm build

# Build individually
pnpm build:cli
pnpm build:mcp
pnpm build:standalone-server

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Tech Stack

**Web UI**: React 18, Vite, Tailwind CSS, Zustand, Tiptap
**SDK/CLI/MCP**: TypeScript, Node.js, @modelcontextprotocol/sdk

### Architecture

```
src/
  sdk/           # Core SDK (no external dependencies)
  cli/           # CLI tool (built on SDK)
  mcp-server/    # MCP server (built on SDK)
  standalone/    # Standalone web server (uses SDK)
  webview/       # React frontend
  shared/        # Shared types
```

## Acknowledgments

This project was originally created by [LachyFS](https://github.com/LachyFS). Thank you for building the foundation that made Kanban Lite possible.

## License

MIT

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

This repo also ships a dedicated `kanban-storage-plugin-author` skill for generating third-party `card.storage` / `attachment.storage` npm packages that can be selected from `.kanban.json`:

```bash
npx skills add https://github.com/borgius/kanban-lite --skill kanban-storage-plugin-author
```

See [`.agents/skills/kanban-storage-plugin-author/SKILL.md`](.agents/skills/kanban-storage-plugin-author/SKILL.md) for the workflow, bundled references, and package templates.

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
- **Dynamic form tabs**: Every attached card form renders as its own tab in the card editor, alongside the built-in markdown, comments, and logs tabs; fields display with consistent spacing and theme-aware styling in both standalone and VS Code webview runtimes
- **Layout toggle**: Switch between horizontal and vertical board layouts
- **Event-driven pub/sub**: SDK events are dispatched through an EventEmitter2-based event bus with wildcard routing, powering webhooks, auth events, and custom subscriptions
- **Real-time updates**: WebSocket-powered live sync across clients
- **Light & dark mode** support
- **Tabbed settings panel**: Settings organized into **General**, **Defaults**, and **Labels** tabs
- **Flexible panel layouts**: Open card details and creation flows as a right-side drawer or a centered popup
- **Adjustable drawer width**: Tune drawer mode between 20–80% of the viewport from the Layout settings
- **Polished card detail view**: Card details now open with a calmer desktop-first split layout, tighter control density, cleaner attachment/comment presentation, and refined popup/drawer styling in both drawer and popup modes
- **Custom board backgrounds**: Choose between simple plain canvases and a richer library of fancy colorful ambient presets from the settings panel, with multiple light/dark-friendly moods for different boards and preferences
- **Zoom controls**: Scale the board view and card detail panel independently between 75–150% via settings sliders or keyboard shortcuts
- **Column sorting**: Sort cards within a column by priority, due date, or creation date from the column menu
- **Column visibility controls**: Minimize a column into a narrow rail with its name and card count from the column menu, or hide/show columns from **Board options → Columns**
- **Smooth scroll to selection**: Board automatically scrolls to the selected card
- **URL-synced standalone navigation**: In standalone mode, the active board, card, tab, filters, search query, and fuzzy mode persist in browser history and deep links
- **Keyboard shortcuts**:
  - `N` - Create new card
  - `Esc` - Close dialogs
  - `Cmd/Ctrl + Enter` - Submit create dialog
  - `Ctrl/Cmd + =` / `Ctrl/Cmd + -` - Zoom board view in / out
  - `Ctrl/Cmd + Shift + =` / `Ctrl/Cmd + Shift + -` - Zoom card detail in / out

### Cards

![Editor View](https://raw.githubusercontent.com/borgius/kanban-lite/main/docs/images/editor-view.png)

- **Priority levels**: Critical, High, Medium, Low (color-coded badges)
- **Assignees**: Assign team members to cards
- **Due dates**: Smart formatting (Overdue, Today, Tomorrow, "5d", etc.)
- **Labels**: Tag cards with multiple labels
- **Attachments**: Attach files to cards
- **Comments**: Add discussion threads to cards (stored in the same markdown file)
- **Logs**: Append timestamped log entries to cards (stored as `<cardId>.log` text file, supports markdown, optional source labels and structured data objects)
- **Actions**: Attach named triggers to a card (e.g. `retry`, `deploy`, `notify`) and fire them from the UI, CLI, API, or MCP server — calls a configured webhook with the card's full context
- **Reusable and inline forms**: Attach named workspace forms from `.kanban.json` or define card-local inline forms directly on the card
- **Per-form saved data**: Each attached form persists its submitted payload separately under `formData[formId]`, so multiple forms on one card do not collide; stored entries may be partial — the full canonical form state is prepared at runtime by merging config defaults, attachment defaults, persisted data, and metadata
- **`${path}` placeholder interpolation**: String values in config defaults, attachment defaults, and persisted form data are resolved against full card context (`${id}`, `${status}`, `${assignee}`, `${metadata.key}`, etc.) before the form tab opens; unresolved placeholders become empty strings
- **Auto-generated IDs**: Based on title and timestamp (e.g., `implement-dark-mode-2026-01-29`)
- **Timestamps**: Created and modified dates tracked automatically

### Filtering & Search
- **Toolbar search with optional fuzzy mode**: Exact search is the default; enable the `Fuzzy` toggle in the web UI to match near-misses across card text and metadata values
- **Metadata token search**: Use `meta.field: value` tokens for field-scoped searches that behave consistently across the web UI, CLI, REST API, and MCP
- **Removable search chips**: Mixed searches are split into separate toolbar chips for plain text and each `meta.*` token, so you can remove one constraint without clearing the whole query
- **Metadata filter buttons**: Click the filter icon next to rendered metadata values in the card detail panel to inject the correct `meta.field: value` token into the shared search box
- **Clickable label filters**: Click a label on a board card or in the card detail panel to immediately filter the board to that label
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

# Exact and fuzzy search
kl list --search "release meta.team: backend"
kl list --search "meta.team: backnd api plumbng" --fuzzy

# Combine fuzzy search with structured metadata filters
kl list --search "release" --fuzzy --meta sprint=Q1 --meta links.jira=PROJ-123

# Create a card
kl add --title "Implement search" --priority high --label "frontend,search"

# Create a card with actions
kl add --title "Deploy service" --actions "retry,rollback,notify"

# Create a card with attached forms
kl add --title "Investigate outage" --forms '[{"name":"incident-report"}]'

# Update form attachments or persisted per-form data
kl edit investigate-outage --forms @forms.json --form-data @form-data.json

# Show card details
kl show implement-search

# Show the currently active/open card
kl active

# Move to a different column
kl move implement-search in-progress

# Update fields
kl edit implement-search --assignee alice --due 2026-03-01

# Add actions to an existing card
kl edit deploy-service --actions "retry,rollback,notify"

# Trigger an action
kl action trigger deploy-service retry

# Submit a card form payload
kl form submit investigate-outage incident-report --data '{"severity":"high","owner":"alice"}'

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

# Logs
kl log list implement-search                             # List log entries
kl log add implement-search --text "Build passed"         # Add a log entry
kl log add implement-search --text "Deployed" \
  --source ci --object '{"version":"1.0"}'               # With source and data
kl log clear implement-search                            # Clear all logs

# Board Logs
kl board-log list                                        # List board-level log entries
kl board-log add --text "Deployment complete"            # Add a board log entry
kl board-log add --text "Pipeline passed" \
  --source ci --object '{"build":"42"}'                    # With source and data
kl board-log clear                                       # Clear all board logs

# Board Actions
kl board-actions list --board default                    # List board-level actions
kl board-actions add --board default \
  --key deploy --title "Deploy to Production"            # Add/update a board action
kl board-actions fire --board default deploy             # Trigger a board action

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

# Storage providers
kl storage status                                       # Show current provider + capability status
kl storage migrate-to-sqlite --sqlite-path .kanban/kanban.db  # Migrate to SQLite
kl storage migrate-to-markdown                          # Migrate back to markdown

# Start web server
kl serve                                                # Start on port 3000
kl serve --port 8080 --no-browser                       # Custom port, no auto-open

# Start MCP server (stdio transport for AI agent integrations)
kl mcp                                                  # Auto-detect directory
kl mcp --dir .kanban                                    # Explicit directory

# Initialize features directory
kl init

# Other
kl version                                              # Print version
kl help                                                 # Show help
kl help sdk                                             # Show SDK documentation
kl help api                                             # Show REST API documentation
```

Use `--json` for machine-readable output. Use `--dir <path>` to specify a custom features directory. Use `--board <id>` to target a specific board.

`--forms` accepts a JSON array of attached form descriptors, and `--form-data` accepts a JSON object keyed by resolved form id. Both flags also support `@path/to/file.json`.

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

> In standalone/browser mode, the app automatically retries same-page backend reconnects when possible after the connection drops. If reconnect cannot be restored, the UI shows an in-app connection-lost error with guidance to refresh or reopen the standalone page.

### REST API

All responses follow the format `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "message" }`. CORS is enabled for all origins.

> The REST API source of truth is the standalone Swagger/OpenAPI spec. Browse the interactive docs at `http://localhost:3000/api/docs`, the raw OpenAPI JSON at `http://localhost:3000/api/docs/json`, or the generated repo copy at [docs/api.md](docs/api.md).

#### Boards

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/boards` | List all boards |
| `POST` | `/api/boards` | Create a board |
| `GET` | `/api/boards/:boardId` | Get board configuration |
| `PUT` | `/api/boards/:boardId` | Update board configuration |
| `DELETE` | `/api/boards/:boardId` | Delete an empty board |

#### Board Actions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/boards/:boardId/actions` | List named board actions |
| `POST` | `/api/boards/:boardId/actions` | Replace the board action map |
| `PUT` | `/api/boards/:boardId/actions/:key` | Add or update a single board action title |
| `DELETE` | `/api/boards/:boardId/actions/:key` | Remove a named board action |
| `POST` | `/api/boards/:boardId/actions/:key/trigger` | Trigger a board action webhook event |

#### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List all tasks (query: `?q=&fuzzy=&meta.<field>=&status=&priority=&assignee=&label=`) |
| `GET` | `/api/tasks/active` | Get the currently active/open task |
| `GET` | `/api/tasks/:id` | Get a single task |
| `POST` | `/api/tasks` | Create a task, including optional `forms` and `formData` |
| `PUT` | `/api/tasks/:id` | Update task properties, including `forms` and `formData` |
| `POST` | `/api/tasks/:id/forms/:formId/submit` | Validate and submit a card form payload |
| `PATCH` | `/api/tasks/:id/move` | Move task to column/position |
| `DELETE` | `/api/tasks/:id` | Delete a task |

Board-scoped equivalents are available at `/api/boards/:boardId/tasks/...`, including `POST /api/boards/:boardId/tasks/:id/forms/:formId/submit`.

`q` is the free-text search input, `fuzzy=true` enables typo-tolerant matching, and `meta.<field>=value` keeps metadata filtering field-scoped. The same search semantics are shared with `kl list --search ... --fuzzy` and the MCP `list_cards` tool.

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
| `GET` | `/api/workspace` | Get workspace root path plus active storage, auth, and webhook provider metadata |
| `GET` | `/api/storage` | Get current card, attachment, and webhook provider status |
| `POST` | `/api/storage/migrate-to-sqlite` | Migrate cards to SQLite (`{ sqlitePath? }`) |
| `POST` | `/api/storage/migrate-to-markdown` | Migrate cards back to markdown files |

#### Comments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks/:id/comments` | List comments on a task |
| `POST` | `/api/tasks/:id/comments` | Add a comment (`{ author, content }`) |
| `PUT` | `/api/tasks/:id/comments/:commentId` | Update a comment (`{ content }`) |
| `DELETE` | `/api/tasks/:id/comments/:commentId` | Delete a comment |

#### Logs

| Method | Endpoint | Description |
|--------|----------|--------------|
| `GET` | `/api/tasks/:id/logs` | List log entries on a card |
| `POST` | `/api/tasks/:id/logs` | Add a log entry (`{ text, source?, object?, timestamp? }`) |
| `DELETE` | `/api/tasks/:id/logs` | Clear all log entries |

#### Board Logs

| Method | Endpoint | Description |
|--------|----------|--------------|
| `GET` | `/api/boards/:boardId/logs` | List board-level log entries |
| `POST` | `/api/boards/:boardId/logs` | Add a board log entry (`{ text, source?, object?, timestamp? }`) |
| `DELETE` | `/api/boards/:boardId/logs` | Clear all board log entries |

#### Attachments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks/:id/attachments` | Upload attachment(s) |
| `GET` | `/api/tasks/:id/attachments/:filename` | Download an attachment |
| `DELETE` | `/api/tasks/:id/attachments/:filename` | Remove an attachment |

### Local MinIO attachment plugin setup

For local development in this repo, the published `kl-s3-attachment-storage` package is installed and can be used as the default `attachment.storage` provider against MinIO.

- local runtime settings live in a workspace `.env`
- local provider selection lives in the workspace `.kanban.json`
- the default local card provider stays on markdown

Local defaults used by the repo:

- endpoint: `http://127.0.0.1:9000`
- console: `http://127.0.0.1:9001`
- bucket: `kanban-local`
- credentials: `minioadmin` / `minioadmin`

Try it locally:

```bash
npm run minio:up
npm run test:integration:minio
```

> Note: the S3 attachment plugin still does not expose a stable local attachment directory, but card log files now flow through the attachment capability itself, so MinIO-backed log attachments work too.

For providers that support efficient in-place appends, `attachment.storage` plugins may also expose an optional append hook. The SDK uses that hook for card logs when available and falls back to a safe read/modify/write update when it is not.

### Example: Create a task via API

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Investigate outage\n\nCollect incident details.",
    "status": "todo",
    "priority": "high",
    "forms": [{"name": "incident-report"}],
    "formData": {"incident-report": {"service": "billing"}}
  }'
```

### Example: Update a task's attached forms via API

```bash
curl -X PUT http://localhost:3000/api/tasks/investigate-outage \
  -H "Content-Type: application/json" \
  -d '{
    "forms": [
      {"name": "incident-report"},
      {
        "schema": {
          "type": "object",
          "title": "Postmortem",
          "properties": {
            "summary": {"type": "string"}
          }
        },
        "data": {"summary": "Initial draft"}
      }
    ]
  }'
```

### Example: Submit a task form via API

```bash
curl -X POST http://localhost:3000/api/tasks/investigate-outage/forms/incident-report/submit \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "severity": "critical",
      "owner": "alice"
    }
  }'
```

### Example: Search tasks via API

```bash
curl "http://localhost:3000/api/tasks?q=release&fuzzy=true&meta.team=backend"
curl "http://localhost:3000/api/boards/bugs/tasks?q=meta.team%3A%20backnd&fuzzy=true&meta.region=us-east"
```

## Webhooks

Register webhooks to receive HTTP POST notifications when data changes. Webhooks fire from **all interfaces** — REST API, CLI, MCP server, and the web UI — ensuring consistent event delivery regardless of how a mutation is triggered.

> See the [full Webhooks documentation](docs/webhooks.md) for detailed event payloads, signature verification, and delivery behavior.

### Install and compatibility

Webhook CRUD and runtime delivery now resolve through the external `kl-webhooks-plugin` package via the `webhook.delivery` provider id `webhooks`.

- Install it in the same environment that runs Kanban Lite (CLI, standalone server, MCP server, extension host, or SDK consumer).
- Existing `.kanban.json` webhook registrations stay in the top-level `webhooks` array; no migration is required.
- If `webhookPlugin` is omitted, runtime normalization still defaults to `{ "webhook.delivery": { "provider": "webhooks" } }`.
- While the package is not installed, Kanban Lite keeps a built-in compatibility fallback for webhook CRUD and delivery so existing workspaces continue to function.

```bash
npm install kl-webhooks-plugin
```

For local sibling-repo development, a checkout at `../kl-webhooks-plugin` is resolved automatically. `npm link ../kl-webhooks-plugin` is optional, but still useful when you want an explicit local package link.

```json
{
  "webhookPlugin": {
    "webhook.delivery": {
      "provider": "webhooks"
    }
  },
  "webhooks": [
    {
      "id": "wh_a1b2c3d4e5f6",
      "url": "https://example.com/hook",
      "events": ["task.created", "task.updated"],
      "active": true
    }
  ]
}
```

All webhook CRUD surfaces still delegate to the same SDK methods:

- SDK: `sdk.listWebhooks()`, `sdk.createWebhook()`, `sdk.updateWebhook()`, `sdk.deleteWebhook()`, `sdk.getWebhookStatus()`
- REST API: `/api/webhooks`
- CLI: `kl webhooks`, `kl webhooks add`, `kl webhooks update`, `kl webhooks remove`
- MCP: `list_webhooks`, `add_webhook`, `update_webhook`, `remove_webhook`

### Events

| Event | Trigger |
|-------|---------|
| `task.created` | A new task is created |
| `form.submit` | A card form payload is validated, persisted, and submitted |
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
| `board.action` | A board-level action is triggered from the toolbar, CLI, REST API, or MCP |

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

## Card Forms

Forms let you attach structured JSON Schema-driven workflows directly to cards. Each attachment becomes its own tab in the webview card editor, is validated with the SDK-owned rules, and can be submitted from the UI, CLI, REST API, SDK, or MCP.

### Define reusable workspace forms

Declare named reusable forms in `.kanban.json` under the top-level `forms` map:

```json
{
  "forms": {
    "incident-report": {
      "schema": {
        "type": "object",
        "title": "Incident Report",
        "properties": {
          "severity": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
          "owner": { "type": "string" },
          "service": { "type": "string" }
        },
        "required": ["severity", "owner"]
      },
      "ui": {
        "type": "VerticalLayout",
        "elements": [
          { "type": "Control", "scope": "#/properties/severity" },
          { "type": "Control", "scope": "#/properties/owner" },
          { "type": "Control", "scope": "#/properties/service" }
        ]
      },
      "data": {
        "severity": "medium"
      }
    }
  }
}
```

### Attach forms to cards

Cards can attach reusable named forms or inline card-local definitions in frontmatter:

```yaml
forms:
  - name: incident-report
  - schema:
      type: object
      title: Postmortem
      properties:
        summary:
          type: string
    data:
      summary: Initial draft
formData:
  incident-report:
    service: billing
```

### Merge order and submit behavior

For every attached form, the resolved payload is built in this order, from lowest to highest priority:

1. Workspace form defaults from `.kanban.json` (`forms.<name>.data`)
2. Card-scoped attachment defaults, then previously persisted `formData[formId]`
3. Card metadata fields whose keys exist in the form schema
4. The submitted payload

The SDK validates that final payload before persistence and before any `form.submit` webhook fires.
After a successful submission, Kanban Lite also appends a card log entry containing the submitted payload for traceability.

### Webview behavior

- Every attached form renders as an extra tab in the card editor.
- Tabs are stable and deep-linkable in standalone mode using `form:<resolved-id>` tab ids.
- Tab labels use the resolved display name and render as `form: <Form Name>`.
- Shared config forms show a **Shared** badge in the tab content.
- Shared config forms may define `name` (default: capitalized form key) and `description` (default: empty string) in `.kanban.json`.
- Submit stays disabled until validation passes, and successful submissions update the card's saved `formData`.
- Successful submissions also append a system card log whose JSON object includes `formId`, `formName`, and the submitted `payload`.

### Programmatic submission surfaces

- **SDK**: `await sdk.submitForm({ cardId, formId, data, boardId? })`
- **CLI**: `kl form submit <cardId> <formId> --data '<json|@file>'`
- **REST API**: `POST /api/tasks/:id/forms/:formId/submit`
- **Board-scoped REST API**: `POST /api/boards/:boardId/tasks/:id/forms/:formId/submit`
- **MCP**: `submit_card_form`

## Card Actions

Actions let you attach named triggers to a card — things like `retry`, `deploy`, `rollback`, or `notify`. When triggered, the system sends an HTTP POST to a single global **action webhook URL** configured in `.kanban.json`, with the action name and the full card context. Your webhook handles the actual work.

### How it works

1. **Configure the webhook URL** in `.kanban.json`:

```json
{
  "actionWebhookUrl": "https://example.com/kanban-actions"
}
```

2. **Add actions to a card** — either as an array of action keys, or an object mapping action keys to display titles:

```yaml
# Array form — action key is used as the button label
actions: ["retry", "rollback", "notify-slack"]

# Object form — keys are the action names sent to the webhook, values are the UI labels
actions:
  retry: "Retry deployment"
  rollback: "Roll back to v1"
  notify-slack: "Notify Slack"
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
    "actions": ["retry", "rollback", "notify-slack"]  // or {"retry": "Retry deployment", ...}
  }
}
```

The webhook receives the full card object (same shape as the SDK `Card` type, minus `filePath`). Your server responds with any 2xx status to acknowledge; non-2xx responses are treated as errors.

### Managing actions

Actions are stored in the `actions` field of the card's YAML frontmatter — either as a plain string array or as a key→title object. Edit them directly in the markdown file, or use any interface:

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

## Board Actions

Board actions are the board-level sibling to card actions. Define them once per board, and they appear in the toolbar **Actions** dropdown for that board.

### How it works

1. **Define actions on the board** in `.kanban.json`:

```json
{
  "boards": {
    "default": {
      "name": "Default Board",
      "actions": {
        "deploy": "Deploy to Production",
        "announce": "Post release update"
      }
    }
  }
}
```

2. **Trigger them from any interface**:

- **UI**: Use the toolbar **Actions** dropdown on a board that defines actions.
- **CLI**: `kl board-actions fire --board <boardId> <key>`
- **REST API**: `POST /api/boards/:boardId/actions/:key/trigger`
- **MCP**: `trigger_board_action`

3. **Receive a webhook event**: triggering a board action emits a `board.action` event containing the board ID, action key, and display title.

### Managing board actions

```bash
# List existing actions
kl board-actions list --board default

# Add or update a named action
kl board-actions add --board default --key deploy --title "Deploy to Production"

# Remove an action
kl board-actions remove --board default deploy

# Trigger an action
kl board-actions fire --board default deploy
```

## MCP Server

Expose your kanban board to AI agents (Claude, Cursor, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io/).

### Setup with Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "kanban": {
      "type": "stdio",
      "command": "npx",
      "args": ["kanban-lite", "mcp"],
      "env": {
        "KANBAN_DIR": "/path/to/your/project/.kanban"
      }
    }
  }
}
```

Or run directly:

```bash
kl mcp                          # Auto-detect directory
kl mcp --dir .kanban            # Explicit directory
kanban-mcp --dir .kanban        # Via dedicated binary
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_boards` | List all boards in the workspace |
| `create_board` | Create a new board with optional custom columns |
| `get_board` | Get board configuration and details |
| `delete_board` | Delete an empty board |
| `list_board_actions` | List all named actions defined on a board |
| `add_board_action` | Add or update a named board action |
| `remove_board_action` | Remove a named board action |
| `trigger_board_action` | Trigger a board action webhook event |
| `transfer_card` | Move a card from one board to another |
| `list_cards` | List/filter cards by status, priority, assignee, label, `searchQuery`, `fuzzy`, and `metaFilter` |
| `get_card` | Get full details of a card (supports partial ID matching) |
| `get_active_card` | Get the currently active/open card, or `null` if none is active |
| `create_card` | Create a new card with title, body, status, priority, metadata, forms, and formData |
| `update_card` | Update fields of an existing card, including forms and formData |
| `submit_card_form` | Validate and submit a card form payload through the shared SDK workflow |
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
| `list_logs` | List log entries on a card |
| `add_log` | Add a log entry to a card |
| `clear_logs` | Clear all log entries from a card |
| `list_board_logs` | List board-level log entries |
| `add_board_log` | Add a board-level log entry |
| `clear_board_logs` | Clear all board-level log entries |
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
| `get_workspace_info` | Get workspace root path, kanban directory, and active storage provider metadata |

For agent-driven search, pass `searchQuery` for free text (including inline tokens like `meta.team: backend`), set `fuzzy: true` to widen matching across text and metadata values, or use `metaFilter` when you want structured dot-notation field filters.
| `get_storage_status` | Get current card/attachment storage provider status |
| `migrate_to_sqlite` | Migrate all card data from markdown to SQLite |
| `migrate_to_markdown` | Migrate all card data from SQLite back to markdown files |

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
const activeCard = await sdk.getActiveCard()
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

// Cards with attached forms
const incidentCard = await sdk.createCard({
  content: '# Investigate outage',
  forms: [{ name: 'incident-report' }],
  formData: { 'incident-report': { service: 'billing' } },
})

// Submit a form payload with SDK-owned validation + persistence
await sdk.submitForm({
  cardId: incidentCard.id,
  formId: 'incident-report',
  data: { severity: 'critical', owner: 'alice' },
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

### Event Bus

The SDK exposes a pub/sub event bus for custom subscriptions. The legacy `onEvent` callback still works, but you can now subscribe either through `KanbanSDK` convenience proxies or directly through `sdk.eventBus` for advanced workflows. Both paths support wildcard matching and typed event envelopes:

```typescript
// Subscribe to all task events directly on the SDK
const unsub = sdk.on('task.*', (event) => {
  console.log(event.type, event.data, event.timestamp)
})

// Wait for the next matching event once
const nextCreate = sdk.waitFor('task.created', { timeout: 1000 })

// Subscribe to auth events
sdk.once('auth.denied', (event) => {
  console.warn('Access denied:', event.actor, event.meta)
})

// Advanced access is still available on the shared EventBus instance
sdk.eventBus.onAny((name, event) => {
  console.log('saw event', name, event.timestamp)
})

// Clean up when done
unsub()
sdk.destroy()
```

Convenience methods available on `KanbanSDK`: `on`, `once`, `many`, `onAny`, `off`, `offAny`, `waitFor`, `eventNames`, `listenerCount`, `hasListeners`, and `removeAllListeners`.

See the [full SDK documentation](docs/sdk.md) for detailed API reference, types, error handling, and file layout.

## Data Storage

By default, cards are stored as markdown files with YAML frontmatter in `.kanban/boards/<boardId>/` within your project:

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

When you switch the `card.storage` provider to `sqlite` or `mysql`, card/comment persistence moves behind that provider while `.kanban.json` remains the source of truth for board config, columns, labels, settings, forms, and webhooks.

Attachments keep their legacy default unless you opt in explicitly: omitted `attachment.storage` still resolves to `localfs`, even when `card.storage` is `sqlite` or `mysql`.

## Storage Providers

Kanban Lite resolves storage by capability namespace. When no explicit config is present, it defaults to:

- `card.storage` → `markdown`
- `attachment.storage` → `localfs`

Legacy `.kanban.json` fields still work and are normalized into the same runtime capability map:

```json
{
  "storageEngine": "sqlite",
  "sqlitePath": ".kanban/kanban.db"
}
```

The equivalent capability-based config is:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite",
      "options": {
        "sqlitePath": ".kanban/kanban.db"
      }
    },
    "attachment.storage": {
      "provider": "localfs"
    }
  }
}
```

If both forms are present, `plugins[namespace]` wins for that namespace and legacy fields remain as compatibility aliases.

| Capability | Default | Core providers / compatibility ids | Notes |
|-----------|---------|------------------------------------|-------|
| `card.storage` | `markdown` | `markdown`, `sqlite`, `mysql` | Core owns `markdown`. `sqlite` and `mysql` are compatibility ids that resolve to `kl-sqlite-storage` and `kl-mysql-storage`. |
| `attachment.storage` | `localfs` | `localfs`, `sqlite`, `mysql` | Core owns `localfs`. `sqlite` and `mysql` are explicit opt-ins that resolve through the matching external package. Omitting this namespace still falls back to `localfs`. |

If you want attachments to route through the SQLite or MySQL attachment capability instead of the legacy `localfs` default, configure the matching provider explicitly:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite",
      "options": {
        "sqlitePath": ".kanban/kanban.db"
      }
    },
    "attachment.storage": {
      "provider": "sqlite"
    }
  }
}
```

The same pattern applies to MySQL:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "host": "localhost",
        "port": 3306,
        "user": "kanban",
        "password": "secret",
        "database": "kanban_db"
      }
    },
    "attachment.storage": {
      "provider": "mysql"
    }
  }
}
```

### Installing and selecting providers

- Core built-ins are `markdown` and `localfs`.
- `sqlite` and `mysql` remain valid provider ids, but they resolve to the external packages `kl-sqlite-storage` and `kl-mysql-storage`.
- External providers are resolved by npm package name at runtime from the environment running the CLI, standalone server, MCP server, extension host, or the published ESM SDK build. Install them in that environment before selecting them in `.kanban.json`.
- Missing plugin packages fail with an actionable install hint (for example `npm install <package>`).
- This repository also contains a developer-facing example/scaffold external attachment provider at `tmp/kl-s3-attachment-storage` for S3-compatible object stores. It is a separate package workspace, not a built-in `kanban-lite` provider.

### Webhook delivery provider

Webhook delivery now follows the same provider-resolution model, but it uses the top-level `webhookPlugin` config key instead of the storage `plugins` map:

```json
{
  "webhookPlugin": {
    "webhook.delivery": {
      "provider": "webhooks"
    }
  }
}
```

- The default runtime provider id is `webhooks`.
- The `webhooks` id resolves to the external package `kl-webhooks-plugin`.
- The persisted `.kanban.json` `webhooks` array is unchanged and remains the registry source of truth.
- A sibling checkout at `../kl-webhooks-plugin` is resolved automatically for local development.
- If the package is absent, current releases retain a built-in webhook compatibility fallback while the external install story rolls out.

### MySQL setup and runtime expectations

Use the MySQL compatibility provider id by selecting `provider: "mysql"` under `plugins["card.storage"]`:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "host": "localhost",
        "port": 3306,
        "user": "kanban",
        "password": "secret",
        "database": "kanban_db"
      }
    }
  }
}
```

Notes:

- `database` is required.
- Install `kl-mysql-storage` in the host environment that loads the plugin.
- The `mysql2` driver is an optional runtime dependency of that external package and is loaded lazily. Install it only in environments that actually use the MySQL provider.
- `mysql` stores cards/comments in MySQL, while attachments still default to the core `localfs` attachment provider unless you explicitly set `plugins["attachment.storage"].provider` to `"mysql"`.

```bash
npm install kl-mysql-storage mysql2
```

### Provider status surfaces

These commands/endpoints/tools expose provider ids and host-facing metadata without requiring callers to guess which compatibility shim or external package is active:

- `kl storage status`
- `GET /api/storage`
- `GET /api/workspace`
- MCP: `get_storage_status`, `get_workspace_info`

Core `markdown` reports `watchGlob: "boards/**/*.md"`. The `sqlite` and `mysql` compatibility providers report `isFileBacked: false` and `watchGlob: null` through their external plugin metadata, so host layers do not have to infer them from the storage engine name. Standalone `GET /api/storage` and `GET /api/workspace` also include `providers["webhook.delivery"]`, and SDK consumers can call `sdk.getWebhookStatus()` to see whether `kl-webhooks-plugin` is active or the built-in compatibility fallback is still in use.

### Migrating between compatibility-backed providers

**CLI:**
```bash
# Check current engine
kl storage status

# Migrate to SQLite
kl storage migrate-to-sqlite --sqlite-path .kanban/kanban.db

# Migrate back to markdown
kl storage migrate-to-markdown
```

**REST API:**
```bash
curl -X POST http://localhost:3000/api/storage/migrate-to-sqlite \
  -H 'Content-Type: application/json' \
  -d '{"sqlitePath": ".kanban/kanban.db"}'
```

**SDK:**
```ts
const sdk = new KanbanSDK('.kanban')
await sdk.init()

// Migrate to SQLite
const count = await sdk.migrateToSqlite('.kanban/kanban.db')
console.log(`Migrated ${count} cards to SQLite`)

// Or migrate back
await sdk.migrateToMarkdown()
```

These migration helpers are compatibility aliases for the markdown ↔ `sqlite` flow. Existing files / the database are **not deleted** during migration — they serve as a manual backup until you remove them.

If a workspace was explicitly using the `sqlite` or `mysql` attachment compatibility provider, migrating back to markdown automatically drops that incompatible attachment override so the legacy `localfs` default continues to work without manual config cleanup.

**MCP tools:** `get_storage_status`, `migrate_to_sqlite`, `migrate_to_markdown`

## Auth / Authz Plugin Contract

Kanban Lite ships auth/authz capability namespaces for `auth.identity` and `auth.policy`. The provider ids `noop` and `rbac` now resolve through the external `kl-auth-plugin` package, with a built-in compatibility fallback retained so existing workspaces still behave the same until the package is installed or linked.

Install the package in the environment that loads Kanban Lite:

```bash
npm install kl-auth-plugin
```

For local sibling-repo development, a checkout at `../kl-auth-plugin` is resolved automatically. `npm link ../kl-auth-plugin` is optional, but useful when you want an explicit local package link.

The shipped provider ids behave as before:

- `auth.identity` → `noop`: all callers are treated as anonymous (identity always resolves to `null`).
- `auth.policy` → `noop`: all actions are allowed regardless of identity (policy always returns `true`).

When non-noop auth providers are configured, the SDK now performs **pre-action authorization** for the privileged async mutation surface used by the Node-hosted adapters (standalone server, CLI, MCP, and the VS Code extension host). Workspaces without auth providers configured remain fully open-access.

Provider references for both namespaces are read from `.kanban.json` the same way storage providers are:

```json
{
  "auth": {
    "auth.identity": { "provider": "my-identity-plugin" },
    "auth.policy": { "provider": "my-policy-plugin", "options": { "strict": true } }
  }
}
```

Bearer tokens, token-to-role maps, and other secrets must **not** be stored in `.kanban.json`. Token acquisition is host-specific (VS Code `SecretStorage`, env vars for CLI/MCP, in-memory for standalone).

### `rbac` provider

Kanban Lite ships a first-party **Role-Based Access Control (RBAC)** provider pair (`rbac`) in `kl-auth-plugin`. It enforces a fixed three-role action matrix without requiring a login flow or external identity service.

**Enable it in `.kanban.json`:**

```json
{
  "auth": {
    "auth.identity": { "provider": "rbac" },
    "auth.policy": { "provider": "rbac" }
  }
}
```

**Token validation:** Tokens are opaque strings validated against a runtime-owned principal registry supplied by the host at startup. Unknown or absent tokens resolve to `null` (deny). A `Bearer ` prefix is stripped before the registry lookup. Token values, token-to-role maps, and role assignments must remain in host/runtime configuration only and must never appear in `.kanban.json` or diagnostics.

**Role levels:**

| Role | Permitted actions |
|------|-------------------|
| `user` | `form.submit`, `comment.create`, `comment.update`, `comment.delete`, `attachment.add`, `attachment.remove`, `card.action.trigger`, `log.add` |
| `manager` | All `user` actions plus `card.create`, `card.update`, `card.move`, `card.transfer`, `card.delete`, `board.action.trigger`, `log.clear`, `board.log.add` |
| `admin` | All `manager` actions plus all board/config mutations: `board.create`, `board.update`, `board.delete`, `settings.update`, `webhook.*`, `label.*`, `column.*`, `storage.migrate`, and more |

Roles are cumulative upward: `admin` includes all `manager` and `user` actions.

**Scope limits (v1):**

- **Action-level only**: access decisions are made per-action, not per-row or per-card.
- **No login flow**: the provider has no interactive authentication UI.
- **No row filtering**: a denied action blocks the write; no partial result filtering is performed.
- **Node-hosted only**: the RBAC provider runs exclusively in the Node host layer; no browser execution is performed.
- Tokens are resolved from the host token source at call time and are **never** persisted to `.kanban.json`, returned in API responses, or echoed in error bodies or logs.



### Host token sources

- **Standalone REST API**: `Authorization: Bearer <token>` request header
- **CLI**: `KANBAN_TOKEN` environment variable
- **MCP**: `KANBAN_TOKEN` environment variable
- **VS Code extension host**: secure `SecretStorage` (`Kanban Lite: Set Auth Token` / `Clear Auth Token` commands)

Raw tokens are treated as write-only input: they are never returned in REST responses, CLI/MCP output, logs, errors, or webview messages.

### Diagnostics / status

- **SDK**: `sdk.getAuthStatus()`
- **Standalone REST API**: `GET /api/auth` and `GET /api/workspace`
- **CLI**: `kl auth status`
- **MCP**: `get_auth_status`

These status surfaces expose only safe metadata such as active provider ids, whether auth is configured, whether a host token source is currently present, and the transport/token-source label.

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
      "actions": {
        "deploy": "Deploy to Production",
        "announce": "Post release update"
      },
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
  "boardZoom": 100,
  "cardZoom": 100,
  "panelMode": "drawer",
  "drawerWidth": 50,
  "forms": {
    "incident-report": {
      "schema": {
        "type": "object",
        "title": "Incident Report",
        "properties": {
          "severity": { "type": "string" },
          "owner": { "type": "string" }
        }
      },
      "data": {
        "severity": "medium"
      }
    }
  },
  "actionWebhookUrl": "https://example.com/kanban-actions"
}
```

Columns are fully customizable per board — add, remove, rename, or recolor them from the web UI, CLI, or REST API.

`boardZoom` and `cardZoom` set the default zoom percentage (75–150) for the board view and card detail panel respectively. They can also be adjusted live in the Settings panel or with `Ctrl/Cmd + =` / `Ctrl/Cmd + -` keyboard shortcuts.

`panelMode` controls whether card flows open as a centered popup or a right-side drawer. When using drawer mode, `drawerWidth` sets the default width percentage (20–80) for card creation and detail panels.

`forms` defines reusable JSON Schema/JSON Forms descriptors that any card can attach by name. Card-local inline forms still live on the card frontmatter under `forms`, while submitted values persist per card under `formData`.

## AI Agent Integration
- **Claude Code**: Default, Plan, Auto-edit, and Full Auto modes
- **Codex**: Suggest, Auto-edit, and Full Auto modes
- **OpenCode**: Agent integration support
- AI receives card context (title, priority, labels, description) for informed assistance

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

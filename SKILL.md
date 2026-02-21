# Kanban Markdown

Manage a project kanban board stored as markdown files. Cards have status, priority, assignee, due dates, labels, and attachments. Columns are customizable.

## Setup

**MCP (recommended):** Add to your MCP config (e.g. `.claude/settings.json`):

```json
{
  "mcpServers": {
    "kanban": {
      "command": "npx",
      "args": ["kanban-lite", "kanban-mcp", "--dir", ".kanban"]
    }
  }
}
```

**CLI:** `npm install -g kanban-lite` then use `kanban-lite` or the shorthand `kl`.

**API:** Start with `kl serve` (default: `http://localhost:3000/api`).

## Interface Priority

Use **MCP tools** when available (native LLM integration). Fall back to **CLI** when running shell commands. Use **REST API** for HTTP-based integrations.

## Quick Reference

| Operation | MCP Tool | CLI Command | API Endpoint |
|-----------|----------|-------------|--------------|
| List cards | `list_cards` | `kl list` | `GET /api/tasks` |
| Get card | `get_card` | `kl show <id>` | `GET /api/tasks/:id` |
| Create card | `create_card` | `kl add --title "..."` | `POST /api/tasks` |
| Update card | `update_card` | `kl edit <id>` | `PUT /api/tasks/:id` |
| Move card | `move_card` | `kl move <id> <status>` | `PATCH /api/tasks/:id/move` |
| Delete card | `delete_card` | `kl delete <id>` | `DELETE /api/tasks/:id` |
| List columns | `list_columns` | `kl columns` | `GET /api/columns` |
| Add column | `add_column` | `kl columns add` | `POST /api/columns` |
| Update column | `update_column` | `kl columns update <id>` | `PUT /api/columns/:id` |
| Remove column | `remove_column` | `kl columns remove <id>` | `DELETE /api/columns/:id` |
| List attachments | `list_attachments` | `kl attach <id>` | via card object |
| Add attachment | `add_attachment` | `kl attach add <id> <path>` | `POST /api/tasks/:id/attachments` |
| Remove attachment | `remove_attachment` | `kl attach remove <id> <name>` | `DELETE /api/tasks/:id/attachments/:name` |
| Get settings | `get_settings` | `kl settings` | `GET /api/settings` |
| Update settings | `update_settings` | `kl settings update` | `PUT /api/settings` |
| List webhooks | `list_webhooks` | `kl webhooks` | `GET /api/webhooks` |
| Add webhook | `add_webhook` | `kl webhooks add --url <url>` | `POST /api/webhooks` |
| Remove webhook | `remove_webhook` | `kl webhooks remove <id>` | `DELETE /api/webhooks/:id` |
| Workspace path | `get_workspace_info` | `kl pwd` | `GET /api/workspace` |

## Card Operations

### List and filter cards

```
MCP:  list_cards(status="todo", priority="high")
CLI:  kl list --status todo --priority high --json
API:  GET /api/tasks?status=todo&priority=high
```

Filters: `status`, `priority`, `assignee`, `label`. All optional.

### Get a card

```
MCP:  get_card(cardId="implement-search")
CLI:  kl show implement-search --json
```

Supports **partial ID matching** - `"search"` will match `"implement-search-2026-02-21"` if unambiguous.

### Create a card

```
MCP:  create_card(
        title="Implement search",
        body="Full-text search across all cards.",
        status="todo",
        priority="high",
        assignee="alice",
        labels=["frontend", "search"]
      )

CLI:  kl add --title "Implement search" --body "Full-text search." \
        --status todo --priority high --assignee alice --label "frontend,search"

API:  POST /api/tasks
      {"content": "# Implement search\n\nFull-text search.", "status": "todo", "priority": "high"}
```

Note: MCP/CLI use `title` + `body`, API uses `content` (full markdown with `# Title` heading).

### Update a card

```
MCP:  update_card(cardId="implement-search", priority="critical", assignee="bob")
CLI:  kl edit implement-search --priority critical --assignee bob
```

Only specified fields are changed. Timestamps update automatically.

### Move a card

```
MCP:  move_card(cardId="implement-search", status="in-progress")
CLI:  kl move implement-search in-progress
CLI:  kl move implement-search in-progress --position 0   # move to top
```

Moving to `done` auto-sets `completedAt`. Moving away from `done` clears it.

### Delete a card

```
MCP:  delete_card(cardId="implement-search")
CLI:  kl delete implement-search
```

## Column Operations

```
MCP:  list_columns()
MCP:  add_column(id="testing", name="Testing", color="#ff9900")
MCP:  update_column(columnId="testing", name="QA", color="#22c55e")
MCP:  remove_column(columnId="testing")    # fails if cards exist in column

CLI:  kl columns
CLI:  kl columns add --id testing --name Testing --color "#ff9900"
CLI:  kl columns update testing --name QA --color "#22c55e"
CLI:  kl columns remove testing
```

## Settings

```
MCP:  get_settings()
MCP:  update_settings(compactMode=true, defaultPriority="high")

CLI:  kl settings
CLI:  kl settings update --compactMode true --defaultPriority high
```

Available settings: `showPriorityBadges`, `showAssignee`, `showDueDate`, `showLabels`, `showFileName`, `compactMode`, `defaultPriority`, `defaultStatus`.

## Webhooks

```
MCP:  list_webhooks()
MCP:  add_webhook(url="https://example.com/hook", events=["task.created", "task.moved"])
MCP:  remove_webhook(webhookId="wh_abc123")

CLI:  kl webhooks
CLI:  kl webhooks add --url https://example.com/hook --events task.created,task.moved --secret mykey
CLI:  kl webhooks remove wh_abc123
```

Events: `task.created`, `task.updated`, `task.moved`, `task.deleted`, `column.created`, `column.updated`, `column.deleted`. Use `["*"]` for all.

## Data Model

### Statuses

`backlog` | `todo` | `in-progress` | `review` | `done`

### Priorities

`critical` | `high` | `medium` | `low`

### Card fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated from title + date (e.g. `implement-search-2026-02-21`) |
| `status` | string | Current column |
| `priority` | string | Priority level |
| `assignee` | string or null | Assigned person |
| `dueDate` | string or null | Due date (`YYYY-MM-DD`) |
| `created` | string | ISO timestamp, set on creation |
| `modified` | string | ISO timestamp, auto-updated |
| `completedAt` | string or null | ISO timestamp, auto-set when status becomes `done` |
| `labels` | string[] | Tags |
| `attachments` | string[] | Attached filenames |
| `order` | string | Fractional index for sorting within column |
| `content` | string | Markdown body (starts with `# Title`) |

### File storage

Cards are stored as markdown files with YAML frontmatter in `{featuresDir}/{status}/`:

```
.kanban/
  backlog/
    my-card-2026-02-21.md
  todo/
  in-progress/
  review/
  done/
```

Config: `.kanban.json` at workspace root. Webhooks: `.kanban-webhooks.json` at workspace root.

## Common Workflows

### Start working on a task

```
list_cards(status="todo", priority="high")      # find high-priority todo items
move_card(cardId="...", status="in-progress")    # claim it
update_card(cardId="...", assignee="me")         # assign yourself
```

### Triage backlog

```
list_cards(status="backlog")                     # see all backlog items
update_card(cardId="...", priority="critical")   # re-prioritize
move_card(cardId="...", status="todo")           # promote to todo
```

### Complete a task

```
move_card(cardId="...", status="done")           # completedAt auto-set
```

### Review board state

```
list_columns()                                   # see all columns
list_cards()                                     # see all cards
get_settings()                                   # see board config
```

## CLI Output

Add `--json` to any CLI command for machine-readable JSON output. Add `--dir <path>` to specify a custom features directory (default: `.kanban`).

# MCP Server

The MCP server is the agent-native interface for Kanban Lite. It runs over stdio, delegates its built-in operations to the same `KanbanSDK` methods used by the CLI and standalone server, and can be extended by active plugin packages.

## Starting the server

```bash
kl mcp
kl mcp --dir .kanban
kanban-mcp --dir .kanban
npx kanban-lite mcp
```

The current implementation exposes **stdio transport only**.

When the server starts, it resolves the workspace in this order:

1. `--dir <path>`
2. `KANBAN_DIR`
3. `KANBAN_FEATURES_DIR` (legacy alias)
4. optional `--config <path>` during auto-detection
5. auto-detect from the current working directory

If your MCP client does not inherit your shell environment, pass the directory and token explicitly in the client config:

```json
{
  "mcpServers": {
    "kanban": {
      "type": "stdio",
      "command": "kl",
      "args": ["mcp", "--dir", "/absolute/path/to/project/.kanban"],
      "env": {
        "KANBAN_LITE_TOKEN": "kl-your-token"
      }
    }
  }
}
```

## Authentication and environment

The MCP server itself does not prompt for credentials. It reads auth state from the process environment and the workspace configuration:

- `KANBAN_LITE_TOKEN` is the preferred token environment variable.
- `KANBAN_TOKEN` is still accepted as a compatibility alias.
- If no auth providers are configured for the workspace, MCP access remains open just like the CLI and SDK.
- If auth is enabled, pass the token through your MCP client config or launch the server from a shell that already exports it.

Useful diagnostics:

- `get_auth_status` — shows active auth providers plus safe token-source metadata
- `get_workspace_info` — includes auth, storage, workspace root, and kanban directory details

For the full auth model and the `local` / `rbac` provider details, see `docs/auth.md`.

## Tool conventions

A few conventions make the MCP surface easier to work with:

- **Tool names use snake_case.**
- **Inputs are mostly camelCase**, with one notable exception: `trigger_action` expects `card_id` and `board_id`.
- Most tools return **pretty-printed JSON inside a text content block**. Some mutation tools return a short success string instead.
- Errors are returned as MCP tool errors (`isError: true`). Auth and plugin-setting failures may return structured JSON payloads instead of plain text.
- Unless a tool explicitly requires a board identifier, omitting `boardId` uses the workspace default board.
- Most card-focused tools support **partial card ID matching**. If zero cards or multiple cards match, the tool returns an error and asks for a more specific ID.
- `delete_card` is a **soft delete** that moves the card to the deleted column. Use `permanent_delete_card` for irreversible deletion.
- `add_attachment` requires an **absolute host file path** that is readable by the machine running the MCP server.
- Built-in and plugin-owned mutations run through the same SDK event/auth pipeline as the CLI and REST API, so webhooks, callbacks, auth checks, and storage providers behave consistently across interfaces.

## Search and filtering

`list_cards` is the main discovery tool. It returns a **summary list** (`id`, rendered `title`, `status`, `priority`, `assignee`, `labels`, `dueDate`) rather than the full card body. Use `get_card` when you want the full record.

Search behavior matches the CLI and REST API:

- `searchQuery` — free-text search across card content and metadata values
- inline metadata tokens inside `searchQuery` such as `meta.team: backend`
- `fuzzy: true` — typo-tolerant matching across text and metadata values
- `metaFilter` — structured field filtering using dot-notation keys like `{"links.jira":"PROJ-123"}`
- `sort` — one of `created:asc`, `created:desc`, `modified:asc`, or `modified:desc`

Example input for `list_cards`:

```json
{
  "boardId": "default",
  "searchQuery": "release meta.team: backnd",
  "fuzzy": true,
  "metaFilter": {
    "links.jira": "PROJ-123"
  },
  "sort": "modified:desc"
}
```

## Built-in tools

The core MCP server currently registers the following built-in tools. Active plugins may add more.

### Boards and board actions

| Tool | Purpose |
| --- | --- |
| `list_boards` | List all boards in the workspace. |
| `create_board` | Create a new board with optional description and custom columns. |
| `get_board` | Return board details for a specific `boardId`. |
| `delete_board` | Delete an empty board. |
| `transfer_card` | Move a card from one board to another, optionally changing its status in the target board. |
| `list_board_actions` | List named board-level actions. |
| `add_board_action` | Add or update a board action key/title pair. |
| `remove_board_action` | Remove a board action. |
| `trigger_board_action` | Fire a board action event for automation/webhook flows. |

### Cards, forms, and actor-scoped card state

| Tool | Purpose |
| --- | --- |
| `list_cards` | List card summaries with filtering and search support. |
| `get_card` | Return the full card payload; supports partial card IDs. |
| `get_active_card` | Return the currently active/open card, or `null` if none is active. |
| `create_card` | Create a card with title/body plus optional status, priority, assignee, labels, seeded checklist `tasks`, metadata, actions, forms, and `formData`. |
| `list_card_checklist_items` | Return the shared checklist read model for a card, including the checklist-wide add token. |
| `add_card_checklist_item` | Append one checklist item to a card using the latest `expectedToken` from `list_card_checklist_items`. |
| `edit_card_checklist_item` | Edit one checklist item with optional `expectedRaw` optimistic-concurrency checks. |
| `delete_card_checklist_item` | Remove one checklist item with optional `expectedRaw` optimistic-concurrency checks. |
| `check_card_checklist_item` | Mark one checklist item complete with optional `expectedRaw` optimistic-concurrency checks. |
| `uncheck_card_checklist_item` | Mark one checklist item incomplete with optional `expectedRaw` optimistic-concurrency checks. |
| `update_card` | Patch selected card fields; also supports replacing forms and `formData`. |
| `submit_card_form` | Validate and persist a card form submission through the shared SDK form pipeline. |
| `move_card` | Move a card to a new status column. |
| `delete_card` | Soft-delete a card by moving it to the deleted status. |
| `permanent_delete_card` | Permanently remove a card from disk/storage. |
| `trigger_action` | Fire a named card action. This tool uses `card_id` / `board_id` input names. |
| `get_card_state_status` | Show the active `card.state` backend status for the workspace. |
| `get_card_state` | Read the side-effect-free unread/open summary for a card. |
| `open_card` | Acknowledge unread activity and persist explicit actor-scoped open-card state. |
| `read_card` | Acknowledge unread activity without changing actor-scoped open-card state. |

`get_active_card` and the `card.state` tools are related but not identical:

- `get_active_card` reflects workspace/UI-style active-card selection
- `get_card_state`, `open_card`, and `read_card` work with actor-scoped unread/open state managed by the shared card-state backend

### Attachments, comments, and logs

| Tool | Purpose |
| --- | --- |
| `list_attachments` | List attachments for a card. |
| `add_attachment` | Copy a file into the card's attachment storage. Requires an absolute host path. |
| `remove_attachment` | Remove an attachment reference from a card. |
| `list_comments` | List card comments. |
| `add_comment` | Add a markdown comment to a card. |
| `stream_comment` | Write a comment through the streaming path so connected viewers can see it arrive live. |
| `update_comment` | Update an existing comment by `commentId`. |
| `delete_comment` | Delete a comment. |
| `list_logs` | List card-level log entries. |
| `add_log` | Append a card log entry with optional `source` and structured `object` data. |
| `clear_logs` | Delete the card `.log` file so the log starts fresh. |
| `list_board_logs` | List board-level log entries. |
| `add_board_log` | Append a board-level log entry. |
| `clear_board_logs` | Clear the board log file. |

### Columns, labels, and display settings

| Tool | Purpose |
| --- | --- |
| `list_columns` | List board columns. |
| `add_column` | Add a column with `id`, `name`, and `color`. |
| `update_column` | Change a column's display name or color. |
| `remove_column` | Remove a column if it is empty. |
| `reorder_columns` | Persist a full ordered list of column IDs. |
| `set_minimized_columns` | Persist the minimized-column rails for a board. |
| `cleanup_column` | Move every card in a column into the deleted column without removing the column itself. |
| `list_labels` | List label definitions. |
| `set_label` | Create or update a label definition. |
| `rename_label` | Rename a label and cascade that rename to cards. |
| `delete_label` | Remove a label definition and strip it from cards. |
| `get_settings` | Read current board display settings. |
| `update_settings` | Update board display settings. |

### Workspace diagnostics, plugin settings, and storage

| Tool | Purpose |
| --- | --- |
| `list_plugin_settings` | List capability-grouped plugin provider inventory for the workspace. |
| `select_plugin_settings_provider` | Select the active provider for a capability such as `auth.identity` or `card.storage`. |
| `update_plugin_settings_options` | Persist provider options for a capability/provider pair and return the redacted read model. |
| `install_plugin_settings_package` | Install an allowed `kl-*` package into `workspace` or `global` scope using the guarded installer. |
| `list_available_events` | List built-in and plugin-declared SDK events, optionally filtered by phase or wildcard mask. |
| `get_auth_status` | Show auth provider and token-source diagnostics for MCP. |
| `get_workspace_info` | Show workspace root, kanban dir, port, auth summary, and active storage/provider metadata. |
| `get_storage_status` | Show the active storage engine/provider details. |
| `migrate_to_sqlite` | Migrate card data from markdown-backed storage to SQLite. |
| `migrate_to_markdown` | Migrate card data from SQLite back to markdown files. |

A few plugin-settings guardrails are worth calling out:

- `install_plugin_settings_package` only accepts **exact unscoped `kl-*` package names**
- install `scope` must be either `workspace` or `global`
- returned option payloads are redacted for secret safety

## Plugin-contributed MCP tools

The built-in tool list above is not the whole story. Active plugins can contribute additional MCP tools through the narrow `mcpPlugin.registerTools(ctx)` seam.

Current first-party example:

- [`kl-plugin-webhook`](https://www.npmjs.com/package/kl-plugin-webhook) adds:
  - `list_webhooks`
  - `add_webhook`
  - `update_webhook`
  - `remove_webhook`

A few important notes:

- Plugin packages must be installed in the **same runtime environment** that launches the MCP server.
  - If you run `kl mcp` from a project-local install, install plugins in that workspace.
  - If you run a global binary, install plugins globally or otherwise make them resolvable from that runtime.
- Plugin-contributed tools receive the same SDK instance, auth wrapper, workspace paths, and error-helper behavior as built-in tools.
- Duplicate MCP tool names are rejected during server startup.

For the broader plugin model, see `docs/plugins.md`. For webhook-specific behavior, see `docs/webhooks.md`.

## Common call patterns

### Create a form-aware card

Tool: `create_card`

```json
{
  "boardId": "default",
  "title": "Investigate outage",
  "body": "Collect incident details and assign an owner.",
  "status": "todo",
  "priority": "high",
  "tasks": ["Draft incident summary", "- [x] Page on-call"],
  "actions": ["retry", "notify"],
  "forms": [
    { "name": "incident-report" }
  ],
  "formData": {
    "incident-report": {
      "service": "billing"
    }
  }
}
```

### Submit a card form

Tool: `submit_card_form`

```json
{
  "cardId": "investigate-outage",
  "formId": "incident-report",
  "data": {
    "severity": "critical",
    "owner": "alice"
  }
}
```

### Acknowledge unread activity without changing open-card state

Tool: `read_card`

```json
{
  "cardId": "investigate-outage"
}
```

### Configure a plugin provider

Tool: `select_plugin_settings_provider`

```json
{
  "capability": "auth.identity",
  "providerId": "local"
}
```

Tool: `update_plugin_settings_options`

```json
{
  "capability": "auth.identity",
  "providerId": "local",
  "options": {
    "users": [
      {
        "username": "alice",
        "password": "••••••",
        "role": "admin"
      }
    ]
  }
}
```

## Troubleshooting

- **Tool says a card was not found or matched multiple cards** — pass a more specific `cardId`, and add `boardId` when multiple boards contain similar card IDs.
- **Auth-denied errors** — confirm the client passes `KANBAN_LITE_TOKEN` (or `KANBAN_TOKEN`) into the MCP process and inspect `get_auth_status`.
- **A plugin tool is missing** — install the plugin package in the same runtime environment as the MCP server and verify the workspace/plugin configuration selects it.
- **`add_attachment` fails** — use an absolute path on the host machine that is readable from the MCP process.
- **You expected a hard delete** — `delete_card` only soft-deletes; use `permanent_delete_card` to remove the card entirely.
- **Your token is in `.env` but MCP still cannot see it** — MCP clients do not automatically load workspace `.env` files unless the launch command or wrapper shell exports them first.

## Related docs

- `README.md` — quick-start and cross-interface overview
- `docs/auth.md` — auth providers, token handling, and diagnostics
- `docs/forms.md` — shared form model used by `create_card`, `update_card`, and `submit_card_form`
- `docs/plugins.md` — plugin discovery, provider selection, and MCP registration seam
- `docs/webhooks.md` — webhook delivery and plugin-owned webhook MCP tools
- `docs/sdk.md` — underlying SDK methods that the MCP server delegates to

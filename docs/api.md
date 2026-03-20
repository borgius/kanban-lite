# Kanban Lite REST API

The standalone server exposes a full REST API for managing kanban boards programmatically.

## Base URL

```
http://localhost:3000/api
```

Start the server with `kl serve` or `kanban-md`. Use `--port <number>` to change the port.

## Response Format

All responses follow a consistent envelope:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": "Error message" }
```

CORS is enabled for all origins.

## Conventions

- Card/task IDs are board-scoped; endpoints that accept `:id` generally support partial ID matching for convenience.
- `/api/tasks/*` operates on the default board, while `/api/boards/:boardId/tasks/*` targets a specific board explicitly.
- Successful responses are wrapped in `{ ok: true, data: ... }`; failed requests return `{ ok: false, error: string }`.

---

## Boards

### List Boards

```
GET /api/boards
```

Returns all boards in the workspace.

**Response:**

```json
{
  "ok": true,
  "data": [
    { "id": "default", "name": "Default Board" },
    { "id": "bugs", "name": "Bug Tracker", "description": "Track production bugs" }
  ]
}
```

---

### Create Board

```
POST /api/boards
```

Creates a new board and persists it to `.kanban.json`. When `columns` is omitted, the board inherits the default board's columns (or the built-in standard columns when the default board has none).

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique board identifier |
| `name` | `string` | Yes | Display name |
| `description` | `string` | No | Board description |
| `columns` | `KanbanColumn[]` | No | Custom columns (inherits from default board if omitted) |

**Example:**

```bash
curl -X POST http://localhost:3000/api/boards \
  -H "Content-Type: application/json" \
  -d '{
    "id": "bugs",
    "name": "Bug Tracker",
    "description": "Track production bugs",
    "columns": [
      { "id": "new", "name": "New", "color": "#ef4444" },
      { "id": "investigating", "name": "Investigating", "color": "#f59e0b" },
      { "id": "fixed", "name": "Fixed", "color": "#22c55e" }
    ]
  }'
```

**Response:** `201 Created`

```json
{
  "ok": true,
  "data": { "id": "bugs", "name": "Bug Tracker", "description": "Track production bugs" }
}
```

---

### Get Board

```
GET /api/boards/:boardId
```

Returns the full configuration for a board.

**Response:**

```json
{
  "ok": true,
  "data": {
    "name": "Bug Tracker",
    "description": "Track production bugs",
    "columns": [
      { "id": "new", "name": "New", "color": "#ef4444" },
      { "id": "investigating", "name": "Investigating", "color": "#f59e0b" },
      { "id": "fixed", "name": "Fixed", "color": "#22c55e" }
    ],
    "nextCardId": 1,
    "defaultStatus": "new",
    "defaultPriority": "medium"
  }
}
```

---

### Update Board

```
PUT /api/boards/:boardId
```

Updates an existing board in place. Only provided fields are changed; omitted properties keep their current values.

**Request body:** Any subset of board config fields (`name`, `description`, `columns`, `defaultStatus`, `defaultPriority`).

**Example:**

```bash
curl -X PUT http://localhost:3000/api/boards/bugs \
  -H "Content-Type: application/json" \
  -d '{ "name": "Bug Tracker v2" }'
```

---

### Delete Board

```
DELETE /api/boards/:boardId
```

Deletes a board. The board must be empty (no cards) and cannot be the default board.

**Response:**

```json
{ "ok": true, "data": { "deleted": true } }
```

---

## Tasks (Default Board)

These endpoints operate on the default board. For board-scoped operations, see [Board-Scoped Tasks](#board-scoped-tasks) below.

### List Tasks

```
GET /api/tasks
```

Returns tasks on the default board. Supports exact free-text search via `q`, optional fuzzy matching via `fuzzy=true`, and field-scoped metadata filters via `meta.<field>=value`.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | `string` | Free-text search query. May also include inline `meta.field: value` tokens. |
| `fuzzy` | `boolean` | Enable fuzzy matching for free-text search and metadata tokens. |
| `meta.<field>` | `string` | Field-scoped metadata filter. Repeat for multiple metadata fields. |
| `status` | `string` | Filter by status (e.g., `todo`, `in-progress`) |
| `priority` | `string` | Filter by priority (`critical`, `high`, `medium`, `low`) |
| `assignee` | `string` | Filter by assignee name |
| `label` | `string` | Filter by label |

**Example:**

```bash
curl "http://localhost:3000/api/tasks?q=release&fuzzy=true&meta.team=backend"
```

---

### Get Task

```
GET /api/tasks/:id
```

Returns a single task from the default board. The `:id` segment supports partial ID matching, which is convenient when card IDs are numeric and unique within the board.

---

### Get Active Task

```
GET /api/tasks/active
```

Returns the currently active/open task, or `null` when no task is active.

**Response:**

```json
{
  "ok": true,
  "data": {
    "id": "42",
    "status": "in-progress",
    "priority": "high"
  }
}
```

---

### Create Task

```
POST /api/tasks
```

Creates a task on the default board. The title is derived from the first Markdown `# heading`, the card is appended to the target column using fractional ordering, and omitted `status` / `priority` values fall back to board defaults.

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `content` | `string` | Yes |  | Markdown content (title from first `# heading`) |
| `status` | `string` | No | `backlog` | Initial status |
| `priority` | `string` | No | `medium` | Priority level |
| `assignee` | `string` | No | `null` | Assigned team member |
| `dueDate` | `string` | No | `null` | Due date (ISO 8601) |
| `labels` | `string[]` | No | `[]` | Labels/tags |
| `metadata` | `Record<string, any>` | No |  | Arbitrary user-defined metadata |
| `forms` | `CardFormAttachment[]` | No |  | Attached forms, either named workspace-form references or inline form definitions |
| `formData` | `Record<string, Record<string, unknown>>` | No |  | Per-form saved data keyed by resolved form id |

**Example:**

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Investigate outage\n\nCollect incident details.",
    "status": "todo",
    "priority": "high",
    "forms": [{ "name": "incident-report" }],
    "formData": { "incident-report": { "service": "billing" } },
    "metadata": { "team": "backend" }
  }'
```

**Response:** `201 Created`

---

### Update Task

```
PUT /api/tasks/:id
```

Updates an existing task on the default board. Only the supplied fields are modified; omitted fields remain unchanged.

**Request body:** Any subset of task fields (`content`, `status`, `priority`, `assignee`, `dueDate`, `labels`, `metadata`, `forms`, `formData`).

**Example:**

```bash
curl -X PUT http://localhost:3000/api/tasks/42 \
  -H "Content-Type: application/json" \
  -d '{ "forms": [{ "name": "incident-report" }], "formData": { "incident-report": { "owner": "alice" } } }'
```

---

### Submit Task Form

```
POST /api/tasks/:id/forms/:formId/submit
```

Validates and persists a card form submission through the shared SDK workflow.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | `Record<string, unknown>` | Yes | Submitted field values merged over config defaults, card form data, and matching metadata before validation |

Merge order is `config form defaults -> card attachment defaults / existing formData -> matching card metadata -> submitted data`. Successful submissions emit the `form.submit` webhook event.

**Example:**

```bash
curl -X POST http://localhost:3000/api/tasks/42/forms/incident-report/submit   -H "Content-Type: application/json"   -d '{ "data": { "severity": "critical", "owner": "alice" } }'
```

---

### Move Task

```
PATCH /api/tasks/:id/move
```

Moves a task to a different column and/or position.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | Yes | Target column |
| `position` | `number` | No | Zero-based position (default: `0`) |

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/tasks/42/move \
  -H "Content-Type: application/json" \
  -d '{ "status": "in-progress", "position": 0 }'
```

---

### Delete Task

```
DELETE /api/tasks/:id
```

Soft-deletes a task by moving it into the hidden `deleted` column. Use permanent-delete flows if you need irreversible removal.


```bash
curl -X DELETE http://localhost:3000/api/tasks/42
```

---

## Board-Scoped Tasks

All task endpoints are also available scoped to a specific board. These behave identically to the default board endpoints but operate on the specified board. Use these routes when your integration manages multiple boards explicitly instead of relying on the workspace default. The board-scoped list endpoint supports the same query params as `/api/tasks`, including `q`, `fuzzy`, and `meta.*` filters.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/boards/:boardId/tasks` | List tasks (supports the same `q`, `fuzzy`, `meta.*`, and standard filters) |
| `GET` | `/api/boards/:boardId/tasks/active` | Get the currently active/open task for the board |
| `POST` | `/api/boards/:boardId/tasks` | Create a task in the board |
| `GET` | `/api/boards/:boardId/tasks/:id` | Get a task |
| `PUT` | `/api/boards/:boardId/tasks/:id` | Update a task |
| `POST` | `/api/boards/:boardId/tasks/:id/forms/:formId/submit` | Submit a task form in the board |
| `PATCH` | `/api/boards/:boardId/tasks/:id/move` | Move a task |
| `DELETE` | `/api/boards/:boardId/tasks/:id` | Delete a task |

**Example — submit a task form in the "bugs" board:**

```bash
curl -X POST http://localhost:3000/api/boards/bugs/tasks/42/forms/incident-report/submit   -H "Content-Type: application/json"   -d '{ "data": { "severity": "high", "owner": "alice" } }'
```

---

## Transfer Task

```
POST /api/boards/:boardId/tasks/:id/transfer
```

Moves a task from the current board into another board.

The `:boardId` path segment is the **destination** board. The source board is the server's currently active board context, so this endpoint is primarily intended for the live standalone UI and closely-coupled local integrations.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetStatus` | `string` | No | Status in the destination board (defaults to the board's default status) |

**Example:**

```bash
curl -X POST http://localhost:3000/api/boards/bugs/tasks/42/transfer \
  -H "Content-Type: application/json" \
  -d '{ "targetStatus": "new" }'
```

---

## Board-Scoped Columns

```
GET /api/boards/:boardId/columns
```

Returns the ordered column definitions for a specific board, including each column's `id`, display `name`, and `color`.

---

## Columns (Default Board)

### List Columns

```
GET /api/columns
```

Returns the ordered column definitions for the default board.

---

### Add Column

```
POST /api/columns
```

Creates a new column on the default board. New columns are appended to the end of the board's current column order.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique column identifier |
| `name` | `string` | Yes | Display name |
| `color` | `string` | No | Hex color (default: `#6b7280`) |

**Example:**

```bash
curl -X POST http://localhost:3000/api/columns \
  -H "Content-Type: application/json" \
  -d '{ "id": "testing", "name": "Testing", "color": "#ff9900" }'
```

---

### Update Column

```
PUT /api/columns/:id
```

Updates a column's display name and/or color on the default board.

**Request body:** `name` and/or `color`.

---

### Delete Column

```
DELETE /api/columns/:id
```

Fails if the column still contains tasks.

---

## Comments

### List Comments

```
GET /api/tasks/:id/comments
```

Returns all comments currently attached to the task, in stored order.

---

### Add Comment

```
POST /api/tasks/:id/comments
```

Adds a new comment to the task and emits the shared `comment.created` event/webhook pipeline.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `author` | `string` | Yes | Comment author |
| `content` | `string` | Yes | Comment body |

**Example:**

```bash
curl -X POST http://localhost:3000/api/tasks/42/comments \
  -H "Content-Type: application/json" \
  -d '{ "author": "alice", "content": "Looks good, needs tests" }'
```

---

### Update Comment

```
PUT /api/tasks/:id/comments/:commentId
```

Updates the Markdown content of an existing comment.

**Request body:** `{ "content": "Updated comment" }`

---

### Delete Comment

```
DELETE /api/tasks/:id/comments/:commentId
```

Deletes the specified comment from the task.

---

## Attachments

### Upload Attachment

```
POST /api/tasks/:id/attachments
```

Uploads one or more files as task attachments. Send the request as `multipart/form-data`; each uploaded file is copied through the active attachment-storage provider.


```bash
curl -X POST http://localhost:3000/api/tasks/42/attachments \
  -F 'files=@./screenshot.png' \
  -F 'files=@./report.pdf'
```

---

### Download Attachment

```
GET /api/tasks/:id/attachments/:filename
```

Streams the named attachment back to the client. For file types the browser understands (for example PDFs or images), most browsers will render inline.

---

### Delete Attachment

```
DELETE /api/tasks/:id/attachments/:filename
```

Removes the named attachment from the task and deletes the provider-backed attachment payload when supported.

---

## Logs

### List Logs

```
GET /api/tasks/:id/logs
```

Returns all log entries for the card.

---

### Add Log

```
POST /api/tasks/:id/logs
```

Append a log entry to the card.

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `text` | `string` | Yes |  | Log message text (supports markdown) |
| `source` | `string` | No | `"default"` | Source/origin label |
| `object` | `object` | No |  | Structured data object (stored as JSON) |
| `timestamp` | `string` | No |  | ISO 8601 timestamp (auto-generated if omitted) |

**Example:**

```bash
curl -X POST http://localhost:3000/api/tasks/42/logs \
  -H 'Content-Type: application/json' \
  -d '{ "text": "Build passed", "source": "ci", "object": { "version": "1.0" } }'
```

---

### Clear Logs

```
DELETE /api/tasks/:id/logs
```

Remove all log entries for the card.

---

## Board Logs

### List Board Logs

```
GET /api/boards/:boardId/logs
```

Returns all board-level log entries.

---

### Add Board Log

```
POST /api/boards/:boardId/logs
```

Append a log entry to the board.

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `text` | `string` | Yes |  | Log message text |
| `source` | `string` | No | `"sdk"` | Source/origin label |
| `object` | `object` | No |  | Structured data object (stored as JSON) |
| `timestamp` | `string` | No |  | ISO 8601 timestamp (auto-generated if omitted) |

**Example:**

```bash
curl -X POST http://localhost:3000/api/boards/default/logs \
  -H 'Content-Type: application/json' \
  -d '{ "text": "Deployment complete", "source": "ci" }'
```

---

### Clear Board Logs

```
DELETE /api/boards/:boardId/logs
```

Remove all board-level log entries.

---

## Settings

### Get Settings

```
GET /api/settings
```

Returns the workspace's current display and behavior settings used by the UI surfaces.

**Response:**

```json
{
  "ok": true,
  "data": {
    "showPriorityBadges": true,
    "showAssignee": true,
    "showDueDate": true,
    "showLabels": true,
    "showBuildWithAI": false,
    "showFileName": false,
    "compactMode": false,
    "markdownEditorMode": false,
    "defaultPriority": "medium",
    "defaultStatus": "backlog"
  }
}
```

---

### Update Settings

```
PUT /api/settings
```

Updates workspace display settings and immediately broadcasts the change to connected realtime clients.

**Request body:** Full `CardDisplaySettings` object.

**Example:**

```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{ "compactMode": true, "showFileName": true }'
```

---

## Webhooks

### List Webhooks

```
GET /api/webhooks
```

Returns all registered webhook subscriptions from the workspace webhook registry.

---

### Register Webhook

```
POST /api/webhooks
```

Registers a new webhook destination. When `events` is omitted, the webhook subscribes to every event.

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes |  | Target URL |
| `events` | `string[]` | No | `["*"]` | Events to subscribe to |
| `secret` | `string` | No |  | HMAC-SHA256 signing secret |

**Available events:** `task.created`, `form.submit`, `task.updated`, `task.moved`, `task.deleted`, `comment.created`, `comment.updated`, `comment.deleted`, `log.added`, `log.cleared`, `column.created`, `column.updated`, `column.deleted`, `attachment.added`, `attachment.removed`, `settings.updated`, `board.created`, `board.updated`, `board.deleted`, `board.action`, `board.log.added`, `board.log.cleared`

**Example:**

```bash
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/hook",
    "events": ["task.created", "task.moved"],
    "secret": "my-signing-key"
  }'
```

---

### Update Webhook

```
PUT /api/webhooks/:id
```

Updates an existing webhook's URL, event subscriptions, signing secret, or active state.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | No | New target URL |
| `events` | `string[]` | No | New event subscriptions |
| `secret` | `string` | No | New HMAC-SHA256 signing secret |
| `active` | `boolean` | No | Enable or disable the webhook |

**Example:**

```bash
curl -X PUT http://localhost:3000/api/webhooks/wh_abc123 \
  -H "Content-Type: application/json" \
  -d '{ "active": false }'
```

---

### Delete Webhook

```
DELETE /api/webhooks/:id
```

Deletes the webhook registration permanently.

---

## Workspace

### Get Workspace Info

```
GET /api/workspace
```

Returns workspace-level connection and storage metadata, including resolved provider ids and filesystem watcher support.

**Response:**

```json
{
  "ok": true,
  "data": {
    "path": "/Users/admin/dev/my-project",
    "port": 3000,
    "storageEngine": "markdown",
    "sqlitePath": null,
    "providers": {
      "card.storage": "markdown",
      "attachment.storage": "localfs"
    },
    "isFileBacked": true,
    "watchGlob": "boards/**/*.md",
    "auth": {
      "identityProvider": "noop",
      "policyProvider": "noop",
      "configured": false,
      "tokenPresent": false,
      "tokenSource": null,
      "transport": "http"
    }
  }
}
```

---

### Get Auth Status

```
GET /api/auth
```

Returns auth provider metadata plus safe request-scoped token diagnostics for the current standalone HTTP request.

**Response:**

```json
{
  "ok": true,
  "data": {
    "identityProvider": "noop",
    "policyProvider": "noop",
    "identityEnabled": false,
    "policyEnabled": false,
    "configured": false,
    "tokenPresent": false,
    "tokenSource": null,
    "transport": "http"
  }
}
```

---

### Get Storage Status

```
GET /api/storage
```

Returns the active card provider id, attachment provider id, and host-facing file/watch metadata.

**Response:**

```json
{
  "ok": true,
  "data": {
    "type": "markdown",
    "sqlitePath": null,
    "providers": {
      "card.storage": "markdown",
      "attachment.storage": "localfs"
    },
    "isFileBacked": true,
    "watchGlob": "boards/**/*.md"
  }
}
```

---

### Migrate to SQLite

```
POST /api/storage/migrate-to-sqlite
```

Migrates cards from the built-in markdown provider to the built-in SQLite provider and updates compatibility config fields in `.kanban.json`.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sqlitePath` | `string` | No | Optional database path relative to the workspace root. |

This endpoint is a compatibility helper for the built-in markdown ↔ sqlite migration path. It does not migrate into arbitrary external providers.

**Response:**

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "count": 12,
    "storageEngine": "sqlite"
  }
}
```

---

### Migrate to Markdown

```
POST /api/storage/migrate-to-markdown
```

Migrates cards from the built-in SQLite provider back to markdown files and updates compatibility config fields in `.kanban.json`.

Existing source data is left in place as a manual backup until you remove it yourself.

**Response:**

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "count": 12,
    "storageEngine": "markdown"
  }
}
```

---

## WebSocket

The server provides a WebSocket endpoint at `ws://localhost:3000` for real-time updates. Connected clients receive live broadcasts when tasks, columns, or settings change.

**Message format:**

```json
{
  "type": "init",
  "features": [...],
  "columns": [...],
  "settings": {...},
  "boards": [...],
  "currentBoard": "default"
}
```

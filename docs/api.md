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

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | Filter by status (e.g., `todo`, `in-progress`) |
| `priority` | `string` | Filter by priority (`critical`, `high`, `medium`, `low`) |
| `assignee` | `string` | Filter by assignee name |
| `label` | `string` | Filter by label |

**Example:**

```bash
curl "http://localhost:3000/api/tasks?status=todo&priority=high"
```

---

### Get Task

```
GET /api/tasks/:id
```

Supports partial ID matching.

---

### Create Task

```
POST /api/tasks
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `content` | `string` | Yes |  | Markdown content (title from first `# heading`) |
| `status` | `string` | No | `backlog` | Initial status |
| `priority` | `string` | No | `medium` | Priority level |
| `assignee` | `string` | No | `null` | Assigned team member |
| `dueDate` | `string` | No | `null` | Due date (ISO 8601) |
| `labels` | `string[]` | No | `[]` | Labels/tags |

**Example:**

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Fix login bug\n\nUsers cannot log in with SSO.",
    "status": "todo",
    "priority": "critical",
    "assignee": "alice",
    "labels": ["bug", "auth"]
  }'
```

**Response:** `201 Created`

---

### Update Task

```
PUT /api/tasks/:id
```

**Request body:** Any subset of task fields (`content`, `status`, `priority`, `assignee`, `dueDate`, `labels`).

**Example:**

```bash
curl -X PUT http://localhost:3000/api/tasks/42 \
  -H "Content-Type: application/json" \
  -d '{ "priority": "high", "assignee": "bob" }'
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


```bash
curl -X DELETE http://localhost:3000/api/tasks/42
```

---

## Board-Scoped Tasks

All task endpoints are also available scoped to a specific board. These behave identically to the default board endpoints but operate on the specified board.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/boards/:boardId/tasks` | List tasks (supports same query filters) |
| `POST` | `/api/boards/:boardId/tasks` | Create a task in the board |
| `GET` | `/api/boards/:boardId/tasks/:id` | Get a task |
| `PUT` | `/api/boards/:boardId/tasks/:id` | Update a task |
| `PATCH` | `/api/boards/:boardId/tasks/:id/move` | Move a task |
| `DELETE` | `/api/boards/:boardId/tasks/:id` | Delete a task |

**Example — create a task in the "bugs" board:**

```bash
curl -X POST http://localhost:3000/api/boards/bugs/tasks \
  -H "Content-Type: application/json" \
  -d '{ "content": "# Login error", "status": "new", "priority": "critical" }'
```

---

## Transfer Task

```
POST /api/boards/:boardId/tasks/:id/transfer
```

Move a task from the current board to another board.

The `:boardId` is the **destination** board. The task is moved from the currently active board.

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

Returns columns for a specific board.

---

## Columns (Default Board)

### List Columns

```
GET /api/columns
```

---

### Add Column

```
POST /api/columns
```

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

---

### Add Comment

```
POST /api/tasks/:id/comments
```

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

**Request body:** `{ "content": "Updated comment" }`

---

### Delete Comment

```
DELETE /api/tasks/:id/comments/:commentId
```

---

## Attachments

### Upload Attachment

```
POST /api/tasks/:id/attachments
```

Send as `multipart/form-data` with file(s).

---

### Download Attachment

```
GET /api/tasks/:id/attachments/:filename
```

---

### Delete Attachment

```
DELETE /api/tasks/:id/attachments/:filename
```

---

## Settings

### Get Settings

```
GET /api/settings
```

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

---

### Register Webhook

```
POST /api/webhooks
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes |  | Target URL |
| `events` | `string[]` | No | `["*"]` | Events to subscribe to |
| `secret` | `string` | No |  | HMAC-SHA256 signing secret |

**Available events:** `task.created`, `task.updated`, `task.moved`, `task.deleted`, `comment.created`, `comment.updated`, `comment.deleted`, `column.created`, `column.updated`, `column.deleted`, `attachment.added`, `attachment.removed`, `settings.updated`, `board.created`, `board.updated`, `board.deleted`

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

---

## Workspace

### Get Workspace Info

```
GET /api/workspace
```

**Response:**

```json
{
  "ok": true,
  "data": { "path": "/Users/admin/dev/my-project" }
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

# Kanban Lite REST API

> This file is generated from `packages/kanban-lite/src/standalone/internal/openapi-spec.ts` plus active standalone plugin API metadata via `scripts/generate-api-docs.ts`.

Version: 1.0.0

- Authoritative source: Swagger/OpenAPI in `packages/kanban-lite/src/standalone/internal/openapi-spec.ts` plus standalone plugin API metadata discovered during docs generation
- Interactive docs: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs/json`
- Base API URL: `http://localhost:3000/api`

The standalone server exposes a full REST API for managing kanban boards programmatically.

**Base URL:** `http://localhost:3000/api`

Start the server with `kl serve` or `kanban-md`. Use `--port <number>` to change the port.

**Response envelope:**

```json
{ "ok": true, "data": { ... } }   // success
{ "ok": false, "error": "..." }    // error
```

CORS is enabled for all origins.

**Conventions:** Card/task IDs support partial matching within a board.
`/api/tasks/*` operates on the default board; `/api/boards/:boardId/tasks/*` targets a specific board explicitly.

## Boards

Board CRUD and board-level actions

### GET `/api/boards`

**List boards**

Returns all boards in the workspace.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | List of board summaries. |

### POST `/api/boards`

**Create board**

Creates a new board and persists it to `.kanban.json`. When `columns` is omitted, the board inherits the default board's columns (or built-in standard columns when the default board has none).

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Unique board identifier. |
| `name` | string | Yes | Display name. |
| `description` | string | No | Board description. |
| `columns` | array | No | Custom columns. Inherits from default board if omitted. |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Board created. |
| `400` | Validation error (missing id or name). |

### GET `/api/boards/{boardId}`

**Get board**

Returns the full configuration for a board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Board config. |
| `404` | Board not found. |

### PUT `/api/boards/{boardId}`

**Update board**

Updates an existing board in place. Only provided fields are changed; omitted properties keep their current values.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Request Body

Required: Yes

Any subset of board config fields: `name`, `description`, `columns`, `metadata`, `title`, `defaultStatus`, `defaultPriority`.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated board. |
| `400` | Error. |

### DELETE `/api/boards/{boardId}`

**Delete board**

Deletes a board. The board must be empty (no cards) and cannot be the default board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `400` | Board not empty or is default board. |

### GET `/api/boards/{boardId}/actions`

**Get board actions**

Returns the defined actions for the board as a map of key → title.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Action map. |
| `404` | Board not found. |

### POST `/api/boards/{boardId}/actions`

**Set board actions**

Replaces all board actions with the provided set. Keys present in the existing set but absent from the new set are removed.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `actions` | Record<string, string> | Yes | Map of action key → display title. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated action map. |
| `400` | Error. |

### PUT `/api/boards/{boardId}/actions/{key}`

**Add/update board action**

Adds a new board action or updates the title of an existing one.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `key` | path | string | Yes | Action key. |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | Yes | Display title for the action. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated actions. |
| `400` | Error. |

### DELETE `/api/boards/{boardId}/actions/{key}`

**Delete board action**

Removes a board action by key.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `key` | path | string | Yes | Action key. |

#### Responses

| Status | Description |
|--------|-------------|
| `204` | Deleted. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/actions/{key}/trigger`

**Trigger board action**

Fires the configured webhook for the named board action.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `key` | path | string | Yes | Action key. |

#### Responses

| Status | Description |
|--------|-------------|
| `204` | Triggered. |
| `404` | Not found. |

### GET `/api/boards/{boardId}/columns`

**List board columns**

Returns the ordered column definitions for the specified board, including each column's `id`, display `name`, and `color`.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Ordered column list. |
| `400` | Error. |

## Tasks

Task operations on the default board

### GET `/api/tasks`

**List tasks**

Returns tasks on the default board. Supports exact free-text search via `q`, optional fuzzy matching via `fuzzy=true`, and field-scoped metadata filters via `meta.<field>=value`. Read models include a server-owned `permissions` capability envelope plus side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | No | Free-text search. May include inline `meta.field: value` tokens. |
| `fuzzy` | query | boolean | No | Enable fuzzy matching for free-text search and metadata tokens. |
| `status` | query | string | No | Filter by status. |
| `priority` | query | `critical` \\| `high` \\| `medium` \\| `low` | No | Filter by priority. |
| `assignee` | query | string | No | Filter by assignee name. |
| `label` | query | string | No | Filter by label. |
| `labelGroup` | query | string | No | Filter by label group name. |
| `includeDeleted` | query | boolean | No | Include soft-deleted tasks. |
| `meta.<field>` | query | string | No | Field-scoped metadata filter. Repeat for multiple metadata fields. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Task list. |

### POST `/api/tasks`

**Create task**

Creates a task on the default board. Title is derived from the first Markdown `# heading`. Omitted `status`/`priority` fall back to board defaults.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `content` | string | Yes | Markdown content. Task title is derived from the first `# heading`. |
| `status` | string | No | Initial status (defaults to board default). |
| `priority` | `critical` \\| `high` \\| `medium` \\| `low` | No | Priority level (default: `medium`). |
| `assignee` | string | No | Assigned team member. |
| `dueDate` | string | No | Due date (ISO 8601). |
| `labels` | string[] | No | Labels/tags. |
| `tasks` | string[] | No | Optional seeded checklist items. Each entry must be a single-line Markdown task string or plain text that can be canonicalized into one. |
| `metadata` | object | No | Arbitrary user-defined key/value metadata. |
| `forms` | array | No | Attached forms — named workspace references (`{ "name": "..." }`) or inline definitions. |
| `formData` | object | No | Per-form saved data keyed by resolved form ID. |
| `actions` | array | No | Action names or map of key → title available on this card. |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Created. |
| `400` | Validation error. |

### GET `/api/tasks/active`

**Get active task**

Returns the currently active/open task on the default board, or `null` when no task is active. Active-task read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and caller-scoped `cardState` metadata.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Active task or null. |

### GET `/api/tasks/{id}`

**Get task**

Returns a single task from the default board. The `:id` segment supports partial ID matching. Read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and side-effect-free `cardState.unread` / `cardState.open` metadata for the current actor; this is separate from active-task UI state.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Task. |
| `404` | Not found. |

### PUT `/api/tasks/{id}`

**Update task**

Updates an existing task. Only the supplied fields are modified; omitted fields remain unchanged.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

Any subset of task fields: `content`, `status`, `priority`, `assignee`, `dueDate`, `labels`, `metadata`, `forms`, `formData`, `actions`.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated task. |
| `400` | Error. |
| `404` | Not found. |

### DELETE `/api/tasks/{id}`

**Delete task**

Soft-deletes a task by moving it into the hidden deleted column.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `404` | Not found. |

### POST `/api/tasks/{id}/open`

**Mark task opened**

Persists an explicit actor-scoped open mutation through the shared SDK `card.state` APIs. This does not modify active-card UI state.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Card-state mutation result. |
| `400` | Error. |
| `404` | Not found. |

### POST `/api/tasks/{id}/read`

**Mark task read**

Persists an explicit actor-scoped unread acknowledgement through the shared SDK `card.state` APIs. Read-only GET routes never invoke this mutation implicitly.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `readThrough` | object | No | Optional explicit unread cursor to acknowledge instead of the latest activity. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Card-state mutation result. |
| `400` | Error. |
| `404` | Not found. |

### GET `/api/tasks/{id}/checklist`

**List checklist items**

Returns the shared checklist read model for the task on the default board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Checklist read model. |
| `404` | Not found. |

### POST `/api/tasks/{id}/checklist`

**Add checklist item**

Appends a new checklist item to the task on the default board and returns the refreshed checklist read model.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Single-line checklist item text. Markdown task markers are optional on input and are canonicalized. |
| `expectedToken` | string | Yes | Checklist-wide optimistic-concurrency token returned by the latest checklist read model. Required for checklist adds to avoid lost updates. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### PUT `/api/tasks/{id}/checklist/{index}`

**Edit checklist item**

Edits one checklist item on the task and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Single-line checklist item text. Markdown task markers are optional on input and are canonicalized. |
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the edit is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### DELETE `/api/tasks/{id}/checklist/{index}`

**Delete checklist item**

Deletes one checklist item on the task and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### POST `/api/tasks/{id}/checklist/{index}/check`

**Check checklist item**

Marks one checklist item complete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### POST `/api/tasks/{id}/checklist/{index}/uncheck`

**Uncheck checklist item**

Marks one checklist item incomplete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### POST `/api/tasks/{id}/forms/{formId}/submit`

**Submit task form**

Validates and persists a card form submission. Merge order: config defaults → card attachment defaults / existing formData → matching card metadata → submitted data. Emits the `form.submit` webhook event.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `formId` | path | string | Yes | Form identifier |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `data` | object | Yes | Submitted field values. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Submission result. |
| `400` | Validation error. |

### PATCH `/api/tasks/{id}/move`

**Move task**

Moves a task to a different column and/or position on the default board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `status` | string | Yes | Target column. |
| `position` | integer | No | Zero-based position (default: `0`). |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated task. |
| `404` | Not found. |

### DELETE `/api/tasks/{id}/permanent`

**Permanently delete task**

Permanently and irreversibly deletes a task from the default board. This cannot be undone.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `404` | Not found. |

### POST `/api/tasks/{id}/actions/{action}`

**Trigger task action**

Fires the configured webhook for the named card-level action.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `action` | path | string | Yes | Action key |

#### Responses

| Status | Description |
|--------|-------------|
| `204` | Triggered. |
| `400` | Error. |
| `404` | Not found. |

## Board Tasks

Board-scoped task operations

### GET `/api/boards/{boardId}/tasks`

**List tasks (board-scoped)**

Returns tasks for the specified board. Supports the same `q`, `fuzzy`, `meta.*`, and field filters as `/api/tasks`. Read models include a server-owned `permissions` capability envelope plus side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `q` | query | string | No | Free-text search. May include inline `meta.field: value` tokens. |
| `fuzzy` | query | boolean | No | Enable fuzzy matching for free-text search and metadata tokens. |
| `status` | query | string | No | Filter by status. |
| `priority` | query | `critical` \\| `high` \\| `medium` \\| `low` | No | Filter by priority. |
| `assignee` | query | string | No | Filter by assignee name. |
| `label` | query | string | No | Filter by label. |
| `labelGroup` | query | string | No | Filter by label group name. |
| `includeDeleted` | query | boolean | No | Include soft-deleted tasks. |
| `meta.<field>` | query | string | No | Field-scoped metadata filter. Repeat for multiple metadata fields. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Task list. |
| `400` | Error. |

### POST `/api/boards/{boardId}/tasks`

**Create task (board-scoped)**

Creates a task on the specified board. Title is derived from the first Markdown `# heading`. Omitted `status`/`priority` fall back to the board defaults.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `content` | string | Yes | Markdown content. Task title is derived from the first `# heading`. |
| `status` | string | No | Initial status (defaults to board default). |
| `priority` | `critical` \\| `high` \\| `medium` \\| `low` | No | Priority level (default: `medium`). |
| `assignee` | string | No | Assigned team member. |
| `dueDate` | string | No | Due date (ISO 8601). |
| `labels` | string[] | No | Labels/tags. |
| `tasks` | string[] | No | Optional seeded checklist items. Each entry must be a single-line Markdown task string or plain text that can be canonicalized into one. |
| `metadata` | object | No | Arbitrary user-defined key/value metadata. |
| `forms` | array | No | Attached forms — named workspace references (`{ "name": "..." }`) or inline definitions. |
| `formData` | object | No | Per-form saved data keyed by resolved form ID. |
| `actions` | array | No | Action names or map of key → title available on this card. |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Created. |
| `400` | Validation error. |

### GET `/api/boards/{boardId}/tasks/active`

**Get active task (board-scoped)**

Returns the currently active/open task for the board, or `null` when none is active. Active-task read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and caller-scoped `cardState` metadata.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Active task or null. |

### GET `/api/boards/{boardId}/tasks/{id}`

**Get task (board-scoped)**

Returns a single task from the specified board. The `:id` segment supports partial ID matching. Read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and side-effect-free `cardState.unread` / `cardState.open` metadata for the current actor; this is separate from active-task UI state.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Task. |
| `404` | Not found. |

### PUT `/api/boards/{boardId}/tasks/{id}`

**Update task (board-scoped)**

Updates fields of a task. Only supplied fields are modified; omitted fields remain unchanged.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

Any subset of task fields: `content`, `status`, `priority`, `assignee`, `dueDate`, `labels`, `metadata`, `forms`, `formData`, `actions`.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated task. |
| `400` | Error. |
| `404` | Not found. |

### DELETE `/api/boards/{boardId}/tasks/{id}`

**Delete task (board-scoped)**

Soft-deletes the task by moving it to the hidden deleted column.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/open`

**Mark task opened (board-scoped)**

Persists an explicit actor-scoped open mutation through the shared SDK `card.state` APIs. This does not modify active-card UI state.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Card-state mutation result. |
| `400` | Error. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/read`

**Mark task read (board-scoped)**

Persists an explicit actor-scoped unread acknowledgement through the shared SDK `card.state` APIs. Read-only GET routes never invoke this mutation implicitly.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `readThrough` | object | No | Optional explicit unread cursor to acknowledge instead of the latest activity. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Card-state mutation result. |
| `400` | Error. |
| `404` | Not found. |

### GET `/api/boards/{boardId}/tasks/{id}/checklist`

**List checklist items (board-scoped)**

Returns the shared checklist read model for one task on the specified board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Checklist read model. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/checklist`

**Add checklist item (board-scoped)**

Appends a new checklist item to the task on the specified board and returns the refreshed checklist read model.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Single-line checklist item text. Markdown task markers are optional on input and are canonicalized. |
| `expectedToken` | string | Yes | Checklist-wide optimistic-concurrency token returned by the latest checklist read model. Required for checklist adds to avoid lost updates. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### PUT `/api/boards/{boardId}/tasks/{id}/checklist/{index}`

**Edit checklist item (board-scoped)**

Edits one checklist item on the specified board and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Single-line checklist item text. Markdown task markers are optional on input and are canonicalized. |
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the edit is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### DELETE `/api/boards/{boardId}/tasks/{id}/checklist/{index}`

**Delete checklist item (board-scoped)**

Deletes one checklist item on the specified board and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/checklist/{index}/check`

**Check checklist item (board-scoped)**

Marks one checklist item complete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/checklist/{index}/uncheck`

**Uncheck checklist item (board-scoped)**

Marks one checklist item incomplete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `index` | path | integer | Yes | Zero-based checklist item index |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `expectedRaw` | string | No | Optional optimistic-concurrency guard that must match the caller-visible raw checklist line before the mutation is applied. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated checklist. |
| `400` | Validation error. |
| `404` | Not found. |

### PATCH `/api/boards/{boardId}/tasks/{id}/move`

**Move task (board-scoped)**

Moves a task to a different column and/or position within the board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `status` | string | Yes | Target column. |
| `position` | integer | No | Zero-based position (default: `0`). |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated task. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/forms/{formId}/submit`

**Submit task form (board-scoped)**

Validates and persists a card form submission. Merge order: config defaults → card attachment defaults / existing formData → matching card metadata → submitted data. Emits the `form.submit` webhook event.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `formId` | path | string | Yes | Form identifier |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `data` | object | Yes | Submitted field values. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Submission result. |
| `400` | Validation error. |

### POST `/api/boards/{boardId}/tasks/{id}/actions/{action}`

**Trigger task action (board-scoped)**

Fires the configured webhook for the named card-level action.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `action` | path | string | Yes | Action key |

#### Responses

| Status | Description |
|--------|-------------|
| `204` | Triggered. |
| `400` | Error. |
| `404` | Not found. |

### DELETE `/api/boards/{boardId}/tasks/{id}/permanent`

**Permanently delete task (board-scoped)**

Permanently and irreversibly removes the task. This cannot be undone.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `404` | Not found. |

### POST `/api/boards/{boardId}/tasks/{id}/transfer`

**Transfer task to another board**

Moves a task from the current board context to the specified destination board. The `:boardId` path segment is the **destination** board. The source board is the server's currently active board context.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `targetStatus` | string | No | Status in the destination board (defaults to the board's default status). |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Transferred task. |
| `400` | Error. |

## Columns

Column management for the default board

### GET `/api/columns`

**List columns**

Returns the ordered column definitions for the default board.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Column list. |

### POST `/api/columns`

**Add column**

Creates a new column on the default board. New columns are appended to the end of the board's current column order.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Unique column identifier. |
| `name` | string | Yes | Display name. |
| `color` | string | No | Hex color (default: `#6b7280`). |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Created. |
| `400` | Validation error. |

### PUT `/api/columns/reorder`

**Reorder columns**

Reorders the columns for the specified board (or default board if `boardId` is omitted).

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | query | string | No | Target board ID (uses default if omitted). |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `columnIds` | string[] | Yes | Ordered array of column IDs. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Reordered columns. |
| `400` | Error. |

### PUT `/api/columns/minimized`

**Set minimized columns**

Sets which columns are minimized for the specified board (or default board if `boardId` is omitted).

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | query | string | No | Target board ID (uses default if omitted). |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `columnIds` | string[] | Yes | IDs of columns to minimize. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated minimized columns. |
| `400` | Error. |

### PUT `/api/columns/{id}`

**Update column**

Updates a column's display name and/or color on the default board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Column identifier. |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | No | New display name. |
| `color` | string | No | New hex color. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated column. |
| `404` | Not found. |

### DELETE `/api/columns/{id}`

**Delete column**

Deletes a column on the default board. Fails if the column still contains tasks.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Column identifier. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `400` | Column not empty. |

## Comments

Task comment threads

### GET `/api/tasks/{id}/comments`

**List comments**

Returns all comments currently attached to the task, in stored order.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Comment list. |
| `404` | Task not found. |

### POST `/api/tasks/{id}/comments`

**Add comment**

Adds a new comment to the task and emits the `comment.created` webhook event.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `author` | string | Yes | Comment author. |
| `content` | string | Yes | Comment body (Markdown). |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Created comment. |
| `400` | Validation error (missing author or content). |
| `404` | Task not found. |

### PUT `/api/tasks/{id}/comments/{commentId}`

**Update comment**

Updates the Markdown content of an existing comment.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `commentId` | path | string | Yes | Comment identifier |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `content` | string | Yes | New comment body (Markdown). |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated comment. |
| `404` | Comment not found. |

### DELETE `/api/tasks/{id}/comments/{commentId}`

**Delete comment**

Deletes the specified comment from the task.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `commentId` | path | string | Yes | Comment identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `404` | Not found. |

## Attachments

File attachments on tasks

### POST `/api/tasks/{id}/attachments`

**Upload attachments**

Uploads one or more files as task attachments. Files are sent as base64-encoded strings in a JSON body and stored through the active attachment-storage provider.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `files` | object[] | Yes | Array of files to upload. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated task including new attachment references. |
| `400` | Validation error (missing or malformed `files` array). |
| `404` | Task not found. |

### GET `/api/tasks/{id}/attachments/{filename}`

**Download attachment**

Materializes and streams the named attachment back to the client. Most browsers render known types (PDFs, images) inline unless `?download=1` is set.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `filename` | path | string | Yes | Attachment filename |
| `download` | query | `0` \\| `1` | No | Set to `1` to force a download prompt instead of inline display. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | File content with appropriate Content-Type. |
| `404` | Task or attachment not found. |
| `501` | Attachment provider does not expose a local file path. |

### DELETE `/api/tasks/{id}/attachments/{filename}`

**Delete attachment**

Removes the named attachment from the task and deletes the provider-backed payload when supported.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |
| `filename` | path | string | Yes | Attachment filename |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated task. |
| `404` | Task not found. |

## Logs

Append-only log entries on tasks and boards

### GET `/api/boards/{boardId}/logs`

**List board logs**

Returns all board-level log entries.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Log entries. |

### POST `/api/boards/{boardId}/logs`

**Add board log**

Appends a log entry to the board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Log message text (supports Markdown). |
| `source` | string | No | Source/origin label (default: `"default"`). |
| `object` | object | No | Optional structured data stored as JSON. |
| `timestamp` | string | No | ISO 8601 timestamp (auto-generated if omitted). |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Created. |
| `400` | Error. |

### DELETE `/api/boards/{boardId}/logs`

**Clear board logs**

Removes all board-level log entries.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | string | Yes | Board identifier |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Cleared. |

### GET `/api/tasks/{id}/logs`

**List task logs**

Returns all log entries for the task.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Log entries. |
| `404` | Not found. |

### POST `/api/tasks/{id}/logs`

**Add task log**

Appends a log entry to the task.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Log message text (supports Markdown). |
| `source` | string | No | Source/origin label (default: `"default"`). |
| `object` | object | No | Optional structured data stored as JSON. |
| `timestamp` | string | No | ISO 8601 timestamp (auto-generated if omitted). |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Created. |
| `400` | Error. |
| `404` | Not found. |

### DELETE `/api/tasks/{id}/logs`

**Clear task logs**

Removes all log entries for the task.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Task/card identifier (supports partial ID matching) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Cleared. |
| `404` | Not found. |

## Settings

Workspace display settings

### GET `/api/settings`

**Get settings**

Returns the workspace's current display and behavior settings used by the UI surfaces.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Settings object. |

### PUT `/api/settings`

**Update settings**

Updates workspace display settings and immediately broadcasts the change to connected WebSocket clients.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `showPriorityBadges` | boolean | No | — |
| `showAssignee` | boolean | No | — |
| `showDueDate` | boolean | No | — |
| `showLabels` | boolean | No | — |
| `showFileName` | boolean | No | — |
| `showDeletedColumn` | boolean | No | — |
| `defaultPriority` | string | No | — |
| `defaultStatus` | string | No | — |
| `boardBackgroundMode` | `fancy` \\| `plain` | No | — |
| `boardBackgroundPreset` | `aurora` \\| `sunset` \\| `meadow` \\| `nebula` \\| `lagoon` \\| `candy` \\| `ember` \\| `violet` \\| `paper` \\| `mist` \\| `sand` | No | — |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated settings. |
| `400` | Error. |

## Plugins

Plugin discovery, selection, options, and guarded installation

### GET `/api/plugin-settings`

**List plugin providers**

Returns the capability-grouped plugin inventory with selected-provider state and shared redaction metadata. Secret values are never included in this list payload. When auth is active, callers must be authenticated and allowed to perform `plugin-settings.read`; redaction supplements authorization rather than replacing it.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Capability-grouped plugin inventory. |
| `401` | Authentication required. |
| `403` | Authenticated caller is not allowed to perform `plugin-settings.read`. |
| `500` | Unable to list plugin settings. |

### GET `/api/plugin-settings/{capability}/{providerId}`

**Read plugin settings**

Returns the redacted plugin-settings read model for one provider. Persisted secret fields are masked and surfaced only as write-only placeholders. When auth is active, callers must be authenticated and allowed to perform `plugin-settings.read`; allowed reads remain redacted.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `capability` | path | string | Yes | Plugin capability namespace (for example `auth.identity` or `card.storage`). |
| `providerId` | path | string | Yes | Plugin provider identifier within the selected capability. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Redacted provider read model. |
| `401` | Authentication required. |
| `403` | Authenticated caller is not allowed to perform `plugin-settings.read`. |
| `404` | Provider not found for the requested capability. |
| `500` | Unable to read plugin settings. |

### PUT `/api/plugin-settings/{capability}/{providerId}/select`

**Select plugin provider**

Persists the selected provider for one capability. Existing authorization wrappers remain in force for this privileged mutation.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `capability` | path | string | Yes | Plugin capability namespace (for example `auth.identity` or `card.storage`). |
| `providerId` | path | string | Yes | Plugin provider identifier within the selected capability. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated redacted provider read model after selection. |
| `403` | Forbidden. |
| `404` | Provider not found for the requested capability. |
| `500` | Unable to persist the selected provider. |

### PUT `/api/plugin-settings/{capability}/{providerId}/options`

**Update plugin options**

Persists provider options and returns the redacted provider read model. Secret placeholders may be submitted unchanged to preserve existing stored secrets.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `capability` | path | string | Yes | Plugin capability namespace (for example `auth.identity` or `card.storage`). |
| `providerId` | path | string | Yes | Plugin provider identifier within the selected capability. |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `options` | object | No | Provider options payload to persist under the selected capability/provider pair. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated redacted provider read model after persisting options. |
| `400` | Invalid options payload. |
| `403` | Forbidden. |
| `404` | Provider not found for the requested capability. |
| `500` | Unable to persist plugin options. |

### POST `/api/plugin-settings/install`

**Install plugin package**

Runs the guarded in-product installer for exact unscoped `kl-*` package names only. Responses surface redacted diagnostics and never expose raw installer stdout/stderr.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `packageName` | string | Yes | Exact unscoped `kl-*` package name. |
| `scope` | `workspace` \\| `global` | Yes | Install destination. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Redacted install result. |
| `400` | Rejected input or redacted install failure. |
| `403` | Forbidden. |
| `500` | Unexpected installer error. |

## Labels

Label definitions and cascading renames

### GET `/api/labels`

**List labels**

Returns all label definitions with their colors and groups.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Label map. |

### PUT `/api/labels/{name}`

**Set label**

Creates or updates a label definition (color and optional group).

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | path | string | Yes | Label name (URL-encoded) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `color` | string | Yes | Hex color string. |
| `group` | string | No | Optional group name. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated label map. |
| `400` | Error. |

### PATCH `/api/labels/{name}`

**Rename label**

Renames a label and cascades the change to all cards that use it.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | path | string | Yes | Label name (URL-encoded) |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `newName` | string | Yes | New label name. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Updated label map after rename. |
| `400` | Error. |

### DELETE `/api/labels/{name}`

**Delete label**

Deletes a label definition and removes it from all cards that reference it.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | path | string | Yes | Label name (URL-encoded) |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Deleted. |
| `400` | Error. |

## Workspace

Workspace metadata, storage, and auth status

### GET `/api/card-state/status`

**Get card-state status**

Returns the active `card.state` provider status for the standalone runtime, including backend family, availability, the stable auth-absent default actor contract, and whether a configured `auth.identity` provider is currently causing `identity-unavailable` failures.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Card-state provider status. |

### GET `/api/workspace`

**Get workspace info**

Returns workspace-level connection metadata plus resolved storage, auth, webhook, and `card.state` provider information, including filesystem watcher support.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Workspace info. |

### GET `/api/auth`

**Get auth status**

Returns auth provider metadata plus safe request-scoped token diagnostics for the current standalone HTTP request.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Auth status. |

### GET `/api/storage`

**Get storage status**

Returns the active card, attachment, webhook, and `card.state` provider IDs plus host-facing file/watch metadata.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Storage status. |

### GET `/api/events`

**List available events**

Returns discoverable SDK events, including built-in before/after events and any plugin-declared additions. Supports filtering by phase and wildcard mask.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `type` | query | `before` \\| `after` \\| `all` | No | Optional event phase filter. Defaults to `all`. |
| `mask` | query | string | No | Optional EventEmitter2-style wildcard mask such as `task.*` or `comment.**`. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Available event descriptors. |
| `400` | Invalid type filter. |

### POST `/api/storage/migrate-to-sqlite`

**Migrate to SQLite**

Migrates cards from the built-in markdown provider to the first-party `sqlite` compatibility provider (`kl-plugin-storage-sqlite`) and updates compatibility config fields in `.kanban.json`. This endpoint does not migrate into arbitrary external providers.

#### Request Body

Required: No

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `sqlitePath` | string | No | Optional database path relative to workspace root. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Migration result. |
| `400` | Error. |

### POST `/api/storage/migrate-to-markdown`

**Migrate to Markdown**

Migrates cards from the built-in SQLite provider back to markdown files and updates compatibility config fields. Existing source data is left in place as a manual backup.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Migration result. |
| `400` | Error. |

### GET `/api/resolve-path`

**Resolve path**

Resolves a workspace-relative, absolute, or `~`-prefixed path to its canonical absolute filesystem path.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | Yes | Path to resolve. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Resolved absolute path. |
| `400` | Path parameter missing. |

## Mobile

Minimal mobile bootstrap and opaque local-session contract for the Expo field app.

### POST `/api/mobile/bootstrap`

**Resolve mobile workspace bootstrap**

Normalizes a typed workspace origin, deep link, or QR payload into the canonical local-auth mobile bootstrap contract. When a one-time bootstrap token is present, the response keeps the client on the token-redemption branch instead of inventing a second login abstraction.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceOrigin` | string | Yes | Typed workspace origin, app base URL, or canonical link origin. |
| `bootstrapToken` | string | No | Optional one-time bootstrap token carried by a deep link or QR code. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Canonical workspace bootstrap metadata. |
| `400` | Invalid workspace origin or request payload. |

### POST `/api/mobile/session`

**Create a mobile opaque bearer session**

Available when the local standalone auth provider is active. Exchanges local credentials or a validated one-time bootstrap token for a server-backed opaque mobile bearer session without reusing the browser cookie transport.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceOrigin` | string | Yes | Workspace origin to bind to the created mobile session. |
| `username` | string | No | Local username for direct mobile login. |
| `password` | string | No | Local password for direct mobile login. |
| `bootstrapToken` | string | No | One-time bootstrap token to redeem instead of sending credentials. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Opaque mobile session created successfully. |
| `400` | Invalid payload or missing required fields. |
| `401` | Invalid credentials or bootstrap token. |
| `403` | Bootstrap token or session is not valid for the requested workspace. |

### GET `/api/mobile/session`

**Validate a stored mobile session**

Validates a previously issued opaque mobile bearer token for cold-start and resume gating. Shared automation tokens and browser cookie sessions are not accepted here.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `workspaceOrigin` | query | string | Yes | Workspace origin expected by the mobile cache namespace. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Mobile session is valid for the requested workspace. |
| `400` | Missing or invalid workspaceOrigin query parameter. |
| `401` | Opaque mobile bearer token is missing, invalid, or expired. |
| `403` | Session belongs to a different workspace namespace. |

### DELETE `/api/mobile/session`

**Revoke a stored mobile session**

Revokes the current opaque mobile bearer token for mobile logout. Shared automation tokens and browser cookie sessions are not accepted here.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Mobile session revoked successfully. |
| `401` | Opaque mobile bearer token is missing, invalid, or expired. |

## Webhooks

Webhook registration endpoints. These routes are registered by the active standalone webhook plugin while preserving the public `/api/webhooks` contract.

### GET `/api/webhooks`

**List webhooks**

Returns all registered webhooks. Runtime ownership stays on the active standalone webhook plugin, which preserves this public path.

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Webhook list. |
| `401` | Authentication required. |
| `403` | Forbidden. |

### POST `/api/webhooks`

**Create webhook**

Registers a new webhook endpoint through the active standalone webhook plugin.

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | Yes | Target HTTP(S) URL. |
| `events` | string[] | Yes | Subscribed event names, or `["*"]` for all events. |
| `secret` | string | No | Optional HMAC signing secret. |

#### Responses

| Status | Description |
|--------|-------------|
| `201` | Webhook created. |
| `400` | Validation error. |
| `401` | Authentication required. |
| `403` | Forbidden. |

### PUT `/api/webhooks/{id}`

**Update webhook**

Updates an existing webhook by id through the active standalone webhook plugin.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Webhook identifier. |

#### Request Body

Required: Yes

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | No | Updated HTTP(S) URL. |
| `events` | string[] | No | Updated event filter list. |
| `secret` | string | No | Updated HMAC signing secret. |
| `active` | boolean | No | Whether the webhook is active. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Webhook updated. |
| `401` | Authentication required. |
| `403` | Forbidden. |
| `404` | Webhook not found. |

### DELETE `/api/webhooks/{id}`

**Delete webhook**

Deletes a webhook by id through the active standalone webhook plugin.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | Yes | Webhook identifier. |

#### Responses

| Status | Description |
|--------|-------------|
| `200` | Webhook deleted. |
| `401` | Authentication required. |
| `403` | Forbidden. |
| `404` | Webhook not found. |

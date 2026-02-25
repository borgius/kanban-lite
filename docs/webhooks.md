# Webhooks

Kanban Lite fires webhooks on every mutation — task, comment, column, attachment, settings, and board changes. Webhooks are delivered via HTTP POST to any registered endpoint.

## Overview

- Webhooks fire from **all interfaces**: REST API, CLI, MCP server, and the UI (via the standalone server).
- Events are emitted by the SDK's `onEvent` callback, ensuring consistent behavior regardless of entry point.
- Webhook registrations are stored in `.kanban.json` and persist across server restarts.
- Delivery is asynchronous and fire-and-forget (10-second timeout, failures are logged but do not block).

## Configuration

Webhooks are stored in your project's `.kanban.json` file:

```json
{
  "columns": [...],
  "webhooks": [
    {
      "id": "wh_a1b2c3d4e5f67890",
      "url": "https://example.com/webhook",
      "events": ["task.created", "task.moved"],
      "secret": "my-signing-key",
      "active": true
    }
  ]
}
```

## Managing Webhooks

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/webhooks` | List all webhooks |
| `POST` | `/api/webhooks` | Register a new webhook |
| `PUT` | `/api/webhooks/:id` | Update a webhook |
| `DELETE` | `/api/webhooks/:id` | Delete a webhook |

### CLI

```bash
# List webhooks
kl webhooks list

# Register a webhook
kl webhooks add --url https://example.com/hook --events task.created,task.moved

# Update a webhook
kl webhooks update <id> --active false
kl webhooks update <id> --events task.created,task.deleted --url https://new-url.com

# Delete a webhook
kl webhooks delete <id>
```

### MCP Server

Tools: `list_webhooks`, `create_webhook`, `update_webhook`, `delete_webhook`

## Payload Format

Every webhook delivery sends a JSON POST request with the following structure:

```json
{
  "event": "task.created",
  "timestamp": "2026-02-24T12:00:00.000Z",
  "data": { ... }
}
```

**Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Webhook-Event` | The event type (e.g., `task.created`) |
| `X-Webhook-Signature` | HMAC-SHA256 signature (only if a secret is configured) |

## Signature Verification

If you provide a `secret` when registering a webhook, every delivery includes an `X-Webhook-Signature` header with the format `sha256=<hex-digest>`.

To verify:

```javascript
const crypto = require('crypto')

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

## Delivery Behavior

- Webhooks are delivered **asynchronously** — the SDK operation completes without waiting for delivery.
- Each delivery has a **10-second timeout**.
- Failed deliveries are logged to stderr but **do not retry**.
- Only HTTP `2xx` responses are considered successful.
- Inactive webhooks (`active: false`) are skipped.
- Subscribing to `["*"]` matches all events.

---

## Event Reference

| Event | Category | Description |
|-------|----------|-------------|
| `task.created` | Task | A new task was created. |
| `task.updated` | Task | A task was updated (fields changed, not moved). |
| `task.moved` | Task | A task was moved to a different column or transferred between boards. |
| `task.deleted` | Task | A task was permanently deleted. |
| `comment.created` | Comment | A comment was added to a task. |
| `comment.updated` | Comment | A comment was edited. |
| `comment.deleted` | Comment | A comment was removed from a task. |
| `column.created` | Column | A new column was added to a board. |
| `column.updated` | Column | A column was renamed or its color changed. |
| `column.deleted` | Column | A column was removed from a board. |
| `attachment.added` | Attachment | A file was attached to a task. |
| `attachment.removed` | Attachment | A file was removed from a task. |
| `settings.updated` | Settings | Board display settings were changed. |
| `board.created` | Board | A new board was created. |
| `board.updated` | Board | A board configuration was changed. |
| `board.deleted` | Board | A board was deleted. |

### Task Events

#### `task.created`

A new task was created.

**Trigger:** Creating a task via API, CLI, MCP, or the UI.

**Example payload:**

```json
{
  "event": "task.created",
  "timestamp": "2026-02-24T12:00:00.000Z",
  "data": {
    "id": "fix-login-bug-2026-02-24",
    "status": "backlog",
    "priority": "critical",
    "assignee": "alice",
    "labels": ["bug", "auth"],
    "dueDate": null,
    "comments": [],
    "attachments": [],
    "created": "2026-02-24T12:00:00.000Z",
    "modified": "2026-02-24T12:00:00.000Z"
  }
}
```

#### `task.updated`

A task was updated (fields changed, not moved).

**Trigger:** Updating task content, priority, assignee, labels, or due date.

**Example payload:**

```json
{
  "event": "task.updated",
  "timestamp": "2026-02-24T12:05:00.000Z",
  "data": {
    "id": "fix-login-bug-2026-02-24",
    "status": "backlog",
    "priority": "high",
    "assignee": "bob",
    "labels": ["bug"],
    "dueDate": "2026-03-01",
    "comments": [],
    "attachments": [],
    "created": "2026-02-24T12:00:00.000Z",
    "modified": "2026-02-24T12:05:00.000Z"
  }
}
```

#### `task.moved`

A task was moved to a different column or transferred between boards.

**Trigger:** Moving a task to a new status, or transferring it to another board.

**Example payload:**

```json
{
  "event": "task.moved",
  "timestamp": "2026-02-24T12:10:00.000Z",
  "data": {
    "id": "fix-login-bug-2026-02-24",
    "status": "in-progress",
    "previousStatus": "backlog",
    "priority": "high",
    "assignee": "bob",
    "modified": "2026-02-24T12:10:00.000Z"
  }
}
```

#### `task.deleted`

A task was permanently deleted.

**Trigger:** Deleting a task via API, CLI, MCP, or the UI.

**Example payload:**

```json
{
  "event": "task.deleted",
  "timestamp": "2026-02-24T12:15:00.000Z",
  "data": {
    "id": "fix-login-bug-2026-02-24",
    "status": "in-progress",
    "priority": "high"
  }
}
```

### Comment Events

#### `comment.created`

A comment was added to a task.

**Trigger:** Adding a comment to any task.

**Example payload:**

```json
{
  "event": "comment.created",
  "timestamp": "2026-02-24T12:20:00.000Z",
  "data": {
    "id": 1,
    "author": "alice",
    "content": "Looks good, needs tests",
    "date": "2026-02-24T12:20:00.000Z",
    "cardId": "fix-login-bug-2026-02-24"
  }
}
```

#### `comment.updated`

A comment was edited.

**Trigger:** Updating the content of an existing comment.

**Example payload:**

```json
{
  "event": "comment.updated",
  "timestamp": "2026-02-24T12:25:00.000Z",
  "data": {
    "id": 1,
    "author": "alice",
    "content": "Updated: Looks great, tests added",
    "date": "2026-02-24T12:20:00.000Z",
    "cardId": "fix-login-bug-2026-02-24"
  }
}
```

#### `comment.deleted`

A comment was removed from a task.

**Trigger:** Deleting a comment from any task.

**Example payload:**

```json
{
  "event": "comment.deleted",
  "timestamp": "2026-02-24T12:30:00.000Z",
  "data": {
    "id": 1,
    "author": "alice",
    "content": "Updated: Looks great, tests added",
    "date": "2026-02-24T12:20:00.000Z",
    "cardId": "fix-login-bug-2026-02-24"
  }
}
```

### Column Events

#### `column.created`

A new column was added to a board.

**Trigger:** Adding a column via API, CLI, MCP, or settings.

**Example payload:**

```json
{
  "event": "column.created",
  "timestamp": "2026-02-24T13:00:00.000Z",
  "data": {
    "id": "testing",
    "name": "Testing",
    "color": "#ff9900"
  }
}
```

#### `column.updated`

A column was renamed or its color changed.

**Trigger:** Updating column name or color.

**Example payload:**

```json
{
  "event": "column.updated",
  "timestamp": "2026-02-24T13:05:00.000Z",
  "data": {
    "id": "testing",
    "name": "QA Testing",
    "color": "#ff9900"
  }
}
```

#### `column.deleted`

A column was removed from a board.

**Trigger:** Deleting an empty column.

**Example payload:**

```json
{
  "event": "column.deleted",
  "timestamp": "2026-02-24T13:10:00.000Z",
  "data": {
    "id": "testing",
    "name": "QA Testing",
    "color": "#ff9900"
  }
}
```

### Attachment Events

#### `attachment.added`

A file was attached to a task.

**Trigger:** Uploading or adding an attachment to any task.

**Example payload:**

```json
{
  "event": "attachment.added",
  "timestamp": "2026-02-24T13:15:00.000Z",
  "data": {
    "cardId": "fix-login-bug-2026-02-24",
    "attachment": "screenshot.png"
  }
}
```

#### `attachment.removed`

A file was removed from a task.

**Trigger:** Deleting an attachment from any task.

**Example payload:**

```json
{
  "event": "attachment.removed",
  "timestamp": "2026-02-24T13:20:00.000Z",
  "data": {
    "cardId": "fix-login-bug-2026-02-24",
    "attachment": "screenshot.png"
  }
}
```

### Settings Events

#### `settings.updated`

Board display settings were changed.

**Trigger:** Updating settings via API, CLI, MCP, or the UI.

**Example payload:**

```json
{
  "event": "settings.updated",
  "timestamp": "2026-02-24T13:25:00.000Z",
  "data": {
    "showPriorityBadges": true,
    "showAssignee": true,
    "showDueDate": true,
    "showLabels": true,
    "compactMode": true,
    "showFileName": false,
    "defaultPriority": "medium",
    "defaultStatus": "backlog"
  }
}
```

### Board Events

#### `board.created`

A new board was created.

**Trigger:** Creating a board via API, CLI, or MCP.

**Example payload:**

```json
{
  "event": "board.created",
  "timestamp": "2026-02-24T14:00:00.000Z",
  "data": {
    "id": "bugs",
    "name": "Bug Tracker",
    "description": "Track production bugs"
  }
}
```

#### `board.updated`

A board configuration was changed.

**Trigger:** Updating board name, description, or columns.

**Example payload:**

```json
{
  "event": "board.updated",
  "timestamp": "2026-02-24T14:05:00.000Z",
  "data": {
    "id": "bugs",
    "name": "Bug Tracker v2"
  }
}
```

#### `board.deleted`

A board was deleted.

**Trigger:** Deleting an empty board via API, CLI, or MCP.

**Example payload:**

```json
{
  "event": "board.deleted",
  "timestamp": "2026-02-24T14:10:00.000Z",
  "data": {
    "id": "bugs"
  }
}
```

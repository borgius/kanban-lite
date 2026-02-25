#!/usr/bin/env npx tsx
/**
 * Generates docs/webhooks.md from structured event metadata.
 *
 * All webhook documentation lives in this file as structured data.
 * To update webhook docs, edit the metadata below and run:
 *   npx tsx scripts/generate-webhooks-docs.ts
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'webhooks.md')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventMeta {
  event: string
  category: string
  description: string
  trigger: string
  payload: string
}

// ---------------------------------------------------------------------------
// Event metadata — the single source of truth for docs/webhooks.md
// ---------------------------------------------------------------------------

const EVENTS: EventMeta[] = [
  // Task events
  {
    event: 'task.created',
    category: 'Task',
    description: 'A new task was created.',
    trigger: 'Creating a task via API, CLI, MCP, or the UI.',
    payload: `{
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
}`,
  },
  {
    event: 'task.updated',
    category: 'Task',
    description: 'A task was updated (fields changed, not moved).',
    trigger: 'Updating task content, priority, assignee, labels, or due date.',
    payload: `{
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
}`,
  },
  {
    event: 'task.moved',
    category: 'Task',
    description: 'A task was moved to a different column or transferred between boards.',
    trigger: 'Moving a task to a new status, or transferring it to another board.',
    payload: `{
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
}`,
  },
  {
    event: 'task.deleted',
    category: 'Task',
    description: 'A task was permanently deleted.',
    trigger: 'Deleting a task via API, CLI, MCP, or the UI.',
    payload: `{
  "event": "task.deleted",
  "timestamp": "2026-02-24T12:15:00.000Z",
  "data": {
    "id": "fix-login-bug-2026-02-24",
    "status": "in-progress",
    "priority": "high"
  }
}`,
  },

  // Comment events
  {
    event: 'comment.created',
    category: 'Comment',
    description: 'A comment was added to a task.',
    trigger: 'Adding a comment to any task.',
    payload: `{
  "event": "comment.created",
  "timestamp": "2026-02-24T12:20:00.000Z",
  "data": {
    "id": 1,
    "author": "alice",
    "content": "Looks good, needs tests",
    "date": "2026-02-24T12:20:00.000Z",
    "cardId": "fix-login-bug-2026-02-24"
  }
}`,
  },
  {
    event: 'comment.updated',
    category: 'Comment',
    description: 'A comment was edited.',
    trigger: 'Updating the content of an existing comment.',
    payload: `{
  "event": "comment.updated",
  "timestamp": "2026-02-24T12:25:00.000Z",
  "data": {
    "id": 1,
    "author": "alice",
    "content": "Updated: Looks great, tests added",
    "date": "2026-02-24T12:20:00.000Z",
    "cardId": "fix-login-bug-2026-02-24"
  }
}`,
  },
  {
    event: 'comment.deleted',
    category: 'Comment',
    description: 'A comment was removed from a task.',
    trigger: 'Deleting a comment from any task.',
    payload: `{
  "event": "comment.deleted",
  "timestamp": "2026-02-24T12:30:00.000Z",
  "data": {
    "id": 1,
    "author": "alice",
    "content": "Updated: Looks great, tests added",
    "date": "2026-02-24T12:20:00.000Z",
    "cardId": "fix-login-bug-2026-02-24"
  }
}`,
  },

  // Column events
  {
    event: 'column.created',
    category: 'Column',
    description: 'A new column was added to a board.',
    trigger: 'Adding a column via API, CLI, MCP, or settings.',
    payload: `{
  "event": "column.created",
  "timestamp": "2026-02-24T13:00:00.000Z",
  "data": {
    "id": "testing",
    "name": "Testing",
    "color": "#ff9900"
  }
}`,
  },
  {
    event: 'column.updated',
    category: 'Column',
    description: 'A column was renamed or its color changed.',
    trigger: 'Updating column name or color.',
    payload: `{
  "event": "column.updated",
  "timestamp": "2026-02-24T13:05:00.000Z",
  "data": {
    "id": "testing",
    "name": "QA Testing",
    "color": "#ff9900"
  }
}`,
  },
  {
    event: 'column.deleted',
    category: 'Column',
    description: 'A column was removed from a board.',
    trigger: 'Deleting an empty column.',
    payload: `{
  "event": "column.deleted",
  "timestamp": "2026-02-24T13:10:00.000Z",
  "data": {
    "id": "testing",
    "name": "QA Testing",
    "color": "#ff9900"
  }
}`,
  },

  // Attachment events
  {
    event: 'attachment.added',
    category: 'Attachment',
    description: 'A file was attached to a task.',
    trigger: 'Uploading or adding an attachment to any task.',
    payload: `{
  "event": "attachment.added",
  "timestamp": "2026-02-24T13:15:00.000Z",
  "data": {
    "cardId": "fix-login-bug-2026-02-24",
    "attachment": "screenshot.png"
  }
}`,
  },
  {
    event: 'attachment.removed',
    category: 'Attachment',
    description: 'A file was removed from a task.',
    trigger: 'Deleting an attachment from any task.',
    payload: `{
  "event": "attachment.removed",
  "timestamp": "2026-02-24T13:20:00.000Z",
  "data": {
    "cardId": "fix-login-bug-2026-02-24",
    "attachment": "screenshot.png"
  }
}`,
  },

  // Settings events
  {
    event: 'settings.updated',
    category: 'Settings',
    description: 'Board display settings were changed.',
    trigger: 'Updating settings via API, CLI, MCP, or the UI.',
    payload: `{
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
}`,
  },

  // Board events
  {
    event: 'board.created',
    category: 'Board',
    description: 'A new board was created.',
    trigger: 'Creating a board via API, CLI, or MCP.',
    payload: `{
  "event": "board.created",
  "timestamp": "2026-02-24T14:00:00.000Z",
  "data": {
    "id": "bugs",
    "name": "Bug Tracker",
    "description": "Track production bugs"
  }
}`,
  },
  {
    event: 'board.updated',
    category: 'Board',
    description: 'A board configuration was changed.',
    trigger: 'Updating board name, description, or columns.',
    payload: `{
  "event": "board.updated",
  "timestamp": "2026-02-24T14:05:00.000Z",
  "data": {
    "id": "bugs",
    "name": "Bug Tracker v2"
  }
}`,
  },
  {
    event: 'board.deleted',
    category: 'Board',
    description: 'A board was deleted.',
    trigger: 'Deleting an empty board via API, CLI, or MCP.',
    payload: `{
  "event": "board.deleted",
  "timestamp": "2026-02-24T14:10:00.000Z",
  "data": {
    "id": "bugs"
  }
}`,
  },
]

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function generate(): string {
  const lines: string[] = []

  lines.push('# Webhooks')
  lines.push('')
  lines.push('Kanban Lite fires webhooks on every mutation — task, comment, column, attachment, settings, and board changes. Webhooks are delivered via HTTP POST to any registered endpoint.')
  lines.push('')
  lines.push('## Overview')
  lines.push('')
  lines.push('- Webhooks fire from **all interfaces**: REST API, CLI, MCP server, and the UI (via the standalone server).')
  lines.push('- Events are emitted by the SDK\'s `onEvent` callback, ensuring consistent behavior regardless of entry point.')
  lines.push('- Webhook registrations are stored in `.kanban.json` and persist across server restarts.')
  lines.push('- Delivery is asynchronous and fire-and-forget (10-second timeout, failures are logged but do not block).')
  lines.push('')

  // Configuration section
  lines.push('## Configuration')
  lines.push('')
  lines.push('Webhooks are stored in your project\'s `.kanban.json` file:')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "columns": [...],')
  lines.push('  "webhooks": [')
  lines.push('    {')
  lines.push('      "id": "wh_a1b2c3d4e5f67890",')
  lines.push('      "url": "https://example.com/webhook",')
  lines.push('      "events": ["task.created", "task.moved"],')
  lines.push('      "secret": "my-signing-key",')
  lines.push('      "active": true')
  lines.push('    }')
  lines.push('  ]')
  lines.push('}')
  lines.push('```')
  lines.push('')

  // CRUD section
  lines.push('## Managing Webhooks')
  lines.push('')
  lines.push('### REST API')
  lines.push('')
  lines.push('| Method | Endpoint | Description |')
  lines.push('|--------|----------|-------------|')
  lines.push('| `GET` | `/api/webhooks` | List all webhooks |')
  lines.push('| `POST` | `/api/webhooks` | Register a new webhook |')
  lines.push('| `PUT` | `/api/webhooks/:id` | Update a webhook |')
  lines.push('| `DELETE` | `/api/webhooks/:id` | Delete a webhook |')
  lines.push('')
  lines.push('### CLI')
  lines.push('')
  lines.push('```bash')
  lines.push('# List webhooks')
  lines.push('kl webhooks list')
  lines.push('')
  lines.push('# Register a webhook')
  lines.push('kl webhooks add --url https://example.com/hook --events task.created,task.moved')
  lines.push('')
  lines.push('# Update a webhook')
  lines.push('kl webhooks update <id> --active false')
  lines.push('kl webhooks update <id> --events task.created,task.deleted --url https://new-url.com')
  lines.push('')
  lines.push('# Delete a webhook')
  lines.push('kl webhooks delete <id>')
  lines.push('```')
  lines.push('')
  lines.push('### MCP Server')
  lines.push('')
  lines.push('Tools: `list_webhooks`, `create_webhook`, `update_webhook`, `delete_webhook`')
  lines.push('')

  // Payload format
  lines.push('## Payload Format')
  lines.push('')
  lines.push('Every webhook delivery sends a JSON POST request with the following structure:')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "event": "task.created",')
  lines.push('  "timestamp": "2026-02-24T12:00:00.000Z",')
  lines.push('  "data": { ... }')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('**Headers:**')
  lines.push('')
  lines.push('| Header | Description |')
  lines.push('|--------|-------------|')
  lines.push('| `Content-Type` | `application/json` |')
  lines.push('| `X-Webhook-Event` | The event type (e.g., `task.created`) |')
  lines.push('| `X-Webhook-Signature` | HMAC-SHA256 signature (only if a secret is configured) |')
  lines.push('')

  // Signing
  lines.push('## Signature Verification')
  lines.push('')
  lines.push('If you provide a `secret` when registering a webhook, every delivery includes an `X-Webhook-Signature` header with the format `sha256=<hex-digest>`.')
  lines.push('')
  lines.push('To verify:')
  lines.push('')
  lines.push('```javascript')
  lines.push('const crypto = require(\'crypto\')')
  lines.push('')
  lines.push('function verifySignature(payload, signature, secret) {')
  lines.push('  const expected = \'sha256=\' + crypto')
  lines.push('    .createHmac(\'sha256\', secret)')
  lines.push('    .update(payload)')
  lines.push('    .digest(\'hex\')')
  lines.push('  return crypto.timingSafeEqual(')
  lines.push('    Buffer.from(signature),')
  lines.push('    Buffer.from(expected)')
  lines.push('  )')
  lines.push('}')
  lines.push('```')
  lines.push('')

  // Delivery
  lines.push('## Delivery Behavior')
  lines.push('')
  lines.push('- Webhooks are delivered **asynchronously** — the SDK operation completes without waiting for delivery.')
  lines.push('- Each delivery has a **10-second timeout**.')
  lines.push('- Failed deliveries are logged to stderr but **do not retry**.')
  lines.push('- Only HTTP `2xx` responses are considered successful.')
  lines.push('- Inactive webhooks (`active: false`) are skipped.')
  lines.push('- Subscribing to `["*"]` matches all events.')
  lines.push('')

  // Event reference
  lines.push('---')
  lines.push('')
  lines.push('## Event Reference')
  lines.push('')

  // Summary table
  lines.push('| Event | Category | Description |')
  lines.push('|-------|----------|-------------|')
  for (const e of EVENTS) {
    lines.push(`| \`${e.event}\` | ${e.category} | ${e.description} |`)
  }
  lines.push('')

  // Detailed events grouped by category
  let currentCategory = ''
  for (const e of EVENTS) {
    if (e.category !== currentCategory) {
      currentCategory = e.category
      lines.push(`### ${currentCategory} Events`)
      lines.push('')
    }

    lines.push(`#### \`${e.event}\``)
    lines.push('')
    lines.push(e.description)
    lines.push('')
    lines.push(`**Trigger:** ${e.trigger}`)
    lines.push('')
    lines.push('**Example payload:**')
    lines.push('')
    lines.push('```json')
    lines.push(e.payload)
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const content = generate()
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, content, 'utf-8')
console.log(`Generated ${OUT} (${content.length} bytes)`)

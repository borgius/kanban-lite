#!/usr/bin/env npx tsx
/**
 * Generates docs/api.md from route metadata.
 *
 * All API documentation lives in this file as structured data.
 * To update API docs, edit the metadata below and run:
 *   npx tsx scripts/generate-api-docs.ts
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'api.md')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Field {
  name: string
  type: string
  required: boolean
  default?: string
  description: string
}

interface Route {
  section: string
  sectionDescription?: string
  subsection?: string
  method: string
  path: string
  description: string
  queryParams?: Field[]
  bodyFields?: Field[]
  bodyNote?: string
  example?: string
  exampleLabel?: string
  responseStatus?: string
  response?: string
  notes?: string
}

// ---------------------------------------------------------------------------
// Route metadata — the single source of truth for docs/api.md
// ---------------------------------------------------------------------------

const ROUTES: Route[] = [
  // ===================== Boards =====================
  {
    section: 'Boards',
    subsection: 'List Boards',
    method: 'GET',
    path: '/api/boards',
    description: 'Returns all boards in the workspace.',
    response: `{
  "ok": true,
  "data": [
    { "id": "default", "name": "Default Board" },
    { "id": "bugs", "name": "Bug Tracker", "description": "Track production bugs" }
  ]
}`,
  },
  {
    section: 'Boards',
    subsection: 'Create Board',
    method: 'POST',
    path: '/api/boards',
    description: '',
    bodyFields: [
      { name: 'id', type: 'string', required: true, description: 'Unique board identifier' },
      { name: 'name', type: 'string', required: true, description: 'Display name' },
      { name: 'description', type: 'string', required: false, description: 'Board description' },
      { name: 'columns', type: 'KanbanColumn[]', required: false, description: 'Custom columns (inherits from default board if omitted)' },
    ],
    example: `curl -X POST http://localhost:3000/api/boards \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "bugs",
    "name": "Bug Tracker",
    "description": "Track production bugs",
    "columns": [
      { "id": "new", "name": "New", "color": "#ef4444" },
      { "id": "investigating", "name": "Investigating", "color": "#f59e0b" },
      { "id": "fixed", "name": "Fixed", "color": "#22c55e" }
    ]
  }'`,
    responseStatus: '201 Created',
    response: `{
  "ok": true,
  "data": { "id": "bugs", "name": "Bug Tracker", "description": "Track production bugs" }
}`,
  },
  {
    section: 'Boards',
    subsection: 'Get Board',
    method: 'GET',
    path: '/api/boards/:boardId',
    description: 'Returns the full configuration for a board.',
    response: `{
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
}`,
  },
  {
    section: 'Boards',
    subsection: 'Update Board',
    method: 'PUT',
    path: '/api/boards/:boardId',
    description: '',
    bodyNote: 'Any subset of board config fields (`name`, `description`, `columns`, `defaultStatus`, `defaultPriority`).',
    example: `curl -X PUT http://localhost:3000/api/boards/bugs \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Bug Tracker v2" }'`,
  },
  {
    section: 'Boards',
    subsection: 'Delete Board',
    method: 'DELETE',
    path: '/api/boards/:boardId',
    description: 'Deletes a board. The board must be empty (no cards) and cannot be the default board.',
    response: '{ "ok": true, "data": { "deleted": true } }',
  },

  // ===================== Tasks (Default Board) =====================
  {
    section: 'Tasks (Default Board)',
    sectionDescription: 'These endpoints operate on the default board. For board-scoped operations, see [Board-Scoped Tasks](#board-scoped-tasks) below.',
    subsection: 'List Tasks',
    method: 'GET',
    path: '/api/tasks',
    description: '',
    queryParams: [
      { name: 'status', type: 'string', required: false, description: 'Filter by status (e.g., `todo`, `in-progress`)' },
      { name: 'priority', type: 'string', required: false, description: 'Filter by priority (`critical`, `high`, `medium`, `low`)' },
      { name: 'assignee', type: 'string', required: false, description: 'Filter by assignee name' },
      { name: 'label', type: 'string', required: false, description: 'Filter by label' },
    ],
    example: 'curl "http://localhost:3000/api/tasks?status=todo&priority=high"',
  },
  {
    section: 'Tasks (Default Board)',
    subsection: 'Get Task',
    method: 'GET',
    path: '/api/tasks/:id',
    description: 'Supports partial ID matching.',
  },
  {
    section: 'Tasks (Default Board)',
    subsection: 'Create Task',
    method: 'POST',
    path: '/api/tasks',
    description: '',
    bodyFields: [
      { name: 'content', type: 'string', required: true, description: 'Markdown content (title from first `# heading`)' },
      { name: 'status', type: 'string', required: false, default: 'backlog', description: 'Initial status' },
      { name: 'priority', type: 'string', required: false, default: 'medium', description: 'Priority level' },
      { name: 'assignee', type: 'string', required: false, default: 'null', description: 'Assigned team member' },
      { name: 'dueDate', type: 'string', required: false, default: 'null', description: 'Due date (ISO 8601)' },
      { name: 'labels', type: 'string[]', required: false, default: '[]', description: 'Labels/tags' },
    ],
    example: `curl -X POST http://localhost:3000/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "# Fix login bug\\n\\nUsers cannot log in with SSO.",
    "status": "todo",
    "priority": "critical",
    "assignee": "alice",
    "labels": ["bug", "auth"]
  }'`,
    responseStatus: '201 Created',
  },
  {
    section: 'Tasks (Default Board)',
    subsection: 'Update Task',
    method: 'PUT',
    path: '/api/tasks/:id',
    description: '',
    bodyNote: 'Any subset of task fields (`content`, `status`, `priority`, `assignee`, `dueDate`, `labels`).',
    example: `curl -X PUT http://localhost:3000/api/tasks/42 \\
  -H "Content-Type: application/json" \\
  -d '{ "priority": "high", "assignee": "bob" }'`,
  },
  {
    section: 'Tasks (Default Board)',
    subsection: 'Move Task',
    method: 'PATCH',
    path: '/api/tasks/:id/move',
    description: 'Moves a task to a different column and/or position.',
    bodyFields: [
      { name: 'status', type: 'string', required: true, description: 'Target column' },
      { name: 'position', type: 'number', required: false, description: 'Zero-based position (default: `0`)' },
    ],
    example: `curl -X PATCH http://localhost:3000/api/tasks/42/move \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "in-progress", "position": 0 }'`,
  },
  {
    section: 'Tasks (Default Board)',
    subsection: 'Delete Task',
    method: 'DELETE',
    path: '/api/tasks/:id',
    description: '',
    example: 'curl -X DELETE http://localhost:3000/api/tasks/42',
  },

  // ===================== Board-Scoped Tasks =====================
  {
    section: 'Board-Scoped Tasks',
    subsection: '',
    method: '',
    path: '',
    description: `All task endpoints are also available scoped to a specific board. These behave identically to the default board endpoints but operate on the specified board.

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/boards/:boardId/tasks\` | List tasks (supports same query filters) |
| \`POST\` | \`/api/boards/:boardId/tasks\` | Create a task in the board |
| \`GET\` | \`/api/boards/:boardId/tasks/:id\` | Get a task |
| \`PUT\` | \`/api/boards/:boardId/tasks/:id\` | Update a task |
| \`PATCH\` | \`/api/boards/:boardId/tasks/:id/move\` | Move a task |
| \`DELETE\` | \`/api/boards/:boardId/tasks/:id\` | Delete a task |`,
    example: `curl -X POST http://localhost:3000/api/boards/bugs/tasks \\
  -H "Content-Type: application/json" \\
  -d '{ "content": "# Login error", "status": "new", "priority": "critical" }'`,
    exampleLabel: '**Example — create a task in the "bugs" board:**',
  },

  // ===================== Transfer Task =====================
  {
    section: 'Transfer Task',
    subsection: '',
    method: 'POST',
    path: '/api/boards/:boardId/tasks/:id/transfer',
    description: 'Move a task from the current board to another board.\n\nThe `:boardId` is the **destination** board. The task is moved from the currently active board.',
    bodyFields: [
      { name: 'targetStatus', type: 'string', required: false, description: "Status in the destination board (defaults to the board's default status)" },
    ],
    example: `curl -X POST http://localhost:3000/api/boards/bugs/tasks/42/transfer \\
  -H "Content-Type: application/json" \\
  -d '{ "targetStatus": "new" }'`,
  },

  // ===================== Board-Scoped Columns =====================
  {
    section: 'Board-Scoped Columns',
    subsection: '',
    method: 'GET',
    path: '/api/boards/:boardId/columns',
    description: 'Returns columns for a specific board.',
  },

  // ===================== Columns (Default Board) =====================
  {
    section: 'Columns (Default Board)',
    subsection: 'List Columns',
    method: 'GET',
    path: '/api/columns',
    description: '',
  },
  {
    section: 'Columns (Default Board)',
    subsection: 'Add Column',
    method: 'POST',
    path: '/api/columns',
    description: '',
    bodyFields: [
      { name: 'id', type: 'string', required: true, description: 'Unique column identifier' },
      { name: 'name', type: 'string', required: true, description: 'Display name' },
      { name: 'color', type: 'string', required: false, description: 'Hex color (default: `#6b7280`)' },
    ],
    example: `curl -X POST http://localhost:3000/api/columns \\
  -H "Content-Type: application/json" \\
  -d '{ "id": "testing", "name": "Testing", "color": "#ff9900" }'`,
  },
  {
    section: 'Columns (Default Board)',
    subsection: 'Update Column',
    method: 'PUT',
    path: '/api/columns/:id',
    description: '',
    bodyNote: '`name` and/or `color`.',
  },
  {
    section: 'Columns (Default Board)',
    subsection: 'Delete Column',
    method: 'DELETE',
    path: '/api/columns/:id',
    description: 'Fails if the column still contains tasks.',
  },

  // ===================== Comments =====================
  {
    section: 'Comments',
    subsection: 'List Comments',
    method: 'GET',
    path: '/api/tasks/:id/comments',
    description: '',
  },
  {
    section: 'Comments',
    subsection: 'Add Comment',
    method: 'POST',
    path: '/api/tasks/:id/comments',
    description: '',
    bodyFields: [
      { name: 'author', type: 'string', required: true, description: 'Comment author' },
      { name: 'content', type: 'string', required: true, description: 'Comment body' },
    ],
    example: `curl -X POST http://localhost:3000/api/tasks/42/comments \\
  -H "Content-Type: application/json" \\
  -d '{ "author": "alice", "content": "Looks good, needs tests" }'`,
  },
  {
    section: 'Comments',
    subsection: 'Update Comment',
    method: 'PUT',
    path: '/api/tasks/:id/comments/:commentId',
    description: '',
    bodyNote: '`{ "content": "Updated comment" }`',
  },
  {
    section: 'Comments',
    subsection: 'Delete Comment',
    method: 'DELETE',
    path: '/api/tasks/:id/comments/:commentId',
    description: '',
  },

  // ===================== Attachments =====================
  {
    section: 'Attachments',
    subsection: 'Upload Attachment',
    method: 'POST',
    path: '/api/tasks/:id/attachments',
    description: 'Send as `multipart/form-data` with file(s).',
  },
  {
    section: 'Attachments',
    subsection: 'Download Attachment',
    method: 'GET',
    path: '/api/tasks/:id/attachments/:filename',
    description: '',
  },
  {
    section: 'Attachments',
    subsection: 'Delete Attachment',
    method: 'DELETE',
    path: '/api/tasks/:id/attachments/:filename',
    description: '',
  },

  // ===================== Settings =====================
  {
    section: 'Settings',
    subsection: 'Get Settings',
    method: 'GET',
    path: '/api/settings',
    description: '',
    response: `{
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
}`,
  },
  {
    section: 'Settings',
    subsection: 'Update Settings',
    method: 'PUT',
    path: '/api/settings',
    description: '',
    bodyNote: 'Full `CardDisplaySettings` object.',
    example: `curl -X PUT http://localhost:3000/api/settings \\
  -H "Content-Type: application/json" \\
  -d '{ "compactMode": true, "showFileName": true }'`,
  },

  // ===================== Webhooks =====================
  {
    section: 'Webhooks',
    subsection: 'List Webhooks',
    method: 'GET',
    path: '/api/webhooks',
    description: '',
  },
  {
    section: 'Webhooks',
    subsection: 'Register Webhook',
    method: 'POST',
    path: '/api/webhooks',
    description: '',
    bodyFields: [
      { name: 'url', type: 'string', required: true, description: 'Target URL' },
      { name: 'events', type: 'string[]', required: false, default: '["*"]', description: 'Events to subscribe to' },
      { name: 'secret', type: 'string', required: false, description: 'HMAC-SHA256 signing secret' },
    ],
    notes: '**Available events:** `task.created`, `task.updated`, `task.moved`, `task.deleted`, `comment.created`, `comment.updated`, `comment.deleted`, `column.created`, `column.updated`, `column.deleted`, `attachment.added`, `attachment.removed`, `settings.updated`, `board.created`, `board.updated`, `board.deleted`',
    example: `curl -X POST http://localhost:3000/api/webhooks \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/hook",
    "events": ["task.created", "task.moved"],
    "secret": "my-signing-key"
  }'`,
  },
  {
    section: 'Webhooks',
    subsection: 'Update Webhook',
    method: 'PUT',
    path: '/api/webhooks/:id',
    description: '',
    bodyFields: [
      { name: 'url', type: 'string', required: false, description: 'New target URL' },
      { name: 'events', type: 'string[]', required: false, description: 'New event subscriptions' },
      { name: 'secret', type: 'string', required: false, description: 'New HMAC-SHA256 signing secret' },
      { name: 'active', type: 'boolean', required: false, description: 'Enable or disable the webhook' },
    ],
    example: `curl -X PUT http://localhost:3000/api/webhooks/wh_abc123 \\
  -H "Content-Type: application/json" \\
  -d '{ "active": false }'`,
  },
  {
    section: 'Webhooks',
    subsection: 'Delete Webhook',
    method: 'DELETE',
    path: '/api/webhooks/:id',
    description: '',
  },

  // ===================== Workspace =====================
  {
    section: 'Workspace',
    subsection: 'Get Workspace Info',
    method: 'GET',
    path: '/api/workspace',
    description: '',
    response: `{
  "ok": true,
  "data": { "path": "/Users/admin/dev/my-project" }
}`,
  },
]

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderFieldTable(fields: Field[], hasDefault: boolean): string {
  const lines: string[] = []
  if (hasDefault) {
    lines.push('| Field | Type | Required | Default | Description |')
    lines.push('|-------|------|----------|---------|-------------|')
    for (const f of fields) {
      const def = f.default !== undefined ? `\`${f.default}\`` : ''
      lines.push(`| \`${f.name}\` | \`${f.type}\` | ${f.required ? 'Yes' : 'No'} | ${def} | ${f.description} |`)
    }
  } else {
    lines.push('| Field | Type | Required | Description |')
    lines.push('|-------|------|----------|-------------|')
    for (const f of fields) {
      lines.push(`| \`${f.name}\` | \`${f.type}\` | ${f.required ? 'Yes' : 'No'} | ${f.description} |`)
    }
  }
  return lines.join('\n')
}

function renderQueryTable(params: Field[]): string {
  const lines = [
    '| Parameter | Type | Description |',
    '|-----------|------|-------------|',
  ]
  for (const p of params) {
    lines.push(`| \`${p.name}\` | \`${p.type}\` | ${p.description} |`)
  }
  return lines.join('\n')
}

function renderRoute(route: Route): string {
  const parts: string[] = []

  // Method + path
  if (route.method && route.path) {
    parts.push('```')
    parts.push(`${route.method} ${route.path}`)
    parts.push('```')
    parts.push('')
  }

  // Description
  if (route.description) {
    parts.push(route.description)
    parts.push('')
  }

  // Query params
  if (route.queryParams?.length) {
    parts.push('**Query parameters:**')
    parts.push('')
    parts.push(renderQueryTable(route.queryParams))
    parts.push('')
  }

  // Body fields
  if (route.bodyFields?.length) {
    parts.push('**Request body:**')
    parts.push('')
    const hasDefault = route.bodyFields.some(f => f.default !== undefined)
    parts.push(renderFieldTable(route.bodyFields, hasDefault))
    parts.push('')
  }

  // Body note
  if (route.bodyNote) {
    parts.push(`**Request body:** ${route.bodyNote}`)
    parts.push('')
  }

  // Notes
  if (route.notes) {
    parts.push(route.notes)
    parts.push('')
  }

  // Example
  if (route.example) {
    if (route.exampleLabel) {
      parts.push(route.exampleLabel)
    } else if (route.bodyFields?.length || route.queryParams?.length || route.bodyNote) {
      parts.push('**Example:**')
    }
    parts.push('')
    parts.push('```bash')
    parts.push(route.example)
    parts.push('```')
    parts.push('')
  }

  // Response status
  if (route.responseStatus) {
    parts.push(`**Response:** \`${route.responseStatus}\``)
    parts.push('')
  }

  // Response body
  if (route.response) {
    if (!route.responseStatus) {
      parts.push('**Response:**')
      parts.push('')
    }
    parts.push('```json')
    parts.push(route.response)
    parts.push('```')
    parts.push('')
  }

  return parts.join('\n')
}

function generate(): string {
  const lines: string[] = []

  lines.push('# Kanban Lite REST API')
  lines.push('')
  lines.push('The standalone server exposes a full REST API for managing kanban boards programmatically.')
  lines.push('')
  lines.push('## Base URL')
  lines.push('')
  lines.push('```')
  lines.push('http://localhost:3000/api')
  lines.push('```')
  lines.push('')
  lines.push('Start the server with `kl serve` or `kanban-md`. Use `--port <number>` to change the port.')
  lines.push('')
  lines.push('## Response Format')
  lines.push('')
  lines.push('All responses follow a consistent envelope:')
  lines.push('')
  lines.push('```json')
  lines.push('// Success')
  lines.push('{ "ok": true, "data": { ... } }')
  lines.push('')
  lines.push('// Error')
  lines.push('{ "ok": false, "error": "Error message" }')
  lines.push('```')
  lines.push('')
  lines.push('CORS is enabled for all origins.')
  lines.push('')
  lines.push('---')
  lines.push('')

  let currentSection = ''
  for (const route of ROUTES) {
    // Section heading
    if (route.section !== currentSection) {
      currentSection = route.section
      lines.push(`## ${currentSection}`)
      lines.push('')
      if (route.sectionDescription) {
        lines.push(route.sectionDescription)
        lines.push('')
      }
    }

    // Subsection heading
    if (route.subsection) {
      lines.push(`### ${route.subsection}`)
      lines.push('')
    }

    lines.push(renderRoute(route))
    lines.push('---')
    lines.push('')
  }

  // WebSocket section
  lines.push('## WebSocket')
  lines.push('')
  lines.push('The server provides a WebSocket endpoint at `ws://localhost:3000` for real-time updates. Connected clients receive live broadcasts when tasks, columns, or settings change.')
  lines.push('')
  lines.push('**Message format:**')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "type": "init",')
  lines.push('  "features": [...],')
  lines.push('  "columns": [...],')
  lines.push('  "settings": {...},')
  lines.push('  "boards": [...],')
  lines.push('  "currentBoard": "default"')
  lines.push('}')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const content = generate()
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, content, 'utf-8')
console.log(`Generated ${OUT} (${content.length} bytes)`)

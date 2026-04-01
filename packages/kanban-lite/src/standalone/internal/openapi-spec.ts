/**
 * OpenAPI v3 specification for the Kanban Lite standalone server.
 *
 * This is the single source of truth for API documentation.
 * - Used at runtime by @fastify/swagger to serve /api/docs/json and the Swagger UI at /api/docs
 * - Used by scripts/generate-api-docs.ts to generate docs/api.md
 *
 * When adding or changing endpoints, update this file first, then update
 * the corresponding route handler and run `npm run docs` to regenerate docs/api.md.
 */

const boardIdParam = {
  name: 'boardId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Board identifier',
}

const taskIdParam = {
  name: 'id',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Task/card identifier (supports partial ID matching)',
}

const actionParam = {
  name: 'action',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Action key',
}

const formIdParam = {
  name: 'formId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Form identifier',
}

const filenameParam = {
  name: 'filename',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Attachment filename',
}

const commentIdParam = {
  name: 'commentId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Comment identifier',
}

const labelNameParam = {
  name: 'name',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Label name (URL-encoded)',
}

const pluginCapabilityParam = {
  name: 'capability',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Plugin capability namespace (for example `auth.identity` or `card.storage`).',
}

const pluginProviderIdParam = {
  name: 'providerId',
  in: 'path' as const,
  required: true as const,
  schema: { type: 'string' as const },
  description: 'Plugin provider identifier within the selected capability.',
}

const listTasksQueryParams = [
  { name: 'q', in: 'query' as const, schema: { type: 'string' as const }, description: 'Free-text search. May include inline `meta.field: value` tokens.' },
  { name: 'fuzzy', in: 'query' as const, schema: { type: 'boolean' as const }, description: 'Enable fuzzy matching for free-text search and metadata tokens.' },
  { name: 'status', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by status.' },
  { name: 'priority', in: 'query' as const, schema: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] as const }, description: 'Filter by priority.' },
  { name: 'assignee', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by assignee name.' },
  { name: 'label', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by label.' },
  { name: 'labelGroup', in: 'query' as const, schema: { type: 'string' as const }, description: 'Filter by label group name.' },
  { name: 'includeDeleted', in: 'query' as const, schema: { type: 'boolean' as const }, description: 'Include soft-deleted tasks.' },
  { name: 'meta.<field>', in: 'query' as const, schema: { type: 'string' as const }, description: 'Field-scoped metadata filter. Repeat for multiple metadata fields.' },
]

const createTaskBodySchema = {
  type: 'object' as const,
  required: ['content' as const],
  properties: {
    content: { type: 'string' as const, description: 'Markdown content. Task title is derived from the first `# heading`.' },
    status: { type: 'string' as const, description: 'Initial status (defaults to board default).' },
    priority: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] as const, description: 'Priority level (default: `medium`).' },
    assignee: { type: 'string' as const, description: 'Assigned team member.' },
    dueDate: { type: 'string' as const, description: 'Due date (ISO 8601).' },
    labels: { type: 'array' as const, items: { type: 'string' as const }, description: 'Labels/tags.' },
    metadata: { type: 'object' as const, description: 'Arbitrary user-defined key/value metadata.' },
    forms: { type: 'array' as const, description: 'Attached forms — named workspace references (`{ "name": "..." }`) or inline definitions.' },
    formData: { type: 'object' as const, description: 'Per-form saved data keyed by resolved form ID.' },
    actions: { type: 'array' as const, description: 'Action names or map of key → title available on this card.' },
  },
}

const logEntryBodySchema = {
  type: 'object' as const,
  required: ['text' as const],
  properties: {
    text: { type: 'string' as const, description: 'Log message text (supports Markdown).' },
    source: { type: 'string' as const, description: 'Source/origin label (default: `"default"`).' },
    object: { type: 'object' as const, description: 'Optional structured data stored as JSON.' },
    timestamp: { type: 'string' as const, description: 'ISO 8601 timestamp (auto-generated if omitted).' },
  },
}

const cardStateReadBodySchema = {
  type: 'object' as const,
  properties: {
    readThrough: {
      type: 'object' as const,
      description: 'Optional explicit unread cursor to acknowledge instead of the latest activity.',
      properties: {
        cursor: { type: 'string' as const },
        updatedAt: { type: 'string' as const },
      },
    },
  },
}

export const KANBAN_OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Kanban Lite REST API',
    description: [
      'The standalone server exposes a full REST API for managing kanban boards programmatically.',
      '',
      '**Base URL:** `http://localhost:3000/api`',
      '',
      'Start the server with `kl serve` or `kanban-md`. Use `--port <number>` to change the port.',
      '',
      '**Response envelope:**',
      '',
      '```json',
      '{ "ok": true, "data": { ... } }   // success',
      '{ "ok": false, "error": "..." }    // error',
      '```',
      '',
      'CORS is enabled for all origins.',
      '',
      '**Conventions:** Card/task IDs support partial matching within a board.',
      '`/api/tasks/*` operates on the default board; `/api/boards/:boardId/tasks/*` targets a specific board explicitly.',
    ].join('\n'),
    version: '1.0.0',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Standalone server (default port)' },
  ],
  tags: [
    { name: 'Boards', description: 'Board CRUD and board-level actions' },
    { name: 'Tasks', description: 'Task operations on the default board' },
    { name: 'Board Tasks', description: 'Board-scoped task operations' },
    { name: 'Columns', description: 'Column management for the default board' },
    { name: 'Comments', description: 'Task comment threads' },
    { name: 'Attachments', description: 'File attachments on tasks' },
    { name: 'Logs', description: 'Append-only log entries on tasks and boards' },
    { name: 'Settings', description: 'Workspace display settings' },
    { name: 'Plugins', description: 'Plugin discovery, selection, options, and guarded installation' },
    { name: 'Labels', description: 'Label definitions and cascading renames' },
    { name: 'Workspace', description: 'Workspace metadata, storage, and auth status' },
  ],
  components: {
    schemas: {
      Card: {
        type: 'object',
        description: 'A kanban task card.',
        properties: {
          id: { type: 'string', description: 'Board-scoped card identifier.' },
          status: { type: 'string', description: 'Column/status the card currently belongs to.' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          assignee: { type: 'string', nullable: true },
          dueDate: { type: 'string', nullable: true, description: 'ISO 8601 date.' },
          labels: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object', description: 'Arbitrary user-defined key/value metadata.' },
          content: { type: 'string', description: 'Full Markdown content.' },
          comments: { type: 'array', description: 'Attached comments.' },
          forms: { type: 'array', description: 'Attached form references.' },
          formData: { type: 'object', description: 'Saved form data keyed by form ID.' },
          actions: { type: 'array', description: 'Action names available on the card.' },
          cardState: { $ref: '#/components/schemas/CardStateReadModel' },
        },
      },
      CardStateCursor: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
      CardUnreadSummary: {
        type: 'object',
        properties: {
          actorId: { type: 'string' },
          boardId: { type: 'string' },
          cardId: { type: 'string' },
          latestActivity: { anyOf: [{ $ref: '#/components/schemas/CardStateCursor' }, { type: 'null' }] },
          readThrough: { anyOf: [{ $ref: '#/components/schemas/CardStateCursor' }, { type: 'null' }] },
          unread: { type: 'boolean' },
        },
      },
      CardStateReadModel: {
        type: 'object',
        description: 'Actor-scoped unread/open card-state metadata exposed on read models without side effects. This is distinct from board active-card UI state.',
        properties: {
          unread: { $ref: '#/components/schemas/CardUnreadSummary' },
          open: {
            anyOf: [
              {
                type: 'object',
                description: 'Persisted open-card state record for the current actor when the explicit open mutation has been invoked.',
              },
              { type: 'null' },
            ],
          },
        },
      },
      CardStateStatus: {
        type: 'object',
        description: 'Resolved standalone runtime status for the active `card.state` provider, including backend family, availability classification, and the stable default-actor contract used when auth is absent.',
        properties: {
          provider: { type: 'string' },
          active: { type: 'boolean' },
          backend: { type: 'string', enum: ['builtin', 'external', 'none'] },
          availability: { type: 'string', enum: ['available', 'identity-unavailable', 'unavailable'] },
          defaultActorMode: { type: 'string' },
          defaultActor: { type: 'object' },
          defaultActorAvailable: { type: 'boolean' },
          errorCode: { type: 'string' },
        },
      },
      AvailableEventDescriptor: {
        type: 'object',
        description: 'One discoverable SDK event, including its phase, origin, and transport metadata.',
        properties: {
          event: { type: 'string', description: 'Event name, such as `task.created` or `workflow.completed`.' },
          phase: { type: 'string', enum: ['before', 'after'] },
          source: { type: 'string', enum: ['core', 'plugin'], description: 'Whether the event comes from the built-in SDK catalog or an active plugin declaration.' },
          resource: { type: 'string', description: 'Optional resource/domain grouping label.' },
          label: { type: 'string', description: 'Optional human-readable event label.' },
          sdkBefore: { type: 'boolean', description: 'Whether the event is available as an SDK before-event.' },
          sdkAfter: { type: 'boolean', description: 'Whether the event is available as an SDK after-event.' },
          apiAfter: { type: 'boolean', description: 'Whether the event is expected to surface through remote after-event transports such as API/webhooks.' },
          pluginIds: { type: 'array', items: { type: 'string' }, description: 'Plugin package IDs that contributed this event declaration.' },
        },
      },
      Board: {
        type: 'object',
        description: 'A kanban board.',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          columns: { type: 'array', items: { $ref: '#/components/schemas/Column' } },
          metadata: { type: 'array', items: { type: 'string' }, description: 'Board metadata keys pinned in the card detail panel.' },
          title: { type: 'array', items: { type: 'string' }, description: 'Ordered metadata keys whose rendered values prefix user-visible card titles.' },
          defaultStatus: { type: 'string' },
          defaultPriority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
      },
      Column: {
        type: 'object',
        description: 'A board column definition.',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          color: { type: 'string', description: 'Hex color string.' },
        },
      },
      ApiOk: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', enum: [true] },
          data: { description: 'Response payload (type depends on endpoint).' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', enum: [false] },
          error: { type: 'string', description: 'Error message.' },
        },
      },
    },
  },
  paths: {
    // ------------------------------------------------------------------
    // Boards
    // ------------------------------------------------------------------
    '/api/boards': {
      get: {
        tags: ['Boards'],
        summary: 'List boards',
        description: 'Returns all boards in the workspace.',
        responses: { 200: { description: 'List of board summaries.' } },
      },
      post: {
        tags: ['Boards'],
        summary: 'Create board',
        description: "Creates a new board and persists it to `.kanban.json`. When `columns` is omitted, the board inherits the default board's columns (or built-in standard columns when the default board has none).",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'name'],
                properties: {
                  id: { type: 'string', description: 'Unique board identifier.' },
                  name: { type: 'string', description: 'Display name.' },
                  description: { type: 'string', description: 'Board description.' },
                  columns: { type: 'array', description: 'Custom columns. Inherits from default board if omitted.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Board created.' },
          400: { description: 'Validation error (missing id or name).' },
        },
      },
    },
    '/api/boards/{boardId}': {
      get: {
        tags: ['Boards'],
        summary: 'Get board',
        description: 'Returns the full configuration for a board.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Board config.' }, 404: { description: 'Board not found.' } },
      },
      put: {
        tags: ['Boards'],
        summary: 'Update board',
        description: 'Updates an existing board in place. Only provided fields are changed; omitted properties keep their current values.',
        parameters: [boardIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Any subset of board config fields: `name`, `description`, `columns`, `metadata`, `title`, `defaultStatus`, `defaultPriority`.',
              },
            },
          },
        },
        responses: { 200: { description: 'Updated board.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Boards'],
        summary: 'Delete board',
        description: 'Deletes a board. The board must be empty (no cards) and cannot be the default board.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Deleted.' }, 400: { description: 'Board not empty or is default board.' } },
      },
    },
    '/api/boards/{boardId}/actions': {
      get: {
        tags: ['Boards'],
        summary: 'Get board actions',
        description: 'Returns the defined actions for the board as a map of key → title.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Action map.' }, 404: { description: 'Board not found.' } },
      },
      post: {
        tags: ['Boards'],
        summary: 'Set board actions',
        description: 'Replaces all board actions with the provided set. Keys present in the existing set but absent from the new set are removed.',
        parameters: [boardIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['actions'],
                properties: {
                  actions: {
                    type: 'object',
                    description: 'Map of action key → display title.',
                    additionalProperties: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated action map.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/boards/{boardId}/actions/{key}': {
      put: {
        tags: ['Boards'],
        summary: 'Add/update board action',
        description: 'Adds a new board action or updates the title of an existing one.',
        parameters: [boardIdParam, { name: 'key', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Action key.' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: { title: { type: 'string', description: 'Display title for the action.' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated actions.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Boards'],
        summary: 'Delete board action',
        description: 'Removes a board action by key.',
        parameters: [boardIdParam, { name: 'key', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Action key.' }],
        responses: { 204: { description: 'Deleted.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/actions/{key}/trigger': {
      post: {
        tags: ['Boards'],
        summary: 'Trigger board action',
        description: 'Fires the configured webhook for the named board action.',
        parameters: [boardIdParam, { name: 'key', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Action key.' }],
        responses: { 204: { description: 'Triggered.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/columns': {
      get: {
        tags: ['Boards'],
        summary: 'List board columns',
        description: "Returns the ordered column definitions for the specified board, including each column's `id`, display `name`, and `color`.",
        parameters: [boardIdParam],
        responses: { 200: { description: 'Ordered column list.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/boards/{boardId}/tasks': {
      get: {
        tags: ['Board Tasks'],
        summary: 'List tasks (board-scoped)',
        description: 'Returns tasks for the specified board. Supports the same `q`, `fuzzy`, `meta.*`, and field filters as `/api/tasks`. Read models include side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
        parameters: [boardIdParam, ...listTasksQueryParams],
        responses: { 200: { description: 'Task list.' }, 400: { description: 'Error.' } },
      },
      post: {
        tags: ['Board Tasks'],
        summary: 'Create task (board-scoped)',
        description: 'Creates a task on the specified board. Title is derived from the first Markdown `# heading`. Omitted `status`/`priority` fall back to the board defaults.',
        parameters: [boardIdParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: createTaskBodySchema } },
        },
        responses: { 201: { description: 'Created.' }, 400: { description: 'Validation error.' } },
      },
    },
    '/api/boards/{boardId}/tasks/active': {
      get: {
        tags: ['Board Tasks'],
        summary: 'Get active task (board-scoped)',
        description: 'Returns the currently active/open task for the board, or `null` when none is active. This is separate from actor-scoped `card.state` open/unread metadata.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Active task or null.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}': {
      get: {
        tags: ['Board Tasks'],
        summary: 'Get task (board-scoped)',
        description: 'Returns a single task from the specified board. The `:id` segment supports partial ID matching. Read models include side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
        parameters: [boardIdParam, taskIdParam],
        responses: { 200: { description: 'Task.' }, 404: { description: 'Not found.' } },
      },
      put: {
        tags: ['Board Tasks'],
        summary: 'Update task (board-scoped)',
        description: 'Updates fields of a task. Only supplied fields are modified; omitted fields remain unchanged.',
        parameters: [boardIdParam, taskIdParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const, description: 'Any subset of task fields: `content`, `status`, `priority`, `assignee`, `dueDate`, `labels`, `metadata`, `forms`, `formData`, `actions`.' } } },
        },
        responses: { 200: { description: 'Updated task.' }, 404: { description: 'Not found.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Board Tasks'],
        summary: 'Delete task (board-scoped)',
        description: 'Soft-deletes the task by moving it to the hidden deleted column.',
        parameters: [boardIdParam, taskIdParam],
        responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/open': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Mark task opened (board-scoped)',
        description: 'Persists an explicit actor-scoped open mutation through the shared SDK `card.state` APIs. This does not modify active-card UI state.',
        parameters: [boardIdParam, taskIdParam],
        responses: { 200: { description: 'Card-state mutation result.' }, 404: { description: 'Not found.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/read': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Mark task read (board-scoped)',
        description: 'Persists an explicit actor-scoped unread acknowledgement through the shared SDK `card.state` APIs. Read-only GET routes never invoke this mutation implicitly.',
        parameters: [boardIdParam, taskIdParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: cardStateReadBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Card-state mutation result.' }, 404: { description: 'Not found.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/move': {
      patch: {
        tags: ['Board Tasks'],
        summary: 'Move task (board-scoped)',
        description: 'Moves a task to a different column and/or position within the board.',
        parameters: [boardIdParam, taskIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', description: 'Target column.' },
                  position: { type: 'integer', description: 'Zero-based position (default: `0`).' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated task.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/forms/{formId}/submit': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Submit task form (board-scoped)',
        description: 'Validates and persists a card form submission. Merge order: config defaults → card attachment defaults / existing formData → matching card metadata → submitted data. Emits the `form.submit` webhook event.',
        parameters: [boardIdParam, taskIdParam, formIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'object', description: 'Submitted field values.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Submission result.' }, 400: { description: 'Validation error.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/actions/{action}': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Trigger task action (board-scoped)',
        description: 'Fires the configured webhook for the named card-level action.',
        parameters: [boardIdParam, taskIdParam, actionParam],
        responses: { 204: { description: 'Triggered.' }, 400: { description: 'Error.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/permanent': {
      delete: {
        tags: ['Board Tasks'],
        summary: 'Permanently delete task (board-scoped)',
        description: 'Permanently and irreversibly removes the task. This cannot be undone.',
        parameters: [boardIdParam, taskIdParam],
        responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/transfer': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Transfer task to another board',
        description: "Moves a task from the current board context to the specified destination board. The `:boardId` path segment is the **destination** board. The source board is the server's currently active board context.",
        parameters: [boardIdParam, taskIdParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  targetStatus: { type: 'string', description: "Status in the destination board (defaults to the board's default status)." },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Transferred task.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/boards/{boardId}/logs': {
      get: {
        tags: ['Logs'],
        summary: 'List board logs',
        description: 'Returns all board-level log entries.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Log entries.' } },
      },
      post: {
        tags: ['Logs'],
        summary: 'Add board log',
        description: 'Appends a log entry to the board.',
        parameters: [boardIdParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: logEntryBodySchema } },
        },
        responses: { 201: { description: 'Created.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Logs'],
        summary: 'Clear board logs',
        description: 'Removes all board-level log entries.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Cleared.' } },
      },
    },
    // ------------------------------------------------------------------
    // Tasks (default board)
    // ------------------------------------------------------------------
    '/api/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks',
        description: 'Returns tasks on the default board. Supports exact free-text search via `q`, optional fuzzy matching via `fuzzy=true`, and field-scoped metadata filters via `meta.<field>=value`. Read models include side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
        parameters: listTasksQueryParams,
        responses: { 200: { description: 'Task list.' } },
      },
      post: {
        tags: ['Tasks'],
        summary: 'Create task',
        description: 'Creates a task on the default board. Title is derived from the first Markdown `# heading`. Omitted `status`/`priority` fall back to board defaults.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: createTaskBodySchema } },
        },
        responses: { 201: { description: 'Created.' }, 400: { description: 'Validation error.' } },
      },
    },
    '/api/tasks/active': {
      get: {
        tags: ['Tasks'],
        summary: 'Get active task',
        description: 'Returns the currently active/open task on the default board, or `null` when no task is active. This is separate from actor-scoped `card.state` open/unread metadata.',
        responses: { 200: { description: 'Active task or null.' } },
      },
    },
    '/api/tasks/{id}': {
      get: {
        tags: ['Tasks'],
        summary: 'Get task',
        description: 'Returns a single task from the default board. The `:id` segment supports partial ID matching. Read models include side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Task.' }, 404: { description: 'Not found.' } },
      },
      put: {
        tags: ['Tasks'],
        summary: 'Update task',
        description: 'Updates an existing task. Only the supplied fields are modified; omitted fields remain unchanged.',
        parameters: [taskIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                description: 'Any subset of task fields: `content`, `status`, `priority`, `assignee`, `dueDate`, `labels`, `metadata`, `forms`, `formData`, `actions`.',
              },
            },
          },
        },
        responses: { 200: { description: 'Updated task.' }, 404: { description: 'Not found.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Tasks'],
        summary: 'Delete task',
        description: 'Soft-deletes a task by moving it into the hidden deleted column.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/tasks/{id}/open': {
      post: {
        tags: ['Tasks'],
        summary: 'Mark task opened',
        description: 'Persists an explicit actor-scoped open mutation through the shared SDK `card.state` APIs. This does not modify active-card UI state.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Card-state mutation result.' }, 404: { description: 'Not found.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/tasks/{id}/read': {
      post: {
        tags: ['Tasks'],
        summary: 'Mark task read',
        description: 'Persists an explicit actor-scoped unread acknowledgement through the shared SDK `card.state` APIs. Read-only GET routes never invoke this mutation implicitly.',
        parameters: [taskIdParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: cardStateReadBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Card-state mutation result.' }, 404: { description: 'Not found.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/tasks/{id}/forms/{formId}/submit': {
      post: {
        tags: ['Tasks'],
        summary: 'Submit task form',
        description: 'Validates and persists a card form submission. Merge order: config defaults → card attachment defaults / existing formData → matching card metadata → submitted data. Emits the `form.submit` webhook event.',
        parameters: [taskIdParam, formIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: { data: { type: 'object', description: 'Submitted field values.' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Submission result.' }, 400: { description: 'Validation error.' } },
      },
    },
    '/api/tasks/{id}/move': {
      patch: {
        tags: ['Tasks'],
        summary: 'Move task',
        description: 'Moves a task to a different column and/or position on the default board.',
        parameters: [taskIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', description: 'Target column.' },
                  position: { type: 'integer', description: 'Zero-based position (default: `0`).' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated task.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/tasks/{id}/permanent': {
      delete: {
        tags: ['Tasks'],
        summary: 'Permanently delete task',
        description: 'Permanently and irreversibly deletes a task from the default board. This cannot be undone.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/tasks/{id}/actions/{action}': {
      post: {
        tags: ['Tasks'],
        summary: 'Trigger task action',
        description: 'Fires the configured webhook for the named card-level action.',
        parameters: [taskIdParam, actionParam],
        responses: { 204: { description: 'Triggered.' }, 400: { description: 'Error.' }, 404: { description: 'Not found.' } },
      },
    },
    // ------------------------------------------------------------------
    // Attachments
    // ------------------------------------------------------------------
    '/api/tasks/{id}/attachments': {
      post: {
        tags: ['Attachments'],
        summary: 'Upload attachments',
        description: 'Uploads one or more files as task attachments. Files are sent as base64-encoded strings in a JSON body and stored through the active attachment-storage provider.',
        parameters: [taskIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['files'],
                properties: {
                  files: {
                    type: 'array',
                    description: 'Array of files to upload.',
                    items: {
                      type: 'object',
                      required: ['name', 'data'],
                      properties: {
                        name: { type: 'string', description: 'File name including extension.' },
                        data: { type: 'string', description: 'Base64-encoded file content.' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated task including new attachment references.' },
          400: { description: 'Validation error (missing or malformed `files` array).' },
          404: { description: 'Task not found.' },
        },
      },
    },
    '/api/tasks/{id}/attachments/{filename}': {
      get: {
        tags: ['Attachments'],
        summary: 'Download attachment',
        description: 'Materializes and streams the named attachment back to the client. Most browsers render known types (PDFs, images) inline unless `?download=1` is set.',
        parameters: [
          taskIdParam,
          filenameParam,
          { name: 'download', in: 'query' as const, schema: { type: 'integer' as const, enum: [0, 1] as const }, description: 'Set to `1` to force a download prompt instead of inline display.' },
        ],
        responses: {
          200: { description: 'File content with appropriate Content-Type.' },
          404: { description: 'Task or attachment not found.' },
          501: { description: 'Attachment provider does not expose a local file path.' },
        },
      },
      delete: {
        tags: ['Attachments'],
        summary: 'Delete attachment',
        description: 'Removes the named attachment from the task and deletes the provider-backed payload when supported.',
        parameters: [taskIdParam, filenameParam],
        responses: {
          200: { description: 'Updated task.' },
          404: { description: 'Task not found.' },
        },
      },
    },
    // ------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------
    '/api/tasks/{id}/comments': {
      get: {
        tags: ['Comments'],
        summary: 'List comments',
        description: 'Returns all comments currently attached to the task, in stored order.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Comment list.' }, 404: { description: 'Task not found.' } },
      },
      post: {
        tags: ['Comments'],
        summary: 'Add comment',
        description: 'Adds a new comment to the task and emits the `comment.created` webhook event.',
        parameters: [taskIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['author', 'content'],
                properties: {
                  author: { type: 'string', description: 'Comment author.' },
                  content: { type: 'string', description: 'Comment body (Markdown).' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created comment.' },
          400: { description: 'Validation error (missing author or content).' },
          404: { description: 'Task not found.' },
        },
      },
    },
    '/api/tasks/{id}/comments/{commentId}': {
      put: {
        tags: ['Comments'],
        summary: 'Update comment',
        description: 'Updates the Markdown content of an existing comment.',
        parameters: [taskIdParam, commentIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: { content: { type: 'string', description: 'New comment body (Markdown).' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated comment.' }, 404: { description: 'Comment not found.' } },
      },
      delete: {
        tags: ['Comments'],
        summary: 'Delete comment',
        description: 'Deletes the specified comment from the task.',
        parameters: [taskIdParam, commentIdParam],
        responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } },
      },
    },
    // ------------------------------------------------------------------
    // Task logs
    // ------------------------------------------------------------------
    '/api/tasks/{id}/logs': {
      get: {
        tags: ['Logs'],
        summary: 'List task logs',
        description: 'Returns all log entries for the task.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Log entries.' }, 404: { description: 'Not found.' } },
      },
      post: {
        tags: ['Logs'],
        summary: 'Add task log',
        description: 'Appends a log entry to the task.',
        parameters: [taskIdParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: logEntryBodySchema } },
        },
        responses: { 201: { description: 'Created.' }, 400: { description: 'Error.' }, 404: { description: 'Not found.' } },
      },
      delete: {
        tags: ['Logs'],
        summary: 'Clear task logs',
        description: 'Removes all log entries for the task.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Cleared.' }, 404: { description: 'Not found.' } },
      },
    },
    // ------------------------------------------------------------------
    // Columns (default board)
    // ------------------------------------------------------------------
    '/api/columns': {
      get: {
        tags: ['Columns'],
        summary: 'List columns',
        description: 'Returns the ordered column definitions for the default board.',
        responses: { 200: { description: 'Column list.' } },
      },
      post: {
        tags: ['Columns'],
        summary: 'Add column',
        description: "Creates a new column on the default board. New columns are appended to the end of the board's current column order.",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'name'],
                properties: {
                  id: { type: 'string', description: 'Unique column identifier.' },
                  name: { type: 'string', description: 'Display name.' },
                  color: { type: 'string', description: 'Hex color (default: `#6b7280`).' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Created.' }, 400: { description: 'Validation error.' } },
      },
    },
    '/api/columns/reorder': {
      put: {
        tags: ['Columns'],
        summary: 'Reorder columns',
        description: 'Reorders the columns for the specified board (or default board if `boardId` is omitted).',
        parameters: [{ name: 'boardId', in: 'query' as const, schema: { type: 'string' as const }, description: 'Target board ID (uses default if omitted).' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['columnIds'],
                properties: {
                  columnIds: { type: 'array', items: { type: 'string' }, description: 'Ordered array of column IDs.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Reordered columns.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/columns/minimized': {
      put: {
        tags: ['Columns'],
        summary: 'Set minimized columns',
        description: 'Sets which columns are minimized for the specified board (or default board if `boardId` is omitted).',
        parameters: [{ name: 'boardId', in: 'query' as const, schema: { type: 'string' as const }, description: 'Target board ID (uses default if omitted).' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['columnIds'],
                properties: {
                  columnIds: { type: 'array', items: { type: 'string' }, description: 'IDs of columns to minimize.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated minimized columns.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/columns/{id}': {
      put: {
        tags: ['Columns'],
        summary: 'Update column',
        description: "Updates a column's display name and/or color on the default board.",
        parameters: [{ name: 'id', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Column identifier.' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'New display name.' },
                  color: { type: 'string', description: 'New hex color.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated column.' }, 404: { description: 'Not found.' } },
      },
      delete: {
        tags: ['Columns'],
        summary: 'Delete column',
        description: 'Deletes a column on the default board. Fails if the column still contains tasks.',
        parameters: [{ name: 'id', in: 'path' as const, required: true as const, schema: { type: 'string' as const }, description: 'Column identifier.' }],
        responses: { 200: { description: 'Deleted.' }, 400: { description: 'Column not empty.' } },
      },
    },
    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get settings',
        description: "Returns the workspace's current display and behavior settings used by the UI surfaces.",
        responses: { 200: { description: 'Settings object.' } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Update settings',
        description: 'Updates workspace display settings and immediately broadcasts the change to connected WebSocket clients.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                description: 'Full `CardDisplaySettings` object. Only provided fields are changed.',
                properties: {
                  showPriorityBadges: { type: 'boolean' },
                  showAssignee: { type: 'boolean' },
                  showDueDate: { type: 'boolean' },
                  showLabels: { type: 'boolean' },
                  showFileName: { type: 'boolean' },
                  showDeletedColumn: { type: 'boolean' },
                  defaultPriority: { type: 'string' },
                  defaultStatus: { type: 'string' },
                  boardBackgroundMode: { type: 'string', enum: ['fancy', 'plain'] },
                  boardBackgroundPreset: { type: 'string', enum: ['aurora', 'sunset', 'meadow', 'nebula', 'lagoon', 'candy', 'ember', 'violet', 'paper', 'mist', 'sand'] },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated settings.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/plugin-settings': {
      get: {
        tags: ['Plugins'],
        summary: 'List plugin providers',
        description: 'Returns the capability-grouped plugin inventory with selected-provider state and shared redaction metadata. Secret values are never included in this list payload. When auth is active, callers must be authenticated and allowed to perform `plugin-settings.read`; redaction supplements authorization rather than replacing it.',
        responses: {
          200: { description: 'Capability-grouped plugin inventory.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Authenticated caller is not allowed to perform `plugin-settings.read`.' },
          500: { description: 'Unable to list plugin settings.' },
        },
      },
    },
    '/api/plugin-settings/{capability}/{providerId}': {
      get: {
        tags: ['Plugins'],
        summary: 'Read plugin settings',
        description: 'Returns the redacted plugin-settings read model for one provider. Persisted secret fields are masked and surfaced only as write-only placeholders. When auth is active, callers must be authenticated and allowed to perform `plugin-settings.read`; allowed reads remain redacted.',
        parameters: [pluginCapabilityParam, pluginProviderIdParam],
        responses: {
          200: { description: 'Redacted provider read model.' },
          401: { description: 'Authentication required.' },
          403: { description: 'Authenticated caller is not allowed to perform `plugin-settings.read`.' },
          404: { description: 'Provider not found for the requested capability.' },
          500: { description: 'Unable to read plugin settings.' },
        },
      },
    },
    '/api/plugin-settings/{capability}/{providerId}/select': {
      put: {
        tags: ['Plugins'],
        summary: 'Select plugin provider',
        description: 'Persists the selected provider for one capability. Existing authorization wrappers remain in force for this privileged mutation.',
        parameters: [pluginCapabilityParam, pluginProviderIdParam],
        responses: {
          200: { description: 'Updated redacted provider read model after selection.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Provider not found for the requested capability.' },
          500: { description: 'Unable to persist the selected provider.' },
        },
      },
    },
    '/api/plugin-settings/{capability}/{providerId}/options': {
      put: {
        tags: ['Plugins'],
        summary: 'Update plugin options',
        description: 'Persists provider options and returns the redacted provider read model. Secret placeholders may be submitted unchanged to preserve existing stored secrets.',
        parameters: [pluginCapabilityParam, pluginProviderIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                properties: {
                  options: {
                    type: 'object' as const,
                    description: 'Provider options payload to persist under the selected capability/provider pair.',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated redacted provider read model after persisting options.' },
          400: { description: 'Invalid options payload.' },
          403: { description: 'Forbidden.' },
          404: { description: 'Provider not found for the requested capability.' },
          500: { description: 'Unable to persist plugin options.' },
        },
      },
    },
    '/api/plugin-settings/install': {
      post: {
        tags: ['Plugins'],
        summary: 'Install plugin package',
        description: 'Runs the guarded in-product installer for exact unscoped `kl-*` package names only. Responses surface redacted diagnostics and never expose raw installer stdout/stderr.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['packageName', 'scope'],
                properties: {
                  packageName: { type: 'string' as const, description: 'Exact unscoped `kl-*` package name.' },
                  scope: { type: 'string' as const, enum: ['workspace', 'global'] as const, description: 'Install destination.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Redacted install result.' },
          400: { description: 'Rejected input or redacted install failure.' },
          403: { description: 'Forbidden.' },
          500: { description: 'Unexpected installer error.' },
        },
      },
    },
    // ------------------------------------------------------------------
    // Labels
    // ------------------------------------------------------------------
    '/api/labels': {
      get: {
        tags: ['Labels'],
        summary: 'List labels',
        description: 'Returns all label definitions with their colors and groups.',
        responses: { 200: { description: 'Label map.' } },
      },
    },
    '/api/labels/{name}': {
      put: {
        tags: ['Labels'],
        summary: 'Set label',
        description: 'Creates or updates a label definition (color and optional group).',
        parameters: [labelNameParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['color'],
                properties: {
                  color: { type: 'string', description: 'Hex color string.' },
                  group: { type: 'string', description: 'Optional group name.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated label map.' }, 400: { description: 'Error.' } },
      },
      patch: {
        tags: ['Labels'],
        summary: 'Rename label',
        description: 'Renames a label and cascades the change to all cards that use it.',
        parameters: [labelNameParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['newName'],
                properties: { newName: { type: 'string', description: 'New label name.' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated label map after rename.' }, 400: { description: 'Error.' } },
      },
      delete: {
        tags: ['Labels'],
        summary: 'Delete label',
        description: 'Deletes a label definition and removes it from all cards that reference it.',
        parameters: [labelNameParam],
        responses: { 200: { description: 'Deleted.' }, 400: { description: 'Error.' } },
      },
    },
    // ------------------------------------------------------------------
    // Workspace
    // ------------------------------------------------------------------
    '/api/card-state/status': {
      get: {
        tags: ['Workspace'],
        summary: 'Get card-state status',
        description: 'Returns the active `card.state` provider status for the standalone runtime, including backend family, availability, the stable auth-absent default actor contract, and whether a configured `auth.identity` provider is currently causing `identity-unavailable` failures.',
        responses: { 200: { description: 'Card-state provider status.' } },
      },
    },
    '/api/workspace': {
      get: {
        tags: ['Workspace'],
        summary: 'Get workspace info',
        description: 'Returns workspace-level connection metadata plus resolved storage, auth, webhook, and `card.state` provider information, including filesystem watcher support.',
        responses: { 200: { description: 'Workspace info.' } },
      },
    },
    '/api/auth': {
      get: {
        tags: ['Workspace'],
        summary: 'Get auth status',
        description: 'Returns auth provider metadata plus safe request-scoped token diagnostics for the current standalone HTTP request.',
        responses: { 200: { description: 'Auth status.' } },
      },
    },
    '/api/storage': {
      get: {
        tags: ['Workspace'],
        summary: 'Get storage status',
        description: 'Returns the active card, attachment, webhook, and `card.state` provider IDs plus host-facing file/watch metadata.',
        responses: { 200: { description: 'Storage status.' } },
      },
    },
    '/api/events': {
      get: {
        tags: ['Workspace'],
        summary: 'List available events',
        description: 'Returns discoverable SDK events, including built-in before/after events and any plugin-declared additions. Supports filtering by phase and wildcard mask.',
        parameters: [
          {
            name: 'type',
            in: 'query' as const,
            schema: { type: 'string' as const, enum: ['before', 'after', 'all'] as const },
            description: 'Optional event phase filter. Defaults to `all`.',
          },
          {
            name: 'mask',
            in: 'query' as const,
            schema: { type: 'string' as const },
            description: 'Optional EventEmitter2-style wildcard mask such as `task.*` or `comment.**`.',
          },
        ],
        responses: {
          200: {
            description: 'Available event descriptors.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/AvailableEventDescriptor' },
                },
              },
            },
          },
          400: { description: 'Invalid type filter.' },
        },
      },
    },
    '/api/storage/migrate-to-sqlite': {
      post: {
        tags: ['Workspace'],
        summary: 'Migrate to SQLite',
        description: 'Migrates cards from the built-in markdown provider to the first-party `sqlite` compatibility provider (`kl-plugin-storage-sqlite`) and updates compatibility config fields in `.kanban.json`. This endpoint does not migrate into arbitrary external providers.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sqlitePath: { type: 'string', description: 'Optional database path relative to workspace root.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Migration result.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/storage/migrate-to-markdown': {
      post: {
        tags: ['Workspace'],
        summary: 'Migrate to Markdown',
        description: 'Migrates cards from the built-in SQLite provider back to markdown files and updates compatibility config fields. Existing source data is left in place as a manual backup.',
        responses: { 200: { description: 'Migration result.' }, 400: { description: 'Error.' } },
      },
    },
    '/api/resolve-path': {
      get: {
        tags: ['Workspace'],
        summary: 'Resolve path',
        description: 'Resolves a workspace-relative, absolute, or `~`-prefixed path to its canonical absolute filesystem path.',
        parameters: [
          { name: 'path', in: 'query' as const, required: true as const, schema: { type: 'string' as const }, description: 'Path to resolve.' },
        ],
        responses: { 200: { description: 'Resolved absolute path.' }, 400: { description: 'Path parameter missing.' } },
      },
    },
  },
}

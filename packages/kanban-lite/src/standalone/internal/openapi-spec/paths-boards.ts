import {
  boardIdParam,
  taskIdParam,
  actionParam,
  formIdParam,
  checklistIndexParam,
  listTasksQueryParams,
  createTaskBodySchema,
  logEntryBodySchema,
  cardStateReadBodySchema,
  checklistCreateBodySchema,
  checklistEditBodySchema,
  checklistExpectedRawBodySchema,
} from './params'

export const boardsPaths = {
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
        description: 'Returns tasks for the specified board. Supports the same `q`, `fuzzy`, `meta.*`, and field filters as `/api/tasks`. Read models include a server-owned `permissions` capability envelope plus side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
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
        description: 'Returns the currently active/open task for the board, or `null` when none is active. Active-task read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and caller-scoped `cardState` metadata.',
        parameters: [boardIdParam],
        responses: { 200: { description: 'Active task or null.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}': {
      get: {
        tags: ['Board Tasks'],
        summary: 'Get task (board-scoped)',
        description: 'Returns a single task from the specified board. The `:id` segment supports partial ID matching. Read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and side-effect-free `cardState.unread` / `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
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
    '/api/boards/{boardId}/tasks/{id}/checklist': {
      get: {
        tags: ['Board Tasks'],
        summary: 'List checklist items (board-scoped)',
        description: 'Returns the shared checklist read model for one task on the specified board.',
        parameters: [boardIdParam, taskIdParam],
        responses: { 200: { description: 'Checklist read model.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 404: { description: 'Not found.' } },
      },
      post: {
        tags: ['Board Tasks'],
        summary: 'Add checklist item (board-scoped)',
        description: 'Appends a new checklist item to the task on the specified board and returns the refreshed checklist read model.',
        parameters: [boardIdParam, taskIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: checklistCreateBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Updated checklist.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 400: { description: 'Validation error.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/checklist/{index}': {
      put: {
        tags: ['Board Tasks'],
        summary: 'Edit checklist item (board-scoped)',
        description: 'Edits one checklist item on the specified board and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [boardIdParam, taskIdParam, checklistIndexParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: checklistEditBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Updated checklist.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 400: { description: 'Validation error.' }, 404: { description: 'Not found.' } },
      },
      delete: {
        tags: ['Board Tasks'],
        summary: 'Delete checklist item (board-scoped)',
        description: 'Deletes one checklist item on the specified board and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [boardIdParam, taskIdParam, checklistIndexParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: checklistExpectedRawBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Updated checklist.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 400: { description: 'Validation error.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/checklist/{index}/check': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Check checklist item (board-scoped)',
        description: 'Marks one checklist item complete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [boardIdParam, taskIdParam, checklistIndexParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: checklistExpectedRawBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Updated checklist.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 400: { description: 'Validation error.' }, 404: { description: 'Not found.' } },
      },
    },
    '/api/boards/{boardId}/tasks/{id}/checklist/{index}/uncheck': {
      post: {
        tags: ['Board Tasks'],
        summary: 'Uncheck checklist item (board-scoped)',
        description: 'Marks one checklist item incomplete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [boardIdParam, taskIdParam, checklistIndexParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: checklistExpectedRawBodySchema,
            },
          },
        },
        responses: { 200: { description: 'Updated checklist.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 400: { description: 'Validation error.' }, 404: { description: 'Not found.' } },
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
}

import {
  taskIdParam,
  actionParam,
  formIdParam,
  filenameParam,
  commentIdParam,
  checklistIndexParam,
  listTasksQueryParams,
  createTaskBodySchema,
  logEntryBodySchema,
  cardStateReadBodySchema,
  checklistCreateBodySchema,
  checklistEditBodySchema,
  checklistExpectedRawBodySchema,
} from './params'

export const tasksPaths = {
    '/api/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks',
        description: 'Returns tasks on the default board. Supports exact free-text search via `q`, optional fuzzy matching via `fuzzy=true`, and field-scoped metadata filters via `meta.<field>=value`. Read models include a server-owned `permissions` capability envelope plus side-effect-free `cardState.unread` and `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
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
        description: 'Returns the currently active/open task on the default board, or `null` when no task is active. Active-task read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and caller-scoped `cardState` metadata.',
        responses: { 200: { description: 'Active task or null.' } },
      },
    },
    '/api/tasks/{id}': {
      get: {
        tags: ['Tasks'],
        summary: 'Get task',
        description: 'Returns a single task from the default board. The `:id` segment supports partial ID matching. Read models include server-owned `permissions`, resolved form descriptors in `resolvedForms`, and side-effect-free `cardState.unread` / `cardState.open` metadata for the current actor; this is separate from active-task UI state.',
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
    '/api/tasks/{id}/checklist': {
      get: {
        tags: ['Tasks'],
        summary: 'List checklist items',
        description: 'Returns the shared checklist read model for the task on the default board.',
        parameters: [taskIdParam],
        responses: { 200: { description: 'Checklist read model.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChecklistReadModel' } } } }, 404: { description: 'Not found.' } },
      },
      post: {
        tags: ['Tasks'],
        summary: 'Add checklist item',
        description: 'Appends a new checklist item to the task on the default board and returns the refreshed checklist read model.',
        parameters: [taskIdParam],
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
    '/api/tasks/{id}/checklist/{index}': {
      put: {
        tags: ['Tasks'],
        summary: 'Edit checklist item',
        description: 'Edits one checklist item on the task and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [taskIdParam, checklistIndexParam],
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
        tags: ['Tasks'],
        summary: 'Delete checklist item',
        description: 'Deletes one checklist item on the task and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [taskIdParam, checklistIndexParam],
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
    '/api/tasks/{id}/checklist/{index}/check': {
      post: {
        tags: ['Tasks'],
        summary: 'Check checklist item',
        description: 'Marks one checklist item complete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [taskIdParam, checklistIndexParam],
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
    '/api/tasks/{id}/checklist/{index}/uncheck': {
      post: {
        tags: ['Tasks'],
        summary: 'Uncheck checklist item',
        description: 'Marks one checklist item incomplete and returns the refreshed checklist read model. Supply `expectedRaw` to guard against stale concurrent edits.',
        parameters: [taskIdParam, checklistIndexParam],
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
}

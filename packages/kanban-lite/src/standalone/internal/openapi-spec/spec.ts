import { boardsPaths } from './paths-boards'
import { tasksPaths } from './paths-tasks'
import { miscPaths } from './paths-misc'

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
          tasks: { type: 'array', items: { type: 'string' }, description: 'Optional single-line Markdown checklist items stored on the card when checklist visibility is allowed.' },
          metadata: { type: 'object', description: 'Arbitrary user-defined key/value metadata.' },
          content: { type: 'string', description: 'Full Markdown content.' },
          comments: { type: 'array', description: 'Attached comments.' },
          forms: { type: 'array', description: 'Attached form references.' },
          formData: { type: 'object', description: 'Saved form data keyed by form ID.' },
          actions: { type: 'array', description: 'Action names available on the card.' },
          cardState: { $ref: '#/components/schemas/CardStateReadModel' },
          permissions: { type: 'object', description: 'Server-owned task capability envelope for the current caller, covering comment, attachment, form, checklist, and named action affordances.' },
          resolvedForms: { type: 'array', description: 'Resolved form descriptors returned on task detail and active-task reads so clients can render server-owned schemas, UI metadata, and initial data directly.' },
        },
      },
      ChecklistItemReadModel: {
        type: 'object',
        description: 'One checklist item returned by the shared checklist read model.',
        properties: {
          index: { type: 'integer' },
          raw: { type: 'string', description: 'Canonical raw Markdown task line stored on the card.' },
          expectedRaw: { type: 'string', description: 'Caller-visible raw Markdown task line to send back for optimistic concurrency checks.' },
          checked: { type: 'boolean' },
          text: { type: 'string', description: 'Task text with simple inline Markdown preserved.' },
        },
      },
      ChecklistReadModel: {
        type: 'object',
        description: 'Shared checklist read model returned by REST, CLI, and MCP checklist surfaces.',
        properties: {
          cardId: { type: 'string' },
          boardId: { type: 'string' },
          token: { type: 'string', description: 'Opaque optimistic-concurrency token required for checklist adds.' },
          summary: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              completed: { type: 'integer' },
              incomplete: { type: 'integer' },
            },
          },
          items: { type: 'array', items: { $ref: '#/components/schemas/ChecklistItemReadModel' } },
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
    ...boardsPaths,
    ...tasksPaths,
    ...miscPaths,
  },
}

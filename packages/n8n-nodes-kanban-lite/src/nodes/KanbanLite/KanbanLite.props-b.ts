import type { INodeProperties } from 'n8n-workflow'

export const propsB: INodeProperties[] = [
      // Column fields
      // -----------------------------------------------
      {
        displayName: 'Color',
        name: 'color',
        type: 'color',
        default: '#3b82f6',
        description: 'Column or label color in hex format',
        displayOptions: {
          show: {
            resource: ['column', 'label'],
            operation: ['add', 'update', 'set'],
          },
        },
      },
      {
        displayName: 'Column IDs (JSON array or comma-separated)',
        name: 'columnIds',
        type: 'string',
        default: '',
        description: 'Ordered list of column IDs for reorder/minimize operations',
        displayOptions: {
          show: {
            resource: ['column'],
            operation: ['reorder', 'setMinimized'],
          },
        },
      },
      // -----------------------------------------------
      // Label fields
      // -----------------------------------------------
      {
        displayName: 'New Name',
        name: 'newName',
        type: 'string',
        default: '',
        description: 'Replacement name when renaming a label',
        displayOptions: {
          show: {
            resource: ['label'],
            operation: ['rename'],
          },
        },
      },
      {
        displayName: 'Group',
        name: 'group',
        type: 'string',
        default: '',
        description: 'Optional label group (e.g. "Type", "Priority")',
        displayOptions: {
          show: {
            resource: ['label'],
            operation: ['set'],
          },
        },
      },
      // -----------------------------------------------
      // Settings fields
      // -----------------------------------------------
      {
        displayName: 'Settings (JSON)',
        name: 'settingsData',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        description: 'Settings fields to update as a JSON object (e.g. {"showLabels": true})',
        displayOptions: {
          show: {
            resource: ['settings'],
            operation: ['update'],
          },
        },
      },
      // -----------------------------------------------
      // Storage fields
      // -----------------------------------------------
      {
        displayName: 'SQLite Path',
        name: 'sqlitePath',
        type: 'string',
        default: '',
        description: 'Optional path for the SQLite database file (defaults to .kanban/kanban.db)',
        displayOptions: {
          show: {
            resource: ['storage'],
            operation: ['migrateToSqlite'],
          },
        },
      },
      // -----------------------------------------------
      // Webhook fields
      // -----------------------------------------------
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        default: '',
        description: 'Webhook target URL (must be publicly reachable)',
        displayOptions: {
          show: {
            resource: ['webhook'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Events (JSON array or comma-separated)',
        name: 'events',
        type: 'string',
        default: '',
        description: 'Events to subscribe to (e.g. ["task.created","task.updated"] or task.created,task.updated)',
        displayOptions: {
          show: {
            resource: ['webhook'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Secret',
        name: 'secret',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description: 'Optional HMAC-SHA256 signing secret for webhook delivery',
        displayOptions: {
          show: {
            resource: ['webhook'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Active',
        name: 'active',
        type: 'boolean',
        default: true,
        description: 'Whether the webhook should receive events',
        displayOptions: {
          show: {
            resource: ['webhook'],
            operation: ['update'],
          },
        },
      },
      // -----------------------------------------------
      // Form fields
      // -----------------------------------------------
      {
        displayName: 'Form Data (JSON)',
        name: 'formData',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        description: 'Form submission data as a JSON object',
        displayOptions: {
          show: {
            resource: ['form'],
            operation: ['submit'],
          },
        },
      },
]

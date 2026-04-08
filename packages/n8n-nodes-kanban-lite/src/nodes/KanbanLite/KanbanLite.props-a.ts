import type { INodeProperties } from 'n8n-workflow'

export const propsA: INodeProperties[] = [
      // -----------------------------------------------
      // Transport
      // -----------------------------------------------
      {
        displayName: 'Transport',
        name: 'transport',
        type: 'options',
        options: [
          { name: 'Remote API', value: 'api', description: 'Connect to a running Kanban Lite standalone server via HTTP' },
          { name: 'Local SDK', value: 'sdk', description: 'Access a local workspace directly via the Kanban Lite SDK (requires kanban-lite installed)' },
        ],
        default: 'api',
        description: 'How this node connects to Kanban Lite',
      },
      // -----------------------------------------------
      // Resource
      // -----------------------------------------------
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Attachment', value: 'attachment' },
          { name: 'Auth', value: 'auth' },
          { name: 'Board', value: 'board' },
          { name: 'Card', value: 'card' },
          { name: 'Column', value: 'column' },
          { name: 'Comment', value: 'comment' },
          { name: 'Form', value: 'form' },
          { name: 'Label', value: 'label' },
          { name: 'Settings', value: 'settings' },
          { name: 'Storage', value: 'storage' },
          { name: 'Webhook', value: 'webhook' },
          { name: 'Workspace', value: 'workspace' },
        ],
        default: 'card',
        description: 'The resource to operate on',
      },
      // -----------------------------------------------
      // Operations – one selector per resource
      // -----------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['board'] } },
        options: [
          { name: 'List', value: 'list', action: 'List all boards' },
          { name: 'Get', value: 'get', action: 'Get a board by ID' },
          { name: 'Create', value: 'create', action: 'Create a board' },
          { name: 'Update', value: 'update', action: 'Update a board' },
          { name: 'Delete', value: 'delete', action: 'Delete a board' },
          { name: 'Set as Default', value: 'setDefault', action: 'Set board as default' },
          { name: 'Trigger Board Action', value: 'triggerAction', action: 'Trigger a board action' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['card'] } },
        options: [
          { name: 'List', value: 'list', action: 'List cards' },
          { name: 'Get', value: 'get', action: 'Get a card by ID' },
          { name: 'Create', value: 'create', action: 'Create a card' },
          { name: 'Update', value: 'update', action: 'Update a card' },
          { name: 'Move', value: 'move', action: 'Move card to a different column' },
          { name: 'Delete', value: 'delete', action: 'Delete a card' },
          { name: 'Transfer', value: 'transfer', action: 'Transfer card to another board' },
          { name: 'Purge Deleted', value: 'purgeDeleted', action: 'Permanently remove all deleted cards' },
          { name: 'Trigger Card Action', value: 'triggerAction', action: 'Trigger a card action' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['column'] } },
        options: [
          { name: 'List', value: 'list', action: 'List columns' },
          { name: 'Add', value: 'add', action: 'Add a column' },
          { name: 'Update', value: 'update', action: 'Update a column' },
          { name: 'Remove', value: 'remove', action: 'Remove a column' },
          { name: 'Reorder', value: 'reorder', action: 'Reorder columns' },
          { name: 'Set Minimized', value: 'setMinimized', action: 'Set minimized columns' },
          { name: 'Cleanup', value: 'cleanup', action: 'Move all cards in column to deleted' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['comment'] } },
        options: [
          { name: 'List', value: 'list', action: 'List comments on a card' },
          { name: 'Add', value: 'add', action: 'Add a comment to a card' },
          { name: 'Update', value: 'update', action: 'Update a comment' },
          { name: 'Delete', value: 'delete', action: 'Delete a comment' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['attachment'] } },
        options: [
          { name: 'List', value: 'list', action: 'List attachments on a card' },
          { name: 'Add', value: 'add', action: 'Add an attachment to a card' },
          { name: 'Remove', value: 'remove', action: 'Remove an attachment from a card' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['label'] } },
        options: [
          { name: 'List', value: 'list', action: 'List labels' },
          { name: 'Set', value: 'set', action: 'Create or update a label' },
          { name: 'Rename', value: 'rename', action: 'Rename a label' },
          { name: 'Delete', value: 'delete', action: 'Delete a label' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['settings'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get board settings' },
          { name: 'Update', value: 'update', action: 'Update board settings' },
        ],
        default: 'get',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['storage'] } },
        options: [
          { name: 'Get Status', value: 'getStatus', action: 'Get storage engine status' },
          { name: 'Migrate to SQLite', value: 'migrateToSqlite', action: 'Migrate board data to SQLite' },
          { name: 'Migrate to Markdown', value: 'migrateToMarkdown', action: 'Migrate board data back to Markdown' },
        ],
        default: 'getStatus',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['form'] } },
        options: [
          { name: 'Submit', value: 'submit', action: 'Submit a form' },
        ],
        default: 'submit',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['webhook'] } },
        options: [
          { name: 'List', value: 'list', action: 'List webhooks' },
          { name: 'Create', value: 'create', action: 'Register a webhook' },
          { name: 'Update', value: 'update', action: 'Update a webhook' },
          { name: 'Delete', value: 'delete', action: 'Delete a webhook' },
        ],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['workspace'] } },
        options: [
          { name: 'Get Info', value: 'getInfo', action: 'Get workspace information' },
        ],
        default: 'getInfo',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['auth'] } },
        options: [
          { name: 'Get Status', value: 'getStatus', action: 'Get auth plugin status' },
        ],
        default: 'getStatus',
      },
      // -----------------------------------------------
      // Common identifiers
      // -----------------------------------------------
      {
        displayName: 'ID',
        name: 'id',
        type: 'string',
        default: '',
        description: 'Unique ID of the record (board, card, column, comment, webhook, or form)',
        displayOptions: {
          show: {
            resource: ['board', 'card', 'column', 'comment', 'webhook', 'form'],
            operation: ['get', 'update', 'delete', 'setDefault', 'triggerAction', 'move', 'transfer', 'cleanup', 'remove', 'add', 'submit'],
          },
        },
      },
      {
        displayName: 'Board ID',
        name: 'boardId',
        type: 'string',
        default: '',
        description: 'Optional: target a specific board. Leave empty to use the default board.',
        displayOptions: {
          show: {
            resource: ['card', 'column', 'comment', 'attachment', 'label', 'settings'],
          },
        },
      },
      {
        displayName: 'Card ID',
        name: 'cardId',
        type: 'string',
        default: '',
        description: 'ID of the parent card',
        displayOptions: {
          show: {
            resource: ['comment', 'attachment'],
          },
        },
      },
      // -----------------------------------------------
      // Board fields
      // -----------------------------------------------
      {
        displayName: 'Name',
        name: 'name',
        type: 'string',
        default: '',
        description: 'Name for the board, column, or label',
        displayOptions: {
          show: {
            resource: ['board', 'column'],
            operation: ['create', 'update', 'add'],
          },
        },
      },
      {
        displayName: 'Name',
        name: 'name',
        type: 'string',
        default: '',
        description: 'Label name to operate on',
        displayOptions: {
          show: {
            resource: ['label'],
            operation: ['set', 'rename', 'delete'],
          },
        },
      },
      {
        displayName: 'Description',
        name: 'description',
        type: 'string',
        default: '',
        description: 'Optional board description',
        displayOptions: {
          show: {
            resource: ['board'],
            operation: ['create', 'update'],
          },
        },
      },
      // -----------------------------------------------
      // Card fields
      // -----------------------------------------------
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        default: '',
        description: 'Card title',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Body',
        name: 'body',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        description: 'Card body / description (Markdown supported)',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Status (Column)',
        name: 'status',
        type: 'string',
        default: '',
        description: 'Column identifier for the card (e.g. "todo", "in_progress", "done")',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update', 'move'],
          },
        },
      },
      {
        displayName: 'Priority',
        name: 'priority',
        type: 'options',
        options: [
          { name: '(None)', value: '' },
          { name: 'Critical', value: 'critical' },
          { name: 'High', value: 'high' },
          { name: 'Medium', value: 'medium' },
          { name: 'Low', value: 'low' },
        ],
        default: '',
        description: 'Card priority level',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Assignee',
        name: 'assignee',
        type: 'string',
        default: '',
        description: 'Person assigned to the card',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Due Date',
        name: 'dueDate',
        type: 'string',
        default: '',
        description: 'Due date in ISO format (YYYY-MM-DD or ISO 8601)',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Labels',
        name: 'labels',
        type: 'string',
        default: '',
        description: 'Comma-separated label names or JSON array (e.g. bug,feature or ["bug","feature"])',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Metadata (JSON)',
        name: 'metadata',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        description: 'Custom metadata as a JSON object (e.g. {"jiraKey": "PROJ-123"})',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['create', 'update'],
          },
        },
      },
      {
        displayName: 'Target Board ID',
        name: 'targetBoardId',
        type: 'string',
        default: '',
        description: 'ID of the destination board for card transfer',
        displayOptions: {
          show: {
            resource: ['card'],
            operation: ['transfer'],
          },
        },
      },
      // -----------------------------------------------
      // Action fields (board + card triggerAction)
      // -----------------------------------------------
      {
        displayName: 'Action Name',
        name: 'action',
        type: 'string',
        default: '',
        description: 'Name of the action to trigger',
        displayOptions: {
          show: {
            resource: ['board', 'card'],
            operation: ['triggerAction'],
          },
        },
      },
      {
        displayName: 'Action Payload (JSON)',
        name: 'actionPayload',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        description: 'Optional JSON payload merged into the action parameters',
        displayOptions: {
          show: {
            resource: ['board', 'card'],
            operation: ['triggerAction'],
          },
        },
      },
      // -----------------------------------------------
      // Comment fields
      // -----------------------------------------------
      {
        displayName: 'Author',
        name: 'author',
        type: 'string',
        default: '',
        description: 'Comment author name',
        displayOptions: {
          show: {
            resource: ['comment'],
            operation: ['add'],
          },
        },
      },
      {
        displayName: 'Content',
        name: 'content',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        description: 'Comment text (Markdown supported)',
        displayOptions: {
          show: {
            resource: ['comment'],
            operation: ['add', 'update'],
          },
        },
      },
      // -----------------------------------------------
      // Attachment fields
      // -----------------------------------------------
      {
        displayName: 'Attachment File Path',
        name: 'attachment',
        type: 'string',
        default: '',
        description: 'File path of the attachment to add or the attachment name to remove',
        displayOptions: {
          show: {
            resource: ['attachment'],
            operation: ['add', 'remove'],
          },
        },
      },
      // -----------------------------------------------
]

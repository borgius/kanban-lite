import * as path from 'node:path';
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { SdkTransport } from '../../transport/sdkAdapter';
import { ApiTransport } from '../../transport/apiAdapter';
import type { KanbanSdkLike } from '../../transport/sdkAdapter';
import type { ApiTransportCredentials, KanbanLiteTransport } from '../../transport/types';
import { KanbanTransportError } from '../../transport/types';

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function toItems(data: unknown, itemIndex: number): INodeExecutionData[] {
  const list = Array.isArray(data) ? data : [data ?? null];
  return list.map(item => ({
    json: (item !== null && typeof item === 'object' ? item : { value: item }) as IDataObject,
    pairedItem: { item: itemIndex },
  }));
}

// ---------------------------------------------------------------------------
// Param collection helper
// ---------------------------------------------------------------------------

function gStr(ctx: IExecuteFunctions, name: string, i: number): string {
  try {
    const v = ctx.getNodeParameter(name, i, '') as unknown;
    return typeof v === 'string' ? v : String(v ?? '');
  } catch { return ''; }
}

function gArr(ctx: IExecuteFunctions, name: string, i: number): unknown[] {
  try {
    const v = ctx.getNodeParameter(name, i, '') as unknown;
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim().startsWith('[')) {
      try { return JSON.parse(v) as unknown[]; } catch { /* fall through */ }
    }
    if (typeof v === 'string' && v) return v.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  } catch { return []; }
}

function gJson(ctx: IExecuteFunctions, name: string, i: number): Record<string, unknown> {
  try {
    const v = ctx.getNodeParameter(name, i, '') as unknown;
    if (typeof v === 'string' && v) {
      try { return JSON.parse(v) as Record<string, unknown>; } catch { /* fall through */ }
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    return {};
  } catch { return {}; }
}

function gBool(ctx: IExecuteFunctions, name: string, i: number, def: boolean): boolean {
  try { return ctx.getNodeParameter(name, i, def) as boolean; } catch { return def; }
}

function collectParams(
  ctx: IExecuteFunctions,
  resource: string,
  operation: string,
  i: number,
): Record<string, unknown> {
  const p: Record<string, unknown> = {};

  const set = (key: string, val: unknown) => {
    if (val !== '' && val !== null && val !== undefined) p[key] = val;
  };

  // Common identifiers
  set('id', gStr(ctx, 'id', i));
  set('boardId', gStr(ctx, 'boardId', i));
  set('cardId', gStr(ctx, 'cardId', i));

  switch (resource) {
    case 'board':
      if (operation === 'create' || operation === 'update') {
        set('name', gStr(ctx, 'name', i));
        set('description', gStr(ctx, 'description', i));
      }
      if (operation === 'triggerAction') {
        set('action', gStr(ctx, 'action', i));
        const ap = gJson(ctx, 'actionPayload', i);
        if (Object.keys(ap).length) Object.assign(p, ap);
      }
      break;

    case 'card':
      if (operation === 'create' || operation === 'update') {
        set('title', gStr(ctx, 'title', i));
        set('body', gStr(ctx, 'body', i));
        set('status', gStr(ctx, 'status', i));
        set('priority', gStr(ctx, 'priority', i));
        set('assignee', gStr(ctx, 'assignee', i));
        set('dueDate', gStr(ctx, 'dueDate', i));
        const labs = gArr(ctx, 'labels', i);
        if (labs.length) p['labels'] = labs;
        const meta = gJson(ctx, 'metadata', i);
        if (Object.keys(meta).length) p['metadata'] = meta;
      }
      if (operation === 'move') {
        set('status', gStr(ctx, 'status', i));
      }
      if (operation === 'transfer') {
        set('targetBoardId', gStr(ctx, 'targetBoardId', i));
      }
      if (operation === 'triggerAction') {
        set('action', gStr(ctx, 'action', i));
        const ap = gJson(ctx, 'actionPayload', i);
        if (Object.keys(ap).length) Object.assign(p, ap);
      }
      break;

    case 'comment':
      if (operation === 'add' || operation === 'update') {
        set('author', gStr(ctx, 'author', i));
        set('content', gStr(ctx, 'content', i));
      }
      break;

    case 'attachment':
      if (operation === 'add' || operation === 'remove') {
        set('attachment', gStr(ctx, 'attachment', i));
      }
      break;

    case 'column':
      if (operation === 'add' || operation === 'update') {
        set('name', gStr(ctx, 'name', i));
        set('color', gStr(ctx, 'color', i));
      }
      if (operation === 'reorder' || operation === 'setMinimized') {
        const ids = gArr(ctx, 'columnIds', i);
        if (ids.length) p['columnIds'] = ids;
      }
      break;

    case 'label':
      set('name', gStr(ctx, 'name', i));
      if (operation === 'set') {
        set('color', gStr(ctx, 'color', i));
        set('group', gStr(ctx, 'group', i));
      }
      if (operation === 'rename') {
        set('newName', gStr(ctx, 'newName', i));
      }
      break;

    case 'settings':
      if (operation === 'update') {
        const sd = gJson(ctx, 'settingsData', i);
        Object.assign(p, sd);
      }
      break;

    case 'storage':
      if (operation === 'migrateToSqlite') {
        set('sqlitePath', gStr(ctx, 'sqlitePath', i));
      }
      break;

    case 'webhook':
      if (operation === 'create' || operation === 'update') {
        set('url', gStr(ctx, 'url', i));
        const evts = gArr(ctx, 'events', i);
        if (evts.length) p['events'] = evts;
        set('secret', gStr(ctx, 'secret', i));
      }
      if (operation === 'update') {
        p['active'] = gBool(ctx, 'active', i, true);
      }
      break;

    case 'form':
      if (operation === 'submit') {
        const fd = gJson(ctx, 'formData', i);
        if (Object.keys(fd).length) p['formData'] = fd;
      }
      break;
  }

  return p;
}

// ---------------------------------------------------------------------------
// Transport factory
// ---------------------------------------------------------------------------

async function buildTransport(
  ctx: IExecuteFunctions,
): Promise<KanbanLiteTransport> {
  const mode = ctx.getNodeParameter('transport', 0, 'api') as string;

  if (mode === 'sdk') {
    const creds = await ctx.getCredentials('kanbanLiteSdk') as { workspaceRoot: string; boardDir?: string };
    let sdk: KanbanSdkLike;
    try {
      // kanban-lite/sdk is an optional peer dependency loaded at runtime
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('kanban-lite/sdk') as { KanbanSDK: new (dir?: string) => KanbanSdkLike };
      const kanbanDir = creds.boardDir?.trim() || path.join(creds.workspaceRoot, '.kanban');
      sdk = new mod.KanbanSDK(kanbanDir);
    } catch (err) {
      const causeMessage = err instanceof Error && err.message ? ` (${err.message})` : '';
      throw new NodeOperationError(
        ctx.getNode(),
        'The kanban-lite package must be installed to use SDK transport mode. ' +
          'Run `npm install kanban-lite` in the n8n process directory or switch to Remote API transport.' +
          causeMessage,
      );
    }
    return new SdkTransport({ sdk });
  }

  // API mode
  const creds = await ctx.getCredentials('kanbanLiteApi') as ApiTransportCredentials;
  return new ApiTransport({ credentials: creds });
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/**
 * Kanban Lite app node.
 *
 * Exposes the full kanban-lite action surface through resource/operation
 * groups spanning boards, cards, comments, attachments, columns, labels,
 * settings, storage, forms, webhooks, workspace info, and auth status.
 * All execution routes through the shared transport abstraction so SDK and
 * API modes produce identical normalized outputs.
 */
export class KanbanLite implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Kanban Lite',
    name: 'kanbanLite',
    icon: 'file:kanban-lite.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
    description: 'Interact with a Kanban Lite workspace – boards, cards, comments, attachments, columns, labels, and more',
    defaults: { name: 'Kanban Lite' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'kanbanLiteApi',
        required: false,
        displayOptions: { show: { transport: ['api'] } },
      },
      {
        name: 'kanbanLiteSdk',
        required: false,
        displayOptions: { show: { transport: ['sdk'] } },
      },
    ],
    properties: [
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
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    let transport: KanbanLiteTransport;
    try {
      transport = await buildTransport(this);
    } catch (err) {
      if (err instanceof NodeOperationError) throw err;
      throw new NodeOperationError(this.getNode(), err as Error);
    }

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;
        const params = collectParams(this, resource, operation, i);

        let result: unknown;
        try {
          const r = await transport.execute(resource, operation, params);
          result = r.data;
        } catch (err) {
          if (err instanceof KanbanTransportError) {
            const errorBody: Record<string, string> = {
              message: err.message,
              code: err.code,
            };
            if (err.statusCode !== undefined) {
              errorBody.httpCode = String(err.statusCode);
            }
            throw new NodeApiError(this.getNode(), {
              ...errorBody,
            });
          }
          throw err;
        }

        returnData.push(...toItems(result, i));
      } catch (err) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: err instanceof Error ? err.message : String(err) },
            pairedItem: { item: i },
          });
          continue;
        }
        throw err;
      }
    }

    return [returnData];
  }
}

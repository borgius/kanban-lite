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

export function toItems(data: unknown, itemIndex: number): INodeExecutionData[] {
  const list = Array.isArray(data) ? data : [data ?? null];
  return list.map(item => ({
    json: (item !== null && typeof item === 'object' ? item : { value: item }) as IDataObject,
    pairedItem: { item: itemIndex },
  }));
}

// ---------------------------------------------------------------------------
// Param collection helper
// ---------------------------------------------------------------------------

export function gStr(ctx: IExecuteFunctions, name: string, i: number): string {
  try {
    const v = ctx.getNodeParameter(name, i, '') as unknown;
    return typeof v === 'string' ? v : String(v ?? '');
  } catch { return ''; }
}

export function gArr(ctx: IExecuteFunctions, name: string, i: number): unknown[] {
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

export function gJson(ctx: IExecuteFunctions, name: string, i: number): Record<string, unknown> {
  try {
    const v = ctx.getNodeParameter(name, i, '') as unknown;
    if (typeof v === 'string' && v) {
      try { return JSON.parse(v) as Record<string, unknown>; } catch { /* fall through */ }
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    return {};
  } catch { return {}; }
}

export function gBool(ctx: IExecuteFunctions, name: string, i: number, def: boolean): boolean {
  try { return ctx.getNodeParameter(name, i, def) as boolean; } catch { return def; }
}

export function collectParams(
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

export async function buildTransport(
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KanbanLite } from '../KanbanLite.node'
import { KANBAN_ACTION_CATALOG } from '../../../../../kanban-lite/src/sdk/integrationCatalog'
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow'

// ---------------------------------------------------------------------------
// Shared mock function (module-level, so all tests share the same reference)
// ---------------------------------------------------------------------------

const mockApiExecute = vi.fn().mockResolvedValue({ data: [], statusCode: 200 })
const mockSdkExecute = vi.fn().mockResolvedValue({ data: { id: 'c1' } })

vi.mock('../../../transport/apiAdapter', () => ({
  ApiTransport: class {
    mode = 'api' as const
    execute = mockApiExecute
    canSubscribe = vi.fn().mockReturnValue(true)
    subscribe = vi.fn()
  },
}))

vi.mock('../../../transport/sdkAdapter', () => ({
  SdkTransport: class {
    mode = 'sdk' as const
    execute = mockSdkExecute
    canSubscribe = vi.fn().mockReturnValue(true)
    subscribe = vi.fn()
  },
}))

vi.mock('kanban-lite/sdk', () => ({
  KanbanSDK: class {},
}))

// ---------------------------------------------------------------------------
// Minimal n8n mocks
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<{
  transport: string
  resource: string
  operation: string
  params: Record<string, unknown>
  credentials: Record<string, unknown>
  continueOnFail: boolean
  items: INodeExecutionData[]
}>): IExecuteFunctions {
  const {
    transport = 'api',
    resource = 'card',
    operation = 'list',
    params = {},
    credentials = { baseUrl: 'http://localhost:3000', authMode: 'none' },
    continueOnFail = false,
    items = [{ json: {} }],
  } = overrides

  const allParams: Record<string, unknown> = {
    transport,
    resource,
    operation,
    ...params,
  }

  return {
    getInputData: () => items,
    getNodeParameter: (name: string, _i: number, def: unknown = '') => {
      return name in allParams ? allParams[name] : def
    },
    getCredentials: async (_name: string) => credentials,
    getNode: () => ({ name: 'Kanban Lite', type: 'kanbanLite' } as never),
    continueOnFail: () => continueOnFail,
  } as unknown as IExecuteFunctions
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApiExecute.mockResolvedValue({ data: [], statusCode: 200 })
  mockSdkExecute.mockResolvedValue({ data: { id: 'c1' } })
})

// ---------------------------------------------------------------------------
// Tests: node description metadata
// ---------------------------------------------------------------------------

describe('KanbanLite.description', () => {
  const node = new KanbanLite()

  it('has the correct display name and internal name', () => {
    expect(node.description.displayName).toBe('Kanban Lite')
    expect(node.description.name).toBe('kanbanLite')
  })

  it('exposes all 12 resources', () => {
    const resourceProp = node.description.properties.find(p => p.name === 'resource')!
    const values = (resourceProp.options as Array<{ value: string }>).map(o => o.value)
    for (const r of ['board', 'card', 'column', 'comment', 'attachment', 'label', 'settings', 'storage', 'form', 'webhook', 'workspace', 'auth']) {
      expect(values, `Missing resource: ${r}`).toContain(r)
    }
  })

  it('defines per-resource operation selectors for all 12 resources', () => {
    const ops = node.description.properties.filter(p => p.name === 'operation')
    const covered = ops.flatMap(p => {
      const show = (p.displayOptions as { show?: { resource?: string[] } })?.show
      return show?.resource ?? []
    })
    for (const r of ['board', 'card', 'column', 'comment', 'attachment', 'label', 'settings', 'storage', 'form', 'webhook', 'workspace', 'auth']) {
      expect(covered, `Missing operation selector for resource: ${r}`).toContain(r)
    }
  })

  it('matches the shared action catalog resource/operation matrix', () => {
    const operationProps = node.description.properties.filter(p => p.name === 'operation')
    const actual = new Set<string>()

    for (const prop of operationProps) {
      const resources = ((prop.displayOptions as { show?: { resource?: string[] } })?.show?.resource ?? [])
      const operations = (prop.options as Array<{ value: string }>).map(option => option.value)

      for (const resource of resources) {
        for (const operation of operations) {
          actual.add(`${resource}/${operation}`)
        }
      }
    }

    const expected = new Set(KANBAN_ACTION_CATALOG.map(action => `${action.resource}/${action.operation}`))
    expect([...actual].sort()).toEqual([...expected].sort())
  })

  it('board operations include all 7 expected values', () => {
    const boardOp = node.description.properties.find(p =>
      p.name === 'operation' &&
      (p.displayOptions as { show?: { resource?: string[] } })?.show?.resource?.includes('board')
    )!
    const vals = (boardOp.options as Array<{ value: string }>).map(o => o.value)
    for (const op of ['list', 'get', 'create', 'update', 'delete', 'setDefault', 'triggerAction']) {
      expect(vals, `Missing board op: ${op}`).toContain(op)
    }
  })

  it('card operations include all 9 expected values', () => {
    const cardOp = node.description.properties.find(p =>
      p.name === 'operation' &&
      (p.displayOptions as { show?: { resource?: string[] } })?.show?.resource?.includes('card')
    )!
    const vals = (cardOp.options as Array<{ value: string }>).map(o => o.value)
    for (const op of ['list', 'get', 'create', 'update', 'move', 'delete', 'transfer', 'purgeDeleted', 'triggerAction']) {
      expect(vals, `Missing card op: ${op}`).toContain(op)
    }
  })

  it('column operations include reorder and setMinimized', () => {
    const colOp = node.description.properties.find(p =>
      p.name === 'operation' &&
      (p.displayOptions as { show?: { resource?: string[] } })?.show?.resource?.includes('column')
    )!
    const vals = (colOp.options as Array<{ value: string }>).map(o => o.value)
    expect(vals).toContain('reorder')
    expect(vals).toContain('setMinimized')
    expect(vals).toContain('cleanup')
  })

  it('has credentials for both api and sdk transports', () => {
    const creds = node.description.credentials!
    const names = creds.map(c => c.name)
    expect(names).toContain('kanbanLiteApi')
    expect(names).toContain('kanbanLiteSdk')
  })
})

// ---------------------------------------------------------------------------
// Tests: execute() – API transport
// ---------------------------------------------------------------------------

describe('KanbanLite.execute – API transport', () => {
  const node = new KanbanLite()

  it('card/list returns output items from transport result', async () => {
    const ctx = makeCtx({
      transport: 'api',
      resource: 'card',
      operation: 'list',
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    const result = await node.execute.call(ctx)
    expect(result).toHaveLength(1)
    expect(Array.isArray(result[0])).toBe(true)
  })

  it('returns single-item output for non-array transport result', async () => {
    mockApiExecute.mockResolvedValueOnce({ data: { id: 'b1', name: 'Test' }, statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'board',
      operation: 'get',
      params: { id: 'b1' },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    const result = await node.execute.call(ctx)
    expect(result[0]).toHaveLength(1)
    expect(result[0][0].json).toMatchObject({ id: 'b1' })
  })

  it('collects card create params correctly', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: { id: 'c1' }, statusCode: 201 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'card',
      operation: 'create',
      params: {
        title: 'My Card',
        body: 'Details here',
        priority: 'high',
        status: 'todo',
      },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)

    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[0]).toBe('card')
    expect(callArgs[1]).toBe('create')
    expect(callArgs[2]).toMatchObject({ title: 'My Card', priority: 'high', status: 'todo' })
  })

  it('continues on fail when configured', async () => {
    mockApiExecute.mockRejectedValueOnce(new Error('Transport error'))

    const ctx = makeCtx({
      transport: 'api',
      resource: 'card',
      operation: 'get',
      params: { id: 'missing' },
      continueOnFail: true,
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    const result = await node.execute.call(ctx)
    expect(result[0][0].json).toHaveProperty('error')
    expect((result[0][0].json as { error: string }).error).toContain('Transport error')
  })

  it('collects webhook create params (url, events, secret)', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: { id: 'wh1' }, statusCode: 201 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'webhook',
      operation: 'create',
      params: {
        url: 'https://example.com/hook',
        events: '["task.created","task.updated"]',
        secret: 'my-secret',
      },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)

    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[2]).toMatchObject({
      url: 'https://example.com/hook',
      events: ['task.created', 'task.updated'],
      secret: 'my-secret',
    })
  })

  it('collects column reorder params (columnIds as JSON array)', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: null, statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'column',
      operation: 'reorder',
      params: { columnIds: '["todo","inprogress","done"]' },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)

    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[2]).toMatchObject({ columnIds: ['todo', 'inprogress', 'done'] })
  })

  it('passes boardId and cardId for comment list', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: [], statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'comment',
      operation: 'list',
      params: { cardId: 'c1', boardId: 'b1' },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)
    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[2]).toMatchObject({ cardId: 'c1', boardId: 'b1' })
  })

  it('parses metadata JSON for card create', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: { id: 'c2' }, statusCode: 201 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'card',
      operation: 'create',
      params: {
        title: 'Linked',
        metadata: '{"jiraKey":"PROJ-1"}',
      },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)
    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[2]).toMatchObject({ metadata: { jiraKey: 'PROJ-1' } })
  })

  it('spreads settingsData JSON for settings update', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: {}, statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'settings',
      operation: 'update',
      params: { settingsData: '{"showLabels":true,"compactMode":false}' },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)
    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[2]).toMatchObject({ showLabels: true, compactMode: false })
  })

  it('form/submit dispatches with formData', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: { ok: true }, statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'form',
      operation: 'submit',
      params: { id: 'f1', formData: '{"name":"Alice","email":"alice@example.com"}' },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)
    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[0]).toBe('form')
    expect(callArgs[1]).toBe('submit')
    expect(callArgs[2]).toMatchObject({ id: 'f1', formData: { name: 'Alice', email: 'alice@example.com' } })
  })

  it('storage/getStatus dispatches correctly', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValueOnce({ data: { engine: 'markdown' }, statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'storage',
      operation: 'getStatus',
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    await node.execute.call(ctx)
    const callArgs = execMock.mock.calls[execMock.mock.calls.length - 1]
    expect(callArgs[0]).toBe('storage')
    expect(callArgs[1]).toBe('getStatus')
  })

  it('processes multiple input items', async () => {
    const execMock = mockApiExecute
    execMock.mockResolvedValue({ data: { ok: true }, statusCode: 200 })

    const ctx = makeCtx({
      transport: 'api',
      resource: 'card',
      operation: 'delete',
      params: { id: 'c1' },
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
      items: [{ json: {} }, { json: {} }, { json: {} }],
    })

    const result = await node.execute.call(ctx)
    expect(result[0]).toHaveLength(3)
  })

  it('sdk mode routes execution through the shared sdk transport', async () => {
    const ctx = makeCtx({
      transport: 'sdk',
      resource: 'card',
      operation: 'get',
      params: { id: 'c1' },
      credentials: { workspaceRoot: '/tmp/workspace' },
    })

    const result = await node.execute.call(ctx)

    expect(mockSdkExecute).toHaveBeenCalledWith('card', 'get', { id: 'c1' })
    expect(result[0][0].json).toMatchObject({ id: 'c1' })
  })
})

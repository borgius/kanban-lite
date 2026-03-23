import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeOperationError } from 'n8n-workflow'
import { KanbanTransportError } from '../../../transport/types'
import type { IHookFunctions, ITriggerFunctions, IWebhookFunctions } from 'n8n-workflow'
import { KANBAN_EVENT_CATALOG } from '../../../../../kanban-lite/src/sdk/integrationCatalog'

const mockApiSubscribe = vi.fn()
const mockApiExecute = vi.fn()
const mockApiCanSubscribe = vi.fn().mockReturnValue(true)
const mockSdkSubscribe = vi.fn()
const mockSdkCanSubscribe = vi.fn().mockReturnValue(true)

vi.mock('kanban-lite/sdk', async () => {
  const { KANBAN_EVENT_CATALOG: EVENT_CATALOG } = await import('../../../../../kanban-lite/src/sdk/integrationCatalog')

  return {
    KANBAN_EVENT_CATALOG: EVENT_CATALOG,
    KanbanSDK: class {},
  }
})

vi.mock('../../../transport/apiAdapter', () => ({
  ApiTransport: class {
    mode = 'api' as const
    subscribe = mockApiSubscribe
    execute = mockApiExecute
    canSubscribe = mockApiCanSubscribe
  },
}))

vi.mock('../../../transport/sdkAdapter', () => ({
  SdkTransport: class {
    mode = 'sdk' as const
    subscribe = mockSdkSubscribe
    execute = vi.fn()
    canSubscribe = mockSdkCanSubscribe
  },
}))

import { KanbanLiteTrigger } from '../KanbanLiteTrigger.node'

function makeTriggerCtx(overrides: Partial<{
  transport: string
  event: string
  credentials: Record<string, unknown>
  emit: ReturnType<typeof vi.fn>
}>): ITriggerFunctions {
  const {
    transport = 'sdk',
    event = 'task.created',
    credentials = transport === 'sdk'
      ? { workspaceRoot: '/tmp/workspace' }
      : { baseUrl: 'http://localhost:3000', authMode: 'none' },
    emit = vi.fn(),
  } = overrides

  return {
    getNodeParameter: (name: string) => ({ transport, event }[name]),
    getCredentials: async () => credentials,
    getNode: () => ({ name: 'Kanban Lite Trigger', type: 'kanbanLiteTrigger' } as never),
    emit,
  } as unknown as ITriggerFunctions
}

function makeHookCtx(overrides: Partial<{
  transport: string
  event: string
  credentials: Record<string, unknown>
  staticData: Record<string, unknown>
  webhookUrl: string | undefined
}>): IHookFunctions {
  const {
    transport = 'api',
    event = 'task.created',
    credentials = { baseUrl: 'http://localhost:3000', authMode: 'none' },
    staticData = {},
    webhookUrl = 'https://n8n.example/webhook/kanban-lite-trigger',
  } = overrides

  return {
    getNodeParameter: (name: string) => ({ transport, event }[name]),
    getCredentials: async () => credentials,
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => webhookUrl,
    getNode: () => ({ name: 'Kanban Lite Trigger', type: 'kanbanLiteTrigger' } as never),
  } as unknown as IHookFunctions
}

function makeWebhookCtx(overrides: Partial<{
  event: string
  body: Record<string, unknown>
  headers: Record<string, string | string[] | undefined>
}>): IWebhookFunctions {
  const {
    event = 'task.created',
    body = { event: 'task.created', timestamp: '2026-03-23T00:00:00.000Z', data: { id: 'c1' } },
    headers = { 'x-webhook-event': 'task.created' },
  } = overrides

  return {
    getNodeParameter: () => event,
    getBodyData: () => body,
    getHeaderData: () => headers,
  } as unknown as IWebhookFunctions
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApiCanSubscribe.mockReturnValue(true)
  mockSdkCanSubscribe.mockReturnValue(true)
  mockApiExecute.mockResolvedValue({ data: null, statusCode: 204 })
  mockApiSubscribe.mockResolvedValue({
    id: 'api:task.created:wh-123',
    externalId: 'wh-123',
    dispose: vi.fn(),
  })
  mockSdkSubscribe.mockResolvedValue({
    id: 'sdk:card.create:1',
    dispose: vi.fn(),
  })
})

describe('KanbanLiteTrigger.description', () => {
  const node = new KanbanLiteTrigger()

  it('uses the canonical SDK event catalog for event options', () => {
    const eventProperty = node.description.properties.find(property => property.name === 'event')!
    const values = (eventProperty.options as Array<{ value: string }>).map(option => option.value)

    expect(new Set(values)).toEqual(new Set(KANBAN_EVENT_CATALOG.map(event => event.event)))
    expect(values).toContain('task.created')
    expect(values).toContain('card.create')
    expect(values).not.toContain('card.created')
  })
})

describe('KanbanLiteTrigger.trigger', () => {
  it('subscribes in SDK mode for before-events and emits normalized payloads', async () => {
    const node = new KanbanLiteTrigger()
    const emit = vi.fn()
    const ctx = makeTriggerCtx({ transport: 'sdk', event: 'card.create', emit })

    const response = await node.trigger.call(ctx)

    expect(mockSdkSubscribe).toHaveBeenCalledWith('card.create', expect.any(Function))

    const handler = mockSdkSubscribe.mock.calls[0][1] as (payload: unknown) => void
    handler({ id: 'c1', title: 'Test' })

    expect(emit).toHaveBeenCalledWith([[{
      json: expect.objectContaining({
        event: 'card.create',
        transport: 'sdk',
        phase: 'before',
        payload: { id: 'c1', title: 'Test' },
      }),
    }]])

    await response?.closeFunction?.()
    const registration = await mockSdkSubscribe.mock.results[0].value
    expect(registration.dispose).toHaveBeenCalledTimes(1)
  })

  it('fails clearly in API mode when a before-event is selected', async () => {
    const node = new KanbanLiteTrigger()
    const ctx = makeTriggerCtx({
      transport: 'api',
      event: 'card.create',
      credentials: { baseUrl: 'http://localhost:3000', authMode: 'none' },
    })

    mockApiCanSubscribe.mockReturnValue(false)
    mockApiSubscribe.mockRejectedValueOnce(
      new KanbanTransportError(
        'transport.unsupported_event',
        'Event "card.create" is a before-event and requires SDK transport.',
      ),
    )

    const triggerPromise = node.trigger.call(ctx)

    await expect(triggerPromise).rejects.toBeInstanceOf(NodeOperationError)
    await expect(triggerPromise).rejects.toMatchObject({
      message: expect.stringContaining('SDK transport'),
    })
  })
})

describe('KanbanLiteTrigger.webhookMethods', () => {
  it('registers API triggers through the shared transport and cleans up previous registrations first', async () => {
    const node = new KanbanLiteTrigger()
    const staticData: Record<string, unknown> = {}
    const ctx = makeHookCtx({ staticData })

    await node.webhookMethods.default.create.call(ctx)
    expect(mockApiSubscribe).toHaveBeenCalledWith(
      'task.created',
      expect.any(Function),
      { callbackUrl: 'https://n8n.example/webhook/kanban-lite-trigger' },
    )
    expect(staticData.kanbanLiteTriggerApiWebhookId).toBe('wh-123')

    mockApiSubscribe.mockResolvedValueOnce({
      id: 'api:task.created:wh-456',
      externalId: 'wh-456',
      dispose: vi.fn(),
    })

    await node.webhookMethods.default.create.call(ctx)

    expect(mockApiExecute).toHaveBeenCalledWith('webhook', 'delete', { id: 'wh-123' })
    expect(staticData.kanbanLiteTriggerApiWebhookId).toBe('wh-456')
  })

  it('delete is explicit and idempotent for API registrations', async () => {
    const node = new KanbanLiteTrigger()
    const staticData: Record<string, unknown> = {
      kanbanLiteTriggerApiWebhookId: 'wh-999',
      kanbanLiteTriggerApiRegistrationId: 'api:task.created:wh-999',
      kanbanLiteTriggerApiEvent: 'task.created',
    }
    const ctx = makeHookCtx({ staticData })

    await node.webhookMethods.default.delete.call(ctx)
    await node.webhookMethods.default.delete.call(ctx)

    expect(mockApiExecute).toHaveBeenCalledTimes(1)
    expect(mockApiExecute).toHaveBeenCalledWith('webhook', 'delete', { id: 'wh-999' })
    expect(staticData.kanbanLiteTriggerApiWebhookId).toBeUndefined()
  })

  it('fails clearly during API registration when an unsupported event is chosen', async () => {
    const node = new KanbanLiteTrigger()
    const ctx = makeHookCtx({ event: 'card.create' })

    mockApiSubscribe.mockRejectedValueOnce(
      new KanbanTransportError(
        'transport.unsupported_event',
        'Event "card.create" is a before-event and requires SDK transport.',
      ),
    )

    const createPromise = node.webhookMethods.default.create.call(ctx)

    await expect(createPromise).rejects.toBeInstanceOf(NodeOperationError)
    await expect(createPromise).rejects.toMatchObject({
      message: expect.stringContaining('SDK transport'),
    })
  })
})

describe('KanbanLiteTrigger.webhook', () => {
  it('normalizes inbound API webhook deliveries for downstream workflows', async () => {
    const node = new KanbanLiteTrigger()
    const ctx = makeWebhookCtx({
      body: {
        event: 'task.created',
        timestamp: '2026-03-23T12:34:56.000Z',
        data: { id: 'c1', title: 'Test' },
      },
    })

    const response = await node.webhook.call(ctx)
    const item = response.workflowData?.[0]?.[0]

    expect(item?.json).toMatchObject({
      event: 'task.created',
      transport: 'api',
      phase: 'after',
      timestamp: '2026-03-23T12:34:56.000Z',
      payload: { id: 'c1', title: 'Test' },
    })
  })
})

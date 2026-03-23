import * as path from 'node:path'
import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  ITriggerFunctions,
  ITriggerResponse,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow'
import { NodeOperationError } from 'n8n-workflow'
import { ApiTransport } from '../../transport/apiAdapter'
import { DEFAULT_EVENT_CAPABILITIES } from '../../transport/normalize'
import { SdkTransport } from '../../transport/sdkAdapter'
import type { KanbanSdkLike } from '../../transport/sdkAdapter'
import type { ApiTransportCredentials, EventCapabilityEntry, KanbanLiteTransport } from '../../transport/types'
import { KanbanTransportError } from '../../transport/types'

type EventDescriptor = EventCapabilityEntry & {
  readonly event: string
  readonly label: string
  readonly resource: string
}

type SdkModuleShape = {
  readonly KANBAN_EVENT_CATALOG?: readonly EventDescriptor[]
  readonly KanbanSDK?: new (dir?: string) => KanbanSdkLike
  readonly default?: {
    readonly KANBAN_EVENT_CATALOG?: readonly EventDescriptor[]
    readonly KanbanSDK?: new (dir?: string) => KanbanSdkLike
  }
}

function guessResource(eventName: string): string {
  if (eventName.startsWith('task.') || eventName.startsWith('card.') || eventName.startsWith('log.')) {
    return 'card'
  }
  if (eventName.startsWith('board.')) {
    return 'board'
  }
  if (eventName.startsWith('comment.')) {
    return 'comment'
  }
  if (eventName.startsWith('column.')) {
    return 'column'
  }
  if (eventName.startsWith('attachment.')) {
    return 'attachment'
  }
  if (eventName.startsWith('settings.')) {
    return 'settings'
  }
  if (eventName.startsWith('storage.')) {
    return 'storage'
  }
  if (eventName.startsWith('label.')) {
    return 'label'
  }
  if (eventName.startsWith('webhook.')) {
    return 'webhook'
  }
  if (eventName.startsWith('form.')) {
    return 'form'
  }
  if (eventName.startsWith('auth.')) {
    return 'auth'
  }
  return 'workspace'
}

function guessLabel(eventName: string, entry: EventCapabilityEntry): string {
  const words = eventName.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  const humanized = words.charAt(0).toUpperCase() + words.slice(1)
  return entry.apiAfter ? humanized : `Before ${humanized}`
}

function toEventDescriptor(entry: EventCapabilityEntry): EventDescriptor {
  return {
    ...entry,
    label: guessLabel(entry.event, entry),
    resource: guessResource(entry.event),
  }
}

function readCatalogFromModule(mod: SdkModuleShape | undefined): readonly EventDescriptor[] | undefined {
  return mod?.KANBAN_EVENT_CATALOG ?? mod?.default?.KANBAN_EVENT_CATALOG
}

function loadEventCatalog(): readonly EventDescriptor[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdkModule = require('kanban-lite/sdk') as SdkModuleShape
    const catalog = readCatalogFromModule(sdkModule)
    if (catalog?.length) {
      return catalog
    }
  } catch {
    // ignore and continue to monorepo/source fallback
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sourceModule = require('../../../../kanban-lite/src/sdk/integrationCatalog') as SdkModuleShape
    const catalog = readCatalogFromModule(sourceModule)
    if (catalog?.length) {
      return catalog
    }
  } catch {
    // ignore and continue to built-in fallback
  }

  return DEFAULT_EVENT_CAPABILITIES.map(toEventDescriptor)
}

const KANBAN_EVENT_CATALOG = loadEventCatalog()

const EVENT_LOOKUP = new Map(KANBAN_EVENT_CATALOG.map(event => [event.event, event]))

const EVENT_OPTIONS = KANBAN_EVENT_CATALOG.map(event => ({
  name: event.apiAfter ? event.label : `${event.label} (SDK only)`,
  value: event.event,
  description: event.apiAfter
    ? 'Available in Local SDK and Remote API transport modes'
    : 'Available only in Local SDK mode because before-events cannot be delivered remotely',
}))

const API_REGISTRATION_ID_KEY = 'kanbanLiteTriggerApiRegistrationId'
const API_WEBHOOK_ID_KEY = 'kanbanLiteTriggerApiWebhookId'
const API_EVENT_KEY = 'kanbanLiteTriggerApiEvent'

type TriggerContext = ITriggerFunctions | IHookFunctions | IWebhookFunctions

function getEventDescriptor(eventName: string): EventDescriptor {
  const descriptor = EVENT_LOOKUP.get(eventName)
  if (!descriptor) {
    throw new Error(`Unknown Kanban Lite trigger event: ${eventName}`)
  }
  return descriptor
}

function toNodeJson(value: unknown): IDataObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as IDataObject
  }

  return { value } as IDataObject
}

function normalizeTriggerItem(
  eventName: string,
  transport: 'sdk' | 'api',
  payload: unknown,
  envelope?: Record<string, unknown>,
): IDataObject {
  const descriptor = getEventDescriptor(eventName)

  return {
    event: eventName,
    label: descriptor.label,
    resource: descriptor.resource,
    transport,
    phase: descriptor.sdkBefore ? 'before' : 'after',
    capabilities: {
      sdkBefore: descriptor.sdkBefore,
      sdkAfter: descriptor.sdkAfter,
      apiAfter: descriptor.apiAfter,
    },
    timestamp:
      typeof envelope?.timestamp === 'string'
        ? envelope.timestamp
        : new Date().toISOString(),
    payload: toNodeJson(payload),
    raw: envelope ? (envelope as IDataObject) : undefined,
  }
}

function asNodeOperationError(ctx: TriggerContext, err: unknown): NodeOperationError {
  if (err instanceof NodeOperationError) return err
  if (err instanceof KanbanTransportError) {
    return new NodeOperationError(ctx.getNode(), err.message)
  }

  return new NodeOperationError(
    ctx.getNode(),
    err instanceof Error ? err.message : String(err),
  )
}

async function buildTransport(ctx: TriggerContext): Promise<KanbanLiteTransport> {
  const mode = ctx.getNodeParameter('transport', 'api') as string

  if (mode === 'sdk') {
    const creds = await ctx.getCredentials('kanbanLiteSdk') as { workspaceRoot: string; boardDir?: string }
    let sdk: KanbanSdkLike

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('kanban-lite/sdk') as SdkModuleShape
      const KanbanSDKCtor = mod.KanbanSDK ?? mod.default?.KanbanSDK
      if (!KanbanSDKCtor) {
        throw new Error('KanbanSDK export not found')
      }
      const kanbanDir = creds.boardDir?.trim() || path.join(creds.workspaceRoot, '.kanban')
      sdk = new KanbanSDKCtor(kanbanDir)
    } catch (err) {
      const causeMessage = err instanceof Error && err.message ? ` (${err.message})` : ''
      throw new NodeOperationError(
        ctx.getNode(),
        'The kanban-lite package must be installed to use SDK transport mode. ' +
          'Run `npm install kanban-lite` in the n8n process directory or switch to Remote API transport.' +
          causeMessage,
      )
    }

    return new SdkTransport({ sdk, eventCapabilities: KANBAN_EVENT_CATALOG })
  }

  const creds = await ctx.getCredentials('kanbanLiteApi') as ApiTransportCredentials
  return new ApiTransport({ credentials: creds, eventCapabilities: KANBAN_EVENT_CATALOG })
}

async function buildApiTransport(ctx: IHookFunctions): Promise<ApiTransport> {
  const creds = await ctx.getCredentials('kanbanLiteApi') as ApiTransportCredentials
  return new ApiTransport({ credentials: creds, eventCapabilities: KANBAN_EVENT_CATALOG })
}

async function deleteRemoteRegistration(ctx: IHookFunctions): Promise<boolean> {
  const staticData = ctx.getWorkflowStaticData('node')
  const webhookId = typeof staticData[API_WEBHOOK_ID_KEY] === 'string'
    ? staticData[API_WEBHOOK_ID_KEY]
    : undefined

  if (!webhookId) {
    delete staticData[API_REGISTRATION_ID_KEY]
    delete staticData[API_EVENT_KEY]
    return false
  }

  try {
    const transport = await buildApiTransport(ctx)
    await transport.execute('webhook', 'delete', { id: webhookId })
  } catch (err) {
    if (!(err instanceof KanbanTransportError && err.statusCode === 404)) {
      throw err
    }
  }

  delete staticData[API_REGISTRATION_ID_KEY]
  delete staticData[API_WEBHOOK_ID_KEY]
  delete staticData[API_EVENT_KEY]
  return true
}

/**
 * Kanban Lite trigger node.
 *
 * Subscribes to kanban-lite events and emits an n8n execution whenever a
 * matching event fires. Supports two subscription modes determined by the
 * selected transport:
 *
 * - **Local SDK (sdkBefore / sdkAfter)**: registers directly on the
 *   `KanbanSDK.eventBus` instance so both before- and after-events are
 *   available in real time.
 *
 * - **Remote API (apiAfter)**: registers a webhook via the standalone server
 *   POST /api/webhooks endpoint and handles inbound HTTP delivery, making
 *   committed after-events available to remote n8n instances.
 *
 * Transport capability metadata (which events are available in which mode) is
 * consumed from the SDK-first catalog produced in task T1. Full subscription
 * lifecycle and event-capability UI text are implemented in task T5.
 *
 * NOTE: Event subscription logic is added in task T5. This stub ensures the
 * package layout, credential wiring, and metadata are valid for n8n
 * custom-node loading today.
 */
export class KanbanLiteTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Kanban Lite Trigger',
    name: 'kanbanLiteTrigger',
    icon: 'file:kanban-lite.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["event"]}}',
    description: 'Triggers a workflow when a Kanban Lite event fires (card created, moved, updated, deleted, and more)',
    defaults: {
      name: 'Kanban Lite Trigger',
    },
    inputs: [],
    outputs: ['main'],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        path: 'kanban-lite-trigger',
        responseMode: 'onReceived',
        responseData: 'noData',
      },
    ],
    credentials: [
      {
        name: 'kanbanLiteApi',
        required: false,
        displayOptions: {
          show: {
            transport: ['api'],
          },
        },
      },
      {
        name: 'kanbanLiteSdk',
        required: false,
        displayOptions: {
          show: {
            transport: ['sdk'],
          },
        },
      },
    ],
    properties: [
      {
        displayName: 'Transport',
        name: 'transport',
        type: 'options',
        options: [
          {
            name: 'Remote API',
            value: 'api',
            description: 'Receive committed after-events via webhook delivery from a running Kanban Lite standalone server',
          },
          {
            name: 'Local SDK',
            value: 'sdk',
            description: 'Subscribe directly to SDK bus events (before- and after-events). n8n must run on the same machine as the workspace.',
          },
        ],
        default: 'api',
        description: 'How this trigger node connects to Kanban Lite',
      },
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        options: EVENT_OPTIONS,
        default: KANBAN_EVENT_CATALOG[0]?.event ?? 'task.created',
        description:
          'The event that triggers this workflow. SDK-only entries are before-events and cannot be delivered via Remote API transport.',
      },
    ],
  }

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData('node')
        const eventName = this.getNodeParameter('event') as string
        const mode = this.getNodeParameter('transport', 'api') as string

        if (mode !== 'api') {
          return false
        }

        return (
          typeof staticData[API_WEBHOOK_ID_KEY] === 'string' &&
          staticData[API_EVENT_KEY] === eventName
        )
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const mode = this.getNodeParameter('transport', 'api') as string
        if (mode !== 'api') {
          await deleteRemoteRegistration(this)
          return false
        }

        const eventName = this.getNodeParameter('event') as string
        const callbackUrl = this.getNodeWebhookUrl('default')
        if (!callbackUrl) {
          throw new NodeOperationError(this.getNode(), 'Unable to resolve the n8n webhook URL for Kanban Lite Trigger.')
        }

        try {
          await deleteRemoteRegistration(this)

          const transport = await buildApiTransport(this)
          const registration = await transport.subscribe(eventName, () => undefined, { callbackUrl })
          const staticData = this.getWorkflowStaticData('node')
          staticData[API_REGISTRATION_ID_KEY] = registration.id
          if (registration.externalId) {
            staticData[API_WEBHOOK_ID_KEY] = registration.externalId
          }
          staticData[API_EVENT_KEY] = eventName
          return true
        } catch (err) {
          throw asNodeOperationError(this, err)
        }
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        try {
          return await deleteRemoteRegistration(this)
        } catch (err) {
          throw asNodeOperationError(this, err)
        }
      },
    },
  }

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse | undefined> {
    const eventName = this.getNodeParameter('event') as string

    let transport: KanbanLiteTransport
    try {
      transport = await buildTransport(this)
    } catch (err) {
      throw asNodeOperationError(this, err)
    }

    if (transport.mode === 'api') {
      if (!transport.canSubscribe(eventName)) {
        try {
          await transport.subscribe(eventName, () => undefined, { callbackUrl: 'https://n8n.invalid/activation-check' })
        } catch (err) {
          throw asNodeOperationError(this, err)
        }
      }
      return undefined
    }

    try {
      const registration = await transport.subscribe(eventName, (payload: unknown) => {
        this.emit([[{ json: normalizeTriggerItem(eventName, 'sdk', payload) }]])
      })

      return {
        closeFunction: async () => {
          await registration.dispose()
        },
      }
    } catch (err) {
      throw asNodeOperationError(this, err)
    }
  }

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const selectedEvent = this.getNodeParameter('event') as string
    const body = this.getBodyData() as Record<string, unknown>
    const headers = this.getHeaderData()
    const headerEvent = Array.isArray(headers['x-webhook-event'])
      ? headers['x-webhook-event'][0]
      : headers['x-webhook-event']
    const bodyEvent = typeof body.event === 'string' ? body.event : undefined
    const eventName = bodyEvent ?? headerEvent ?? selectedEvent

    if (eventName !== selectedEvent) {
      return {
        webhookResponse: {
          ok: true,
          ignored: true,
          reason: `Ignoring Kanban Lite event "${String(eventName)}" because this trigger is configured for "${selectedEvent}".`,
        },
      }
    }

    const payload = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body

    return {
      workflowData: [[{ json: normalizeTriggerItem(eventName, 'api', payload, body) }]],
      webhookResponse: {
        ok: true,
        event: eventName,
      },
    }
  }
}

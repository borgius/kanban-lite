import type {
  AttachmentStoragePlugin,
  AfterEventPayload,
  CardStoragePlugin,
  CloudflareWorkerProviderContext,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'
import {
  PROVIDER_ID,
  buildCallbackExecutionPlan,
  createCloudflareCallbackQueueMessageEnvelope,
  type CloudflareCallbackRuntimeContext,
  type CloudflareCallbackRuntimeQueueInput,
  type CloudflareCallbackQueueDisposition,
  type CloudflareCallbackQueueConsumer,
} from './types'
import {
  getUpdatedAt,
  isAfterEventPayload,
  isModuleCallbackHandler,
  logCloudflareCallbackError,
  requireCallbackQueue,
  readCloudflareCallbackHandlers,
  createCallbackEventRecord,
  insertCallbackEventRecord,
  readCallbackEventRecord,
  updateCallbackEventRecord,
  updateCallbackEventRecordSummary,
  persistCallbackEventRecordProgress,
  executeCallbackModuleHandler,
  createWorkerOnlyError,
  getDatabase,
  ensureSchema,
} from './helpers'
import {
  createFallbackCardStoragePlugin,
  createFallbackAttachmentStoragePlugin,
} from './engine'
export {
  createCardStoragePlugin,
  createAttachmentStoragePlugin,
  createCardStateProvider,
  createWorkerConfigRepositoryBridge,
  createConfigStorageProvider,
} from './engine'

export type {
  AttachmentStoragePlugin,
  AfterEventPayload,
  CallbackHandlerConfig,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateWriteInput,
  CardStoragePlugin,
  CloudflareWorkerProviderContext,
  ConfigStorageModuleContext,
  ConfigStorageProviderPlugin,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
  StorageEngine,
} from 'kanban-lite/sdk'

type CloudflareCallbackOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

const SDK_AFTER_EVENT_NAMES = [
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'column.created',
  'column.updated',
  'column.deleted',
  'attachment.added',
  'attachment.removed',
  'settings.updated',
  'board.created',
  'board.updated',
  'board.deleted',
  'board.action',
  'card.action.triggered',
  'board.log.added',
  'board.log.cleared',
  'log.added',
  'log.cleared',
  'storage.migrated',
  'form.submitted',
  'auth.allowed',
  'auth.denied',
] as const

function getAvailableCloudflareCallbackEvents(sdk?: KanbanSDK): string[] {
  const events = typeof sdk?.listAvailableEvents === 'function'
    ? sdk.listAvailableEvents({ type: 'after' })
        .filter((event) => event.phase === 'after')
        .map((event) => event.event)
    : [...SDK_AFTER_EVENT_NAMES]

  return [...new Set(events)].sort((left, right) => left.localeCompare(right))
}

function createCloudflareCallbackOptionsSchema(sdk?: KanbanSDK): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      title: 'Cloudflare callback runtime options',
      description: 'Configure ordered module handlers for durable Cloudflare Queue delivery. Cloudflare uses the shared callback.runtime handlers list but only executes Worker-safe module rows.',
      additionalProperties: false,
      properties: {
        handlers: {
          type: 'array',
          title: 'Handlers',
          description: 'Ordered module handlers evaluated for committed after-events. Cloudflare persists one durable event record plus one compact queue message per matched event.',
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'name', 'type', 'events', 'enabled', 'module', 'handler'],
            properties: {
              id: {
                type: 'string',
                title: 'ID',
                minLength: 1,
                description: 'Stable handler identifier used for durable event-plus-handler idempotency.',
              },
              name: {
                type: 'string',
                title: 'Name',
                minLength: 1,
                description: 'Short label used in logs and shared plugin settings surfaces.',
              },
              type: {
                type: 'string',
                title: 'Handler type',
                const: 'module',
                default: 'module',
                description: 'Cloudflare Workers execute module handlers only.',
              },
              events: {
                type: 'array',
                title: 'Events',
                description: 'Committed after-events that should enqueue this module handler. Wildcard masks such as task.* are supported.',
                minItems: 1,
                items: {
                  type: 'string',
                  enum: getAvailableCloudflareCallbackEvents(sdk),
                },
              },
              enabled: {
                type: 'boolean',
                title: 'Enabled',
                description: 'Disable this handler without deleting its saved configuration.',
                default: true,
              },
              module: {
                type: 'string',
                title: 'Module specifier',
                minLength: 1,
                description: 'Worker-bundled callback module specifier resolved through the shared KANBAN_MODULES registry.',
              },
              handler: {
                type: 'string',
                title: 'Named export',
                minLength: 1,
                description: 'Callable named export invoked from the configured module.',
              },
            },
          },
        },
      },
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Cloudflare callback handlers',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/handlers',
              label: 'Handlers',
              options: {
                elementLabelProp: 'name',
                showSortButtons: true,
                detail: {
                  type: 'VerticalLayout',
                  elements: [
                    {
                      type: 'Control',
                      scope: '#/properties/id',
                      label: 'ID',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/name',
                      label: 'Name',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/enabled',
                      label: 'Enabled',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/events',
                      label: 'Events',
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/module',
                      label: 'Module specifier',
                      options: {
                        placeholder: './callbacks/task-created.cjs',
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/handler',
                      label: 'Named export',
                      options: {
                        placeholder: 'onTaskCreated',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    secrets: [],
  }
}

class CloudflareCallbackListenerPlugin implements CloudflareCallbackQueueConsumer {
  readonly manifest = {
    id: 'kl-plugin-cloudflare',
    provides: ['event.listener'] as const,
  }

  readonly optionsSchema = createCloudflareCallbackOptionsSchema

  private _unsubscribe: (() => void) | null = null
  private _workspaceRoot: string
  private readonly _worker: CloudflareWorkerProviderContext | null
  private _sdk: KanbanSDK | null = null
  private _resolveModule: ((request: string) => unknown) | null = null

  constructor(context: { workspaceRoot: string; worker: CloudflareWorkerProviderContext | null }) {
    this._workspaceRoot = context.workspaceRoot
    this._worker = context.worker
  }

  attachRuntimeContext(context: CloudflareCallbackRuntimeContext): void {
    this._workspaceRoot = context.workspaceRoot
    this._sdk = context.sdk
    this._resolveModule = context.resolveModule ?? null
  }

  register(bus: EventBus): void {
    if (this._unsubscribe) return
    if (!this._workspaceRoot || !this._worker) {
      return
    }

    this._unsubscribe = bus.onAny((eventName, payload) => {
      if (!isAfterEventPayload(payload.data) || payload.data.event !== eventName) return

      void this.enqueueCommittedEvent(payload.data).catch((error) => {
        logCloudflareCallbackError(
          `failed to enqueue durable callback event for "${eventName}"`,
          error,
        )
      })
    })
  }

  unregister(): void {
    if (!this._unsubscribe) return
    this._unsubscribe()
    this._unsubscribe = null
  }

  async consumeQueuedCallbackEvent(
    input: CloudflareCallbackRuntimeQueueInput,
  ): Promise<CloudflareCallbackQueueDisposition> {
    if (!this._worker) {
      throw createWorkerOnlyError('callback.runtime')
    }
    if (!this._sdk) {
      throw new Error('kl-plugin-cloudflare: callback.runtime queue consumer requires an attached SDK runtime context.')
    }

    const database = getDatabase(this._worker, 'callback.runtime')
    await ensureSchema(database)

    const record = await readCallbackEventRecord(database, input.eventId)
    if (!record) {
      throw new Error(`kl-plugin-cloudflare: durable callback event record '${input.eventId}' is missing.`)
    }

    if (record.handlers.every((handler) => handler.status === 'completed')) {
      return 'ack'
    }

    const attemptTimestamp = getUpdatedAt()
    record.attempts += 1

    let shouldRetry = false
    let lastError: string | null = null

    for (const handler of record.handlers) {
      if (handler.status === 'completed') continue

      handler.attempts += 1
      handler.lastAttemptAt = attemptTimestamp

      try {
        await executeCallbackModuleHandler(
          record,
          handler,
          this._workspaceRoot,
          this._sdk,
          this._resolveModule ?? undefined,
        )
        handler.status = 'completed'
        handler.completedAt = attemptTimestamp
        handler.lastError = null
      } catch (error) {
        shouldRetry = true
        lastError = error instanceof Error ? error.message : String(error)
        handler.status = 'failed'
        handler.lastError = lastError
      }

      await persistCallbackEventRecordProgress(database, record, attemptTimestamp)
    }

    updateCallbackEventRecordSummary(record, attemptTimestamp)

    return shouldRetry ? 'retry' : 'ack'
  }

  private async enqueueCommittedEvent(event: AfterEventPayload<unknown>): Promise<void> {
    const handlers = buildCallbackExecutionPlan(
      readCloudflareCallbackHandlers(this._workspaceRoot),
      event.event,
    ).filter(isModuleCallbackHandler)

    if (handlers.length === 0) return

    const database = getDatabase(this._worker, 'callback.runtime')
    await ensureSchema(database)

    const record = createCallbackEventRecord(event, handlers)
    const inserted = await insertCallbackEventRecord(database, record)
    if (!inserted) return

    await requireCallbackQueue(this._worker).send(
      createCloudflareCallbackQueueMessageEnvelope(record.eventId),
    )
  }
}

export function createCallbackListenerPlugin(
  context: { workspaceRoot: string; worker: CloudflareWorkerProviderContext | null },
): CloudflareCallbackQueueConsumer {
  return new CloudflareCallbackListenerPlugin(context)
}

export const callbackListenerPlugin: SDKEventListenerPlugin & {
  optionsSchema: CloudflareCallbackOptionsSchemaFactory
} = {
  manifest: {
    id: 'kl-plugin-cloudflare',
    provides: ['event.listener'],
  },
  optionsSchema: createCloudflareCallbackOptionsSchema,
  register(): void {
    // Shared discovery/schema export only. Runtime loading uses createCallbackListenerPlugin(context).
  },
  unregister(): void {
    // No-op for the discovery export.
  },
}

export const optionsSchemas: Record<string, CloudflareCallbackOptionsSchemaFactory> = {
  [PROVIDER_ID]: createCloudflareCallbackOptionsSchema,
  'kl-plugin-cloudflare': createCloudflareCallbackOptionsSchema,
}

export const cardStoragePlugin = createFallbackCardStoragePlugin()

export const attachmentStoragePlugin = createFallbackAttachmentStoragePlugin()

export const pluginManifest = {
  id: 'kl-plugin-cloudflare',
  capabilities: {
    'card.storage': [PROVIDER_ID] as const,
    'attachment.storage': [PROVIDER_ID] as const,
    'card.state': [PROVIDER_ID] as const,
    'config.storage': [PROVIDER_ID] as const,
    'callback.runtime': [PROVIDER_ID] as const,
  },
  integrations: ['event.listener'] as const,
} as const

const cloudflarePluginPackage = {
  pluginManifest,
  callbackListenerPlugin,
  optionsSchemas,
}

export default cloudflarePluginPackage

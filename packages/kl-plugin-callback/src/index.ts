import * as childProcess from 'node:child_process'
import * as path from 'node:path'
import {
  assertCallableCallbackModuleExport,
  buildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput,
  CALLBACK_HANDLER_TYPES,
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
  normalizeCallbackHandlers,
  readConfig,
  resolveCallbackModuleTarget,
  resolveCallbackRuntimeModule,
} from 'kanban-lite/sdk'
import type {
  AfterEventPayload,
  CallbackHandlerConfig,
  DurableCallbackDispatchMetadata,
  DurableCallbackHandlerClaims,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

export type {
  CallbackHandlerConfig,
  CallbackHandlerType,
  CallbackPluginOptions,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

export interface CallbackProcessEnvelope {
  readonly event: AfterEventPayload<unknown>
  readonly callback: DurableCallbackHandlerClaims
}

export interface CallbackRuntimeContext {
  readonly workspaceRoot: string
  readonly sdk: KanbanSDK
}

interface CallbackHandlerExecutableInput {
  readonly event: AfterEventPayload<unknown>
  readonly sdk: KanbanSDK
  readonly callback: DurableCallbackHandlerClaims
}

type CallbackHandlerExecutable = (input: CallbackHandlerExecutableInput) => unknown

type CallbackPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

const CALLBACK_PROVIDER_ID = 'callbacks'
const CALLBACK_PACKAGE_ID = 'kl-plugin-callback'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAfterEventPayload(value: unknown): value is AfterEventPayload<unknown> {
  return isRecord(value)
    && isNonEmptyString(value.event)
    && 'data' in value
    && isNonEmptyString(value.timestamp)
}

function logCallbackFailure(handlerName: string, eventName: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    `[kl-plugin-callback] handler "${handlerName}" failed for event "${eventName}"`,
    message,
  )
}

function buildCallbackHandlerClaims(
  dispatch: DurableCallbackDispatchMetadata,
  handler: CallbackHandlerConfig,
): DurableCallbackHandlerClaims {
  return createDurableCallbackHandlerClaims(
    dispatch,
    handler.id,
    createDurableCallbackHandlerRevision(buildCallbackHandlerRevisionInput(handler)),
  )
}

function resolveDurableCallbackDispatchMetadata(
  event: AfterEventPayload<unknown>,
): DurableCallbackDispatchMetadata {
  return getDurableCallbackDispatchMetadata(event.meta) ?? createDurableCallbackDispatchMetadata()
}

function readCallbackHandlers(workspaceRoot: string): CallbackHandlerConfig[] {
  try {
    const config = readConfig(workspaceRoot)
    const callbackRuntime = config.plugins?.['callback.runtime']
    const options = isRecord(callbackRuntime?.options) ? callbackRuntime.options : null
    return normalizeCallbackHandlers(options?.handlers, {
      onError(message) {
        console.error(`[kl-plugin-callback] ${message}`)
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      '[kl-plugin-callback] failed to load callback handlers from shared config repository',
      message,
    )
    return []
  }
}

function resolveHandlerCwd(workspaceRoot: string, cwd?: string): string {
  if (!cwd) return workspaceRoot
  return path.isAbsolute(cwd) ? cwd : path.resolve(workspaceRoot, cwd)
}

function compileInlineHandler(
  source: string,
): CallbackHandlerExecutable {
  const compiled = new Function(`return (${source})`)() as unknown
  if (typeof compiled !== 'function') {
    throw new Error('Inline handler source must evaluate to a function.')
  }
  return compiled as CallbackHandlerExecutable
}

async function executeInlineHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  sdk: KanbanSDK | null,
  callback: DurableCallbackHandlerClaims,
): Promise<void> {
  if (!isNonEmptyString(handler.source)) {
    throw new Error('Inline handlers require a non-empty source string.')
  }
  if (!sdk) {
    throw new Error('Inline handlers require an attached SDK runtime context.')
  }

  const executable = compileInlineHandler(handler.source)
  await executable({ event, sdk, callback })
}

async function executeModuleHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  workspaceRoot: string,
  sdk: KanbanSDK | null,
  callback: DurableCallbackHandlerClaims,
): Promise<void> {
  const moduleSpecifier = handler.module ?? ''
  const exportName = handler.handler?.trim() ?? ''

  if (!exportName) {
    throw new Error('Module handlers require a non-empty named export.')
  }
  if (!sdk) {
    throw new Error('Module handlers require an attached SDK runtime context.')
  }

  const moduleTarget = resolveCallbackModuleTarget(moduleSpecifier, { workspaceRoot })

  let loadedModule: unknown
  try {
    loadedModule = resolveCallbackRuntimeModule(moduleTarget.runtimeSpecifier)
  } catch (error) {
    if (moduleTarget.runtimeSpecifier !== moduleTarget.configuredSpecifier) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Configured callback.runtime module '${moduleTarget.configuredSpecifier}' could not be loaded from '${moduleTarget.runtimeSpecifier}'. ${message}`,
      )
    }
    throw error
  }

  const executable = assertCallableCallbackModuleExport<CallbackHandlerExecutable>(
    loadedModule,
    moduleTarget.configuredSpecifier,
    exportName,
    { allowBareFunctionDefault: true },
  )
  await executable({ event, sdk, callback })
}

async function executeProcessHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  workspaceRoot: string,
  callback: DurableCallbackHandlerClaims,
): Promise<void> {
  const command = handler.command
  if (!isNonEmptyString(command)) {
    throw new Error('Process handlers require a non-empty command.')
  }

  const envelope: CallbackProcessEnvelope = { event, callback }
  const payload = JSON.stringify(envelope)

  await new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(command, [...(handler.args ?? [])], {
      cwd: resolveHandlerCwd(workspaceRoot, handler.cwd),
      shell: false,
      stdio: 'pipe',
    })

    let settled = false
    let stderr = ''

    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    child.stdout?.resume()
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', (error: Error) => {
      settle(error)
    })
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        settle()
        return
      }

      const detail = stderr.trim()
      settle(new Error(
        detail || `Process handler exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`,
      ))
    })

    if (!child.stdin) {
      settle(new Error('Process handler did not expose stdin.'))
      return
    }

    child.stdin.once('error', (error: Error) => {
      settle(error)
    })
    child.stdin.end(payload)
  })
}

async function runMatchingHandlers(input: {
  workspaceRoot: string
  sdk: KanbanSDK | null
  event: AfterEventPayload<unknown>
}): Promise<void> {
  const dispatch = resolveDurableCallbackDispatchMetadata(input.event)
  const handlers = buildCallbackExecutionPlan(
    readCallbackHandlers(input.workspaceRoot),
    input.event.event,
  )

  for (const handler of handlers) {
    const callback = buildCallbackHandlerClaims(dispatch, handler)

    try {
      if (handler.type === 'module') {
        await executeModuleHandler(handler, input.event, input.workspaceRoot, input.sdk, callback)
      } else if (handler.type === 'inline') {
        await executeInlineHandler(handler, input.event, input.sdk, callback)
      } else {
        await executeProcessHandler(handler, input.event, input.workspaceRoot, callback)
      }
    } catch (error) {
      logCallbackFailure(handler.name, input.event.event, error)
    }
  }
}

async function getAvailableCallbackEvents(sdk?: KanbanSDK): Promise<string[]> {
  const configuredEvents = getAvailableCallbackEventNames(sdk)
  const names = configuredEvents && configuredEvents.length > 0
    ? configuredEvents
    : [...SDK_AFTER_EVENT_NAMES]
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

function getAvailableCallbackEventNames(sdk?: KanbanSDK): string[] {
  const events = typeof sdk?.listAvailableEvents === 'function'
    ? sdk.listAvailableEvents({ type: 'after' })
    : undefined

  return events
    ?.filter((event) => event.phase === 'after')
    .map((event) => event.event)
    ?? []
}

function createCallbackOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      title: 'Callback runtime options',
      description: 'Configure ordered callback handlers for committed Kanban after-events. Module handlers are the shared Worker-safe Node/Cloudflare contract; inline JavaScript and process handlers remain legacy Node-focused modes inside the same handlers list.',
      additionalProperties: false,
      properties: {
        handlers: {
          type: 'array',
          title: 'Handlers',
          description: 'Ordered handlers evaluated against each committed after-event. Matching handlers continue in order even when an earlier handler fails.',
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'name', 'type', 'events', 'enabled'],
            properties: {
              id: {
                type: 'string',
                title: 'ID',
                minLength: 1,
                description: 'Stable handler identifier used for durable event-plus-handler claims. Keep this unchanged after creation so later retries remain deterministic.',
              },
              name: {
                type: 'string',
                title: 'Name',
                minLength: 1,
                description: 'Short label used to recognize this handler in shared settings surfaces and logs.',
              },
              type: {
                type: 'string',
                title: 'Handler type',
                enum: [...CALLBACK_HANDLER_TYPES],
                default: 'module',
                description: 'Choose module for the shared cross-host callback contract, inline for trusted same-runtime Node JavaScript, or process for Node subprocess execution fed by stdin JSON only.',
              },
              events: {
                type: 'array',
                title: 'Events',
                description: 'Committed after-events that should trigger this handler. Runtime matching also accepts wildcard masks such as task.* or *.',
                minItems: 1,
                items: {
                  type: 'string',
                  enum: getAvailableCallbackEvents,
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
                description: 'Worker-safe shared callback module specifier. Node callbacks and Cloudflare deploy/runtime resolve the same saved module path instead of using host-specific callback dialects.',
              },
              handler: {
                type: 'string',
                title: 'Named export',
                minLength: 1,
                description: 'Named export invoked from the configured module when type is module.',
              },
              source: {
                type: 'string',
                title: 'Inline JavaScript',
                minLength: 1,
                description: 'Trusted same-runtime JavaScript used for legacy Node inline handlers. The runtime invokes it with exactly one argument shaped as ({ event, sdk, callback }).',
              },
              command: {
                type: 'string',
                title: 'Command',
                minLength: 1,
                description: 'Executable launched for legacy Node process handlers. The runtime writes one serialized JSON payload containing both event data and durable callback claims to stdin only.',
              },
              args: {
                type: 'array',
                title: 'Arguments',
                description: 'Optional argv entries passed to the subprocess after the command.',
                default: [],
                items: {
                  type: 'string',
                  title: 'Argument',
                  minLength: 1,
                },
              },
              cwd: {
                type: 'string',
                title: 'Working directory',
                minLength: 1,
                description: 'Optional working directory for process handlers. Relative paths resolve from the workspace root.',
              },
            },
            allOf: [
              {
                if: {
                  properties: {
                    type: { const: 'module' },
                  },
                },
                then: {
                  required: ['module', 'handler'],
                },
              },
              {
                if: {
                  properties: {
                    type: { const: 'inline' },
                  },
                },
                then: {
                  required: ['source'],
                },
              },
              {
                if: {
                  properties: {
                    type: { const: 'process' },
                  },
                },
                then: {
                  required: ['command'],
                },
              },
            ],
          },
        },
      },
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Callback handlers',
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
                      options: {
                        placeholder: 'task-created-inline',
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/name',
                      label: 'Name',
                      options: {
                        placeholder: 'on-task-created',
                      },
                    },
                    {
                      type: 'HorizontalLayout',
                      elements: [
                        {
                          type: 'Control',
                          scope: '#/properties/type',
                          label: 'Handler type',
                        },
                        {
                          type: 'Control',
                          scope: '#/properties/enabled',
                          label: 'Enabled',
                        },
                      ],
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
                        placeholder: './callbacks/task-created',
                      },
                      rule: {
                        effect: 'SHOW',
                        condition: {
                          scope: '#/properties/type',
                          schema: { const: 'module' },
                        },
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/handler',
                      label: 'Named export',
                      options: {
                        placeholder: 'onTaskCreated',
                      },
                      rule: {
                        effect: 'SHOW',
                        condition: {
                          scope: '#/properties/type',
                          schema: { const: 'module' },
                        },
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/source',
                      label: 'Inline JavaScript',
                      options: {
                        editor: 'code',
                        language: 'javascript',
                        height: '220px',
                        placeholder: 'async ({ event, sdk, callback }) => {\n  console.log(callback.handlerId, event.event)\n}',
                      },
                      rule: {
                        effect: 'SHOW',
                        condition: {
                          scope: '#/properties/type',
                          schema: { const: 'inline' },
                        },
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/command',
                      label: 'Command',
                      options: {
                        placeholder: 'node',
                      },
                      rule: {
                        effect: 'SHOW',
                        condition: {
                          scope: '#/properties/type',
                          schema: { const: 'process' },
                        },
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/args',
                      label: 'Arguments',
                      rule: {
                        effect: 'SHOW',
                        condition: {
                          scope: '#/properties/type',
                          schema: { const: 'process' },
                        },
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/cwd',
                      label: 'Working directory',
                      options: {
                        placeholder: '.kanban/scripts',
                      },
                      rule: {
                        effect: 'SHOW',
                        condition: {
                          scope: '#/properties/type',
                          schema: { const: 'process' },
                        },
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

export class CallbackListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest = {
    id: CALLBACK_PACKAGE_ID,
    provides: ['event.listener'] as const,
  }

  readonly optionsSchema = createCallbackOptionsSchema

  private _unsubscribe: (() => void) | null = null
  private _workspaceRoot: string | null
  private _sdk: KanbanSDK | null = null

  constructor(workspaceRoot?: string) {
    this._workspaceRoot = workspaceRoot ?? null
  }

  attachRuntimeContext(context: CallbackRuntimeContext): void {
    this._workspaceRoot = context.workspaceRoot
    this._sdk = context.sdk
  }

  register(bus: EventBus): void {
    if (this._unsubscribe) return
    if (!this._workspaceRoot) {
      console.error('[kl-plugin-callback] callback runtime listener is missing a workspace root.')
      return
    }

    const availableAfterEvents = new Set(getAvailableCallbackEventNames(this._sdk ?? undefined))

    this._unsubscribe = bus.onAny((eventName, payload) => {
      if (availableAfterEvents.size > 0 && !availableAfterEvents.has(eventName)) return
      if (!isAfterEventPayload(payload.data) || payload.data.event !== eventName) return

      void runMatchingHandlers({
        workspaceRoot: this._workspaceRoot as string,
        sdk: this._sdk,
        event: payload.data,
      })
    })
  }

  unregister(): void {
    if (!this._unsubscribe) return
    this._unsubscribe()
    this._unsubscribe = null
  }
}

export const callbackListenerPlugin: SDKEventListenerPlugin & {
  optionsSchema: CallbackPluginOptionsSchemaFactory
} = {
  manifest: {
    id: CALLBACK_PACKAGE_ID,
    provides: ['event.listener'],
  },
  optionsSchema: createCallbackOptionsSchema,
  register(): void {
    // Discovery/schema surfaces use this lightweight export. Runtime loading
    // prefers `CallbackListenerPlugin` so each SDK gets its own listener instance.
  },
  unregister(): void {
    // No-op for the schema/discovery export.
  },
}

/** Standard package manifest for plugin discovery and capability inventory. */
export const pluginManifest = {
  id: CALLBACK_PACKAGE_ID,
  capabilities: {
    'callback.runtime': [CALLBACK_PROVIDER_ID] as const,
  },
  integrations: ['event.listener'] as const,
} as const

/** Options schemas keyed by provider id for shared plugin-settings discovery. */
export const optionsSchemas: Record<string, CallbackPluginOptionsSchemaFactory> = {
  [CALLBACK_PROVIDER_ID]: createCallbackOptionsSchema,
  [CALLBACK_PACKAGE_ID]: createCallbackOptionsSchema,
}

const callbackPluginPackage = {
  pluginManifest,
  callbackListenerPlugin,
  optionsSchemas,
}

export default callbackPluginPackage

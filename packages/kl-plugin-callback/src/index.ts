import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  AfterEventPayload,
  EventBus,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

export type {
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from 'kanban-lite/sdk'

export type CallbackHandlerType = 'inline' | 'process'

export interface CallbackHandlerConfig {
  /** Human-friendly row label shown in shared plugin settings surfaces. */
  readonly name: string
  /** Whether the handler runs inline or as a subprocess. */
  readonly type: CallbackHandlerType
  /** One or more committed after-events that should trigger this handler. */
  readonly events: readonly string[]
  /** Disable a handler without removing its configuration. */
  readonly enabled: boolean
  /** Inline JavaScript source used when `type === "inline"`. */
  readonly source?: string
  /** Executable launched when `type === "process"`. */
  readonly command?: string
  /** Optional argv passed to the subprocess. */
  readonly args?: readonly string[]
  /** Optional working directory for subprocess execution. */
  readonly cwd?: string
}

export interface CallbackPluginOptions {
  readonly handlers?: readonly CallbackHandlerConfig[]
}

export interface CallbackProcessEnvelope {
  readonly event: AfterEventPayload<unknown>
}

export interface CallbackRuntimeContext {
  readonly workspaceRoot: string
  readonly sdk: KanbanSDK
}

interface PersistedCallbackPluginConfig {
  readonly provider?: string
  readonly options?: CallbackPluginOptions
}

interface PersistedCallbackPlugins {
  readonly 'callback.runtime'?: PersistedCallbackPluginConfig
}

interface PersistedCallbackConfig {
  readonly plugins?: PersistedCallbackPlugins
}

type CallbackPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

const CALLBACK_PROVIDER_ID = 'callbacks'
const CALLBACK_PACKAGE_ID = 'kl-plugin-callback'
const CALLBACK_HANDLER_TYPES = ['inline', 'process'] as const
const CONFIG_FILENAME = '.kanban.json'

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

function isCallbackHandlerType(value: unknown): value is CallbackHandlerType {
  return value === 'inline' || value === 'process'
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

function parseCallbackConfig(workspaceRoot: string): PersistedCallbackConfig {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceRoot, CONFIG_FILENAME), 'utf-8')) as PersistedCallbackConfig
  } catch {
    return {}
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => isNonEmptyString(entry)).map((entry) => entry.trim())
}

function normalizeCallbackHandler(raw: unknown, index: number): CallbackHandlerConfig | null {
  if (!isRecord(raw)) {
    console.error(`[kl-plugin-callback] ignoring invalid handler at index ${index}`)
    return null
  }

  const name = isNonEmptyString(raw.name) ? raw.name.trim() : ''
  const type = raw.type
  const events = normalizeStringArray(raw.events)
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true
  if (!name || !isCallbackHandlerType(type) || events.length === 0) {
    console.error(`[kl-plugin-callback] ignoring invalid handler at index ${index}`)
    return null
  }

  const normalized: CallbackHandlerConfig = {
    name,
    type,
    events,
    enabled,
    ...(isNonEmptyString(raw.source) ? { source: raw.source } : {}),
    ...(isNonEmptyString(raw.command) ? { command: raw.command } : {}),
    ...(Array.isArray(raw.args) ? { args: normalizeStringArray(raw.args) } : {}),
    ...(isNonEmptyString(raw.cwd) ? { cwd: raw.cwd } : {}),
  }

  return normalized
}

function readCallbackHandlers(workspaceRoot: string): CallbackHandlerConfig[] {
  const pluginConfig = parseCallbackConfig(workspaceRoot).plugins?.['callback.runtime']
  const handlers = pluginConfig?.options?.handlers
  if (!Array.isArray(handlers)) return []

  return handlers
    .map((handler, index) => normalizeCallbackHandler(handler, index))
    .filter((handler): handler is CallbackHandlerConfig => handler !== null)
}

function matchesEventPattern(pattern: string, eventName: string): boolean {
  const candidate = pattern.trim()
  if (!candidate) return false
  if (candidate === '*' || candidate === '**') return true

  const patternSegments = candidate.split('.')
  const eventSegments = eventName.split('.')

  const matchSegments = (patternIndex: number, eventIndex: number): boolean => {
    while (patternIndex < patternSegments.length) {
      const segment = patternSegments[patternIndex]
      if (segment === '**') {
        if (patternIndex === patternSegments.length - 1) return true
        for (let nextEventIndex = eventIndex; nextEventIndex <= eventSegments.length; nextEventIndex += 1) {
          if (matchSegments(patternIndex + 1, nextEventIndex)) return true
        }
        return false
      }

      if (eventIndex >= eventSegments.length) return false
      if (segment !== '*' && segment !== eventSegments[eventIndex]) return false
      patternIndex += 1
      eventIndex += 1
    }

    return eventIndex === eventSegments.length
  }

  return matchSegments(0, 0)
}

function matchesHandlerEvent(handler: CallbackHandlerConfig, eventName: string): boolean {
  return handler.enabled && handler.events.some((pattern) => matchesEventPattern(pattern, eventName))
}

function resolveHandlerCwd(workspaceRoot: string, cwd?: string): string {
  if (!cwd) return workspaceRoot
  return path.isAbsolute(cwd) ? cwd : path.resolve(workspaceRoot, cwd)
}

function compileInlineHandler(source: string): (input: { event: AfterEventPayload<unknown>; sdk: KanbanSDK }) => unknown {
  const compiled = new Function(`return (${source})`)() as unknown
  if (typeof compiled !== 'function') {
    throw new Error('Inline handler source must evaluate to a function.')
  }
  return compiled as (input: { event: AfterEventPayload<unknown>; sdk: KanbanSDK }) => unknown
}

async function executeInlineHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  sdk: KanbanSDK | null,
): Promise<void> {
  if (!isNonEmptyString(handler.source)) {
    throw new Error('Inline handlers require a non-empty source string.')
  }
  if (!sdk) {
    throw new Error('Inline handlers require an attached SDK runtime context.')
  }

  const executable = compileInlineHandler(handler.source)
  await executable({ event, sdk })
}

async function executeProcessHandler(
  handler: CallbackHandlerConfig,
  event: AfterEventPayload<unknown>,
  workspaceRoot: string,
): Promise<void> {
  const command = handler.command
  if (!isNonEmptyString(command)) {
    throw new Error('Process handlers require a non-empty command.')
  }

  const envelope: CallbackProcessEnvelope = { event }
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
  const handlers = readCallbackHandlers(input.workspaceRoot)
    .filter((handler) => matchesHandlerEvent(handler, input.event.event))

  for (const handler of handlers) {
    try {
      if (handler.type === 'inline') {
        await executeInlineHandler(handler, input.event, input.sdk)
      } else {
        await executeProcessHandler(handler, input.event, input.workspaceRoot)
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
      description: 'Configure ordered callback handlers for committed Kanban after-events. Inline JavaScript authoring uses the shared CodeMirror-backed editor inside plugin settings instead of a separate callback-specific surface.',
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
            required: ['name', 'type', 'events', 'enabled'],
            properties: {
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
                default: 'inline',
                description: 'Choose inline for trusted same-runtime JavaScript or process for subprocess execution fed by stdin JSON only.',
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
              source: {
                type: 'string',
                title: 'Inline JavaScript',
                minLength: 1,
                description: 'Trusted same-runtime JavaScript used for inline handlers. The runtime invokes it with exactly one argument shaped as ({ event, sdk }).',
              },
              command: {
                type: 'string',
                title: 'Command',
                minLength: 1,
                description: 'Executable launched for process handlers. The runtime writes one serialized JSON payload to stdin only.',
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
                      scope: '#/properties/source',
                      label: 'Inline JavaScript',
                      options: {
                        editor: 'code',
                        language: 'javascript',
                        height: '220px',
                        placeholder: 'async ({ event, sdk }) => {\n  console.log(event.event)\n}',
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

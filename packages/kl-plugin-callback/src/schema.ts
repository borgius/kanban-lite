import type { KanbanSDK, PluginSettingsOptionsSchemaMetadata } from 'kanban-lite/sdk'
import type { CallbackHandlerType } from './handlers'

const CALLBACK_HANDLER_TYPES = ['module', 'inline', 'process'] as const

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


export async function getAvailableCallbackEvents(sdk?: KanbanSDK): Promise<string[]> {
  const configuredEvents = getAvailableCallbackEventNames(sdk)
  const names = configuredEvents && configuredEvents.length > 0
    ? configuredEvents
    : [...SDK_AFTER_EVENT_NAMES]
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

export function getAvailableCallbackEventNames(sdk?: KanbanSDK): string[] {
  const events = typeof sdk?.listAvailableEvents === 'function'
    ? sdk.listAvailableEvents({ type: 'after' })
    : undefined

  return events
    ?.filter((event) => event.phase === 'after')
    .map((event) => event.event)
    ?? []
}

export function createCallbackOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
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
              id: {
                type: 'string',
                title: 'ID',
                minLength: 1,
                description: 'Optional stable identifier used as handlerId in module handler callbacks for idempotency tracking.',
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
              },              module: {
                type: 'string',
                title: 'Module specifier',
                minLength: 1,
                description: 'Worker-safe shared callback module specifier. Node and Cloudflare runtimes resolve the same saved module path.',
              },
              handler: {
                type: 'string',
                title: 'Named export',
                minLength: 1,
                description: 'Named export invoked from the configured module when type is module.',
              },              source: {
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
                    type: { const: 'module' },
                  },
                },
                then: {
                  required: ['module'],
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
                      scope: '#/properties/id',
                      label: 'ID',
                      options: {
                        placeholder: 'my-handler-id',
                      },
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
                      scope: '#/properties/module',
                      label: 'Module path',
                      options: {
                        placeholder: './handlers/on-task-created.cjs',
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
                      label: 'Handler export',
                      options: {
                        placeholder: 'default',
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

import { CronExpressionParser } from 'cron-parser'
import type {
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
} from 'kanban-lite/sdk'
import type { CronRuntimeEventConfig } from './runtime'
import { resolveCronExpression } from './runtime'

interface CronPluginOptions {
  readonly events?: readonly CronRuntimeEventConfig[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export type CronPluginOptionsSchemaFactory = (sdk?: KanbanSDK) => PluginSettingsOptionsSchemaMetadata

export function validateCronPluginOptions(options: Record<string, unknown>): void {
  const events = Array.isArray(options.events) ? options.events : []
  const seenNames = new Set<string>()

  for (const [index, rawEvent] of events.entries()) {
    if (!isRecord(rawEvent)) {
      throw new Error(`Cron events[${index}] must be an object.`)
    }

    const name = isNonEmptyString(rawEvent.name) ? rawEvent.name.trim() : ''
    const eventName = isNonEmptyString(rawEvent.event) ? rawEvent.event.trim() : ''
    const cron = isNonEmptyString(rawEvent.cron) ? rawEvent.cron.trim() : undefined
    const schedule = isNonEmptyString(rawEvent.schedule) ? rawEvent.schedule.trim() : undefined
    const expression = resolveCronExpression({ cron, schedule })

    if (!name) throw new Error(`Cron events[${index}] must include a non-empty name.`)
    if (!eventName) throw new Error(`Cron event "${name}" must include a non-empty event name.`)
    if (!expression) throw new Error(`Cron event "${name}" must include a cron or schedule value.`)
    if (seenNames.has(name)) throw new Error(`Cron event names must be unique. Duplicate: "${name}".`)

    try {
      CronExpressionParser.parse(expression)
    } catch (error) {
      throw new Error(
        `Invalid cron expression for "${name}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    seenNames.add(name)
  }
}

export function createCronOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      title: 'Cron runtime options',
      description: 'Configure named cron schedules that emit existing after-style SDK events through the shared plugin settings workflow.',
      additionalProperties: false,
      properties: {
        events: {
          type: 'array',
          title: 'Cron events',
          description: 'Ordered cron schedules that emit the configured event name when they fire.',
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'event'],
            properties: {
              name: {
                type: 'string',
                title: 'Name',
                minLength: 1,
                description: 'Short label used in shared plugin settings and event discovery surfaces.',
              },
              schedule: {
                type: 'string',
                title: 'Schedule',
                minLength: 1,
                description: 'Cron expression to evaluate. Prefer this field for new configuration.',
              },
              cron: {
                type: 'string',
                title: 'Cron alias',
                minLength: 1,
                description: 'Backward-compatible alias for the schedule field. When both are present, cron takes precedence.',
              },
              event: {
                type: 'string',
                title: 'Event name',
                minLength: 1,
                description: 'Event name emitted on the shared SDK event bus when this cron schedule fires.',
              },
            },
            anyOf: [
              { required: ['schedule'] },
              { required: ['cron'] },
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
          label: 'Cron events',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/events',
              label: 'Events',
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
                        placeholder: 'Nightly cleanup',
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/schedule',
                      label: 'Schedule',
                      options: {
                        placeholder: '0 0 * * *',
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/cron',
                      label: 'Cron alias',
                      options: {
                        placeholder: '0 */15 * * * *',
                      },
                    },
                    {
                      type: 'Control',
                      scope: '#/properties/event',
                      label: 'Event name',
                      options: {
                        placeholder: 'schedule.nightly',
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
    beforeSave(options: Record<string, unknown>): void {
      validateCronPluginOptions(options)
    },
  }
}

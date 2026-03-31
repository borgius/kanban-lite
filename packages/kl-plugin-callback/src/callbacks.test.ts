import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventBus } from 'kanban-lite/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallbackListenerPlugin, callbackListenerPlugin, optionsSchemas, pluginManifest } from './index'

interface SchemaNode {
  type?: string
  default?: unknown
  enum?: string[] | ((sdk?: unknown) => Promise<string[]> | string[])
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
}

interface UiSchemaNode {
  scope?: string
  options?: {
    multi?: boolean
    showSortButtons?: boolean
    elementLabelProp?: string
    detail?: {
      elements?: UiSchemaNode[]
    }
  }
  rule?: {
    effect: string
    condition: {
      scope: string
      schema: { const: string }
    }
  }
  elements?: UiSchemaNode[]
}

interface CallbackRuntimeTestGlobal {
  __callbackRuntimeTest?: {
    pushRecord(record: Record<string, unknown>): void
    appendOrder(label: string): void
  }
}

const runtimeGlobal = globalThis as typeof globalThis & CallbackRuntimeTestGlobal

afterEach(() => {
  delete runtimeGlobal.__callbackRuntimeTest
})

describe('callback plugin manifest', () => {
  it('advertises the callbacks provider for callback.runtime', () => {
    expect(pluginManifest.id).toBe('kl-plugin-callback')
    expect(pluginManifest.capabilities['callback.runtime']).toEqual(['callbacks'])
    expect(pluginManifest.integrations).toContain('event.listener')
  })

  it('exports a listener-only runtime plugin manifest', () => {
    expect(callbackListenerPlugin.manifest.id).toBe('kl-plugin-callback')
    expect(callbackListenerPlugin.manifest.provides).toContain('event.listener')
  })
})

describe('callback options schema', () => {
  it('models mixed inline and process handlers in a single ordered handlers array', () => {
    const metadata = optionsSchemas.callbacks()
    const handlers = (metadata.schema.properties as Record<string, SchemaNode>).handlers
    const itemProperties = (handlers.items?.properties ?? {}) as Record<string, SchemaNode>

    expect(metadata.secrets).toEqual([])
    expect(handlers.type).toBe('array')
    expect(handlers.default).toEqual([])
    expect(itemProperties.type.enum).toEqual(['inline', 'process'])
    expect(itemProperties.events.type).toBe('array')
    expect(itemProperties.source.type).toBe('string')
    expect(itemProperties.command.type).toBe('string')
    expect(itemProperties.args.type).toBe('array')
  })

  it('uses explicit uiSchema rules and multiline inline source authoring hints', () => {
    const metadata = optionsSchemas.callbacks()
    const handlersControl = ((metadata.uiSchema as UiSchemaNode).elements ?? [])[0]?.elements?.[0]
    const detailElements = handlersControl?.options?.detail?.elements ?? []
    const sourceControl = detailElements.find((element) => element.scope === '#/properties/source')
    const commandControl = detailElements.find((element) => element.scope === '#/properties/command')

    expect(handlersControl?.options?.showSortButtons).toBe(true)
    expect(handlersControl?.options?.elementLabelProp).toBe('name')
    expect(sourceControl?.options?.multi).toBe(true)
    expect(sourceControl?.rule).toEqual({
      effect: 'SHOW',
      condition: {
        scope: '#/properties/type',
        schema: { const: 'inline' },
      },
    })
    expect(commandControl?.rule).toEqual({
      effect: 'SHOW',
      condition: {
        scope: '#/properties/type',
        schema: { const: 'process' },
      },
    })
  })
})

describe('callback runtime execution', () => {
  it('runs discovered after-events that are not in the package fallback allowlist', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-'))

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  name: 'discovered-event-inline',
                  type: 'inline',
                  events: ['workflow.completed'],
                  enabled: true,
                  source: 'function ({ event }) { globalThis.__callbackRuntimeTest.pushRecord({ eventName: event.event, itemId: event.data.id }) }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    const inlineRecords: Array<Record<string, unknown>> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        inlineRecords.push(record)
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const metadata = optionsSchemas.callbacks()
    const handlers = (metadata.schema.properties as Record<string, SchemaNode>).handlers
    const availableEvents = await (handlers.items?.properties?.events?.items?.enum as (sdk?: unknown) => Promise<string[]>)(
      {
        listAvailableEvents: () => [
          {
            event: 'workflow.completed',
            phase: 'after',
            source: 'plugin',
            sdkBefore: false,
            sdkAfter: true,
            apiAfter: false,
            pluginIds: ['plugin-discovery-test'],
          },
        ],
      },
    )

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: {
        marker: 'sdk-from-test',
        listAvailableEvents: () => availableEvents.map((event) => ({
          event,
          phase: 'after',
          source: 'plugin',
          sdkBefore: false,
          sdkAfter: true,
          apiAfter: false,
          pluginIds: ['plugin-discovery-test'],
        })),
      } as never,
    })

    const bus = new EventBus()

    try {
      expect(availableEvents).toContain('workflow.completed')

      plugin.register(bus)
      bus.emit('workflow.completed', {
        type: 'workflow.completed',
        data: {
          event: 'workflow.completed',
          data: { id: 'flow-123' },
          timestamp: '2026-03-31T12:30:00.000Z',
        },
        timestamp: '2026-03-31T12:30:00.000Z',
      })

      await vi.waitFor(() => {
        expect(inlineRecords).toEqual([
          {
            eventName: 'workflow.completed',
            itemId: 'flow-123',
          },
        ])
      })
    } finally {
      plugin.unregister()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('runs ordered mixed handlers, passes inline { event, sdk }, sends one stdin envelope, and logs failures without stopping later handlers', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-'))
    const orderFile = path.join(workspaceRoot, 'order.log')
    const payloadFile = path.join(workspaceRoot, 'payload.json')
    const workerFile = path.join(workspaceRoot, 'worker.cjs')

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  name: 'explode-first',
                  type: 'inline',
                  events: ['task.*'],
                  enabled: true,
                  source: 'function ({ event, sdk }) { throw new Error(`boom:${event.event}:${sdk.marker}`) }',
                },
                {
                  name: 'write-process-payload',
                  type: 'process',
                  events: ['task.created'],
                  enabled: true,
                  command: process.execPath,
                  args: [workerFile, payloadFile, orderFile],
                },
                {
                  name: 'capture-inline-shape',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ event, sdk }) { globalThis.__callbackRuntimeTest.appendOrder("inline"); globalThis.__callbackRuntimeTest.pushRecord({ argCount: arguments.length, keys: Object.keys(arguments[0]).sort(), eventName: event.event, dataId: event.data.id, sdkMarker: sdk.marker }); }',
                },
                {
                  name: 'disabled-inline',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: false,
                  source: 'function () { globalThis.__callbackRuntimeTest.appendOrder("disabled") }',
                },
                {
                  name: 'non-matching-inline',
                  type: 'inline',
                  events: ['comment.created'],
                  enabled: true,
                  source: 'function () { globalThis.__callbackRuntimeTest.appendOrder("comment") }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    fs.writeFileSync(
      workerFile,
      [
        "const fs = require('node:fs')",
        'const payloadFile = process.argv[2]',
        'const orderFile = process.argv[3]',
        "let stdin = ''",
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (chunk) => { stdin += chunk })",
        "process.stdin.on('end', () => {",
        '  const parsed = JSON.parse(stdin)',
        "  fs.writeFileSync(payloadFile, JSON.stringify(parsed), 'utf8')",
        "  fs.appendFileSync(orderFile, 'process\\n', 'utf8')",
        "  if (Object.keys(parsed).join(',') !== 'event') process.exitCode = 9",
        '})',
      ].join('\n'),
      'utf-8',
    )

    const inlineRecords: Array<Record<string, unknown>> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        inlineRecords.push(record)
      },
      appendOrder(label) {
        fs.appendFileSync(orderFile, `${label}\n`, 'utf-8')
      },
    }

    const plugin = new CallbackListenerPlugin()
    const fakeSdk = { marker: 'sdk-from-test' }
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: fakeSdk as never,
    })

    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      plugin.register(bus)

      const afterEvent = {
        event: 'task.created',
        data: { id: 'card-123', title: 'Card 123' },
        actor: 'alice',
        boardId: 'default',
        timestamp: '2026-03-31T12:00:00.000Z',
        meta: { source: 'unit-test' },
      }

      bus.emit('task.created', {
        type: 'task.created',
        data: afterEvent,
        timestamp: afterEvent.timestamp,
        actor: afterEvent.actor,
        boardId: afterEvent.boardId,
      })

      await vi.waitFor(() => {
        expect(fs.existsSync(payloadFile)).toBe(true)
        expect(inlineRecords).toHaveLength(1)
      })

      expect(inlineRecords).toEqual([
        {
          argCount: 1,
          keys: ['event', 'sdk'],
          eventName: 'task.created',
          dataId: 'card-123',
          sdkMarker: 'sdk-from-test',
        },
      ])
      expect(JSON.parse(fs.readFileSync(payloadFile, 'utf-8'))).toEqual({ event: afterEvent })
      expect(fs.readFileSync(orderFile, 'utf-8').trim().split('\n')).toEqual(['process', 'inline'])
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[kl-plugin-callback] handler "explode-first" failed for event "task.created"'),
        'boom:task.created:sdk-from-test',
      )
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})

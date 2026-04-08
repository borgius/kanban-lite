import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET } from '../../kanban-lite/src/sdk/callbacks/contract'
import { installRuntimeHost, resetRuntimeHost } from '../../kanban-lite/src/shared/env'
import { EventBus } from '../../kanban-lite/src/sdk/eventBus'
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
    editor?: string
    language?: string
    height?: string
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
  resetRuntimeHost()
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
  it('models mixed module, inline, and process handlers in a single ordered handlers array', () => {
    const metadata = optionsSchemas.callbacks()
    const handlers = (metadata.schema.properties as Record<string, SchemaNode>).handlers
    const itemProperties = (handlers.items?.properties ?? {}) as Record<string, SchemaNode>
    const required = ((handlers.items as SchemaNode & { required?: string[] })?.required ?? [])

    expect(metadata.secrets).toEqual([])
    expect(handlers.type).toBe('array')
    expect(handlers.default).toEqual([])
    expect(required).toContain('id')
    expect(itemProperties.id.type).toBe('string')
    expect(itemProperties.type.enum).toEqual(['module', 'inline', 'process'])
    expect(itemProperties.events.type).toBe('array')
    expect(itemProperties.module.type).toBe('string')
    expect(itemProperties.handler.type).toBe('string')
    expect(itemProperties.source.type).toBe('string')
    expect(itemProperties.command.type).toBe('string')
    expect(itemProperties.args.type).toBe('array')
  })

  it('uses explicit uiSchema rules and CodeMirror inline source authoring hints', () => {
    const metadata = optionsSchemas.callbacks()
    const handlersControl = ((metadata.uiSchema as UiSchemaNode).elements ?? [])[0]?.elements?.[0]
    const detailElements = handlersControl?.options?.detail?.elements ?? []
    const idControl = detailElements.find((element) => element.scope === '#/properties/id')
    const moduleControl = detailElements.find((element) => element.scope === '#/properties/module')
    const handlerControl = detailElements.find((element) => element.scope === '#/properties/handler')
    const sourceControl = detailElements.find((element) => element.scope === '#/properties/source')
    const commandControl = detailElements.find((element) => element.scope === '#/properties/command')

    expect(handlersControl?.options?.showSortButtons).toBe(true)
    expect(handlersControl?.options?.elementLabelProp).toBe('name')
    expect(idControl?.scope).toBe('#/properties/id')
    expect(moduleControl?.rule).toEqual({
      effect: 'SHOW',
      condition: {
        scope: '#/properties/type',
        schema: { const: 'module' },
      },
    })
    expect(handlerControl?.rule).toEqual({
      effect: 'SHOW',
      condition: {
        scope: '#/properties/type',
        schema: { const: 'module' },
      },
    })
    expect(sourceControl?.options?.editor).toBe('code')
    expect(sourceControl?.options?.language).toBe('javascript')
    expect(sourceControl?.options?.height).toBe('220px')
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
  it('prefers shared config repository handlers over the local seed file when they differ', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-shared-config-'))
    const configPath = path.join(workspaceRoot, '.kanban.json')

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  id: 'local-task-created',
                  name: 'local-task-created',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ source: "local", handlerId: callback.handlerId }) }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    installRuntimeHost({
      readConfig(root: string, requestedFilePath: string) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(configPath)

        return {
          version: 2,
          defaultBoard: 'default',
          kanbanDirectory: '.kanban',
          boards: {
            default: {
              name: 'Default',
              columns: [],
              nextCardId: 1,
              defaultStatus: 'backlog',
              defaultPriority: 'medium',
            },
          },
          plugins: {
            'callback.runtime': {
              provider: 'callbacks',
              options: {
                handlers: [
                  {
                    id: 'hosted-task-created',
                    name: 'hosted-task-created',
                    type: 'inline',
                    events: ['task.created'],
                    enabled: true,
                    source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ source: "hosted", handlerId: callback.handlerId }) }',
                  },
                ],
              },
            },
          },
          aiAgent: 'copilot',
          defaultPriority: 'medium',
          defaultStatus: 'backlog',
          showPriorityBadges: true,
          showAssignee: true,
          showDueDate: true,
          showLabels: true,
          showBuildWithAI: true,
          showFileName: false,
          markdownEditorMode: false,
          showDeletedColumn: false,
          boardZoom: 100,
          cardZoom: 100,
          boardBackgroundMode: 'preset',
          boardBackgroundPreset: 'kanban',
          port: 3000,
          nextCardId: 1,
        }
      },
    })

    const records: Array<{ source: string; handlerId: string }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as { source: string; handlerId: string })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-shared-config' },
          timestamp: '2026-04-06T12:00:00.000Z',
        },
        timestamp: '2026-04-06T12:00:00.000Z',
      })

      await vi.waitFor(() => {
        expect(records).toEqual([
          {
            source: 'hosted',
            handlerId: 'hosted-task-created',
          },
        ])
      })
    } finally {
      plugin.unregister()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('accepts shared module handlers without collapsing distinct module and named-handler identities', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-module-contract-'))

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  name: 'module-default',
                  type: 'module',
                  events: ['task.created'],
                  enabled: false,
                  module: './callbacks/task-created',
                  handler: 'default',
                },
                {
                  name: 'module-secondary',
                  type: 'module',
                  events: ['task.created'],
                  enabled: false,
                  module: './callbacks/task-created',
                  handler: 'onTaskCreated',
                },
                {
                  name: 'module-other-file',
                  type: 'module',
                  events: ['task.created'],
                  enabled: false,
                  module: './callbacks/task-updated',
                  handler: 'default',
                },
                {
                  id: 'probe-inline',
                  name: 'probe-inline',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "probe", handlerId: callback.handlerId }) }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    const records: Array<{ label: string; handlerId: string }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as { label: string; handlerId: string })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-module-contract' },
          timestamp: '2026-04-07T09:00:00.000Z',
        },
        timestamp: '2026-04-07T09:00:00.000Z',
      })

      await vi.waitFor(() => {
        expect(records).toEqual([
          {
            label: 'probe',
            handlerId: 'probe-inline',
          },
        ])
      })

      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('logs shared config repository failures and skips local seed handlers when provider reads fail', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-config-read-error-'))
    const configPath = path.join(workspaceRoot, '.kanban.json')

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  id: 'local-task-created',
                  name: 'local-task-created',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ source: "local", handlerId: callback.handlerId }) }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    installRuntimeHost({
      readConfig(root: string, requestedFilePath: string) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(configPath)

        return {
          version: 2,
          defaultBoard: 'default',
          kanbanDirectory: '.kanban',
          boards: {
            default: {
              name: 'Default',
              columns: [],
              nextCardId: 1,
              defaultStatus: 'backlog',
              defaultPriority: 'medium',
            },
          },
          plugins: {
            'callback.runtime': {
              provider: 'callbacks',
              options: {
                handlers: [
                  {
                    id: 'hosted-task-created',
                    name: 'hosted-task-created',
                    type: 'inline',
                    events: ['task.created'],
                    enabled: true,
                    source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ source: "hosted", handlerId: callback.handlerId }) }',
                  },
                ],
              },
            },
            'config.storage': {
              provider: 'failing-config-storage',
              options: {
                endpoint: 'https://cfg.test',
              },
            },
          },
          aiAgent: 'copilot',
          defaultPriority: 'medium',
          defaultStatus: 'backlog',
          showPriorityBadges: true,
          showAssignee: true,
          showDueDate: true,
          showLabels: true,
          showBuildWithAI: true,
          showFileName: false,
          markdownEditorMode: false,
          showDeletedColumn: false,
          boardZoom: 100,
          cardZoom: 100,
          boardBackgroundMode: 'preset',
          boardBackgroundPreset: 'kanban',
          port: 3000,
          nextCardId: 1,
        }
      },
      resolveExternalModule(request: string) {
        if (request !== 'failing-config-storage') {
          return undefined
        }

        return {
          createConfigStorageProvider() {
            return {
              manifest: { id: 'failing-config-storage', provides: ['config.storage'] },
              readConfigDocument() {
                throw new Error('simulated remote config outage')
              },
              writeConfigDocument() {
                throw new Error('simulated remote config outage')
              },
            }
          },
        }
      },
    })

    const records: Array<{ source: string; handlerId: string }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as { source: string; handlerId: string })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-config-read-error' },
          timestamp: '2026-04-06T12:01:00.000Z',
        },
        timestamp: '2026-04-06T12:01:00.000Z',
      })

      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          '[kl-plugin-callback] failed to load callback handlers from shared config repository',
          expect.stringContaining('simulated remote config outage'),
        )
      })
      expect(records).toEqual([])
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when an enabled shared module row is malformed', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-malformed-module-'))

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  id: 'valid-inline',
                  name: 'valid-inline',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ source: "inline", handlerId: callback.handlerId }) }',
                },
                {
                  id: 'broken-module',
                  name: 'broken-module',
                  type: 'module',
                  events: ['task.created'],
                  enabled: true,
                  handler: 'onTaskCreated',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    const records: Array<{ source: string; handlerId: string }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as { source: string; handlerId: string })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-malformed-module' },
          timestamp: '2026-04-07T10:00:00.000Z',
        },
        timestamp: '2026-04-07T10:00:00.000Z',
      })

      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          '[kl-plugin-callback] failed to load callback handlers from shared config repository',
          expect.stringContaining('Enabled callback.runtime module handlers require non-empty module and handler strings.'),
        )
      })
      expect(records).toEqual([])
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

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
                  id: 'workflow-completed-inline',
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

  it('runs ordered mixed module, inline, and process handlers, passes { event, sdk, callback }, and logs failures without stopping later handlers', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-'))
    const orderFile = path.join(workspaceRoot, 'order.log')
    const payloadFile = path.join(workspaceRoot, 'payload.json')
    const workerFile = path.join(workspaceRoot, 'worker.cjs')
    const defaultModuleFile = path.join(workspaceRoot, 'callback-module-default.cjs')
    const namedModuleFile = path.join(workspaceRoot, 'callback-module-named.cjs')
    const captureSource = 'function ({ event, sdk, callback }) { globalThis.__callbackRuntimeTest.appendOrder(callback.handlerId); globalThis.__callbackRuntimeTest.pushRecord({ channel: "inline", argCount: arguments.length, keys: Object.keys(arguments[0]).sort(), eventName: event.event, dataId: event.data.id, sdkMarker: sdk.marker, eventId: callback.eventId, handlerId: callback.handlerId, handlerRevision: callback.handlerRevision, idempotencyKey: callback.idempotencyKey }); }'

    fs.writeFileSync(
      defaultModuleFile,
      [
        'module.exports = function ({ event, sdk, callback }) {',
        '  globalThis.__callbackRuntimeTest.appendOrder(callback.handlerId)',
        '  globalThis.__callbackRuntimeTest.pushRecord({ channel: "module-default", argCount: arguments.length, keys: Object.keys(arguments[0]).sort(), eventName: event.event, dataId: event.data.id, sdkMarker: sdk.marker, eventId: callback.eventId, handlerId: callback.handlerId, handlerRevision: callback.handlerRevision, idempotencyKey: callback.idempotencyKey })',
        '}',
      ].join('\n'),
      'utf-8',
    )

    fs.writeFileSync(
      namedModuleFile,
      [
        'module.exports = {',
        '  onTaskCreated: function ({ event, sdk, callback }) {',
        '    globalThis.__callbackRuntimeTest.appendOrder(callback.handlerId)',
        '    globalThis.__callbackRuntimeTest.pushRecord({ channel: "module-named", argCount: arguments.length, keys: Object.keys(arguments[0]).sort(), eventName: event.event, dataId: event.data.id, sdkMarker: sdk.marker, eventId: callback.eventId, handlerId: callback.handlerId, handlerRevision: callback.handlerRevision, idempotencyKey: callback.idempotencyKey })',
        '  },',
        '}',
      ].join('\n'),
      'utf-8',
    )

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  id: 'explode-first',
                  name: 'explode-first',
                  type: 'inline',
                  events: ['task.*'],
                  enabled: true,
                  source: 'function ({ event, sdk, callback }) { throw new Error(`boom:${event.event}:${sdk.marker}:${callback.handlerId}`) }',
                },
                {
                  id: 'missing-module-task-created',
                  name: 'missing-module-handler',
                  type: 'module',
                  events: ['task.created'],
                  enabled: true,
                  module: './callback-module-named.cjs',
                  handler: 'missingHandler',
                },
                {
                  id: 'module-default-task-created',
                  name: 'module-default-handler',
                  type: 'module',
                  events: ['task.created'],
                  enabled: true,
                  module: './callback-module-default.cjs',
                  handler: 'default',
                },
                {
                  id: 'process-task-created',
                  name: 'write-process-payload',
                  type: 'process',
                  events: ['task.created'],
                  enabled: true,
                  command: process.execPath,
                  args: [workerFile, payloadFile, orderFile],
                },
                {
                  id: 'module-task-created',
                  name: 'module-named-handler',
                  type: 'module',
                  events: ['task.created'],
                  enabled: true,
                  module: './callback-module-named.cjs',
                  handler: 'onTaskCreated',
                },
                {
                  id: 'capture-inline-created-a',
                  name: 'capture-inline-shape',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: captureSource,
                },
                {
                  id: 'capture-inline-created-b',
                  name: 'renamed-inline-shape',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: captureSource,
                },
                {
                  id: 'disabled-inline',
                  name: 'disabled-inline',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: false,
                  source: 'function () { globalThis.__callbackRuntimeTest.appendOrder("disabled") }',
                },
                {
                  id: 'non-matching-inline',
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
        "  fs.appendFileSync(orderFile, `${parsed.callback.handlerId}\\n`, 'utf8')",
        "  if (Object.keys(parsed).sort().join(',') !== 'callback,event') process.exitCode = 9",
        "  if (!parsed.callback || typeof parsed.callback.handlerId !== 'string' || typeof parsed.callback.handlerRevision !== 'string' || typeof parsed.callback.eventId !== 'string') process.exitCode = 10",
        '})',
      ].join('\n'),
      'utf-8',
    )

    const runtimeRecords: Array<Record<string, unknown>> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        runtimeRecords.push(record)
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
        expect(runtimeRecords).toHaveLength(4)
      })

      const runtimeRecordsByHandlerId = new Map(
        runtimeRecords.map((record) => [String(record.handlerId), record]),
      )

      const processPayload = JSON.parse(fs.readFileSync(payloadFile, 'utf-8')) as {
        event: typeof afterEvent
        callback: {
          eventId: string
          handlerId: string
          handlerRevision: string
          idempotencyKey: string
          idempotencyScope: string
          budgets: {
            durableEventRecordD1Writes: typeof CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET
          }
        }
      }

      expect(runtimeRecordsByHandlerId.get('module-default-task-created')).toMatchObject({
        channel: 'module-default',
        argCount: 1,
        keys: ['callback', 'event', 'sdk'],
        eventName: 'task.created',
        dataId: 'card-123',
        sdkMarker: 'sdk-from-test',
        handlerId: 'module-default-task-created',
        eventId: expect.stringMatching(/^cb_evt_/),
        handlerRevision: expect.any(String),
        idempotencyKey: expect.stringMatching(/^callback-event:cb_evt_.+:handler:module-default-task-created$/),
      })
      expect(runtimeRecordsByHandlerId.get('module-task-created')).toMatchObject({
        channel: 'module-named',
        argCount: 1,
        keys: ['callback', 'event', 'sdk'],
        eventName: 'task.created',
        dataId: 'card-123',
        sdkMarker: 'sdk-from-test',
        handlerId: 'module-task-created',
        eventId: expect.stringMatching(/^cb_evt_/),
        handlerRevision: expect.any(String),
        idempotencyKey: expect.stringMatching(/^callback-event:cb_evt_.+:handler:module-task-created$/),
      })
      expect(runtimeRecordsByHandlerId.get('capture-inline-created-a')).toMatchObject({
        channel: 'inline',
        argCount: 1,
        keys: ['callback', 'event', 'sdk'],
        eventName: 'task.created',
        dataId: 'card-123',
        sdkMarker: 'sdk-from-test',
        handlerId: 'capture-inline-created-a',
        eventId: expect.stringMatching(/^cb_evt_/),
        handlerRevision: expect.any(String),
        idempotencyKey: expect.stringMatching(/^callback-event:cb_evt_.+:handler:capture-inline-created-a$/),
      })
      expect(runtimeRecordsByHandlerId.get('capture-inline-created-b')).toMatchObject({
        channel: 'inline',
        argCount: 1,
        keys: ['callback', 'event', 'sdk'],
        eventName: 'task.created',
        dataId: 'card-123',
        sdkMarker: 'sdk-from-test',
        handlerId: 'capture-inline-created-b',
        eventId: expect.stringMatching(/^cb_evt_/),
        handlerRevision: expect.any(String),
        idempotencyKey: expect.stringMatching(/^callback-event:cb_evt_.+:handler:capture-inline-created-b$/),
      })
      expect(processPayload).toMatchObject({
        event: afterEvent,
        callback: {
          eventId: expect.stringMatching(/^cb_evt_/),
          handlerId: 'process-task-created',
          handlerRevision: expect.any(String),
          idempotencyScope: 'event-handler',
          budgets: {
            durableEventRecordD1Writes: CALLBACK_DURABLE_EVENT_RECORD_D1_WRITE_BUDGET,
          },
        },
      })
      const observedEventIds = new Set([
        processPayload.callback.eventId,
        ...runtimeRecords.map((record) => String(record.eventId)),
      ])
      expect(processPayload.callback.idempotencyKey).toBe(
        `callback-event:${processPayload.callback.eventId}:handler:process-task-created`,
      )
      expect(observedEventIds.size).toBe(1)
      expect(runtimeRecordsByHandlerId.get('capture-inline-created-a')?.handlerRevision).toBe(
        runtimeRecordsByHandlerId.get('capture-inline-created-b')?.handlerRevision,
      )
      expect(processPayload.callback.handlerRevision).not.toBe(
        runtimeRecordsByHandlerId.get('capture-inline-created-a')?.handlerRevision,
      )
      expect(fs.readFileSync(orderFile, 'utf-8').trim().split('\n')).toEqual([
        'module-default-task-created',
        'process-task-created',
        'module-task-created',
        'capture-inline-created-a',
        'capture-inline-created-b',
      ])
      expect(errorSpy.mock.calls).toHaveLength(2)
      expect(errorSpy.mock.calls).toEqual(expect.arrayContaining([
        [
          expect.stringContaining('[kl-plugin-callback] handler "explode-first" failed for event "task.created"'),
          'boom:task.created:sdk-from-test:explode-first',
        ],
        [
          expect.stringContaining('[kl-plugin-callback] handler "missing-module-handler" failed for event "task.created"'),
          expect.stringContaining("callable named handler 'missingHandler'"),
        ],
      ]))
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('derives stable legacy handler ids for handlers without persisted ids so reordering preserves durable identity', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-legacy-id-'))

    const records: Array<{
      label: string
      handlerId: string
      eventId: string
      idempotencyKey: string
    }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as {
          label: string
          handlerId: string
          eventId: string
          idempotencyKey: string
        })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const writeHandlers = (handlers: unknown[]): void => {
      fs.writeFileSync(
        path.join(workspaceRoot, '.kanban.json'),
        JSON.stringify({
          plugins: {
            'callback.runtime': {
              provider: 'callbacks',
              options: { handlers },
            },
          },
        }, null, 2),
        'utf-8',
      )
    }

    const legacyAlpha = {
      name: 'legacy-alpha',
      type: 'inline',
      events: ['task.created'],
      enabled: true,
      source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "alpha", handlerId: callback.handlerId, eventId: callback.eventId, idempotencyKey: callback.idempotencyKey }) }',
    }
    const legacyBeta = {
      name: 'legacy-beta',
      type: 'inline',
      events: ['task.created'],
      enabled: true,
      source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "beta", handlerId: callback.handlerId, eventId: callback.eventId, idempotencyKey: callback.idempotencyKey }) }',
    }

    writeHandlers([legacyAlpha, legacyBeta])

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-legacy-1' },
          timestamp: '2026-04-06T10:00:00.000Z',
        },
        timestamp: '2026-04-06T10:00:00.000Z',
      })

      await vi.waitFor(() => {
        expect(records).toHaveLength(2)
      })

      const firstRun = records.splice(0, records.length)
      writeHandlers([legacyBeta, legacyAlpha])

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-legacy-2' },
          timestamp: '2026-04-06T10:01:00.000Z',
        },
        timestamp: '2026-04-06T10:01:00.000Z',
      })

      await vi.waitFor(() => {
        expect(records).toHaveLength(2)
      })

      const secondRun = records.splice(0, records.length)
      const firstByLabel = new Map(firstRun.map((record) => [record.label, record]))
      const secondByLabel = new Map(secondRun.map((record) => [record.label, record]))

      expect(firstRun.map((record) => record.label)).toEqual(['alpha', 'beta'])
      expect(secondRun.map((record) => record.label)).toEqual(['beta', 'alpha'])

      expect(firstByLabel.get('alpha')?.handlerId).toMatch(/^legacy-handler-[a-f0-9]{64}$/)
      expect(firstByLabel.get('beta')?.handlerId).toMatch(/^legacy-handler-[a-f0-9]{64}$/)
      expect(firstByLabel.get('alpha')?.handlerId).not.toBe(firstByLabel.get('beta')?.handlerId)
      expect(secondByLabel.get('alpha')?.handlerId).toBe(firstByLabel.get('alpha')?.handlerId)
      expect(secondByLabel.get('beta')?.handlerId).toBe(firstByLabel.get('beta')?.handlerId)
      expect(firstByLabel.get('alpha')?.idempotencyKey).toBe(
        `callback-event:${firstByLabel.get('alpha')?.eventId}:handler:${firstByLabel.get('alpha')?.handlerId}`,
      )
      expect(firstByLabel.get('beta')?.idempotencyKey).toBe(
        `callback-event:${firstByLabel.get('beta')?.eventId}:handler:${firstByLabel.get('beta')?.handlerId}`,
      )
    } finally {
      plugin.unregister()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('refuses ambiguous durable claims for legacy handlers without a stable unique identity', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-legacy-duplicate-'))

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  name: 'legacy-duplicate',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "duplicate", handlerId: callback.handlerId }) }',
                },
                {
                  name: 'legacy-duplicate',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "duplicate", handlerId: callback.handlerId }) }',
                },
                {
                  id: 'stable-explicit-id',
                  name: 'explicit-handler',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "explicit", handlerId: callback.handlerId }) }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    const records: Array<{ label: string; handlerId: string }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as { label: string; handlerId: string })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-duplicate' },
          timestamp: '2026-04-06T10:02:00.000Z',
        },
        timestamp: '2026-04-06T10:02:00.000Z',
      })

      await vi.waitFor(() => {
        expect(records).toEqual([
          {
            label: 'explicit',
            handlerId: 'stable-explicit-id',
          },
        ])
      })

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('refusing durable callback claims for legacy handler "legacy-duplicate"'),
      )
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('refuses duplicate explicit handler ids and still runs unique handlers', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-callback-explicit-duplicate-'))

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                {
                  id: 'stable-explicit-id',
                  name: 'explicit-a',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "explicit-a", handlerId: callback.handlerId }) }',
                },
                {
                  id: 'stable-explicit-id',
                  name: 'explicit-b',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "explicit-b", handlerId: callback.handlerId }) }',
                },
                {
                  id: 'unique-explicit-id',
                  name: 'unique-handler',
                  type: 'inline',
                  events: ['task.created'],
                  enabled: true,
                  source: 'function ({ callback }) { globalThis.__callbackRuntimeTest.pushRecord({ label: "unique", handlerId: callback.handlerId }) }',
                },
              ],
            },
          },
        },
      }, null, 2),
      'utf-8',
    )

    const records: Array<{ label: string; handlerId: string }> = []
    runtimeGlobal.__callbackRuntimeTest = {
      pushRecord(record) {
        records.push(record as { label: string; handlerId: string })
      },
      appendOrder() {
        // no-op for this regression test
      },
    }

    const plugin = new CallbackListenerPlugin()
    plugin.attachRuntimeContext({
      workspaceRoot,
      sdk: { marker: 'sdk-from-test' } as never,
    })

    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      plugin.register(bus)

      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-explicit-duplicate' },
          timestamp: '2026-04-06T10:03:00.000Z',
        },
        timestamp: '2026-04-06T10:03:00.000Z',
      })

      await vi.waitFor(() => {
        expect(records).toEqual([
          {
            label: 'unique',
            handlerId: 'unique-explicit-id',
          },
        ])
      })

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('refusing durable callback claims for configured handler "explicit-a"'),
      )
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('refusing durable callback claims for configured handler "explicit-b"'),
      )
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('configured id "stable-explicit-id"'),
      )
    } finally {
      plugin.unregister()
      errorSpy.mockRestore()
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})

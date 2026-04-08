import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventBus } from '../../kanban-lite/src/sdk/eventBus'
import type {
  Card,
  CardStateModuleContext,
  CloudflareWorkerProviderContext,
} from '../../kanban-lite/src/sdk/index'
import type { ConfigStorageModuleContext } from '../../kanban-lite/src/sdk/plugins/index'

import {
  createAttachmentStoragePlugin,
  createCallbackListenerPlugin,
  createCardStateProvider,
  createCardStoragePlugin,
  createConfigStorageProvider,
  createWorkerConfigRepositoryBridge,
  optionsSchemas,
  pluginManifest,
} from './index'

interface SchemaNode {
  type?: string
  const?: string
  default?: unknown
  enum?: string[]
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
}

interface UiSchemaNode {
  scope?: string
  options?: {
    showSortButtons?: boolean
    elementLabelProp?: string
    detail?: {
      elements?: UiSchemaNode[]
    }
  }
  elements?: UiSchemaNode[]
}

interface CloudflareCallbackRuntimeTestGlobal {
  __cloudflareCallbackRuntimeTest?: {
    calls: Array<Record<string, unknown>>
    alphaFailuresRemaining: number
  }
}

const callbackRuntimeGlobal = globalThis as typeof globalThis & CloudflareCallbackRuntimeTestGlobal
let virtualWorkspaceCounter = 0

type FakeD1CardRow = {
  boardId: string
  cardId: string
  status: string
  cardJson: string
}

type FakeD1StateRow = {
  actorId: string
  boardId: string
  cardId: string
  domain: string
  valueJson: string
  updatedAt: string
}

type FakeD1CallbackEventRow = {
  eventId: string
  recordJson: string
}

class FakeQueue {
  readonly messages: unknown[] = []

  async send(message: unknown): Promise<void> {
    this.messages.push(structuredClone(message))
  }
}

class FakeD1PreparedStatement {
  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db, this.query, values)
  }

  run(): { success: true } {
    return this.db.executeRun(this.query, this.values) as { success: true }
  }

  first<T = Record<string, unknown>>(): T | null {
    return (this.db.executeFirst(this.query, this.values) as T | null) ?? null
  }

  all<T = Record<string, unknown>>(): { results: T[] } {
    return {
      results: this.db.executeAll(this.query, this.values) as T[],
    }
  }
}

class FakeD1Database {
  readonly cards = new Map<string, FakeD1CardRow>()
  readonly configDocuments = new Map<string, Record<string, unknown>>()
  readonly stateRows = new Map<string, FakeD1StateRow>()
  readonly callbackEventRecords = new Map<string, FakeD1CallbackEventRow>()
  onBeforeUpdateCallbackEventRecord: ((record: Record<string, unknown>) => void) | null = null
  execCount = 0

  exec(_query: string): { success: true } {
    this.execCount += 1
    return { success: true }
  }

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, query)
  }

  executeRun(query: string, values: unknown[]): { success: true; meta: { changes: number } } {
    const normalized = normalizeQuery(query)

    if (normalized.startsWith('insert into cards')) {
      const [cardId, boardId, status, cardJson] = values as [string, string, string, string]
      this.cards.set(`${boardId}:${cardId}`, { boardId, cardId, status, cardJson })
      return { success: true, meta: { changes: 1 } }
    }

    if (normalized.startsWith('update cards set status = ?, card_json = ?')) {
      const [status, cardJson, boardId, cardId] = values as [string, string, string, string]
      this.cards.set(`${boardId}:${cardId}`, { boardId, cardId, status, cardJson })
      return { success: true, meta: { changes: 1 } }
    }

    if (normalized.startsWith('delete from cards')) {
      const [boardId, cardId] = values as [string, string]
      this.cards.delete(`${boardId}:${cardId}`)
      return { success: true, meta: { changes: 1 } }
    }

    if (normalized.startsWith('delete from cards where board_id = ?')) {
      const [boardId] = values as [string]
      for (const key of [...this.cards.keys()]) {
        if (key.startsWith(`${boardId}:`)) this.cards.delete(key)
      }
      return { success: true, meta: { changes: 1 } }
    }

    if (normalized.startsWith('insert into config_documents')) {
      const [documentId, documentJson] = values as [string, string]
      this.configDocuments.set(documentId, JSON.parse(documentJson) as Record<string, unknown>)
      return { success: true, meta: { changes: 1 } }
    }

    if (normalized.startsWith('insert into card_state')) {
      const [actorId, boardId, cardId, domain, valueJson, updatedAt] = values as [string, string, string, string, string, string]
      this.stateRows.set(`${actorId}:${boardId}:${cardId}:${domain}`, {
        actorId,
        boardId,
        cardId,
        domain,
        valueJson,
        updatedAt,
      })
      return { success: true, meta: { changes: 1 } }
    }

    if (normalized.startsWith('insert into callback_event_records')) {
      const [eventId, recordJson] = values as [string, string]
      const exists = this.callbackEventRecords.has(eventId)

      if (!exists) {
        this.callbackEventRecords.set(eventId, { eventId, recordJson })
      }

      return {
        success: true,
        meta: { changes: exists && normalized.includes('do nothing') ? 0 : 1 },
      }
    }

    if (normalized.startsWith('update callback_event_records set record_json = ? where event_id = ?')) {
      const [recordJson, eventId] = values as [string, string]
      this.onBeforeUpdateCallbackEventRecord?.(JSON.parse(recordJson) as Record<string, unknown>)
      this.callbackEventRecords.set(eventId, { eventId, recordJson })
      return { success: true, meta: { changes: 1 } }
    }

    throw new Error(`Unsupported D1 run query in test fake: ${normalized}`)
  }

  executeFirst(query: string, values: unknown[]): Record<string, unknown> | null {
    const normalized = normalizeQuery(query)

    if (normalized.includes('from cards') && normalized.includes('where board_id = ? and card_id = ?')) {
      const [boardId, cardId] = values as [string, string]
      const row = this.cards.get(`${boardId}:${cardId}`)
      return row
        ? { board_id: row.boardId, card_id: row.cardId, status: row.status, card_json: row.cardJson }
        : null
    }

    if (normalized.includes('from config_documents')) {
      const [documentId] = values as [string]
      const row = this.configDocuments.get(documentId)
      return row
        ? { document_id: documentId, document_json: JSON.stringify(row) }
        : null
    }

    if (normalized.includes('from card_state')) {
      const [actorId, boardId, cardId, domain] = values as [string, string, string, string]
      const row = this.stateRows.get(`${actorId}:${boardId}:${cardId}:${domain}`)
      return row
        ? {
            actor_id: row.actorId,
            board_id: row.boardId,
            card_id: row.cardId,
            domain: row.domain,
            value_json: row.valueJson,
            updated_at: row.updatedAt,
          }
        : null
    }

    if (normalized.includes('from callback_event_records')) {
      const [eventId] = values as [string]
      const row = this.callbackEventRecords.get(eventId)
      return row
        ? {
            event_id: row.eventId,
            record_json: row.recordJson,
          }
        : null
    }

    throw new Error(`Unsupported D1 first query in test fake: ${normalized}`)
  }

  executeAll(query: string, values: unknown[]): Array<Record<string, unknown>> {
    const normalized = normalizeQuery(query)

    if (normalized.includes('from cards') && normalized.includes('where board_id = ?')) {
      const [boardId] = values as [string]
      return [...this.cards.values()]
        .filter((row) => row.boardId === boardId)
        .sort((left, right) => left.cardId.localeCompare(right.cardId))
        .map((row) => ({
          board_id: row.boardId,
          card_id: row.cardId,
          status: row.status,
          card_json: row.cardJson,
        }))
    }

    throw new Error(`Unsupported D1 all query in test fake: ${normalized}`)
  }
}

class AsyncFakeD1PreparedStatement {
  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): AsyncFakeD1PreparedStatement {
    return new AsyncFakeD1PreparedStatement(this.db, this.query, values)
  }

  async run(): Promise<{ success: true }> {
    this.db.executeRun(this.query, this.values)
    return { success: true }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.executeFirst(this.query, this.values) as T | null) ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return {
      results: this.db.executeAll(this.query, this.values) as T[],
    }
  }
}

class AsyncFakeD1Database {
  private readonly delegate = new FakeD1Database()

  async exec(_query: string): Promise<{ success: true }> {
    this.delegate.execCount += 1
    return { success: true }
  }

  prepare(query: string): AsyncFakeD1PreparedStatement {
    return new AsyncFakeD1PreparedStatement(this.delegate, query)
  }
}

class FakeR2ObjectBody {
  constructor(private readonly bytes: Uint8Array) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer
  }
}

class FakeR2Bucket {
  readonly objects = new Map<string, Uint8Array>()
  putCount = 0

  async put(key: string, value: string | Uint8Array | ArrayBuffer): Promise<void> {
    this.putCount += 1
    this.objects.set(key, toUint8Array(value))
  }

  async get(key: string): Promise<FakeR2ObjectBody | null> {
    const bytes = this.objects.get(key)
    return bytes ? new FakeR2ObjectBody(bytes) : null
  }
}

const tempPaths: string[] = []

afterEach(async () => {
  delete callbackRuntimeGlobal.__cloudflareCallbackRuntimeTest
  for (const target of tempPaths.splice(0)) {
    await fs.rm(target, { recursive: true, force: true })
  }
})

describe('kl-plugin-cloudflare', () => {
  it('advertises all Cloudflare capabilities under the canonical provider id', () => {
    expect(pluginManifest).toEqual({
      id: 'kl-plugin-cloudflare',
      capabilities: {
        'card.storage': ['cloudflare'],
        'attachment.storage': ['cloudflare'],
        'card.state': ['cloudflare'],
        'config.storage': ['cloudflare'],
        'callback.runtime': ['cloudflare'],
      },
      integrations: ['event.listener'],
    })
  })

  it('exposes a module-only callback.runtime schema for the cloudflare provider', () => {
    const metadata = optionsSchemas.cloudflare()
    const handlers = (metadata.schema.properties as Record<string, SchemaNode>).handlers
    const itemProperties = (handlers.items?.properties ?? {}) as Record<string, SchemaNode>
    const handlersControl = ((metadata.uiSchema as UiSchemaNode).elements ?? [])[0]?.elements?.[0]
    const detailElements = handlersControl?.options?.detail?.elements ?? []

    expect(handlers.type).toBe('array')
    expect(handlers.default).toEqual([])
    expect(itemProperties.type.const).toBe('module')
    expect(itemProperties.type.default).toBe('module')
    expect(itemProperties.module.type).toBe('string')
    expect(itemProperties.handler.type).toBe('string')
    expect(itemProperties.source).toBeUndefined()
    expect(itemProperties.command).toBeUndefined()
    expect(handlersControl?.options?.showSortButtons).toBe(true)
    expect(handlersControl?.options?.elementLabelProp).toBe('name')
    expect(detailElements.map((element) => element.scope)).toEqual([
      '#/properties/id',
      '#/properties/name',
      '#/properties/enabled',
      '#/properties/events',
      '#/properties/module',
      '#/properties/handler',
    ])
  })

  it('round-trips cards through D1 and keeps move/rename behavior minimal', async () => {
    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const worker = createWorkerContext(database, bucket)
    const engine = createCardStoragePlugin(worker).createEngine('/virtual/workspace/.kanban')
    const card = makeCard({
      attachments: ['spec.txt'],
      tasks: [makeTask('Verify worker bundle')],
      metadata: { ticket: 'CF-7' },
    })

    await engine.init()
    await engine.writeCard(card)

    await expect(engine.scanCards('/virtual/workspace/.kanban/boards/default', 'default')).resolves.toEqual([
      expect.objectContaining({
        id: 'card-1',
        boardId: 'default',
        status: 'todo',
        attachments: ['spec.txt'],
        tasks: [makeTask('Verify worker bundle')],
        metadata: { ticket: 'CF-7' },
      }),
    ])

    await expect(engine.moveCard(card, '/virtual/workspace/.kanban/boards/default', 'done')).resolves.toBe('')
    await expect(engine.renameCard(card, 'renamed.md')).resolves.toBe('')
    await expect(engine.scanCards('/virtual/workspace/.kanban/boards/default', 'default')).resolves.toEqual([
      expect.objectContaining({
        id: 'card-1',
        status: 'done',
      }),
    ])

    await engine.deleteCard(card)
    await expect(engine.scanCards('/virtual/workspace/.kanban/boards/default', 'default')).resolves.toEqual([])
  })

  it('round-trips config documents and card state through the shared D1 binding', async () => {
    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const worker = createWorkerContext(database, bucket)
    const configProvider = createConfigStorageProvider(makeConfigStorageContext(worker))
    const stateProvider = createCardStateProvider(makeCardStateContext(worker))

    const document: Record<string, unknown> = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: { columns: [] },
      },
      plugins: {
        'config.storage': { provider: 'cloudflare' },
      },
    }

    configProvider.writeConfigDocument(document)
    expect(configProvider.readConfigDocument()).toEqual(document)

    await expect(stateProvider.getCardState({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
    })).resolves.toBeNull()

    await expect(stateProvider.setCardState({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { open: true },
      updatedAt: '2026-04-06T00:00:00.000Z',
    })).resolves.toEqual({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { open: true },
      updatedAt: '2026-04-06T00:00:00.000Z',
    })

    await expect(stateProvider.getCardState({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
    })).resolves.toEqual({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { open: true },
      updatedAt: '2026-04-06T00:00:00.000Z',
    })

    await expect(stateProvider.markUnreadReadThrough({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      cursor: { cursor: 'rev-1' },
    })).resolves.toMatchObject({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'unread',
      value: {
        cursor: 'rev-1',
      },
    })

    await expect(stateProvider.getUnreadCursor({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
    })).resolves.toMatchObject({
      cursor: 'rev-1',
    })
  })

  it('round-trips config documents through the Worker-native config bridge', async () => {
    const database = new AsyncFakeD1Database()
    const bucket = new FakeR2Bucket()
    const worker = createWorkerContext(database, bucket)
    const bridge = createWorkerConfigRepositoryBridge(makeConfigStorageContext(worker))

    const document: Record<string, unknown> = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: { columns: [] },
      },
      plugins: {
        'config.storage': { provider: 'cloudflare' },
      },
      showLabels: false,
    }

    await bridge.writeConfigDocument(document)
    await expect(bridge.readConfigDocument()).resolves.toEqual(document)
  })

  it('does not mutate the sync config cache before an async-only Worker write could succeed', () => {
    const database = new AsyncFakeD1Database()
    const bucket = new FakeR2Bucket()
    const worker = createWorkerContext(database, bucket)
    const configProvider = createConfigStorageProvider(makeConfigStorageContext(worker))

    expect(() => configProvider.writeConfigDocument({
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: { columns: [] },
      },
      plugins: {
        'config.storage': { provider: 'cloudflare' },
      },
      mutatedButNotPersisted: true,
    })).toThrow(/cannot synchronously await d1|worker config seam/i)

    expect(configProvider.readConfigDocument()).toEqual(worker.bootstrap.config)
  })

  it('copies, reads, appends, and materializes attachments through board-stable R2 keys', async () => {
    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const worker = createWorkerContext(database, bucket)
    const attachmentPlugin = createAttachmentStoragePlugin(worker)
    const card = makeCard()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-plugin-cloudflare-test-'))
    tempPaths.push(tempDir)
    const sourcePath = path.join(tempDir, 'spec.txt')
    await fs.writeFile(sourcePath, 'hello cloudflare', 'utf-8')

    await attachmentPlugin.copyAttachment(sourcePath, card)
    await expect(attachmentPlugin.appendAttachment?.({
      ...card,
      attachments: ['spec.txt'],
    }, 'spec.txt', ' + logs')).resolves.toBe(true)

    expect(Buffer.from(bucket.objects.get('cards/card-1/spec.txt') ?? []).toString('utf-8')).toBe('hello cloudflare + logs')

    await expect(attachmentPlugin.readAttachment?.({
      ...card,
      boardId: 'other-board',
      attachments: ['spec.txt'],
    }, 'spec.txt')).resolves.toEqual({
      data: toUint8Array('hello cloudflare + logs'),
      contentType: undefined,
    })

    const materialized = await attachmentPlugin.materializeAttachment?.({
      ...card,
      attachments: ['spec.txt'],
    }, 'spec.txt')

    expect(materialized).toBeTruthy()
    if (!materialized) {
      throw new Error('Expected attachment materialization to produce a temp path.')
    }
    await expect(fs.readFile(materialized, 'utf-8')).resolves.toBe('hello cloudflare + logs')
  })

  it('stays lazy until an operation runs and assumes no always-on background work', async () => {
    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const worker = createWorkerContext(database, bucket)

    const cardPlugin = createCardStoragePlugin(worker)
    const attachmentPlugin = createAttachmentStoragePlugin(worker)
    const stateProvider = createCardStateProvider(makeCardStateContext(worker))
    const configProvider = createConfigStorageProvider(makeConfigStorageContext(worker))
    const engine = cardPlugin.createEngine('/virtual/workspace/.kanban')

    expect(pluginManifest.capabilities['card.storage']).toEqual(['cloudflare'])
    expect(attachmentPlugin.getCardDir?.(makeCard()) ?? null).toBeNull()
    expect(database.execCount).toBe(0)
    expect(bucket.putCount).toBe(0)

    await engine.init()
    expect(database.execCount).toBe(1)

    configProvider.writeConfigDocument({ version: 2, defaultBoard: 'default', boards: { default: { columns: [] } } })
    await stateProvider.setCardState({
      actorId: 'actor-1',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { open: true },
    })

    expect(database.execCount).toBe(1)
    expect(bucket.putCount).toBe(0)
  })

  it('persists one durable event record and enqueues exactly one message per committed event', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-plugin-cloudflare-callback-producer-'))
    tempPaths.push(workspaceRoot)
    await writeCloudflareCallbackConfig(workspaceRoot, [
      {
        id: 'alpha-created',
        name: 'alpha-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'alpha',
      },
      {
        id: 'beta-created',
        name: 'beta-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'beta',
      },
      {
        id: 'disabled-inline',
        name: 'disabled-inline',
        type: 'inline',
        events: ['task.created'],
        enabled: false,
        source: '() => undefined',
      },
    ])

    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const queue = new FakeQueue()
    const worker = createWorkerContext(database, bucket, queue)
    const listener = createCallbackListenerPlugin({ workspaceRoot, worker })
    const bus = new EventBus()

    try {
      listener.register(bus)

      const payload = {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-callback-1' },
          meta: {
            callback: {
              eventId: 'cb_evt_cloudflare_producer',
              idempotencyScope: 'event-handler',
            },
          },
          timestamp: '2026-04-07T12:00:00.000Z',
        },
        timestamp: '2026-04-07T12:00:00.000Z',
      }

      bus.emit('task.created', payload)
      bus.emit('task.created', payload)

      await expect.poll(() => queue.messages.length).toBe(1)
      expect(database.callbackEventRecords.size).toBe(1)
      expect(queue.messages[0]).toEqual({
        version: 1,
        kind: 'durable-callback-event',
        eventId: 'cb_evt_cloudflare_producer',
      })

      const stored = readStoredCallbackRecord(database, 'cb_evt_cloudflare_producer')
      expect(stored.event.event).toBe('task.created')
      expect(stored.event.meta).toMatchObject({
        callback: {
          eventId: 'cb_evt_cloudflare_producer',
          idempotencyScope: 'event-handler',
        },
      })
      expect(stored.handlers.map((handler: { id: string }) => handler.id)).toEqual([
        'alpha-created',
        'beta-created',
      ])
      expect(stored.handlers.map((handler: { status: string }) => handler.status)).toEqual([
        'pending',
        'pending',
      ])
    } finally {
      listener.unregister()
    }
  })

  it('fails closed when enabled inline or process handlers are configured for the cloudflare runtime', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-plugin-cloudflare-callback-legacy-'))
    tempPaths.push(workspaceRoot)
    await writeCloudflareCallbackConfig(workspaceRoot, [
      {
        id: 'legacy-inline',
        name: 'legacy-inline',
        type: 'inline',
        events: ['task.created'],
        enabled: true,
        source: '() => undefined',
      },
      {
        id: 'module-created',
        name: 'module-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'alpha',
      },
    ])

    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const queue = new FakeQueue()
    const worker = createWorkerContext(database, bucket, queue)
    const listener = createCallbackListenerPlugin({ workspaceRoot, worker })
    const bus = new EventBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      listener.register(bus)
      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-callback-legacy' },
          timestamp: '2026-04-07T12:01:00.000Z',
        },
        timestamp: '2026-04-07T12:01:00.000Z',
      })

      await expect.poll(() => errorSpy.mock.calls.length).toBeGreaterThan(0)
      expect(queue.messages).toEqual([])
      expect(database.callbackEventRecords.size).toBe(0)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to enqueue durable callback event'),
        expect.stringContaining('Cloudflare callback.runtime only supports enabled module handlers.'),
      )
    } finally {
      listener.unregister()
      errorSpy.mockRestore()
    }
  })

  it('retries only failed handlers and skips completed ones on duplicate queue delivery', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-plugin-cloudflare-callback-consumer-'))
    tempPaths.push(workspaceRoot)
    await fs.mkdir(path.join(workspaceRoot, 'callbacks'), { recursive: true })
    await fs.writeFile(
      path.join(workspaceRoot, 'callbacks', 'runtime.cjs'),
      [
        'module.exports = {',
        '  async alpha({ callback, event, sdk }) {',
        '    const state = globalThis.__cloudflareCallbackRuntimeTest',
        '    if (!state) throw new Error("missing callback runtime test state")',
        '    state.calls.push({ label: "alpha", handlerId: callback.handlerId, eventId: callback.eventId, idempotencyKey: callback.idempotencyKey, sdkMarker: sdk.marker, eventName: event.event })',
        '    if (state.alphaFailuresRemaining > 0) {',
        '      state.alphaFailuresRemaining -= 1',
        '      throw new Error("alpha failed")',
        '    }',
        '  },',
        '  async beta({ callback, event, sdk }) {',
        '    const state = globalThis.__cloudflareCallbackRuntimeTest',
        '    if (!state) throw new Error("missing callback runtime test state")',
        '    state.calls.push({ label: "beta", handlerId: callback.handlerId, eventId: callback.eventId, idempotencyKey: callback.idempotencyKey, sdkMarker: sdk.marker, eventName: event.event })',
        '  },',
        '}',
      ].join('\n'),
      'utf8',
    )
    await writeCloudflareCallbackConfig(workspaceRoot, [
      {
        id: 'alpha-created',
        name: 'alpha-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'alpha',
      },
      {
        id: 'beta-created',
        name: 'beta-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'beta',
      },
    ])

    callbackRuntimeGlobal.__cloudflareCallbackRuntimeTest = {
      calls: [],
      alphaFailuresRemaining: 1,
    }

    const database = new FakeD1Database()
    const bucket = new FakeR2Bucket()
    const queue = new FakeQueue()
    const worker = createWorkerContext(database, bucket, queue)
    const listener = createCallbackListenerPlugin({ workspaceRoot, worker }) as ReturnType<typeof createCallbackListenerPlugin> & {
      attachRuntimeContext(context: { workspaceRoot: string; sdk: { marker: string } }): void
      consumeQueuedCallbackEvent(input: { eventId: string }): Promise<'ack' | 'retry'>
    }
    const bus = new EventBus()

    try {
      listener.attachRuntimeContext({
        workspaceRoot,
        sdk: { marker: 'sdk-from-cloudflare-test' },
      })
      listener.register(bus)
      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-callback-consumer' },
          meta: {
            callback: {
              eventId: 'cb_evt_cloudflare_consumer',
              idempotencyScope: 'event-handler',
            },
          },
          timestamp: '2026-04-07T12:02:00.000Z',
        },
        timestamp: '2026-04-07T12:02:00.000Z',
      })

      await expect.poll(() => queue.messages.length).toBe(1)

      await expect(listener.consumeQueuedCallbackEvent({ eventId: 'cb_evt_cloudflare_consumer' })).resolves.toBe('retry')

      let stored = readStoredCallbackRecord(database, 'cb_evt_cloudflare_consumer')
      expect(stored.status).toBe('retrying')
      expect(stored.handlers).toEqual([
        expect.objectContaining({ id: 'alpha-created', status: 'failed', attempts: 1, lastError: 'alpha failed' }),
        expect.objectContaining({ id: 'beta-created', status: 'completed', attempts: 1, lastError: null }),
      ])

      await expect(listener.consumeQueuedCallbackEvent({ eventId: 'cb_evt_cloudflare_consumer' })).resolves.toBe('ack')
      await expect(listener.consumeQueuedCallbackEvent({ eventId: 'cb_evt_cloudflare_consumer' })).resolves.toBe('ack')

      stored = readStoredCallbackRecord(database, 'cb_evt_cloudflare_consumer')
      expect(stored.status).toBe('completed')
      expect(stored.handlers).toEqual([
        expect.objectContaining({ id: 'alpha-created', status: 'completed', attempts: 2, lastError: null }),
        expect.objectContaining({ id: 'beta-created', status: 'completed', attempts: 1, lastError: null }),
      ])
      expect(callbackRuntimeGlobal.__cloudflareCallbackRuntimeTest?.calls.map((entry) => entry.label)).toEqual([
        'alpha',
        'beta',
        'alpha',
      ])
      expect(callbackRuntimeGlobal.__cloudflareCallbackRuntimeTest?.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'alpha',
            eventId: 'cb_evt_cloudflare_consumer',
            idempotencyKey: 'callback-event:cb_evt_cloudflare_consumer:handler:alpha-created',
            sdkMarker: 'sdk-from-cloudflare-test',
            eventName: 'task.created',
          }),
          expect.objectContaining({
            label: 'beta',
            eventId: 'cb_evt_cloudflare_consumer',
            idempotencyKey: 'callback-event:cb_evt_cloudflare_consumer:handler:beta-created',
            sdkMarker: 'sdk-from-cloudflare-test',
            eventName: 'task.created',
          }),
        ]),
      )
    } finally {
      listener.unregister()
    }
  })

  it('persists earlier handler completions before a later record write fails so replays only rerun unfinished work', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kl-plugin-cloudflare-callback-durable-'))
    tempPaths.push(workspaceRoot)
    await fs.mkdir(path.join(workspaceRoot, 'callbacks'), { recursive: true })
    await fs.writeFile(
      path.join(workspaceRoot, 'callbacks', 'runtime.cjs'),
      [
        'module.exports = {',
        '  async alpha({ callback }) {',
        '    const state = globalThis.__cloudflareCallbackRuntimeTest',
        '    if (!state) throw new Error("missing callback runtime test state")',
        '    state.calls.push({ label: "alpha", handlerId: callback.handlerId })',
        '  },',
        '  async beta({ callback }) {',
        '    const state = globalThis.__cloudflareCallbackRuntimeTest',
        '    if (!state) throw new Error("missing callback runtime test state")',
        '    state.calls.push({ label: "beta", handlerId: callback.handlerId })',
        '  },',
        '}',
      ].join('\n'),
      'utf8',
    )
    await writeCloudflareCallbackConfig(workspaceRoot, [
      {
        id: 'alpha-created',
        name: 'alpha-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'alpha',
      },
      {
        id: 'beta-created',
        name: 'beta-created',
        type: 'module',
        events: ['task.created'],
        enabled: true,
        module: './callbacks/runtime.cjs',
        handler: 'beta',
      },
    ])

    callbackRuntimeGlobal.__cloudflareCallbackRuntimeTest = {
      calls: [],
      alphaFailuresRemaining: 0,
    }

    const database = new FakeD1Database()
    let failCompletedWrite = true
    database.onBeforeUpdateCallbackEventRecord = (record) => {
      const handlers = Array.isArray(record.handlers) ? record.handlers as Array<Record<string, unknown>> : []
      if (failCompletedWrite && handlers.every((handler) => handler.status === 'completed')) {
        failCompletedWrite = false
        throw new Error('persist final callback record failed')
      }
    }
    const bucket = new FakeR2Bucket()
    const queue = new FakeQueue()
    const worker = createWorkerContext(database, bucket, queue)
    const listener = createCallbackListenerPlugin({ workspaceRoot, worker }) as ReturnType<typeof createCallbackListenerPlugin> & {
      attachRuntimeContext(context: { workspaceRoot: string; sdk: { marker: string } }): void
      consumeQueuedCallbackEvent(input: { eventId: string }): Promise<'ack' | 'retry'>
    }
    const bus = new EventBus()

    try {
      listener.attachRuntimeContext({
        workspaceRoot,
        sdk: { marker: 'sdk-from-cloudflare-test' },
      })
      listener.register(bus)
      bus.emit('task.created', {
        type: 'task.created',
        data: {
          event: 'task.created',
          data: { id: 'card-callback-durable' },
          meta: {
            callback: {
              eventId: 'cb_evt_cloudflare_durable',
              idempotencyScope: 'event-handler',
            },
          },
          timestamp: '2026-04-07T12:03:00.000Z',
        },
        timestamp: '2026-04-07T12:03:00.000Z',
      })

      await expect.poll(() => queue.messages.length).toBe(1)
      await expect(listener.consumeQueuedCallbackEvent({ eventId: 'cb_evt_cloudflare_durable' })).rejects.toThrow('persist final callback record failed')

      let stored = readStoredCallbackRecord(database, 'cb_evt_cloudflare_durable')
      expect(stored.handlers).toEqual([
        expect.objectContaining({ id: 'alpha-created', status: 'completed', attempts: 1, lastError: null }),
        expect.objectContaining({ id: 'beta-created', status: 'pending', attempts: 0, lastError: null }),
      ])

      database.onBeforeUpdateCallbackEventRecord = null
      await expect(listener.consumeQueuedCallbackEvent({ eventId: 'cb_evt_cloudflare_durable' })).resolves.toBe('ack')

      stored = readStoredCallbackRecord(database, 'cb_evt_cloudflare_durable')
      expect(stored.status).toBe('completed')
      expect(stored.handlers).toEqual([
        expect.objectContaining({ id: 'alpha-created', status: 'completed', attempts: 1, lastError: null }),
        expect.objectContaining({ id: 'beta-created', status: 'completed', attempts: 1, lastError: null }),
      ])
      expect(callbackRuntimeGlobal.__cloudflareCallbackRuntimeTest?.calls.map((entry) => entry.label)).toEqual([
        'alpha',
        'beta',
        'beta',
      ])
    } finally {
      listener.unregister()
    }
  })
})

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase()
}

function toUint8Array(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value))
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}

function createWorkerContext(
  database: unknown,
  attachments: FakeR2Bucket,
  queue: FakeQueue = new FakeQueue(),
): CloudflareWorkerProviderContext {
  const bootstrap = {
    version: 1,
    config: {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'config.storage': { provider: 'cloudflare' },
      },
    },
    topology: {
      configStorage: {
        documentId: 'workspace-config',
        provider: 'cloudflare',
        bindingHandles: {
          database: 'KANBAN_DB',
          attachments: 'KANBAN_BUCKET',
          callbacks: 'KANBAN_QUEUE',
        } as Record<string, string>,
        revisionSource: { kind: 'bootstrap' as const },
      },
    },
    budgets: {
      configFreshness: {
        steadyStateD1ReadsPerRequest: 0,
        maxReadsPerColdStartOrRefreshBoundary: 1,
      },
    },
  }

  return {
    bootstrap,
    config: bootstrap.config,
    configStorage: bootstrap.topology.configStorage,
    bindingHandles: bootstrap.topology.configStorage.bindingHandles,
    bindings: {
      KANBAN_DB: database,
      KANBAN_BUCKET: attachments,
      KANBAN_QUEUE: queue,
    },
    revision: {
      source: { kind: 'bootstrap' },
      getBinding() { return undefined },
    },
    getBinding<T = unknown>(handleName: string): T | undefined {
      const bindingName = bootstrap.topology.configStorage.bindingHandles[handleName]
      if (!bindingName) return undefined
      return this.bindings[bindingName] as T | undefined
    },
    requireBinding<T = unknown>(handleName: string): T {
      const resolved = this.getBinding<T>(handleName)
      if (resolved === undefined) {
        throw new Error(`Missing binding for ${handleName}`)
      }
      return resolved
    },
    requireD1<T = unknown>(handleName: string): T {
      return this.requireBinding<T>(handleName)
    },
    requireR2<T = unknown>(handleName: string): T {
      return this.requireBinding<T>(handleName)
    },
    requireQueue<T = unknown>(_handleName: string): T {
      return this.requireBinding<T>('callbacks')
    },
  }
}

async function writeCloudflareCallbackConfig(workspaceRoot: string, handlers: unknown[]): Promise<void> {
  await fs.writeFile(
    path.join(workspaceRoot, '.kanban.json'),
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: { handlers },
        },
      },
    }, null, 2),
    'utf8',
  )
}

function readStoredCallbackRecord(database: FakeD1Database, eventId: string): Record<string, unknown> & {
  handlers: Array<Record<string, unknown>>
  event: Record<string, unknown>
  status: string
} {
  const row = database.callbackEventRecords.get(eventId)
  if (!row) {
    throw new Error(`Expected callback event record '${eventId}' to exist.`)
  }
  return JSON.parse(row.recordJson) as Record<string, unknown> & {
    handlers: Array<Record<string, unknown>>
    event: Record<string, unknown>
    status: string
  }
}

function makeConfigStorageContext(worker: CloudflareWorkerProviderContext): ConfigStorageModuleContext {
  const workspaceRoot = `/virtual/workspace-${virtualWorkspaceCounter += 1}`
  return {
    workspaceRoot,
    documentId: 'workspace-config',
    provider: 'cloudflare',
    backend: 'external',
    worker,
  }
}

function makeCardStateContext(worker: CloudflareWorkerProviderContext): CardStateModuleContext {
  const workspaceRoot = `/virtual/workspace-${virtualWorkspaceCounter += 1}`
  return {
    workspaceRoot,
    kanbanDir: `${workspaceRoot}/.kanban`,
    provider: 'cloudflare',
    backend: 'external',
    worker,
  }
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 2,
    id: 'card-1',
    boardId: 'default',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-04-06T00:00:00.000Z',
    modified: '2026-04-06T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: 'a0',
    content: '# Cloudflare card',
    filePath: '/virtual/workspace/.kanban/boards/default/todo/card-1.md',
    ...overrides,
  }
}

function makeTask(title: string): NonNullable<Card['tasks']>[number] {
  return {
    title,
    description: '',
    checked: false,
    createdAt: '2026-04-06T00:00:00.000Z',
    modifiedAt: '2026-04-06T00:00:00.000Z',
    createdBy: 'tester',
    modifiedBy: 'tester',
  }
}

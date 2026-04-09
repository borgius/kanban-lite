import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as authPluginModule from '../../../../kl-plugin-auth/src/index'
import * as cloudflareProviderModule from '../../../../kl-plugin-cloudflare/src/index'
import {
  configToSettings,
  normalizeCallbackCapabilities,
  normalizeCardStateCapabilities,
  normalizeStorageCapabilities,
  readConfig,
  writeConfig,
} from '../../shared/config'
import type { StorageEngine } from '../../sdk/plugins/types'
import { runtimeRequire as pluginLoaderRequire } from '../../sdk/plugins/plugin-loader'
import { resolveCapabilityBag } from '../../sdk/plugins'
import { readConfigRepositoryDocument } from '../../sdk/modules/configRepository'
import { getRuntimeHost, resetRuntimeHost } from '../../shared/env'
import { createCloudflareWorkerBootstrap } from '../../sdk/env'
import {
  buildCallbackHandlerRevisionInput,
  createCloudflareCallbackQueueMessageEnvelope,
  createDurableCallbackHandlerRevision,
  KanbanSDK,
} from '../../sdk'
import { createCloudflareWorkerFetchHandler } from '../../worker'
import { createCloudflareWorkerQueueHandler } from '../../worker/queue'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workerQueueEntrypoint = path.resolve(__dirname, '../../worker/queue.ts')

type WorkerConfigWithExtraPlugins = Record<string, unknown> & {
  plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
  showLabels?: boolean
}

const tempDirs: string[] = []

class FakeCallbackD1PreparedStatement {
  constructor(
    private readonly db: FakeCallbackD1Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): FakeCallbackD1PreparedStatement {
    return new FakeCallbackD1PreparedStatement(this.db, this.query, values)
  }

  run(): { success: true; meta: { changes: number } } {
    return this.db.executeRun(this.query, this.values)
  }

  first<T = Record<string, unknown>>(): T | null {
    return (this.db.executeFirst(this.query, this.values) as T | null) ?? null
  }
}

class FakeCallbackD1Database {
  readonly callbackEventRecords = new Map<string, string>()
  execCount = 0

  exec(): { success: true } {
    this.execCount += 1
    return { success: true }
  }

  prepare(query: string): FakeCallbackD1PreparedStatement {
    return new FakeCallbackD1PreparedStatement(this, query)
  }

  executeRun(query: string, values: unknown[]): { success: true; meta: { changes: number } } {
    const normalized = normalizeCallbackQuery(query)

    if (normalized.startsWith('insert into callback_event_records')) {
      const [eventId, recordJson] = values as [string, string]
      const exists = this.callbackEventRecords.has(eventId)
      if (!exists) {
        this.callbackEventRecords.set(eventId, recordJson)
      }
      return {
        success: true,
        meta: { changes: exists && normalized.includes('do nothing') ? 0 : 1 },
      }
    }

    if (normalized.startsWith('update callback_event_records set record_json = ? where event_id = ?')) {
      const [recordJson, eventId] = values as [string, string]
      this.callbackEventRecords.set(eventId, recordJson)
      return { success: true, meta: { changes: 1 } }
    }

    throw new Error(`Unsupported callback D1 run query: ${normalized}`)
  }

  executeFirst(query: string, values: unknown[]): Record<string, unknown> | null {
    const normalized = normalizeCallbackQuery(query)

    if (normalized.includes('from callback_event_records')) {
      const [eventId] = values as [string]
      const recordJson = this.callbackEventRecords.get(eventId)
      return recordJson
        ? { event_id: eventId, record_json: recordJson }
        : null
    }

    throw new Error(`Unsupported callback D1 first query: ${normalized}`)
  }
}

class SpyQueueBinding {
  readonly messages: unknown[] = []

  async send(message: unknown): Promise<void> {
    this.messages.push(structuredClone(message))
  }
}

function readWorkerConfig(workspaceRoot: string): WorkerConfigWithExtraPlugins {
  return readConfig(workspaceRoot, {
    allowSeedFallbackOnProviderError: true,
  }) as unknown as WorkerConfigWithExtraPlugins
}

function writeWorkerConfig(workspaceRoot: string, config: WorkerConfigWithExtraPlugins): void {
  writeConfig(workspaceRoot, config as unknown as Parameters<typeof writeConfig>[1])
}

function createWorkerBootstrapConfig(): WorkerConfigWithExtraPlugins {
  return {
    version: 2,
    defaultBoard: 'default',
    boards: {
      default: {
        columns: [],
      },
    },
    plugins: {
      'config.storage': { provider: 'localfs', options: { scope: 'bootstrap' } },
    },
  } as WorkerConfigWithExtraPlugins
}

function createWorkerTestStorageEngine(kanbanDir: string): StorageEngine {
  return {
    type: 'cloudflare-worker-test',
    kanbanDir,
    async init() {},
    close() {},
    async migrate() {},
    async ensureBoardDirs() {},
    async deleteBoardData() {},
    async scanCards() { return [] },
    async writeCard() {},
    async moveCard(_card, _boardDir, newStatus) { return newStatus },
    async renameCard(_card, newFilename) { return newFilename },
    async deleteCard() {},
    getCardDir() { return `${kanbanDir}/attachments` },
    async copyAttachment() {},
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
  resetRuntimeHost()
})

describe('Cloudflare worker entrypoint', () => {
  it('bundles the queue seam for browser/workerd targets without Node-only entry imports', async () => {
    await expect(build({
      entryPoints: [workerQueueEntrypoint],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
    })).resolves.toBeDefined()
  })

  it('returns an explicit 501 for websocket upgrades', async () => {
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: '.kanban',
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
    })

    const response = await handler(new Request('https://example.test/ws', {
      headers: { Upgrade: 'websocket' },
    }))

    expect(response.status).toBe(501)
    await expect(response.text()).resolves.toContain('WebSocket upgrades are not supported')
  })

  it('serves health checks with the built-in cloudflare storage provider aliases and no explicit module registry entry', async () => {
    const workspaceRoot = '/virtual/worker-built-in-cloudflare'
    const database = new FakeCallbackD1Database()
    const bucket = {
      async put() {
        return undefined
      },
      async get() {
        return null
      },
    }

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: `${workspaceRoot}/.kanban`,
      bootstrap: createCloudflareWorkerBootstrap({
        config: {
          ...createWorkerBootstrapConfig(),
          plugins: {
            ...createWorkerBootstrapConfig().plugins,
            'card.storage': { provider: 'cloudflare' },
            'attachment.storage': { provider: 'cloudflare' },
            'config.storage': { provider: 'cloudflare' },
            'webhook.delivery': { provider: 'none' },
          },
        },
        topology: {
          configStorage: {
            bindingHandles: {
              database: 'KANBAN_DB',
              attachments: 'KANBAN_BUCKET',
            },
          },
        },
      }),
      moduleRegistry: {},
    })

    const response = await handler(new Request('https://example.test/api/health'), {
      KANBAN_DB: database,
      KANBAN_BUCKET: bucket,
    })

    expect(response.status).toBe(200)
  })

  it('serves health checks when the plugin loader runtime lacks require.resolve()', async () => {
    const workspaceRoot = '/virtual/worker-built-in-cloudflare-no-resolve'
    const database = new FakeCallbackD1Database()
    const bucket = {
      async put() {
        return undefined
      },
      async get() {
        return null
      },
    }
    const originalResolve = pluginLoaderRequire.resolve

    pluginLoaderRequire.resolve = undefined as unknown as typeof pluginLoaderRequire.resolve

    try {
      const handler = createCloudflareWorkerFetchHandler({
        kanbanDir: `${workspaceRoot}/.kanban`,
        bootstrap: createCloudflareWorkerBootstrap({
          config: {
            ...createWorkerBootstrapConfig(),
            plugins: {
              ...createWorkerBootstrapConfig().plugins,
              'card.storage': { provider: 'cloudflare' },
              'attachment.storage': { provider: 'cloudflare' },
              'config.storage': { provider: 'cloudflare' },
              'webhook.delivery': { provider: 'none' },
            },
          },
          topology: {
            configStorage: {
              bindingHandles: {
                database: 'KANBAN_DB',
                attachments: 'KANBAN_BUCKET',
              },
            },
          },
        }),
        moduleRegistry: {
          'kl-plugin-auth': authPluginModule,
        },
      })

      const response = await handler(new Request('https://example.test/api/health'), {
        KANBAN_DB: database,
        KANBAN_BUCKET: bucket,
      })

      const body = await response.text()
      const runtimeModuleAvailable = Boolean(getRuntimeHost()?.resolveExternalModule?.('kl-plugin-cloudflare'))

      if (response.status !== 200) {
        throw new Error(`status=${response.status} runtimeModuleAvailable=${runtimeModuleAvailable} body=${body}`)
      }

      expect(response.status).toBe(200)
    } finally {
      pluginLoaderRequire.resolve = originalResolve
    }
  })

  it('syncs standalone webview messages over HTTP when websocket upgrades are unavailable', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: path.join(workspaceRoot, '.kanban'),
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
    })

    const response = await handler(new Request('https://example.test/api/webview-sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { type: 'ready' },
          { type: 'openSettings' },
        ],
      }),
    }))

    expect(response.status).toBe(200)

    const body = await response.json() as {
      ok: boolean
      data: { messages: Array<Record<string, unknown>> }
    }

    expect(body.ok).toBe(true)

    const initMessages = body.data.messages.filter((message) => message.type === 'init')
    expect(initMessages.length).toBeGreaterThan(0)
    expect(initMessages.at(-1)).toMatchObject({
      type: 'init',
      cards: [],
    })
    expect(body.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'showSettings',
        settings: expect.objectContaining({
          defaultStatus: expect.any(String),
        }),
      }),
    ]))
  })

  it('fails closed during request handling when callback.runtime module handlers are missing from the Worker registry', async () => {
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: '.kanban',
      bootstrap: createCloudflareWorkerBootstrap({
        config: {
          ...createWorkerBootstrapConfig(),
          plugins: {
            ...createWorkerBootstrapConfig().plugins,
            'callback.runtime': {
              provider: 'cloudflare',
              options: {
                handlers: [
                  { id: 'missing-deliver', name: 'missing-deliver', type: 'module', module: 'callbacks/missing', handler: 'deliver', events: ['task.created'], enabled: true },
                ],
              },
            },
          },
        },
      }),
      moduleRegistry: {},
    })

    const response = await handler(new Request('https://example.test/api/settings'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('callbacks/missing'),
    })
  })

  it('does not enforce Cloudflare callback module registry rules for non-cloudflare callback providers', async () => {
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: '.kanban',
      bootstrap: createCloudflareWorkerBootstrap({
        config: {
          ...createWorkerBootstrapConfig(),
          plugins: {
            ...createWorkerBootstrapConfig().plugins,
            'callback.runtime': {
              provider: 'callbacks',
              options: {
                handlers: [
                  { id: 'missing-deliver', name: 'missing-deliver', type: 'module', module: 'callbacks/missing', handler: 'deliver', events: ['task.created'], enabled: true },
                ],
              },
            },
          },
        },
      }),
      moduleRegistry: {},
    })

    const response = await handler(new Request('https://example.test/api/settings'))

    expect(response.status).toBe(200)
  })

  it('fails closed during request handling when callback.runtime module exports are not callable', async () => {
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: '.kanban',
      bootstrap: createCloudflareWorkerBootstrap({
        config: {
          ...createWorkerBootstrapConfig(),
          plugins: {
            ...createWorkerBootstrapConfig().plugins,
            'callback.runtime': {
              provider: 'cloudflare',
              options: {
                handlers: [
                  { id: 'not-callable-deliver', name: 'not-callable-deliver', type: 'module', module: 'callbacks/not-callable', handler: 'deliver', events: ['task.created'], enabled: true },
                ],
              },
            },
          },
        },
      }),
      moduleRegistry: {
        'callbacks/not-callable': {
          deliver: 'not-a-function',
        },
      },
    })

    const response = await handler(new Request('https://example.test/api/settings'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('callable'),
    })
  })

  it('allows mutable config writes that preserve the bootstrap topology', async () => {
    const workspaceRoot = '/virtual/worker-workspace'
    const writes: WorkerConfigWithExtraPlugins[] = []
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: `${workspaceRoot}/.kanban`,
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
      runtimeHost: {
        writeConfig(root, _filePath, nextConfig) {
          expect(root).toBe(workspaceRoot)
          writes.push(nextConfig as unknown as WorkerConfigWithExtraPlugins)
          return true
        },
      },
    })

    await handler(new Request('https://example.test/'))

    const nextConfig: WorkerConfigWithExtraPlugins = {
      ...readWorkerConfig(workspaceRoot),
      showLabels: false,
    }
    writeWorkerConfig(workspaceRoot, nextConfig)

    expect(writes).toHaveLength(1)
    expect(readWorkerConfig(workspaceRoot).showLabels).toBe(false)
  })

  it('clones cached bootstrap config on read and write so warm-isolate mutations do not leak', async () => {
    const workspaceRoot = '/virtual/worker-workspace-clone'
    const writes: WorkerConfigWithExtraPlugins[] = []
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: `${workspaceRoot}/.kanban`,
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
      runtimeHost: {
        writeConfig(_root, _filePath, nextConfig) {
          writes.push(nextConfig as unknown as WorkerConfigWithExtraPlugins)
          return true
        },
      },
    })

    await handler(new Request('https://example.test/'))

    const firstRead = readWorkerConfig(workspaceRoot)
    firstRead.showLabels = false
    ;(((firstRead.plugins?.['config.storage']?.options ?? {}) as Record<string, unknown>)).scope = 'mutated-read'

    const secondRead = readWorkerConfig(workspaceRoot)
    expect(secondRead.showLabels).toBe(true)
    expect(secondRead.plugins?.['config.storage']?.options).toEqual({ scope: 'bootstrap' })

    const nextConfig = readWorkerConfig(workspaceRoot)
    nextConfig.showLabels = false
    writeWorkerConfig(workspaceRoot, nextConfig)
    nextConfig.showLabels = true
    ;(((nextConfig.plugins?.['config.storage']?.options ?? {}) as Record<string, unknown>)).scope = 'mutated-caller'

    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toBe(nextConfig)
    expect(writes[0].showLabels).toBe(false)
    expect(writes[0].plugins?.['config.storage']?.options).toEqual({ scope: 'bootstrap' })
    expect(readWorkerConfig(workspaceRoot).showLabels).toBe(false)
    expect(readWorkerConfig(workspaceRoot).plugins?.['config.storage']?.options).toEqual({ scope: 'bootstrap' })
  })

  it('clones upstream runtime-host config reads before exposing them', async () => {
    const workspaceRoot = '/virtual/worker-workspace-upstream'
    const upstreamConfig = createWorkerBootstrapConfig()
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: `${workspaceRoot}/.kanban`,
      runtimeHost: {
        readConfig(root) {
          expect(root).toBe(workspaceRoot)
          return upstreamConfig
        },
      },
    })

    await handler(new Request('https://example.test/'))

    const firstRead = readWorkerConfig(workspaceRoot)
    firstRead.showLabels = false
    ;(((firstRead.plugins?.['config.storage']?.options ?? {}) as Record<string, unknown>)).scope = 'mutated-read'

    expect(upstreamConfig.showLabels).toBeUndefined()
    expect(upstreamConfig.plugins?.['config.storage']?.options).toEqual({ scope: 'bootstrap' })

    const secondRead = readWorkerConfig(workspaceRoot)
    expect(secondRead.showLabels).toBe(true)
    expect(secondRead.plugins?.['config.storage']?.options).toEqual({ scope: 'bootstrap' })
  })

  it('rejects live config writes that change the bootstrap-owned config.storage provider', async () => {
    const workspaceRoot = '/virtual/worker-workspace-reject'
    const writeSpy = vi.fn(() => true)
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: `${workspaceRoot}/.kanban`,
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
      runtimeHost: {
        writeConfig: writeSpy,
      },
    })

    await handler(new Request('https://example.test/'))

    const currentConfig = readWorkerConfig(workspaceRoot)
    const nextConfig: WorkerConfigWithExtraPlugins = {
      ...currentConfig,
      plugins: {
        ...(currentConfig.plugins ?? {}),
        'config.storage': { provider: 'sqlite' },
      },
    }

    expect(() => writeWorkerConfig(workspaceRoot, nextConfig)).toThrow(/topology|redeploy/i)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('rejects live config writes that change the bootstrap-owned callback.runtime enabled module handler set', async () => {
    const workspaceRoot = '/virtual/worker-callback-runtime-reject'
    const writeSpy = vi.fn(() => true)
    const bootstrapConfig: WorkerConfigWithExtraPlugins = {
      ...createWorkerBootstrapConfig(),
      plugins: {
        ...createWorkerBootstrapConfig().plugins,
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: true },
              { id: 'worker-skip', name: 'worker-skip', type: 'module', module: 'callbacks/ignored', handler: 'skipMe', events: ['task.created'], enabled: false },
            ],
          },
        },
      },
    }
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir: `${workspaceRoot}/.kanban`,
      bootstrap: createCloudflareWorkerBootstrap({ config: bootstrapConfig }),
      runtimeHost: {
        writeConfig: writeSpy,
      },
      moduleRegistry: {
        'callbacks/worker': {
          deliver() {
            return undefined
          },
        },
      },
    })

    await handler(new Request('https://example.test/'))

    const nextConfig: WorkerConfigWithExtraPlugins = {
      ...bootstrapConfig,
      plugins: {
        ...(bootstrapConfig.plugins ?? {}),
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliverChanged', events: ['task.created'], enabled: true },
            ],
          },
        },
      },
    }

    expect(() => writeWorkerConfig(workspaceRoot, nextConfig)).toThrow(/callback\.runtime|redeploy/i)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('passes a typed worker binding context into Worker-safe provider factories', async () => {
    const workspaceRoot = '/virtual/worker-provider-context'
    const kanbanDir = `${workspaceRoot}/.kanban`
    const database = { kind: 'd1' }
    const bucket = { kind: 'r2' }
    const queue = { kind: 'queue' }
    const revisionBinding = { current: 'rev-7' }
    const calls: Array<Record<string, unknown>> = []
    const providerId = 'cloudflare-worker-test'
    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: {
          ...createWorkerBootstrapConfig(),
          plugins: {
            ...createWorkerBootstrapConfig().plugins,
            'card.storage': { provider: providerId },
            'attachment.storage': { provider: providerId },
            'card.state': { provider: providerId },
            'callback.runtime': { provider: providerId },
            'config.storage': { provider: 'cloudflare' },
          },
        },
        topology: {
          configStorage: {
            bindingHandles: {
              database: 'KANBAN_DB',
              attachments: 'KANBAN_BUCKET',
              callbacks: 'KANBAN_QUEUE',
            },
            revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
          },
        },
      }),
      moduleRegistry: {
        [providerId]: {
          createCardStoragePlugin(context: {
            configStorage: { provider: string }
            bindingHandles: Record<string, string>
            requireD1: (name: string) => unknown
            requireR2: (name: string) => unknown
            requireQueue: (name: string) => unknown
            revision: { getBinding: () => unknown }
          }) {
            calls.push({
              kind: 'card.storage',
              provider: context.configStorage.provider,
              bindingHandles: context.bindingHandles,
              database: context.requireD1('database'),
              attachments: context.requireR2('attachments'),
              callbacks: context.requireQueue('callbacks'),
              revision: context.revision.getBinding(),
            })
            return {
              manifest: { id: providerId, provides: ['card.storage'] },
              createEngine(dir: string) {
                return createWorkerTestStorageEngine(dir)
              },
              nodeCapabilities: {
                isFileBacked: false,
                getLocalCardPath() { return null },
                getWatchGlob() { return null },
              },
            }
          },
          createAttachmentStoragePlugin(context: {
            requireR2: (name: string) => unknown
            requireQueue: (name: string) => unknown
          }) {
            calls.push({
              kind: 'attachment.storage',
              attachments: context.requireR2('attachments'),
              callbacks: context.requireQueue('callbacks'),
            })
            return {
              manifest: { id: providerId, provides: ['attachment.storage'] },
              async copyAttachment() {},
              async materializeAttachment() { return null },
            }
          },
          createCardStateProvider(context: {
            provider: string
            worker?: {
              requireD1: (name: string) => unknown
              requireQueue: (name: string) => unknown
              revision: { getBinding: () => unknown }
            } | null
          }) {
            calls.push({
              kind: 'card.state',
              provider: context.provider,
              database: context.worker?.requireD1('database'),
              callbacks: context.worker?.requireQueue('callbacks'),
              revision: context.worker?.revision.getBinding(),
            })
            return {
              manifest: { id: providerId, provides: ['card.state'] },
              async getCardState() { return null },
              async setCardState(input: { actorId: string; boardId: string; cardId: string; domain: string; value: Record<string, unknown>; updatedAt?: string }) {
                return {
                  ...input,
                  updatedAt: input.updatedAt ?? '2026-04-06T00:00:00.000Z',
                }
              },
              async getUnreadCursor() { return null },
              async markUnreadReadThrough(input: { actorId: string; boardId: string; cardId: string; cursor: Record<string, unknown> & { updatedAt?: string } }) {
                return {
                  actorId: input.actorId,
                  boardId: input.boardId,
                  cardId: input.cardId,
                  domain: 'unread',
                  value: input.cursor,
                  updatedAt: input.cursor.updatedAt ?? '2026-04-06T00:00:00.000Z',
                }
              },
            }
          },
          createCallbackListenerPlugin(context: {
            workspaceRoot: string
            worker: { requireQueue: (name: string) => unknown } | null
          }) {
            calls.push({
              kind: 'callback.runtime',
              workspaceRoot: context.workspaceRoot,
              callbacks: context.worker?.requireQueue('callbacks'),
            })
            return {
              manifest: { id: `${providerId}:callback`, provides: ['event.listener'] },
              register() {},
              unregister() {},
            }
          },
        },
      },
    })

    await handler(new Request('https://example.test/'), {
      KANBAN_DB: database,
      KANBAN_BUCKET: bucket,
      KANBAN_QUEUE: queue,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    const config = readWorkerConfig(workspaceRoot)
    const bag = resolveCapabilityBag(
      normalizeStorageCapabilities(config as Parameters<typeof normalizeStorageCapabilities>[0]),
      kanbanDir,
      undefined,
      undefined,
      normalizeCardStateCapabilities(config as Parameters<typeof normalizeCardStateCapabilities>[0]),
      normalizeCallbackCapabilities(config as Parameters<typeof normalizeCallbackCapabilities>[0]),
    )

    try {
      expect(bag.cardStateContext.worker?.requireD1('database')).toBe(database)
      expect(bag.cardStateContext.worker?.requireQueue('callbacks')).toBe(queue)
      expect(bag.callbackListener).not.toBeNull()
      expect(calls).toEqual(expect.arrayContaining([
        {
          kind: 'card.storage',
          provider: 'cloudflare',
          bindingHandles: {
            database: 'KANBAN_DB',
            attachments: 'KANBAN_BUCKET',
            callbacks: 'KANBAN_QUEUE',
          },
          database,
          attachments: bucket,
          callbacks: queue,
          revision: revisionBinding,
        },
        {
          kind: 'attachment.storage',
          attachments: bucket,
          callbacks: queue,
        },
        {
          kind: 'card.state',
          provider: providerId,
          database,
          callbacks: queue,
          revision: revisionBinding,
        },
        {
          kind: 'callback.runtime',
          workspaceRoot,
          callbacks: queue,
        },
      ]))
    } finally {
      bag.cardStorage.close()
    }
  })

  it('routes config repository reads and writes through Worker-safe config.storage providers', async () => {
    const workspaceRoot = '/virtual/worker-config-storage-provider'
    const kanbanDir = `${workspaceRoot}/.kanban`
    const database = { kind: 'd1' }
    const revisionBinding = { current: 'rev-8' }
    const configStorageProviderId = 'cloudflare-config-test'
    const calls: Array<Record<string, unknown>> = []
    const writes: WorkerConfigWithExtraPlugins[] = []
    let remoteConfig: WorkerConfigWithExtraPlugins = {
      ...createWorkerBootstrapConfig(),
      showLabels: false,
      customField: { preserved: true },
      plugins: {
        'config.storage': {
          provider: configStorageProviderId,
          options: { region: 'test' },
        },
      },
    }

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: remoteConfig,
        topology: {
          configStorage: {
            bindingHandles: { database: 'KANBAN_DB' },
            revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
          },
        },
      }),
      moduleRegistry: {
        [configStorageProviderId]: {
          createWorkerConfigRepositoryBridge(context: {
            workspaceRoot: string
            documentId: string
            provider: string
            backend: string
            options?: Record<string, unknown>
            worker?: {
              requireD1: (name: string) => unknown
              revision: { getBinding: () => unknown }
            } | null
          }) {
            calls.push({
              kind: 'bridge.factory',
              workspaceRoot: context.workspaceRoot,
              documentId: context.documentId,
              provider: context.provider,
              backend: context.backend,
              options: context.options,
              database: context.worker?.requireD1('database'),
              revision: context.worker?.revision.getBinding(),
            })
            return {
              async readConfigDocument() {
                calls.push({ kind: 'bridge.read' })
                return structuredClone(remoteConfig)
              },
              async writeConfigDocument(nextDocument: Record<string, unknown>) {
                const cloned = structuredClone(nextDocument) as WorkerConfigWithExtraPlugins
                calls.push({ kind: 'bridge.write', showLabels: cloned.showLabels })
                writes.push(cloned)
                remoteConfig = cloned
              },
            }
          },
        },
      },
    })

    await handler(new Request('https://example.test/'), {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    const readResult = readConfigRepositoryDocument(workspaceRoot)
    expect(readResult).toMatchObject({ status: 'ok' })
    const currentConfig = (readResult.status === 'ok' ? readResult.value : {}) as WorkerConfigWithExtraPlugins
    expect(currentConfig.showLabels).toBe(false)
    expect(currentConfig.customField).toEqual({ preserved: true })
    expect(calls).toEqual(expect.arrayContaining([
      {
        kind: 'bridge.factory',
        workspaceRoot,
        documentId: 'workspace-config',
        provider: configStorageProviderId,
        backend: 'external',
        options: { region: 'test' },
        database,
        revision: revisionBinding,
      },
      { kind: 'bridge.read' },
    ]))

    const settingsResponse = await handler(new Request('https://example.test/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...configToSettings(readWorkerConfig(workspaceRoot)),
        showLabels: true,
      }),
    }), {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    expect(settingsResponse.status).toBe(200)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      showLabels: true,
      customField: { preserved: true },
      plugins: {
        'config.storage': {
          provider: configStorageProviderId,
          options: { region: 'test' },
        },
      },
    })
    const finalReadResult = readConfigRepositoryDocument(workspaceRoot)
    expect(finalReadResult).toMatchObject({ status: 'ok' })
    expect(finalReadResult.status === 'ok' ? finalReadResult.value.showLabels : undefined).toBe(true)
    expect(calls).toEqual(expect.arrayContaining([
      { kind: 'bridge.write', showLabels: true },
    ]))
  })

  it('fails closed during request handling when a new Worker config revision cannot be refreshed', async () => {
    const workspaceRoot = '/virtual/worker-config-refresh-failure'
    const kanbanDir = `${workspaceRoot}/.kanban`
    const database = { kind: 'd1' }
    const revisionBinding = { current: 'rev-10' }
    const configStorageProviderId = 'cloudflare-config-refresh-failure'
    let failNextRead = false
    let remoteConfig: WorkerConfigWithExtraPlugins = {
      ...createWorkerBootstrapConfig(),
      showLabels: false,
      plugins: {
        'config.storage': {
          provider: configStorageProviderId,
        },
      },
    }

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: remoteConfig,
        topology: {
          configStorage: {
            bindingHandles: { database: 'KANBAN_DB' },
            revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
          },
        },
      }),
      moduleRegistry: {
        [configStorageProviderId]: {
          createWorkerConfigRepositoryBridge() {
            return {
              async readConfigDocument() {
                if (failNextRead) {
                  throw new Error('config refresh failed')
                }
                return structuredClone(remoteConfig)
              },
              async writeConfigDocument(nextDocument: Record<string, unknown>) {
                remoteConfig = structuredClone(nextDocument) as WorkerConfigWithExtraPlugins
              },
            }
          },
        },
      },
    })

    const initialResponse = await handler(new Request('https://example.test/api/settings'), {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    expect(initialResponse.status).toBe(200)

    failNextRead = true
    revisionBinding.current = 'rev-11'

    const failedRefreshResponse = await handler(new Request('https://example.test/api/settings'), {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    expect(failedRefreshResponse.status).toBe(500)
    await expect(failedRefreshResponse.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('config refresh failed'),
    })
  })

  it('keeps request-local Worker config writes isolated until the async bridge commit succeeds', async () => {
    const workspaceRoot = '/virtual/worker-config-request-isolation'
    const kanbanDir = `${workspaceRoot}/.kanban`
    const database = { kind: 'd1' }
    const revisionBinding = { current: 'rev-9' }
    const configStorageProviderId = 'cloudflare-config-isolation'
    let remoteConfig: WorkerConfigWithExtraPlugins = {
      ...createWorkerBootstrapConfig(),
      showLabels: false,
      plugins: {
        'config.storage': {
          provider: configStorageProviderId,
        },
      },
    }
    let resolveWrite!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    let releaseWrite!: () => void
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: remoteConfig,
        topology: {
          configStorage: {
            bindingHandles: { database: 'KANBAN_DB' },
            revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
          },
        },
      }),
      moduleRegistry: {
        [configStorageProviderId]: {
          createWorkerConfigRepositoryBridge() {
            return {
              async readConfigDocument() {
                return structuredClone(remoteConfig)
              },
              async writeConfigDocument(nextDocument: Record<string, unknown>) {
                resolveWrite()
                await writeRelease
                remoteConfig = structuredClone(nextDocument) as WorkerConfigWithExtraPlugins
              },
            }
          },
        },
      },
    })

    await handler(new Request('https://example.test/'), {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    const pendingResponse = handler(new Request('https://example.test/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...configToSettings(readWorkerConfig(workspaceRoot)),
        showLabels: true,
      }),
    }), {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })

    await writeStarted

    const beforeCommit = readConfigRepositoryDocument(workspaceRoot)
    expect(beforeCommit).toMatchObject({ status: 'ok' })
    expect(beforeCommit.status === 'ok' ? beforeCommit.value.showLabels : undefined).toBe(false)

    releaseWrite()
    const response = await pendingResponse
    expect(response.status).toBe(200)

    const afterCommit = readConfigRepositoryDocument(workspaceRoot)
    expect(afterCommit).toMatchObject({ status: 'ok' })
    expect(afterCommit.status === 'ok' ? afterCommit.value.showLabels : undefined).toBe(true)
  })

  it('parses compact durable callback queue envelopes and delivers them through the cloudflare callback provider', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const database = new FakeCallbackD1Database()
    const callbackQueue = new SpyQueueBinding()
    const deliveries: Array<Record<string, unknown>> = []

    writeWorkerConfig(workspaceRoot, {
      ...createWorkerBootstrapConfig(),
      plugins: {
        ...createWorkerBootstrapConfig().plugins,
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: true },
            ],
          },
        },
      },
    })
    await seedCloudflareDurableCallbackEvent({
      workspaceRoot,
      database,
      queue: callbackQueue,
      eventId: 'cb_evt_worker_queue_success',
      handler: { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: true },
    })

    const queueHandler = createCloudflareWorkerQueueHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: readWorkerConfig(workspaceRoot),
        topology: {
          configStorage: {
            bindingHandles: {
              database: 'KANBAN_DB',
              callbacks: 'KANBAN_QUEUE',
            },
          },
        },
      }),
      moduleRegistry: {
        'callbacks/worker': {
          async deliver({ callback, event }: { callback: { eventId: string; handlerId: string; idempotencyKey: string }; event: { event: string } }) {
            deliveries.push({
              eventId: callback.eventId,
              handlerId: callback.handlerId,
              idempotencyKey: callback.idempotencyKey,
              eventName: event.event,
            })
          },
        },
        'kl-plugin-cloudflare': cloudflareProviderModule,
      },
      sdkModule: { KanbanSDK },
    })
    const ack = vi.fn()
    const retry = vi.fn()

    await expect(queueHandler({
      messages: [
        {
          id: 'msg-1',
          body: callbackQueue.messages[0],
          ack,
          retry,
        },
      ],
    }, {
      KANBAN_DB: database,
      KANBAN_QUEUE: callbackQueue,
    })).resolves.toBeUndefined()

    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(deliveries).toEqual([
      {
        eventId: 'cb_evt_worker_queue_success',
        handlerId: 'worker-deliver',
        idempotencyKey: 'callback-event:cb_evt_worker_queue_success:handler:worker-deliver',
        eventName: 'task.created',
      },
    ])
  })

  it('fails closed when a refreshed callback.runtime module handler set diverges from the bootstrap deploy registry', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const database = new FakeCallbackD1Database()
    const callbackQueue = new SpyQueueBinding()
    const revisionBinding = { current: 'rev-20' }
    const configStorageProviderId = 'cloudflare-callback-drift'
    const bootstrapConfig: WorkerConfigWithExtraPlugins = {
      ...createWorkerBootstrapConfig(),
      plugins: {
        'config.storage': {
          provider: configStorageProviderId,
        },
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: true },
            ],
          },
        },
      },
    }
    let remoteConfig: WorkerConfigWithExtraPlugins = structuredClone(bootstrapConfig)
    writeWorkerConfig(workspaceRoot, {
      ...createWorkerBootstrapConfig(),
      plugins: {
        ...createWorkerBootstrapConfig().plugins,
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: true },
            ],
          },
        },
      },
    })
    await seedCloudflareDurableCallbackEvent({
      workspaceRoot,
      database,
      queue: callbackQueue,
      eventId: 'cb_evt_worker_queue_drift',
      handler: { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: true },
    })
    const queueHandler = createCloudflareWorkerQueueHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: bootstrapConfig,
        topology: {
          configStorage: {
            bindingHandles: { database: 'KANBAN_DB', callbacks: 'KANBAN_QUEUE' },
            revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
          },
        },
      }),
      moduleRegistry: {
        'callbacks/worker': {
          deliver() {
            return undefined
          },
        },
        'kl-plugin-cloudflare': cloudflareProviderModule,
        [configStorageProviderId]: {
          createWorkerConfigRepositoryBridge() {
            return {
              async readConfigDocument() {
                return structuredClone(remoteConfig)
              },
              async writeConfigDocument(nextDocument: Record<string, unknown>) {
                remoteConfig = structuredClone(nextDocument) as WorkerConfigWithExtraPlugins
              },
            }
          },
        },
      },
      sdkModule: { KanbanSDK },
    })
    const batch = {
      messages: [
        {
          id: 'msg-1',
          body: callbackQueue.messages[0],
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
    }

    await expect(queueHandler(batch, {
      KANBAN_DB: database,
      KANBAN_QUEUE: callbackQueue,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })).resolves.toBeUndefined()

    remoteConfig = {
      ...bootstrapConfig,
      plugins: {
        ...(bootstrapConfig.plugins ?? {}),
        'config.storage': {
          provider: configStorageProviderId,
        },
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'worker-deliver', name: 'worker-deliver', type: 'module', module: 'callbacks/worker', handler: 'deliver', events: ['task.created'], enabled: false },
            ],
          },
        },
      },
    }
    revisionBinding.current = 'rev-21'

    await expect(queueHandler(batch, {
      KANBAN_DB: database,
      KANBAN_QUEUE: callbackQueue,
      KANBAN_CONFIG_REVISION: revisionBinding,
    })).rejects.toThrow(/callback\.runtime|bootstrap|redeploy/i)
  })
})

function normalizeCallbackQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase()
}

function createTempWorkspaceRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-worker-callback-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

async function seedCloudflareDurableCallbackEvent(input: {
  workspaceRoot: string
  database: FakeCallbackD1Database
  queue: SpyQueueBinding
  eventId: string
  handler: {
    id: string
    name: string
    type: 'module'
    module: string
    handler: string
    events: string[]
    enabled: boolean
  }
}): Promise<void> {
  const timestamp = '2026-04-07T13:00:00.000Z'
  input.database.callbackEventRecords.set(input.eventId, JSON.stringify({
    version: 1,
    eventId: input.eventId,
    event: {
      event: 'task.created',
      data: { id: 'card-worker-test' },
      meta: {
        callback: {
          eventId: input.eventId,
          idempotencyScope: 'event-handler',
        },
      },
      timestamp,
    },
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    handlers: [
      {
        id: input.handler.id,
        name: input.handler.name,
        module: input.handler.module,
        handler: input.handler.handler,
        handlerRevision: createDurableCallbackHandlerRevision(buildCallbackHandlerRevisionInput(input.handler)),
        status: 'pending',
        attempts: 0,
        lastError: null,
        lastAttemptAt: null,
        completedAt: null,
      },
    ],
  }))
  await input.queue.send(createCloudflareCallbackQueueMessageEnvelope(input.eventId))
}

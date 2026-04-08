import { describe, expect, it } from 'vitest'
import {
  assertCloudflareCallbackModuleRegistry,
  collectCloudflareCallbackModuleRegistryEntries,
  createCloudflareCallbackQueueMessageEnvelope,
  hasCloudflareCallbackModuleHandlers,
  parseCloudflareCallbackQueueMessageEnvelope,
} from '../sdk'
import {
  type CloudflareWorkerBootstrapConfig,
  CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
  CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET,
  createCloudflareWorkerBootstrap,
  createCloudflareWorkerProviderContext,
  inferCloudflareWorkerConfigStorageProvider,
  resolveCloudflareWorkerBootstrapInput,
  resolveCloudflareWorkerBootstrap,
} from '../sdk/env'

describe('Cloudflare worker bootstrap contract', () => {
  it('derives the bootstrap-owned config.storage provider and request budget without a remote config read', () => {
    const config: CloudflareWorkerBootstrapConfig = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'config.storage': { provider: 'cloudflare' },
      },
    }

    const bootstrap = createCloudflareWorkerBootstrap({
      config,
      topology: {
        configStorage: {
          bindingHandles: { database: 'KANBAN_DB' },
          revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
        },
      },
    })

    expect(bootstrap).toEqual({
      version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
      config,
      topology: {
        configStorage: {
          documentId: 'workspace-config',
          provider: 'cloudflare',
          bindingHandles: { database: 'KANBAN_DB' },
          revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
        },
      },
      budgets: {
        configFreshness: CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET,
      },
    })
    expect(inferCloudflareWorkerConfigStorageProvider(config)).toBe('cloudflare')
  })

  it('rejects request budgets that would add per-request D1 freshness probes', () => {
    expect(() => resolveCloudflareWorkerBootstrap({
      version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
      },
      topology: {
        configStorage: {
          documentId: 'workspace-config',
          provider: 'localfs',
          bindingHandles: {},
          revisionSource: { kind: 'bootstrap' },
        },
      },
      budgets: {
        configFreshness: {
          steadyStateD1ReadsPerRequest: 1,
          maxReadsPerColdStartOrRefreshBoundary: 2,
        },
      },
    })).toThrow(/steady-state|D1/i)
  })

  it('parses a serialized shared bootstrap envelope for runtime bootstrap', () => {
    const config: CloudflareWorkerBootstrapConfig = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      storageEngine: 'sqlite',
    }

    expect(resolveCloudflareWorkerBootstrap(JSON.stringify(
      createCloudflareWorkerBootstrap({ config }),
    ))).toEqual(
      createCloudflareWorkerBootstrap({ config }),
    )
  })

  it('trims bootstrap-owned topology strings when resolving shared worker bootstrap input', () => {
    const config: CloudflareWorkerBootstrapConfig = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'config.storage': { provider: 'cloudflare' },
      },
    }

    expect(resolveCloudflareWorkerBootstrapInput(JSON.stringify({
      version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
      config,
      topology: {
        configStorage: {
          documentId: ' workspace-config ',
          provider: 'cloudflare',
          bindingHandles: {
            database: ' KANBAN_DB ',
            attachments: ' KANBAN_BUCKET ',
          },
          revisionSource: { kind: 'binding', binding: ' KANBAN_CONFIG_REVISION ' },
        },
      },
      budgets: {
        configFreshness: CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET,
      },
    }), undefined)).toEqual({
      version: CLOUDFLARE_WORKER_BOOTSTRAP_VERSION,
      config,
      topology: {
        configStorage: {
          documentId: 'workspace-config',
          provider: 'cloudflare',
          bindingHandles: {
            database: 'KANBAN_DB',
            attachments: 'KANBAN_BUCKET',
          },
          revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
        },
      },
      budgets: {
        configFreshness: CLOUDFLARE_WORKER_CONFIG_FRESHNESS_BUDGET,
      },
    })
  })

  it('prefers raw bootstrap input over raw config input', () => {
    const config: CloudflareWorkerBootstrapConfig = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      storageEngine: 'sqlite',
    }
    const bootstrap = createCloudflareWorkerBootstrap({ config })

    expect(resolveCloudflareWorkerBootstrapInput(JSON.stringify(bootstrap), '{')).toEqual(bootstrap)
  })

  it('builds a bootstrap from config-only worker input when no raw bootstrap is present', () => {
    const config: CloudflareWorkerBootstrapConfig = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      storageEngine: 'sqlite',
    }

    expect(resolveCloudflareWorkerBootstrapInput(undefined, JSON.stringify(config))).toEqual(
      createCloudflareWorkerBootstrap({ config }),
    )
  })

  it('creates a provider context that resolves D1, R2, Queue, and revision bindings from the shared bootstrap contract', () => {
    const database = { kind: 'd1' }
    const bucket = { kind: 'r2' }
    const queue = { kind: 'queue' }
    const revision = { current: 'rev-7' }
    const bootstrap = createCloudflareWorkerBootstrap({
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
          bindingHandles: {
            database: 'KANBAN_DB',
            attachments: 'KANBAN_BUCKET',
            callbacks: 'KANBAN_QUEUE',
          },
          revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
        },
      },
    })

    const context = createCloudflareWorkerProviderContext(bootstrap, {
      KANBAN_DB: database,
      KANBAN_BUCKET: bucket,
      KANBAN_QUEUE: queue,
      KANBAN_CONFIG_REVISION: revision,
    })

    expect(context.config).toEqual(bootstrap.config)
    expect(context.configStorage).toEqual(bootstrap.topology.configStorage)
    expect(context.bindingHandles).toEqual({
      database: 'KANBAN_DB',
      attachments: 'KANBAN_BUCKET',
      callbacks: 'KANBAN_QUEUE',
    })
    expect(context.bindings).toEqual({
      database,
      attachments: bucket,
      callbacks: queue,
    })
    expect(context.requireD1('database')).toBe(database)
    expect(context.requireR2('attachments')).toBe(bucket)
    expect(context.requireQueue('callbacks')).toBe(queue)
    expect(context.revision.source).toEqual({ kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' })
    expect(context.revision.getBinding()).toBe(revision)
  })

  it('collects callback.runtime module handlers into a shared registry contract and encodes compact queue envelopes', () => {
    const config = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'deliver-alpha', name: 'deliver-alpha', type: 'module', module: 'callbacks/alpha', handler: 'deliverAlpha', events: ['task.created'], enabled: true },
              { id: 'deliver-beta', name: 'deliver-beta', type: 'module', module: 'callbacks/alpha', handler: 'deliverBeta', events: ['task.created'] },
              { id: 'skip-me', name: 'skip-me', type: 'module', module: 'callbacks/disabled', handler: 'skipMe', events: ['task.created'], enabled: false },
              { id: 'legacy-inline', name: 'legacy-inline', type: 'inline', source: 'async () => null', events: ['task.created'], enabled: false },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>

    expect(collectCloudflareCallbackModuleRegistryEntries(config)).toEqual([
      {
        module: 'callbacks/alpha',
        handlers: ['deliverAlpha', 'deliverBeta'],
      },
    ])

    const envelope = createCloudflareCallbackQueueMessageEnvelope('evt_callback_123')
    expect(envelope).toEqual({
      version: 1,
      kind: 'durable-callback-event',
      eventId: 'evt_callback_123',
    })
    expect(parseCloudflareCallbackQueueMessageEnvelope(envelope)).toEqual(envelope)
    expect(parseCloudflareCallbackQueueMessageEnvelope({ ...envelope, eventId: '' })).toBeNull()
  })

  it('ignores module rows unless callback.runtime explicitly selects the cloudflare provider', () => {
    const config = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'callback.runtime': {
          provider: 'callbacks',
          options: {
            handlers: [
              { id: 'node-only-deliver', name: 'node-only-deliver', type: 'module', module: 'callbacks/node-only', handler: 'deliver', events: ['task.created'], enabled: true },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>

    expect(hasCloudflareCallbackModuleHandlers(config)).toBe(false)
    expect(collectCloudflareCallbackModuleRegistryEntries(config)).toEqual([])
  })

  it('fails closed when enabled cloudflare module rows omit module or handler', () => {
    const config = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { type: 'module', handler: 'deliver', enabled: true },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>

    expect(() => collectCloudflareCallbackModuleRegistryEntries(config)).toThrow(
      'Enabled Cloudflare callback.runtime module handler at index 0 requires non-empty module and handler strings.',
    )
  })

  it('fails closed when configured callback.runtime module handlers are missing from the shared Worker registry', () => {
    const config = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'missing-deliver', name: 'missing-deliver', type: 'module', module: 'callbacks/missing', handler: 'deliver', events: ['task.created'] },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>

    expect(() => assertCloudflareCallbackModuleRegistry(config, {})).toThrow(/not available/i)
    expect(() => assertCloudflareCallbackModuleRegistry(config, {
      'callbacks/missing': { deliver: 'not-callable' },
    })).toThrow(/callable named handler 'deliver'/i)
  })

  it('requires callback handler exports to be own properties rather than inherited prototype methods', () => {
    const config = {
      version: 2,
      defaultBoard: 'default',
      boards: { default: { columns: [] } },
      plugins: {
        'callback.runtime': {
          provider: 'cloudflare',
          options: {
            handlers: [
              { id: 'inherited-deliver', name: 'inherited-deliver', type: 'module', module: 'callbacks/inherited', handler: 'deliver', events: ['task.created'] },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>

    const inheritedOnly = Object.create({
      deliver() {
        return undefined
      },
    }) as Record<string, unknown>

    expect(() => assertCloudflareCallbackModuleRegistry(config, {
      'callbacks/inherited': inheritedOnly,
    })).toThrow(/callable named handler 'deliver'/i)
  })
})

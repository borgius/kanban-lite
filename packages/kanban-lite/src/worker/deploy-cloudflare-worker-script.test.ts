import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../../../../')
const deployScriptPath = pathToFileURL(path.join(repoRoot, 'scripts', 'deploy-cloudflare-worker.mjs')).href

const tempDirs: string[] = []

function loadDeployCloudflareWorkerScript(): Promise<{
  buildCloudflareCallbackModuleBundlePlan: (input: {
    config: Record<string, unknown>
    configPath: string
  }) => Promise<{
    entries: Array<{
      module: string
      handlers: string[]
      source: string
    }>
  }>
  createGeneratedWorker: (tempDir: string, options: {
    name: string
    config: Record<string, unknown>
    configPath: string
    plugins: string[]
    kanbanDir: string
    compatibilityDate: string
    configStorageBindingHandles?: Record<string, string>
    configStorageRevisionBinding?: string
    callbackQueue?: string
    callbackMaxBatchSize?: number
    callbackMaxBatchTimeout?: number
    callbackMaxRetries?: number
    callbackDeadLetterQueue?: string
  }) => Promise<string>
  createGeneratedWranglerConfig: (tempDir: string, options: {
    name: string
    config: Record<string, unknown>
    compatibilityDate: string
    customDomains?: string[]
    customDomainZoneName?: string
    configStorageBindingHandles?: Record<string, string>
    configStorageRevisionBinding?: string
    callbackQueue?: string
    callbackMaxBatchSize?: number
    callbackMaxBatchTimeout?: number
    callbackMaxRetries?: number
    callbackDeadLetterQueue?: string
  }) => Promise<string>
  validateCloudflareCallbackModuleBundlePlan: (
    tempDir: string,
    entries: Array<{
      module: string
      handlers: string[]
      source: string
    }>,
  ) => Promise<void>
}> {
  return import(deployScriptPath)
}

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-worker-script-'))
  tempDirs.push(tempDir)
  return tempDir
}

function readImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('deploy-cloudflare-worker callback module contract', () => {
  it('discovers callback.runtime module handlers and resolves config-relative module paths', async () => {
    const { buildCloudflareCallbackModuleBundlePlan } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const configPath = path.join(tempDir, 'workspace', '.kanban.json')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })

    const plan = await buildCloudflareCallbackModuleBundlePlan({
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'callback.runtime': {
            provider: 'cloudflare',
            options: {
              handlers: [
                { id: 'deliver', name: 'deliver', type: 'module', module: './callbacks/deliver.ts', handler: 'deliver', events: ['task.created'] },
                { id: 'skip-me', name: 'skip-me', type: 'module', module: './callbacks/disabled.ts', handler: 'skipMe', events: ['task.created'], enabled: false },
                { id: 'legacy-inline', name: 'legacy-inline', type: 'inline', source: 'async () => null', events: ['task.created'], enabled: false },
                { id: 'node-runtime', name: 'node-runtime', type: 'module', module: 'kl-plugin-callback', handler: 'callbackListenerPlugin', events: ['task.created'] },
              ],
            },
          },
        },
      },
    })

    expect(plan.entries).toEqual([
      {
        module: './callbacks/deliver.ts',
        handlers: ['deliver'],
        source: path.join(path.dirname(configPath), 'callbacks', 'deliver.ts'),
      },
      {
        module: 'kl-plugin-callback',
        handlers: ['callbackListenerPlugin'],
        source: path.join(repoRoot, 'packages', 'kl-plugin-callback', 'src', 'index.ts'),
      },
    ])
  })

  it('fails closed when a configured callback module does not export the named handler', async () => {
    const { validateCloudflareCallbackModuleBundlePlan } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const callbackModulePath = path.join(tempDir, 'callback-handler.ts')
    fs.writeFileSync(callbackModulePath, 'export const otherHandler = () => null\n', 'utf8')

    await expect(validateCloudflareCallbackModuleBundlePlan(tempDir, [
      {
        module: './callback-handler.ts',
        handlers: ['deliver'],
        source: callbackModulePath,
      },
    ])).rejects.toThrow(/callback module validation failed|deliver/i)
  })

  it('fails closed when a configured callback module export is present but not callable', async () => {
    const { validateCloudflareCallbackModuleBundlePlan } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const callbackModulePath = path.join(tempDir, 'callback-handler.ts')
    fs.writeFileSync(callbackModulePath, 'export const deliver = "not-a-function"\n', 'utf8')

    await expect(validateCloudflareCallbackModuleBundlePlan(tempDir, [
      {
        module: './callback-handler.ts',
        handlers: ['deliver'],
        source: callbackModulePath,
      },
    ])).rejects.toThrow(/callable|deliver/i)
  })

  it('emits explicit queue consumer config and queue exports only for enabled module handlers', async () => {
    const {
      createGeneratedWorker,
      createGeneratedWranglerConfig,
    } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')
    const callbacksDir = path.join(workspaceDir, 'callbacks')

    fs.mkdirSync(callbacksDir, { recursive: true })
    fs.writeFileSync(path.join(callbacksDir, 'deliver.ts'), 'export const deliver = async () => null\n', 'utf8')
    fs.writeFileSync(path.join(callbacksDir, 'disabled.ts'), 'export const skipMe = async () => null\n', 'utf8')
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const options = {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'callback.runtime': {
            provider: 'cloudflare',
            options: {
              handlers: [
                { id: 'deliver', name: 'deliver', type: 'module', module: './callbacks/deliver.ts', handler: 'deliver', events: ['task.created'], enabled: true },
                { id: 'skip-me', name: 'skip-me', type: 'module', module: './callbacks/disabled.ts', handler: 'skipMe', events: ['task.created'], enabled: false },
              ],
            },
          },
        },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
      configStorageBindingHandles: {
        database: 'KANBAN_DB',
        callbacks: 'KANBAN_QUEUE',
      },
      configStorageRevisionBinding: 'KANBAN_CONFIG_REVISION',
      callbackQueue: 'kanban-callbacks',
      callbackMaxBatchSize: 1,
      callbackMaxBatchTimeout: 0,
      callbackMaxRetries: 3,
      callbackDeadLetterQueue: 'kanban-callbacks-dlq',
    }

    const entryPath = await createGeneratedWorker(tempDir, options)
    const entrySource = fs.readFileSync(entryPath, 'utf8')

    expect(entrySource).toContain('queue: createCloudflareWorkerQueueHandler')
    expect(entrySource).toContain('sdkModule: sdkRuntimeModule')
    expect(entrySource).toContain(JSON.stringify('./callbacks/deliver.ts'))
    expect(entrySource).toMatch(/"bindingHandles": \{\s+"database": "KANBAN_DB",\s+"callbacks": "KANBAN_QUEUE"\s+\}/)
    expect(entrySource).toMatch(/"revisionSource": \{\s+"kind": "binding",\s+"binding": "KANBAN_CONFIG_REVISION"\s+\}/)
    expect(entrySource).not.toContain('packages/kl-plugin-cloudflare/src/index.ts')
    expect(entrySource).not.toContain('from "./workspace/callbacks/disabled.ts"')
    expect(entrySource).not.toContain('"./callbacks/disabled.ts": moduleRegistryEntry')

    const wranglerConfigPath = await createGeneratedWranglerConfig(tempDir, options)
    const wranglerSource = fs.readFileSync(wranglerConfigPath, 'utf8')

    expect(wranglerSource).toContain('compatibility_flags = ["nodejs_compat"]')
    expect(wranglerSource).toContain('workers_dev = true')
    expect(wranglerSource).toContain('[[queues.consumers]]')
    expect(wranglerSource).toContain('queue = "kanban-callbacks"')
    expect(wranglerSource).toContain('max_batch_size = 1')
    expect(wranglerSource).toContain('max_batch_timeout = 0')
    expect(wranglerSource).toContain('max_retries = 3')
    expect(wranglerSource).toContain('dead_letter_queue = "kanban-callbacks-dlq"')
  })

  it('emits Durable Object active-card wiring in the generated worker entry and Wrangler config', async () => {
    const {
      createGeneratedWorker,
      createGeneratedWranglerConfig,
    } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')

    fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const options = {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
    }

    const entryPath = await createGeneratedWorker(tempDir, options)
    const entrySource = fs.readFileSync(entryPath, 'utf8')
    expect(entrySource).toContain('import { DurableObject } from "cloudflare:workers"')
    expect(entrySource).toContain('export class KanbanActiveCardState extends DurableObject')
    expect(entrySource).toContain('async getActiveCardState()')
    expect(entrySource).toContain('async setActiveCardState(state)')
    expect(entrySource).toContain('async clearActiveCardState()')

    const wranglerConfigPath = await createGeneratedWranglerConfig(tempDir, options)
    const wranglerSource = fs.readFileSync(wranglerConfigPath, 'utf8')
    expect(wranglerSource).toContain('[[durable_objects.bindings]]')
    expect(wranglerSource).toContain('name = "KANBAN_ACTIVE_CARD_STATE"')
    expect(wranglerSource).toContain('class_name = "KanbanActiveCardState"')
    expect(wranglerSource).toContain('[[migrations]]')
    expect(wranglerSource).toContain('tag = "kanban-active-card-state-v1"')
    expect(wranglerSource).toContain('new_sqlite_classes = ["KanbanActiveCardState"]')
  })

  it('bundles required auth provider packages for Worker-safe default auth resolution', async () => {
    const { createGeneratedWorker } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')

    fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const entryPath = await createGeneratedWorker(tempDir, {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
    })

    const entrySource = fs.readFileSync(entryPath, 'utf8')
    expect(entrySource).toMatch(/"kl-plugin-auth": moduleRegistryEntry\d+/)
  })

  it('resolves Cloudflare Access auth.identity to the Worker provider package without duplicate imports', async () => {
    const { createGeneratedWorker } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')

    fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const entryPath = await createGeneratedWorker(tempDir, {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'auth.identity': {
            provider: 'cloudflare',
            options: { teamName: 'example', audience: 'aud' },
          },
        },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
    })

    const entrySource = fs.readFileSync(entryPath, 'utf8')
    expect(entrySource).not.toContain('packages/kl-plugin-cloudflare/src/index.ts')
  })

  it('bundles kl-plugin-webhook for the default webhook.delivery provider when Cloudflare config omits it', async () => {
    const { createGeneratedWorker } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')

    fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const entryPath = await createGeneratedWorker(tempDir, {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'card.storage': { provider: 'cloudflare' },
        },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
    })

    const entrySource = fs.readFileSync(entryPath, 'utf8')
    expect(entrySource).toMatch(/"kl-plugin-webhook": moduleRegistryEntry\d+/)
  })

  it('does not bundle kl-plugin-webhook when webhook.delivery is explicitly disabled', async () => {
    const { createGeneratedWorker } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')

    fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const entryPath = await createGeneratedWorker(tempDir, {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'card.storage': { provider: 'cloudflare' },
          'webhook.delivery': { provider: 'none' },
        },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
    })

    const entrySource = fs.readFileSync(entryPath, 'utf8')
    expect(entrySource).not.toMatch(/"kl-plugin-webhook": moduleRegistryEntry\d+/)
  })

  it('generates import specifiers that resolve back to the source files from macOS temp directories', async () => {
    const { createGeneratedWorker } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')

    fs.mkdirSync(workspaceDir, { recursive: true })
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const entryPath = await createGeneratedWorker(tempDir, {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'config.storage': { provider: 'cloudflare' },
        },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
      configStorageBindingHandles: {
        database: 'KANBAN_DB',
      },
    })

    const entrySource = fs.readFileSync(entryPath, 'utf8')
    const entryDir = path.dirname(entryPath)
    const specifiers = readImportSpecifiers(entrySource).filter((specifier) => specifier.startsWith('.'))

    expect(specifiers.length).toBeGreaterThan(0)

    for (const specifier of specifiers) {
      const resolved = fs.realpathSync.native(path.resolve(entryDir, specifier))
      expect(fs.existsSync(resolved)).toBe(true)
    }
  })

  it('does not activate Cloudflare queue wiring for non-cloudflare callback providers', async () => {
    const {
      createGeneratedWorker,
      createGeneratedWranglerConfig,
    } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()
    const workspaceDir = path.join(tempDir, 'workspace')
    const configPath = path.join(workspaceDir, '.kanban.json')
    const callbacksDir = path.join(workspaceDir, 'callbacks')

    fs.mkdirSync(callbacksDir, { recursive: true })
    fs.writeFileSync(path.join(callbacksDir, 'deliver.ts'), 'export const deliver = async () => null\n', 'utf8')
    fs.writeFileSync(configPath, '{}\n', 'utf8')

    const options = {
      name: 'kanban-test-worker',
      configPath,
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
        plugins: {
          'callback.runtime': {
            provider: 'callbacks',
            options: {
              handlers: [
                { id: 'deliver', name: 'deliver', type: 'module', module: './callbacks/deliver.ts', handler: 'deliver', events: ['task.created'], enabled: true },
              ],
            },
          },
        },
      },
      plugins: [],
      kanbanDir: '.kanban',
      compatibilityDate: '2026-04-05',
      callbackQueue: 'kanban-callbacks',
      callbackMaxBatchSize: 1,
      callbackMaxBatchTimeout: 0,
      callbackMaxRetries: 3,
    }

    const entryPath = await createGeneratedWorker(tempDir, options)
    const entrySource = fs.readFileSync(entryPath, 'utf8')

    expect(entrySource).not.toContain('queue: createCloudflareWorkerQueueHandler')
    expect(entrySource).not.toMatch(/import \* as moduleRegistryEntry\d+ from "\.\/workspace\/callbacks\/deliver\.ts"/)
    expect(entrySource).not.toMatch(/"\.\/callbacks\/deliver\.ts": moduleRegistryEntry\d+/)

    const wranglerConfigPath = await createGeneratedWranglerConfig(tempDir, options)
    const wranglerSource = fs.readFileSync(wranglerConfigPath, 'utf8')

    expect(wranglerSource).toContain('compatibility_flags = ["nodejs_compat"]')
    expect(wranglerSource).toContain('workers_dev = true')
    expect(wranglerSource).not.toContain('[[queues.consumers]]')
  })

  it('emits deduplicated custom-domain routes in the generated Wrangler config', async () => {
    const { createGeneratedWranglerConfig } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()

    const wranglerConfigPath = await createGeneratedWranglerConfig(tempDir, {
      name: 'kanban-test-worker',
      compatibilityDate: '2026-04-05',
      customDomains: [' kl.incidentmind.com ', 'kl.incidentmind.com'],
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
      },
    })

    const wranglerSource = fs.readFileSync(wranglerConfigPath, 'utf8')

    expect(wranglerSource.match(/\[\[routes\]\]/g)).toHaveLength(1)
    expect(wranglerSource).toContain('pattern = "kl.incidentmind.com"')
    expect(wranglerSource).toContain('custom_domain = true')
    expect(wranglerSource).toContain('zone_name = "incidentmind.com"')
  })

  it('rejects invalid custom-domain values before generating Wrangler config', async () => {
    const { createGeneratedWranglerConfig } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()

    await expect(createGeneratedWranglerConfig(tempDir, {
      name: 'kanban-test-worker',
      compatibilityDate: '2026-04-05',
      customDomains: ['https://kl.incidentmind.com'],
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
      },
    })).rejects.toThrow(/custom domains must be concrete hostnames/i)
  })

  it('rejects custom-domain zone names that do not match the configured hostname', async () => {
    const { createGeneratedWranglerConfig } = await loadDeployCloudflareWorkerScript()
    const tempDir = createTempDir()

    await expect(createGeneratedWranglerConfig(tempDir, {
      name: 'kanban-test-worker',
      compatibilityDate: '2026-04-05',
      customDomains: ['kl.incidentmind.com'],
      customDomainZoneName: 'example.com',
      config: {
        version: 2,
        defaultBoard: 'default',
        boards: { default: { columns: [] } },
      },
    })).rejects.toThrow(/does not belong to the configured zone/i)
  })
})

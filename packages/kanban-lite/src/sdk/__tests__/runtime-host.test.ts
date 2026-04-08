import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig, writeConfig } from '../../shared/config'
import { getRuntimeHost, installRuntimeHost, loadWorkspaceEnv, resetRuntimeHost, type RuntimeHostConfigDocument } from '../../shared/env'
import { resolveCallbackRuntimeModule } from '../index'
import { KanbanSDK } from '../KanbanSDK'
import { readConfigRepositoryDocument, writeConfigRepositoryDocument } from '../modules/configRepository'
import { loadExternalModule } from '../plugins'

const scratchRoot = path.join(process.cwd(), 'packages/kanban-lite/.test-artifacts/runtime-host')

function createWorkspace(name: string): string {
  const workspaceRoot = path.join(scratchRoot, name)
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })
  return workspaceRoot
}

afterEach(() => {
  resetRuntimeHost()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
  delete process.env.RUNTIME_HOST_SAMPLE
  delete process.env.RUNTIME_HOST_PLUGIN_TOKEN
})

describe('runtime host overrides', () => {
  it('keeps default config and env behavior when no runtime host is installed', () => {
    const workspaceRoot = createWorkspace('defaults')
    fs.writeFileSync(path.join(workspaceRoot, '.kanban.json'), JSON.stringify({ version: 2, defaultBoard: 'default', boards: { default: { columns: [] } } }), 'utf-8')
    fs.writeFileSync(path.join(workspaceRoot, '.env'), 'RUNTIME_HOST_SAMPLE=from-dotenv\n', 'utf-8')

    loadWorkspaceEnv(workspaceRoot)
    expect(process.env.RUNTIME_HOST_SAMPLE).toBe('from-dotenv')
    expect(readConfig(workspaceRoot).defaultBoard).toBe('default')
  })

  it('lets the runtime host override config read, config write, env loading, and module resolution', () => {
    const workspaceRoot = createWorkspace('override')
    const writes: Array<{ workspaceRoot: string; defaultBoard: string | undefined }> = []

    installRuntimeHost({
      readConfig(root) {
        expect(root).toBe(workspaceRoot)
        return {
          version: 2,
          defaultBoard: 'worker',
          boards: {
            worker: {
              columns: [{ id: 'todo', name: 'Todo' }],
            },
          },
        }
      },
      writeConfig(root, _filePath, config) {
        writes.push({ workspaceRoot: root, defaultBoard: config.defaultBoard })
        return true
      },
      loadWorkspaceEnv(root) {
        process.env.RUNTIME_HOST_SAMPLE = `runtime:${root}`
        return true
      },
      resolveExternalModule(request) {
        if (request === 'runtime-host-plugin') {
          return { manifest: { id: 'runtime-host-plugin' } }
        }
        return undefined
      },
    })

    loadWorkspaceEnv(workspaceRoot)
    const config = readConfig(workspaceRoot)
    expect(config.defaultBoard).toBe('worker')
    expect(process.env.RUNTIME_HOST_SAMPLE).toBe(`runtime:${workspaceRoot}`)
    expect(loadExternalModule('runtime-host-plugin')).toEqual({ manifest: { id: 'runtime-host-plugin' } })

    writeConfig(workspaceRoot, config)
    expect(writes).toEqual([{ workspaceRoot, defaultBoard: 'worker' }])
    expect(fs.existsSync(path.join(workspaceRoot, '.kanban.json'))).toBe(false)
  })

  it('exposes callback runtime module resolution through the public SDK helper', () => {
    installRuntimeHost({
      resolveExternalModule(request) {
        if (request === 'runtime-host-callback-module') {
          return { deliver() { return 'hosted' } }
        }
        return undefined
      },
    })

    expect(resolveCallbackRuntimeModule('runtime-host-callback-module')).toEqual({
      deliver: expect.any(Function),
    })
  })

  it('routes plugin-settings persistence through the same runtime-host-backed config repository without resolving env placeholders into persisted config', async () => {
    const workspaceRoot = createWorkspace('plugin-settings')
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    process.env.RUNTIME_HOST_PLUGIN_TOKEN = 'runtime-secret'

    let currentConfig: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: '${RUNTIME_HOST_PLUGIN_TOKEN}',
          },
        },
      },
    }
    const writes: RuntimeHostConfigDocument[] = []

    installRuntimeHost({
      readConfig(root) {
        expect(root).toBe(workspaceRoot)
        return structuredClone(currentConfig)
      },
      writeConfig(root, _filePath, nextConfig) {
        expect(root).toBe(workspaceRoot)
        currentConfig = structuredClone(nextConfig)
        writes.push(structuredClone(nextConfig))
        return true
      },
    })

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const updated = await sdk.updatePluginSettingsOptions('auth.identity', 'local', {
        tokenHeader: 'x-runtime-host-token',
      })
      const readback = await sdk.getPluginSettings('auth.identity', 'local')

      expect(updated.selected).toEqual({
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      })
      expect(readback?.selected).toEqual({
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      })
      expect(readback?.options).not.toBeNull()
      expect(writes).toHaveLength(1)
      expect(currentConfig.plugins?.['auth.identity']).toEqual({
        provider: 'local',
        options: {
          apiToken: '${RUNTIME_HOST_PLUGIN_TOKEN}',
          tokenHeader: 'x-runtime-host-token',
        },
      })
      expect(fs.existsSync(path.join(workspaceRoot, '.kanban.json'))).toBe(false)
    } finally {
      sdk.close()
    }
  })

  it('accepts raw config repository documents through runtime-host config hooks', () => {
    const workspaceRoot = createWorkspace('raw-config-document')
    const filePath = path.join(workspaceRoot, '.kanban.json')
    const seedDocument: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'config.storage': {
          provider: 'localfs',
          options: {
            region: 'test',
          },
        },
      },
      customField: {
        preserved: true,
      },
    }
    const asserted: RuntimeHostConfigDocument[] = []
    const writes: RuntimeHostConfigDocument[] = []
    let currentDocument: RuntimeHostConfigDocument = structuredClone(seedDocument)

    installRuntimeHost({
      readConfig(root, requestedFilePath) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        return structuredClone(currentDocument)
      },
      assertCanWriteConfig(root, requestedFilePath, document) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        asserted.push(structuredClone(document))
      },
      writeConfig(root, requestedFilePath, document) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        const clonedDocument = structuredClone(document)
        writes.push(clonedDocument)
        currentDocument = clonedDocument
        return true
      },
    })

    const readResult = readConfigRepositoryDocument(workspaceRoot)
    expect(readResult).toEqual({
      status: 'ok',
      filePath,
      value: seedDocument,
    })

    const writeResult = writeConfigRepositoryDocument(workspaceRoot, {
      ...seedDocument,
      showLabels: false,
      anotherUnknownField: 'still-there',
    })

    getRuntimeHost()?.assertCanWriteConfig?.(workspaceRoot, filePath, {
      ...seedDocument,
      showLabels: false,
      anotherUnknownField: 'still-there',
    })

    expect(writeResult).toEqual({ status: 'ok', filePath })
    expect(asserted).toEqual([
      {
        ...seedDocument,
        showLabels: false,
        anotherUnknownField: 'still-there',
      },
      {
        ...seedDocument,
        showLabels: false,
        anotherUnknownField: 'still-there',
      },
    ])
    expect(writes).toEqual([
      {
        ...seedDocument,
        showLabels: false,
        anotherUnknownField: 'still-there',
      },
    ])
    expect(writes[0].kanbanDirectory).toBeUndefined()
  })

  it('exposes the installed runtime host globally', () => {
    installRuntimeHost({ loadWorkspaceEnv: () => true })
    expect(getRuntimeHost()).not.toBeNull()
  })

  it('surfaces runtime-host config.storage topology rejections through plugin-settings mutations', async () => {
    const workspaceRoot = createWorkspace('config-storage-topology-reject')
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })

    let currentConfig: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'config.storage': {
          provider: 'cloudflare',
          options: {
            databaseId: 'cfg-db',
          },
        },
      },
    }

    installRuntimeHost({
      readConfig() {
        return structuredClone(currentConfig)
      },
      writeConfig(_root, _filePath, nextConfig) {
        currentConfig = structuredClone(nextConfig)
        return true
      },
      assertCanWriteConfig() {
        throw new Error("Cloudflare Worker config.storage topology changed from 'cloudflare' to 'localfs'. Update the Worker bootstrap and redeploy before applying this config change.")
      },
    })

    const sdk = new KanbanSDK(kanbanDir)

    try {
      await expect(sdk.selectPluginSettingsProvider('config.storage', 'localfs')).rejects.toMatchObject({
        payload: {
          code: 'plugin-settings-runtime-mutation-rejected',
          message: "Cloudflare Worker config.storage topology changed from 'cloudflare' to 'localfs'. Update the Worker bootstrap and redeploy before applying this config change.",
          capability: 'config.storage',
          providerId: 'localfs',
        },
      })
    } finally {
      sdk.close()
    }
  })

  it('uses the runtime-host seed document for config.storage control-plane recovery when explicit provider reads fail', async () => {
    const workspaceRoot = createWorkspace('config-storage-recovery')
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const filePath = path.join(workspaceRoot, '.kanban.json')
    fs.mkdirSync(kanbanDir, { recursive: true })

    let currentConfig: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'config.storage': {
          provider: 'failing-config-storage',
          options: {
            endpoint: 'https://cfg.test',
          },
        },
      },
    }
    const writes: RuntimeHostConfigDocument[] = []

    installRuntimeHost({
      readConfig(root, requestedFilePath) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        return structuredClone(currentConfig)
      },
      writeConfig(root, requestedFilePath, nextConfig) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        const cloned = structuredClone(nextConfig)
        currentConfig = cloned
        writes.push(cloned)
        return true
      },
      getConfigStorageFailure(_workspaceRoot, config) {
        if (config.plugins?.['config.storage']?.provider !== 'failing-config-storage') {
          return null
        }

        return {
          code: 'config-storage-provider-unavailable',
          message: 'The remote config backend is unavailable.',
        }
      },
      resolveExternalModule(request) {
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

    const sdk = new KanbanSDK(kanbanDir)

    try {
      expect(() => readConfig(workspaceRoot)).toThrow(/failing-config-storage/)
      expect(() => readConfig(workspaceRoot)).toThrow(/simulated remote config outage/)

      await expect(sdk.getPluginSettings('config.storage', 'localfs')).resolves.toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: null,
          source: 'config',
          resolution: {
            configured: {
              provider: 'failing-config-storage',
              options: {
                endpoint: 'https://cfg.test',
              },
            },
            effective: null,
            mode: 'error',
            failure: {
              code: 'config-storage-provider-unavailable',
              message: 'The remote config backend is unavailable.',
            },
          },
        },
      })

      await expect(sdk.selectPluginSettingsProvider('config.storage', 'localfs')).resolves.toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: 'localfs',
          source: 'config',
          resolution: {
            configured: {
              provider: 'localfs',
            },
            effective: {
              provider: 'localfs',
            },
            mode: 'explicit',
            failure: null,
          },
        },
      })

      expect(writes).toEqual([
        {
          version: 2,
          defaultBoard: 'default',
          boards: {
            default: {
              columns: [],
            },
          },
          plugins: {
            'config.storage': {
              provider: 'localfs',
            },
          },
          pluginOptions: {
            'config.storage': {
              'failing-config-storage': {
                endpoint: 'https://cfg.test',
              },
            },
          },
        },
      ])
    } finally {
      sdk.close()
    }
  })

  it('preserves explicit config.storage read failures in status and plugin-settings resolution without a runtime-host failure hook', async () => {
    const workspaceRoot = createWorkspace('config-storage-status-read-failure')
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const filePath = path.join(workspaceRoot, '.kanban.json')
    fs.mkdirSync(kanbanDir, { recursive: true })

    const hostedSeed: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'config.storage': {
          provider: 'failing-config-storage',
          options: {
            endpoint: 'https://cfg.test',
          },
        },
      },
    }

    installRuntimeHost({
      readConfig(root, requestedFilePath) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        return structuredClone(hostedSeed)
      },
      resolveExternalModule(request) {
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

    const sdk = new KanbanSDK(kanbanDir)

    try {
      expect(() => readConfig(workspaceRoot)).toThrow(/failing-config-storage/)
      expect(() => readConfig(workspaceRoot)).toThrow(/simulated remote config outage/)

      expect(sdk.getStorageStatus().configStorage).toEqual({
        configured: {
          provider: 'failing-config-storage',
          options: {
            endpoint: 'https://cfg.test',
          },
        },
        effective: null,
        mode: 'error',
        failure: {
          code: 'config-storage-provider-unavailable',
          message: 'simulated remote config outage',
        },
      })

      await expect(sdk.getPluginSettings('config.storage', 'localfs')).resolves.toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: null,
          source: 'config',
          resolution: {
            configured: {
              provider: 'failing-config-storage',
              options: {
                endpoint: 'https://cfg.test',
              },
            },
            effective: null,
            mode: 'error',
            failure: {
              code: 'config-storage-provider-unavailable',
              message: 'simulated remote config outage',
            },
          },
        },
      })
    } finally {
      sdk.close()
    }
  })

  it('fails closed for generic runtime-host reads when the explicit config.storage package is unavailable', () => {
    const workspaceRoot = createWorkspace('config-storage-missing-package')
    const filePath = path.join(workspaceRoot, '.kanban.json')
    const hostedSeed: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'config.storage': {
          provider: 'missing-config-storage-plugin',
          options: {
            endpoint: 'https://cfg.test',
          },
        },
      },
    }

    installRuntimeHost({
      readConfig(root, requestedFilePath) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        return structuredClone(hostedSeed)
      },
    })

    expect(readConfigRepositoryDocument(workspaceRoot)).toMatchObject({
      status: 'error',
      filePath,
      reason: 'read',
    })
    expect(() => readConfig(workspaceRoot)).toThrow(/missing-config-storage-plugin/)

    expect(readConfigRepositoryDocument(workspaceRoot, {
      allowSeedFallbackOnProviderError: true,
    })).toEqual({
      status: 'ok',
      filePath,
      value: hostedSeed,
    })
  })

  it('fails closed for generic runtime-host reads when the explicit config.storage document is missing remotely', async () => {
    const workspaceRoot = createWorkspace('config-storage-missing-remote-document')
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const filePath = path.join(workspaceRoot, '.kanban.json')
    const hostedSeed: RuntimeHostConfigDocument = {
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [],
        },
      },
      plugins: {
        'config.storage': {
          provider: 'missing-remote-config-storage',
          options: {
            endpoint: 'https://cfg.test',
          },
        },
      },
    }

    installRuntimeHost({
      readConfig(root, requestedFilePath) {
        expect(root).toBe(workspaceRoot)
        expect(requestedFilePath).toBe(filePath)
        return structuredClone(hostedSeed)
      },
      resolveExternalModule(request) {
        if (request !== 'missing-remote-config-storage') {
          return undefined
        }

        return {
          createConfigStorageProvider() {
            return {
              manifest: { id: 'missing-remote-config-storage', provides: ['config.storage'] },
              readConfigDocument() {
                return null
              },
              writeConfigDocument() {
                throw new Error('not used in this test')
              },
            }
          },
        }
      },
    })

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const readResult = readConfigRepositoryDocument(workspaceRoot)
      expect(readResult).toMatchObject({
        status: 'error',
        filePath,
        reason: 'read',
      })
      expect(() => readConfig(workspaceRoot)).toThrow(/missing-remote-config-storage/)

      expect(sdk.getStorageStatus().configStorage).toEqual({
        configured: {
          provider: 'missing-remote-config-storage',
          options: {
            endpoint: 'https://cfg.test',
          },
        },
        effective: null,
        mode: 'error',
        failure: {
          code: 'config-storage-provider-unavailable',
          message: 'Configured config.storage provider did not return a config document.',
        },
      })

      await expect(sdk.getPluginSettings('config.storage', 'localfs')).resolves.toMatchObject({
        capability: 'config.storage',
        providerId: 'localfs',
        selected: {
          capability: 'config.storage',
          providerId: null,
          source: 'config',
          resolution: {
            configured: {
              provider: 'missing-remote-config-storage',
              options: {
                endpoint: 'https://cfg.test',
              },
            },
            effective: null,
            mode: 'error',
            failure: {
              code: 'config-storage-provider-unavailable',
              message: 'Configured config.storage provider did not return a config document.',
            },
          },
        },
      })

      const recoveryResult = readConfigRepositoryDocument(workspaceRoot, {
        allowSeedFallbackOnProviderError: true,
      })
      expect(recoveryResult).toEqual({
        status: 'ok',
        filePath,
        value: hostedSeed,
      })
    } finally {
      sdk.close()
    }
  })
})

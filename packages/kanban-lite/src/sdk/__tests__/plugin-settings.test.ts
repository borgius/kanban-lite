import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { KanbanConfig } from '../../shared/config'
import type { PluginSettingsOptionsSchemaMetadata, PluginSettingsRedactionPolicy } from '../../shared/types'
import type { KanbanSDK } from '../KanbanSDK'

const createdWorkspaces: string[] = []

function createTempWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-plugin-settings-'))
  createdWorkspaces.push(workspace)
  return workspace
}

const TEST_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

async function loadPluginSettingsHelpers() {
  return import(new URL('../plugins/plugin-settings.ts', import.meta.url).href)
}

afterEach(() => {
  while (createdWorkspaces.length > 0) {
    const workspace = createdWorkspaces.pop()
    if (workspace) {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }
})

describe('plugin settings helper extraction seam', () => {
  it('resolves async nested schema metadata into plain transport-safe values', async () => {
    const { resolvePluginSettingsOptionsSchema } = await loadPluginSettingsHelpers()
    const resolved = await resolvePluginSettingsOptionsSchema(
      {
        schema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: async () => ['local', 'remote'],
            },
          },
        },
        uiSchema: {
          type: 'VerticalLayout',
          elements: [
            async () => ({ type: 'Control', scope: '#/properties/mode' }),
          ],
        },
        secrets: [
          { path: 'apiToken', redaction: TEST_REDACTION },
          { path: '', redaction: TEST_REDACTION },
        ],
      },
      {} as KanbanSDK,
    )

    expect(resolved).toEqual({
      schema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['local', 'remote'],
          },
        },
      },
      uiSchema: {
        type: 'VerticalLayout',
        elements: [
          { type: 'Control', scope: '#/properties/mode' },
        ],
      },
      secrets: [
        { path: 'apiToken', redaction: TEST_REDACTION },
      ],
    } satisfies PluginSettingsOptionsSchemaMetadata)
  })

  it('clones declared schema defaults without synthesizing child values', async () => {
    const { getPluginSchemaDefaultOptions } = await loadPluginSettingsHelpers()
    expect(getPluginSchemaDefaultOptions({
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        profile: {
          type: 'object',
          default: {},
          properties: {
            retries: { type: 'number', default: 3 },
            label: { type: 'string', default: 'stable' },
          },
        },
      },
    })).toEqual({
      enabled: true,
      profile: {},
    })
  })

  it('reads and writes plugin settings configs as isolated documents', async () => {
    const {
      readPluginSettingsConfigDocument,
      writePluginSettingsConfigDocument,
    } = await loadPluginSettingsHelpers()
    const workspace = createTempWorkspace()
    const firstRead = readPluginSettingsConfigDocument(workspace)
    ;((firstRead as { plugins?: Record<string, unknown> }).plugins ??= {})['auth.identity'] = { provider: 'local' }

    const secondRead = readPluginSettingsConfigDocument(workspace)
    expect(secondRead.plugins).toBeUndefined()

    const config = readPluginSettingsConfigDocument(workspace)
    config.plugins = {
      'auth.identity': {
        provider: 'local',
        options: { enabled: true },
      },
    }

    writePluginSettingsConfigDocument(workspace, config)

    const persisted = JSON.parse(fs.readFileSync(path.join(workspace, '.kanban.json'), 'utf-8')) as {
      plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
    }

    expect(persisted.plugins).toEqual({
      'auth.identity': {
        provider: 'local',
        options: { enabled: true },
      },
    })
  })

  it('validates option payloads, preserves masked secrets, redacts reads, and prunes derived storage duplicates', async () => {
    const {
      PluginSettingsStoreError,
      createRedactedProviderOptions,
      ensurePluginSettingsOptionsRecord,
      mergeProviderOptionsUpdate,
      pruneRedundantDerivedStorageConfig,
    } = await loadPluginSettingsHelpers()

    expect(() => ensurePluginSettingsOptionsRecord([], 'auth.identity', 'local')).toThrowError(PluginSettingsStoreError)

    const currentOptions = {
      apiToken: 'real-token',
      users: [{ username: 'alice', password: 'old-hash', role: 'admin' }],
      nested: { clientSecret: 'keep-me', region: 'us-east-1' },
    }

    const merged = mergeProviderOptionsUpdate(
      currentOptions,
      {
        apiToken: '••••••',
        users: [{ username: 'alice', password: '••••••', role: 'manager' }],
        nested: { clientSecret: '••••••', region: 'eu-west-1' },
      },
      '',
      ['apiToken', 'users[0].password'],
      TEST_REDACTION,
    )

    expect(merged).toEqual({
      apiToken: 'real-token',
      users: [{ username: 'alice', password: 'old-hash', role: 'manager' }],
      nested: { clientSecret: 'keep-me', region: 'eu-west-1' },
    })

    const redacted = createRedactedProviderOptions(
      currentOptions,
      {
        schema: { type: 'object' },
        secrets: [
          { path: 'apiToken', redaction: TEST_REDACTION },
          { path: 'users[0].password', redaction: TEST_REDACTION },
        ],
      },
      TEST_REDACTION,
    )

    expect(redacted?.values).toEqual({
      apiToken: '••••••',
      users: [{ username: 'alice', password: '••••••', role: 'admin' }],
      nested: { clientSecret: '••••••', region: 'us-east-1' },
    })
    expect(redacted?.redactedPaths).toEqual(expect.arrayContaining([
      'apiToken',
      'users[0].password',
      'nested.clientSecret',
    ]))

    const config = {
      version: 2,
      plugins: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
        'attachment.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/ignored.db' } },
      },
    } as unknown as KanbanConfig

    expect(pruneRedundantDerivedStorageConfig(config)).toBe(true)
    expect(config.plugins).toEqual({
      'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
    })
  })
})

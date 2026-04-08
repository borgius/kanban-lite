import { afterEach, describe, expect, it } from 'vitest'

import {
  __setMysqlConfigStorageRunnerForTests,
  createConfigStorageProvider,
  pluginManifest,
} from './index'

type MysqlConfigStorageCommand = {
  action: 'read' | 'write'
  connection: {
    host?: string
    port?: number
    user?: string
    password?: string
    database: string
    ssl?: unknown
  }
  documentId: string
  document?: Record<string, unknown>
}

afterEach(() => {
  __setMysqlConfigStorageRunnerForTests(null)
})

describe('kl-plugin-storage-mysql config.storage provider', () => {
  it('advertises config.storage in the package manifest', () => {
    expect(pluginManifest.capabilities['config.storage']).toEqual(['mysql'])
  })

  it('round-trips workspace config with the same connection options payload used by card.storage', () => {
    const commands: MysqlConfigStorageCommand[] = []
    let storedDocument: Record<string, unknown> | null = null

    __setMysqlConfigStorageRunnerForTests((command) => {
      commands.push(structuredClone(command) as MysqlConfigStorageCommand)

      if (command.action === 'write') {
        storedDocument = structuredClone(command.document ?? null) as Record<string, unknown> | null
        return null
      }

      return storedDocument
    })

    const provider = createConfigStorageProvider({
      workspaceRoot: '/tmp/workspace',
      documentId: 'workspace-config',
      provider: 'mysql',
      backend: 'external',
      options: {
        host: 'db.test',
        port: 3307,
        user: 'kanban',
        password: 'secret',
        database: 'kanban_cfg',
        ssl: { rejectUnauthorized: false },
      },
    })

    const document: Record<string, unknown> = {
      version: 2,
      defaultBoard: 'default',
      plugins: {
        'config.storage': {
          provider: 'localfs',
          options: { scope: 'bootstrap' },
        },
      },
    }

    provider.writeConfigDocument(document)

    expect(provider.readConfigDocument()).toEqual(document)
    expect(commands).toEqual([
      {
        action: 'write',
        connection: {
          host: 'db.test',
          port: 3307,
          user: 'kanban',
          password: 'secret',
          database: 'kanban_cfg',
          ssl: { rejectUnauthorized: false },
        },
        documentId: 'workspace-config',
        document,
      },
      {
        action: 'read',
        connection: {
          host: 'db.test',
          port: 3307,
          user: 'kanban',
          password: 'secret',
          database: 'kanban_cfg',
          ssl: { rejectUnauthorized: false },
        },
        documentId: 'workspace-config',
      },
    ])
  })

  it('requires the same database option as card.storage', () => {
    expect(() => createConfigStorageProvider({
      workspaceRoot: '/tmp/workspace',
      documentId: 'workspace-config',
      provider: 'mysql',
      backend: 'external',
      options: { host: 'db.test' },
    })).toThrow('database')
  })
})

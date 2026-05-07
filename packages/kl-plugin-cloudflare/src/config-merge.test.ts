import { describe, expect, it } from 'vitest'
import type { CloudflareWorkerProviderContext } from '../../kanban-lite/src/sdk/index'
import type { ConfigStorageModuleContext } from '../../kanban-lite/src/sdk/plugins/index'
import { createWorkerConfigRepositoryBridge } from './index'

type TestColumn = {
  id: string
  name: string
  color: string
}

type TestBoardConfig = {
  name: string
  columns: TestColumn[]
}

type TestConfigDocument = {
  version: 2
  defaultBoard: string
  boards: Record<string, TestBoardConfig>
  plugins: {
    'config.storage': {
      provider: 'cloudflare'
    }
  }
}

class AsyncConfigPreparedStatement {
  constructor(
    private readonly db: AsyncConfigD1Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): AsyncConfigPreparedStatement {
    return new AsyncConfigPreparedStatement(this.db, this.query, values)
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.db.executeRun(this.query, this.values)
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.db.executeFirst(this.query, this.values) as T | null
  }
}

class AsyncConfigD1Database {
  readonly configDocuments = new Map<string, TestConfigDocument>()

  async exec(_query: string): Promise<{ success: true }> {
    return { success: true }
  }

  prepare(query: string): AsyncConfigPreparedStatement {
    return new AsyncConfigPreparedStatement(this, query)
  }

  executeRun(query: string, values: unknown[]): { success: true; meta: { changes: number } } {
    const normalized = normalizeQuery(query)

    if (normalized.startsWith('insert into config_documents')) {
      const [documentId, documentJson] = values as [string, string]
      this.configDocuments.set(documentId, JSON.parse(documentJson) as TestConfigDocument)
      return { success: true, meta: { changes: 1 } }
    }

    throw new Error(`Unsupported D1 run query in test fake: ${normalized}`)
  }

  executeFirst(query: string, values: unknown[]): Record<string, unknown> | null {
    const normalized = normalizeQuery(query)

    if (normalized.includes('from config_documents')) {
      const [documentId] = values as [string]
      const document = this.configDocuments.get(documentId)
      return document
        ? { document_id: documentId, document_json: JSON.stringify(document) }
        : null
    }

    throw new Error(`Unsupported D1 first query in test fake: ${normalized}`)
  }
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase()
}

function createBoardConfig(name: string): TestBoardConfig {
  return {
    name,
    columns: [
      {
        id: 'backlog',
        name: 'Backlog',
        color: '#000000',
      },
    ],
  }
}

function createConfigDocument(extraBoards: Record<string, TestBoardConfig> = {}): TestConfigDocument {
  return {
    version: 2,
    defaultBoard: 'default',
    boards: {
      default: createBoardConfig('Default'),
      ...extraBoards,
    },
    plugins: {
      'config.storage': {
        provider: 'cloudflare',
      },
    },
  }
}

function createWorkerContext(
  database: AsyncConfigD1Database,
  config: TestConfigDocument,
): CloudflareWorkerProviderContext {
  const bootstrap = {
    version: 1,
    config,
    topology: {
      configStorage: {
        documentId: 'workspace-config',
        provider: 'cloudflare',
        bindingHandles: {
          database: 'KANBAN_DB',
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
    },
    revision: {
      source: { kind: 'bootstrap' as const },
      getBinding() {
        return undefined
      },
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
    requireQueue<T = unknown>(handleName: string): T {
      return this.requireBinding<T>(handleName)
    },
  }
}

function createConfigStorageContext(worker: CloudflareWorkerProviderContext): ConfigStorageModuleContext {
  return {
    workspaceRoot: '/virtual/cloudflare-config-merge',
    documentId: 'workspace-config',
    provider: 'cloudflare',
    backend: 'external',
    worker,
  }
}

describe('Cloudflare config bridge board merge', () => {
  it('merges redeployed bootstrap boards with runtime D1 boards on read', async () => {
    const database = new AsyncConfigD1Database()
    const initialBridge = createWorkerConfigRepositoryBridge(
      createConfigStorageContext(createWorkerContext(database, createConfigDocument())),
    )

    await initialBridge.writeConfigDocument(createConfigDocument({
      'runtime-board': createBoardConfig('Runtime Board'),
    }))

    const redeployedBridge = createWorkerConfigRepositoryBridge(
      createConfigStorageContext(createWorkerContext(database, createConfigDocument({
        'config-board': createBoardConfig('Config Board'),
      }))),
    )

    const document = await redeployedBridge.readConfigDocument()

    expect(document).toBeTruthy()
    expect(Object.keys(document?.boards ?? {}).sort()).toEqual([
      'config-board',
      'default',
      'runtime-board',
    ])
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { resetRuntimeHost } from '../shared/env'
import { createCloudflareWorkerBootstrap } from '../sdk/env'
import { createCloudflareWorkerFetchHandler } from './index'

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

type WorkerApiSuccess<T> = {
  ok: true
  data: T
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

function createBootstrapConfig(extraBoards: Record<string, TestBoardConfig> = {}): TestConfigDocument {
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

function createWorkerHandler(config: TestConfigDocument) {
  return createCloudflareWorkerFetchHandler({
    kanbanDir: '/virtual/cloudflare-config-merge/.kanban',
    bootstrap: createCloudflareWorkerBootstrap({
      config,
      topology: {
        configStorage: {
          bindingHandles: {
            database: 'KANBAN_DB',
          },
          revisionSource: { kind: 'binding', binding: 'KANBAN_CONFIG_REVISION' },
        },
      },
    }),
    moduleRegistry: {},
  })
}

async function listBoardIds(handler: ReturnType<typeof createWorkerHandler>, env: Record<string, unknown>): Promise<string[]> {
  const response = await handler(new Request('https://example.test/api/boards'), env)
  const body = await response.json() as WorkerApiSuccess<Array<{ id: string }>>

  expect(response.status).toBe(200)
  expect(body.ok).toBe(true)

  return body.data.map((board) => board.id).sort()
}

async function createBoard(
  handler: ReturnType<typeof createWorkerHandler>,
  env: Record<string, unknown>,
  id: string,
  name: string,
): Promise<void> {
  const response = await handler(new Request('https://example.test/api/boards', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id, name }),
  }), env)

  expect(response.status).toBe(201)
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    data: {
      id,
      name,
    },
  })
}

afterEach(() => {
  resetRuntimeHost()
})

describe('Cloudflare Worker config merge', () => {
  it('keeps runtime-created boards across redeploys and adds newly deployed bootstrap boards', async () => {
    const database = new AsyncConfigD1Database()
    const revisionBinding = { current: 'rev-1' }
    const env = {
      KANBAN_DB: database,
      KANBAN_CONFIG_REVISION: revisionBinding,
    }

    const initialHandler = createWorkerHandler(createBootstrapConfig())

    await createBoard(initialHandler, env, 'runtime-board', 'Runtime Board')
    await expect(listBoardIds(initialHandler, env)).resolves.toEqual([
      'default',
      'runtime-board',
    ])

    resetRuntimeHost()
    revisionBinding.current = 'rev-2'
    const sameConfigRedeploy = createWorkerHandler(createBootstrapConfig())
    await expect(listBoardIds(sameConfigRedeploy, env)).resolves.toEqual([
      'default',
      'runtime-board',
    ])

    resetRuntimeHost()
    revisionBinding.current = 'rev-3'
    const newConfigRedeploy = createWorkerHandler(createBootstrapConfig({
      'config-board': createBoardConfig('Config Board'),
    }))
    await expect(listBoardIds(newConfigRedeploy, env)).resolves.toEqual([
      'config-board',
      'default',
      'runtime-board',
    ])
  })
})

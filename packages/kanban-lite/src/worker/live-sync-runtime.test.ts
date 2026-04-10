import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetRuntimeHost } from '../shared/env'
import { createCloudflareWorkerBootstrap } from '../sdk/env'
import { createCloudflareWorkerFetchHandler } from './index'

type ActiveCardState = {
  cardId: string
  boardId: string
  updatedAt: string
}

type LiveSyncFetchRecord = {
  name: string
  url: string
  method: string
  headers: Record<string, string>
  bodyText: string | null
}

class FakeLiveSyncDurableObjectStub {
  constructor(
    private readonly name: string,
    private readonly cell: { state: ActiveCardState | null },
    private readonly fetches: LiveSyncFetchRecord[],
  ) {}

  async fetch(request: Request): Promise<Response> {
    const bodyText = request.method === 'GET' || request.method === 'HEAD'
      ? null
      : await request.text()

    this.fetches.push({
      name: this.name,
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      bodyText,
    })

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return new Response(null, { status: 204 })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async getActiveCardState(): Promise<ActiveCardState | null> {
    return this.cell.state ? structuredClone(this.cell.state) : null
  }

  async setActiveCardState(state: ActiveCardState): Promise<void> {
    this.cell.state = structuredClone(state)
  }

  async clearActiveCardState(): Promise<void> {
    this.cell.state = null
  }
}

class FakeLiveSyncDurableObjectNamespace {
  private readonly cells = new Map<string, { state: ActiveCardState | null }>()
  readonly fetches: LiveSyncFetchRecord[] = []

  getByName(name: string): FakeLiveSyncDurableObjectStub {
    let cell = this.cells.get(name)
    if (!cell) {
      cell = { state: null }
      this.cells.set(name, cell)
    }

    return new FakeLiveSyncDurableObjectStub(name, cell, this.fetches)
  }
}

const tempDirs: string[] = []

function createTempWorkspaceRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-worker-live-sync-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

function writeWorkspaceConfig(workspaceRoot: string): void {
  fs.writeFileSync(
    path.join(workspaceRoot, '.kanban.json'),
    JSON.stringify({
      version: 2,
      defaultBoard: 'default',
      boards: {
        default: {
          columns: [{ id: 'backlog', name: 'Backlog', color: '#000000' }],
        },
      },
    }),
    'utf-8',
  )
}

function createWorkerBootstrapConfig() {
  return {
    version: 2,
    defaultBoard: 'default',
    boards: {
      default: {
        columns: [{ id: 'backlog', name: 'Backlog', color: '#000000' }],
      },
    },
  } as const
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
  resetRuntimeHost()
})

describe('Cloudflare worker live sync runtime', () => {
  it('proxies websocket upgrades through the live-sync Durable Object when configured', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const liveSyncNamespace = new FakeLiveSyncDurableObjectNamespace()

    writeWorkspaceConfig(workspaceRoot)

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
    })

    const response = await handler(new Request('https://example.test/ws', {
      headers: { Upgrade: 'websocket' },
    }), {
      KANBAN_ACTIVE_CARD_STATE: liveSyncNamespace,
    })

    expect(response.status).toBe(204)
    expect(liveSyncNamespace.fetches).toEqual([
      expect.objectContaining({
        name: `live-sync:${path.resolve(kanbanDir)}`,
        url: 'https://example.test/ws',
        method: 'GET',
        headers: expect.objectContaining({ upgrade: 'websocket' }),
      }),
    ])
  })

  it('publishes sync invalidations after mutating requests succeed', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const liveSyncNamespace = new FakeLiveSyncDurableObjectNamespace()
    let runtimeConfig = structuredClone(createWorkerBootstrapConfig()) as Record<string, unknown>

    writeWorkspaceConfig(workspaceRoot)

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({ config: createWorkerBootstrapConfig() }),
      runtimeHost: {
        readConfig() {
          return structuredClone(runtimeConfig)
        },
        writeConfig(_workspaceRoot, _filePath, nextConfig) {
          runtimeConfig = structuredClone(nextConfig) as Record<string, unknown>
          return true
        },
      },
    })

    const response = await handler(new Request('https://example.test/api/boards/default/tasks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: '# Worker live sync\n\nCreate a card and notify listeners.',
      }),
    }), {
      KANBAN_ACTIVE_CARD_STATE: liveSyncNamespace,
    })

    const responseText = await response.text()
    if (response.status !== 201) {
      throw new Error(`Unexpected create-task response ${response.status}: ${responseText}`)
    }

    await vi.waitFor(() => {
      const notifyPayloads = liveSyncNamespace.fetches
        .filter((record) => record.url === 'https://kanban-lite.worker/live-sync/notify')
        .map((record) => JSON.parse(record.bodyText ?? '{}'))

      expect(notifyPayloads).toContainEqual({
        type: 'syncRequired',
        reason: 'task.created',
      })
    })
  })
})

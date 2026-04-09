import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCloudflareWorkerBootstrap } from '../sdk/env'
import { createCloudflareWorkerFetchHandler } from './index'

type ActiveCardState = {
  cardId: string
  boardId: string
  updatedAt: string
}

class FakeActiveCardDurableObjectStub {
  constructor(private readonly cell: { state: ActiveCardState | null }) {}

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

class FakeActiveCardDurableObjectNamespace {
  private readonly cells = new Map<string, { state: ActiveCardState | null }>()

  getByName(name: string): FakeActiveCardDurableObjectStub {
    let cell = this.cells.get(name)
    if (!cell) {
      cell = { state: null }
      this.cells.set(name, cell)
    }
    return new FakeActiveCardDurableObjectStub(cell)
  }
}

const tempDirs: string[] = []

function createTempWorkspaceRoot(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lite-worker-active-card-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

function writeCardFile(kanbanDir: string, id: string): void {
  const cardDir = path.join(kanbanDir, 'boards', 'default', 'backlog')
  fs.mkdirSync(cardDir, { recursive: true })
  fs.writeFileSync(
    path.join(cardDir, `${id}.md`),
    `---
id: "${id}"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2026-04-09T00:00:00.000Z"
modified: "2026-04-09T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# ${id}

Worker active-card test.
`,
    'utf-8',
  )
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('Cloudflare worker active-card runtime', () => {
  it('persists active-card state through the Worker Durable Object so follow-up requests can resolve /api/tasks/active', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const kanbanDir = path.join(workspaceRoot, '.kanban')
    const activeCardNamespace = new FakeActiveCardDurableObjectNamespace()

    fs.writeFileSync(
      path.join(workspaceRoot, '.kanban.json'),
      JSON.stringify({ version: 2, defaultBoard: 'default', boards: { default: { columns: [] } } }),
      'utf-8',
    )
    writeCardFile(kanbanDir, 'worker-active-card')

    const handler = createCloudflareWorkerFetchHandler({
      kanbanDir,
      bootstrap: createCloudflareWorkerBootstrap({
        config: {
          version: 2,
          defaultBoard: 'default',
          boards: {
            default: {
              columns: [],
            },
          },
        },
      }),
    })

    const env = {
      KANBAN_ACTIVE_CARD_STATE: activeCardNamespace,
    }

    const syncResponse = await handler(new Request('https://example.test/api/webview-sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { type: 'ready' },
          { type: 'openCard', cardId: 'worker-active-card' },
        ],
      }),
    }), env)

    expect(syncResponse.status).toBe(200)
    await expect(syncResponse.json()).resolves.toMatchObject({ ok: true })
    expect(fs.existsSync(path.join(kanbanDir, '.active-card.json'))).toBe(false)

    const activeResponse = await handler(new Request('https://example.test/api/tasks/active'), env)
    expect(activeResponse.status).toBe(200)
    await expect(activeResponse.json()).resolves.toMatchObject({
      ok: true,
      data: expect.objectContaining({ id: 'worker-active-card' }),
    })
  })
})

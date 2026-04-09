import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { installRuntimeHost, resetRuntimeHost, type RuntimeHostActiveCardState } from '../../shared/env'

const scratchRoot = path.join(process.cwd(), 'packages/kanban-lite/.test-artifacts/runtime-host-active-card')

function createWorkspace(name: string): { workspaceRoot: string; kanbanDir: string } {
  const workspaceRoot = path.join(scratchRoot, name)
  const kanbanDir = path.join(workspaceRoot, '.kanban')
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
  fs.mkdirSync(path.join(kanbanDir, 'boards', 'default', 'backlog'), { recursive: true })
  fs.writeFileSync(
    path.join(workspaceRoot, '.kanban.json'),
    JSON.stringify({ version: 2, defaultBoard: 'default', boards: { default: { columns: [] } } }),
    'utf-8',
  )
  fs.writeFileSync(
    path.join(kanbanDir, 'boards', 'default', 'backlog', 'runtime-host-card.md'),
    `---
id: "runtime-host-card"
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
# Runtime Host Card

Hosted active-card state.
`,
    'utf-8',
  )
  return { workspaceRoot, kanbanDir }
}

afterEach(() => {
  resetRuntimeHost()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

describe('runtime host active-card overrides', () => {
  it('routes active-card persistence through runtime-host overrides before touching the local sidecar', async () => {
    const { workspaceRoot, kanbanDir } = createWorkspace('hosted-active-card')
    let state: RuntimeHostActiveCardState | null = null

    installRuntimeHost({
      readActiveCardState(scope) {
        expect(scope).toEqual({ workspaceRoot, kanbanDir })
        return state ? structuredClone(state) : null
      },
      writeActiveCardState(scope, nextState) {
        expect(scope).toEqual({ workspaceRoot, kanbanDir })
        state = structuredClone(nextState)
      },
      clearActiveCardState(scope) {
        expect(scope).toEqual({ workspaceRoot, kanbanDir })
        state = null
      },
    })

    const sdk = new KanbanSDK(kanbanDir)

    try {
      await expect(sdk.getActiveCard()).resolves.toBeNull()

      await sdk.setActiveCard('runtime-host-card')
      expect(state).toMatchObject({
        cardId: 'runtime-host-card',
        boardId: 'default',
      })
      expect(fs.existsSync(path.join(kanbanDir, '.active-card.json'))).toBe(false)

      await expect(sdk.getActiveCard()).resolves.toMatchObject({ id: 'runtime-host-card' })

      await sdk.clearActiveCard()
      expect(state).toBeNull()
      await expect(sdk.getActiveCard()).resolves.toBeNull()
    } finally {
      sdk.close()
    }
  })
})

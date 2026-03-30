/**
 * Workspace integration tests for kl-plugin-storage-postgresql.
 *
 * Proves that kl-plugin-storage-postgresql is resolvable via the kanban-lite KanbanSDK in
 * the workspace context WITHOUT requiring a live PostgreSQL service.  Engine-type
 * resolution and storage-status metadata are verified here; service-backed
 * CRUD tests remain in index.integration.test.ts.
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Resolve workspace kanban-lite SDK
// ---------------------------------------------------------------------------

function loadWorkspaceKanbanLiteSdk(): { KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => any } {
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const sdkPath = path.join(dir, 'packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs')
      if (!fs.existsSync(sdkPath)) {
        throw new Error(`kanban-lite SDK not built at: ${sdkPath}\nRun: pnpm build`)
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(sdkPath) as { KanbanSDK: any }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Cannot find workspace root (pnpm-workspace.yaml not found)')
}

const { KanbanSDK } = loadWorkspaceKanbanLiteSdk()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kl-plugin-storage-postgresql: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-pg-ws-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves kl-plugin-storage-postgresql via the "postgresql" provider alias', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: 'postgresql', options: { database: 'kanban_test' } },
      },
    })
    expect(sdk.storageEngine.type).toBe('postgresql')
    sdk.close()
  })

  it('getStorageStatus exposes postgresql as the active card.storage provider', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: 'postgresql', options: { database: 'kanban_test' } },
      },
    })
    const status = sdk.getStorageStatus()
    expect(status.storageEngine).toBe('postgresql')
    expect(status.providers['card.storage'].provider).toBe('postgresql')
    expect(status.isFileBacked).toBe(false)
    sdk.close()
  })

  it('KanbanSDK reads kl-plugin-storage-postgresql from .kanban.json plugins config', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'card.storage': { provider: 'postgresql', options: { database: 'kanban_test' } } },
      }),
    )
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.storageEngine.type).toBe('postgresql')
    sdk.close()
  })
})

/**
 * Workspace integration tests for kl-plugin-storage-sqlite.
 *
 * Proves that kl-plugin-storage-sqlite is resolvable and functional when consumed
 * through the kanban-lite KanbanSDK in the workspace context. The SDK is loaded
 * from the workspace-local build so the full T6 resolution path is exercised:
 *   KanbanSDK → resolveCapabilityBag → loadExternalModule → packages/kl-plugin-storage-sqlite
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

describe('kl-plugin-storage-sqlite: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-sqlite-ws-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves kl-plugin-storage-sqlite via the "sqlite" provider alias', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: path.join(kanbanDir, 'kanban.db') } },
      },
    })
    expect(sdk.storageEngine.type).toBe('sqlite')
    sdk.close()
  })

  it('getStorageStatus exposes sqlite as the active card.storage provider', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: path.join(kanbanDir, 'kanban.db') } },
      },
    })
    const status = sdk.getStorageStatus()
    expect(status.storageEngine).toBe('sqlite')
    expect(status.providers['card.storage'].provider).toBe('sqlite')
    expect(status.isFileBacked).toBe(false)
    sdk.close()
  })

  it('KanbanSDK reads kl-plugin-storage-sqlite from .kanban.json storageEngine config', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({ version: 2, storageEngine: 'sqlite', sqlitePath: '.kanban/kanban.db' }),
    )
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.storageEngine.type).toBe('sqlite')
    sdk.close()
  })
})

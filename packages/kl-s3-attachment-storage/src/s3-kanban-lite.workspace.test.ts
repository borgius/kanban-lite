/**
 * Workspace integration tests for kl-s3-attachment-storage.
 *
 * Proves that kl-s3-attachment-storage is resolved and wired correctly through
 * the kanban-lite KanbanSDK when the `attachment.storage` capability is
 * configured to use the `kl-s3-attachment-storage` provider.  No live S3
 * bucket is required — the tests only assert that plugin resolution and
 * capability metadata work end-to-end inside the monorepo.
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

describe('kl-s3-attachment-storage: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-s3-ws-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves kl-s3-attachment-storage as the attachment provider via capabilities option', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'attachment.storage': { provider: 'kl-s3-attachment-storage' },
      },
    })
    const status = sdk.getStorageStatus()
    expect(status.providers).not.toBeNull()
    expect(status.providers['attachment.storage'].provider).toBe('kl-s3-attachment-storage')
    sdk.close()
  })

  it('card.storage defaults to markdown when only attachment provider is overridden', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'attachment.storage': { provider: 'kl-s3-attachment-storage' },
      },
    })
    const status = sdk.getStorageStatus()
    expect(status.storageEngine).toBe('markdown')
    sdk.close()
  })

  it('KanbanSDK resolves kl-s3-attachment-storage from .kanban.json plugins config', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'attachment.storage': { provider: 'kl-s3-attachment-storage' },
        },
      }),
    )
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getStorageStatus()
    expect(status.providers?.['attachment.storage'].provider).toBe('kl-s3-attachment-storage')
    sdk.close()
  })
})

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
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempKanbanWorkspace, loadWorkspaceKanbanLiteSdk } from '../../kanban-lite/src/test-utils/workspace'

type WorkspaceStorageStatus = {
  isFileBacked: boolean
  providers: Record<string, { provider: string }>
  storageEngine: string
}

type WorkspaceKanbanSdk = {
  close(): void
  getStorageStatus(): WorkspaceStorageStatus
  storageEngine: { type: string }
}

type WorkspaceKanbanLiteSdkModule = {
  KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => WorkspaceKanbanSdk
}

const { KanbanSDK } = loadWorkspaceKanbanLiteSdk<WorkspaceKanbanLiteSdkModule>(__dirname)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kl-plugin-storage-postgresql: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string
  let cleanupWorkspace = () => {}

  beforeEach(() => {
    ;({ workspaceDir, kanbanDir, cleanup: cleanupWorkspace } = createTempKanbanWorkspace('kl-pg-ws-'))
  })

  afterEach(() => {
    cleanupWorkspace()
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

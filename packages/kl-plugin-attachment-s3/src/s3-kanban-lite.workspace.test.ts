/**
 * Workspace integration tests for kl-plugin-attachment-s3.
 *
 * Proves that kl-plugin-attachment-s3 is resolved and wired correctly through
 * the kanban-lite KanbanSDK when the `attachment.storage` capability is
 * configured to use the `kl-plugin-attachment-s3` provider.  No live S3
 * bucket is required — the tests only assert that plugin resolution and
 * capability metadata work end-to-end inside the monorepo.
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempKanbanWorkspace, loadWorkspaceKanbanLiteSdk } from '../../kanban-lite/src/test-utils/workspace'

const { KanbanSDK } = loadWorkspaceKanbanLiteSdk<{ KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => any }>(__dirname)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kl-plugin-attachment-s3: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string
  let cleanupWorkspace = () => {}

  beforeEach(() => {
    ;({ workspaceDir, kanbanDir, cleanup: cleanupWorkspace } = createTempKanbanWorkspace('kl-s3-ws-'))
  })

  afterEach(() => {
    cleanupWorkspace()
  })

  it('KanbanSDK resolves kl-plugin-attachment-s3 as the attachment provider via capabilities option', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'attachment.storage': { provider: 'kl-plugin-attachment-s3' },
      },
    })
    const status = sdk.getStorageStatus()
    expect(status.providers).not.toBeNull()
    expect(status.providers['attachment.storage'].provider).toBe('kl-plugin-attachment-s3')
    sdk.close()
  })

  it('card.storage defaults to markdown when only attachment provider is overridden', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'attachment.storage': { provider: 'kl-plugin-attachment-s3' },
      },
    })
    const status = sdk.getStorageStatus()
    expect(status.storageEngine).toBe('markdown')
    sdk.close()
  })

  it('KanbanSDK resolves kl-plugin-attachment-s3 from .kanban.json plugins config', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'attachment.storage': { provider: 'kl-plugin-attachment-s3' },
        },
      }),
    )
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getStorageStatus()
    expect(status.providers?.['attachment.storage'].provider).toBe('kl-plugin-attachment-s3')
    sdk.close()
  })
})

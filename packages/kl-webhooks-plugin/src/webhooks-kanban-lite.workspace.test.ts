/**
 * Workspace integration tests for kl-webhooks-plugin.
 *
 * Proves that kl-webhooks-plugin is loaded and active when consumed through the
 * kanban-lite KanbanSDK in the workspace context.  KanbanSDK resolves the
 * webhook provider through the "webhooks" alias → packages/kl-webhooks-plugin.
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

describe('kl-webhooks-plugin: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-webhooks-ws-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves kl-webhooks-plugin as the active webhook.delivery provider', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getWebhookStatus()
    expect(status.webhookProvider).toBe('webhooks')
    expect(status.webhookProviderActive).toBe(true)
    sdk.close()
  })

  it('KanbanSDK webhook provider is not the built-in fallback when kl-webhooks-plugin is in workspace', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getWebhookStatus()
    expect(status.webhookProvider).not.toBe('built-in')
    expect(status.webhookProviderActive).toBe(true)
    sdk.close()
  })
})

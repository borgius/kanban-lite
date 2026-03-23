/**
 * Workspace integration tests for kl-auth-plugin.
 *
 * Proves that kl-auth-plugin is loadable and that its RBAC providers are wired
 * correctly through the kanban-lite KanbanSDK when auth is configured via
 * .kanban.json.  The SDK loads kl-auth-plugin from the workspace package at
 * packages/kl-auth-plugin via tryLoadBundledAuthCompatExports().
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

interface WorkspaceAuthStatus {
  identityProvider: string
  policyProvider: string
  identityEnabled: boolean
  policyEnabled: boolean
}

interface WorkspaceAuthDecision {
  allowed: boolean
}

interface WorkspaceKanbanSdk {
  getAuthStatus(): WorkspaceAuthStatus
  _authorizeAction(action: string): Promise<WorkspaceAuthDecision>
  close(): void
}

interface WorkspaceKanbanSdkCtor {
  new (dir: string, opts?: Record<string, unknown>): WorkspaceKanbanSdk
}

// ---------------------------------------------------------------------------
// Resolve workspace kanban-lite SDK
// ---------------------------------------------------------------------------

function loadWorkspaceKanbanLiteSdk(): { KanbanSDK: WorkspaceKanbanSdkCtor } {
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const sdkPath = path.join(dir, 'packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs')
      if (!fs.existsSync(sdkPath)) {
        throw new Error(`kanban-lite SDK not built at: ${sdkPath}\nRun: pnpm build`)
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(sdkPath) as { KanbanSDK: WorkspaceKanbanSdkCtor }
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

describe('kl-auth-plugin: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-auth-ws-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves rbac identity and policy providers from .kanban.json auth config', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        auth: {
          'auth.identity': { provider: 'rbac' },
          'auth.policy': { provider: 'rbac' },
        },
      }),
    )
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getAuthStatus()
    expect(status.identityProvider).toBe('rbac')
    expect(status.policyProvider).toBe('rbac')
    expect(status.identityEnabled).toBe(true)
    expect(status.policyEnabled).toBe(true)
    sdk.close()
  })

  it('KanbanSDK defaults to noop auth providers when no auth config is present', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getAuthStatus()
    expect(status.identityProvider).toBe('noop')
    expect(status.policyProvider).toBe('noop')
    expect(status.identityEnabled).toBe(false)
    expect(status.policyEnabled).toBe(false)
    sdk.close()
  })

  it('noop identity plugin from kl-auth-plugin allows _authorizeAction without credentials', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    const decision = await sdk._authorizeAction('card.create')
    expect(decision.allowed).toBe(true)
    sdk.close()
  })
})

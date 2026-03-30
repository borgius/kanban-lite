/**
 * Workspace integration tests for kl-plugin-auth.
 *
 * Proves that kl-plugin-auth is loadable and that its RBAC providers are wired
 * correctly through the kanban-lite KanbanSDK when auth is configured via
 * .kanban.json.  The SDK loads kl-plugin-auth from the workspace package at
 * packages/kl-plugin-auth via tryLoadBundledAuthCompatExports().
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cliPlugin, createStandaloneHttpPlugin, type StandaloneHttpPluginRegistrationOptions } from './index'

interface WorkspaceAuthStatus {
  identityProvider: string
  policyProvider: string
  identityEnabled: boolean
  policyEnabled: boolean
}

interface WorkspaceAuthDecision {
  allowed: boolean
}

interface WorkspaceProviderConfig {
  provider?: string
  options?: Record<string, unknown>
}

interface WorkspaceConfigSnapshot {
  auth?: Record<string, WorkspaceProviderConfig>
  plugins?: Record<string, WorkspaceProviderConfig>
}

interface WorkspaceKanbanSdk {
  getAuthStatus(): WorkspaceAuthStatus
  getConfigSnapshot(): WorkspaceConfigSnapshot
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

function writeLocalAuthConfig(
  workspaceDir: string,
  options: { apiToken: string; roles?: string[]; users?: Array<{ username: string; password: string; role?: string }> },
): void {
  fs.writeFileSync(
    path.join(workspaceDir, '.kanban.json'),
    JSON.stringify(
      {
        version: 2,
        auth: {
          'auth.identity': {
            provider: 'kl-plugin-auth',
            options: {
              apiToken: options.apiToken,
              roles: options.roles ?? ['user', 'manager', 'admin'],
              users: options.users ?? [],
            },
          },
          'auth.policy': { provider: 'kl-plugin-auth' },
        },
      },
      null,
      2,
    ) + '\n',
  )
}

function makeStandaloneOptions(
  workspaceDir: string,
  kanbanDir: string,
  overrides: Partial<StandaloneHttpPluginRegistrationOptions> = {},
): StandaloneHttpPluginRegistrationOptions {
  return {
    workspaceRoot: workspaceDir,
    kanbanDir,
    capabilities: {
      'card.storage': { provider: 'builtin' },
      'attachment.storage': { provider: 'builtin' },
    },
    authCapabilities: {
      'auth.identity': { provider: 'noop' },
      'auth.policy': { provider: 'noop' },
    },
    webhookCapabilities: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kl-plugin-auth: consumption via kanban-lite workspace SDK', () => {
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

  it('noop identity plugin from kl-plugin-auth allows _authorizeAction without credentials', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    const decision = await sdk._authorizeAction('card.create')
    expect(decision.allowed).toBe(true)
    sdk.close()
  })

  it('standalone plugin prefers sdk auth snapshot over narrowed authCapabilities for local-auth reads', () => {
    const savedToken = process.env.KANBAN_LITE_TOKEN
    const savedAlt = process.env.KANBAN_TOKEN
    delete process.env.KANBAN_LITE_TOKEN
    delete process.env.KANBAN_TOKEN

    writeLocalAuthConfig(workspaceDir, {
      apiToken: 'snapshot-only-token',
      users: [{ username: 'alice', password: '$2b$12$existing-hash', role: 'admin' }],
    })

    const sdk = new KanbanSDK(kanbanDir)
    try {
      const plugin = createStandaloneHttpPlugin(
        makeStandaloneOptions(workspaceDir, kanbanDir, {
          sdk: sdk as unknown as StandaloneHttpPluginRegistrationOptions['sdk'],
          authCapabilities: {
            'auth.identity': { provider: 'noop' },
            'auth.policy': { provider: 'noop' },
          },
        }),
      )

      expect(plugin.registerMiddleware?.()).toHaveLength(1)
      expect(plugin.registerRoutes?.()).toHaveLength(3)
    } finally {
      sdk.close()
      if (savedToken === undefined) delete process.env.KANBAN_LITE_TOKEN
      else process.env.KANBAN_LITE_TOKEN = savedToken
      if (savedAlt === undefined) delete process.env.KANBAN_TOKEN
      else process.env.KANBAN_TOKEN = savedAlt
    }
  })

  it('cli auth create-user prefers sdk config snapshot reads before direct config writes', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`)
    }) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(
        cliPlugin.run(
          ['create-user'],
          { username: 'alice', password: 'secret' },
          {
            workspaceRoot: workspaceDir,
            sdk: {
              getConfigSnapshot: () => ({
                plugins: {
                  'auth.identity': {
                    provider: 'kl-plugin-auth',
                    options: {
                      users: [{ username: 'alice', password: '$2b$12$existing-hash' }],
                    },
                  },
                },
              }),
            } as unknown as WorkspaceKanbanSdk,
          },
        ),
      ).rejects.toThrow('process.exit:1')

      expect(errorSpy).toHaveBeenCalledWith('User "alice" already exists.')
      expect(fs.existsSync(path.join(workspaceDir, '.kanban.json'))).toBe(false)
    } finally {
      errorSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })

  it('cli auth create-user persists an optional role and seeds the default role catalog before appending new roles', async () => {
    await cliPlugin.run(
      ['create-user'],
      {
        username: 'alice',
        password: 'secret',
        role: 'auditor',
      },
      { workspaceRoot: workspaceDir },
    )

    const saved = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8')) as {
      plugins?: {
        'auth.identity'?: {
          options?: {
            roles?: string[]
            users?: Array<{ username: string; role?: string; password?: string }>
          }
        }
      }
    }

    expect(saved.plugins?.['auth.identity']?.options?.roles).toEqual(['user', 'manager', 'admin', 'auditor'])

    expect(saved.plugins?.['auth.identity']?.options?.users).toEqual([
      expect.objectContaining({
        username: 'alice',
        role: 'auditor',
      }),
    ])
    expect(saved.plugins?.['auth.identity']?.options?.users?.[0]?.password).toMatch(/^\$2[aby]\$/)
  })
})

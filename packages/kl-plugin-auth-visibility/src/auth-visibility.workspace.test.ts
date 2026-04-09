/**
 * Workspace integration tests for kl-plugin-auth-visibility.
 *
 * Proves that the first-party auth.visibility provider is loadable through the
 * workspace-local kanban-lite SDK and that SDK-owned role normalization still
 * drives the package contract correctly.
 *
 * Prerequisites: run `pnpm build` (or `pnpm --filter kanban-lite build`) first.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempKanbanWorkspace, findWorkspaceRoot, loadWorkspaceKanbanLiteSdk } from '../../kanban-lite/src/test-utils/workspace'

interface WorkspaceCard {
  id: string
}

interface WorkspaceKanbanSdk {
  init(): Promise<void>
  close(): void
  createCard(input: {
    content: string
    labels?: string[]
    status?: string
    priority?: string
  }): Promise<WorkspaceCard>
  getCard(cardId: string, boardId?: string): Promise<WorkspaceCard | null>
  listCards(columns?: string[], boardId?: string): Promise<WorkspaceCard[]>
  runWithAuth<T>(context: { token?: string }, fn: () => Promise<T>): Promise<T>
}

interface WorkspaceKanbanSdkCtor {
  new (dir: string, opts?: Record<string, unknown>): WorkspaceKanbanSdk
}

const WORKSPACE_ROOT = findWorkspaceRoot(__dirname)
const { KanbanSDK } = loadWorkspaceKanbanLiteSdk<{ KanbanSDK: WorkspaceKanbanSdkCtor }>(__dirname)
const runtimeRequire = createRequire(import.meta.url)

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(WORKSPACE_ROOT, 'node_modules', packageName)
  let backupDir: string | null = null

  const clearPackageCache = (): void => {
    for (const candidate of [packageName, packageDir]) {
      try {
        const resolved = runtimeRequire.resolve(candidate)
        delete runtimeRequire.cache[resolved]
      } catch {
        // Ignore paths that are not currently resolvable.
      }
    }
  }

  if (fs.existsSync(packageDir)) {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-backup-`))
    fs.cpSync(packageDir, backupDir, { recursive: true })
    fs.rmSync(packageDir, { recursive: true, force: true })
  }

  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, main: 'index.js' }, null, 2),
    'utf-8',
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), entrySource, 'utf-8')
  clearPackageCache()

  return () => {
    clearPackageCache()
    fs.rmSync(packageDir, { recursive: true, force: true })
    if (backupDir) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.cpSync(backupDir, packageDir, { recursive: true })
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
    clearPackageCache()
  }
}

describe('kl-plugin-auth-visibility: consumption via kanban-lite workspace SDK', () => {
  let workspaceDir: string
  let kanbanDir: string
  let cleanupWorkspace = () => {}

  beforeEach(() => {
    ;({ workspaceDir, kanbanDir, cleanup: cleanupWorkspace } = createTempKanbanWorkspace('kl-auth-visibility-ws-'))
  })

  afterEach(() => {
    cleanupWorkspace()
  })

  it('loads the workspace package and enforces role-only visibility semantics through the SDK', async () => {
    const cleanup = installTempPackage(
      'temp-auth-visibility-auth',
      `module.exports = {
  pluginManifest: {
    id: 'temp-auth-visibility-auth',
    capabilities: { 'auth.identity': ['temp-auth-visibility-auth'] },
  },
  authIdentityPlugins: {
    'temp-auth-visibility-auth': {
      manifest: { id: 'temp-auth-visibility-auth', provides: ['auth.identity'] },
      async resolveIdentity(context) {
        if (context.token === 'reader-token') return { subject: 'alice', roles: ['reader'] }
        if (context.token === 'emptyroles-token') return { subject: 'alice', roles: [] }
        if (context.token === 'manager-token') return { subject: 'manager', roles: ['manager'] }
        return null
      },
    },
  },
}
`,
    )

    try {
      fs.writeFileSync(
        path.join(workspaceDir, '.kanban.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'auth.identity': { provider: 'temp-auth-visibility-auth' },
            'auth.visibility': {
              provider: 'kl-plugin-auth-visibility',
              options: {
                rules: [
                  {
                    roles: ['reader'],
                    labels: ['public'],
                  },
                ],
              },
            },
          },
        }, null, 2),
        'utf-8',
      )

      const sdk = new KanbanSDK(kanbanDir)

      try {
        await sdk.init()
        const publicCard = await sdk.createCard({ content: '# Public', labels: ['public'] })
        const privateCard = await sdk.createCard({ content: '# Private', labels: ['private'] })

        await sdk.runWithAuth({ token: 'reader-token' }, async () => {
          await expect(sdk.listCards()).resolves.toMatchObject([
            expect.objectContaining({ id: publicCard.id }),
          ])
          await expect(sdk.getCard(privateCard.id)).resolves.toBeNull()
        })

        await sdk.runWithAuth({ token: 'emptyroles-token' }, async () => {
          await expect(sdk.listCards()).resolves.toEqual([])
        })

        await sdk.runWithAuth({ token: 'manager-token' }, async () => {
          await expect(sdk.listCards()).resolves.toEqual([])
        })
      } finally {
        sdk.close()
      }
    } finally {
      cleanup()
    }
  })
})

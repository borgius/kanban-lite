import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-card-state-sqlite-ws-'))
}

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Cannot find workspace root (pnpm-workspace.yaml not found)')
}

function loadWorkspaceKanbanLiteSdk(): {
  KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => any
  ERR_CARD_STATE_IDENTITY_UNAVAILABLE: string
} {
  const workspaceRoot = findWorkspaceRoot(__dirname)
  const sdkPath = path.join(workspaceRoot, 'packages', 'kanban-lite', 'dist', 'sdk', 'index.cjs')
  if (!fs.existsSync(sdkPath)) {
    throw new Error(`kanban-lite SDK not built at: ${sdkPath}\nRun: pnpm build`)
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(sdkPath) as {
    KanbanSDK: new (dir: string, opts?: Record<string, unknown>) => any
    ERR_CARD_STATE_IDENTITY_UNAVAILABLE: string
  }
}

const { KanbanSDK, ERR_CARD_STATE_IDENTITY_UNAVAILABLE } = loadWorkspaceKanbanLiteSdk()
const runtimeRequire = createRequire(import.meta.url)
const WORKSPACE_ROOT = findWorkspaceRoot(__dirname)

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(WORKSPACE_ROOT, 'node_modules', packageName)
  let backupDir: string | null = null

  const clearPackageCache = (): void => {
    for (const candidate of [packageName, packageDir]) {
      try {
        const resolved = runtimeRequire.resolve(candidate)
        delete runtimeRequire.cache[resolved]
      } catch {
        // ignore unresolved packages
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

function writeWorkspaceConfig(workspaceDir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify({ version: 2, ...config }), 'utf-8')
}

function createBackendConfig(backend: 'builtin' | 'sqlite'): Record<string, unknown> {
  return backend === 'sqlite'
    ? { plugins: { 'card.state': { provider: 'sqlite', options: { sqlitePath: '.kanban/card-state.db' } } } }
    : {}
}

async function createSdk(backend: 'builtin' | 'sqlite', extraConfig: Record<string, unknown> = {}) {
  const workspaceDir = createTempDir()
  const kanbanDir = path.join(workspaceDir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  writeWorkspaceConfig(workspaceDir, { ...createBackendConfig(backend), ...extraConfig })
  const sdk = new KanbanSDK(kanbanDir)
  await sdk.init()
  return { workspaceDir, kanbanDir, sdk }
}

function stripDynamicUnreadSnapshot(result: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>
}

async function runUnreadParityScenario(backend: 'builtin' | 'sqlite'): Promise<Record<string, unknown>> {
  const { workspaceDir, sdk } = await createSdk(backend)

  try {
    const card = await sdk.createCard({ content: `# ${backend} unread parity` })
    await sdk.addLog(card.id, 'Initial unread activity')

    const status = sdk.getCardStateStatus()
    const initial = await sdk.getUnreadSummary(card.id)
    const opened = await sdk.markCardOpened(card.id)
    const openState = await sdk.getCardState(card.id, undefined, 'open')

    await sdk.addLog(card.id, 'Unread again after opening')

    const afterFollowUpActivity = await sdk.getUnreadSummary(card.id)
    const read = await sdk.markCardRead(card.id)
    const unreadState = await sdk.getCardState(card.id, undefined, 'unread')

    return stripDynamicUnreadSnapshot({
      defaultActorId: status.defaultActor.id,
      defaultActorMode: status.defaultActorMode,
      defaultActorAvailable: status.defaultActorAvailable,
      initial: {
        actorId: initial.actorId,
        unread: initial.unread,
        hasLatestActivity: initial.latestActivity != null,
        readThrough: initial.readThrough,
      },
      opened: {
        actorId: opened.actorId,
        unread: opened.unread,
        hasLatestActivity: opened.latestActivity != null,
        openStateReadThroughMatchesLatest: openState?.value?.['readThrough']?.['cursor'] === opened.latestActivity?.cursor,
      },
      afterFollowUpActivity: {
        actorId: afterFollowUpActivity.actorId,
        unread: afterFollowUpActivity.unread,
        latestCursorAdvanced: afterFollowUpActivity.latestActivity?.cursor !== opened.latestActivity?.cursor,
      },
      read: {
        actorId: read.actorId,
        unread: read.unread,
        unreadStateCursorMatchesLatest: unreadState?.value?.['cursor'] === read.latestActivity?.cursor,
      },
    })
  } finally {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  }
}

async function runActorScopingScenario(backend: 'builtin' | 'sqlite'): Promise<Record<string, unknown>> {
  const { workspaceDir, sdk } = await createSdk(backend, {
    auth: {
      'auth.identity': { provider: 'card-state-auth-test' },
      'auth.policy': { provider: 'noop' },
    },
  })

  try {
    const card = await sdk.createCard({ content: `# ${backend} actor scoping` })
    await sdk.addLog(card.id, 'Scoped unread activity')

    const aliceBefore = await sdk.runWithAuth({ token: 'alice' }, async () => sdk.getUnreadSummary(card.id))
    await sdk.runWithAuth({ token: 'alice' }, async () => sdk.markCardRead(card.id))
    const aliceAfter = await sdk.runWithAuth({ token: 'alice' }, async () => sdk.getUnreadSummary(card.id))
    const bob = await sdk.runWithAuth({ token: 'bob' }, async () => sdk.getUnreadSummary(card.id))

    return stripDynamicUnreadSnapshot({
      unauthenticatedErrorCode: await sdk.getUnreadSummary(card.id)
        .then(() => 'unexpected-success')
        .catch((error: { code?: string }) => error.code ?? 'unknown-error'),
      alice: {
        actorId: aliceBefore.actorId,
        unreadBeforeRead: aliceBefore.unread,
        unreadAfterRead: aliceAfter.unread,
      },
      bob: {
        actorId: bob.actorId,
        unread: bob.unread,
      },
    })
  } finally {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  }
}

async function runIdentityFailureScenario(backend: 'builtin' | 'sqlite'): Promise<string[]> {
  const { workspaceDir, sdk } = await createSdk(backend, {
    auth: {
      'auth.identity': { provider: 'card-state-auth-failure-test' },
      'auth.policy': { provider: 'noop' },
    },
  })

  try {
    const card = await sdk.createCard({ content: `# ${backend} identity failure parity` })
    await sdk.addLog(card.id, 'Unread activity requiring identity')

    const operations = [
      () => sdk.getUnreadSummary(card.id),
      () => sdk.markCardOpened(card.id),
      () => sdk.markCardRead(card.id),
      () => sdk.runWithAuth({ token: 'explode' }, async () => sdk.getUnreadSummary(card.id)),
    ]

    const codes: string[] = []
    for (const operation of operations) {
      try {
        await operation()
        codes.push('unexpected-success')
      } catch (error) {
        codes.push((error as { code?: string }).code ?? 'unknown-error')
      }
    }

    return codes
  } finally {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('kl-plugin-card-state-sqlite via workspace KanbanSDK', () => {
  afterEach(() => {
    // package installers are cleaned inside each test
  })

  it('is discoverable as a workspace package with the expected manifest name', () => {
    const workspaceRoot = findWorkspaceRoot(__dirname)
    const packageJsonPath = path.join(workspaceRoot, 'packages', 'kl-plugin-card-state-sqlite', 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string }

    expect(packageJson.name).toBe('kl-plugin-card-state-sqlite')
  })

  it('matches builtin unread/open/read semantics in auth-absent mode', async () => {
    const builtin = await runUnreadParityScenario('builtin')
    const sqlite = await runUnreadParityScenario('sqlite')

    expect(sqlite).toEqual(builtin)
  })

  it('matches builtin actor scoping semantics when auth identities are configured', async () => {
    const cleanup = installTempPackage(
      'card-state-auth-test',
      `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'card-state-auth-test', provides: ['auth.identity'] },
    async resolveIdentity(context) {
      if (!context || !context.token) return null
      const token = context.token.startsWith('Bearer ') ? context.token.slice(7) : context.token
      return { subject: 'user-' + token, roles: ['user'] }
    },
  },
}
`,
    )

    try {
      const builtin = await runActorScopingScenario('builtin')
      const sqlite = await runActorScopingScenario('sqlite')

      expect(builtin).toEqual({
        unauthenticatedErrorCode: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
        alice: { actorId: 'user-alice', unreadBeforeRead: true, unreadAfterRead: false },
        bob: { actorId: 'user-bob', unread: true },
      })
      expect(sqlite).toEqual(builtin)
    } finally {
      cleanup()
    }
  })

  it('does not mask configured identity failures with the default actor fallback', async () => {
    const cleanup = installTempPackage(
      'card-state-auth-failure-test',
      `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'card-state-auth-failure-test', provides: ['auth.identity'] },
    async resolveIdentity(context) {
      if (!context || !context.token) return null
      if (context.token === 'explode') throw new Error('identity backend offline')
      return { subject: 'user-' + context.token, roles: ['user'] }
    },
  },
}
`,
    )

    try {
      const builtin = await runIdentityFailureScenario('builtin')
      const sqlite = await runIdentityFailureScenario('sqlite')

      expect(builtin).toEqual([
        ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
        ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
        ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
        ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
      ])
      expect(sqlite).toEqual(builtin)
    } finally {
      cleanup()
    }
  })
})

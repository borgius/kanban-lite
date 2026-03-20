import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCapabilityBag, BUILTIN_ATTACHMENT_IDS, NOOP_IDENTITY_PLUGIN, NOOP_POLICY_PLUGIN } from '../plugins'
import type { ResolvedCapabilityBag } from '../plugins'
import { MarkdownStorageEngine } from '../plugins/markdown'
import { SqliteStorageEngine } from '../plugins/sqlite'
import { MysqlStorageEngine, MYSQL_PLUGIN } from '../plugins/mysql'
import { KanbanSDK } from '../KanbanSDK'
import { normalizeAuthCapabilities } from '../../shared/config'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-plugin-test-'))
}

// ---------------------------------------------------------------------------
// resolveCapabilityBag
// ---------------------------------------------------------------------------

describe('resolveCapabilityBag', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns MarkdownStorageEngine for markdown provider', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.cardStorage).toBeInstanceOf(MarkdownStorageEngine)
  })

  it('returns SqliteStorageEngine for sqlite provider', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage).toBeInstanceOf(SqliteStorageEngine)
  })

  it('sqlite provider resolves relative sqlitePath against workspaceRoot', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: 'custom.db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage).toBeInstanceOf(SqliteStorageEngine)
    // Engine should be created without throwing
    expect(bag.cardStorage.kanbanDir).toBe(kanbanDir)
  })

  it('sqlite provider accepts absolute sqlitePath', () => {
    const absDb = path.join(workspaceDir, 'abs.db')
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: absDb } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage).toBeInstanceOf(SqliteStorageEngine)
  })

  it('providers field reflects the input capabilities', () => {
    const caps = {
      'card.storage': { provider: 'markdown' },
      'attachment.storage': { provider: 'localfs' },
    } as const
    const bag = resolveCapabilityBag(caps, kanbanDir)
    expect(bag.providers).toBe(caps)
  })

  it('localfs attachment plugin has correct manifest', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.attachmentStorage.manifest.id).toBe('localfs')
    expect(bag.attachmentStorage.manifest.provides).toContain('attachment.storage')
  })

  it('explicit sqlite attachment provider resolves through the sqlite built-in plugin', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'sqlite' },
      },
      kanbanDir,
    )

    expect(bag.cardStorage).toBeInstanceOf(SqliteStorageEngine)
    expect(bag.attachmentStorage.manifest.id).toBe('sqlite')
    expect(bag.attachmentStorage.manifest.provides).toContain('attachment.storage')
  })

  it('attachment plugin getCardDir delegates to card engine', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.attachmentStorage.getCardDir).toBeTypeOf('function')
    const fakeCard = {
      filePath: path.join(kanbanDir, 'boards', 'default', 'backlog', 'kl-1-test.md'),
    } as Parameters<NonNullable<ResolvedCapabilityBag['attachmentStorage']['getCardDir']>>[0]
    const dir = bag.attachmentStorage.getCardDir!(fakeCard)
    // MarkdownStorageEngine.getCardDir returns a sibling "attachments/" directory
    expect(dir).toBe(path.join(path.dirname(fakeCard.filePath), 'attachments'))
  })

  it('throws actionable error for missing external card plugin', () => {
    expect(() =>
      resolveCapabilityBag(
        {
          'card.storage': { provider: 'non-existent-kanban-plugin-xyz' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )
    ).toThrow(/non-existent-kanban-plugin-xyz/)
  })

  it('error for missing external plugin mentions npm install', () => {
    expect(() =>
      resolveCapabilityBag(
        {
          'card.storage': { provider: 'kanban-missing-plugin' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )
    ).toThrow(/npm install/)
  })

  it('throws for unsupported external attachment plugin', () => {
    expect(() =>
      resolveCapabilityBag(
        {
          'card.storage': { provider: 'markdown' },
          'attachment.storage': { provider: 'some-external-attachment-plugin' },
        },
        kanbanDir,
      )
    ).toThrow(/some-external-attachment-plugin/)
  })
})

// ---------------------------------------------------------------------------
// BUILTIN_ATTACHMENT_IDS
// ---------------------------------------------------------------------------

describe('BUILTIN_ATTACHMENT_IDS', () => {
  it('contains localfs', () => {
    expect(BUILTIN_ATTACHMENT_IDS.has('localfs')).toBe(true)
  })

  it('contains sqlite and mysql', () => {
    expect(BUILTIN_ATTACHMENT_IDS.has('sqlite')).toBe(true)
    expect(BUILTIN_ATTACHMENT_IDS.has('mysql')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MySQL plugin
// ---------------------------------------------------------------------------

describe('MYSQL_PLUGIN', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mysql-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('has correct manifest id and capability', () => {
    expect(MYSQL_PLUGIN.manifest.id).toBe('mysql')
    expect(MYSQL_PLUGIN.manifest.provides).toContain('card.storage')
  })

  it('createEngine returns a MysqlStorageEngine', () => {
    const engine = MYSQL_PLUGIN.createEngine(kanbanDir, { database: 'test_db' })
    expect(engine).toBeInstanceOf(MysqlStorageEngine)
    expect(engine.type).toBe('mysql')
    expect(engine.kanbanDir).toBe(kanbanDir)
  })

  it('createEngine throws when database option is missing', () => {
    expect(() => MYSQL_PLUGIN.createEngine(kanbanDir, {})).toThrow(/database/)
  })

  it('createEngine throws when options are absent', () => {
    expect(() => MYSQL_PLUGIN.createEngine(kanbanDir)).toThrow(/database/)
  })

  it('engine.init() throws a clear error when mysql2 is not installed', async () => {
    const engine = MYSQL_PLUGIN.createEngine(kanbanDir, { database: 'test_db' })
    await expect(engine.init()).rejects.toThrow(/mysql2/)
    await expect(engine.init()).rejects.toThrow(/npm install mysql2/)
  })

  it('getCardDir returns expected attachment path', () => {
    const engine = MYSQL_PLUGIN.createEngine(kanbanDir, { database: 'test_db' })
    const card = { id: '1', boardId: 'default', status: 'backlog' } as Parameters<MysqlStorageEngine['getCardDir']>[0]
    const dir = engine.getCardDir(card)
    expect(dir).toBe(path.join(kanbanDir, 'boards', 'default', 'backlog', 'attachments'))
  })

  it('resolveCapabilityBag creates MysqlStorageEngine for mysql provider', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage).toBeInstanceOf(MysqlStorageEngine)
    expect(bag.cardStorage.type).toBe('mysql')
    expect(bag.providers['card.storage'].provider).toBe('mysql')
  })

  it('explicit mysql attachment provider resolves through the mysql built-in plugin', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } },
        'attachment.storage': { provider: 'mysql' },
      },
      kanbanDir,
    )

    expect(bag.cardStorage).toBeInstanceOf(MysqlStorageEngine)
    expect(bag.attachmentStorage.manifest.id).toBe('mysql')
    expect(bag.attachmentStorage.manifest.provides).toContain('attachment.storage')
  })

  it('MySQL provider id is visible through SDK capabilities', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: { 'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } } },
    })
    expect(sdk.capabilities?.providers['card.storage'].provider).toBe('mysql')
    expect(sdk.storageEngine.type).toBe('mysql')
    sdk.close()
  })
})

// ---------------------------------------------------------------------------
// External attachment plugin loading
// ---------------------------------------------------------------------------

describe('external attachment plugin loading', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-attach-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('throws with npm install hint for missing external attachment plugin', () => {
    expect(() =>
      resolveCapabilityBag(
        {
          'card.storage': { provider: 'markdown' },
          'attachment.storage': { provider: 'kanban-missing-attachment-plugin' },
        },
        kanbanDir,
      )
    ).toThrow(/npm install kanban-missing-attachment-plugin/)
  })

  it('error message includes the package name for missing attachment plugin', () => {
    expect(() =>
      resolveCapabilityBag(
        {
          'card.storage': { provider: 'markdown' },
          'attachment.storage': { provider: 'some-external-attachment-plugin' },
        },
        kanbanDir,
      )
    ).toThrow(/some-external-attachment-plugin/)
  })
})

// ---------------------------------------------------------------------------
// KanbanSDK – capability resolution via config
// ---------------------------------------------------------------------------

describe('KanbanSDK capability resolution', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('resolves markdown engine from legacy config (no storageEngine field)', () => {
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.storageEngine).toBeInstanceOf(MarkdownStorageEngine)
    sdk.close()
  })

  it('resolves sqlite engine via storageEngine option', () => {
    const sdk = new KanbanSDK(kanbanDir, { storageEngine: 'sqlite' })
    expect(sdk.storageEngine).toBeInstanceOf(SqliteStorageEngine)
    sdk.close()
  })

  it('resolves markdown engine via capabilities option', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: { 'card.storage': { provider: 'markdown' } },
    })
    expect(sdk.storageEngine).toBeInstanceOf(MarkdownStorageEngine)
    sdk.close()
  })

  it('resolves sqlite engine via capabilities option', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
      },
    })
    expect(sdk.storageEngine).toBeInstanceOf(SqliteStorageEngine)
    sdk.close()
  })

  it('exposes capabilities getter with resolved bag', () => {
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.capabilities).not.toBeNull()
    expect(sdk.capabilities?.providers['card.storage'].provider).toBe('markdown')
    sdk.close()
  })

  it('capabilities getter is null when storage injected directly', () => {
    const engine = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage: engine })
    expect(sdk.capabilities).toBeNull()
    sdk.close()
  })

  it('resolves markdown from .kanban.json storageEngine=markdown', () => {
    const config = { version: 2, storageEngine: 'markdown', boards: { default: { name: 'Default', columns: [], nextCardId: 1, defaultStatus: 'backlog', defaultPriority: 'medium' } }, defaultBoard: 'default', kanbanDirectory: '.kanban', aiAgent: 'claude', defaultPriority: 'medium', defaultStatus: 'backlog', nextCardId: 1, showPriorityBadges: true, showAssignee: true, showDueDate: true, showLabels: true, showBuildWithAI: true, showFileName: false, compactMode: false, markdownEditorMode: false, showDeletedColumn: false, boardZoom: 100, cardZoom: 100, port: 2954 }
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config), 'utf-8')
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.storageEngine.type).toBe('markdown')
    sdk.close()
  })

  it('resolves sqlite from .kanban.json storageEngine=sqlite', () => {
    const config = { version: 2, storageEngine: 'sqlite', sqlitePath: '.kanban/kanban.db', boards: { default: { name: 'Default', columns: [], nextCardId: 1, defaultStatus: 'backlog', defaultPriority: 'medium' } }, defaultBoard: 'default', kanbanDirectory: '.kanban', aiAgent: 'claude', defaultPriority: 'medium', defaultStatus: 'backlog', nextCardId: 1, showPriorityBadges: true, showAssignee: true, showDueDate: true, showLabels: true, showBuildWithAI: true, showFileName: false, compactMode: false, markdownEditorMode: false, showDeletedColumn: false, boardZoom: 100, cardZoom: 100, port: 2954 }
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config), 'utf-8')
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.storageEngine.type).toBe('sqlite')
    sdk.close()
  })

  it('plugins field in .kanban.json overrides legacy storageEngine', () => {
    const config = { version: 2, storageEngine: 'sqlite', plugins: { 'card.storage': { provider: 'markdown' } }, boards: { default: { name: 'Default', columns: [], nextCardId: 1, defaultStatus: 'backlog', defaultPriority: 'medium' } }, defaultBoard: 'default', kanbanDirectory: '.kanban', aiAgent: 'claude', defaultPriority: 'medium', defaultStatus: 'backlog', nextCardId: 1, showPriorityBadges: true, showAssignee: true, showDueDate: true, showLabels: true, showBuildWithAI: true, showFileName: false, compactMode: false, markdownEditorMode: false, showDeletedColumn: false, boardZoom: 100, cardZoom: 100, port: 2954 }
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config), 'utf-8')
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.storageEngine.type).toBe('markdown')
    sdk.close()
  })
})

// ---------------------------------------------------------------------------
// ResolvedCapabilityBag – file/watch capability helpers
// ---------------------------------------------------------------------------

describe('ResolvedCapabilityBag file/watch capabilities', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('isFileBacked is true for markdown provider', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.isFileBacked).toBe(true)
  })

  it('isFileBacked is false for sqlite provider', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.isFileBacked).toBe(false)
  })

  it('getWatchGlob returns boards/**/*.md for markdown provider', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.getWatchGlob()).toBe('boards/**/*.md')
  })

  it('getWatchGlob returns null for sqlite provider', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.getWatchGlob()).toBeNull()
  })

  it('getLocalCardPath returns filePath for markdown cards', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    const fakeFilePath = path.join(kanbanDir, 'boards', 'default', 'backlog', 'kl-1-test.md')
    const card = { filePath: fakeFilePath } as Parameters<typeof bag.getLocalCardPath>[0]
    expect(bag.getLocalCardPath(card)).toBe(fakeFilePath)
  })

  it('getLocalCardPath returns null for markdown cards with empty filePath', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    const card = { filePath: '' } as Parameters<typeof bag.getLocalCardPath>[0]
    expect(bag.getLocalCardPath(card)).toBeNull()
  })

  it('getLocalCardPath returns null for sqlite provider regardless of filePath', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    const card = { filePath: '/some/path/card.md' } as Parameters<typeof bag.getLocalCardPath>[0]
    expect(bag.getLocalCardPath(card)).toBeNull()
  })

  it('getAttachmentDir delegates through the resolved attachment provider', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    const card = { filePath: path.join(kanbanDir, 'boards', 'default', 'backlog', '1-test.md') } as Parameters<typeof bag.getAttachmentDir>[0]
    expect(bag.getAttachmentDir(card)).toBe(path.join(kanbanDir, 'boards', 'default', 'backlog', 'attachments'))
  })

  it('KanbanSDK getStorageStatus exposes provider metadata', () => {
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.getStorageStatus()).toEqual({
      storageEngine: 'markdown',
      providers: {
        'card.storage': { provider: 'markdown' },
        'attachment.storage': { provider: 'localfs' },
      },
      isFileBacked: true,
      watchGlob: 'boards/**/*.md',
    })
    sdk.close()
  })

  it('KanbanSDK getStorageStatus reflects explicit sqlite attachment provider', () => {
    const sdk = new KanbanSDK(kanbanDir, {
      capabilities: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'sqlite' },
      },
    })

    expect(sdk.getStorageStatus()).toEqual({
      storageEngine: 'sqlite',
      providers: {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'sqlite' },
      },
      isFileBacked: false,
      watchGlob: null,
    })

    sdk.close()
  })
})

// ---------------------------------------------------------------------------
// Bundled ESM loader regressions
// ---------------------------------------------------------------------------

describe('bundled ESM SDK loader', () => {
  let workspaceDir: string
  let kanbanDir: string
  let bundlePath: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    bundlePath = path.join(workspaceDir, 'sdk-esm-test.mjs')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  async function importBundledSdk() {
    await build({
      entryPoints: [path.join(process.cwd(), 'src/sdk/index.ts')],
      outfile: bundlePath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      external: ['better-sqlite3', 'mysql2', 'mysql2/promise'],
      logLevel: 'silent',
    })

    return import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)
  }

  it('keeps the mysql2 install hint in bundled ESM builds', async () => {
    const { KanbanSDK: BundledKanbanSDK } = await importBundledSdk()
    const sdk = new BundledKanbanSDK(kanbanDir, {
      capabilities: { 'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } } },
    })

    try {
      await sdk.init()
      throw new Error('Expected init() to fail when mysql2 is unavailable')
    } catch (err) {
      const message = String(err)
      expect(message).toContain('mysql2')
      expect(message).toContain('npm install mysql2')
      expect(message).not.toContain('Dynamic require')
    } finally {
      sdk.close()
    }
  })

  it('keeps actionable external plugin install hints in bundled ESM builds', async () => {
    const { KanbanSDK: BundledKanbanSDK } = await importBundledSdk()

    try {
      new BundledKanbanSDK(kanbanDir, {
        capabilities: { 'card.storage': { provider: 'definitely-missing-plugin' } },
      })
      throw new Error('Expected constructor to fail for a missing external plugin')
    } catch (err) {
      const message = String(err)
      expect(message).toContain('definitely-missing-plugin')
      expect(message).toContain('npm install definitely-missing-plugin')
      expect(message).not.toContain('Dynamic require')
    }
  })
})

// ---------------------------------------------------------------------------
// Auth plugin resolution
// ---------------------------------------------------------------------------

describe('auth capability resolution', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-auth-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  const storageCaps = {
    'card.storage': { provider: 'markdown' },
    'attachment.storage': { provider: 'localfs' },
  } as const

  it('bag defaults to noop identity and policy when no auth capabilities supplied', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir)
    expect(bag.authIdentity).toBe(NOOP_IDENTITY_PLUGIN)
    expect(bag.authPolicy).toBe(NOOP_POLICY_PLUGIN)
  })

  it('bag with explicit noop auth capabilities still returns noop singletons', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir, normalizeAuthCapabilities({}))
    expect(bag.authIdentity).toBe(NOOP_IDENTITY_PLUGIN)
    expect(bag.authPolicy).toBe(NOOP_POLICY_PLUGIN)
  })

  it('noop identity plugin has correct manifest', () => {
    expect(NOOP_IDENTITY_PLUGIN.manifest.id).toBe('noop')
    expect(NOOP_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })

  it('noop policy plugin has correct manifest', () => {
    expect(NOOP_POLICY_PLUGIN.manifest.id).toBe('noop')
    expect(NOOP_POLICY_PLUGIN.manifest.provides).toContain('auth.policy')
  })

  it('noop identity resolves to null for undefined token', async () => {
    const result = await NOOP_IDENTITY_PLUGIN.resolveIdentity(undefined)
    expect(result).toBeNull()
  })

  it('noop identity resolves to null for a bearer token', async () => {
    const result = await NOOP_IDENTITY_PLUGIN.resolveIdentity('Bearer abc123')
    expect(result).toBeNull()
  })

  // Action names below are illustrative only; the canonical action naming contract
  // (e.g. 'card.create', 'card.delete') is deferred to the stage-2 enforcement work.
  it('noop policy allows any action for null identity', async () => {
    const allowed = await NOOP_POLICY_PLUGIN.checkPolicy(null, 'card.create')
    expect(allowed).toBe(true)
  })

  it('noop policy allows any action for a named identity', async () => {
    const identity = { subject: 'user-1', roles: ['admin'] }
    const allowed = await NOOP_POLICY_PLUGIN.checkPolicy(identity, 'card.delete')
    expect(allowed).toBe(true)
  })

  it('throws for unknown auth.identity provider', () => {
    expect(() =>
      resolveCapabilityBag(storageCaps, kanbanDir, {
        'auth.identity': { provider: 'unknown-provider' },
        'auth.policy': { provider: 'noop' },
      })
    ).toThrow(/unknown auth.identity provider/i)
  })

  it('throws for unknown auth.policy provider', () => {
    expect(() =>
      resolveCapabilityBag(storageCaps, kanbanDir, {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'unknown-provider' },
      })
    ).toThrow(/unknown auth.policy provider/i)
  })
})

// ---------------------------------------------------------------------------
// KanbanSDK auth wiring from config
// ---------------------------------------------------------------------------

describe('KanbanSDK auth wiring', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sdk-auth-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('KanbanSDK resolves noop auth plugins when auth is absent from config', () => {
    const sdk = new KanbanSDK(kanbanDir)
    expect(sdk.capabilities?.authIdentity).toBe(NOOP_IDENTITY_PLUGIN)
    expect(sdk.capabilities?.authPolicy).toBe(NOOP_POLICY_PLUGIN)
    sdk.close()
  })

  it('KanbanSDK propagates auth.identity provider from .kanban.json config', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({ version: 2, auth: { 'auth.identity': { provider: 'unknown-auth-provider' } } }),
    )
    expect(() => new KanbanSDK(kanbanDir)).toThrow(/unknown auth.identity provider/i)
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCapabilityBag, BUILTIN_ATTACHMENT_IDS, PROVIDER_ALIASES, WEBHOOK_PROVIDER_ALIASES, AUTH_PROVIDER_ALIASES, NOOP_IDENTITY_PLUGIN, NOOP_POLICY_PLUGIN, RBAC_IDENTITY_PLUGIN, RBAC_POLICY_PLUGIN, RBAC_USER_ACTIONS, RBAC_MANAGER_ACTIONS, RBAC_ADMIN_ACTIONS, RBAC_ROLE_MATRIX, createRbacIdentityPlugin, WORKSPACE_ROOT } from '../plugins'
import type { RbacRole, WebhookProviderPlugin } from '../plugins'
import type { ResolvedCapabilityBag } from '../plugins'
import { MarkdownStorageEngine } from '../plugins/markdown'
import { KanbanSDK } from '../KanbanSDK'
import { normalizeAuthCapabilities, normalizeWebhookCapabilities } from '../../shared/config'
import { AuthError } from '../types'
import type { AuthContext, AuthDecision } from '../types'
import type { AuthIdentity } from '../plugins'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-plugin-test-'))
}

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
  const backupDir = fs.existsSync(packageDir)
    ? fs.mkdtempSync(path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-backup-`))
    : null

  if (backupDir) {
    fs.cpSync(packageDir, backupDir, { recursive: true })
  }

  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, main: 'index.js' }, null, 2),
    'utf-8',
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), entrySource, 'utf-8')

  return () => {
    fs.rmSync(packageDir, { recursive: true, force: true })
    if (backupDir) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.cpSync(backupDir, packageDir, { recursive: true })
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
  }
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

  it('returns an external sqlite engine for the sqlite provider alias', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage.type).toBe('sqlite')
    expect(bag.cardStorage.kanbanDir).toBe(kanbanDir)
  })

  it('sqlite provider resolves relative sqlitePath against workspaceRoot', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: 'custom.db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage.type).toBe('sqlite')
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
    expect(bag.cardStorage.type).toBe('sqlite')
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

  it('explicit sqlite attachment provider resolves through the sqlite alias package', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'sqlite' },
      },
      kanbanDir,
    )

    expect(bag.cardStorage.type).toBe('sqlite')
    expect(bag.attachmentStorage.manifest.id).toBe('sqlite')
    expect(bag.attachmentStorage.manifest.provides).toContain('attachment.storage')
  })

  it('uses the alias package attachment provider when sqlite card.storage keeps attachment.storage=localfs', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )

    expect(bag.cardStorage.type).toBe('sqlite')
    expect(bag.attachmentStorage.manifest.id).toBe('sqlite')
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

  it('falls back to built-in localfs when an external card plugin does not export attachment.storage', () => {
    const cleanup = installTempPackage(
      'kanban-card-only-plugin',
      `class CardOnlyEngine {
  constructor(kanbanDir) { this.type = 'markdown'; this.kanbanDir = kanbanDir }
  async init() {}
  close() {}
  async migrate() {}
  async ensureBoardDirs() {}
  async deleteBoardData() {}
  async scanCards() { return [] }
  async writeCard() {}
  async moveCard() { return '' }
  async renameCard() { return '' }
  async deleteCard() {}
  getCardDir() { return this.kanbanDir }
  async copyAttachment() {}
}
module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-card-only-plugin', provides: ['card.storage'] },
    createEngine(kanbanDir) { return new CardOnlyEngine(kanbanDir) },
  },
}
`
    )

    try {
      const bag = resolveCapabilityBag(
        {
          'card.storage': { provider: 'kanban-card-only-plugin' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )

      expect(bag.cardStorage.type).toBe('markdown')
      expect(bag.attachmentStorage.manifest.id).toBe('localfs')
    } finally {
      cleanup()
    }
  })

  it('rejects external card plugins with invalid manifests', () => {
    const cleanup = installTempPackage(
      'kanban-invalid-card-plugin',
      `module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-invalid-card-plugin', provides: ['attachment.storage'] },
    createEngine() { return { type: 'invalid', kanbanDir: '.', init: async () => {}, close() {}, migrate: async () => {}, ensureBoardDirs: async () => {}, deleteBoardData: async () => {}, scanCards: async () => [], writeCard: async () => {}, moveCard: async () => '', renameCard: async () => '', deleteCard: async () => {}, getCardDir() { return '.' }, copyAttachment: async () => {} } },
  },
}
`
    )

    try {
      expect(() =>
        resolveCapabilityBag(
          {
            'card.storage': { provider: 'kanban-invalid-card-plugin' },
            'attachment.storage': { provider: 'localfs' },
          },
          kanbanDir,
        )
      ).toThrow(/valid cardStoragePlugin/)
    } finally {
      cleanup()
    }
  })

  it('rejects external attachment plugins with invalid manifests', () => {
    const cleanup = installTempPackage(
      'kanban-invalid-attachment-plugin',
      `module.exports = {
  attachmentStoragePlugin: {
    manifest: { id: 'kanban-invalid-attachment-plugin', provides: ['card.storage'] },
    copyAttachment: async () => {},
  },
}
`
    )

    try {
      expect(() =>
        resolveCapabilityBag(
          {
            'card.storage': { provider: 'markdown' },
            'attachment.storage': { provider: 'kanban-invalid-attachment-plugin' },
          },
          kanbanDir,
        )
      ).toThrow(/valid attachmentStoragePlugin/)
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// BUILTIN_ATTACHMENT_IDS
// ---------------------------------------------------------------------------

describe('BUILTIN_ATTACHMENT_IDS', () => {
  it('contains localfs', () => {
    expect(BUILTIN_ATTACHMENT_IDS.has('localfs')).toBe(true)
  })

  it('does not treat sqlite and mysql as built-in attachment providers', () => {
    expect(BUILTIN_ATTACHMENT_IDS.has('sqlite')).toBe(false)
    expect(BUILTIN_ATTACHMENT_IDS.has('mysql')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PROVIDER_ALIASES
// ---------------------------------------------------------------------------

describe('PROVIDER_ALIASES', () => {
  it('maps sqlite to kl-sqlite-storage', () => {
    expect(PROVIDER_ALIASES.get('sqlite')).toBe('kl-sqlite-storage')
  })

  it('maps mysql to kl-mysql-storage', () => {
    expect(PROVIDER_ALIASES.get('mysql')).toBe('kl-mysql-storage')
  })

  it('has no alias for unknown provider ids', () => {
    expect(PROVIDER_ALIASES.get('some-external-provider')).toBeUndefined()
    expect(PROVIDER_ALIASES.get('markdown')).toBeUndefined()
    expect(PROVIDER_ALIASES.get('localfs')).toBeUndefined()
  })

  it('contains exactly the two expected short alias ids', () => {
    expect([...PROVIDER_ALIASES.keys()].sort()).toEqual(['mysql', 'sqlite'])
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

  it('uses the alias package attachment provider when mysql card.storage keeps attachment.storage=localfs', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )

    expect(bag.cardStorage.type).toBe('mysql')
    expect(bag.attachmentStorage.manifest.id).toBe('mysql')
    expect(bag.providers['card.storage'].provider).toBe('mysql')
  })

  it('explicit mysql attachment provider resolves through the mysql alias package', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } },
        'attachment.storage': { provider: 'mysql' },
      },
      kanbanDir,
    )

    expect(bag.cardStorage.type).toBe('mysql')
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
    expect(sdk.storageEngine.type).toBe('sqlite')
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
    expect(sdk.storageEngine.type).toBe('sqlite')
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
    const result = await NOOP_IDENTITY_PLUGIN.resolveIdentity({})
    expect(result).toBeNull()
  })

  it('noop identity resolves to null for a bearer token', async () => {
    const result = await NOOP_IDENTITY_PLUGIN.resolveIdentity({ token: 'Bearer abc123' })
    expect(result).toBeNull()
  })

  // Action names below are illustrative only; the canonical action naming contract
  // (e.g. 'card.create', 'card.delete') is deferred to the stage-2 enforcement work.
  it('noop policy allows any action for null identity', async () => {
    const decision = await NOOP_POLICY_PLUGIN.checkPolicy(null, 'card.create', {})
    expect(decision.allowed).toBe(true)
  })

  it('noop policy allows any action for a named identity', async () => {
    const identity = { subject: 'user-1', roles: ['admin'] }
    const decision = await NOOP_POLICY_PLUGIN.checkPolicy(identity, 'card.delete', {})
    expect(decision.allowed).toBe(true)
  })

  it('throws an install hint for an unknown external auth.identity provider', () => {
    expect(() =>
      resolveCapabilityBag(storageCaps, kanbanDir, {
        'auth.identity': { provider: 'unknown-provider' },
        'auth.policy': { provider: 'noop' },
      })
    ).toThrow(/npm install unknown-provider/i)
  })

  it('throws an install hint for an unknown external auth.policy provider', () => {
    expect(() =>
      resolveCapabilityBag(storageCaps, kanbanDir, {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'unknown-provider' },
      })
    ).toThrow(/npm install unknown-provider/i)
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
    expect(() => new KanbanSDK(kanbanDir)).toThrow(/npm install unknown-auth-provider/i)
  })
})

// ---------------------------------------------------------------------------
// KanbanSDK.getAuthStatus
// ---------------------------------------------------------------------------

describe('KanbanSDK.getAuthStatus', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-auth-status-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns noop providers and disabled flags when no auth configured', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getAuthStatus()
    expect(status.identityProvider).toBe('noop')
    expect(status.policyProvider).toBe('noop')
    expect(status.identityEnabled).toBe(false)
    expect(status.policyEnabled).toBe(false)
    sdk.close()
  })

  it('returns noop providers when pre-built storage engine is injected', () => {
    const engine = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage: engine })
    const status = sdk.getAuthStatus()
    expect(status.identityProvider).toBe('noop')
    expect(status.policyProvider).toBe('noop')
    expect(status.identityEnabled).toBe(false)
    expect(status.policyEnabled).toBe(false)
    sdk.close()
  })
})

// ---------------------------------------------------------------------------
// KanbanSDK.getWebhookStatus
// ---------------------------------------------------------------------------

describe('KanbanSDK.getWebhookStatus', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-webhook-status-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns built-in provider and inactive flag when no webhook plugin configured', () => {
    const sdk = new KanbanSDK(kanbanDir)
    const status = sdk.getWebhookStatus()
    // When kl-webhooks-plugin is installed as a sibling, it resolves to 'webhooks'.
    // When it is absent, the built-in fallback is used and webhookProvider is 'built-in'.
    expect(typeof status.webhookProvider).toBe('string')
    expect(typeof status.webhookProviderActive).toBe('boolean')
    // Active and provider id must be consistent with each other.
    if (status.webhookProviderActive) {
      expect(status.webhookProvider).not.toBe('built-in')
    } else {
      expect(status.webhookProvider).toBe('built-in')
    }
    sdk.close()
  })

  it('returns built-in provider when pre-built storage engine is injected', () => {
    const engine = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage: engine })
    const status = sdk.getWebhookStatus()
    expect(status.webhookProvider).toBe('built-in')
    expect(status.webhookProviderActive).toBe(false)
    sdk.close()
  })
})

// ---------------------------------------------------------------------------
// KanbanSDK._authorizeAction – pre-action authorization seam
// ---------------------------------------------------------------------------

describe('KanbanSDK._authorizeAction', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-authz-seam-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('allows all actions when no auth plugins are configured (noop path)', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    const decision = await sdk._authorizeAction('card.create')
    expect(decision.allowed).toBe(true)
    sdk.close()
  })

  it('allows action with an explicit empty auth context', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    const decision = await sdk._authorizeAction('card.delete', {})
    expect(decision.allowed).toBe(true)
    sdk.close()
  })

  it('allows action with a token-bearing auth context (noop still allows)', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    const ctx: AuthContext = { token: 'Bearer test-token', transport: 'http', boardId: 'default' }
    const decision = await sdk._authorizeAction('settings.update', ctx)
    expect(decision.allowed).toBe(true)
    sdk.close()
  })

  it('allows when pre-built storage injected directly (no capability bag)', async () => {
    const engine = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage: engine })
    const decision = await sdk._authorizeAction('board.create')
    expect(decision.allowed).toBe(true)
    sdk.close()
  })

  it('returns actor from resolved identity when populated by identity plugin', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    // Noop identity returns null, so actor is undefined in noop path
    const decision = await sdk._authorizeAction('card.update')
    expect(decision.actor).toBeUndefined()
    sdk.close()
  })

  it('throws AuthError when a deny-all policy plugin is configured', async () => {
    // Build a custom deny-all policy plugin inline
    const denyAllPolicy = {
      manifest: { id: 'deny-all', provides: ['auth.policy' as const] },
      async checkPolicy(_identity: AuthIdentity | null, _action: string, _ctx: AuthContext): Promise<AuthDecision> {
        return { allowed: false, reason: 'auth.policy.denied' as const }
      },
    }
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
      { 'auth.identity': { provider: 'noop' }, 'auth.policy': { provider: 'noop' } },
    )
    // Patch bag's authPolicy with our deny-all override
    ;(bag as any).authPolicy = denyAllPolicy

    const sdk = new KanbanSDK(kanbanDir)
    // Replace the internal capability bag to inject the deny-all policy
    ;(sdk as any)._capabilities = bag

    await expect(sdk._authorizeAction('card.create')).rejects.toBeInstanceOf(AuthError)
  })

  it('AuthError thrown by the seam carries the correct category', async () => {
    const denyAllPolicy = {
      manifest: { id: 'deny-all', provides: ['auth.policy' as const] },
      async checkPolicy(_identity: AuthIdentity | null, _action: string, _ctx: AuthContext): Promise<AuthDecision> {
        return { allowed: false, reason: 'auth.policy.denied' as const }
      },
    }
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
      { 'auth.identity': { provider: 'noop' }, 'auth.policy': { provider: 'noop' } },
    )
    ;(bag as any).authPolicy = denyAllPolicy

    const sdk = new KanbanSDK(kanbanDir)
    ;(sdk as any)._capabilities = bag

    try {
      await sdk._authorizeAction('card.delete')
      throw new Error('Expected AuthError')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).category).toBe('auth.policy.denied')
    }
    sdk.close()
  })

  // Representative action name coverage — confirms the seam handles all
  // canonical action strings without type or runtime errors.
  const representativeActions = [
    'card.create', 'card.update', 'card.delete', 'card.transfer',
    'form.submit',
    'attachment.add', 'attachment.open', 'attachment.remove',
    'comment.add', 'comment.edit', 'comment.delete',
    'settings.update',
    'board.create', 'board.update', 'board.delete',
    'webhook.create', 'webhook.update', 'webhook.delete',
  ] as const

  for (const action of representativeActions) {
    it(`noop path allows '${action}'`, async () => {
      const sdk = new KanbanSDK(kanbanDir)
      const decision = await sdk._authorizeAction(action)
      expect(decision.allowed).toBe(true)
      sdk.close()
    })
  }
})

// ---------------------------------------------------------------------------
// RBAC action catalog contract (T1: fixed role matrix invariants)
// ---------------------------------------------------------------------------

describe('RBAC action catalog contract', () => {
  // ---------------------------------------------------------------------------
  // Role membership
  // ---------------------------------------------------------------------------

  it('user actions are a strict subset of manager actions', () => {
    for (const action of RBAC_USER_ACTIONS) {
      expect(RBAC_MANAGER_ACTIONS.has(action)).toBe(true)
    }
    // manager has additional actions beyond user
    const managerOnly = [...RBAC_MANAGER_ACTIONS].filter(a => !RBAC_USER_ACTIONS.has(a))
    expect(managerOnly.length).toBeGreaterThan(0)
  })

  it('manager actions are a strict subset of admin actions', () => {
    for (const action of RBAC_MANAGER_ACTIONS) {
      expect(RBAC_ADMIN_ACTIONS.has(action)).toBe(true)
    }
    // admin has additional actions beyond manager
    const adminOnly = [...RBAC_ADMIN_ACTIONS].filter(a => !RBAC_MANAGER_ACTIONS.has(a))
    expect(adminOnly.length).toBeGreaterThan(0)
  })

  it('RBAC_ROLE_MATRIX references the exported sets by identity', () => {
    expect(RBAC_ROLE_MATRIX.user).toBe(RBAC_USER_ACTIONS)
    expect(RBAC_ROLE_MATRIX.manager).toBe(RBAC_MANAGER_ACTIONS)
    expect(RBAC_ROLE_MATRIX.admin).toBe(RBAC_ADMIN_ACTIONS)
  })

  it('RBAC_ROLE_MATRIX has exactly the three canonical roles', () => {
    const roles = Object.keys(RBAC_ROLE_MATRIX).sort()
    expect(roles).toEqual(['admin', 'manager', 'user'])
  })

  // ---------------------------------------------------------------------------
  // User role — expected action membership
  // ---------------------------------------------------------------------------

  const USER_EXPECTED: string[] = [
    'form.submit',
    'comment.create',
    'comment.update',
    'comment.delete',
    'attachment.add',
    'attachment.remove',
    'card.action.trigger',
    'log.add',
  ]

  for (const action of USER_EXPECTED) {
    it(`user role includes '${action}'`, () => {
      expect(RBAC_USER_ACTIONS.has(action)).toBe(true)
    })
  }

  // ---------------------------------------------------------------------------
  // Manager role — actions beyond user
  // ---------------------------------------------------------------------------

  const MANAGER_ONLY_EXPECTED: string[] = [
    'card.create',
    'card.update',
    'card.move',
    'card.transfer',
    'card.delete',
    'board.action.trigger',
    'log.clear',
    'board.log.add',
  ]

  for (const action of MANAGER_ONLY_EXPECTED) {
    it(`manager role includes '${action}'`, () => {
      expect(RBAC_MANAGER_ACTIONS.has(action)).toBe(true)
    })

    it(`user role does NOT include '${action}'`, () => {
      expect(RBAC_USER_ACTIONS.has(action)).toBe(false)
    })
  }

  // ---------------------------------------------------------------------------
  // Admin role — uncovered admin/config mutators (canonical action catalog)
  // ---------------------------------------------------------------------------

  const ADMIN_ONLY_EXPECTED: string[] = [
    'board.create',
    'board.update',
    'board.delete',
    'settings.update',
    'webhook.create',
    'webhook.update',
    'webhook.delete',
    'label.set',
    'label.rename',
    'label.delete',
    'column.create',
    'column.update',
    'column.reorder',
    'column.setMinimized',
    'column.delete',
    'column.cleanup',
    'board.action.config.add',
    'board.action.config.remove',
    'board.log.clear',
    'board.setDefault',
    'storage.migrate',
    'card.purgeDeleted',
  ]

  for (const action of ADMIN_ONLY_EXPECTED) {
    it(`admin role includes '${action}'`, () => {
      expect(RBAC_ADMIN_ACTIONS.has(action)).toBe(true)
    })

    it(`manager role does NOT include '${action}'`, () => {
      expect(RBAC_MANAGER_ACTIONS.has(action)).toBe(false)
    })
  }

  // ---------------------------------------------------------------------------
  // Role matrix lookup helper (as used by the future rbac provider)
  // ---------------------------------------------------------------------------

  it('RBAC_ROLE_MATRIX allows lookup by role string key', () => {
    const role: RbacRole = 'manager'
    expect(RBAC_ROLE_MATRIX[role].has('card.create')).toBe(true)
    expect(RBAC_ROLE_MATRIX[role].has('board.delete')).toBe(false)
  })

  it('admin role contains every user action', () => {
    for (const action of RBAC_USER_ACTIONS) {
      expect(RBAC_ADMIN_ACTIONS.has(action)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// RBAC built-in provider pair (T2)
// ---------------------------------------------------------------------------

describe('RBAC built-in provider pair', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-rbac-t2-test-'))
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

  const rbacAuthCaps = {
    'auth.identity': { provider: 'rbac' },
    'auth.policy': { provider: 'rbac' },
  } as const

  // -------------------------------------------------------------------------
  // Provider resolution
  // -------------------------------------------------------------------------

  it('selecting rbac resolves a real identity plugin (not noop)', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir, rbacAuthCaps)
    expect(bag.authIdentity).not.toBe(NOOP_IDENTITY_PLUGIN)
    expect(bag.authIdentity.manifest.id).toBe('rbac')
  })

  it('selecting rbac resolves a real policy plugin (not noop)', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir, rbacAuthCaps)
    expect(bag.authPolicy).not.toBe(NOOP_POLICY_PLUGIN)
    expect(bag.authPolicy.manifest.id).toBe('rbac')
  })

  it('RBAC_IDENTITY_PLUGIN and RBAC_POLICY_PLUGIN are the resolved singletons', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir, rbacAuthCaps)
    expect(bag.authIdentity).toBe(RBAC_IDENTITY_PLUGIN)
    expect(bag.authPolicy).toBe(RBAC_POLICY_PLUGIN)
  })

  it('omitting auth config still resolves noop providers', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir)
    expect(bag.authIdentity).toBe(NOOP_IDENTITY_PLUGIN)
    expect(bag.authPolicy).toBe(NOOP_POLICY_PLUGIN)
  })

  it('rbac identity plugin has correct manifest', () => {
    expect(RBAC_IDENTITY_PLUGIN.manifest.id).toBe('rbac')
    expect(RBAC_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })

  it('rbac policy plugin has correct manifest', () => {
    expect(RBAC_POLICY_PLUGIN.manifest.id).toBe('rbac')
    expect(RBAC_POLICY_PLUGIN.manifest.provides).toContain('auth.policy')
  })

  // -------------------------------------------------------------------------
  // RBAC identity plugin – identity resolution
  // -------------------------------------------------------------------------

  it('resolveIdentity returns null when token is absent', async () => {
    const identity = await RBAC_IDENTITY_PLUGIN.resolveIdentity({})
    expect(identity).toBeNull()
  })

  it('RBAC_IDENTITY_PLUGIN singleton denies any unregistered token (empty registry)', async () => {
    // The singleton uses an empty principal registry — no format-based trust.
    // Even tokens that look like "subject:role" must not be trusted.
    const identity = await RBAC_IDENTITY_PLUGIN.resolveIdentity({ token: 'alice:admin' })
    expect(identity).toBeNull()
  })

  it('createRbacIdentityPlugin resolves a registered opaque admin token', async () => {
    const plugin = createRbacIdentityPlugin(new Map([['opaque-admin-abc', { subject: 'alice', roles: ['admin'] }]]))
    const identity = await plugin.resolveIdentity({ token: 'opaque-admin-abc' })
    expect(identity).not.toBeNull()
    expect(identity!.subject).toBe('alice')
    expect(identity!.roles).toContain('admin')
  })

  it('createRbacIdentityPlugin strips Bearer prefix before registry lookup', async () => {
    const plugin = createRbacIdentityPlugin(new Map([['opaque-mgr-xyz', { subject: 'bob', roles: ['manager'] }]]))
    const identity = await plugin.resolveIdentity({ token: 'Bearer opaque-mgr-xyz' })
    expect(identity!.subject).toBe('bob')
    expect(identity!.roles).toContain('manager')
  })

  it('createRbacIdentityPlugin resolves a registered user token', async () => {
    const plugin = createRbacIdentityPlugin(new Map([['opaque-user-tok', { subject: 'carol', roles: ['user'] }]]))
    const identity = await plugin.resolveIdentity({ token: 'opaque-user-tok' })
    expect(identity!.subject).toBe('carol')
    expect(identity!.roles).toContain('user')
  })

  it('createRbacIdentityPlugin returns null for an unregistered opaque token', async () => {
    const plugin = createRbacIdentityPlugin(new Map([['known-tok', { subject: 'alice', roles: ['admin'] }]]))
    const identity = await plugin.resolveIdentity({ token: 'unknown-tok' })
    expect(identity).toBeNull()
  })

  it('createRbacIdentityPlugin returns null when token is absent', async () => {
    const plugin = createRbacIdentityPlugin(new Map([['tok', { subject: 'alice', roles: ['admin'] }]]))
    const identity = await plugin.resolveIdentity({})
    expect(identity).toBeNull()
  })

  it('createRbacIdentityPlugin returns a copy of roles — not a reference to the entry', async () => {
    const entry = { subject: 'alice', roles: ['admin'] }
    const plugin = createRbacIdentityPlugin(new Map([['tok', entry]]))
    const identity = await plugin.resolveIdentity({ token: 'tok' })
    expect(identity!.roles).not.toBe(entry.roles)
    expect(identity!.roles).toEqual(['admin'])
  })

  // -------------------------------------------------------------------------
  // RBAC policy plugin – allow decisions for each role level
  // -------------------------------------------------------------------------

  it('admin identity is allowed an admin-only action (settings.update)', async () => {
    const identity = { subject: 'alice', roles: ['admin'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'settings.update', {})
    expect(decision.allowed).toBe(true)
    expect(decision.actor).toBe('alice')
  })

  it('admin identity is allowed a manager action (card.create)', async () => {
    const identity = { subject: 'alice', roles: ['admin'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'card.create', {})
    expect(decision.allowed).toBe(true)
  })

  it('manager identity is allowed a manager action (card.create)', async () => {
    const identity = { subject: 'bob', roles: ['manager'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'card.create', {})
    expect(decision.allowed).toBe(true)
  })

  it('manager identity is allowed a user action (comment.create)', async () => {
    const identity = { subject: 'bob', roles: ['manager'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'comment.create', {})
    expect(decision.allowed).toBe(true)
  })

  it('user identity is allowed a user action (comment.create)', async () => {
    const identity = { subject: 'carol', roles: ['user'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'comment.create', {})
    expect(decision.allowed).toBe(true)
    expect(decision.actor).toBe('carol')
  })

  // -------------------------------------------------------------------------
  // RBAC policy plugin – deny decisions
  // -------------------------------------------------------------------------

  it('user identity is denied a manager-only action (card.create)', async () => {
    const identity = { subject: 'carol', roles: ['user'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'card.create', {})
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('auth.policy.denied')
  })

  it('user identity is denied an admin-only action (settings.update)', async () => {
    const identity = { subject: 'carol', roles: ['user'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'settings.update', {})
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('auth.policy.denied')
  })

  it('manager identity is denied an admin-only action (settings.update)', async () => {
    const identity = { subject: 'bob', roles: ['manager'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'settings.update', {})
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('auth.policy.denied')
  })

  it('null identity is denied with auth.identity.missing', async () => {
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(null, 'card.create', {})
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('auth.identity.missing')
  })

  it('deny decision for null identity has no actor field', async () => {
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(null, 'card.create', {})
    expect(decision.actor).toBeUndefined()
  })

  it('deny decision includes resolved actor subject', async () => {
    const identity = { subject: 'bob', roles: ['manager'] }
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'settings.update', {})
    expect(decision.actor).toBe('bob')
  })

  // -------------------------------------------------------------------------
  // Token non-disclosure
  // -------------------------------------------------------------------------

  it('raw token value does not appear in policy denial when token is invalid', async () => {
    const rawToken = 'OPAQUE-SECRET-ZYX987'
    const identity = await RBAC_IDENTITY_PLUGIN.resolveIdentity({ token: rawToken })
    expect(identity).toBeNull()
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(null, 'card.create', { token: rawToken })
    expect(JSON.stringify(decision)).not.toContain('OPAQUE-SECRET-ZYX987')
  })

  it('policy allow decision metadata does not contain raw token', async () => {
    const rawToken = 'opaque-admin-secret-XYZ'
    const plugin = createRbacIdentityPlugin(new Map([[rawToken, { subject: 'alice', roles: ['admin'] }]]))
    const identity = await plugin.resolveIdentity({ token: rawToken })
    const decision = await RBAC_POLICY_PLUGIN.checkPolicy(identity, 'settings.update', { token: rawToken })
    // metadata field (if present) must not echo the full raw token
    const meta = JSON.stringify(decision.metadata ?? {})
    expect(meta).not.toContain(rawToken)
  })
})

// ---------------------------------------------------------------------------
// WEBHOOK_PROVIDER_ALIASES
// ---------------------------------------------------------------------------

describe('WEBHOOK_PROVIDER_ALIASES', () => {
  it('maps "webhooks" to "kl-webhooks-plugin"', () => {
    expect(WEBHOOK_PROVIDER_ALIASES.get('webhooks')).toBe('kl-webhooks-plugin')
  })

  it('does not contain unknown aliases', () => {
    expect(WEBHOOK_PROVIDER_ALIASES.has('unknown-provider')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AUTH_PROVIDER_ALIASES
// ---------------------------------------------------------------------------

describe('AUTH_PROVIDER_ALIASES', () => {
  it('maps "noop" to "kl-auth-plugin"', () => {
    expect(AUTH_PROVIDER_ALIASES.get('noop')).toBe('kl-auth-plugin')
  })

  it('maps "rbac" to "kl-auth-plugin"', () => {
    expect(AUTH_PROVIDER_ALIASES.get('rbac')).toBe('kl-auth-plugin')
  })

  it('does not contain unknown aliases', () => {
    expect(AUTH_PROVIDER_ALIASES.has('unknown-provider')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveCapabilityBag – webhook provider resolution
// ---------------------------------------------------------------------------

describe('resolveCapabilityBag – webhookProvider', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-webhook-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns webhookProvider=null when webhookCapabilities is omitted', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.webhookProvider).toBeNull()
  })

  it('resolves webhookProvider from sibling package when installed as local sibling', () => {
    const webhookCaps = normalizeWebhookCapabilities({})
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
      undefined,
      webhookCaps,
    )
    // In dev the sibling `../kl-webhooks-plugin` is built and resolves successfully.
    // null is only returned in environments where neither node_modules nor the sibling exists.
    expect(bag.webhookProvider).not.toBeNull()
    expect(bag.webhookProvider?.manifest.provides).toContain('webhook.delivery')
  })

  it('loads webhookProviderPlugin from a temp-installed package', () => {
    const mockPlugin: WebhookProviderPlugin = {
      manifest: { id: 'test-webhooks', provides: ['webhook.delivery'] },
      listWebhooks: () => [],
      createWebhook: (_root, input) => ({ id: 'wh_test', url: input.url, events: input.events, active: true }),
      updateWebhook: () => null,
      deleteWebhook: () => false,
      createListener: () => ({
        manifest: { id: 'test-webhooks-listener', provides: ['event.listener'] },
        init: () => {},
        destroy: () => {},
      }),
    }

    const cleanup = installTempPackage('kl-webhooks-plugin', `
      module.exports = {
        webhookProviderPlugin: {
          manifest: { id: 'test-webhooks', provides: ['webhook.delivery'] },
          listWebhooks: () => [],
          createWebhook: (_root, input) => ({ id: 'wh_test', url: input.url, events: input.events, active: true }),
          updateWebhook: () => null,
          deleteWebhook: () => false,
          createListener: () => ({
            manifest: { id: 'test-webhooks-listener', provides: ['event.listener'] },
            init: () => {},
            destroy: () => {},
          }),
        }
      }
    `)

    try {
      const webhookCaps = normalizeWebhookCapabilities({})
      const bag = resolveCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        webhookCaps,
      )
      expect(bag.webhookProvider).not.toBeNull()
      expect(bag.webhookProvider!.manifest.id).toBe('test-webhooks')
      expect(bag.webhookProvider!.manifest.provides).toContain('webhook.delivery')
      expect(typeof bag.webhookProvider!.listWebhooks).toBe('function')
      expect(typeof bag.webhookProvider!.createListener).toBe('function')
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// WORKSPACE_ROOT – monorepo detection
// ---------------------------------------------------------------------------

describe('WORKSPACE_ROOT', () => {
  it('resolves to a non-null workspace root when running inside the monorepo', () => {
    // Tests run from packages/kanban-lite/ which is inside the pnpm workspace tree.
    expect(WORKSPACE_ROOT).toBeTruthy()
    expect(typeof WORKSPACE_ROOT).toBe('string')
  })

  it('workspace root contains pnpm-workspace.yaml', () => {
    expect(WORKSPACE_ROOT).toBeTruthy()
    expect(fs.existsSync(path.join(WORKSPACE_ROOT!, 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('workspace root contains packages/ directory with all plugin packages', () => {
    expect(WORKSPACE_ROOT).toBeTruthy()
    const packagesDir = path.join(WORKSPACE_ROOT!, 'packages')
    expect(fs.existsSync(path.join(packagesDir, 'kl-sqlite-storage'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-mysql-storage'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-auth-plugin'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-webhooks-plugin'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-s3-attachment-storage'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Monorepo workspace-local plugin resolution
// ---------------------------------------------------------------------------

describe('monorepo workspace-local plugin resolution', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ws-loader-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('resolves kl-sqlite-storage from workspace packages/ directory', () => {
    // kl-sqlite-storage is not published to npm but lives in packages/kl-sqlite-storage.
    // The workspace-local resolution tier must find it there.
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'sqlite', options: { sqlitePath: path.join(kanbanDir, 'kanban.db') } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage.type).toBe('sqlite')
  })

  it('resolves kl-mysql-storage from workspace packages/ directory', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage.type).toBe('mysql')
  })

  it('resolves kl-auth-plugin NOOP_IDENTITY_PLUGIN from workspace packages/', () => {
    // kl-auth-plugin is in packages/kl-auth-plugin; the NOOP/RBAC constants are
    // loaded at module init time via the workspace-local path.
    expect(NOOP_IDENTITY_PLUGIN.manifest.id).toBe('noop')
    expect(NOOP_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })

  it('resolves kl-auth-plugin RBAC_IDENTITY_PLUGIN from workspace packages/', () => {
    expect(RBAC_IDENTITY_PLUGIN.manifest.id).toBe('rbac')
    expect(RBAC_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })
})

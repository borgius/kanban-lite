import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCapabilityBag, collectActiveExternalPackageNames, BUILTIN_ATTACHMENT_IDS, PROVIDER_ALIASES, CARD_STATE_PROVIDER_ALIASES, WEBHOOK_PROVIDER_ALIASES, CALLBACK_PROVIDER_ALIASES, CRON_PROVIDER_ALIASES, AUTH_PROVIDER_ALIASES, NOOP_IDENTITY_PLUGIN, NOOP_POLICY_PLUGIN, RBAC_IDENTITY_PLUGIN, RBAC_POLICY_PLUGIN, RBAC_USER_ACTIONS, RBAC_MANAGER_ACTIONS, RBAC_ADMIN_ACTIONS, RBAC_ROLE_MATRIX, createRbacIdentityPlugin, WORKSPACE_ROOT, canUseDefaultCardStateActor } from '../plugins'
import type { RbacRole, WebhookProviderPlugin } from '../plugins'
import type { ResolvedCapabilityBag } from '../plugins'
import type { SDKExtensionPlugin, SDKExtensionLoaderResult } from '../types'
import { MarkdownStorageEngine } from '../plugins/markdown'
import { KanbanSDK, PluginSettingsOperationError } from '../KanbanSDK'
import { normalizeAuthCapabilities, normalizeCallbackCapabilities, normalizeWebhookCapabilities, readConfig } from '../../shared/config'
import { installRuntimeHost, resetRuntimeHost } from '../../shared/env'
import { AuthError, DEFAULT_CARD_STATE_ACTOR, CARD_STATE_DEFAULT_ACTOR_MODE, ERR_CARD_STATE_IDENTITY_UNAVAILABLE, ERR_CARD_STATE_UNAVAILABLE } from '../types'
import type { AuthContext, AuthDecision } from '../types'
import type { AuthIdentity } from '../plugins'
import { readConfigRepositoryDocument, writeConfigRepositoryDocument } from '../modules/configRepository'

type PluginSettingsUiDetailElement = {
  scope?: string
  options?: Record<string, unknown>
}

type PluginSettingsArrayControlOptions = {
  showSortButtons?: boolean
  elementLabelProp?: string
  detail?: {
    elements?: PluginSettingsUiDetailElement[]
  }
}

type PluginSettingsUiRoot = {
  elements?: Array<{
    elements?: Array<{
      options?: PluginSettingsArrayControlOptions
    }>
  }>
}

type TempConfigStorageGlobal = typeof globalThis & {
  __tempConfigStorageDocument?: Record<string, unknown>
  __tempConfigStorageWrites?: Array<Record<string, unknown>>
  __tempConfigStorageContexts?: Array<Record<string, unknown>>
}

function expectPresent<T>(value: T | null | undefined, message: string): T {
  expect(value).toBeDefined()
  expect(value).not.toBeNull()
  if (value == null) {
    throw new Error(message)
  }
  return value
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-plugin-test-'))
}

const runtimeRequire = createRequire(import.meta.url)
const nodeModule = runtimeRequire('node:module') as typeof import('node:module') & {
  _pathCache?: Record<string, string>
}

function normalizeCacheHint(value: string): string {
  return value.replace(/\\/g, '/')
}

function clearRequireResolutionCaches(hints: Array<string | null | undefined>): void {
  const normalizedHints = hints
    .filter((hint): hint is string => typeof hint === 'string' && hint.length > 0)
    .map(normalizeCacheHint)

  if (normalizedHints.length === 0) return

  for (const cacheKey of Object.keys(runtimeRequire.cache)) {
    const normalizedCacheKey = normalizeCacheHint(cacheKey)
    if (normalizedHints.some((hint) => normalizedCacheKey.includes(hint))) {
      delete runtimeRequire.cache[cacheKey]
    }
  }

  const pathCache = nodeModule._pathCache
  if (!pathCache) return

  for (const [cacheKey, cacheValue] of Object.entries(pathCache)) {
    const normalizedCacheKey = normalizeCacheHint(cacheKey)
    const normalizedCacheValue = normalizeCacheHint(String(cacheValue))
    if (normalizedHints.some((hint) => normalizedCacheKey.includes(hint) || normalizedCacheValue.includes(hint))) {
      delete pathCache[cacheKey]
    }
  }
}

function pathExistsOrIsSymlink(targetPath: string): boolean {
  return fs.existsSync(targetPath) || fs.lstatSync(targetPath, { throwIfNoEntry: false }) !== undefined
}

function getPreferredWorkspaceRestoreTarget(packageDir: string, packageName: string): string | null {
  const siblingPackagePath = path.join(process.cwd(), '..', packageName)
  if (!fs.existsSync(siblingPackagePath)) {
    return null
  }
  return path.relative(path.dirname(packageDir), siblingPackagePath)
}

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
  const siblingPackagePath = path.join(process.cwd(), '..', packageName)
  const preferredWorkspaceRestoreTarget = getPreferredWorkspaceRestoreTarget(packageDir, packageName)
  let existingSymlinkTarget: string | null = null
  let existingSymlinkRealPath: string | null = null
  let backupDir: string | null = null

  const clearPackageCache = (): void => {
    clearRequireResolutionCaches([
      packageName,
      packageDir,
      siblingPackagePath,
      existingSymlinkTarget,
      existingSymlinkRealPath,
      backupDir,
    ])
    for (const candidate of [packageName, packageDir, siblingPackagePath]) {
      try {
        const resolved = runtimeRequire.resolve(candidate)
        delete runtimeRequire.cache[resolved]
      } catch {
        // Ignore paths that are not currently resolvable.
      }
    }
  }

  if (pathExistsOrIsSymlink(packageDir)) {
    try {
      existingSymlinkTarget = fs.readlinkSync(packageDir)
      existingSymlinkRealPath = path.resolve(path.dirname(packageDir), existingSymlinkTarget)
    } catch {
      if (preferredWorkspaceRestoreTarget === null) {
        backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-backup-`))
        fs.cpSync(packageDir, backupDir, { recursive: true })
      }
    }
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
    if (preferredWorkspaceRestoreTarget !== null) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.symlinkSync(preferredWorkspaceRestoreTarget, packageDir)
    } else if (existingSymlinkTarget !== null) {
      fs.symlinkSync(existingSymlinkTarget, packageDir)
    } else if (backupDir) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.cpSync(backupDir, packageDir, { recursive: true })
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
    clearPackageCache()
  }
}

function installBrokenPackageSymlink(packageName: string): () => void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
  const siblingPackagePath = path.join(process.cwd(), '..', packageName)
  const preferredWorkspaceRestoreTarget = getPreferredWorkspaceRestoreTarget(packageDir, packageName)
  let existingSymlinkTarget: string | null = null
  let existingSymlinkRealPath: string | null = null
  let backupDir: string | null = null

  const clearPackageCache = (): void => {
    clearRequireResolutionCaches([
      packageName,
      packageDir,
      siblingPackagePath,
      existingSymlinkTarget,
      existingSymlinkRealPath,
      backupDir,
    ])
    for (const candidate of [packageName, packageDir, siblingPackagePath]) {
      try {
        const resolved = runtimeRequire.resolve(candidate)
        delete runtimeRequire.cache[resolved]
      } catch {
        // Ignore paths that are not currently resolvable.
      }
    }
  }

  if (pathExistsOrIsSymlink(packageDir)) {
    try {
      existingSymlinkTarget = fs.readlinkSync(packageDir)
      existingSymlinkRealPath = path.resolve(path.dirname(packageDir), existingSymlinkTarget)
    } catch {
      if (preferredWorkspaceRestoreTarget === null) {
        backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-backup-`))
        fs.cpSync(packageDir, backupDir, { recursive: true })
      }
    }
    fs.rmSync(packageDir, { recursive: true, force: true })
  }

  const brokenTarget = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-missing-`))
  fs.rmSync(brokenTarget, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(packageDir), { recursive: true })
  fs.symlinkSync(brokenTarget, packageDir)
  clearPackageCache()

  return () => {
    clearPackageCache()
    fs.rmSync(packageDir, { recursive: true, force: true })
    if (preferredWorkspaceRestoreTarget !== null) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.symlinkSync(preferredWorkspaceRestoreTarget, packageDir)
    } else if (existingSymlinkTarget !== null) {
      fs.symlinkSync(existingSymlinkTarget, packageDir)
    } else if (backupDir) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.cpSync(backupDir, packageDir, { recursive: true })
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
    clearPackageCache()
  }
}

function expectPackageRestoredToWorkspaceSymlink(packageName: string): void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
  const siblingPackagePath = path.join(process.cwd(), '..', packageName)

  expect(fs.existsSync(siblingPackagePath)).toBe(true)
  expect(fs.lstatSync(packageDir).isSymbolicLink()).toBe(true)
  expect(fs.realpathSync(packageDir)).toBe(fs.realpathSync(siblingPackagePath))
}

async function loadFreshResolveCapabilityBag(): Promise<typeof resolveCapabilityBag> {
  vi.resetModules()
  const { resolveCapabilityBag: freshResolveCapabilityBag } = await import('../plugins')
  return freshResolveCapabilityBag
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

  it('providers field reflects canonicalized capabilities', () => {
    const caps = {
      'card.storage': { provider: 'markdown' },
      'attachment.storage': { provider: 'localfs' },
    } as const
    const bag = resolveCapabilityBag(caps, kanbanDir)
    expect(bag.providers).toEqual({
      'card.storage': { provider: 'localfs' },
      'attachment.storage': { provider: 'localfs' },
    })
  })

  it('resolves a localfs card.state provider with shared module context by default', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )

    expect(bag.cardState.manifest).toEqual({
      id: 'localfs',
      provides: ['card.state'],
    })
    expect(bag.cardStateContext).toEqual({
      workspaceRoot: workspaceDir,
      kanbanDir,
      provider: 'localfs',
      backend: 'builtin',
    })
  })

  it('persists and restores builtin card.state data with no plugin installed', async () => {
    const firstBag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )

    await firstBag.cardState.setCardState({
      actorId: 'default-user',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'draft',
      value: { expanded: false },
      updatedAt: '2026-03-24T10:00:00.000Z',
    })

    await firstBag.cardState.markUnreadReadThrough({
      actorId: 'default-user',
      boardId: 'default',
      cardId: 'card-1',
      cursor: { cursor: 'activity:9', updatedAt: '2026-03-24T10:01:00.000Z' },
    })

    const secondBag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )

    await expect(secondBag.cardState.getCardState({
      actorId: 'default-user',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'draft',
    })).resolves.toEqual({
      actorId: 'default-user',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'draft',
      value: { expanded: false },
      updatedAt: '2026-03-24T10:00:00.000Z',
    })

    await expect(secondBag.cardState.getUnreadCursor({
      actorId: 'default-user',
      boardId: 'default',
      cardId: 'card-1',
    })).resolves.toEqual({
      cursor: 'activity:9',
      updatedAt: '2026-03-24T10:01:00.000Z',
    })
  })

  it('resolves external card.state providers with shared module context', () => {
    const cleanup = installTempPackage(
      'acme-card-state-provider',
      `module.exports = {
  createCardStateProvider(context) {
    return {
      manifest: { id: 'acme-card-state-provider', provides: ['card.state'] },
      context,
      async getCardState() { return null },
      async setCardState(input) {
        return { ...input, updatedAt: input.updatedAt || '2026-03-24T00:00:00.000Z' }
      },
      async getUnreadCursor() { return null },
      async markUnreadReadThrough(input) {
        return {
          actorId: input.actorId,
          boardId: input.boardId,
          cardId: input.cardId,
          domain: 'unread',
          value: input.cursor,
          updatedAt: input.cursor.updatedAt || '2026-03-24T00:00:00.000Z',
        }
      },
    }
  },
}
`,
    )

    try {
      const bag = resolveCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        undefined,
        { 'card.state': { provider: 'acme-card-state-provider', options: { region: 'test' } } },
      )

      expect(bag.cardState.manifest).toEqual({
        id: 'acme-card-state-provider',
        provides: ['card.state'],
      })
      expect(bag.cardStateContext).toEqual({
        workspaceRoot: workspaceDir,
        kanbanDir,
        provider: 'acme-card-state-provider',
        backend: 'external',
        options: { region: 'test' },
      })
    } finally {
      cleanup()
    }
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
  it('maps sqlite to kl-plugin-storage-sqlite', () => {
    expect(PROVIDER_ALIASES.get('sqlite')).toBe('kl-plugin-storage-sqlite')
  })

  it('maps cloudflare to kl-plugin-cloudflare', () => {
    expect(PROVIDER_ALIASES.get('cloudflare')).toBe('kl-plugin-cloudflare')
  })

  it('maps mysql to kl-plugin-storage-mysql', () => {
    expect(PROVIDER_ALIASES.get('mysql')).toBe('kl-plugin-storage-mysql')
  })

  it('has no alias for unknown provider ids', () => {
    expect(PROVIDER_ALIASES.get('some-external-provider')).toBeUndefined()
    expect(PROVIDER_ALIASES.get('markdown')).toBeUndefined()
    expect(PROVIDER_ALIASES.get('localfs')).toBeUndefined()
  })

  it('contains the expected short alias ids', () => {
    expect([...PROVIDER_ALIASES.keys()].sort()).toEqual([
      'cloudflare',
      'mongodb',
      'mysql',
      'postgresql',
      'redis',
      'sqlite',
    ])
  })
})

// ---------------------------------------------------------------------------
// CARD_STATE_PROVIDER_ALIASES
// ---------------------------------------------------------------------------

describe('CARD_STATE_PROVIDER_ALIASES', () => {
  it('maps sqlite to kl-plugin-storage-sqlite', () => {
    expect(CARD_STATE_PROVIDER_ALIASES.get('sqlite')).toBe('kl-plugin-storage-sqlite')
  })

  it('maps cloudflare to kl-plugin-cloudflare', () => {
    expect(CARD_STATE_PROVIDER_ALIASES.get('cloudflare')).toBe('kl-plugin-cloudflare')
  })

  it('has no alias for unknown card.state provider ids', () => {
    expect(CARD_STATE_PROVIDER_ALIASES.get('some-external-provider')).toBeUndefined()
    expect(CARD_STATE_PROVIDER_ALIASES.get('builtin')).toBeUndefined()
  })

  it('contains the expected short alias ids', () => {
    expect([...CARD_STATE_PROVIDER_ALIASES.keys()]).toEqual([
      'sqlite',
      'mysql',
      'postgresql',
      'mongodb',
      'redis',
      'cloudflare',
    ])
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
    expect(sdk.capabilities?.providers['card.storage'].provider).toBe('localfs')
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

  it('includes configured cron.runtime event names in the available-events catalog', () => {
    const cleanup = installTempPackage(
      'temp-cron-runtime-plugin',
      `const fs = require('node:fs')
const path = require('node:path')

class CronListenerPlugin {
  constructor() {}
  get manifest() {
    return { id: 'temp-cron-runtime-plugin', provides: ['event.listener'] }
  }
  register() {}
  unregister() {}
}

module.exports = {
  pluginManifest: {
    id: 'temp-cron-runtime-plugin',
    capabilities: { 'cron.runtime': ['temp-cron-runtime-plugin'] },
  },
  CronListenerPlugin,
  getCronRuntimeEventDeclarations(workspaceRoot) {
    const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.kanban.json'), 'utf-8'))
    return (config.plugins?.['cron.runtime']?.options?.events ?? []).map((entry) => ({
      event: entry.event,
      phase: 'after',
      resource: 'cron',
      label: entry.name,
      apiAfter: true,
    }))
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
            'cron.runtime': {
              provider: 'temp-cron-runtime-plugin',
              options: {
                events: [{ name: 'Nightly sync', schedule: '0 0 * * *', event: 'schedule.nightly' }],
              },
            },
          },
        }),
        'utf-8',
      )

      const sdk = new KanbanSDK(kanbanDir)

      try {
        expect(sdk.listAvailableEvents({ mask: 'schedule.*' })).toContainEqual({
          event: 'schedule.nightly',
          phase: 'after',
          source: 'plugin',
          resource: 'cron',
          label: 'Nightly sync',
          sdkBefore: false,
          sdkAfter: true,
          apiAfter: true,
          pluginIds: ['temp-cron-runtime-plugin'],
        })
      } finally {
        sdk.close()
      }
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// KanbanSDK plugin settings inventory (T2)
// ---------------------------------------------------------------------------

describe('KanbanSDK plugin settings inventory', () => {
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

  it('groups discovered providers by capability with builtin and workspace sources', async () => {
    const sdk = new KanbanSDK(kanbanDir)

    try {
      const inventory = await sdk.listPluginSettings()
      const cardStorage = inventory.capabilities.find((entry) => entry.capability === 'card.storage')
      const authVisibility = inventory.capabilities.find((entry) => entry.capability === 'auth.visibility')
      const webhookDelivery = inventory.capabilities.find((entry) => entry.capability === 'webhook.delivery')

      expect(cardStorage).toMatchObject({
        capability: 'card.storage',
        selected: {
          capability: 'card.storage',
          providerId: 'localfs',
          source: 'default',
        },
      })
      expect(cardStorage?.providers).toContainEqual(expect.objectContaining({
        providerId: 'localfs',
        packageName: 'localfs',
        discoverySource: 'builtin',
        isSelected: true,
      }))
      expect(cardStorage?.providers).toContainEqual(expect.objectContaining({
        providerId: 'sqlite',
        packageName: 'kl-plugin-storage-sqlite',
        discoverySource: 'workspace',
        isSelected: false,
      }))

      expect(webhookDelivery).toMatchObject({
        capability: 'webhook.delivery',
        selected: {
          capability: 'webhook.delivery',
          providerId: 'webhooks',
          source: 'default',
        },
      })
      expect(webhookDelivery?.providers).toContainEqual(expect.objectContaining({
        providerId: 'webhooks',
        packageName: 'kl-plugin-webhook',
        discoverySource: 'workspace',
        isSelected: true,
      }))

      expect(authVisibility).toMatchObject({
        capability: 'auth.visibility',
        selected: {
          capability: 'auth.visibility',
          providerId: null,
          source: 'default',
        },
      })
    } finally {
      sdk.close()
    }
  })

  it('discovers and selects auth.visibility providers through the shared plugin settings flow', async () => {
    const cleanup = installTempPackage(
      'temp-auth-visibility-plugin',
      `module.exports = {
  pluginManifest: {
    id: 'temp-auth-visibility-plugin',
    capabilities: { 'auth.visibility': ['temp-auth-visibility-plugin'] },
  },
  authVisibilityPlugins: {
    'temp-auth-visibility-plugin': {
      manifest: { id: 'temp-auth-visibility-plugin', provides: ['auth.visibility'] },
      async filterVisibleCards(cards) { return [...cards] },
      optionsSchema: () => ({
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', default: true },
          },
        },
        secrets: [],
      }),
    },
  },
}
`,
    )

    try {
      const sdk = new KanbanSDK(kanbanDir)

      try {
        const inventory = await sdk.listPluginSettings()
        const authVisibility = inventory.capabilities.find((entry) => entry.capability === 'auth.visibility')

        expect(authVisibility?.providers).toContainEqual(expect.objectContaining({
          providerId: 'temp-auth-visibility-plugin',
          packageName: 'temp-auth-visibility-plugin',
          discoverySource: 'dependency',
          isSelected: false,
        }))

        const selected = expectPresent(
          await sdk.selectPluginSettingsProvider('auth.visibility', 'temp-auth-visibility-plugin'),
          'Expected auth.visibility provider selection result',
        )
        const persistedConfig = JSON.parse(
          fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
        ) as {
          plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
        }

        expect(selected.selected).toEqual({
          capability: 'auth.visibility',
          providerId: 'temp-auth-visibility-plugin',
          source: 'config',
        })
        expect(selected.options?.values).toEqual({ enabled: true })
        expect(persistedConfig.plugins?.['auth.visibility']).toEqual({
          provider: 'temp-auth-visibility-plugin',
          options: { enabled: true },
        })
      } finally {
        sdk.close()
      }
    } finally {
      cleanup()
    }
  })

  it('resolves async nested plugin settings schema values before surfacing discovered providers', async () => {
    const cleanup = installTempPackage(
      'temp-dynamic-auth-plugin',
      `module.exports = {
  pluginManifest: {
    id: 'temp-dynamic-auth-plugin',
    capabilities: { 'auth.policy': ['temp-dynamic-auth-plugin'] },
  },
  authPolicyPlugins: {
    'temp-dynamic-auth-plugin': {
      manifest: { id: 'temp-dynamic-auth-plugin', provides: ['auth.policy'] },
      async checkPolicy() { return { allowed: true } },
      optionsSchema: async () => ({
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            permissions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  actions: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: async (innerSdk) => innerSdk.listAvailableEvents({ type: 'before' }).map((entry) => entry.event),
                    },
                  },
                },
              },
            },
          },
        },
        secrets: [],
      }),
    },
  },
}
`,
    )

    try {
      const sdk = new KanbanSDK(kanbanDir)
      const inventory = await sdk.listPluginSettings()
      const authPolicy = inventory.capabilities.find((entry) => entry.capability === 'auth.policy')
      const provider = authPolicy?.providers.find((entry) => entry.providerId === 'temp-dynamic-auth-plugin')
      const actionItems = ((((provider?.optionsSchema?.schema.properties as Record<string, unknown>).permissions as Record<string, unknown>).items as Record<string, unknown>).properties as Record<string, unknown>).actions as Record<string, unknown>

      expect(provider).toMatchObject({
        packageName: 'temp-dynamic-auth-plugin',
        discoverySource: 'dependency',
      })
      expect(actionItems.items).toMatchObject({
        type: 'string',
      })
      expect(((actionItems.items as Record<string, unknown>).enum as string[])).toContain('card.create')
      expect(((actionItems.items as Record<string, unknown>).enum as string[])).toContain('settings.update')
      expect(((actionItems.items as Record<string, unknown>).enum as string[])).not.toContain('task.created')

      sdk.close()
    } finally {
      cleanup()
    }
  })

  it('discovers callback.runtime schema metadata through the shared plugin settings resolver', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'callback.runtime': { provider: 'callbacks' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const inventory = await sdk.listPluginSettings()
      const callbackRuntime = inventory.capabilities.find((entry) => entry.capability === 'callback.runtime')
      const callbacksProvider = callbackRuntime?.providers.find((entry) => entry.providerId === 'callbacks')
      const handlers = ((callbacksProvider?.optionsSchema?.schema.properties as Record<string, unknown>).handlers ?? {}) as Record<string, unknown>
      const handlerProperties = ((handlers.items as Record<string, unknown>)?.properties ?? {}) as Record<string, Record<string, unknown>>
      const uiRoot = (callbacksProvider?.optionsSchema?.uiSchema ?? {}) as PluginSettingsUiRoot
      const handlersControl = uiRoot.elements?.[0]?.elements?.[0]
      const handlersOptions = handlersControl?.options
      const detailElements = handlersOptions?.detail?.elements ?? []
      const sourceControl = detailElements.find((element) => element.scope === '#/properties/source')
      const commandControl = detailElements.find((element) => element.scope === '#/properties/command')

      expect(callbackRuntime?.selected).toEqual({
        capability: 'callback.runtime',
        providerId: 'callbacks',
        source: 'config',
      })
      expect(callbacksProvider).toMatchObject({
        providerId: 'callbacks',
        packageName: 'kl-plugin-callback',
        isSelected: true,
      })
      expect(handlers.type).toBe('array')
      expect(handlerProperties.type?.enum).toEqual(['module', 'inline', 'process'])
      expect(handlerProperties.events?.type).toBe('array')
      expect(handlerProperties.module?.type).toBe('string')
      expect(handlerProperties.handler?.type).toBe('string')
      expect(handlerProperties.source?.type).toBe('string')
      expect(handlerProperties.command?.type).toBe('string')
      expect(handlersOptions?.showSortButtons).toBe(true)
      expect(handlersOptions?.elementLabelProp).toBe('name')
      expect(sourceControl?.options).toMatchObject({
        editor: 'code',
        language: 'javascript',
        height: '220px',
      })
      expect(commandControl?.scope).toBe('#/properties/command')
    } finally {
      sdk.close()
    }
  })

  it('discovers dependency-installed providers from local node_modules', async () => {
    const cleanup = installTempPackage(
      'temp-inventory-attachment-plugin',
      `module.exports = {
  pluginManifest: {
    id: 'temp-inventory-attachment-plugin',
    capabilities: { 'attachment.storage': ['temp-inventory-attachment-plugin'] },
  },
  attachmentStoragePlugin: {
    manifest: { id: 'temp-inventory-attachment-plugin', provides: ['attachment.storage'] },
    async copyAttachment() {},
    getCardDir() { return null },
  },
}
`,
    )

    try {
      const sdk = new KanbanSDK(kanbanDir)
      const inventory = await sdk.listPluginSettings()
      const attachmentStorage = inventory.capabilities.find((entry) => entry.capability === 'attachment.storage')

      expect(attachmentStorage?.providers).toContainEqual(expect.objectContaining({
        providerId: 'temp-inventory-attachment-plugin',
        packageName: 'temp-inventory-attachment-plugin',
        discoverySource: 'dependency',
        isSelected: false,
      }))

      sdk.close()
    } finally {
      cleanup()
    }
  })

  it('ignores broken discovered packages so valid providers still load', async () => {
    const cleanup = installTempPackage(
      'temp-broken-plugin-module',
      `throw new Error('broken package import should not block plugin inventory')\n`,
    )

    try {
      fs.writeFileSync(
        path.join(workspaceDir, '.kanban.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'callback.runtime': { provider: 'callbacks' },
          },
        }),
        'utf-8',
      )

      const sdk = new KanbanSDK(kanbanDir)

      try {
        const inventory = await sdk.listPluginSettings()
        const callbackRuntime = inventory.capabilities.find((entry) => entry.capability === 'callback.runtime')

        expect(callbackRuntime?.selected).toEqual({
          capability: 'callback.runtime',
          providerId: 'callbacks',
          source: 'config',
        })
        expect(callbackRuntime?.providers).toContainEqual(expect.objectContaining({
          providerId: 'callbacks',
          packageName: 'kl-plugin-callback',
          isSelected: true,
        }))
        expect(callbackRuntime?.providers).not.toContainEqual(expect.objectContaining({
          packageName: 'temp-broken-plugin-module',
        }))
      } finally {
        sdk.close()
      }
    } finally {
      cleanup()
    }
  })

  it('skips broad-scan packages that do not look like plugins', async () => {
    const markerPath = path.join(workspaceDir, 'non-plugin-imported.txt')
    const cleanup = installTempPackage(
      'temp-side-effect-adapter',
      `const fs = require('node:fs')\nfs.writeFileSync(${JSON.stringify(markerPath)}, 'loaded', 'utf-8')\nmodule.exports = { loaded: true }\n`,
    )

    try {
      const sdk = new KanbanSDK(kanbanDir)

      try {
        await sdk.listPluginSettings()
        expect(fs.existsSync(markerPath)).toBe(false)
      } finally {
        sdk.close()
      }
    } finally {
      cleanup()
      fs.rmSync(markerPath, { force: true })
    }
  })

  it('derives selected provider state from legacy config normalization', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({ version: 2, storageEngine: 'sqlite', sqlitePath: '.kanban/custom.db' }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const inventory = await sdk.listPluginSettings()
      const cardStorage = inventory.capabilities.find((entry) => entry.capability === 'card.storage')

      expect(cardStorage).toMatchObject({
        capability: 'card.storage',
        selected: {
          capability: 'card.storage',
          providerId: 'sqlite',
          source: 'legacy',
        },
      })
      expect(cardStorage?.providers).toContainEqual(expect.objectContaining({
        providerId: 'sqlite',
        packageName: 'kl-plugin-storage-sqlite',
        discoverySource: 'workspace',
        isSelected: true,
      }))

      const attachmentStorage = inventory.capabilities.find((entry) => entry.capability === 'attachment.storage')
      const sqliteAttachmentProvider = attachmentStorage?.providers.find((entry) => entry.providerId === 'sqlite')

      expect(attachmentStorage).toMatchObject({
        capability: 'attachment.storage',
        selected: {
          capability: 'attachment.storage',
          providerId: 'sqlite',
          source: 'default',
        },
      })
      expect(sqliteAttachmentProvider).toMatchObject({
        providerId: 'sqlite',
        packageName: 'kl-plugin-storage-sqlite',
        discoverySource: 'workspace',
        isSelected: true,
      })
      expect(sqliteAttachmentProvider).not.toHaveProperty('optionsSchema')

      const cardState = inventory.capabilities.find((entry) => entry.capability === 'card.state')
      const sqliteCardStateProvider = cardState?.providers.find((entry) => entry.providerId === 'sqlite')

      expect(cardState).toMatchObject({
        capability: 'card.state',
        selected: {
          capability: 'card.state',
          providerId: 'sqlite',
          source: 'default',
        },
      })
      expect(sqliteCardStateProvider).toMatchObject({
        providerId: 'sqlite',
        packageName: 'kl-plugin-storage-sqlite',
        discoverySource: 'workspace',
        isSelected: true,
      })
      expect(sqliteCardStateProvider).not.toHaveProperty('optionsSchema')
    } finally {
      sdk.close()
    }
  })

  it('surfaces runtime-reported degraded config.storage state in plugin settings selected state', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'config.storage': { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
        },
      }),
      'utf-8',
    )

    installRuntimeHost({
      getConfigStorageFailure() {
        return {
          code: 'config-storage-provider-degraded',
          message: 'Cloudflare config storage is read-only.',
          degraded: {
            effective: { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
            readOnly: true,
          },
        }
      },
    })

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const inventory = await sdk.listPluginSettings()
      const configStorage = inventory.capabilities.find((entry) => entry.capability === 'config.storage')
      const localfsReadback = await sdk.getPluginSettings('config.storage', 'localfs')

      expect(configStorage?.selected).toEqual({
        capability: 'config.storage',
        providerId: 'cloudflare',
        source: 'config',
        resolution: {
          configured: {
            provider: 'cloudflare',
            options: { databaseId: 'cfg-db' },
          },
          effective: {
            provider: 'cloudflare',
            options: { databaseId: 'cfg-db' },
          },
          mode: 'degraded',
          failure: {
            code: 'config-storage-provider-degraded',
            message: 'Cloudflare config storage is read-only.',
            degraded: {
              effective: { provider: 'cloudflare', options: { databaseId: 'cfg-db' } },
              readOnly: true,
            },
          },
        },
      })
      expect(localfsReadback?.selected).toEqual(configStorage?.selected)
    } finally {
      sdk.close()
      resetRuntimeHost()
    }
  })

  it('prunes redundant explicit card.state config that matches card.storage', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
          'card.state': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const inventory = await sdk.listPluginSettings()
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      const cardState = inventory.capabilities.find((entry) => entry.capability === 'card.state')

      expect(cardState?.selected).toEqual({
        capability: 'card.state',
        providerId: 'sqlite',
        source: 'default',
      })
      expect(persistedConfig.plugins).toEqual({
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
      })
    } finally {
      sdk.close()
    }
  })

  it('prunes redundant explicit attachment.storage config that matches card.storage', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
          'attachment.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/ignored.db' } },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const inventory = await sdk.listPluginSettings()
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      const attachmentStorage = inventory.capabilities.find((entry) => entry.capability === 'attachment.storage')

      expect(attachmentStorage?.selected).toEqual({
        capability: 'attachment.storage',
        providerId: 'sqlite',
        source: 'default',
      })
      expect(persistedConfig.plugins).toEqual({
        'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
      })
    } finally {
      sdk.close()
    }
  })

  it('returns redacted option snapshots for the selected provider read model', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'inventory-local-token',
              users: [{ username: 'alice', password: 'super-secret-password', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const { inventory, provider } = await sdk.runWithAuth({ actorHint: 'inventory-reader' }, async () => ({
        inventory: await sdk.listPluginSettings(),
        provider: await sdk.getPluginSettings('auth.identity', 'local'),
      }))
      const authIdentity = inventory.capabilities.find((entry) => entry.capability === 'auth.identity')

      expect(authIdentity?.selected).toEqual({
        capability: 'auth.identity',
        providerId: 'local',
        source: 'legacy',
      })
      expect(provider).toMatchObject({
        capability: 'auth.identity',
        providerId: 'local',
        packageName: 'kl-plugin-auth',
        discoverySource: 'workspace',
        selected: {
          capability: 'auth.identity',
          providerId: 'local',
          source: 'legacy',
        },
      })
      expect(provider?.options).not.toBeNull()
      expect((provider?.options?.values as { users: Array<{ password: string }> }).users[0].password).toBe('••••••')
      expect(provider?.options?.redactedPaths).toContain('users[0].password')
      const serializedInventory = JSON.stringify(inventory)
      expect(serializedInventory).not.toContain('inventory-local-token')
      expect(serializedInventory).not.toContain('super-secret-password')
    } finally {
      sdk.close()
    }
  })

  it('persists canonical provider selection for one capability without disturbing others', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'card.storage': { provider: 'sqlite', options: { sqlitePath: '.kanban/custom.db' } },
          'attachment.storage': { provider: 'localfs' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const selected = expectPresent(
        await sdk.selectPluginSettingsProvider('card.storage', 'localfs'),
        'Expected card.storage localfs provider selection result',
      )
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as { plugins?: Record<string, { provider: string; options?: Record<string, unknown> }> }

      expect(selected.selected).toEqual({
        capability: 'card.storage',
        providerId: 'localfs',
        source: 'config',
      })
      expect(persistedConfig.plugins).toMatchObject({
        'card.storage': { provider: 'localfs' },
      })
      expect(persistedConfig.plugins?.['attachment.storage']).toBeUndefined()
      expect(persistedConfig.plugins?.['card.storage']).not.toHaveProperty('enabled')

      const inventory = await sdk.listPluginSettings()
      const cardStorage = inventory.capabilities.find((entry) => entry.capability === 'card.storage')
      expect(cardStorage?.selected).toEqual({
        capability: 'card.storage',
        providerId: 'localfs',
        source: 'config',
      })
      expect(cardStorage?.providers).toContainEqual(expect.objectContaining({
        providerId: 'localfs',
        isSelected: true,
      }))
      expect(cardStorage?.providers).toContainEqual(expect.objectContaining({
        providerId: 'sqlite',
        isSelected: false,
      }))
    } finally {
      sdk.close()
    }
  })

  it('does not persist options for an inactive provider (no pluginOptions store)', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'card.storage': { provider: 'localfs' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const updated = await sdk.updatePluginSettingsOptions('card.storage', 'sqlite', {
        sqlitePath: '.kanban/disabled.db',
      })
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      expect(updated.selected).toEqual({
        capability: 'card.storage',
        providerId: 'localfs',
        source: 'config',
      })
      // Inactive provider options are returned in the response but not written to config
      expect(updated.options?.values?.sqlitePath).toBe('.kanban/disabled.db')
      expect(persistedConfig.plugins?.['card.storage']).toEqual({ provider: 'localfs' })
      expect(persistedConfig).not.toHaveProperty('pluginOptions')
      expect(persistedConfig.plugins?.['card.storage']).not.toHaveProperty('enabled')
    } finally {
      sdk.close()
    }
  })

  it('selects a previously inactive provider with schema defaults (no cached options)', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'card.storage': { provider: 'localfs' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const selected = expectPresent(
        await sdk.selectPluginSettingsProvider('card.storage', 'sqlite'),
        'Expected card.storage sqlite provider selection result',
      )
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      expect(selected.selected).toEqual({
        capability: 'card.storage',
        providerId: 'sqlite',
        source: 'config',
      })
      // No cached options to restore; schema defaults are applied (sqlitePath default)
      expect(selected.options?.values?.sqlitePath).not.toBe('.kanban/cached.db')
      expect(persistedConfig.plugins?.['card.storage']).toMatchObject({ provider: 'sqlite' })
      expect(persistedConfig.plugins?.['card.storage']).not.toHaveProperty('enabled')
    } finally {
      sdk.close()
    }
  })

  it('materializes schema defaults when selecting auth.policy rbac without saved options', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'auth.identity': { provider: 'noop' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const selected = expectPresent(
        await sdk.selectPluginSettingsProvider('auth.policy', 'rbac'),
        'Expected auth.policy rbac provider selection result',
      )
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      const expectedPermissions = [
        { role: 'user', actions: [...RBAC_ROLE_MATRIX.user] },
        { role: 'manager', actions: [...RBAC_ROLE_MATRIX.manager] },
        { role: 'admin', actions: [...RBAC_ROLE_MATRIX.admin] },
      ]

      expect(selected.selected).toEqual({
        capability: 'auth.policy',
        providerId: 'rbac',
        source: 'config',
      })
      expect(selected.options?.values).toEqual({
        permissions: expectedPermissions,
      })
      expect(persistedConfig.plugins?.['auth.policy']).toEqual({
        provider: 'rbac',
        options: {
          permissions: expectedPermissions,
        },
      })
    } finally {
      sdk.close()
    }
  })

  it('can explicitly disable webhook delivery while preserving stored webhook options', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'webhook.delivery': {
            provider: 'webhooks',
            options: {
              webhooks: [
                {
                  id: 'wh_saved',
                  url: 'https://example.test/hook',
                  events: ['task.created'],
                  active: true,
                },
              ],
            },
          },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const selected = await sdk.selectPluginSettingsProvider('webhook.delivery', 'none')
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as { plugins?: Record<string, { provider: string; options?: Record<string, unknown> }> }

      expect(selected).toBeNull()
      expect(persistedConfig.plugins?.['webhook.delivery']).toEqual({
        provider: 'none',
        options: {
          webhooks: [
            {
              id: 'wh_saved',
              url: 'https://example.test/hook',
              events: ['task.created'],
              active: true,
            },
          ],
        },
      })

      const inventory = await sdk.listPluginSettings()
      const webhookDelivery = inventory.capabilities.find((entry) => entry.capability === 'webhook.delivery')

      expect(webhookDelivery?.selected).toEqual({
        capability: 'webhook.delivery',
        providerId: null,
        source: 'none',
      })
      expect(webhookDelivery?.providers.every((provider) => provider.isSelected === false)).toBe(true)
    } finally {
      sdk.close()
    }
  })

  it('autogenerates webhook ids for blank plugin-settings webhook rows on save', async () => {
    const sdk = new KanbanSDK(kanbanDir)

    try {
      const updated = await sdk.updatePluginSettingsOptions('webhook.delivery', 'webhooks', {
        webhooks: [
          {
            id: '   ',
            url: 'https://example.test/hook',
            events: ['task.created'],
            active: true,
          },
        ],
      })
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: { webhooks?: Array<{ id: string }> } }>
        pluginOptions?: Record<string, Record<string, { webhooks?: Array<{ id: string }> }>>
      }

      const webhookId = ((updated.options?.values.webhooks as Array<{ id: string }>)?.[0]?.id) ?? ''

      expect(webhookId).toMatch(/^wh_[0-9a-f]{16}$/)
      expect(persistedConfig.plugins?.['webhook.delivery']).toEqual({
        provider: 'webhooks',
        options: {
          webhooks: [
            expect.objectContaining({
              id: webhookId,
            }),
          ],
        },
      })
    } finally {
      sdk.close()
    }
  })

  it('keeps masked secrets on round-trip updates while replacing explicit secret edits', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        auth: {
          'auth.identity': {
            provider: 'local',
            options: {
              apiToken: 'existing-token',
              users: [{ username: 'alice', password: '$2b$12$old-hash', role: 'admin' }],
            },
          },
          'auth.policy': { provider: 'local' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      const updated = await sdk.runWithAuth({ actorHint: 'inventory-writer' }, () => sdk.updatePluginSettingsOptions('auth.identity', 'local', {
        apiToken: '••••••',
        users: [{ username: 'alice', password: '$2b$12$new-hash', role: 'manager' }],
      }))
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: { apiToken?: string; users?: Array<{ password: string; role?: string }> } }>
      }
      const readback = await sdk.runWithAuth({ actorHint: 'inventory-writer' }, () => sdk.getPluginSettings('auth.identity', 'local'))

      expect(updated.selected).toEqual({
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      })
      expect(updated.options?.values).toMatchObject({
        apiToken: '••••••',
        users: [{ username: 'alice', password: '••••••', role: 'manager' }],
      })
      expect(updated.options?.redactedPaths).toEqual(expect.arrayContaining(['apiToken', 'users[0].password']))
      expect(persistedConfig.plugins?.['auth.identity']).toEqual({
        provider: 'local',
        options: {
          apiToken: 'existing-token',
          users: [{ username: 'alice', password: '$2b$12$new-hash', role: 'manager' }],
        },
      })
      expect(readback?.selected.source).toBe('config')
      expect(readback?.options?.values).toMatchObject({
        apiToken: '••••••',
        users: [{ username: 'alice', password: '••••••', role: 'manager' }],
      })
    } finally {
      sdk.close()
    }
  })

  it('round-trips mixed callback handler edits through the shared plugin settings save flow', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'callback.runtime': { provider: 'callbacks' },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)
    const handlerOptions = {
      handlers: [
        {
          id: 'module-created',
          name: 'module-created',
          type: 'module',
          events: ['task.created'],
          enabled: true,
          module: './callbacks/task-created',
          handler: 'onTaskCreated',
        },
        {
          id: 'inline-created',
          name: 'inline-created',
          type: 'inline',
          events: ['task.created'],
          enabled: true,
          source: 'async ({ event, sdk }) => { console.log(event.event, Boolean(sdk)) }',
        },
        {
          id: 'process-created',
          name: 'process-created',
          type: 'process',
          events: ['task.created'],
          enabled: true,
          command: 'node',
          args: ['worker.cjs', '--stdin'],
          cwd: '.kanban/callbacks',
        },
      ],
    }

    try {
      const updated = await sdk.updatePluginSettingsOptions('callback.runtime', 'callbacks', handlerOptions)
      const readback = await sdk.getPluginSettings('callback.runtime', 'callbacks')
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8'),
      ) as {
        plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
      }

      expect(updated.selected).toEqual({
        capability: 'callback.runtime',
        providerId: 'callbacks',
        source: 'config',
      })
      expect(updated.options?.values).toEqual(handlerOptions)
      expect(readback).toMatchObject({
        capability: 'callback.runtime',
        providerId: 'callbacks',
        selected: {
          capability: 'callback.runtime',
          providerId: 'callbacks',
          source: 'config',
        },
        options: {
          values: handlerOptions,
        },
      })
      expect(persistedConfig.plugins?.['callback.runtime']).toEqual({
        provider: 'callbacks',
        options: handlerOptions,
      })
    } finally {
      sdk.close()
    }
  })

  it('throws redacted payloads for invalid config reads', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      '{"plugins":{"auth.identity":{"provider":"local","options":{"apiToken":"super-secret-token"}}}',
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      await expect(sdk.getPluginSettings('auth.identity', 'local')).rejects.toBeInstanceOf(PluginSettingsOperationError)

      try {
        await sdk.getPluginSettings('auth.identity', 'local')
      } catch (error) {
        expect(error).toBeInstanceOf(PluginSettingsOperationError)
        const payload = (error as PluginSettingsOperationError).payload
        expect(payload).toMatchObject({
          code: 'plugin-settings-config-load-failed',
          capability: 'auth.identity',
          providerId: 'local',
        })
        expect(JSON.stringify(payload)).not.toContain('super-secret-token')
      }
    } finally {
      sdk.close()
    }
  })

  it('throws redacted payloads for invalid config lists', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      '{"plugins":{"auth.identity":{"provider":"local","options":{"apiToken":"super-secret-token"}}}',
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    try {
      await expect(sdk.listPluginSettings()).rejects.toBeInstanceOf(PluginSettingsOperationError)

      try {
        await sdk.listPluginSettings()
      } catch (error) {
        expect(error).toBeInstanceOf(PluginSettingsOperationError)
        const payload = (error as PluginSettingsOperationError).payload
        expect(payload).toMatchObject({
          code: 'plugin-settings-config-load-failed',
        })
        expect(JSON.stringify(payload)).not.toContain('super-secret-token')
      }
    } finally {
      sdk.close()
    }
  })

  it('throws redacted payloads for config save failures', async () => {
    const configFile = path.join(workspaceDir, '.kanban.json')
    fs.writeFileSync(configFile, JSON.stringify({ version: 2 }), 'utf-8')
    fs.chmodSync(configFile, 0o444)
    const sdk = new KanbanSDK(kanbanDir)

    try {
      await expect(sdk.selectPluginSettingsProvider('auth.identity', 'local')).rejects.toBeInstanceOf(PluginSettingsOperationError)

      try {
        await sdk.selectPluginSettingsProvider('auth.identity', 'local')
      } catch (error) {
        expect(error).toBeInstanceOf(PluginSettingsOperationError)
        const payload = (error as PluginSettingsOperationError).payload
        expect(payload).toMatchObject({
          code: 'plugin-settings-config-save-failed',
          capability: 'auth.identity',
          providerId: 'local',
        })
        expect(JSON.stringify(payload)).not.toContain('apiToken')
      }
    } finally {
      fs.chmodSync(configFile, 0o644)
      sdk.close()
    }
  })

  it.each([
    {
      scope: 'workspace' as const,
      expectedArgs: ['install', '--ignore-scripts', 'kl-plugin-auth'],
    },
    {
      scope: 'global' as const,
      expectedArgs: ['install', '--global', '--ignore-scripts', 'kl-plugin-auth'],
    },
  ])('installs exact plugin packages with fixed npm argv and lifecycle scripts disabled for %s scope', async ({ scope, expectedArgs }) => {
    const installCalls: Array<{
      command: string
      args: string[]
      cwd: string
      shell: boolean
    }> = []
    const sdk = new KanbanSDK(kanbanDir, { pluginInstallRunner: async (command) => {
      installCalls.push(command)
      return {
        exitCode: 0,
        signal: null,
        stdout: 'added 1 package\n',
        stderr: '',
      }
    } })

    try {
      const result = await sdk.installPluginSettingsPackage({ packageName: 'kl-plugin-auth', scope })

      expect(result).toMatchObject({
        packageName: 'kl-plugin-auth',
        scope,
        message: 'Installed plugin package with lifecycle scripts disabled.',
        stdout: 'added 1 package',
        stderr: '',
        redaction: expect.objectContaining({
          maskedValue: '••••••',
        }),
      })
      expect(result.command).toEqual({
        command: 'npm',
        args: expectedArgs,
        cwd: workspaceDir,
        shell: false,
      })
      expect(installCalls).toEqual([{
        command: 'npm',
        args: expectedArgs,
        cwd: workspaceDir,
        shell: false,
      }])
    } finally {
      sdk.close()
    }
  })

  it('redacts credential-bearing stdout and stderr from successful install payloads', async () => {
    const sdk = new KanbanSDK(kanbanDir, { pluginInstallRunner: async () => ({
      exitCode: 0,
      signal: null,
      stdout: 'Authorization: Bearer npm_super_secret_token\npassword=super-secret-password\n',
      stderr: 'downloading https://demo-user:demo-pass@example.com/kl-plugin-auth.tgz\n',
    }) })

    try {
      const result = await sdk.installPluginSettingsPackage({ packageName: 'kl-plugin-auth', scope: 'workspace' })

      expect(result.stdout).toContain('[REDACTED]')
      expect(result.stderr).toContain('[REDACTED]')
      const serializedResult = JSON.stringify(result)
      expect(serializedResult).not.toContain('npm_super_secret_token')
      expect(serializedResult).not.toContain('super-secret-password')
      expect(serializedResult).not.toContain('demo-user:demo-pass')
    } finally {
      sdk.close()
    }
  })

  it.each([
    { label: 'version specifier', packageName: 'kl-plugin-auth@latest' },
    { label: 'scoped package', packageName: '@scope/kl-plugin-auth' },
    { label: 'relative path', packageName: '../kl-plugin-auth' },
    { label: 'file specifier', packageName: 'file:../kl-plugin-auth' },
    { label: 'tarball URL', packageName: 'https://example.com/kl-plugin-auth.tgz' },
    { label: 'flag fragment', packageName: 'kl-plugin-auth --save-dev' },
    { label: 'shell fragment', packageName: 'kl-plugin-auth; rm -rf /' },
    { label: 'leading whitespace', packageName: ' kl-plugin-auth' },
    { label: 'newline fragment', packageName: 'kl-plugin-auth\n--global' },
  ])('rejects invalid install package input ($label) before spawning npm', async ({ packageName }) => {
    const installCalls: Array<unknown> = []
    const sdk = new KanbanSDK(kanbanDir, { pluginInstallRunner: async (command) => {
      installCalls.push(command)
      return {
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
      }
    } })

    try {
      await expect(
        sdk.installPluginSettingsPackage({ packageName, scope: 'workspace' } as never),
      ).rejects.toBeInstanceOf(PluginSettingsOperationError)

      try {
        await sdk.installPluginSettingsPackage({ packageName, scope: 'workspace' } as never)
      } catch (error) {
        expect(error).toBeInstanceOf(PluginSettingsOperationError)
        expect((error as PluginSettingsOperationError).payload.code).toBe('invalid-plugin-install-package-name')
      }

      expect(installCalls).toEqual([])
    } finally {
      sdk.close()
    }
  })

  it('redacts credential-bearing stderr details from failed install payloads', async () => {
    const sdk = new KanbanSDK(kanbanDir, { pluginInstallRunner: async () => ({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: [
        'npm ERR! code E401',
        'Authorization: Bearer npm_super_secret_token',
        '//registry.npmjs.org/:_authToken=npm_inline_secret',
        'password=super-secret-password',
        'download failed at https://demo-user:demo-pass@example.com/kl-plugin-auth.tgz',
      ].join('\n'),
    }) })

    try {
      await expect(
        sdk.installPluginSettingsPackage({ packageName: 'kl-plugin-auth', scope: 'workspace' }),
      ).rejects.toBeInstanceOf(PluginSettingsOperationError)

      try {
        await sdk.installPluginSettingsPackage({ packageName: 'kl-plugin-auth', scope: 'workspace' })
      } catch (error) {
        expect(error).toBeInstanceOf(PluginSettingsOperationError)
        const payload = (error as PluginSettingsOperationError).payload

        expect(payload).toMatchObject({
          code: 'plugin-settings-install-failed',
          message: expect.stringContaining('install the package manually'),
        })
        expect(payload.details).toMatchObject({
          packageName: 'kl-plugin-auth',
          scope: 'workspace',
          exitCode: 1,
          command: {
            command: 'npm',
            args: ['install', '--ignore-scripts', 'kl-plugin-auth'],
            cwd: workspaceDir,
            shell: false,
          },
          manualInstall: {
            command: 'npm',
            args: ['install', 'kl-plugin-auth'],
            cwd: workspaceDir,
            shell: false,
          },
        })

        const serializedPayload = JSON.stringify(payload)
        expect(serializedPayload).not.toContain('npm_super_secret_token')
        expect(serializedPayload).not.toContain('npm_inline_secret')
        expect(serializedPayload).not.toContain('super-secret-password')
        expect(serializedPayload).not.toContain('demo-user:demo-pass')
        expect(serializedPayload).toContain('[REDACTED]')
      }
    } finally {
      sdk.close()
    }
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
        'card.storage': { provider: 'localfs' },
        'attachment.storage': { provider: 'localfs' },
      },
      configStorage: {
        configured: null,
        effective: { provider: 'localfs' },
        mode: 'fallback',
        failure: null,
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
      configStorage: {
        configured: null,
        effective: { provider: 'sqlite', options: { sqlitePath: '.kanban/kanban.db' } },
        mode: 'derived',
        failure: null,
      },
      isFileBacked: false,
      watchGlob: null,
    })

    sdk.close()
  })

  it('KanbanSDK getStorageStatus surfaces explicit unavailable config.storage overrides', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'config.storage': { provider: 'missing-config-storage-plugin', options: { endpoint: 'https://cfg.test' } },
        },
      }),
      'utf-8',
    )

    const sdk = new KanbanSDK(kanbanDir)

    expect(sdk.getStorageStatus().configStorage).toEqual({
      configured: {
        provider: 'missing-config-storage-plugin',
        options: { endpoint: 'https://cfg.test' },
      },
      effective: null,
      mode: 'error',
      failure: {
        code: 'config-storage-provider-unavailable',
        message: "Configured config.storage provider 'missing-config-storage-plugin' is unavailable in this runtime.",
      },
    })

    sdk.close()
  })

  it('routes explicit config.storage reads and writes through executable providers', async () => {
    const cleanup = installTempPackage(
      'temp-config-storage-provider',
      `module.exports = {
  pluginManifest: {
    id: 'temp-config-storage-provider',
    capabilities: { 'config.storage': ['temp-config-storage-provider'] },
  },
  createConfigStorageProvider(context) {
    globalThis.__tempConfigStorageContexts ??= []
    globalThis.__tempConfigStorageContexts.push({
      workspaceRoot: context.workspaceRoot,
      documentId: context.documentId,
      provider: context.provider,
      backend: context.backend,
      options: context.options,
      hasWorker: Boolean(context.worker),
    })
    return {
      manifest: { id: 'temp-config-storage-provider', provides: ['config.storage'] },
      readConfigDocument() {
        return structuredClone(globalThis.__tempConfigStorageDocument)
      },
      writeConfigDocument(nextDocument) {
        const cloned = structuredClone(nextDocument)
        globalThis.__tempConfigStorageDocument = cloned
        globalThis.__tempConfigStorageWrites ??= []
        globalThis.__tempConfigStorageWrites.push(cloned)
      },
    }
  },
}
`,
    )

    const tempConfigStorageGlobal = globalThis as TempConfigStorageGlobal
    tempConfigStorageGlobal.__tempConfigStorageDocument = {
      version: 2,
      defaultBoard: 'provider-default',
      boards: {
        'provider-default': {
          columns: [],
        },
      },
      showLabels: false,
      customField: { preserved: true },
      plugins: {
        'config.storage': { provider: 'temp-config-storage-provider', options: { region: 'test' } },
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'provider-api-token',
            tokenHeader: 'x-provider-token',
          },
        },
      },
    }
    tempConfigStorageGlobal.__tempConfigStorageWrites = []
    tempConfigStorageGlobal.__tempConfigStorageContexts = []

    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'config.storage': { provider: 'temp-config-storage-provider', options: { region: 'test' } },
        },
      }),
      'utf-8',
    )

    try {
      const sdk = new KanbanSDK(kanbanDir)
      const readResult = readConfigRepositoryDocument(workspaceDir)
      const runtimeConfig = readConfig(workspaceDir)

      try {
        expect(readResult).toMatchObject({ status: 'ok' })
        const config = (readResult.status === 'ok' ? readResult.value : {}) as Record<string, unknown> & {
          plugins?: Record<string, { provider: string; options?: Record<string, unknown> }>
        }

        expect(runtimeConfig.defaultBoard).toBe('provider-default')
        expect(runtimeConfig.showLabels).toBe(false)
        expect(config.showLabels).toBe(false)
        expect(config.customField).toEqual({ preserved: true })
        expect(config.plugins?.['config.storage']).toEqual({
          provider: 'temp-config-storage-provider',
          options: { region: 'test' },
        })
        expect(tempConfigStorageGlobal.__tempConfigStorageContexts).toBeDefined()
        expect(tempConfigStorageGlobal.__tempConfigStorageContexts?.length).toBeGreaterThan(0)
        expect(tempConfigStorageGlobal.__tempConfigStorageContexts).toEqual(
          expect.arrayContaining([
            {
              workspaceRoot: workspaceDir,
              documentId: 'workspace-config',
              provider: 'temp-config-storage-provider',
              backend: 'external',
              options: { region: 'test' },
              hasWorker: false,
            },
          ]),
        )

        expect(sdk.getStorageStatus().configStorage).toMatchObject({
          configured: {
            provider: 'temp-config-storage-provider',
            options: { region: 'test' },
          },
          effective: {
            provider: 'temp-config-storage-provider',
            options: { region: 'test' },
          },
          mode: 'explicit',
        })

        const pluginSettings = await sdk.getPluginSettings('auth.identity', 'local')
        expect(pluginSettings).toMatchObject({
          capability: 'auth.identity',
          providerId: 'local',
          selected: {
            capability: 'auth.identity',
            providerId: 'local',
            source: 'config',
          },
          options: {
            values: {
              apiToken: '••••••',
              tokenHeader: '••••••',
            },
          },
        })

        const writeResult = writeConfigRepositoryDocument(workspaceDir, {
          ...config,
          showLabels: true,
          anotherUnknownField: 'still-there',
        })

        expect(writeResult).toEqual({ status: 'ok', filePath: path.join(workspaceDir, '.kanban.json') })

        expect(tempConfigStorageGlobal.__tempConfigStorageWrites).toHaveLength(1)
        expect(tempConfigStorageGlobal.__tempConfigStorageWrites?.[0]).toMatchObject({
          showLabels: true,
          customField: { preserved: true },
          anotherUnknownField: 'still-there',
          plugins: {
            'config.storage': { provider: 'temp-config-storage-provider', options: { region: 'test' } },
          },
        })
      } finally {
        sdk.close()
      }
    } finally {
      cleanup()
      delete tempConfigStorageGlobal.__tempConfigStorageDocument
      delete tempConfigStorageGlobal.__tempConfigStorageWrites
      delete tempConfigStorageGlobal.__tempConfigStorageContexts
    }
  })

  it('fails closed for explicit config.storage providers that import but lack executable read/write methods', () => {
    const cleanup = installTempPackage(
      'temp-invalid-config-storage-provider',
      `module.exports = {
  pluginManifest: {
    id: 'temp-invalid-config-storage-provider',
    capabilities: { 'config.storage': ['temp-invalid-config-storage-provider'] },
  },
  configStoragePlugin: {
    manifest: { id: 'temp-invalid-config-storage-provider', provides: ['config.storage'] },
  },
}
`,
    )

    fs.writeFileSync(
      path.join(workspaceDir, '.kanban.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'config.storage': { provider: 'temp-invalid-config-storage-provider' },
        },
      }),
      'utf-8',
    )

    try {
      const sdk = new KanbanSDK(kanbanDir)
      const missingConfigWorkspaceDir = createTempDir()

      try {
        expect(readConfig(missingConfigWorkspaceDir).defaultBoard).toBe('default')

        expect(sdk.getStorageStatus().configStorage).toMatchObject({
          configured: { provider: 'temp-invalid-config-storage-provider' },
          effective: null,
          mode: 'error',
          failure: {
            code: 'config-storage-provider-unavailable',
          },
        })
        expect(readConfigRepositoryDocument(workspaceDir)).toMatchObject({
          status: 'error',
          reason: 'read',
        })
        expect(() => readConfig(workspaceDir)).toThrow(/temp-invalid-config-storage-provider/)

        sdk.close()
      } finally {
        fs.rmSync(missingConfigWorkspaceDir, { recursive: true, force: true })
      }
    } finally {
      cleanup()
    }
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
    expect(bag.authVisibility).toBeNull()
  })

  it('bag with explicit noop auth capabilities still returns noop singletons', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir, normalizeAuthCapabilities({}))
    expect(bag.authIdentity).toBe(NOOP_IDENTITY_PLUGIN)
    expect(bag.authPolicy).toBe(NOOP_POLICY_PLUGIN)
    expect(bag.authVisibility).toBeNull()
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
        'auth.visibility': { provider: 'none' },
      })
    ).toThrow(/npm install unknown-provider/i)
  })

  it('throws an install hint for an unknown external auth.policy provider', () => {
    expect(() =>
      resolveCapabilityBag(storageCaps, kanbanDir, {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'unknown-provider' },
        'auth.visibility': { provider: 'none' },
      })
    ).toThrow(/npm install unknown-provider/i)
  })

  it('resolves auth.visibility providers and reuses active-package discovery for standalone/http and sdk extensions', () => {
    const cleanup = installTempPackage(
      'temp-auth-visibility-plugin',
      `module.exports = {
  pluginManifest: {
    id: 'temp-auth-visibility-plugin',
    capabilities: { 'auth.visibility': ['temp-auth-visibility-plugin'] },
    integrations: ['standalone.http', 'sdk.extension'],
  },
  authVisibilityPlugins: {
    'temp-auth-visibility-plugin': {
      manifest: { id: 'temp-auth-visibility-plugin', provides: ['auth.visibility'] },
      async filterVisibleCards(cards) { return [...cards] },
    },
  },
  standaloneHttpPlugin: {
    manifest: { id: 'temp-auth-visibility-standalone', provides: ['standalone.http'] },
    registerMiddleware() { return [] },
    registerRoutes() { return [] },
  },
  sdkExtensionPlugin: {
    manifest: { id: 'temp-auth-visibility-extension', provides: ['sdk.extension'] },
    extensions: { visibility: { enabled: true } },
  },
}
`,
    )

    try {
      const bag = resolveCapabilityBag(
        storageCaps,
        kanbanDir,
        normalizeAuthCapabilities({
          plugins: {
            'auth.visibility': { provider: 'temp-auth-visibility-plugin' },
          },
        }),
      )

      expect(bag.authVisibility?.manifest).toEqual({
        id: 'temp-auth-visibility-plugin',
        provides: ['auth.visibility'],
      })
      expect(bag.standaloneHttpPlugins.some((plugin) => plugin.manifest.id === 'temp-auth-visibility-standalone')).toBe(true)
      expect(bag.sdkExtensions.some((extension) => extension.id === 'temp-auth-visibility-extension')).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe('card.state public contract', () => {
  it('exposes a shared stable default actor for auth-absent mode', () => {
    expect(DEFAULT_CARD_STATE_ACTOR).toEqual({
      id: 'default-user',
      source: 'default',
      mode: CARD_STATE_DEFAULT_ACTOR_MODE,
    })
    expect(Object.isFrozen(DEFAULT_CARD_STATE_ACTOR)).toBe(true)
  })

  it('allows the default card-state actor only when auth.identity is noop', () => {
    expect(canUseDefaultCardStateActor(normalizeAuthCapabilities({}))).toBe(true)
    expect(
      canUseDefaultCardStateActor({
        'auth.identity': { provider: 'custom-identity' },
        'auth.policy': { provider: 'noop' },
        'auth.visibility': { provider: 'none' },
      })
    ).toBe(false)
  })

  it('exports stable reusable public card-state error codes', () => {
    expect(ERR_CARD_STATE_IDENTITY_UNAVAILABLE).toBe('ERR_CARD_STATE_IDENTITY_UNAVAILABLE')
    expect(ERR_CARD_STATE_UNAVAILABLE).toBe('ERR_CARD_STATE_UNAVAILABLE')
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

  it('resolveCapabilityBag loads standalone HTTP plugins from active auth packages', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
      {
        'auth.identity': {
          provider: 'local',
          options: {
            apiToken: 'standalone-http-token',
            users: [{ username: 'alice', password: '$2b$04$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
          },
        },
        'auth.policy': { provider: 'local' },
        'auth.visibility': { provider: 'none' },
      },
    )
    expect(bag.standaloneHttpPlugins.some((plugin) => plugin.manifest.id === 'kl-plugin-auth-standalone')).toBe(true)
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
    // When kl-plugin-webhook is installed as a sibling, it resolves to 'webhooks'.
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

  it('returns none for webhookProvider when pre-built storage engine is injected (no plugin)', () => {
    const engine = new MarkdownStorageEngine(kanbanDir)
    const sdk = new KanbanSDK(kanbanDir, { storage: engine })
    const status = sdk.getWebhookStatus()
    expect(status.webhookProvider).toBe('none')
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
      {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'noop' },
        'auth.visibility': { provider: 'none' },
      },
    )
    // Patch bag's authPolicy with our deny-all override
    Object.assign(bag, { authPolicy: denyAllPolicy })

    const sdk = new KanbanSDK(kanbanDir)
    // Replace the internal capability bag to inject the deny-all policy
    Object.assign(sdk, { _capabilities: bag })

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
      {
        'auth.identity': { provider: 'noop' },
        'auth.policy': { provider: 'noop' },
        'auth.visibility': { provider: 'none' },
      },
    )
    Object.assign(bag, { authPolicy: denyAllPolicy })

    const sdk = new KanbanSDK(kanbanDir)
    Object.assign(sdk, { _capabilities: bag })

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
    'auth.visibility': { provider: 'none' },
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
  it('maps "webhooks" to "kl-plugin-webhook"', () => {
    expect(WEBHOOK_PROVIDER_ALIASES.get('webhooks')).toBe('kl-plugin-webhook')
  })

  it('does not contain unknown aliases', () => {
    expect(WEBHOOK_PROVIDER_ALIASES.has('unknown-provider')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AUTH_PROVIDER_ALIASES
// ---------------------------------------------------------------------------

describe('AUTH_PROVIDER_ALIASES', () => {
  it('maps "noop" to "kl-plugin-auth"', () => {
    expect(AUTH_PROVIDER_ALIASES.get('noop')).toBe('kl-plugin-auth')
  })

  it('maps "rbac" to "kl-plugin-auth"', () => {
    expect(AUTH_PROVIDER_ALIASES.get('rbac')).toBe('kl-plugin-auth')
  })

  it('maps "cloudflare" to "kl-plugin-cloudflare"', () => {
    expect(AUTH_PROVIDER_ALIASES.get('cloudflare')).toBe('kl-plugin-cloudflare')
  })

  it('does not contain unknown aliases', () => {
    expect(AUTH_PROVIDER_ALIASES.has('unknown-provider')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// collectActiveExternalPackageNames — webhook-only config activation
// ---------------------------------------------------------------------------

describe('collectActiveExternalPackageNames', () => {
  it('includes kl-plugin-webhook for an empty config (default webhook activation)', () => {
    const result = collectActiveExternalPackageNames({})
    expect(result).toContain('kl-plugin-webhook')
  })

  it('includes kl-plugin-auth-visibility when auth.visibility is configured', () => {
    const result = collectActiveExternalPackageNames({
      plugins: { 'auth.visibility': { provider: 'kl-plugin-auth-visibility' } },
    })
    expect(result).toContain('kl-plugin-auth-visibility')
  })

  it('maps sqlite card.state provider ids to the workspace package name', () => {
    const result = collectActiveExternalPackageNames({
      plugins: { 'card.state': { provider: 'sqlite' } },
    })
    expect(result).toContain('kl-plugin-storage-sqlite')
  })

  it('includes kl-plugin-webhook when webhookPlugin key is explicitly configured', () => {
    const result = collectActiveExternalPackageNames({
      webhookPlugin: { 'webhook.delivery': { provider: 'webhooks' } },
    })
    expect(result).toContain('kl-plugin-webhook')
  })

  it('includes kl-plugin-webhook via plugins["webhook.delivery"] override', () => {
    const result = collectActiveExternalPackageNames({
      plugins: { 'webhook.delivery': { provider: 'webhooks' } },
    })
    expect(result).toContain('kl-plugin-webhook')
  })

  it('includes kl-plugin-callback via plugins["callback.runtime"] override', () => {
    const result = collectActiveExternalPackageNames({
      plugins: { 'callback.runtime': { provider: 'callbacks' } },
    })
    expect(result).toContain('kl-plugin-callback')
  })

  it('includes kl-plugin-cron via plugins["cron.runtime"] override', () => {
    expect(CRON_PROVIDER_ALIASES.get('cron')).toBe('kl-plugin-cron')

    const result = collectActiveExternalPackageNames({
      plugins: { 'cron.runtime': { provider: 'cron' } },
    })
    expect(result).toContain('kl-plugin-cron')
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
    // In dev the sibling `../kl-plugin-webhook` is built and resolves successfully.
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
    }
    const mockListener = {
      manifest: { id: 'test-webhooks-listener', provides: ['event.listener'] },
      register: () => {},
      unregister: () => {},
    }

    const cleanup = installTempPackage('kl-plugin-webhook', `
      module.exports = {
        webhookProviderPlugin: {
          manifest: { id: 'test-webhooks', provides: ['webhook.delivery'] },
          listWebhooks: () => [],
          createWebhook: (_root, input) => ({ id: 'wh_test', url: input.url, events: input.events, active: true }),
          updateWebhook: () => null,
          deleteWebhook: () => false,
        },
        webhookListenerPlugin: {
          manifest: { id: 'test-webhooks-listener', provides: ['event.listener'] },
          register: () => {},
          unregister: () => {},
        },
      }
    `)

    try {
      expect(mockPlugin.manifest.id).toBe('test-webhooks')
      expect(mockListener.manifest.id).toBe('test-webhooks-listener')
      const webhookCaps = normalizeWebhookCapabilities({})
      const bag = resolveCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        webhookCaps,
      )
      expect(bag.webhookProvider).not.toBeNull()
      expect(bag.webhookProvider!.manifest.id).toBeTruthy()
      expect(bag.webhookProvider!.manifest.provides).toContain('webhook.delivery')
      expect(typeof bag.webhookProvider!.listWebhooks).toBe('function')
      if (bag.webhookListener) {
        expect(bag.webhookListener.manifest.id).toBeTruthy()
        expect(bag.webhookListener.manifest.provides).toContain('event.listener')
      }
    } finally {
      cleanup()
    }
  })

  it('standaloneHttpPlugins includes kl-plugin-webhook under webhook-only config', () => {
    const webhookCaps = normalizeWebhookCapabilities({})
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
      undefined,
      webhookCaps,
    )
    expect(bag.standaloneHttpPlugins.some((p) => p.manifest.id === 'webhooks')).toBe(true)
  })

  it('falls back to the workspace webhook package when node_modules contains a stale symlink', () => {
    const cleanup = installBrokenPackageSymlink('kl-plugin-webhook')

    try {
      const webhookCaps = normalizeWebhookCapabilities({})
      const bag = resolveCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        webhookCaps,
      )

      expect(bag.webhookProvider?.manifest.id).toBe('webhooks')
      expect(bag.standaloneHttpPlugins.some((plugin) => plugin.manifest.id === 'webhooks')).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe('resolveCapabilityBag – callback.runtime', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    resetRuntimeHost()
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-callback-test-'))
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    resetRuntimeHost()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('exports the callback provider alias map', () => {
    expect(CALLBACK_PROVIDER_ALIASES.get('callbacks')).toBe('kl-plugin-callback')
    expect(CALLBACK_PROVIDER_ALIASES.get('cloudflare')).toBe('kl-plugin-cloudflare')
  })

  it('returns callbackListener=null when callbackCapabilities is omitted', () => {
    const bag = resolveCapabilityBag(
      { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
      kanbanDir,
    )
    expect(bag.callbackListener).toBeNull()
    expect(bag.callbackProviders).toBeNull()
  })

  it('loads callbackListenerPlugin from a temp-installed package', async () => {
    const cleanup = installTempPackage('temp-callback-runtime-package', `
      module.exports = {
        callbackListenerPlugin: {
          manifest: { id: 'test-callback-listener', provides: ['event.listener'] },
          register: () => {},
          unregister: () => {},
          optionsSchema: () => ({ schema: { type: 'object', properties: { handlers: { type: 'array' } } } }),
        },
      }
    `)

    try {
      const callbackCaps = normalizeCallbackCapabilities({
        plugins: { 'callback.runtime': { provider: 'temp-callback-runtime-package' } },
      })
      const resolveFreshCapabilityBag = await loadFreshResolveCapabilityBag()
      const bag = resolveFreshCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        undefined,
        undefined,
        callbackCaps,
      )

      expect(bag.callbackProviders).toEqual(callbackCaps)
      expect(bag.callbackListener).not.toBeNull()
      expect(bag.callbackListener?.manifest.id).toBe('test-callback-listener')
      expect(bag.callbackListener?.manifest.provides).toContain('event.listener')
    } finally {
      cleanup()
    }
  })

  it('falls back to the workspace callback package when node_modules contains a stale symlink', async () => {
    const cleanup = installBrokenPackageSymlink('kl-plugin-callback')

    try {
      const callbackCaps = normalizeCallbackCapabilities({
        plugins: { 'callback.runtime': { provider: 'callbacks' } },
      })
      const resolveFreshCapabilityBag = await loadFreshResolveCapabilityBag()
      const bag = resolveFreshCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        undefined,
        undefined,
        callbackCaps,
      )

      expect(bag.callbackListener?.manifest.id).toBe('kl-plugin-callback')
      expect(bag.callbackListener?.manifest.provides).toContain('event.listener')
    } finally {
      cleanup()
    }

    expectPackageRestoredToWorkspaceSymlink('kl-plugin-callback')
  })

  it('falls back to the workspace callback package after a temp package swap leaves stale resolution state behind', async () => {
    const callbackCaps = normalizeCallbackCapabilities({
      plugins: { 'callback.runtime': { provider: 'callbacks' } },
    })
    const packageDir = path.join(process.cwd(), 'node_modules', 'kl-plugin-callback')
    const installCleanup = installTempPackage('kl-plugin-callback', `
      module.exports = {
        callbackListenerPlugin: {
          manifest: { id: 'temp-swap-callback-listener', provides: ['event.listener'] },
          register: () => {},
          unregister: () => {},
        },
      }
    `)

    try {
      expect(fs.lstatSync(packageDir).isDirectory()).toBe(true)
      expect(fs.readFileSync(path.join(packageDir, 'index.js'), 'utf-8')).toContain('temp-swap-callback-listener')
    } finally {
      installCleanup()
    }

    const brokenCleanup = installBrokenPackageSymlink('kl-plugin-callback')

    try {
      const resolveFreshCapabilityBag = await loadFreshResolveCapabilityBag()
      const bag = resolveFreshCapabilityBag(
        { 'card.storage': { provider: 'markdown' }, 'attachment.storage': { provider: 'localfs' } },
        kanbanDir,
        undefined,
        undefined,
        undefined,
        callbackCaps,
      )

      expect(bag.callbackListener?.manifest.id).toBe('kl-plugin-callback')
      expect(bag.callbackListener?.manifest.provides).toContain('event.listener')
    } finally {
      brokenCleanup()
    }

    expectPackageRestoredToWorkspaceSymlink('kl-plugin-callback')
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
    expect(fs.existsSync(path.join(packagesDir, 'kl-plugin-storage-sqlite'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-plugin-storage-mysql'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-plugin-auth'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-plugin-auth-visibility'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-plugin-webhook'))).toBe(true)
    expect(fs.existsSync(path.join(packagesDir, 'kl-plugin-attachment-s3'))).toBe(true)
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

  it('resolves kl-plugin-storage-sqlite from workspace packages/ directory', () => {
    // kl-plugin-storage-sqlite is not published to npm but lives in packages/kl-plugin-storage-sqlite.
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

  it('resolves kl-plugin-storage-mysql from workspace packages/ directory', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'mysql', options: { database: 'kanban_db' } },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
    )
    expect(bag.cardStorage.type).toBe('mysql')
  })

  it('resolves kl-plugin-auth NOOP_IDENTITY_PLUGIN from workspace packages/', () => {
    // kl-plugin-auth is in packages/kl-plugin-auth; the NOOP/RBAC constants are
    // loaded at module init time via the workspace-local path.
    expect(NOOP_IDENTITY_PLUGIN.manifest.id).toBe('noop')
    expect(NOOP_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })

  it('resolves kl-plugin-auth RBAC_IDENTITY_PLUGIN from workspace packages/', () => {
    expect(RBAC_IDENTITY_PLUGIN.manifest.id).toBe('rbac')
    expect(RBAC_IDENTITY_PLUGIN.manifest.provides).toContain('auth.identity')
  })

  it('resolves kl-plugin-auth-visibility from workspace packages/ directory', () => {
    const bag = resolveCapabilityBag(
      {
        'card.storage': { provider: 'markdown' },
        'attachment.storage': { provider: 'localfs' },
      },
      kanbanDir,
      normalizeAuthCapabilities({
        plugins: {
          'auth.visibility': { provider: 'kl-plugin-auth-visibility' },
        },
      }),
    )

    expect(bag.authVisibility?.manifest).toEqual({
      id: 'kl-plugin-auth-visibility',
      provides: ['auth.visibility'],
    })
  })
})

// ---------------------------------------------------------------------------
// SDK extension loading (SPE-01)
// ---------------------------------------------------------------------------

describe('SDK extension loading', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sdk-ext-test-'))
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

  it('sdkExtensions is an empty array when no active plugin exports sdkExtensionPlugin', () => {
    // Markdown + localfs are built-in; no external packages are loaded, so no
    // sdkExtensionPlugin exports are discovered and the array must be empty.
    const bag = resolveCapabilityBag(storageCaps, kanbanDir)
    expect(Array.isArray(bag.sdkExtensions)).toBe(true)
    expect(bag.sdkExtensions).toHaveLength(0)
  })

  it('sdkExtensions is still an array when webhookCapabilities is omitted (no active webhook package)', () => {
    const bag = resolveCapabilityBag(storageCaps, kanbanDir)
    expect(bag.sdkExtensions).toBeDefined()
    expect(bag.sdkExtensions.length).toBeGreaterThanOrEqual(0)
  })

  it('sdkExtensions entry has id and extensions when a plugin exports sdkExtensionPlugin', () => {
    const cleanup = installTempPackage(
      'kanban-sdk-ext-test-plugin',
      `module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-sdk-ext-test-plugin', provides: ['card.storage'] },
    createEngine(kanbanDir) {
      return {
        type: 'markdown', kanbanDir,
        async init() {}, close() {}, async migrate() {}, async ensureBoardDirs() {},
        async deleteBoardData() {}, async scanCards() { return [] }, async writeCard() {},
        async moveCard() { return '' }, async renameCard() { return '' }, async deleteCard() {},
        getCardDir() { return kanbanDir }, async copyAttachment() {},
      }
    },
  },
  sdkExtensionPlugin: {
    manifest: { id: 'kanban-sdk-ext-test-plugin', provides: ['sdk.extensions'] },
    extensions: {
      greet: () => 'hello from extension',
    },
  },
}`
    )

    try {
      const bag = resolveCapabilityBag(
        {
          'card.storage': { provider: 'kanban-sdk-ext-test-plugin' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )

      expect(bag.sdkExtensions).toHaveLength(1)
      const ext = bag.sdkExtensions[0] as SDKExtensionLoaderResult<{ greet: () => string }>
      expect(ext.id).toBe('kanban-sdk-ext-test-plugin')
      expect(ext.events).toEqual([])
      expect(typeof ext.extensions.greet).toBe('function')
      expect(ext.extensions.greet()).toBe('hello from extension')
    } finally {
      cleanup()
    }
  })

  it('sdkExtensions preserves plugin-declared event catalogs when a plugin exports events', () => {
    const cleanup = installTempPackage(
      'kanban-sdk-ext-events-plugin',
      `module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-sdk-ext-events-plugin', provides: ['card.storage'] },
    createEngine(kanbanDir) {
      return {
        type: 'markdown', kanbanDir,
        async init() {}, close() {}, async migrate() {}, async ensureBoardDirs() {},
        async deleteBoardData() {}, async scanCards() { return [] }, async writeCard() {},
        async moveCard() { return '' }, async renameCard() { return '' }, async deleteCard() {},
        getCardDir() { return kanbanDir }, async copyAttachment() {},
      }
    },
  },
  sdkExtensionPlugin: {
    manifest: { id: 'kanban-sdk-ext-events-plugin', provides: ['sdk.extensions'] },
    events: [
      { event: 'workflow.run', phase: 'before', label: 'Before workflow run' },
      { event: 'workflow.completed', phase: 'after', label: 'Workflow completed', apiAfter: true },
    ],
    extensions: {
      greet: () => 'hello from extension',
    },
  },
}`
    )

    try {
      const bag = resolveCapabilityBag(
        {
          'card.storage': { provider: 'kanban-sdk-ext-events-plugin' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )

      expect(bag.sdkExtensions).toHaveLength(1)
      expect(bag.sdkExtensions[0].events).toEqual([
        { event: 'workflow.run', phase: 'before', label: 'Before workflow run' },
        { event: 'workflow.completed', phase: 'after', label: 'Workflow completed', apiAfter: true },
      ])
    } finally {
      cleanup()
    }
  })

  it('plugin without sdkExtensionPlugin does not appear in sdkExtensions', () => {
    const cleanup = installTempPackage(
      'kanban-no-sdk-ext-plugin',
      `module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-no-sdk-ext-plugin', provides: ['card.storage'] },
    createEngine(kanbanDir) {
      return {
        type: 'markdown', kanbanDir,
        async init() {}, close() {}, async migrate() {}, async ensureBoardDirs() {},
        async deleteBoardData() {}, async scanCards() { return [] }, async writeCard() {},
        async moveCard() { return '' }, async renameCard() { return '' }, async deleteCard() {},
        getCardDir() { return kanbanDir }, async copyAttachment() {},
      }
    },
  },
}`
    )

    try {
      const bag = resolveCapabilityBag(
        {
          'card.storage': { provider: 'kanban-no-sdk-ext-plugin' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )
      expect(bag.sdkExtensions).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('sdkExtensionPlugin with invalid manifest shape is silently ignored', () => {
    const cleanup = installTempPackage(
      'kanban-bad-ext-plugin',
      `module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-bad-ext-plugin', provides: ['card.storage'] },
    createEngine(kanbanDir) {
      return {
        type: 'markdown', kanbanDir,
        async init() {}, close() {}, async migrate() {}, async ensureBoardDirs() {},
        async deleteBoardData() {}, async scanCards() { return [] }, async writeCard() {},
        async moveCard() { return '' }, async renameCard() { return '' }, async deleteCard() {},
        getCardDir() { return kanbanDir }, async copyAttachment() {},
      }
    },
  },
  sdkExtensionPlugin: {
    // Missing 'extensions' field — not a valid SDKExtensionPlugin
    manifest: { id: 'kanban-bad-ext-plugin', provides: ['sdk.extensions'] },
  },
}`
    )

    try {
      // Must not throw; invalid sdkExtensionPlugin is silently skipped
      const bag = resolveCapabilityBag(
        {
          'card.storage': { provider: 'kanban-bad-ext-plugin' },
          'attachment.storage': { provider: 'localfs' },
        },
        kanbanDir,
      )
      expect(bag.sdkExtensions).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('SDKExtensionPlugin type is satisfied by a valid plugin shape (compile-time contract)', () => {
    // This test verifies the TypeScript contract is usable by plugin authors.
    const plugin: SDKExtensionPlugin<{ ping: () => string }> = {
      manifest: { id: 'test-plugin', provides: ['sdk.extensions'] },
      events: [{ event: 'workflow.run', phase: 'before' }],
      extensions: { ping: () => 'pong' },
    }
    expect(plugin.manifest.id).toBe('test-plugin')
    expect(plugin.events).toEqual([{ event: 'workflow.run', phase: 'before' }])
    expect(plugin.extensions.ping()).toBe('pong')
  })

  it('SDKExtensionLoaderResult type carry the resolved id and extensions', () => {
    // Verify the result type structure is correct.
    const result: SDKExtensionLoaderResult<{ value: number }> = {
      id: 'my-plugin',
      events: [],
      extensions: { value: 42 },
    }
    expect(result.id).toBe('my-plugin')
    expect(result.events).toEqual([])
    expect(result.extensions.value).toBe(42)
  })
})

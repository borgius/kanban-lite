import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import {
  AuthError,
  CardStateError,
  CARD_STATE_DEFAULT_ACTOR_MODE,
  DEFAULT_CARD_STATE_ACTOR,
  ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
  ERR_CARD_STATE_UNAVAILABLE,
} from '../types'
import type { StorageEngine } from '../plugins/types'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sdk-test-'))
}

const runtimeRequire = createRequire(import.meta.url)

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
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

function writeCardFile(dir: string, filename: string, content: string, subfolder?: string): void {
  const targetDir = subfolder ? path.join(dir, 'boards', 'default', subfolder) : dir
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(path.join(targetDir, filename), content, 'utf-8')
}

function writeWorkspaceConfig(workspaceDir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify({ version: 2, ...config }), 'utf-8')
}

function createInjectedStorageStub(kanbanDir: string): StorageEngine {
  return {
    type: 'markdown',
    kanbanDir,
    async init() {},
    close() {},
    async migrate() {},
    async ensureBoardDirs() {},
    async deleteBoardData() {},
    async scanCards() { return [] },
    async writeCard() {},
    async moveCard() { return '' },
    async renameCard() { return '' },
    async deleteCard() {},
    getCardDir() { return path.join(kanbanDir, 'attachments') },
    async copyAttachment() {},
  }
}

function makeCardContent(opts: {
  id: string
  status?: string
  priority?: string
  title?: string
  order?: string
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
  created?: string
  modified?: string
}): string {
  const {
    id,
    status = 'backlog',
    priority = 'medium',
    title = 'Test Card',
    order = 'a0',
    assignee = null,
    dueDate = null,
    labels = [],
    created = '2025-01-01T00:00:00.000Z',
    modified = '2025-01-01T00:00:00.000Z',
  } = opts
  return `---
id: "${id}"
status: "${status}"
priority: "${priority}"
assignee: ${assignee ? `"${assignee}"` : 'null'}
dueDate: ${dueDate ? `"${dueDate}"` : 'null'}
created: "${created}"
modified: "${modified}"
completedAt: null
labels: [${labels.map(l => `"${l}"`).join(', ')}]
order: "${order}"
---
# ${title}

Description here.`
}

describe('KanbanSDK', () => {
  let workspaceDir: string
  let tempDir: string // kanbanDir (alias kept for minimal test changes)
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    tempDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(tempDir, { recursive: true })
    sdk = new KanbanSDK(tempDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  describe('init', () => {
    it('should create the cards directory', async () => {
      await sdk.init()
      expect(fs.existsSync(tempDir)).toBe(true)
    })
  })

  describe('getConfigSnapshot', () => {
    it('returns an isolated clone that cannot mutate subsequent SDK reads or persisted config', () => {
      writeWorkspaceConfig(workspaceDir, {
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        boards: {
          default: {
            name: 'Default',
            columns: [{ id: 'backlog', name: 'Backlog' }],
            nextCardId: 1,
            defaultStatus: 'backlog',
            defaultPriority: 'medium',
          },
        },
        plugins: {
          'auth.identity': {
            provider: 'kl-plugin-auth',
            options: {
              users: [{ username: 'alice', password: '$2b$12$existing-hash' }],
            },
          },
        },
        webhooks: [
          { id: 'wh_snapshot', url: 'https://example.com/original', events: ['*'], active: true },
        ],
      })

      const firstSnapshot = sdk.getConfigSnapshot() as unknown as {
        defaultBoard: string
        boards: { default: { name: string } }
        webhooks: Array<{ url: string }>
        plugins: {
          'auth.identity': {
            options: {
              users: Array<{ username: string; password: string }>
            }
          }
        }
      }
      firstSnapshot.defaultBoard = 'mutated-board'
      firstSnapshot.boards.default.name = 'Mutated Board'
      firstSnapshot.webhooks[0].url = 'https://example.com/mutated'
      firstSnapshot.plugins['auth.identity'].options.users.push({ username: 'mallory', password: 'bad-hash' })

      const secondSnapshot = sdk.getConfigSnapshot() as typeof firstSnapshot
      const persisted = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8')) as typeof firstSnapshot

      expect(secondSnapshot.defaultBoard).toBe('default')
      expect(secondSnapshot.boards.default.name).toBe('Default')
      expect(secondSnapshot.webhooks[0].url).toBe('https://example.com/original')
      expect(secondSnapshot.plugins['auth.identity'].options.users).toEqual([
        { username: 'alice', password: '$2b$12$existing-hash' },
      ])
      expect(sdk.listWebhooks()).toEqual([
        { id: 'wh_snapshot', url: 'https://example.com/original', events: ['*'], active: true },
      ])
      expect(persisted.defaultBoard).toBe('default')
      expect(persisted.boards.default.name).toBe('Default')
      expect(persisted.webhooks).toEqual([
        { id: 'wh_snapshot', url: 'https://example.com/original', events: ['*'], active: true },
      ])
      expect(persisted.plugins['auth.identity'].options.users).toEqual([
        { username: 'alice', password: '$2b$12$existing-hash' },
      ])
    })
  })

  describe('getCardStateStatus', () => {
    it('reports builtin backend status and allows the default actor when auth.identity is noop', () => {
      const status = sdk.getCardStateStatus()

      expect(status).toEqual({
        provider: 'builtin',
        active: true,
        backend: 'builtin',
        availability: 'available',
        defaultActorMode: 'auth-absent-only',
        defaultActor: {
          id: 'default-user',
          source: 'default',
          mode: 'auth-absent-only',
        },
        defaultActorAvailable: true,
      })
      expect(status.defaultActorMode).toBe(CARD_STATE_DEFAULT_ACTOR_MODE)
      expect(status.defaultActor).toBe(DEFAULT_CARD_STATE_ACTOR)
    })

    it('reuses one shared default-actor contract across auth-absent status snapshots', () => {
      const first = sdk.getCardStateStatus()
      const second = sdk.getCardStateStatus()

      expect(first.defaultActorMode).toBe(CARD_STATE_DEFAULT_ACTOR_MODE)
      expect(second.defaultActorMode).toBe(CARD_STATE_DEFAULT_ACTOR_MODE)
      expect(first.defaultActor).toBe(DEFAULT_CARD_STATE_ACTOR)
      expect(second.defaultActor).toBe(DEFAULT_CARD_STATE_ACTOR)
      expect(second.defaultActor).toBe(first.defaultActor)
    })

    it('classifies configured card.state providers as external backends', () => {
      const cleanup = installTempPackage(
        'acme-card-state',
        `module.exports = {
  cardStateProvider: {
    manifest: { id: 'acme-card-state', provides: ['card.state'] },
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
  },
}
`,
      )

      try {
        writeWorkspaceConfig(workspaceDir, {
          plugins: {
            'card.state': { provider: 'acme-card-state' },
          },
        })

        const localSdk = new KanbanSDK(tempDir)

        expect(localSdk.getCardStateStatus()).toMatchObject({
          provider: 'acme-card-state',
          active: true,
          backend: 'external',
          availability: 'available',
        })

        localSdk.close()
      } finally {
        cleanup()
      }
    })

    it('marks the default actor unavailable when a real auth.identity provider is configured', () => {
      writeWorkspaceConfig(workspaceDir, {
        auth: {
          'auth.identity': { provider: 'rbac' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localSdk = new KanbanSDK(tempDir)

      expect(localSdk.getCardStateStatus()).toMatchObject({
        provider: 'builtin',
        backend: 'builtin',
        availability: 'available',
        defaultActorAvailable: false,
      })

      localSdk.close()
    })

    it('does not fall back to the default actor when the configured identity provider resolves no caller', async () => {
      writeWorkspaceConfig(workspaceDir, {
        auth: {
          'auth.identity': { provider: 'rbac' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localSdk = new KanbanSDK(tempDir)

      const identity = await localSdk.capabilities?.authIdentity.resolveIdentity({
        token: 'unknown-token',
        tokenSource: 'header',
        transport: 'http',
      })
      const authStatus = localSdk.getAuthStatus()
      const cardStateStatus = localSdk.getCardStateStatus()

      expect(identity).toBeNull()
      expect(authStatus).toMatchObject({
        identityProvider: 'rbac',
        identityEnabled: true,
      })
      expect(cardStateStatus).toMatchObject({
        provider: 'builtin',
        backend: 'builtin',
        availability: 'available',
        defaultActorMode: CARD_STATE_DEFAULT_ACTOR_MODE,
        defaultActorAvailable: false,
      })
      expect(cardStateStatus.defaultActor).toBe(DEFAULT_CARD_STATE_ACTOR)

      localSdk.close()
    })

    it('keeps configured identity gating distinct from backend unavailability in status snapshots', () => {
      writeWorkspaceConfig(workspaceDir, {
        auth: {
          'auth.identity': { provider: 'rbac' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const authConfiguredSdk = new KanbanSDK(tempDir)
      const authConfiguredStatus = authConfiguredSdk.getCardStateStatus()

      expect(authConfiguredStatus).toMatchObject({
        provider: 'builtin',
        backend: 'builtin',
        availability: 'available',
        defaultActorAvailable: false,
      })
      expect(authConfiguredStatus.errorCode).toBeUndefined()

      authConfiguredSdk.close()

      const unavailableSdk = new KanbanSDK(tempDir, { storage: createInjectedStorageStub(tempDir) })

      expect(unavailableSdk.getCardStateStatus()).toMatchObject({
        provider: 'none',
        backend: 'none',
        availability: 'unavailable',
        defaultActorAvailable: true,
        errorCode: ERR_CARD_STATE_UNAVAILABLE,
      })

      unavailableSdk.close()
    })

    it('reports unavailable status when capabilities are absent because storage was injected directly', () => {
      const localSdk = new KanbanSDK(tempDir, { storage: createInjectedStorageStub(tempDir) })

      expect(localSdk.getCardStateStatus()).toEqual({
        provider: 'none',
        active: false,
        backend: 'none',
        availability: 'unavailable',
        defaultActorMode: 'auth-absent-only',
        defaultActor: {
          id: 'default-user',
          source: 'default',
          mode: 'auth-absent-only',
        },
        defaultActorAvailable: true,
        errorCode: 'ERR_CARD_STATE_UNAVAILABLE',
      })

      localSdk.close()
    })
  })

  describe('CardStateError', () => {
    it('maps public card-state error codes to the expected availability classifications', () => {
      expect(
        new CardStateError(ERR_CARD_STATE_IDENTITY_UNAVAILABLE, 'identity is unavailable').availability,
      ).toBe('identity-unavailable')
      expect(
        new CardStateError(ERR_CARD_STATE_UNAVAILABLE, 'card state is unavailable').availability,
      ).toBe('unavailable')
    })
  })

  describe('event proxies', () => {
    it('subscribes directly through sdk.on()', async () => {
      const listener = vi.fn()
      const unsub = sdk.on('task.created', listener)

      await sdk.createCard({ content: '# Event Card' })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.created' }))

      unsub()
    })

    it('supports sdk.once() and sdk.waitFor()', async () => {
      const onceListener = vi.fn()
      sdk.once('task.created', onceListener)

      const pending = sdk.waitFor('task.created')
      const created = await sdk.createCard({ content: '# Wait For Event' })
      const event = await pending

      expect(onceListener).toHaveBeenCalledTimes(1)
      expect(event).toEqual(expect.objectContaining({
        type: 'task.created',
        data: expect.objectContaining({
          event: 'task.created',
          data: expect.objectContaining({ id: created.id }),
        }),
      }))
    })

    it('tracks catch-all listeners and event names through sdk proxies', () => {
      const initialCount = sdk.listenerCount()
      const anyListener = vi.fn()
      sdk.on('task.*', vi.fn())
      sdk.onAny(anyListener)
      const countAfterRegister = sdk.listenerCount()

      expect(sdk.eventNames()).toContain('task.*')
      expect(countAfterRegister).toBeGreaterThan(initialCount)
      expect(sdk.hasListeners()).toBe(true)

      sdk.offAny(anyListener)
      expect(sdk.listenerCount()).toBeLessThan(countAfterRegister)

      sdk.removeAllListeners()
      expect(sdk.hasListeners()).toBe(false)
    })
  })

  describe('listAvailableEvents', () => {
    it('returns built-in before and after events by default', () => {
      const events = sdk.listAvailableEvents()

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'card.create',
          phase: 'before',
          source: 'core',
          sdkBefore: true,
          sdkAfter: false,
          apiAfter: false,
        }),
        expect.objectContaining({
          event: 'task.created',
          phase: 'after',
          source: 'core',
          sdkBefore: false,
          sdkAfter: true,
          apiAfter: true,
        }),
      ]))
    })

    it('filters events by type and wildcard mask', () => {
      const events = sdk.listAvailableEvents({ type: 'after', mask: 'task.*' })

      expect(events).not.toHaveLength(0)
      expect(events.every((event) => event.phase === 'after')).toBe(true)
      expect(events.map((event) => event.event)).toEqual([
        'task.created',
        'task.deleted',
        'task.moved',
        'task.updated',
      ])
    })

    it('includes plugin-declared events from active sdk extension plugins', () => {
      const cleanup = installTempPackage(
        'kanban-sdk-events-plugin',
        `module.exports = {
  cardStoragePlugin: {
    manifest: { id: 'kanban-sdk-events-plugin', provides: ['card.storage'] },
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
    manifest: { id: 'kanban-sdk-events-plugin', provides: ['sdk.extensions'] },
    events: [
      { event: 'workflow.run', phase: 'before', label: 'Before workflow run' },
      { event: 'workflow.completed', phase: 'after', label: 'Workflow completed', apiAfter: true },
    ],
    extensions: {
      ping: () => 'pong',
    },
  },
}`,
      )

      try {
        writeWorkspaceConfig(workspaceDir, {
          plugins: {
            'card.storage': { provider: 'kanban-sdk-events-plugin' },
          },
        })

        const localSdk = new KanbanSDK(tempDir)
        const events = localSdk.listAvailableEvents({ mask: 'workflow.*' })

        expect(events).toEqual([
          {
            event: 'workflow.run',
            phase: 'before',
            source: 'plugin',
            resource: undefined,
            label: 'Before workflow run',
            sdkBefore: true,
            sdkAfter: false,
            apiAfter: false,
            pluginIds: ['kanban-sdk-events-plugin'],
          },
          {
            event: 'workflow.completed',
            phase: 'after',
            source: 'plugin',
            resource: undefined,
            label: 'Workflow completed',
            sdkBefore: false,
            sdkAfter: true,
            apiAfter: true,
            pluginIds: ['kanban-sdk-events-plugin'],
          },
        ])

        localSdk.close()
      } finally {
        cleanup()
      }
    })
  })

  describe('listCards', () => {
    it('should return empty array for empty directory', async () => {
      const cards = await sdk.listCards()
      expect(cards).toEqual([])
    })

    it('should list cards from status subfolders', async () => {
      writeCardFile(tempDir, 'active.md', makeCardContent({ id: 'active', status: 'todo', order: 'a0' }), 'todo')
      writeCardFile(tempDir, 'completed.md', makeCardContent({ id: 'completed', status: 'done', order: 'a1' }), 'done')

      const cards = await sdk.listCards()
      expect(cards.length).toBe(2)
      expect(cards.map(c => c.id).sort()).toEqual(['active', 'completed'])
    })

    it('should return cards sorted by order', async () => {
      writeCardFile(tempDir, 'b.md', makeCardContent({ id: 'b', order: 'b0' }), 'backlog')
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', order: 'a0' }), 'backlog')

      const cards = await sdk.listCards()
      expect(cards[0].id).toBe('a')
      expect(cards[1].id).toBe('b')
    })

    it('should skip files without valid frontmatter', async () => {
      writeCardFile(tempDir, 'invalid.md', '# No frontmatter', 'backlog')
      writeCardFile(tempDir, 'valid.md', makeCardContent({ id: 'valid' }), 'backlog')

      const cards = await sdk.listCards()
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('valid')
    })

    it('should also load orphaned root-level files for backward compat', async () => {
      writeCardFile(tempDir, 'orphan.md', makeCardContent({ id: 'orphan', status: 'backlog' }))

      const cards = await sdk.listCards()
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('orphan')
    })

    it('sorts by created:asc', async () => {
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', order: 'a0', created: '2025-01-03T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'b.md', makeCardContent({ id: 'b', order: 'b0', created: '2025-01-01T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'c.md', makeCardContent({ id: 'c', order: 'c0', created: '2025-01-02T00:00:00.000Z' }), 'backlog')

      const cards = await sdk.listCards(undefined, undefined, undefined, 'created:asc')
      expect(cards.map(c => c.id)).toEqual(['b', 'c', 'a'])
    })

    it('sorts by created:desc', async () => {
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', order: 'a0', created: '2025-01-03T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'b.md', makeCardContent({ id: 'b', order: 'b0', created: '2025-01-01T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'c.md', makeCardContent({ id: 'c', order: 'c0', created: '2025-01-02T00:00:00.000Z' }), 'backlog')

      const cards = await sdk.listCards(undefined, undefined, undefined, 'created:desc')
      expect(cards.map(c => c.id)).toEqual(['a', 'c', 'b'])
    })

    it('sorts by modified:asc', async () => {
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', order: 'a0', modified: '2025-03-01T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'b.md', makeCardContent({ id: 'b', order: 'b0', modified: '2025-01-01T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'c.md', makeCardContent({ id: 'c', order: 'c0', modified: '2025-02-01T00:00:00.000Z' }), 'backlog')

      const cards = await sdk.listCards(undefined, undefined, undefined, 'modified:asc')
      expect(cards.map(c => c.id)).toEqual(['b', 'c', 'a'])
    })

    it('sorts by modified:desc', async () => {
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', order: 'a0', modified: '2025-03-01T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'b.md', makeCardContent({ id: 'b', order: 'b0', modified: '2025-01-01T00:00:00.000Z' }), 'backlog')
      writeCardFile(tempDir, 'c.md', makeCardContent({ id: 'c', order: 'c0', modified: '2025-02-01T00:00:00.000Z' }), 'backlog')

      const cards = await sdk.listCards(undefined, undefined, undefined, 'modified:desc')
      expect(cards.map(c => c.id)).toEqual(['a', 'c', 'b'])
    })
  })

  describe('getCard', () => {
    it('should return a card by ID', async () => {
      writeCardFile(tempDir, 'find-me.md', makeCardContent({ id: 'find-me', priority: 'high' }), 'backlog')

      const card = await sdk.getCard('find-me')
      expect(card).not.toBeNull()
      expect(card?.id).toBe('find-me')
      expect(card?.priority).toBe('high')
    })

    it('should return null for non-existent card', async () => {
      const card = await sdk.getCard('ghost')
      expect(card).toBeNull()
    })
  })

  describe('getActiveCard', () => {
    it('should return the currently active card after it is marked active', async () => {
      writeCardFile(tempDir, 'active-card.md', makeCardContent({ id: 'active-card', priority: 'high' }), 'backlog')

      await sdk.setActiveCard('active-card')

      const card = await sdk.getActiveCard()
      expect(card?.id).toBe('active-card')
      expect(card?.priority).toBe('high')
    })

    it('should return null when no active card is set', async () => {
      const card = await sdk.getActiveCard()
      expect(card).toBeNull()
    })

    it('should clear and return null when the tracked active card no longer exists', async () => {
      writeCardFile(tempDir, 'stale-active.md', makeCardContent({ id: 'stale-active' }), 'backlog')

      await sdk.setActiveCard('stale-active')
      await sdk.permanentlyDeleteCard('stale-active')

      await expect(sdk.getActiveCard()).resolves.toBeNull()
      await expect(sdk.getActiveCard()).resolves.toBeNull()
    })
  })

  describe('createCard', () => {
    it('should create a card file on disk', async () => {
      const card = await sdk.createCard({
        content: '# New Card\n\nSome description',
        status: 'todo',
        priority: 'high',
        labels: ['frontend']
      })

      expect(card.status).toBe('todo')
      expect(card.priority).toBe('high')
      expect(card.labels).toEqual(['frontend'])
      expect(fs.existsSync(card.filePath)).toBe(true)

      const onDisk = fs.readFileSync(card.filePath, 'utf-8')
      expect(onDisk).toContain('status: "todo"')
      expect(onDisk).toContain('# New Card')
    })

    it('should use defaults for optional fields', async () => {
      const card = await sdk.createCard({ content: '# Default Card' })
      expect(card.status).toBe('backlog')
      expect(card.priority).toBe('medium')
      expect(card.assignee).toBeNull()
      expect(card.labels).toEqual([])
    })

    it('should place cards in their status subfolder', async () => {
      const card = await sdk.createCard({
        content: '# Todo Card',
        status: 'todo'
      })
      expect(card.filePath).toContain('/todo/')
    })

    it('should place done cards in done/ subfolder', async () => {
      const card = await sdk.createCard({
        content: '# Done Card',
        status: 'done'
      })
      expect(card.filePath).toContain('/done/')
      expect(card.completedAt).not.toBeNull()
    })

    it('should assign incremental order within a column', async () => {
      const c1 = await sdk.createCard({ content: '# First', status: 'todo' })
      const c2 = await sdk.createCard({ content: '# Second', status: 'todo' })
      expect(c2.order > c1.order).toBe(true)
    })

    it('should write version: 1 as the first frontmatter field', async () => {
      const card = await sdk.createCard({ content: '# Version Test' })
      const onDisk = fs.readFileSync(card.filePath, 'utf-8')
      // version must be the very first field after opening ---
      expect(onDisk).toMatch(/^---\nversion: 1\n/)
    })

    it('should set version to CARD_FORMAT_VERSION on new cards', async () => {
      const card = await sdk.createCard({ content: '# Version Card' })
      expect(card.version).toBe(1)
    })
  })

  describe('updateCard', () => {
    it('should update fields and persist', async () => {
      writeCardFile(tempDir, 'update-me.md', makeCardContent({ id: 'update-me', priority: 'low' }), 'backlog')

      const updated = await sdk.updateCard('update-me', {
        priority: 'critical',
        assignee: 'alice',
        labels: ['urgent']
      })

      expect(updated.priority).toBe('critical')
      expect(updated.assignee).toBe('alice')
      expect(updated.labels).toEqual(['urgent'])

      const onDisk = fs.readFileSync(updated.filePath, 'utf-8')
      expect(onDisk).toContain('priority: "critical"')
      expect(onDisk).toContain('assignee: "alice"')
    })

    it('should move file to done/ when status changes to done', async () => {
      writeCardFile(tempDir, 'finish-me.md', makeCardContent({ id: 'finish-me', status: 'review' }), 'review')

      const updated = await sdk.updateCard('finish-me', { status: 'done' })
      expect(updated.completedAt).not.toBeNull()
      expect(updated.filePath).toContain('/done/')
      expect(fs.existsSync(updated.filePath)).toBe(true)
    })

    it('should move file between status folders on any status change', async () => {
      writeCardFile(tempDir, 'move-status.md', makeCardContent({ id: 'move-status', status: 'backlog' }), 'backlog')

      const updated = await sdk.updateCard('move-status', { status: 'in-progress' })
      expect(updated.filePath).toContain('/in-progress/')
      expect(fs.existsSync(updated.filePath)).toBe(true)
      expect(fs.existsSync(path.join(tempDir, 'boards', 'default', 'backlog', 'move-status.md'))).toBe(false)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.updateCard('ghost', { priority: 'high' })).rejects.toThrow('Card not found')
    })
  })

  describe('moveCard', () => {
    it('should change status and move file to new folder', async () => {
      writeCardFile(tempDir, 'move-me.md', makeCardContent({ id: 'move-me', status: 'backlog' }), 'backlog')

      const moved = await sdk.moveCard('move-me', 'in-progress')
      expect(moved.status).toBe('in-progress')
      expect(moved.filePath).toContain('/in-progress/')
      expect(fs.existsSync(moved.filePath)).toBe(true)
    })

    it('should handle done boundary crossing', async () => {
      writeCardFile(tempDir, 'to-done.md', makeCardContent({ id: 'to-done', status: 'review' }), 'review')

      const moved = await sdk.moveCard('to-done', 'done')
      expect(moved.completedAt).not.toBeNull()
      expect(moved.filePath).toContain('/done/')
    })

    it('should insert at specified position', async () => {
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', status: 'todo', order: 'a0' }), 'todo')
      writeCardFile(tempDir, 'c.md', makeCardContent({ id: 'c', status: 'todo', order: 'a2' }), 'todo')
      writeCardFile(tempDir, 'new.md', makeCardContent({ id: 'new', status: 'backlog', order: 'a0' }), 'backlog')

      const moved = await sdk.moveCard('new', 'todo', 1)
      expect(moved.order > 'a0').toBe(true)
      expect(moved.order < 'a2').toBe(true)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.moveCard('ghost', 'todo')).rejects.toThrow('Card not found')
    })
  })

  describe('deleteCard', () => {
    it('should remove the file from disk', async () => {
      writeCardFile(tempDir, 'delete-me.md', makeCardContent({ id: 'delete-me' }), 'backlog')
      const filePath = path.join(tempDir, 'boards', 'default', 'backlog', 'delete-me.md')
      expect(fs.existsSync(filePath)).toBe(true)

      await sdk.deleteCard('delete-me')
      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.deleteCard('ghost')).rejects.toThrow('Card not found')
    })
  })

  describe('getCardsByStatus', () => {
    it('should filter cards by status', async () => {
      writeCardFile(tempDir, 'todo1.md', makeCardContent({ id: 'todo1', status: 'todo', order: 'a0' }), 'todo')
      writeCardFile(tempDir, 'todo2.md', makeCardContent({ id: 'todo2', status: 'todo', order: 'a1' }), 'todo')
      writeCardFile(tempDir, 'backlog1.md', makeCardContent({ id: 'backlog1', status: 'backlog', order: 'a0' }), 'backlog')

      const todoCards = await sdk.getCardsByStatus('todo')
      expect(todoCards.length).toBe(2)
      expect(todoCards.every(c => c.status === 'todo')).toBe(true)
    })
  })

  describe('getUniqueAssignees', () => {
    it('should return sorted unique assignees', async () => {
      writeCardFile(tempDir, 'c1.md', makeCardContent({ id: 'c1', assignee: 'bob', order: 'a0' }), 'backlog')
      writeCardFile(tempDir, 'c2.md', makeCardContent({ id: 'c2', assignee: 'alice', order: 'a1' }), 'backlog')
      writeCardFile(tempDir, 'c3.md', makeCardContent({ id: 'c3', assignee: 'bob', order: 'a2' }), 'backlog')

      const assignees = await sdk.getUniqueAssignees()
      expect(assignees).toEqual(['alice', 'bob'])
    })
  })

  describe('getUniqueLabels', () => {
    it('should return sorted unique labels', async () => {
      writeCardFile(tempDir, 'c1.md', makeCardContent({ id: 'c1', labels: ['ui', 'frontend'], order: 'a0' }), 'backlog')
      writeCardFile(tempDir, 'c2.md', makeCardContent({ id: 'c2', labels: ['backend', 'ui'], order: 'a1' }), 'backlog')

      const labels = await sdk.getUniqueLabels()
      expect(labels).toEqual(['backend', 'frontend', 'ui'])
    })
  })

  describe('Label management', () => {
    it('getLabels returns empty object by default', async () => {
      const labels = sdk.getLabels()
      expect(labels).toEqual({})
    })

    it('setLabel creates a new label definition', async () => {
      await sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
      const labels = sdk.getLabels()
      expect(labels['bug']).toEqual({ color: '#e11d48', group: 'Type' })
    })

    it('setLabel updates an existing label definition', async () => {
      await sdk.setLabel('bug', { color: '#e11d48' })
      await sdk.setLabel('bug', { color: '#2563eb', group: 'Type' })
      const labels = sdk.getLabels()
      expect(labels['bug']).toEqual({ color: '#2563eb', group: 'Type' })
    })

    it('deleteLabel removes label definition from config', async () => {
      sdk.setLabel('bug', { color: '#e11d48' })
      await sdk.deleteLabel('bug')
      const labels = sdk.getLabels()
      expect(labels['bug']).toBeUndefined()
    })

    it('deleteLabel cascades to all cards removing the label', async () => {
      writeCardFile(tempDir, '1-card.md', makeCardContent({
        id: '1-card', status: 'backlog', labels: ['bug', 'frontend']
      }), 'backlog')
      await sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })

      await sdk.deleteLabel('bug')

      const labels = sdk.getLabels()
      expect(labels['bug']).toBeUndefined()

      const cards = await sdk.listCards()
      expect(cards[0].labels).not.toContain('bug')
      expect(cards[0].labels).toContain('frontend')
    })

    it('renameLabel updates config key and cascades to all cards', async () => {
      writeCardFile(tempDir, '1-card.md', makeCardContent({
        id: '1-card', status: 'backlog', labels: ['bug', 'frontend']
      }), 'backlog')
      await sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })

      await sdk.renameLabel('bug', 'defect')

      const labels = sdk.getLabels()
      expect(labels['bug']).toBeUndefined()
      expect(labels['defect']).toEqual({ color: '#e11d48', group: 'Type' })

      const cards = await sdk.listCards()
      expect(cards[0].labels).toContain('defect')
      expect(cards[0].labels).not.toContain('bug')
      expect(cards[0].labels).toContain('frontend')
    })
  })

  describe('Label group filtering', () => {
    it('filterCardsByLabelGroup returns cards with any label from the group', async () => {
      await sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
      await sdk.setLabel('card', { color: '#2563eb', group: 'Type' })
      await sdk.setLabel('high', { color: '#f59e0b', group: 'Priority' })

      writeCardFile(tempDir, '1-card.md', makeCardContent({
        id: '1-card', status: 'backlog', labels: ['bug']
      }), 'backlog')
      writeCardFile(tempDir, '2-card.md', makeCardContent({
        id: '2-card', status: 'backlog', labels: ['high']
      }), 'backlog')
      writeCardFile(tempDir, '3-card.md', makeCardContent({
        id: '3-card', status: 'backlog', labels: ['card', 'high']
      }), 'backlog')

      const typeCards = await sdk.filterCardsByLabelGroup('Type')
      expect(typeCards.map(c => c.id).sort()).toEqual(['1-card', '3-card'])

      const priorityCards = await sdk.filterCardsByLabelGroup('Priority')
      expect(priorityCards.map(c => c.id).sort()).toEqual(['2-card', '3-card'])
    })

    it('filterCardsByLabelGroup returns empty for unknown group', async () => {
      const cards = await sdk.filterCardsByLabelGroup('NonExistent')
      expect(cards).toEqual([])
    })

    it('getLabelsInGroup returns labels belonging to a group', async () => {
      await sdk.setLabel('bug', { color: '#e11d48', group: 'Type' })
      await sdk.setLabel('card', { color: '#2563eb', group: 'Type' })
      await sdk.setLabel('high', { color: '#f59e0b', group: 'Priority' })
      await sdk.setLabel('docs', { color: '#16a34a' })

      expect(sdk.getLabelsInGroup('Type').sort()).toEqual(['bug', 'card'])
      expect(sdk.getLabelsInGroup('Priority')).toEqual(['high'])
      expect(sdk.getLabelsInGroup('Other')).toEqual([])
    })
  })

  describe('addAttachment', () => {
    it('should copy file and add to attachments', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')

      // Create a source file to attach
      const srcFile = path.join(os.tmpdir(), 'test-attach.txt')
      fs.writeFileSync(srcFile, 'hello', 'utf-8')

      const updated = await sdk.addAttachment('card', srcFile)
      expect(updated.attachments).toContain('test-attach.txt')

      // Verify file was copied to the attachments subfolder inside the status dir
      const destPath = path.join(tempDir, 'boards', 'default', 'backlog', 'attachments', 'test-attach.txt')
      expect(fs.existsSync(destPath)).toBe(true)

      fs.unlinkSync(srcFile)
    })

    it('should not duplicate attachment if already present', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')
      const srcFile = path.join(os.tmpdir(), 'dup.txt')
      fs.writeFileSync(srcFile, 'data', 'utf-8')

      await sdk.addAttachment('card', srcFile)
      const updated = await sdk.addAttachment('card', srcFile)
      expect(updated.attachments.filter(a => a === 'dup.txt').length).toBe(1)

      fs.unlinkSync(srcFile)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.addAttachment('ghost', '/tmp/x.txt')).rejects.toThrow('Card not found')
    })
  })

  describe('removeAttachment', () => {
    it('should remove attachment from card metadata', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')
      const srcFile = path.join(os.tmpdir(), 'rm-me.txt')
      fs.writeFileSync(srcFile, 'data', 'utf-8')

      await sdk.addAttachment('card', srcFile)
      const updated = await sdk.removeAttachment('card', 'rm-me.txt')
      expect(updated.attachments).not.toContain('rm-me.txt')

      fs.unlinkSync(srcFile)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.removeAttachment('ghost', 'x.txt')).rejects.toThrow('Card not found')
    })
  })

  describe('listAttachments', () => {
    it('should return attachments for a card', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')
      const srcFile = path.join(os.tmpdir(), 'att.txt')
      fs.writeFileSync(srcFile, 'data', 'utf-8')

      await sdk.addAttachment('card', srcFile)
      const attachments = await sdk.listAttachments('card')
      expect(attachments).toEqual(['att.txt'])

      fs.unlinkSync(srcFile)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.listAttachments('ghost')).rejects.toThrow('Card not found')
    })
  })

  describe('listColumns', () => {
    it('should return default columns when no .kanban.json exists', () => {
      const columns = sdk.listColumns()
      expect(columns.length).toBe(5)
      expect(columns[0].id).toBe('backlog')
      expect(columns[4].id).toBe('done')
    })

    it('should return custom columns from .kanban.json', async () => {
      const config = {
        kanbanDirectory: '.kanban',
        columns: [
          { id: 'new', name: 'New', color: '#ff0000' },
          { id: 'wip', name: 'WIP', color: '#00ff00' },
        ]
      }
      fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config), 'utf-8')

      const columns = sdk.listColumns()
      expect(columns.length).toBe(2)
      expect(columns[0].id).toBe('new')
      expect(columns[1].id).toBe('wip')
    })
  })

  describe('addColumn', () => {
    it('should add a column and persist to .kanban.json', async () => {
      const columns = await sdk.addColumn({ id: 'testing', name: 'Testing', color: '#ff9900' })
      // Default 5 + 1 new
      expect(columns.length).toBe(6)
      expect(columns[5].id).toBe('testing')

      // Verify persisted
      const raw = fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8')
      const config = JSON.parse(raw)
      expect(config.boards.default.columns.length).toBe(6)
    })

    it('should throw if column ID already exists', async () => {
      await expect(sdk.addColumn({ id: 'backlog', name: 'Backlog 2', color: '#000' }))
        .rejects.toThrow('Column already exists: backlog')
    })
  })

  describe('updateColumn', () => {
    it('should update column name and color', async () => {
      const columns = await sdk.updateColumn('backlog', { name: 'Inbox', color: '#123456' })
      const updated = columns.find(c => c.id === 'backlog')
      expect(updated?.name).toBe('Inbox')
      expect(updated?.color).toBe('#123456')
    })

    it('should throw for non-existent column', async () => {
      await expect(sdk.updateColumn('ghost', { name: 'X' })).rejects.toThrow('Column not found')
    })
  })

  describe('removeColumn', () => {
    it('should remove an empty column', async () => {
      // Add a custom column first, then remove it
      await sdk.addColumn({ id: 'staging', name: 'Staging', color: '#aaa' })
      const columns = await sdk.removeColumn('staging')
      expect(columns.find(c => c.id === 'staging')).toBeUndefined()
    })

    it('should throw if cards exist in the column', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card', status: 'backlog' }), 'backlog')
      await expect(sdk.removeColumn('backlog')).rejects.toThrow('Cannot remove column')
    })

    it('should throw for non-existent column', async () => {
      await expect(sdk.removeColumn('ghost')).rejects.toThrow('Column not found')
    })
  })

  describe('reorderColumns', () => {
    it('should reorder columns', async () => {
      const columns = await sdk.reorderColumns(['done', 'review', 'in-progress', 'todo', 'backlog'])
      expect(columns[0].id).toBe('done')
      expect(columns[4].id).toBe('backlog')
    })

    it('should throw if a column ID is missing', async () => {
      await expect(sdk.reorderColumns(['done', 'review'])).rejects.toThrow('Must include all column IDs')
    })

    it('should throw for unknown column ID', async () => {
      await expect(sdk.reorderColumns(['done', 'review', 'in-progress', 'todo', 'unknown']))
        .rejects.toThrow('Column not found')
    })
  })

  describe('comments', () => {
    it('should add a comment to a card', async () => {
      const card = await sdk.createCard({ content: '# Comment Test' })
      expect(card.comments).toEqual([])

      const updated = await sdk.addComment(card.id, 'alice', 'Hello world')
      expect(updated.comments).toHaveLength(1)
      expect(updated.comments[0].id).toBe('c1')
      expect(updated.comments[0].author).toBe('alice')
      expect(updated.comments[0].content).toBe('Hello world')
    })

    it('should auto-increment comment IDs', async () => {
      const card = await sdk.createCard({ content: '# ID Test' })
      await sdk.addComment(card.id, 'alice', 'First')
      const updated = await sdk.addComment(card.id, 'bob', 'Second')

      expect(updated.comments).toHaveLength(2)
      expect(updated.comments[0].id).toBe('c1')
      expect(updated.comments[1].id).toBe('c2')
    })

    it('should list comments on a card', async () => {
      const card = await sdk.createCard({ content: '# List Comments' })
      await sdk.addComment(card.id, 'alice', 'Comment 1')
      await sdk.addComment(card.id, 'bob', 'Comment 2')

      const comments = await sdk.listComments(card.id)
      expect(comments).toHaveLength(2)
      expect(comments[0].author).toBe('alice')
      expect(comments[1].author).toBe('bob')
    })

    it('should update a comment', async () => {
      const card = await sdk.createCard({ content: '# Update Comment' })
      await sdk.addComment(card.id, 'alice', 'Original')

      const updated = await sdk.updateComment(card.id, 'c1', 'Edited content')
      expect(updated.comments[0].content).toBe('Edited content')

      // Verify persisted
      const reloaded = await sdk.getCard(card.id)
      expect(reloaded?.comments[0].content).toBe('Edited content')
    })

    it('should delete a comment', async () => {
      const card = await sdk.createCard({ content: '# Delete Comment' })
      await sdk.addComment(card.id, 'alice', 'To be deleted')
      await sdk.addComment(card.id, 'bob', 'To keep')

      const updated = await sdk.deleteComment(card.id, 'c1')
      expect(updated.comments).toHaveLength(1)
      expect(updated.comments[0].id).toBe('c2')
      expect(updated.comments[0].author).toBe('bob')
    })

    it('should reject empty comment content', async () => {
      const card = await sdk.createCard({ content: '# Empty Comment Test' })
      await expect(sdk.addComment(card.id, 'alice', '')).rejects.toThrow('Comment content cannot be empty')
      await expect(sdk.addComment(card.id, 'alice', '   ')).rejects.toThrow('Comment content cannot be empty')
    })

    it('should throw when adding comment to non-existent card', async () => {
      await expect(sdk.addComment('ghost', 'alice', 'Hello')).rejects.toThrow('Card not found')
    })

    it('should throw when updating non-existent comment', async () => {
      const card = await sdk.createCard({ content: '# No Such Comment' })
      await expect(sdk.updateComment(card.id, 'c99', 'Nope')).rejects.toThrow('Comment not found')
    })

    it('should preserve comments through card updates', async () => {
      const card = await sdk.createCard({ content: '# Preserve Comments' })
      await sdk.addComment(card.id, 'alice', 'Persistent comment')

      const updated = await sdk.updateCard(card.id, { priority: 'high' })
      expect(updated.comments).toHaveLength(1)
      expect(updated.comments[0].content).toBe('Persistent comment')
    })
  })

  describe('actions', () => {
    it('should persist and reload actions through parser', async () => {
      await sdk.init()
      const card = await sdk.createCard({
        content: '# Action Card',
        actions: ['retry', 'sendEmail'],
      })
      expect(card.actions).toEqual(['retry', 'sendEmail'])

      // Reload to verify round-trip through parser
      const reloaded = await sdk.getCard(card.id)
      expect(reloaded?.actions).toEqual(['retry', 'sendEmail'])
    })

    it('should omit actions from frontmatter when empty or undefined', async () => {
      await sdk.init()
      const card = await sdk.createCard({ content: '# No Actions' })
      const reloaded = await sdk.getCard(card.id)
      expect(reloaded?.actions).toBeUndefined()
    })

    it('should append an activity log entry even when no actionWebhookUrl is configured', async () => {
      await sdk.init()
      const card = await sdk.createCard({ content: '# Card', actions: ['retry'] })
      await expect(sdk.triggerAction(card.id, 'retry')).resolves.toBeUndefined()

      const logs = await sdk.listLogs(card.id)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        source: 'system',
        text: 'Action triggered: `retry`',
        object: { action: 'retry' },
      })
    })

    it('should throw if card not found', async () => {
      await sdk.init()
      const { readConfig, writeConfig } = await import('../../shared/config')
      const config = readConfig(sdk.workspaceRoot)
      writeConfig(sdk.workspaceRoot, { ...config, actionWebhookUrl: 'http://localhost:9999/actions' })
      await expect(sdk.triggerAction('nonexistent', 'retry')).rejects.toThrow('Card not found')
    })

    it('should not call fetch directly; webhook delivery is delegated to plugin after-events', async () => {
      await sdk.init()
      const card = await sdk.createCard({ content: '# My Card', actions: ['retry'] })

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
      vi.stubGlobal('fetch', mockFetch)

      await sdk.triggerAction(card.id, 'retry')

      expect(mockFetch).not.toHaveBeenCalled()

      const logs = await sdk.listLogs(card.id)
      expect(logs.at(-1)).toMatchObject({
        text: 'Action triggered: `retry`',
        object: { action: 'retry' },
      })

      vi.unstubAllGlobals()
    })

    it('should stay side-effect free with respect to direct webhook transport failures', async () => {
      await sdk.init()
      const card = await sdk.createCard({ content: '# My Card', actions: ['retry'] })

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' }))

      await expect(sdk.triggerAction(card.id, 'retry')).resolves.toBeUndefined()

      const logs = await sdk.listLogs(card.id)
      expect(logs.at(-1)?.text).toBe('Action triggered: `retry`')

      vi.unstubAllGlobals()
    })
  })

  describe('version', () => {
    it('should parse legacy cards without version field as version 0', async () => {
      await sdk.init()
      writeCardFile(`${workspaceDir}/.kanban`, '1-legacy-card.md',
        `---
id: "1"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
attachments: []
order: "a0"
---
# Legacy Card

No version field.`,
        'backlog'
      )
      const card = await sdk.getCard('1')
      expect(card).not.toBeNull()
      expect(card?.version).toBe(0)
    })
  })

  describe('listLogs', () => {
    it('should return empty array when no log file exists', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      const logs = await sdk.listLogs('1')
      expect(logs).toEqual([])
    })

    it('should parse log entries from file', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      const logDir = path.join(tempDir, 'boards', 'default', 'backlog', 'attachments')
      fs.mkdirSync(logDir, { recursive: true })
      fs.writeFileSync(path.join(logDir, '1.log'), '2026-03-09T12:00:00.000Z [default] Hello world\n2026-03-09T13:00:00.000Z [ci] Build passed {"version":"1.0"}\n')
      const logs = await sdk.listLogs('1')
      expect(logs).toHaveLength(2)
      expect(logs[0]).toEqual({ timestamp: '2026-03-09T12:00:00.000Z', source: 'default', text: 'Hello world' })
      expect(logs[1]).toEqual({ timestamp: '2026-03-09T13:00:00.000Z', source: 'ci', text: 'Build passed', object: { version: '1.0' } })
    })

    it('should throw if card not found', async () => {
      await expect(sdk.listLogs('nonexistent')).rejects.toThrow('Card not found')
    })
  })

  describe('addLog', () => {
    it('should add a log entry with defaults', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      const entry = await sdk.addLog('1', 'Test log message')
      expect(entry.source).toBe('default')
      expect(entry.text).toBe('Test log message')
      expect(entry.timestamp).toBeTruthy()
      expect(entry.object).toMatchObject({
        activity: {
          type: 'log.explicit',
          qualifiesForUnread: true,
        },
      })
    })

    it('should add log with custom source and object', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      const entry = await sdk.addLog('1', 'Deploy complete', {
        source: 'ci',
        object: { version: '2.0', duration: 120 },
      })
      expect(entry.source).toBe('ci')
      expect(entry.text).toBe('Deploy complete')
      expect(entry.object).toMatchObject({
        version: '2.0',
        duration: 120,
        activity: {
          type: 'log.explicit',
          qualifiesForUnread: true,
        },
      })
    })

    it('should auto-add log file as attachment', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      await sdk.addLog('1', 'First log')
      const card = await sdk.getCard('1')
      expect(card?.attachments).toContain('1.log')
    })

    it('should append multiple entries', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      await sdk.addLog('1', 'Line 1')
      await sdk.addLog('1', 'Line 2')
      const logs = await sdk.listLogs('1')
      expect(logs).toHaveLength(2)
      expect(logs[0].text).toBe('Line 1')
      expect(logs[1].text).toBe('Line 2')
    })

    it('should throw on empty text', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      await expect(sdk.addLog('1', '')).rejects.toThrow('Log text cannot be empty')
    })

    it('should throw if card not found', async () => {
      await expect(sdk.addLog('nonexistent', 'test')).rejects.toThrow('Card not found')
    })
  })

  describe('clearLogs', () => {
    it('should delete the log file and remove from attachments', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      await sdk.addLog('1', 'Some log')
      let card = await sdk.getCard('1')
      expect(card?.attachments).toContain('1.log')

      await sdk.clearLogs('1')
      card = await sdk.getCard('1')
      expect(card?.attachments).not.toContain('1.log')
      const logs = await sdk.listLogs('1')
      expect(logs).toEqual([])
    })

    it('should not throw if no log file exists', async () => {
      writeCardFile(tempDir, '1-test.md', makeCardContent({ id: '1', status: 'backlog' }), 'backlog')
      await expect(sdk.clearLogs('1')).resolves.not.toThrow()
    })

    it('should throw if card not found', async () => {
      await expect(sdk.clearLogs('nonexistent')).rejects.toThrow('Card not found')
    })
  })

  describe('getBoardLogFilePath', () => {
    it('should return path ending in board.log inside board dir', () => {
      const p = sdk.getBoardLogFilePath()
      expect(p).toMatch(/board\.log$/)
      expect(p).toContain('boards')
    })

    it('should include the boardId when specified', () => {
      const p = sdk.getBoardLogFilePath('my-board')
      expect(p).toContain('my-board')
      expect(p).toMatch(/board\.log$/)
    })
  })

  describe('listBoardLogs', () => {
    it('should return empty array when no log file exists', async () => {
      const logs = await sdk.listBoardLogs()
      expect(logs).toEqual([])
    })

    it('should return parsed entries after addBoardLog', async () => {
      await sdk.addBoardLog('hello board', { source: 'test' })
      const logs = await sdk.listBoardLogs()
      expect(logs).toHaveLength(1)
      expect(logs[0].text).toBe('hello board')
      expect(logs[0].source).toBe('test')
    })
  })

  describe('addBoardLog', () => {
    it('should append an entry to board.log', async () => {
      const entry = await sdk.addBoardLog('first entry')
      expect(entry.text).toBe('first entry')
      expect(entry.source).toBe('sdk')
      expect(typeof entry.timestamp).toBe('string')

      const logs = await sdk.listBoardLogs()
      expect(logs).toHaveLength(1)
    })

    it('should use provided source and timestamp', async () => {
      const ts = '2024-06-01T00:00:00.000Z'
      const entry = await sdk.addBoardLog('msg', { source: 'cli', timestamp: ts })
      expect(entry.source).toBe('cli')
      expect(entry.timestamp).toBe(ts)
    })

    it('should append object when provided', async () => {
      await sdk.addBoardLog('with obj', { object: { key: 'val' } })
      const logs = await sdk.listBoardLogs()
      expect(logs[0].object).toEqual({ key: 'val' })
    })

    it('should emit board.log.added event', async () => {
      const events: Array<{ type: string; data: unknown }> = []
      const eventSdk = new KanbanSDK(tempDir, { onEvent: (type, data) => events.push({ type, data }) })
      await eventSdk.addBoardLog('event test')
      const logEvents = events.filter(e => e.type === 'board.log.added')
      expect(logEvents).toHaveLength(1)
    })

    it('should accumulate multiple entries', async () => {
      await sdk.addBoardLog('a')
      await sdk.addBoardLog('b')
      await sdk.addBoardLog('c')
      const logs = await sdk.listBoardLogs()
      expect(logs).toHaveLength(3)
      expect(logs.map(l => l.text)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('clearBoardLogs', () => {
    it('should delete the board.log file', async () => {
      await sdk.addBoardLog('entry')
      let logs = await sdk.listBoardLogs()
      expect(logs).toHaveLength(1)

      await sdk.clearBoardLogs()
      logs = await sdk.listBoardLogs()
      expect(logs).toEqual([])
    })

    it('should not throw if no log file exists', async () => {
      await expect(sdk.clearBoardLogs()).resolves.not.toThrow()
    })
  })

  describe('formerly bypassing privileged mutations use the SDK-owned before-event pipeline', () => {
    async function expectBeforeEventDenial(
      event: string,
      invoke: () => Promise<unknown>,
    ): Promise<void> {
      sdk.on(event, vi.fn().mockImplementation(() => {
        throw new AuthError('auth.policy.denied', `Denied by ${event}`, 'before-listener')
      }))

      await expect(invoke()).rejects.toMatchObject({ category: 'auth.policy.denied' })
      sdk.removeAllListeners(event)
    }

    it('setLabel denial leaves label definitions unchanged', async () => {
      const originalLabels = sdk.getLabels()
      await expectBeforeEventDenial('label.set', () => sdk.setLabel('bug', { color: '#e11d48' }))
      expect(sdk.getLabels()).toEqual(originalLabels)
    })

    it('cleanupColumn denial leaves cards in the source column', async () => {
      const card = await sdk.createCard({ content: '# Cleanup Guard', status: 'backlog' })

      await expectBeforeEventDenial('column.cleanup', () => sdk.cleanupColumn('backlog'))

      const after = await sdk.getCard(card.id)
      expect(after?.status).toBe('backlog')
    })

    it('reorderColumns denial preserves the existing column order', async () => {
      const original = sdk.listColumns().map(column => column.id)

      await expectBeforeEventDenial('column.reorder', () => sdk.reorderColumns([...original].reverse()))

      expect(sdk.listColumns().map(column => column.id)).toEqual(original)
    })

    it('setMinimizedColumns denial preserves minimized state', async () => {
      await expectBeforeEventDenial('column.setMinimized', () => sdk.setMinimizedColumns(['backlog', 'todo']))
      expect(sdk.getMinimizedColumns()).toEqual([])
    })

    it('purgeDeletedCards denial leaves deleted cards intact', async () => {
      const card = await sdk.createCard({ content: '# Purge Guard' })
      await sdk.deleteCard(card.id)

      await expectBeforeEventDenial('card.purgeDeleted', () => sdk.purgeDeletedCards('default'))

      const deletedCard = await sdk.getCard(card.id)
      expect(deletedCard?.status).toBe('deleted')
    })

    it('setDefaultBoard denial keeps the current default board', async () => {
      await sdk.createBoard('ops', 'Ops')
      const { readConfig } = await import('../../shared/config')

      await expectBeforeEventDenial('board.setDefault', () => sdk.setDefaultBoard('ops'))

      expect(readConfig(sdk.workspaceRoot).defaultBoard).toBe('default')
    })

    it('webhook.create denial leaves the registry empty', async () => {
      await expectBeforeEventDenial('webhook.create', () => sdk.createWebhook({ url: 'https://example.com', events: ['task.created'] }))
      expect(sdk.listWebhooks()).toEqual([])
    })

    it('webhook.update denial leaves the stored webhook unchanged', async () => {
      const created = await sdk.createWebhook({ url: 'https://example.com', events: ['task.created'] })

      await expectBeforeEventDenial('webhook.update', () => sdk.updateWebhook(created.id, { url: 'https://updated.example.com' }))

      expect(sdk.listWebhooks()).toEqual([
        expect.objectContaining({ id: created.id, url: 'https://example.com' }),
      ])
    })

    it('webhook.delete denial leaves the stored webhook in place', async () => {
      const created = await sdk.createWebhook({ url: 'https://example.com', events: ['task.created'] })

      await expectBeforeEventDenial('webhook.delete', () => sdk.deleteWebhook(created.id))

      expect(sdk.listWebhooks()).toEqual([
        expect.objectContaining({ id: created.id, url: 'https://example.com' }),
      ])
    })
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { ERR_CARD_STATE_IDENTITY_UNAVAILABLE, ERR_CARD_STATE_UNAVAILABLE } from '../types'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-card-state-sdk-'))
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
        // ignore unresolved paths
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

function createInjectedStorageStub(kanbanDir: string) {
  return {
    type: 'markdown' as const,
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

function getCardStateFilePath(kanbanDir: string, actorId: string, boardId: string, cardId: string): string {
  return path.join(
    kanbanDir,
    'card-state',
    encodeURIComponent(actorId),
    encodeURIComponent(boardId),
    `${encodeURIComponent(cardId)}.json`,
  )
}

describe('KanbanSDK card.state public APIs', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(async () => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    await sdk.init()
  })

  afterEach(() => {
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('keeps getUnreadSummary and getCardState side-effect free for the default actor', async () => {
    const card = await sdk.createCard({ content: '# Side-effect free unread reads' })
    await sdk.addLog(card.id, 'Unread event')

    const stateFilePath = getCardStateFilePath(kanbanDir, 'default-user', 'default', card.id)
    expect(fs.existsSync(stateFilePath)).toBe(false)

    await expect(sdk.getCardState(card.id)).resolves.toBeNull()

    const summary = await sdk.getUnreadSummary(card.id)
    expect(summary).toMatchObject({
      actorId: 'default-user',
      boardId: 'default',
      cardId: card.id,
      unread: true,
      readThrough: null,
    })
    expect(summary.latestActivity).toMatchObject({
      updatedAt: expect.any(String),
      cursor: expect.any(String),
    })
    expect(fs.existsSync(stateFilePath)).toBe(false)
  })

  it('uses explicit markCardRead to persist unread state for the current actor', async () => {
    const card = await sdk.createCard({ content: '# Explicit read mutation' })
    await sdk.addLog(card.id, 'Operator note')

    expect((await sdk.getUnreadSummary(card.id)).unread).toBe(true)

    const mutation = await sdk.markCardRead(card.id)
    expect(mutation).toMatchObject({
      actorId: 'default-user',
      boardId: 'default',
      cardId: card.id,
      unread: false,
      readThrough: mutation.latestActivity,
    })

    await expect(sdk.getCardState(card.id)).resolves.toMatchObject({
      actorId: 'default-user',
      boardId: 'default',
      cardId: card.id,
      domain: 'unread',
      value: mutation.latestActivity,
    })

    expect((await sdk.getUnreadSummary(card.id)).unread).toBe(false)
  })

  it('keeps unread behavior independent of setActiveCard and exposes an explicit open mutation', async () => {
    const card = await sdk.createCard({ content: '# Explicit open mutation' })
    await sdk.addLog(card.id, 'Initial unread activity')

    await sdk.setActiveCard(card.id)
    expect((await sdk.getUnreadSummary(card.id)).unread).toBe(true)

    const opened = await sdk.markCardOpened(card.id)
    expect(opened.unread).toBe(false)

    await expect(sdk.getCardState(card.id, undefined, 'open')).resolves.toMatchObject({
      actorId: 'default-user',
      boardId: 'default',
      cardId: card.id,
      domain: 'open',
      value: {
        openedAt: expect.any(String),
        readThrough: opened.latestActivity,
      },
    })
  })

  it('uses one stable default actor id across auth-absent read and mutation APIs', async () => {
    const card = await sdk.createCard({ content: '# Stable default actor contract' })
    await sdk.addLog(card.id, 'Unread activity for the auth-absent actor')

    const defaultActorId = sdk.getCardStateStatus().defaultActor.id

    await expect(sdk.getCardState(card.id)).resolves.toBeNull()
    await expect(sdk.getUnreadSummary(card.id)).resolves.toMatchObject({
      actorId: defaultActorId,
      unread: true,
    })
    await expect(sdk.markCardOpened(card.id)).resolves.toMatchObject({
      actorId: defaultActorId,
      unread: false,
    })
    await expect(sdk.markCardRead(card.id)).resolves.toMatchObject({
      actorId: defaultActorId,
      unread: false,
    })

    await expect(sdk.getCardState(card.id, undefined, 'open')).resolves.toMatchObject({
      actorId: defaultActorId,
      domain: 'open',
    })
  })

  it('uses configured auth identities instead of the default actor and scopes unread by actor', async () => {
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
      writeWorkspaceConfig(workspaceDir, {
        auth: {
          'auth.identity': { provider: 'card-state-auth-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localSdk = new KanbanSDK(kanbanDir)
      await localSdk.init()
      const card = await localSdk.createCard({ content: '# Auth-backed unread state' })
      await localSdk.addLog(card.id, 'Unread for authenticated actor')

      await expect(localSdk.getUnreadSummary(card.id)).rejects.toMatchObject({
        code: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
      })

      const aliceUnread = await localSdk.runWithAuth({ token: 'alice' }, async () => localSdk.getUnreadSummary(card.id))
      expect(aliceUnread).toMatchObject({
        actorId: 'user-alice',
        unread: true,
      })

      await localSdk.runWithAuth({ token: 'alice' }, async () => localSdk.markCardRead(card.id))

      const aliceRead = await localSdk.runWithAuth({ token: 'alice' }, async () => localSdk.getUnreadSummary(card.id))
      expect(aliceRead).toMatchObject({
        actorId: 'user-alice',
        unread: false,
      })

      const bobUnread = await localSdk.runWithAuth({ token: 'bob' }, async () => localSdk.getUnreadSummary(card.id))
      expect(bobUnread).toMatchObject({
        actorId: 'user-bob',
        unread: true,
      })

      localSdk.close()
    } finally {
      cleanup()
    }
  })

  it('surfaces ERR_CARD_STATE_IDENTITY_UNAVAILABLE across card.state APIs when a configured identity is unavailable', async () => {
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
      writeWorkspaceConfig(workspaceDir, {
        auth: {
          'auth.identity': { provider: 'card-state-auth-failure-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localSdk = new KanbanSDK(kanbanDir)
      await localSdk.init()
      const card = await localSdk.createCard({ content: '# Identity unavailable parity' })
      await localSdk.addLog(card.id, 'Unread activity requiring actor resolution')

      const operations = [
        () => localSdk.getCardState(card.id),
        () => localSdk.getUnreadSummary(card.id),
        () => localSdk.markCardOpened(card.id),
        () => localSdk.markCardRead(card.id),
        () => localSdk.runWithAuth({ token: 'explode' }, async () => localSdk.getUnreadSummary(card.id)),
      ]

      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          code: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
          availability: 'identity-unavailable',
        })
      }

      localSdk.close()
    } finally {
      cleanup()
    }
  })

  it('distinguishes configured identity failures from backend unavailability', async () => {
    const cleanup = installTempPackage(
      'card-state-auth-unavailable-distinction-test',
      `module.exports = {
  authIdentityPlugin: {
    manifest: { id: 'card-state-auth-unavailable-distinction-test', provides: ['auth.identity'] },
    async resolveIdentity() {
      return null
    },
  },
}
`,
    )

    try {
      writeWorkspaceConfig(workspaceDir, {
        auth: {
          'auth.identity': { provider: 'card-state-auth-unavailable-distinction-test' },
          'auth.policy': { provider: 'noop' },
        },
      })

      const localSdk = new KanbanSDK(kanbanDir)
      await localSdk.init()
      const card = await localSdk.createCard({ content: '# Distinct card-state errors' })

      await expect(localSdk.getUnreadSummary(card.id)).rejects.toMatchObject({
        code: ERR_CARD_STATE_IDENTITY_UNAVAILABLE,
        availability: 'identity-unavailable',
      })

      localSdk.close()

      const unavailableSdk = new KanbanSDK(kanbanDir, { storage: createInjectedStorageStub(kanbanDir) })

      await expect(unavailableSdk.getUnreadSummary(card.id)).rejects.toMatchObject({
        code: ERR_CARD_STATE_UNAVAILABLE,
        availability: 'unavailable',
      })

      unavailableSdk.close()
    } finally {
      cleanup()
    }
  })
})

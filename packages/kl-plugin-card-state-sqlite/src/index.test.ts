import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import cardStateProviderFactory, {
  DEFAULT_SQLITE_CARD_STATE_PATH,
  SQLITE_CARD_STATE_PROVIDER_ID,
  createCardStateProvider,
} from './index'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-plugin-card-state-sqlite-test-'))
}

describe('kl-plugin-card-state-sqlite', () => {
  let workspaceRoot: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceRoot = createTempDir()
    kanbanDir = path.join(workspaceRoot, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('exports a sqlite card.state provider factory', () => {
    const provider = createCardStateProvider({
      workspaceRoot,
      kanbanDir,
      provider: SQLITE_CARD_STATE_PROVIDER_ID,
      backend: 'external',
    })

    expect(provider.manifest).toEqual({
      id: SQLITE_CARD_STATE_PROVIDER_ID,
      provides: ['card.state'],
    })
  })

  it('uses the same factory as the default export', () => {
    expect(cardStateProviderFactory).toBe(createCardStateProvider)
  })

  it('persists domain state and unread cursors in SQLite across provider instances', async () => {
    const sqlitePath = 'state/card-state.sqlite'
    const provider = createCardStateProvider({
      workspaceRoot,
      kanbanDir,
      provider: SQLITE_CARD_STATE_PROVIDER_ID,
      backend: 'external',
      options: { sqlitePath },
    })

    await expect(provider.getCardState({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
    })).resolves.toBeNull()

    await expect(provider.setCardState({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { openedAt: '2026-03-24T10:00:00.000Z' },
      updatedAt: '2026-03-24T10:00:00.000Z',
    })).resolves.toEqual({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { openedAt: '2026-03-24T10:00:00.000Z' },
      updatedAt: '2026-03-24T10:00:00.000Z',
    })

    await expect(provider.markUnreadReadThrough({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      cursor: { cursor: 'activity:2', updatedAt: '2026-03-24T10:01:00.000Z' },
    })).resolves.toEqual({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'unread',
      value: { cursor: 'activity:2', updatedAt: '2026-03-24T10:01:00.000Z' },
      updatedAt: '2026-03-24T10:01:00.000Z',
    })

    const reopenedProvider = createCardStateProvider({
      workspaceRoot,
      kanbanDir,
      provider: SQLITE_CARD_STATE_PROVIDER_ID,
      backend: 'external',
      options: { sqlitePath },
    })

    await expect(reopenedProvider.getCardState({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
    })).resolves.toEqual({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      domain: 'open',
      value: { openedAt: '2026-03-24T10:00:00.000Z' },
      updatedAt: '2026-03-24T10:00:00.000Z',
    })

    await expect(reopenedProvider.getUnreadCursor({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
    })).resolves.toEqual({
      cursor: 'activity:2',
      updatedAt: '2026-03-24T10:01:00.000Z',
    })

    const resolvedDbPath = path.join(workspaceRoot, sqlitePath)
    expect(fs.existsSync(resolvedDbPath)).toBe(true)

    const db = new Database(resolvedDbPath, { readonly: true })
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    const storedRows = db.prepare('SELECT actor_id, board_id, card_id, domain FROM card_state ORDER BY domain').all() as Array<Record<string, string>>
    db.close()

    expect(tables).toEqual(expect.arrayContaining(['schema_version', 'card_state']))
    expect(storedRows).toEqual([
      { actor_id: 'alice', board_id: 'default', card_id: 'card-1', domain: 'open' },
      { actor_id: 'alice', board_id: 'default', card_id: 'card-1', domain: 'unread' },
    ])
  })

  it('uses the default sqlite path and keeps actor scopes isolated', async () => {
    const provider = createCardStateProvider({
      workspaceRoot,
      kanbanDir,
      provider: SQLITE_CARD_STATE_PROVIDER_ID,
      backend: 'external',
    })

    await provider.markUnreadReadThrough({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
      cursor: { cursor: 'activity:alice' },
    })
    await provider.markUnreadReadThrough({
      actorId: 'bob',
      boardId: 'default',
      cardId: 'card-1',
      cursor: { cursor: 'activity:bob' },
    })

    await expect(provider.getUnreadCursor({
      actorId: 'alice',
      boardId: 'default',
      cardId: 'card-1',
    })).resolves.toMatchObject({ cursor: 'activity:alice' })

    await expect(provider.getUnreadCursor({
      actorId: 'bob',
      boardId: 'default',
      cardId: 'card-1',
    })).resolves.toMatchObject({ cursor: 'activity:bob' })

    expect(fs.existsSync(path.join(workspaceRoot, DEFAULT_SQLITE_CARD_STATE_PATH))).toBe(true)
  })
})

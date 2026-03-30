import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'

/** Shared plugin manifest shape for `card.state` capability providers. */
export interface CardStateProviderManifest {
  readonly id: string
  readonly provides: readonly ['card.state']
}

/** Opaque JSON-like payload stored for a card-state domain. */
export type CardStateValue = Record<string, unknown>

/** Stable actor/card/domain lookup key used by card-state providers. */
export interface CardStateKey {
  actorId: string
  boardId: string
  cardId: string
  domain: string
}

/** Stored card-state record returned by provider operations. */
export interface CardStateRecord<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt: string
}

/** Write input for card-state domain mutations. */
export interface CardStateWriteInput<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt?: string
}

/** Unread cursor payload persisted by card-state providers. */
export interface CardStateCursor extends Record<string, unknown> {
  cursor: string
  updatedAt?: string
}

/** Lookup key for unread cursor state. */
export interface CardStateUnreadKey {
  actorId: string
  boardId: string
  cardId: string
}

/** Mutation input for marking unread state through a cursor. */
export interface CardStateReadThroughInput extends CardStateUnreadKey {
  cursor: CardStateCursor
}

/** Shared runtime context passed to and exposed for `card.state` providers. */
export interface CardStateModuleContext {
  workspaceRoot: string
  kanbanDir: string
  provider: string
  backend: 'builtin' | 'external'
  options?: Record<string, unknown>
}

/** Contract for first-class `card.state` capability providers. */
export interface CardStateProvider {
  readonly manifest: CardStateProviderManifest
  getCardState(input: CardStateKey): Promise<CardStateRecord | null>
  setCardState(input: CardStateWriteInput): Promise<CardStateRecord>
  getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null>
  markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>>
}

export const SQLITE_CARD_STATE_PROVIDER_ID = 'sqlite'
export const DEFAULT_SQLITE_CARD_STATE_PATH = '.kanban/card-state.db'

const SQLITE_CARD_STATE_MANIFEST = Object.freeze({
  id: SQLITE_CARD_STATE_PROVIDER_ID,
  provides: ['card.state'] as const,
})

const SQLITE_SCHEMA_VERSION = 1

const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_state (
  actor_id   TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  card_id    TEXT NOT NULL,
  domain     TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, board_id, card_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_card_state_lookup
  ON card_state (actor_id, board_id, card_id, domain);
`

interface CardStateRow {
  actor_id: string
  board_id: string
  card_id: string
  domain: string
  value_json: string
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCardStateCursor(value: unknown): value is CardStateCursor {
  return isRecord(value)
    && typeof value.cursor === 'string'
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
}

function resolveSqlitePath(context: CardStateModuleContext): string {
  const rawPath = typeof context.options?.['sqlitePath'] === 'string' && context.options['sqlitePath'].trim().length > 0
    ? context.options['sqlitePath'].trim()
    : DEFAULT_SQLITE_CARD_STATE_PATH
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.join(context.workspaceRoot, rawPath)
}

function createDatabase(sqlitePath: string): Database.Database {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath)
  db.exec(CREATE_SCHEMA_SQL)

  const versionRow = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined
  if (!versionRow) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SQLITE_SCHEMA_VERSION)
  } else if (versionRow.version !== SQLITE_SCHEMA_VERSION) {
    db.prepare('UPDATE schema_version SET version = ?').run(SQLITE_SCHEMA_VERSION)
  }

  return db
}

function getUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

function parseValue(valueJson: string): CardStateValue | null {
  try {
    const parsed = JSON.parse(valueJson) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toCardStateRecord<TValue = CardStateValue>(
  input: CardStateKey,
  row: Pick<CardStateRow, 'updated_at'>,
  value: TValue,
): CardStateRecord<TValue> {
  return {
    actorId: input.actorId,
    boardId: input.boardId,
    cardId: input.cardId,
    domain: input.domain,
    value,
    updatedAt: row.updated_at,
  }
}

/**
 * Creates the SQLite-backed `card.state` provider.
 *
 * Data is stored in a dedicated SQLite database so actor-scoped unread and
 * explicit-open state can be shared across SDK instances without writing any
 * per-user state into markdown cards or active-card UI storage.
 */
export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  const sqlitePath = resolveSqlitePath(context)
  const db = createDatabase(sqlitePath)
  const selectState = db.prepare(`
    SELECT actor_id, board_id, card_id, domain, value_json, updated_at
    FROM card_state
    WHERE actor_id = ? AND board_id = ? AND card_id = ? AND domain = ?
  `)
  const upsertState = db.prepare(`
    INSERT INTO card_state (actor_id, board_id, card_id, domain, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_id, board_id, card_id, domain)
    DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `)

  return {
    manifest: SQLITE_CARD_STATE_MANIFEST,
    async getCardState(_input: CardStateKey): Promise<CardStateRecord | null> {
      const row = selectState.get(
        _input.actorId,
        _input.boardId,
        _input.cardId,
        _input.domain,
      ) as CardStateRow | undefined
      if (!row) return null

      const value = parseValue(row.value_json)
      if (!value) return null

      return toCardStateRecord(_input, row, value)
    },
    async setCardState(_input: CardStateWriteInput): Promise<CardStateRecord> {
      const updatedAt = getUpdatedAt(_input.updatedAt)
      upsertState.run(
        _input.actorId,
        _input.boardId,
        _input.cardId,
        _input.domain,
        JSON.stringify(_input.value),
        updatedAt,
      )

      return {
        actorId: _input.actorId,
        boardId: _input.boardId,
        cardId: _input.cardId,
        domain: _input.domain,
        value: _input.value,
        updatedAt,
      }
    },
    async getUnreadCursor(_input: CardStateUnreadKey): Promise<CardStateCursor | null> {
      const record = await this.getCardState({ ..._input, domain: 'unread' })
      return record && isCardStateCursor(record.value)
        ? record.value
        : null
    },
    async markUnreadReadThrough(_input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = getUpdatedAt(_input.cursor.updatedAt)
      const value: CardStateCursor = {
        cursor: _input.cursor.cursor,
        updatedAt,
      }

      upsertState.run(
        _input.actorId,
        _input.boardId,
        _input.cardId,
        'unread',
        JSON.stringify(value),
        updatedAt,
      )

      return {
        actorId: _input.actorId,
        boardId: _input.boardId,
        cardId: _input.cardId,
        domain: 'unread',
        value,
        updatedAt,
      }
    },
  }
}

export default createCardStateProvider

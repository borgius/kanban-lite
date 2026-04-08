import type {
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateWriteInput,
} from 'kanban-lite/sdk'

import { loadMysql2Driver } from './connection.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCardStateCursor(value: unknown): value is CardStateCursor {
  return isRecord(value)
    && typeof value.cursor === 'string'
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
}

function getUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

const MYSQL_CARD_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS card_state (
  actor_id   VARCHAR(255) NOT NULL,
  board_id   VARCHAR(255) NOT NULL,
  card_id    VARCHAR(255) NOT NULL,
  domain     VARCHAR(100) NOT NULL,
  value_json TEXT         NOT NULL,
  updated_at VARCHAR(50)  NOT NULL,
  PRIMARY KEY (actor_id, board_id, card_id, domain),
  INDEX idx_card_state_lookup (actor_id, board_id, card_id, domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

/**
 * Creates the MySQL-backed `card.state` provider.
 *
 * Card-state data is stored in a `card_state` table in the same MySQL
 * database as card storage.
 */
export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  const mysql2 = loadMysql2Driver()
  const pool = mysql2.createPool({
    host: (context.options?.['host'] as string | undefined) ?? 'localhost',
    port: typeof context.options?.['port'] === 'number' ? context.options['port'] : 3306,
    user: (context.options?.['user'] as string | undefined) ?? 'root',
    password: (context.options?.['password'] as string | undefined) ?? '',
    database: (context.options?.['database'] as string | undefined) ?? 'kanban_lite',
    ...(context.options?.['ssl'] !== undefined ? { ssl: context.options['ssl'] } : {}),
  })

  let initialized = false
  async function ensureSchema(): Promise<void> {
    if (initialized) return
    await pool.execute(MYSQL_CARD_STATE_SCHEMA)
    initialized = true
  }

  return {
    manifest: Object.freeze({ id: 'mysql', provides: ['card.state'] as const }),
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      await ensureSchema()
      const [rows] = await pool.execute(
        'SELECT value_json, updated_at FROM card_state WHERE actor_id = ? AND board_id = ? AND card_id = ? AND domain = ?',
        [input.actorId, input.boardId, input.cardId, input.domain],
      )
      const row = (rows as Array<{ value_json: string; updated_at: string }>)[0]
      if (!row) return null
      try {
        const value = JSON.parse(row.value_json) as unknown
        if (!isRecord(value)) return null
        return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value, updatedAt: row.updated_at }
      } catch {
        return null
      }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      await ensureSchema()
      const updatedAt = getUpdatedAt(input.updatedAt)
      await pool.execute(
        `INSERT INTO card_state (actor_id, board_id, card_id, domain, value_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
        [input.actorId, input.boardId, input.cardId, input.domain, JSON.stringify(input.value), updatedAt],
      )
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value: input.value, updatedAt }
    },
    async getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null> {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && isCardStateCursor(record.value) ? record.value : null
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = getUpdatedAt(input.cursor.updatedAt)
      const value: CardStateCursor = { cursor: input.cursor.cursor, updatedAt }
      await this.setCardState({ actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt })
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt }
    },
  }
}

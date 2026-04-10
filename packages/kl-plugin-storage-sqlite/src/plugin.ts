import * as fs from 'fs/promises'
import * as path from 'path'
import Database from 'better-sqlite3'
import type {
  AttachmentStoragePlugin,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateValue,
  CardStateWriteInput,
  CardStoragePlugin,
  PluginSettingsOptionsSchemaMetadata,
  StorageEngine,
} from 'kanban-lite/sdk'
import {
  SqliteStorageEngine,
  _registerEngine,
  _lookupEngineForCard,
} from './engine'
export type {
  AttachmentStoragePlugin,
  Card,
  CardStateCursor,
  CardStateKey,
  CardStateModuleContext,
  CardStateProvider,
  CardStateProviderManifest,
  CardStateReadThroughInput,
  CardStateRecord,
  CardStateUnreadKey,
  CardStateValue,
  CardStateWriteInput,
  CardStoragePlugin,
  Priority,
  StorageEngine,
} from 'kanban-lite/sdk'
export type Comment = Card['comments'][number]
export { SqliteStorageEngine } from './engine'

function resolveDbPath(kanbanDir: string, options?: Record<string, unknown>): string {
  const rawPath = (options?.['sqlitePath'] as string | undefined) ?? '.kanban/kanban.db'
  const workspaceRoot = path.dirname(kanbanDir)
  return path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, rawPath)
}

/**
 * `card.storage` plugin for SQLite.
 *
 * Provider id: `sqlite`
 * Install target: `kl-plugin-storage-sqlite`
 *
 * @example
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": { "provider": "sqlite" }
 *   }
 * }
 * ```
 */
export const cardStoragePlugin: CardStoragePlugin = {
  manifest: { id: 'sqlite', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): SqliteStorageEngine {
    const dbPath = resolveDbPath(kanbanDir, options)
    const engine = new SqliteStorageEngine(kanbanDir, dbPath)
    _registerEngine(kanbanDir, engine)
    return engine
  },
  nodeCapabilities: {
    isFileBacked: false,
    getLocalCardPath(_card: Card): string | null {
      return null
    },
    getWatchGlob(): string | null {
      return null
    },
  },
}

// ---------------------------------------------------------------------------
// attachmentStoragePlugin export
// ---------------------------------------------------------------------------

function normalizeAttachmentName(attachment: string): string | null {
  const normalized = attachment.replace(/\\/g, '/')
  if (!normalized || normalized.includes('/') || normalized.includes('\0')) return null
  const base = path.basename(normalized)
  if (!base || base !== normalized || base === '.' || base === '..') return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(base)) return null
  return base
}

/**
 * `attachment.storage` plugin for SQLite.
 *
 * Attachment files are stored on local disk under
 * `.kanban/boards/{boardId}/{status}/attachments/`. This plugin works
 * as a companion to `cardStoragePlugin` from the same package — `createEngine`
 * must be called first so the engine registry is populated.
 *
 * Provider id: `sqlite`
 *
 * @example
 * ```json
 * {
 *   "plugins": {
 *     "attachment.storage": { "provider": "sqlite" }
 *   }
 * }
 * ```
 */
export const attachmentStoragePlugin: AttachmentStoragePlugin = {
  manifest: { id: 'sqlite', provides: ['attachment.storage'] as const },

  getCardDir(card: Card): string | null {
    const engine = _lookupEngineForCard(card)
    return engine?.getCardDir(card) ?? null
  },

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const engine = _lookupEngineForCard(card)
    if (engine) {
      await engine.copyAttachment(sourcePath, card)
      return
    }
    // Fallback: derive path from card properties only (engine not in registry).
    // This is a best-effort path when no engine has been created in this process.
    throw new Error(
      '[kl-plugin-storage-sqlite] attachmentStoragePlugin.copyAttachment: no active SqliteStorageEngine found. ' +
      'Ensure cardStoragePlugin.createEngine() is called before using the attachment plugin.'
    )
  },

  async materializeAttachment(card: Card, attachment: string): Promise<string | null> {
    const safe = normalizeAttachmentName(attachment)
    if (!safe) return null
    if (!Array.isArray(card.attachments) || !card.attachments.includes(safe)) return null
    const engine = _lookupEngineForCard(card)
    if (!engine) return null
    const cardDir = engine.getCardDir(card)
    const attachmentPath = path.join(cardDir, safe)
    try {
      await fs.access(attachmentPath)
      return attachmentPath
    } catch {
      return null
    }
  },
}

// ---------------------------------------------------------------------------
// card.state provider (merged into storage package)
// ---------------------------------------------------------------------------

const CARD_STATE_CREATE_SQL = `
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

function _isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function _isCardStateCursor(value: unknown): value is CardStateCursor {
  return _isRecord(value)
    && typeof value.cursor === 'string'
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
}

function _getUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

function _parseStateValue(valueJson: string): CardStateValue | null {
  try {
    const parsed = JSON.parse(valueJson) as unknown
    return _isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Creates the SQLite-backed `card.state` provider.
 *
 * Card-state data is stored in the same SQLite database as card storage,
 * in a dedicated `card_state` table.  Actor-scoped unread / open state
 * is kept separate from shared card content.
 */
export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  const dbPath = resolveDbPath(context.kanbanDir, context.options)
  const db = new Database(dbPath)
  db.exec(CARD_STATE_CREATE_SQL)

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
    manifest: Object.freeze({ id: 'sqlite', provides: ['card.state'] as const }),
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      const row = selectState.get(input.actorId, input.boardId, input.cardId, input.domain) as
        { actor_id: string; board_id: string; card_id: string; domain: string; value_json: string; updated_at: string } | undefined
      if (!row) return null
      const value = _parseStateValue(row.value_json)
      if (!value) return null
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value, updatedAt: row.updated_at }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      const updatedAt = _getUpdatedAt(input.updatedAt)
      upsertState.run(input.actorId, input.boardId, input.cardId, input.domain, JSON.stringify(input.value), updatedAt)
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value: input.value, updatedAt }
    },
    async getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null> {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && _isCardStateCursor(record.value) ? record.value : null
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = _getUpdatedAt(input.cursor.updatedAt)
      const value: CardStateCursor = { cursor: input.cursor.cursor, updatedAt }
      upsertState.run(input.actorId, input.boardId, input.cardId, 'unread', JSON.stringify(value), updatedAt)
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt }
    },
  }
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-storage-sqlite',
  capabilities: {
    'card.storage': ['sqlite'] as const,
    'attachment.storage': ['sqlite'] as const,
    'card.state': ['sqlite'] as const,
  },
} as const

// ---------------------------------------------------------------------------
// Options schema — plugin-settings discovery
// ---------------------------------------------------------------------------

function createSqliteOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sqlitePath: {
          type: 'string',
          title: 'Database path',
          description: 'Path to the SQLite database file. Relative paths are resolved from the workspace root.',
          default: '.kanban/kanban.db',
        },
      },
    },
    secrets: [],
  }
}

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  sqlite: createSqliteOptionsSchema,
}

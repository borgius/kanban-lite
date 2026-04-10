import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
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
  PluginSettingsRedactionPolicy,
  Priority,
  StorageEngine,
} from 'kanban-lite/sdk'
import { MongodbStorageEngine, MongodbConnectionConfig, MongoClient, MongoCollection, loadMongoDriver } from './engine'

export function createMongodbAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin {
  if (engine.type !== 'mongodb') {
    throw new Error(
      'kl-plugin-storage-mongodb: attachment plugin requires an active mongodb card.storage engine.',
    )
  }
  const mongoEngine = engine as MongodbStorageEngine
  return {
    manifest: { id: 'mongodb', provides: ['attachment.storage'] as const },
    getCardDir(card: Card): string | null {
      return mongoEngine.getCardDir(card)
    },
    async copyAttachment(sourcePath: string, card: Card): Promise<void> {
      await mongoEngine.copyAttachment(sourcePath, card)
    },
  }
}

// ---------------------------------------------------------------------------
// Named plugin exports (required by kanban-lite plugin loader contract)
// ---------------------------------------------------------------------------

/**
 * kanban-lite `card.storage` plugin for MongoDB.
 *
 * Provider id: `mongodb`
 * Install: `npm install kl-plugin-storage-mongodb mongodb`
 *
 * @example `.kanban.json`
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "mongodb",
 *       "options": {
 *         "uri": "mongodb://localhost:27017",
 *         "database": "kanban_db"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export const cardStoragePlugin: CardStoragePlugin = {
  manifest: { id: 'mongodb', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): MongodbStorageEngine {
    const database = options?.database
    if (typeof database !== 'string' || !database) {
      throw new Error(
        'kl-plugin-storage-mongodb: MongoDB storage requires a "database" option. ' +
        'Set it in .kanban.json: { "plugins": { "card.storage": { "provider": "mongodb", ' +
        '"options": { "uri": "mongodb://localhost:27017", "database": "my_db" } } } }',
      )
    }
    const connConfig: MongodbConnectionConfig = {
      uri: (options?.uri as string | undefined) ?? 'mongodb://localhost:27017',
      database,
      collectionPrefix: (options?.collectionPrefix as string | undefined) ?? 'kanban',
    }
    return new MongodbStorageEngine(kanbanDir, connConfig)
  },
  nodeCapabilities: {
    isFileBacked: false,
    getLocalCardPath(): string | null {
      return null
    },
    getWatchGlob(): string | null {
      return null
    },
  },
}

/**
 * kanban-lite `attachment.storage` plugin for MongoDB.
 *
 * Stores attachments in the local filesystem at
 * `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * When using this plugin explicitly, the active `card.storage` must also be
 * `mongodb`; otherwise the plugin will throw at attachment-copy time.
 */
export const attachmentStoragePlugin: AttachmentStoragePlugin = {
  manifest: { id: 'mongodb', provides: ['attachment.storage'] as const },
  async copyAttachment(_sourcePath: string, _card: Card): Promise<void> {
    throw new Error(
      'kl-plugin-storage-mongodb: attachmentStoragePlugin.copyAttachment() cannot be called directly. ' +
      'Use createMongodbAttachmentPlugin(engine) to obtain a wired attachment plugin instance.',
    )
  },
}

// ---------------------------------------------------------------------------
// card.state provider (merged into storage package)
// ---------------------------------------------------------------------------

interface CardStateDoc {
  _id?: unknown
  actor_id: string
  board_id: string
  card_id: string
  domain: string
  value: CardStateValue
  updated_at: string
}

function _csIsRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function _csIsCardStateCursor(value: unknown): value is CardStateCursor {
  return _csIsRecord(value)
    && typeof value.cursor === 'string'
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
}

function _csGetUpdatedAt(updatedAt?: string): string {
  return updatedAt ?? new Date().toISOString()
}

/**
 * Creates the MongoDB-backed `card.state` provider.
 *
 * Card-state data is stored in a `card_state` collection in the same MongoDB
 * database as card storage.
 */
export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  const uri = typeof context.options?.['uri'] === 'string' && context.options['uri'].trim().length > 0
    ? context.options['uri'].trim()
    : 'mongodb://localhost:27017'
  const database = typeof context.options?.['database'] === 'string' && context.options['database'].trim().length > 0
    ? context.options['database'].trim()
    : 'kanban_lite'
  const collectionName = typeof context.options?.['cardStateCollection'] === 'string' && context.options['cardStateCollection'].trim().length > 0
    ? context.options['cardStateCollection'].trim()
    : 'card_state'

  const mongo = loadMongoDriver()

  let _client: MongoClient | null = null
  let _collection: MongoCollection<CardStateDoc> | null = null

  async function getCollection(): Promise<MongoCollection<CardStateDoc>> {
    if (!_collection) {
      _client = new mongo.MongoClient(uri)
      await _client.connect()
      const db = _client.db(database)
      _collection = db.collection<CardStateDoc>(collectionName)
      await _collection.createIndex(
        { actor_id: 1, board_id: 1, card_id: 1, domain: 1 },
        { unique: true },
      )
    }
    return _collection
  }

  return {
    manifest: Object.freeze({ id: 'mongodb', provides: ['card.state'] as const }),
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      const col = await getCollection()
      const doc = await col.findOne({
        actor_id: input.actorId,
        board_id: input.boardId,
        card_id: input.cardId,
        domain: input.domain,
      })
      if (!doc) return null
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value: doc.value, updatedAt: doc.updated_at }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      const col = await getCollection()
      const updatedAt = _csGetUpdatedAt(input.updatedAt)
      await col.updateOne(
        { actor_id: input.actorId, board_id: input.boardId, card_id: input.cardId, domain: input.domain },
        { $set: { value: input.value, updated_at: updatedAt } },
        { upsert: true },
      )
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value: input.value, updatedAt }
    },
    async getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null> {
      const record = await this.getCardState({ ...input, domain: 'unread' })
      return record && _csIsCardStateCursor(record.value) ? record.value : null
    },
    async markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>> {
      const updatedAt = _csGetUpdatedAt(input.cursor.updatedAt)
      const value: CardStateCursor = { cursor: input.cursor.cursor, updatedAt }
      const col = await getCollection()
      await col.updateOne(
        { actor_id: input.actorId, board_id: input.boardId, card_id: input.cardId, domain: 'unread' },
        { $set: { value, updated_at: updatedAt } },
        { upsert: true },
      )
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt }
    },
  }
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-storage-mongodb',
  capabilities: {
    'card.storage': ['mongodb'] as const,
    'attachment.storage': ['mongodb'] as const,
    'card.state': ['mongodb'] as const,
  },
} as const

// ---------------------------------------------------------------------------
// Options schema — plugin-settings discovery
// ---------------------------------------------------------------------------

const MONGODB_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

function createMongodbOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['database'],
      properties: {
        uri: {
          type: 'string',
          title: 'Connection URI',
          description: 'MongoDB connection URI.',
          default: 'mongodb://localhost:27017',
        },
        database: {
          type: 'string',
          title: 'Database',
          description: 'MongoDB database name.',
          minLength: 1,
        },
        collectionPrefix: {
          type: 'string',
          title: 'Collection prefix',
          description: 'Prefix for MongoDB collection names.',
          default: 'kanban',
        },
      },
    },
    secrets: [
      { path: 'uri', redaction: MONGODB_SECRET_REDACTION },
    ],
  }
}

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  mongodb: createMongodbOptionsSchema,
}

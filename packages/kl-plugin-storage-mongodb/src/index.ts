import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import type { Card as BaseCard, Priority as BasePriority } from 'kanban-lite/sdk'

// ---------------------------------------------------------------------------
// Local structural interfaces — avoids deep imports from kanban-lite internals.
// Validated by runtime shape checks in the kanban-lite plugin loader.
// ---------------------------------------------------------------------------

export type Priority = BasePriority
export interface Card extends BaseCard {
  forms?: Array<{
    name?: string
    schema?: Record<string, unknown>
    ui?: Record<string, unknown>
    data?: Record<string, unknown>
  }>
  formData?: Record<string, Record<string, unknown>>
}
export type Comment = Card['comments'][number]

/** Card format version constant (matches kanban-lite's CARD_FORMAT_VERSION). */
const CARD_FORMAT_VERSION = 2

/** Plugin manifest describing what capabilities a plugin provides. */
interface PluginManifest {
  readonly id: string
  readonly provides: readonly ('card.storage' | 'attachment.storage')[]
}

/**
 * StorageEngine interface that external plugins must satisfy.
 * Matches the contract from kanban-lite's StorageEngine.
 */
export interface StorageEngine {
  readonly type: string
  readonly kanbanDir: string
  init(): Promise<void>
  close(): void
  migrate(): Promise<void>
  ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void>
  deleteBoardData(boardDir: string, boardId: string): Promise<void>
  scanCards(boardDir: string, boardId: string): Promise<Card[]>
  writeCard(card: Card): Promise<void>
  moveCard(card: Card, boardDir: string, newStatus: string): Promise<string>
  renameCard(card: Card, newFilename: string): Promise<string>
  deleteCard(card: Card): Promise<void>
  getCardDir(card: Card): string
  copyAttachment(sourcePath: string, card: Card): Promise<void>
}

/** CardStoragePlugin interface matching the kanban-lite plugin contract. */
export interface CardStoragePlugin {
  readonly manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  readonly nodeCapabilities?: {
    readonly isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}

/** AttachmentStoragePlugin interface matching the kanban-lite plugin contract. */
export interface AttachmentStoragePlugin {
  readonly manifest: PluginManifest
  getCardDir?(card: Card): string | null
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  appendAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}

// ---------------------------------------------------------------------------
// Type declarations for the lazily-loaded mongodb driver
// ---------------------------------------------------------------------------

interface MongoCollection<T = Record<string, unknown>> {
  createIndex(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<string>
  find(filter: Record<string, unknown>): { toArray(): Promise<T[]> }
  findOne(filter: Record<string, unknown>): Promise<T | null>
  insertOne(doc: T): Promise<{ insertedId: unknown }>
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }>
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>
}

interface MongoDb {
  collection<T = Record<string, unknown>>(name: string): MongoCollection<T>
}

interface MongoClient {
  connect(): Promise<MongoClient>
  db(name?: string): MongoDb
  close(): Promise<void>
}

type MongoModule = {
  MongoClient: new (uri: string, options?: Record<string, unknown>) => MongoClient
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Connection options for the MongoDB card-storage engine.
 * Passed via the `options` field of the `card.storage` provider reference in `.kanban.json`.
 */
export interface MongodbConnectionConfig {
  /** MongoDB connection URI. @default 'mongodb://localhost:27017' */
  uri?: string
  /** MongoDB database name (required). */
  database: string
  /** Collection name prefix. @default 'kanban' */
  collectionPrefix?: string
}

// ---------------------------------------------------------------------------
// Lazy driver loader
// ---------------------------------------------------------------------------

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs'),
)

/**
 * Lazily loads the `mongodb` driver.
 * Throws a clear, actionable install error when the driver is absent.
 */
function loadMongoDriver(): MongoModule {
  try {
    return runtimeRequire('mongodb') as MongoModule
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'MongoDB storage requires the mongodb driver. ' +
        'Install it as a runtime dependency: npm install mongodb',
      )
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Internal document types
// ---------------------------------------------------------------------------

interface CardDoc {
  _id?: unknown
  id: string
  board_id: string
  version: number
  status: string
  priority: string
  assignee: string | null
  due_date: string | null
  created: string
  modified: string
  completed_at: string | null
  labels: string[]
  attachments: string[]
  order_key: string
  content: string
  metadata: Record<string, unknown> | null
  actions: string[] | Record<string, string> | null
  forms: Card['forms'] | null
  form_data: Record<string, Record<string, unknown>> | null
}

interface CommentDoc {
  _id?: unknown
  id: string
  card_id: string
  board_id: string
  author: string
  created: string
  content: string
}

// ---------------------------------------------------------------------------
// MongoDB StorageEngine
// ---------------------------------------------------------------------------

/**
 * MongoDB-based storage engine for kanban-lite.
 *
 * Card and comment data is persisted in MongoDB collections. Workspace
 * configuration (boards, columns, settings, labels, webhooks) continues to
 * be sourced from `.kanban.json`. Attachment files are stored on the local
 * filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * The `mongodb` package must be installed as a runtime dependency. The driver
 * is loaded lazily; a clear install error is raised when the driver is absent.
 *
 * @example
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
export class MongodbStorageEngine implements StorageEngine {
  readonly type = 'mongodb'
  readonly kanbanDir: string

  private readonly connConfig: MongodbConnectionConfig
  private readonly prefix: string
  private _client: MongoClient | null = null
  private _db: MongoDb | null = null

  constructor(kanbanDir: string, connConfig: MongodbConnectionConfig) {
    this.kanbanDir = kanbanDir
    this.connConfig = connConfig
    this.prefix = connConfig.collectionPrefix ?? 'kanban'
  }

  /** Lazily creates (or returns the existing) client and database handle. */
  private async getDb(): Promise<MongoDb> {
    if (!this._db) {
      const mongo = loadMongoDriver()
      this._client = new mongo.MongoClient(this.connConfig.uri ?? 'mongodb://localhost:27017')
      await this._client.connect()
      this._db = this._client.db(this.connConfig.database)
    }
    return this._db
  }

  private get cardsCollectionName(): string {
    return `${this.prefix}_cards`
  }

  private get commentsCollectionName(): string {
    return `${this.prefix}_comments`
  }

  // --- Lifecycle ---

  async init(): Promise<void> {
    await this.migrate()
  }

  close(): void {
    if (this._client) {
      const client = this._client
      this._client = null
      this._db = null
      client.close().catch((err: unknown) => {
        console.error('[kl-plugin-storage-mongodb] client.close() error:', err)
      })
    }
  }

  async migrate(): Promise<void> {
    const db = await this.getDb()
    const cards = db.collection<CardDoc>(this.cardsCollectionName)
    const comments = db.collection<CommentDoc>(this.commentsCollectionName)

    await cards.createIndex({ id: 1, board_id: 1 }, { unique: true })
    await cards.createIndex({ board_id: 1, status: 1 })
    await comments.createIndex({ id: 1, card_id: 1, board_id: 1 }, { unique: true })
    await comments.createIndex({ card_id: 1, board_id: 1 })
  }

  // --- Board management ---

  async ensureBoardDirs(_boardDir: string, _extraStatuses?: string[]): Promise<void> {
    // Attachment directories are created lazily in copyAttachment(); no-op here.
  }

  async deleteBoardData(boardDir: string, boardId: string): Promise<void> {
    const db = await this.getDb()
    await db.collection<CommentDoc>(this.commentsCollectionName).deleteMany({ board_id: boardId })
    await db.collection<CardDoc>(this.cardsCollectionName).deleteMany({ board_id: boardId })
    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // attachment directory may not exist — not an error
    }
  }

  // --- Card I/O ---

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const db = await this.getDb()
    const cardDocs = await db.collection<CardDoc>(this.cardsCollectionName)
      .find({ board_id: boardId })
      .toArray()

    const commentDocs = await db.collection<CommentDoc>(this.commentsCollectionName)
      .find({ board_id: boardId })
      .toArray()

    const commentsByCardId = new Map<string, Comment[]>()
    for (const doc of commentDocs) {
      const list = commentsByCardId.get(doc.card_id) ?? []
      list.push({ id: doc.id, author: doc.author, created: doc.created, content: doc.content })
      commentsByCardId.set(doc.card_id, list)
    }

    return cardDocs.map((doc) => this._docToCard(doc, commentsByCardId.get(doc.id) ?? []))
  }

  async writeCard(card: Card): Promise<void> {
    const db = await this.getDb()
    const boardId = card.boardId ?? 'default'
    const hasMetadata = Boolean(card.metadata && Object.keys(card.metadata).length > 0)
    const hasActions = Boolean(
      card.actions &&
      (Array.isArray(card.actions)
        ? (card.actions as unknown[]).length > 0
        : Object.keys(card.actions as Record<string, string>).length > 0),
    )
    const hasForms = Boolean(card.forms && card.forms.length > 0)
    const hasFormData = Boolean(card.formData && Object.keys(card.formData).length > 0)

    const doc: Omit<CardDoc, '_id'> = {
      id: card.id,
      board_id: boardId,
      version: card.version ?? CARD_FORMAT_VERSION,
      status: card.status,
      priority: card.priority,
      assignee: card.assignee ?? null,
      due_date: card.dueDate ?? null,
      created: card.created,
      modified: card.modified,
      completed_at: card.completedAt ?? null,
      labels: card.labels ?? [],
      attachments: card.attachments ?? [],
      order_key: card.order ?? 'a0',
      content: card.content ?? '',
      metadata: hasMetadata ? (card.metadata as Record<string, unknown>) : null,
      actions: hasActions ? (card.actions as string[] | Record<string, string>) : null,
      forms: hasForms ? (card.forms ?? null) : null,
      form_data: hasFormData ? (card.formData ?? null) : null,
    }

    await db.collection<CardDoc>(this.cardsCollectionName).updateOne(
      { id: card.id, board_id: boardId },
      { $set: doc },
      { upsert: true },
    )

    // Replace all comments for this card
    const comments = db.collection<CommentDoc>(this.commentsCollectionName)
    await comments.deleteMany({ card_id: card.id, board_id: boardId })
    for (const comment of card.comments ?? []) {
      await comments.insertOne({
        id: comment.id,
        card_id: card.id,
        board_id: boardId,
        author: comment.author,
        created: comment.created,
        content: comment.content,
      })
    }
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    const db = await this.getDb()
    await db.collection<CardDoc>(this.cardsCollectionName).updateOne(
      { id: card.id, board_id: card.boardId ?? 'default' },
      { $set: { status: newStatus, modified: card.modified } },
    )
    return ''
  }

  async renameCard(_card: Card, _newFilename: string): Promise<string> {
    // MongoDB card IDs do not depend on filenames; slugs are cosmetic only.
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const db = await this.getDb()
    const boardId = card.boardId ?? 'default'
    await db.collection<CommentDoc>(this.commentsCollectionName).deleteMany({ card_id: card.id, board_id: boardId })
    await db.collection<CardDoc>(this.cardsCollectionName).deleteOne({ id: card.id, board_id: boardId })
  }

  // --- Attachments ---

  getCardDir(card: Card): string {
    return path.join(
      this.kanbanDir,
      'boards',
      card.boardId ?? 'default',
      card.status,
      'attachments',
    )
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const cardDir = this.getCardDir(card)
    await fs.mkdir(cardDir, { recursive: true })
    const filename = path.basename(sourcePath)
    const destPath = path.join(cardDir, filename)
    const resolvedSource = path.resolve(sourcePath)
    if (path.dirname(resolvedSource) !== cardDir) {
      await fs.copyFile(resolvedSource, destPath)
    }
  }

  // --- Private helpers ---

  private _docToCard(doc: CardDoc, comments: Comment[]): Card {
    return {
      version: doc.version,
      id: doc.id,
      boardId: doc.board_id,
      status: doc.status,
      priority: doc.priority as Priority,
      assignee: doc.assignee ?? null,
      dueDate: doc.due_date ?? null,
      created: doc.created,
      modified: doc.modified,
      completedAt: doc.completed_at ?? null,
      labels: doc.labels ?? [],
      attachments: doc.attachments ?? [],
      order: doc.order_key,
      content: doc.content,
      comments,
      ...(doc.metadata ? { metadata: doc.metadata } : {}),
      ...(doc.actions ? { actions: doc.actions } : {}),
      ...(doc.forms ? { forms: doc.forms } : {}),
      ...(doc.form_data ? { formData: doc.form_data } : {}),
      filePath: '',
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin factories
// ---------------------------------------------------------------------------

/**
 * Creates the built-in attachment-storage plugin for the MongoDB provider.
 *
 * Delegates attachment directory resolution and file copying to the active
 * MongoDB card-storage engine. Use this when `card.storage` is `mongodb` and
 * `attachment.storage` is not separately configured.
 */
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

/** Shared plugin manifest shape for `card.state` capability providers. */
export interface CardStateProviderManifest {
  readonly id: string
  readonly provides: readonly ['card.state']
}

export type CardStateValue = Record<string, unknown>

export interface CardStateKey {
  actorId: string
  boardId: string
  cardId: string
  domain: string
}

export interface CardStateRecord<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt: string
}

export interface CardStateWriteInput<TValue = CardStateValue> extends CardStateKey {
  value: TValue
  updatedAt?: string
}

export interface CardStateCursor extends Record<string, unknown> {
  cursor: string
  updatedAt?: string
}

export interface CardStateUnreadKey {
  actorId: string
  boardId: string
  cardId: string
}

export interface CardStateReadThroughInput extends CardStateUnreadKey {
  cursor: CardStateCursor
}

export interface CardStateModuleContext {
  workspaceRoot: string
  kanbanDir: string
  provider: string
  backend: 'builtin' | 'external'
  options?: Record<string, unknown>
}

export interface CardStateProvider {
  readonly manifest: CardStateProviderManifest
  getCardState(input: CardStateKey): Promise<CardStateRecord | null>
  setCardState(input: CardStateWriteInput): Promise<CardStateRecord>
  getUnreadCursor(input: CardStateUnreadKey): Promise<CardStateCursor | null>
  markUnreadReadThrough(input: CardStateReadThroughInput): Promise<CardStateRecord<CardStateCursor>>
}

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

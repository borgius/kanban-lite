import * as fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
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
  CardStateWriteInput,
  CardStoragePlugin,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  Priority,
  StorageEngine,
} from 'kanban-lite/sdk'

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

// ---------------------------------------------------------------------------
// Local structural interfaces — avoids deep imports from kanban-lite internals.
// Validated by runtime shape checks in the kanban-lite plugin loader.
// ---------------------------------------------------------------------------

export type Comment = Card['comments'][number]

export interface ConfigStorageProviderManifest {
  readonly id: string
  readonly provides: readonly string[]
}

export interface ConfigStorageModuleContext {
  workspaceRoot: string
  documentId: string
  provider: string
  backend: 'builtin' | 'external'
  options?: Record<string, unknown>
  worker?: unknown
}

export interface ConfigStorageProviderPlugin {
  readonly manifest: ConfigStorageProviderManifest
  readConfigDocument(): Record<string, unknown> | null | undefined
  writeConfigDocument(document: Record<string, unknown>): void
}

/** Card format version constant (matches kanban-lite's CARD_FORMAT_VERSION). */
const CARD_FORMAT_VERSION = 2


// ---------------------------------------------------------------------------
// Type declarations for the lazily-loaded ioredis driver
// ---------------------------------------------------------------------------

export interface RedisClient {
  hset(key: string, field: string, value: string): Promise<number>
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string>>
  hdel(key: string, ...fields: string[]): Promise<number>
  del(...keys: string[]): Promise<number>
  keys(pattern: string): Promise<string[]>
  quit(): Promise<'OK'>
  status: string
}

type RedisModule = {
  default: new (options?: Record<string, unknown>) => RedisClient
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Connection options for the Redis card-storage engine.
 * Passed via the `options` field of the `card.storage` provider reference in `.kanban.json`.
 */
export interface RedisConnectionConfig {
  /** Redis host. @default 'localhost' */
  host?: string
  /** Redis port. @default 6379 */
  port?: number
  /** Redis password. */
  password?: string
  /** Redis database index. @default 0 */
  db?: number
  /** Key prefix. @default 'kanban' */
  keyPrefix?: string
}

export function resolveRedisConnectionConfig(options?: Record<string, unknown>): RedisConnectionConfig {
  return {
    host: (options?.host as string | undefined) ?? 'localhost',
    port: typeof options?.port === 'number' ? options.port : 6379,
    password: options?.password as string | undefined,
    db: typeof options?.db === 'number' ? options.db : 0,
    keyPrefix: (options?.keyPrefix as string | undefined) ?? 'kanban',
  }
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
 * Lazily loads the `ioredis` driver.
 * Throws a clear, actionable install error when the driver is absent.
 */
export function loadRedisDriver(): RedisModule {
  try {
    return runtimeRequire('ioredis') as RedisModule
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'Redis storage requires the ioredis driver. ' +
        'Install it as a runtime dependency: npm install ioredis',
      )
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Internal serialization types
// ---------------------------------------------------------------------------

interface CardDoc {
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
  tasks: NonNullable<Card['tasks']> | null
  order_key: string
  content: string
  metadata: Record<string, unknown> | null
  actions: string[] | Record<string, string> | null
  forms: Card['forms'] | null
  form_data: Record<string, Record<string, unknown>> | null
}

interface CommentDoc {
  id: string
  card_id: string
  board_id: string
  author: string
  created: string
  content: string
}

// ---------------------------------------------------------------------------
// Redis StorageEngine
// ---------------------------------------------------------------------------

/**
 * Redis-based storage engine for kanban-lite.
 *
 * Card and comment data is persisted in Redis hashes. Workspace
 * configuration (boards, columns, settings, labels, webhooks) continues to
 * be sourced from `.kanban.json`. Attachment files are stored on the local
 * filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * The `ioredis` package must be installed as a runtime dependency. The driver
 * is loaded lazily; a clear install error is raised when the driver is absent.
 *
 * Data layout:
 * - `{prefix}:cards:{boardId}` — Hash: cardId → JSON serialized card
 * - `{prefix}:comments:{boardId}:{cardId}` — Hash: commentId → JSON serialized comment
 *
 * @example
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "redis",
 *       "options": {
 *         "host": "localhost",
 *         "port": 6379,
 *         "db": 0
 *       }
 *     }
 *   }
 * }
 * ```
 */
export class RedisStorageEngine implements StorageEngine {
  readonly type = 'redis'
  readonly kanbanDir: string

  private readonly connConfig: RedisConnectionConfig
  private readonly prefix: string
  private _client: RedisClient | null = null

  constructor(kanbanDir: string, connConfig: RedisConnectionConfig) {
    this.kanbanDir = kanbanDir
    this.connConfig = connConfig
    this.prefix = connConfig.keyPrefix ?? 'kanban'
  }

  /** Lazily creates (or returns the existing) Redis client. */
  private getClient(): RedisClient {
    if (!this._client) {
      const Redis = loadRedisDriver()
      const Ctor = Redis.default
      this._client = new Ctor({
        host: this.connConfig.host ?? 'localhost',
        port: this.connConfig.port ?? 6379,
        password: this.connConfig.password,
        db: this.connConfig.db ?? 0,
        lazyConnect: true,
      } as Record<string, unknown>)
    }
    return this._client
  }

  private cardsKey(boardId: string): string {
    return `${this.prefix}:cards:${boardId}`
  }

  private commentsKey(boardId: string, cardId: string): string {
    return `${this.prefix}:comments:${boardId}:${cardId}`
  }

  // --- Lifecycle ---

  async init(): Promise<void> {
    await this.migrate()
  }

  close(): void {
    if (this._client) {
      const client = this._client
      this._client = null
      client.quit().catch((err: unknown) => {
        console.error('[kl-plugin-storage-redis] client.quit() error:', err)
      })
    }
  }

  async migrate(): Promise<void> {
    // Redis is schema-less; no migration needed.
    // Ensure client connectivity.
    this.getClient()
  }

  // --- Board management ---

  async ensureBoardDirs(_boardDir: string, _extraStatuses?: string[]): Promise<void> {
    // Attachment directories are created lazily in copyAttachment(); no-op here.
  }

  async deleteBoardData(boardDir: string, boardId: string): Promise<void> {
    const client = this.getClient()

    // Fetch all card IDs for this board to delete comment keys
    const cardData = await client.hgetall(this.cardsKey(boardId))
    for (const cardId of Object.keys(cardData)) {
      await client.del(this.commentsKey(boardId, cardId))
    }
    await client.del(this.cardsKey(boardId))

    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // attachment directory may not exist — not an error
    }
  }

  // --- Card I/O ---

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const client = this.getClient()

    const cardData = await client.hgetall(this.cardsKey(boardId))
    const cards: Card[] = []

    for (const [cardId, json] of Object.entries(cardData)) {
      const doc: CardDoc = JSON.parse(json)

      // Fetch comments for this card
      const commentData = await client.hgetall(this.commentsKey(boardId, cardId))
      const comments: Comment[] = Object.values(commentData).map((cJson) => {
        const cDoc: CommentDoc = JSON.parse(cJson)
        return { id: cDoc.id, author: cDoc.author, created: cDoc.created, content: cDoc.content }
      })

      cards.push(this._docToCard(doc, comments))
    }

    return cards
  }

  async getCardById(_boardDir: string, boardId: string, cardId: string): Promise<Card | null> {
    const client = this.getClient()
    const json = await client.hget(this.cardsKey(boardId), cardId)
    if (!json) return null

    const doc: CardDoc = JSON.parse(json)
    const commentData = await client.hgetall(this.commentsKey(boardId, cardId))
    const comments: Comment[] = Object.values(commentData).map((cJson) => {
      const cDoc: CommentDoc = JSON.parse(cJson)
      return { id: cDoc.id, author: cDoc.author, created: cDoc.created, content: cDoc.content }
    })

    return this._docToCard(doc, comments)
  }

  async writeCard(card: Card): Promise<void> {
    const client = this.getClient()
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

    const doc: CardDoc = {
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
      tasks: card.tasks && card.tasks.length > 0 ? [...card.tasks] : null,
      order_key: card.order ?? 'a0',
      content: card.content ?? '',
      metadata: hasMetadata ? (card.metadata as Record<string, unknown>) : null,
      actions: hasActions ? (card.actions as string[] | Record<string, string>) : null,
      forms: hasForms ? (card.forms ?? null) : null,
      form_data: hasFormData ? (card.formData ?? null) : null,
    }

    await client.hset(this.cardsKey(boardId), card.id, JSON.stringify(doc))

    // Replace all comments for this card
    const commentsKey = this.commentsKey(boardId, card.id)
    await client.del(commentsKey)
    for (const comment of card.comments ?? []) {
      const cDoc: CommentDoc = {
        id: comment.id,
        card_id: card.id,
        board_id: boardId,
        author: comment.author,
        created: comment.created,
        content: comment.content,
      }
      await client.hset(commentsKey, comment.id, JSON.stringify(cDoc))
    }
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    const client = this.getClient()
    const boardId = card.boardId ?? 'default'
    const existing = await client.hget(this.cardsKey(boardId), card.id)
    if (existing) {
      const doc: CardDoc = JSON.parse(existing)
      doc.status = newStatus
      doc.modified = card.modified
      await client.hset(this.cardsKey(boardId), card.id, JSON.stringify(doc))
    }
    return ''
  }

  async renameCard(_card: Card, _newFilename: string): Promise<string> {
    // Redis card IDs do not depend on filenames; slugs are cosmetic only.
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const client = this.getClient()
    const boardId = card.boardId ?? 'default'
    await client.del(this.commentsKey(boardId, card.id))
    await client.hdel(this.cardsKey(boardId), card.id)
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
      ...(doc.tasks ? { tasks: doc.tasks } : {}),
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
 * Creates the built-in attachment-storage plugin for the Redis provider.
 *
 * Delegates attachment directory resolution and file copying to the active
 * Redis card-storage engine. Use this when `card.storage` is `redis` and
 * `attachment.storage` is not separately configured.
 */

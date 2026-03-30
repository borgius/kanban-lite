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
// Type declarations for the lazily-loaded pg driver
// ---------------------------------------------------------------------------

interface PgPoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
  release(): void
}

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
  connect(): Promise<PgPoolClient>
  end(): Promise<void>
}

type PgModule = {
  Pool: new (config: Record<string, unknown>) => PgPool
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Connection options for the PostgreSQL card-storage engine.
 * Passed via the `options` field of the `card.storage` provider reference in `.kanban.json`.
 */
export interface PostgresqlConnectionConfig {
  /** PostgreSQL server hostname. @default 'localhost' */
  host?: string
  /** PostgreSQL server port. @default 5432 */
  port?: number
  /** PostgreSQL user. @default 'postgres' */
  user?: string
  /** PostgreSQL password. */
  password?: string
  /** PostgreSQL database name (required). */
  database: string
  /** Optional SSL configuration passed through to pg. */
  ssl?: unknown
}

// ---------------------------------------------------------------------------
// Lazy driver loader
// ---------------------------------------------------------------------------

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs')
)

/**
 * Lazily loads the `pg` driver.
 * Throws a clear, actionable install error when the driver is absent.
 */
function loadPgDriver(): PgModule {
  try {
    return runtimeRequire('pg') as PgModule
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'PostgreSQL storage requires the pg driver. ' +
        'Install it as a runtime dependency: npm install pg',
      )
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS kanban_cards (
    id           VARCHAR(255)  NOT NULL,
    board_id     VARCHAR(255)  NOT NULL,
    version      INT           NOT NULL DEFAULT 0,
    status       VARCHAR(100)  NOT NULL DEFAULT 'backlog',
    priority     VARCHAR(50)   NOT NULL DEFAULT 'medium',
    assignee     VARCHAR(255)  DEFAULT NULL,
    due_date     VARCHAR(50)   DEFAULT NULL,
    created      VARCHAR(50)   NOT NULL,
    modified     VARCHAR(50)   NOT NULL,
    completed_at VARCHAR(50)   DEFAULT NULL,
    labels       TEXT          NOT NULL,
    attachments  TEXT          NOT NULL,
    order_key    VARCHAR(100)  NOT NULL DEFAULT 'a0',
    content      TEXT          NOT NULL,
    metadata     TEXT          DEFAULT NULL,
    actions      TEXT          DEFAULT NULL,
    forms        TEXT          DEFAULT NULL,
    form_data    TEXT          DEFAULT NULL,
    PRIMARY KEY (id, board_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kb_board_status ON kanban_cards (board_id, status)`,
  `CREATE TABLE IF NOT EXISTS kanban_comments (
    id       VARCHAR(255) NOT NULL,
    card_id  VARCHAR(255) NOT NULL,
    board_id VARCHAR(255) NOT NULL,
    author   VARCHAR(255) NOT NULL,
    created  VARCHAR(50)  NOT NULL,
    content  TEXT         NOT NULL,
    PRIMARY KEY (id, card_id, board_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kb_comment_card ON kanban_comments (card_id, board_id)`,
]

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface CardRow {
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
  labels: string
  attachments: string
  order_key: string
  content: string
  metadata: string | null
  actions: string | null
  forms: string | null
  form_data: string | null
}

interface CommentRow {
  id: string
  card_id: string
  board_id: string
  author: string
  created: string
  content: string
}

// ---------------------------------------------------------------------------
// PostgreSQL StorageEngine
// ---------------------------------------------------------------------------

/**
 * PostgreSQL-based storage engine for kanban-lite.
 *
 * Card and comment data is persisted in `kanban_cards` and `kanban_comments`
 * tables. Workspace configuration (boards, columns, settings, labels,
 * webhooks) is sourced from `.kanban.json`. Attachment files are stored on
 * the local filesystem at `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * The `pg` package must be installed as a runtime dependency. The driver
 * is loaded lazily; a clear install error is raised when the driver is absent.
 *
 * @example
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "postgresql",
 *       "options": {
 *         "host": "localhost",
 *         "user": "kanban",
 *         "password": "secret",
 *         "database": "kanban_db"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export class PostgresqlStorageEngine implements StorageEngine {
  readonly type = 'postgresql'
  readonly kanbanDir: string

  private readonly connConfig: PostgresqlConnectionConfig
  private _pool: PgPool | null = null

  constructor(kanbanDir: string, connConfig: PostgresqlConnectionConfig) {
    this.kanbanDir = kanbanDir
    this.connConfig = connConfig
  }

  /** Lazily creates (or returns the existing) connection pool. */
  private get pool(): PgPool {
    if (!this._pool) {
      const pg = loadPgDriver()
      this._pool = new pg.Pool({
        host: this.connConfig.host ?? 'localhost',
        port: this.connConfig.port ?? 5432,
        user: this.connConfig.user ?? 'postgres',
        password: this.connConfig.password ?? '',
        database: this.connConfig.database,
        max: 10,
        ...(this.connConfig.ssl !== undefined ? { ssl: this.connConfig.ssl } : {}),
      })
    }
    return this._pool
  }

  // --- Lifecycle ---

  async init(): Promise<void> {
    await this.migrate()
  }

  close(): void {
    if (this._pool) {
      const pool = this._pool
      this._pool = null
      pool.end().catch((err: unknown) => {
        console.error('[kl-plugin-storage-postgresql] pool.end() error:', err)
      })
    }
  }

  async migrate(): Promise<void> {
    for (const sql of SCHEMA_STATEMENTS) {
      await this.pool.query(sql)
    }
    await this.ensureOptionalCardColumns()
  }

  private async ensureOptionalCardColumns(): Promise<void> {
    await this.ensureCardColumn('forms', 'TEXT DEFAULT NULL')
    await this.ensureCardColumn('form_data', 'TEXT DEFAULT NULL')
  }

  private async ensureCardColumn(columnName: 'forms' | 'form_data', definitionSql: string): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'kanban_cards' AND column_name = $1`,
      [columnName],
    ) as { rows: Array<Record<string, unknown>> }
    if (rows.length === 0) {
      await this.pool.query(`ALTER TABLE kanban_cards ADD COLUMN ${columnName} ${definitionSql}`)
    }
  }

  // --- Board management ---

  async ensureBoardDirs(_boardDir: string, _extraStatuses?: string[]): Promise<void> {
    // Attachment directories are created lazily in copyAttachment(); no-op here.
  }

  async deleteBoardData(boardDir: string, boardId: string): Promise<void> {
    await this.pool.query('DELETE FROM kanban_comments WHERE board_id = $1', [boardId])
    await this.pool.query('DELETE FROM kanban_cards WHERE board_id = $1', [boardId])
    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // attachment directory may not exist — not an error
    }
  }

  // --- Card I/O ---

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const { rows: cardRows } = await this.pool.query(
      'SELECT * FROM kanban_cards WHERE board_id = $1',
      [boardId],
    ) as { rows: CardRow[] }

    const { rows: commentRows } = await this.pool.query(
      'SELECT * FROM kanban_comments WHERE board_id = $1',
      [boardId],
    ) as { rows: CommentRow[] }

    const commentsByCardId = new Map<string, Comment[]>()
    for (const row of commentRows) {
      const list = commentsByCardId.get(row.card_id) ?? []
      list.push({ id: row.id, author: row.author, created: row.created, content: row.content })
      commentsByCardId.set(row.card_id, list)
    }

    return cardRows.map((row) => this._rowToCard(row, commentsByCardId.get(row.id) ?? []))
  }

  async writeCard(card: Card): Promise<void> {
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

    const UPSERT_SQL = `
      INSERT INTO kanban_cards
        (id, board_id, version, status, priority, assignee, due_date,
         created, modified, completed_at, labels, attachments, order_key,
         content, metadata, actions, forms, form_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id, board_id) DO UPDATE SET
        version      = EXCLUDED.version,
        status       = EXCLUDED.status,
        priority     = EXCLUDED.priority,
        assignee     = EXCLUDED.assignee,
        due_date     = EXCLUDED.due_date,
        modified     = EXCLUDED.modified,
        completed_at = EXCLUDED.completed_at,
        labels       = EXCLUDED.labels,
        attachments  = EXCLUDED.attachments,
        order_key    = EXCLUDED.order_key,
        content      = EXCLUDED.content,
        metadata     = EXCLUDED.metadata,
        actions      = EXCLUDED.actions,
        forms        = EXCLUDED.forms,
        form_data    = EXCLUDED.form_data
    `

    await this.pool.query(UPSERT_SQL, [
      card.id,
      boardId,
      card.version ?? CARD_FORMAT_VERSION,
      card.status,
      card.priority,
      card.assignee ?? null,
      card.dueDate ?? null,
      card.created,
      card.modified,
      card.completedAt ?? null,
      JSON.stringify(card.labels ?? []),
      JSON.stringify(card.attachments ?? []),
      card.order ?? 'a0',
      card.content ?? '',
      hasMetadata ? JSON.stringify(card.metadata) : null,
      hasActions ? JSON.stringify(card.actions) : null,
      hasForms ? JSON.stringify(card.forms) : null,
      hasFormData ? JSON.stringify(card.formData) : null,
    ])

    await this.pool.query(
      'DELETE FROM kanban_comments WHERE card_id = $1 AND board_id = $2',
      [card.id, boardId],
    )
    for (const comment of card.comments ?? []) {
      await this.pool.query(
        'INSERT INTO kanban_comments (id, card_id, board_id, author, created, content) VALUES ($1, $2, $3, $4, $5, $6)',
        [comment.id, card.id, boardId, comment.author, comment.created, comment.content],
      )
    }
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    await this.pool.query(
      'UPDATE kanban_cards SET status = $1, modified = $2 WHERE id = $3 AND board_id = $4',
      [newStatus, card.modified, card.id, card.boardId ?? 'default'],
    )
    return ''
  }

  async renameCard(_card: Card, _newFilename: string): Promise<string> {
    // PostgreSQL card IDs do not depend on filenames; slugs are cosmetic only.
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const boardId = card.boardId ?? 'default'
    await this.pool.query(
      'DELETE FROM kanban_comments WHERE card_id = $1 AND board_id = $2',
      [card.id, boardId],
    )
    await this.pool.query(
      'DELETE FROM kanban_cards WHERE id = $1 AND board_id = $2',
      [card.id, boardId],
    )
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

  private _rowToCard(row: CardRow, comments: Comment[]): Card {
    return {
      version: row.version,
      id: row.id,
      boardId: row.board_id,
      status: row.status,
      priority: row.priority as Priority,
      assignee: row.assignee ?? null,
      dueDate: row.due_date ?? null,
      created: row.created,
      modified: row.modified,
      completedAt: row.completed_at ?? null,
      labels: this._parseJson<string[]>(row.labels, []),
      attachments: this._parseJson<string[]>(row.attachments, []),
      order: row.order_key,
      content: row.content,
      comments,
      ...(row.metadata ? { metadata: this._parseJson<Record<string, unknown>>(row.metadata, {}) } : {}),
      ...(row.actions ? { actions: this._parseJson<string[] | Record<string, string>>(row.actions, []) } : {}),
      ...(row.forms ? { forms: this._parseJson<Card['forms']>(row.forms, []) } : {}),
      ...(row.form_data ? { formData: this._parseJson<Card['formData']>(row.form_data, {}) } : {}),
      filePath: '',
    }
  }

  private _parseJson<T>(value: string | null, fallback: T): T {
    if (!value) return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin factories
// ---------------------------------------------------------------------------

/**
 * Creates the built-in attachment-storage plugin for the PostgreSQL provider.
 *
 * Delegates attachment directory resolution and file copying to the active
 * PostgreSQL card-storage engine. Use this when `card.storage` is `postgresql` and
 * `attachment.storage` is not separately configured.
 */
export function createPostgresqlAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin {
  if (engine.type !== 'postgresql') {
    throw new Error(
      'kl-plugin-storage-postgresql: attachment plugin requires an active postgresql card.storage engine.'
    )
  }
  const pgEngine = engine as PostgresqlStorageEngine
  return {
    manifest: { id: 'postgresql', provides: ['attachment.storage'] as const },
    getCardDir(card: Card): string | null {
      return pgEngine.getCardDir(card)
    },
    async copyAttachment(sourcePath: string, card: Card): Promise<void> {
      await pgEngine.copyAttachment(sourcePath, card)
    },
  }
}

// ---------------------------------------------------------------------------
// Named plugin exports (required by kanban-lite plugin loader contract)
// ---------------------------------------------------------------------------

/**
 * kanban-lite `card.storage` plugin for PostgreSQL.
 *
 * Provider id: `postgresql`
 * Install: `npm install kl-plugin-storage-postgresql pg`
 *
 * @example `.kanban.json`
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "postgresql",
 *       "options": {
 *         "host": "localhost",
 *         "user": "kanban",
 *         "password": "secret",
 *         "database": "kanban_db"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export const cardStoragePlugin: CardStoragePlugin = {
  manifest: { id: 'postgresql', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): PostgresqlStorageEngine {
    const database = options?.database
    if (typeof database !== 'string' || !database) {
      throw new Error(
        'kl-plugin-storage-postgresql: PostgreSQL storage requires a "database" option. ' +
        'Set it in .kanban.json: { "plugins": { "card.storage": { "provider": "postgresql", ' +
        '"options": { "database": "my_db", "host": "localhost", "user": "postgres", "password": "" } } } }',
      )
    }
    const connConfig: PostgresqlConnectionConfig = {
      host: (options?.host as string | undefined) ?? 'localhost',
      port: typeof options?.port === 'number' ? options.port : 5432,
      user: (options?.user as string | undefined) ?? 'postgres',
      password: (options?.password as string | undefined) ?? '',
      database,
      ...(options?.ssl !== undefined ? { ssl: options.ssl } : {}),
    }
    return new PostgresqlStorageEngine(kanbanDir, connConfig)
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
 * kanban-lite `attachment.storage` plugin for PostgreSQL.
 *
 * Stores attachments in the local filesystem at
 * `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * When using this plugin explicitly, the active `card.storage` must also be
 * `postgresql`; otherwise the plugin will throw at attachment-copy time.
 */
export const attachmentStoragePlugin: AttachmentStoragePlugin = {
  manifest: { id: 'postgresql', provides: ['attachment.storage'] as const },
  // These are late-bound: they require an active engine reference.
  // The kanban-lite runtime wires this automatically when card.storage and
  // attachment.storage share the same provider id.
  async copyAttachment(_sourcePath: string, _card: Card): Promise<void> {
    throw new Error(
      'kl-plugin-storage-postgresql: attachmentStoragePlugin.copyAttachment() cannot be called directly. ' +
      'Use createPostgresqlAttachmentPlugin(engine) to obtain a wired attachment plugin instance.',
    )
  },
}

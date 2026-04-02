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
  CardStateProviderManifest,
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

/** Card format version constant (matches kanban-lite's CARD_FORMAT_VERSION). */
const CARD_FORMAT_VERSION = 2


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
    tasks        TEXT          DEFAULT NULL,
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
  tasks: string | null
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
    await this.ensureCardColumn('tasks', 'TEXT DEFAULT NULL')
  }

  private async ensureCardColumn(columnName: 'forms' | 'form_data' | 'tasks', definitionSql: string): Promise<void> {
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
         created, modified, completed_at, labels, attachments, tasks, order_key,
         content, metadata, actions, forms, form_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
        tasks        = EXCLUDED.tasks,
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
      card.tasks && card.tasks.length > 0 ? JSON.stringify(card.tasks) : null,
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
      ...(row.tasks ? { tasks: this._parseJson<string[]>(row.tasks, []) } : {}),
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

// ---------------------------------------------------------------------------
// card.state provider (merged into storage package)
// ---------------------------------------------------------------------------

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

const PG_CARD_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS card_state (
  actor_id   VARCHAR(255) NOT NULL,
  board_id   VARCHAR(255) NOT NULL,
  card_id    VARCHAR(255) NOT NULL,
  domain     VARCHAR(100) NOT NULL,
  value_json TEXT         NOT NULL,
  updated_at VARCHAR(50)  NOT NULL,
  PRIMARY KEY (actor_id, board_id, card_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_card_state_lookup
  ON card_state (actor_id, board_id, card_id, domain);
`

/**
 * Creates the PostgreSQL-backed `card.state` provider.
 *
 * Card-state data is stored in a `card_state` table in the same PostgreSQL
 * database as card storage.
 */
export function createCardStateProvider(context: CardStateModuleContext): CardStateProvider {
  const pg = loadPgDriver()
  const pool = new pg.Pool({
    host: (context.options?.['host'] as string | undefined) ?? 'localhost',
    port: typeof context.options?.['port'] === 'number' ? context.options['port'] : 5432,
    user: (context.options?.['user'] as string | undefined) ?? 'postgres',
    password: (context.options?.['password'] as string | undefined) ?? '',
    database: (context.options?.['database'] as string | undefined) ?? 'kanban_lite',
    ...(context.options?.['ssl'] !== undefined ? { ssl: context.options['ssl'] } : {}),
  })

  let _initialized = false
  async function ensureSchema(): Promise<void> {
    if (_initialized) return
    await pool.query(PG_CARD_STATE_SCHEMA)
    _initialized = true
  }

  return {
    manifest: Object.freeze({ id: 'postgresql', provides: ['card.state'] as const }),
    async getCardState(input: CardStateKey): Promise<CardStateRecord | null> {
      await ensureSchema()
      const res = await pool.query(
        'SELECT value_json, updated_at FROM card_state WHERE actor_id = $1 AND board_id = $2 AND card_id = $3 AND domain = $4',
        [input.actorId, input.boardId, input.cardId, input.domain],
      )
      const row = res.rows[0] as { value_json: string; updated_at: string } | undefined
      if (!row) return null
      try {
        const value = JSON.parse(row.value_json) as unknown
        if (!_csIsRecord(value)) return null
        return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: input.domain, value, updatedAt: row.updated_at }
      } catch { return null }
    },
    async setCardState(input: CardStateWriteInput): Promise<CardStateRecord> {
      await ensureSchema()
      const updatedAt = _csGetUpdatedAt(input.updatedAt)
      await pool.query(
        `INSERT INTO card_state (actor_id, board_id, card_id, domain, value_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (actor_id, board_id, card_id, domain)
         DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at`,
        [input.actorId, input.boardId, input.cardId, input.domain, JSON.stringify(input.value), updatedAt],
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
      await this.setCardState({ actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt })
      return { actorId: input.actorId, boardId: input.boardId, cardId: input.cardId, domain: 'unread', value, updatedAt }
    },
  }
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-storage-postgresql',
  capabilities: {
    'card.storage': ['postgresql'] as const,
    'attachment.storage': ['postgresql'] as const,
    'card.state': ['postgresql'] as const,
  },
} as const

// ---------------------------------------------------------------------------
// Options schema — plugin-settings discovery
// ---------------------------------------------------------------------------

const POSTGRESQL_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

function createPostgresqlOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['database'],
      properties: {
        host: {
          type: 'string',
          title: 'Host',
          description: 'PostgreSQL server hostname.',
          default: 'localhost',
        },
        port: {
          type: 'number',
          title: 'Port',
          description: 'PostgreSQL server port.',
          default: 5432,
        },
        user: {
          type: 'string',
          title: 'User',
          description: 'PostgreSQL user.',
          default: 'postgres',
        },
        password: {
          type: 'string',
          title: 'Password',
          description: 'PostgreSQL password.',
        },
        database: {
          type: 'string',
          title: 'Database',
          description: 'PostgreSQL database name.',
          minLength: 1,
        },
      },
    },
    secrets: [
      { path: 'password', redaction: POSTGRESQL_SECRET_REDACTION },
    ],
  }
}

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  postgresql: createPostgresqlOptionsSchema,
}

import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import type { Card, Comment, Priority } from '../../shared/types'
import { CARD_FORMAT_VERSION } from '../../shared/types'
import type { StorageEngine } from './types'
import type { AttachmentStoragePlugin } from './index'

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs')
)

// ---------------------------------------------------------------------------
// Type declarations for the lazily-loaded mysql2/promise driver
// ---------------------------------------------------------------------------

interface MysqlPool {
  execute(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>
  end(): Promise<void>
}

type Mysql2PromiseModule = {
  createPool(config: Record<string, unknown>): MysqlPool
}

const MYSQL_ATTACHMENT_MANIFEST = { id: 'mysql', provides: ['attachment.storage'] as const }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Connection options for the MySQL card-storage engine.
 * Passed via the `options` field of the `card.storage` provider reference.
 */
export interface MysqlConnectionConfig {
  /** MySQL server hostname. @default 'localhost' */
  host?: string
  /** MySQL server port. @default 3306 */
  port?: number
  /** MySQL user. @default 'root' */
  user?: string
  /** MySQL password. */
  password?: string
  /** MySQL database schema to use (required). */
  database: string
  /** Optional SSL configuration passed through to mysql2. */
  ssl?: unknown
}

// ---------------------------------------------------------------------------
// Lazy driver loader
// ---------------------------------------------------------------------------

/**
 * Lazily loads the `mysql2/promise` driver.
 * Throws a clear, actionable install error when the driver is absent.
 *
 * @internal
 */
function loadMysql2Driver(): Mysql2PromiseModule {
  try {
    return runtimeRequire('mysql2/promise') as Mysql2PromiseModule
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'MySQL storage requires the mysql2 driver. ' +
        'Install it as a runtime dependency: npm install mysql2',
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
    content      MEDIUMTEXT    NOT NULL,
    metadata     TEXT          DEFAULT NULL,
    actions      TEXT          DEFAULT NULL,
    PRIMARY KEY (id, board_id),
    INDEX idx_kb_board_status (board_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS kanban_comments (
    id       VARCHAR(255) NOT NULL,
    card_id  VARCHAR(255) NOT NULL,
    board_id VARCHAR(255) NOT NULL,
    author   VARCHAR(255) NOT NULL,
    created  VARCHAR(50)  NOT NULL,
    content  TEXT         NOT NULL,
    PRIMARY KEY (id, card_id, board_id),
    INDEX idx_kb_comment_card (card_id, board_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]

// ---------------------------------------------------------------------------
// MySQL StorageEngine
// ---------------------------------------------------------------------------

/**
 * MySQL-based storage engine.
 *
 * Card and comment data is stored in a MySQL database using `kanban_cards` and
 * `kanban_comments` tables. Workspace configuration (boards, columns, settings,
 * labels, webhooks) continues to be sourced from `.kanban.json`.
 * Attachment files are stored on the local filesystem at
 * `.kanban/boards/{boardId}/{status}/attachments/`, identical to the SQLite engine.
 *
 * Requires the `mysql2` package as a runtime dependency. The driver is loaded
 * lazily; a clear install error is raised when the driver is absent.
 *
 * @example
 * Configure in `.kanban.json`:
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "mysql",
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
export class MysqlStorageEngine implements StorageEngine {
  readonly type = 'mysql'
  readonly kanbanDir: string

  private readonly connConfig: MysqlConnectionConfig
  private _pool: MysqlPool | null = null

  /**
   * @param kanbanDir  - Absolute path to the `.kanban` directory.
   * @param connConfig - MySQL connection configuration.
   */
  constructor(kanbanDir: string, connConfig: MysqlConnectionConfig) {
    this.kanbanDir = kanbanDir
    this.connConfig = connConfig
  }

  /** Lazily creates (or returns the existing) connection pool. */
  private get pool(): MysqlPool {
    if (!this._pool) {
      const mysql2 = loadMysql2Driver()
      this._pool = mysql2.createPool({
        host: this.connConfig.host ?? 'localhost',
        port: this.connConfig.port ?? 3306,
        user: this.connConfig.user ?? 'root',
        password: this.connConfig.password ?? '',
        database: this.connConfig.database,
        waitForConnections: true,
        connectionLimit: 10,
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
    // Pool.end() is async but StorageEngine.close() is sync.
    // Drain the pool in the background without blocking the caller.
    if (this._pool) {
      const pool = this._pool
      this._pool = null
      pool.end().catch((err: unknown) => {
        console.error('[kanban-mysql] pool.end() error:', err)
      })
    }
  }

  async migrate(): Promise<void> {
    for (const sql of SCHEMA_STATEMENTS) {
      await this.pool.execute(sql)
    }
  }

  // --- Board management ---

  async ensureBoardDirs(_boardDir: string, _extraStatuses?: string[]): Promise<void> {
    // Attachment directories are created lazily in copyAttachment(); no-op here.
  }

  async deleteBoardData(boardDir: string, boardId: string): Promise<void> {
    await this.pool.execute('DELETE FROM kanban_comments WHERE board_id = ?', [boardId])
    await this.pool.execute('DELETE FROM kanban_cards WHERE board_id = ?', [boardId])
    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // attachment directory may not exist — not an error
    }
  }

  // --- Card I/O ---

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const [cardRows] = await this.pool.execute(
      'SELECT * FROM kanban_cards WHERE board_id = ?',
      [boardId],
    ) as [CardRow[], unknown]

    const [commentRows] = await this.pool.execute(
      'SELECT * FROM kanban_comments WHERE board_id = ?',
      [boardId],
    ) as [CommentRow[], unknown]

    const commentsByCardId = new Map<string, Comment[]>()
    for (const row of commentRows) {
      const list = commentsByCardId.get(row.card_id) ?? []
      list.push({ id: row.id, author: row.author, created: row.created, content: row.content })
      commentsByCardId.set(row.card_id, list)
    }

    return cardRows.map((row) => this._rowToCard(row, commentsByCardId.get(row.id) ?? []))
  }

  async writeCard(card: Card): Promise<void> {
    const boardId = card.boardId || 'default'
    const hasMetadata = Boolean(card.metadata && Object.keys(card.metadata).length > 0)
    const hasActions = Boolean(
      card.actions &&
      (Array.isArray(card.actions)
        ? (card.actions as unknown[]).length > 0
        : Object.keys(card.actions as Record<string, string>).length > 0),
    )

    const UPSERT_SQL = `
      INSERT INTO kanban_cards
        (id, board_id, version, status, priority, assignee, due_date,
         created, modified, completed_at, labels, attachments, order_key,
         content, metadata, actions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        version      = VALUES(version),
        status       = VALUES(status),
        priority     = VALUES(priority),
        assignee     = VALUES(assignee),
        due_date     = VALUES(due_date),
        modified     = VALUES(modified),
        completed_at = VALUES(completed_at),
        labels       = VALUES(labels),
        attachments  = VALUES(attachments),
        order_key    = VALUES(order_key),
        content      = VALUES(content),
        metadata     = VALUES(metadata),
        actions      = VALUES(actions)
    `

    await this.pool.execute(UPSERT_SQL, [
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
    ])

    await this.pool.execute(
      'DELETE FROM kanban_comments WHERE card_id = ? AND board_id = ?',
      [card.id, boardId],
    )
    for (const comment of card.comments ?? []) {
      await this.pool.execute(
        'INSERT INTO kanban_comments (id, card_id, board_id, author, created, content) VALUES (?, ?, ?, ?, ?, ?)',
        [comment.id, card.id, boardId, comment.author, comment.created, comment.content],
      )
    }
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    await this.pool.execute(
      'UPDATE kanban_cards SET status = ?, modified = ? WHERE id = ? AND board_id = ?',
      [newStatus, card.modified, card.id, card.boardId ?? 'default'],
    )
    return ''
  }

  async renameCard(_card: Card, _newFilename: string): Promise<string> {
    // MySQL card IDs do not depend on filenames; slugs are cosmetic only.
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const boardId = card.boardId ?? 'default'
    await this.pool.execute(
      'DELETE FROM kanban_comments WHERE card_id = ? AND board_id = ?',
      [card.id, boardId],
    )
    await this.pool.execute(
      'DELETE FROM kanban_cards WHERE id = ? AND board_id = ?',
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

function assertMysqlAttachmentEngine(engine: StorageEngine): asserts engine is MysqlStorageEngine {
  if (engine.type !== 'mysql') {
    throw new Error('Built-in attachment storage provider "mysql" requires card.storage provider "mysql".')
  }
}

/**
 * Built-in attachment-storage plugin for the MySQL provider.
 *
 * Delegates attachment directory resolution and file copying to the active
 * MySQL card-storage engine.
 *
 * @internal
 */
export function createMysqlAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin {
  assertMysqlAttachmentEngine(engine)

  return {
    manifest: MYSQL_ATTACHMENT_MANIFEST,
    getCardDir(card: Card): string | null {
      return engine.getCardDir(card)
    },
    async copyAttachment(sourcePath: string, card: Card): Promise<void> {
      await engine.copyAttachment(sourcePath, card)
    },
  }
}

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
// Plugin registration
// ---------------------------------------------------------------------------

/**
 * Built-in MySQL card-storage plugin.
 *
 * Registers under the `'mysql'` provider id and satisfies the
 * {@link CardStoragePlugin} contract for the capability registry.
 *
 * The `mysql2` driver is loaded lazily on first engine use; a clear
 * install error is surfaced when the driver is absent.
 *
 * @example
 * Configure in `.kanban.json`:
 * ```json
 * {
 *   "plugins": {
 *     "card.storage": {
 *       "provider": "mysql",
 *       "options": { "host": "localhost", "database": "kanban", "user": "root", "password": "" }
 *     }
 *   }
 * }
 * ```
 */
export const MYSQL_PLUGIN = {
  manifest: { id: 'mysql', provides: ['card.storage'] as const },
  createEngine(kanbanDir: string, options?: Record<string, unknown>): MysqlStorageEngine {
    const database = options?.database
    if (typeof database !== 'string' || !database) {
      throw new Error(
        'MySQL storage requires a "database" option. ' +
        'Set it in .kanban.json: { "plugins": { "card.storage": { "provider": "mysql", ' +
        '"options": { "database": "my_db", "host": "localhost", "user": "root", "password": "" } } } }',
      )
    }
    const connConfig: MysqlConnectionConfig = {
      host: (options?.host as string | undefined) ?? 'localhost',
      port: typeof options?.port === 'number' ? options.port : 3306,
      user: (options?.user as string | undefined) ?? 'root',
      password: (options?.password as string | undefined) ?? '',
      database,
      ...(options?.ssl !== undefined ? { ssl: options.ssl } : {}),
    }
    return new MysqlStorageEngine(kanbanDir, connConfig)
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
} as const

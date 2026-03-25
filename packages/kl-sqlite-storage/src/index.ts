import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import type {
  Card as BaseCard,
  KanbanColumn as BaseKanbanColumn,
  Priority as BasePriority,
} from 'kanban-lite/sdk'

// ---------------------------------------------------------------------------
// Local structural interfaces
// Avoids deep imports from kanban-lite internals.
// Validated by runtime shape checks in the kanban-lite plugin loader.
// ---------------------------------------------------------------------------

/** Current card frontmatter schema version. */
const CARD_FORMAT_VERSION = 1

export type Priority = BasePriority
export type KanbanColumn = BaseKanbanColumn
export interface Card extends BaseCard {
  forms?: Array<{
    name?: string
    schema?: Record<string, unknown>
    ui?: Record<string, unknown>
    data?: Record<string, unknown>
  }>
  formData?: Record<string, Record<string, unknown>>
}

/** A single comment on a card. */
export type Comment = Card['comments'][number]

/** A form attachment on a card (named reference or inline definition). */
export type CardFormAttachment = NonNullable<Card['forms']>[number]

/** A label definition with color and optional group. */
export interface LabelDefinition {
  color: string
  group?: string
}

/** A registered webhook endpoint. */
export interface Webhook {
  id: string
  url: string
  events: string[]
  secret?: string
  active: boolean
}

/** Configuration for a single kanban board. */
export interface BoardConfig {
  name: string
  description?: string
  columns: KanbanColumn[]
  nextCardId: number
  defaultStatus: string
  defaultPriority: Priority
}

/** Root configuration object for the kanban workspace. */
export interface KanbanConfig {
  version: 2
  boards: Record<string, BoardConfig>
  defaultBoard: string
  kanbanDirectory: string
  aiAgent: string
  defaultPriority: Priority
  defaultStatus: string
  nextCardId: number
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
  showDeletedColumn: boolean
  boardZoom: number
  cardZoom: number
  port: number
  labels?: Record<string, LabelDefinition>
  webhooks?: Webhook[]
  /** @deprecated Use webhook plugin with `card.action.triggered` event instead. */
  actionWebhookUrl?: string
  storageEngine?: 'markdown' | 'sqlite'
  sqlitePath?: string
  [key: string]: unknown
}

/** Plugin manifest describing what capability namespaces a plugin provides. */
export interface PluginManifest {
  readonly id: string
  readonly provides: readonly string[]
}

/** Interface for attachment.storage plugins. */
export interface AttachmentStoragePlugin {
  readonly manifest: PluginManifest
  getCardDir?(card: Card): string | null
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  appendAttachment?(card: Card, attachment: string, content: string | Uint8Array): Promise<boolean>
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}

/** StorageEngine interface that external sqlite-compatible plugins must satisfy. */
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

/** CardStoragePlugin interface matching the broadened kanban-lite storage plugin contract. */
export interface CardStoragePlugin {
  readonly manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  readonly nodeCapabilities?: {
    readonly isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}

// ---------------------------------------------------------------------------
// Default constants (mirrored from kanban-lite shared/types.ts)
// ---------------------------------------------------------------------------

/** Default set of kanban columns. */
const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' },
]

/** Default configuration used when no .kanban.json exists. */
const DEFAULT_CONFIG: KanbanConfig = {
  version: 2,
  boards: {
    default: {
      name: 'Default',
      columns: [...DEFAULT_COLUMNS],
      nextCardId: 1,
      defaultStatus: 'backlog',
      defaultPriority: 'medium',
    },
  },
  defaultBoard: 'default',
  kanbanDirectory: '.kanban',
  aiAgent: 'claude',
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  nextCardId: 1,
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  showDeletedColumn: false,
  boardZoom: 100,
  cardZoom: 100,
  port: 2954,
  labels: {},
}

// ---------------------------------------------------------------------------
// SQL schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 2

const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  columns          TEXT NOT NULL DEFAULT '[]',
  next_card_id     INTEGER NOT NULL DEFAULT 1,
  default_status   TEXT NOT NULL DEFAULT 'backlog',
  default_priority TEXT NOT NULL DEFAULT 'medium'
);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT    NOT NULL,
  board_id     TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'backlog',
  priority     TEXT    NOT NULL DEFAULT 'medium',
  assignee     TEXT,
  due_date     TEXT,
  created      TEXT    NOT NULL,
  modified     TEXT    NOT NULL,
  completed_at TEXT,
  labels       TEXT    NOT NULL DEFAULT '[]',
  attachments  TEXT    NOT NULL DEFAULT '[]',
  order_key    TEXT    NOT NULL DEFAULT 'a0',
  content      TEXT    NOT NULL DEFAULT '',
  metadata     TEXT,
  actions      TEXT,
  forms        TEXT,
  form_data    TEXT,
  PRIMARY KEY (id, board_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id       TEXT NOT NULL,
  card_id  TEXT NOT NULL,
  board_id TEXT NOT NULL,
  author   TEXT NOT NULL,
  created  TEXT NOT NULL,
  content  TEXT NOT NULL,
  PRIMARY KEY (id, card_id, board_id)
);

CREATE TABLE IF NOT EXISTS labels (
  name       TEXT PRIMARY KEY,
  color      TEXT NOT NULL,
  group_name TEXT
);

CREATE TABLE IF NOT EXISTS webhooks (
  id     TEXT PRIMARY KEY,
  url    TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["*"]',
  secret TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cards_board_status ON cards (board_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_card       ON comments (card_id, board_id);
`

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface BoardRow {
  id: string
  name: string
  description: string | null
  columns: string
  next_card_id: number
  default_status: string
  default_priority: string
}

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

interface LabelRow {
  name: string
  color: string
  group_name: string | null
}

interface WebhookRow {
  id: string
  url: string
  events: string
  secret: string | null
  active: number
}

// ---------------------------------------------------------------------------
// Module-level engine registry
//
// The attachment plugin is a static export but needs kanbanDir (which comes
// from the card engine) to compute attachment paths. The registry is populated
// when createEngine() is called so the attachment plugin can delegate to the
// right engine. In single-workspace deployments (the common case) there is
// always exactly one active engine per process.
// ---------------------------------------------------------------------------

const _engineRegistry = new Map<string, SqliteStorageEngine>()

function _registerEngine(kanbanDir: string, engine: SqliteStorageEngine): void {
  _engineRegistry.set(kanbanDir, engine)
}

function _unregisterEngine(kanbanDir: string, engine: SqliteStorageEngine): void {
  if (_engineRegistry.get(kanbanDir) === engine) {
    _engineRegistry.delete(kanbanDir)
  }
}

function _lookupEngineForCard(_card: Card): SqliteStorageEngine | null {
  // When only one engine is active (the typical scenario), use it directly.
  // In multi-workspace scenarios the caller should configure attachment.storage
  // explicitly rather than relying on the same-package fallback.
  if (_engineRegistry.size === 1) {
    return _engineRegistry.values().next().value ?? null
  }
  return null
}

// ---------------------------------------------------------------------------
// SqliteStorageEngine
// ---------------------------------------------------------------------------

/**
 * SQLite-based storage engine for kanban-lite.
 *
 * All kanban data — cards, comments, boards, columns, labels, webhooks,
 * and display settings — is stored in a single SQLite database file.
 * Attachment files are stored on disk under
 * `.kanban/boards/{boardId}/{status}/attachments/`.
 *
 * Uses `better-sqlite3` for synchronous, low-overhead database access.
 *
 * @example
 * ```ts
 * const engine = new SqliteStorageEngine('/path/to/.kanban', '/path/to/kanban.db')
 * await engine.init()
 * ```
 */
export class SqliteStorageEngine implements StorageEngine {
  readonly type = 'sqlite'
  readonly kanbanDir: string

  private readonly dbPath: string
  private _db: Database.Database | null = null

  constructor(kanbanDir: string, dbPath: string) {
    this.kanbanDir = kanbanDir
    this.dbPath = dbPath
  }

  private get db(): Database.Database {
    if (!this._db) {
      fsSync.mkdirSync(path.dirname(this.dbPath), { recursive: true })
      this._db = new Database(this.dbPath)
      this._db.pragma('journal_mode = WAL')
      this._db.pragma('foreign_keys = ON')
    }
    return this._db
  }

  async init(): Promise<void> {
    await this.migrate()
  }

  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
    _unregisterEngine(this.kanbanDir, this)
  }

  async migrate(): Promise<void> {
    this.db.exec(CREATE_SCHEMA_SQL)

    const versionRow = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
    if (!versionRow) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
      this._seedDefaultsIfEmpty()
      return
    }

    if (versionRow.version < 2) {
      const cardColumns = this.db.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>
      const hasForms = cardColumns.some((col) => col.name === 'forms')
      const hasFormData = cardColumns.some((col) => col.name === 'form_data')

      const upgrade = this.db.transaction(() => {
        if (!hasForms) this.db.exec('ALTER TABLE cards ADD COLUMN forms TEXT')
        if (!hasFormData) this.db.exec('ALTER TABLE cards ADD COLUMN form_data TEXT')
        this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION)
      })
      upgrade()
    }
  }

  private _seedDefaultsIfEmpty(): void {
    const boardCount = (this.db.prepare('SELECT COUNT(*) as n FROM boards').get() as { n: number }).n
    if (boardCount === 0) {
      const def = DEFAULT_CONFIG
      this.db.prepare(`
        INSERT INTO boards (id, name, description, columns, next_card_id, default_status, default_priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('default', 'Default', null, JSON.stringify(DEFAULT_COLUMNS), 1, 'backlog', 'medium')

      this._setWorkspaceKey('defaultBoard', def.defaultBoard)
      this._setWorkspaceKey('kanbanDirectory', def.kanbanDirectory)
      this._setWorkspaceKey('aiAgent', def.aiAgent)
      this._setWorkspaceKey('defaultPriority', def.defaultPriority)
      this._setWorkspaceKey('defaultStatus', def.defaultStatus)
      this._setWorkspaceKey('showPriorityBadges', String(def.showPriorityBadges))
      this._setWorkspaceKey('showAssignee', String(def.showAssignee))
      this._setWorkspaceKey('showDueDate', String(def.showDueDate))
      this._setWorkspaceKey('showLabels', String(def.showLabels))
      this._setWorkspaceKey('showBuildWithAI', String(def.showBuildWithAI))
      this._setWorkspaceKey('showFileName', String(def.showFileName))
      this._setWorkspaceKey('compactMode', String(def.compactMode))
      this._setWorkspaceKey('markdownEditorMode', String(def.markdownEditorMode))
      this._setWorkspaceKey('showDeletedColumn', String(def.showDeletedColumn))
      this._setWorkspaceKey('boardZoom', String(def.boardZoom))
      this._setWorkspaceKey('cardZoom', String(def.cardZoom))
      this._setWorkspaceKey('port', String(def.port))
      this._setWorkspaceKey('nextCardId', String(def.nextCardId ?? 1))
      this._setWorkspaceKey('storageEngine', 'sqlite')
      this._setWorkspaceKey('sqlitePath', this.dbPath)
    }
  }

  readConfig(): KanbanConfig {
    const ws = this._readAllWorkspaceKeys()
    const boards: Record<string, BoardConfig> = {}
    const boardRows = this.db.prepare('SELECT * FROM boards').all() as BoardRow[]
    for (const row of boardRows) {
      boards[row.id] = {
        name: row.name,
        description: row.description ?? undefined,
        columns: JSON.parse(row.columns) as KanbanColumn[],
        nextCardId: row.next_card_id,
        defaultStatus: row.default_status,
        defaultPriority: row.default_priority as Priority,
      }
    }

    const labelRows = this.db.prepare('SELECT * FROM labels').all() as LabelRow[]
    const labels: Record<string, LabelDefinition> = {}
    for (const row of labelRows) {
      labels[row.name] = { color: row.color, ...(row.group_name ? { group: row.group_name } : {}) }
    }

    const webhookRows = this.db.prepare('SELECT * FROM webhooks').all() as WebhookRow[]
    const webhooks: Webhook[] = webhookRows.map((r) => ({
      id: r.id,
      url: r.url,
      events: JSON.parse(r.events) as string[],
      secret: r.secret ?? undefined,
      active: r.active === 1,
    }))

    const defaultBoard = ws['defaultBoard'] || 'default'

    return {
      version: 2,
      boards,
      defaultBoard,
      kanbanDirectory: ws['kanbanDirectory'] || '.kanban',
      aiAgent: ws['aiAgent'] || 'claude',
      defaultPriority: (ws['defaultPriority'] || 'medium') as Priority,
      defaultStatus: ws['defaultStatus'] || 'backlog',
      nextCardId: Number(ws['nextCardId']) || this._computeGlobalNextCardId(),
      showPriorityBadges: this._bool(ws['showPriorityBadges'], true),
      showAssignee: this._bool(ws['showAssignee'], true),
      showDueDate: this._bool(ws['showDueDate'], true),
      showLabels: this._bool(ws['showLabels'], true),
      showBuildWithAI: this._bool(ws['showBuildWithAI'], true),
      showFileName: this._bool(ws['showFileName'], false),
      compactMode: this._bool(ws['compactMode'], false),
      markdownEditorMode: this._bool(ws['markdownEditorMode'], false),
      showDeletedColumn: this._bool(ws['showDeletedColumn'], false),
      boardZoom: Number(ws['boardZoom']) || 100,
      cardZoom: Number(ws['cardZoom']) || 100,
      port: Number(ws['port']) || 3000,
      labels,
      webhooks: webhooks.length > 0 ? webhooks : undefined,
      actionWebhookUrl: ws['actionWebhookUrl'] || undefined,
      storageEngine: 'sqlite',
      sqlitePath: this.dbPath,
    }
  }

  writeConfig(config: KanbanConfig): void {
    const upsertBoard = this.db.prepare(`
      INSERT INTO boards (id, name, description, columns, next_card_id, default_status, default_priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name             = excluded.name,
        description      = excluded.description,
        columns          = excluded.columns,
        next_card_id     = excluded.next_card_id,
        default_status   = excluded.default_status,
        default_priority = excluded.default_priority
    `)

    const deleteBoard = this.db.prepare('DELETE FROM boards WHERE id = ?')
    const existingBoardIds = (this.db.prepare('SELECT id FROM boards').all() as { id: string }[]).map((r) => r.id)
    const newBoardIds = new Set(Object.keys(config.boards))

    const doWrite = this.db.transaction(() => {
      for (const [id, board] of Object.entries(config.boards)) {
        upsertBoard.run(
          id, board.name, board.description ?? null,
          JSON.stringify(board.columns), board.nextCardId,
          board.defaultStatus, board.defaultPriority,
        )
      }
      for (const id of existingBoardIds) {
        if (!newBoardIds.has(id)) deleteBoard.run(id)
      }

      this.db.prepare('DELETE FROM labels').run()
      const insertLabel = this.db.prepare('INSERT INTO labels (name, color, group_name) VALUES (?, ?, ?)')
      for (const [name, def] of Object.entries(config.labels || {})) {
        insertLabel.run(name, def.color, def.group ?? null)
      }

      this.db.prepare('DELETE FROM webhooks').run()
      const insertWebhook = this.db.prepare(
        'INSERT INTO webhooks (id, url, events, secret, active) VALUES (?, ?, ?, ?, ?)'
      )
      for (const wh of config.webhooks || []) {
        insertWebhook.run(wh.id, wh.url, JSON.stringify(wh.events), wh.secret ?? null, wh.active ? 1 : 0)
      }

      this._setWorkspaceKey('defaultBoard', config.defaultBoard)
      this._setWorkspaceKey('kanbanDirectory', config.kanbanDirectory)
      this._setWorkspaceKey('aiAgent', config.aiAgent)
      this._setWorkspaceKey('defaultPriority', config.defaultPriority)
      this._setWorkspaceKey('defaultStatus', config.defaultStatus)
      this._setWorkspaceKey('showPriorityBadges', String(config.showPriorityBadges))
      this._setWorkspaceKey('showAssignee', String(config.showAssignee))
      this._setWorkspaceKey('showDueDate', String(config.showDueDate))
      this._setWorkspaceKey('showLabels', String(config.showLabels))
      this._setWorkspaceKey('showBuildWithAI', String(config.showBuildWithAI))
      this._setWorkspaceKey('showFileName', String(config.showFileName))
      this._setWorkspaceKey('compactMode', String(config.compactMode))
      this._setWorkspaceKey('markdownEditorMode', String(config.markdownEditorMode))
      this._setWorkspaceKey('showDeletedColumn', String(config.showDeletedColumn))
      this._setWorkspaceKey('boardZoom', String(config.boardZoom))
      this._setWorkspaceKey('cardZoom', String(config.cardZoom))
      this._setWorkspaceKey('port', String(config.port))
      if (config.nextCardId !== undefined) {
        this._setWorkspaceKey('nextCardId', String(config.nextCardId))
      }
      if (config.actionWebhookUrl !== undefined) {
        this._setWorkspaceKey('actionWebhookUrl', config.actionWebhookUrl)
      }
      this._setWorkspaceKey('storageEngine', 'sqlite')
      this._setWorkspaceKey('sqlitePath', this.dbPath)
    })

    doWrite()
  }

  allocateCardId(boardId: string): number {
    const allocate = this.db.transaction((bid: string) => {
      const boardRow = this.db.prepare('SELECT id FROM boards WHERE id = ?').get(bid) as { id: string } | undefined
      if (!boardRow) throw new Error(`Board '${bid}' not found`)
      const ws = this._readAllWorkspaceKeys()
      const current = Number(ws['nextCardId']) || this._computeGlobalNextCardId()
      this._setWorkspaceKey('nextCardId', String(current + 1))
      return current
    })
    return allocate(boardId) as number
  }

  syncCardIdCounter(_boardId: string, existingIds: number[]): void {
    if (existingIds.length === 0) return
    const maxId = Math.max(...existingIds)
    const ws = this._readAllWorkspaceKeys()
    const current = Number(ws['nextCardId']) || 1
    if (current <= maxId) {
      this._setWorkspaceKey('nextCardId', String(maxId + 1))
    }
  }

  private _computeGlobalNextCardId(): number {
    const rows = this.db.prepare('SELECT next_card_id FROM boards').all() as { next_card_id: number }[]
    return rows.length > 0 ? Math.max(...rows.map((r) => r.next_card_id)) : 1
  }

  async ensureBoardDirs(_boardDir: string, _extraStatuses?: string[]): Promise<void> {
    // Card data lives in the database. The attachment directory is created
    // lazily in copyAttachment().
  }

  async deleteBoardData(boardDir: string, boardId: string): Promise<void> {
    this.db.prepare('DELETE FROM comments WHERE board_id = ?').run(boardId)
    this.db.prepare('DELETE FROM cards WHERE board_id = ?').run(boardId)
    try {
      await fs.rm(boardDir, { recursive: true })
    } catch {
      // may not exist
    }
  }

  async scanCards(_boardDir: string, boardId: string): Promise<Card[]> {
    const cardRows = this.db
      .prepare('SELECT * FROM cards WHERE board_id = ?')
      .all(boardId) as CardRow[]

    const commentRows = this.db
      .prepare('SELECT * FROM comments WHERE board_id = ?')
      .all(boardId) as CommentRow[]

    const commentsByCardId = new Map<string, Comment[]>()
    for (const row of commentRows) {
      const list = commentsByCardId.get(row.card_id) || []
      list.push({ id: row.id, author: row.author, created: row.created, content: row.content })
      commentsByCardId.set(row.card_id, list)
    }

    return cardRows.map((row) => this._rowToCard(row, commentsByCardId.get(row.id) || []))
  }

  async writeCard(card: Card): Promise<void> {
    const upsertCard = this.db.prepare(`
      INSERT INTO cards (
        id, board_id, version, status, priority, assignee, due_date,
        created, modified, completed_at, labels, attachments, order_key,
        content, metadata, actions, forms, form_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, board_id) DO UPDATE SET
        version      = excluded.version,
        status       = excluded.status,
        priority     = excluded.priority,
        assignee     = excluded.assignee,
        due_date     = excluded.due_date,
        modified     = excluded.modified,
        completed_at = excluded.completed_at,
        labels       = excluded.labels,
        attachments  = excluded.attachments,
        order_key    = excluded.order_key,
        content      = excluded.content,
        metadata     = excluded.metadata,
        actions      = excluded.actions,
        forms        = excluded.forms,
        form_data    = excluded.form_data
    `)

    const deleteComments = this.db.prepare('DELETE FROM comments WHERE card_id = ? AND board_id = ?')
    const insertComment = this.db.prepare(
      'INSERT INTO comments (id, card_id, board_id, author, created, content) VALUES (?, ?, ?, ?, ?, ?)'
    )

    const boardId = card.boardId || 'default'
    const write = this.db.transaction(() => {
      upsertCard.run(
        card.id, boardId,
        card.version ?? CARD_FORMAT_VERSION,
        card.status, card.priority,
        card.assignee ?? null, card.dueDate ?? null,
        card.created, card.modified,
        card.completedAt ?? null,
        JSON.stringify(card.labels || []),
        JSON.stringify(card.attachments || []),
        card.order || 'a0',
        card.content || '',
        card.metadata && Object.keys(card.metadata).length > 0 ? JSON.stringify(card.metadata) : null,
        card.actions && (Array.isArray(card.actions) ? card.actions.length > 0 : Object.keys(card.actions).length > 0)
          ? JSON.stringify(card.actions) : null,
        card.forms && card.forms.length > 0 ? JSON.stringify(card.forms) : null,
        card.formData && Object.keys(card.formData).length > 0 ? JSON.stringify(card.formData) : null,
      )
      deleteComments.run(card.id, boardId)
      for (const comment of card.comments || []) {
        insertComment.run(comment.id, card.id, boardId, comment.author, comment.created, comment.content)
      }
    })
    write()
  }

  async moveCard(card: Card, _boardDir: string, newStatus: string): Promise<string> {
    this.db
      .prepare('UPDATE cards SET status = ?, modified = ? WHERE id = ? AND board_id = ?')
      .run(newStatus, card.modified, card.id, card.boardId || 'default')
    return ''
  }

  async renameCard(_card: Card, _newFilename: string): Promise<string> {
    // Card IDs in SQLite do not depend on filenames.
    return ''
  }

  async deleteCard(card: Card): Promise<void> {
    const boardId = card.boardId || 'default'
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM comments WHERE card_id = ? AND board_id = ?').run(card.id, boardId)
      this.db.prepare('DELETE FROM cards WHERE id = ? AND board_id = ?').run(card.id, boardId)
    })()
  }

  /** Returns the attachment directory path for a card. */
  getCardDir(card: Card): string {
    return path.join(this.kanbanDir, 'boards', card.boardId || 'default', card.status, 'attachments')
  }

  async copyAttachment(sourcePath: string, card: Card): Promise<void> {
    const cardDir = this.getCardDir(card)
    await fs.mkdir(cardDir, { recursive: true })
    const filename = path.basename(sourcePath)
    const destPath = path.join(cardDir, filename)
    const resolvedSource = path.resolve(sourcePath)
    if (resolvedSource !== destPath) {
      await fs.copyFile(resolvedSource, destPath)
    }
  }

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
      labels: JSON.parse(row.labels || '[]') as string[],
      attachments: JSON.parse(row.attachments || '[]') as string[],
      order: row.order_key,
      content: row.content,
      comments,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) as Record<string, unknown> } : {}),
      ...(row.actions ? { actions: JSON.parse(row.actions) as string[] | Record<string, string> } : {}),
      ...(row.forms ? { forms: JSON.parse(row.forms) as Card['forms'] } : {}),
      ...(row.form_data ? { formData: JSON.parse(row.form_data) as Record<string, Record<string, unknown>> } : {}),
      filePath: '',
    }
  }

  private _setWorkspaceKey(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO workspace (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value)
  }

  private _readAllWorkspaceKeys(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM workspace').all() as { key: string; value: string }[]
    const map: Record<string, string> = {}
    for (const row of rows) map[row.key] = row.value
    return map
  }

  private _bool(value: string | undefined, defaultVal: boolean): boolean {
    if (value === undefined || value === null) return defaultVal
    return value === 'true'
  }
}

// ---------------------------------------------------------------------------
// cardStoragePlugin export
// ---------------------------------------------------------------------------

function resolveDbPath(kanbanDir: string, options?: Record<string, unknown>): string {
  const rawPath = (options?.['sqlitePath'] as string | undefined) ?? '.kanban/kanban.db'
  const workspaceRoot = path.dirname(kanbanDir)
  return path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, rawPath)
}

/**
 * `card.storage` plugin for SQLite.
 *
 * Provider id: `sqlite`
 * Install target: `kl-sqlite-storage`
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
      '[kl-sqlite-storage] attachmentStoragePlugin.copyAttachment: no active SqliteStorageEngine found. ' +
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

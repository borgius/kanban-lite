export const SCHEMA_VERSION = 3

export const CREATE_SCHEMA_SQL = `
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
  tasks        TEXT,
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

export interface BoardRow {
  id: string
  name: string
  description: string | null
  columns: string
  next_card_id: number
  default_status: string
  default_priority: string
}

export interface CardRow {
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

export interface CommentRow {
  id: string
  card_id: string
  board_id: string
  author: string
  created: string
  content: string
}

export interface LabelRow {
  name: string
  color: string
  group_name: string | null
}

export interface WebhookRow {
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

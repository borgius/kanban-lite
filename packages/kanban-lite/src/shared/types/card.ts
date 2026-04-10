import type { FormDefinition, BoardMetaFieldDef } from '../config'

export const CARD_FORMAT_VERSION = 1

/**
 * Priority level for a kanban card.
 * Cards are ranked from most urgent (`'critical'`) to least urgent (`'low'`).
 *
 * @example
 * const p: Priority = 'high'
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low'

/**
 * Sort option for {@link KanbanSDK.listCards}.
 * - `'created:asc'` — oldest cards first
 * - `'created:desc'` — newest cards first
 * - `'modified:asc'` — least recently modified first
 * - `'modified:desc'` — most recently modified first
 *
 * When omitted, cards are sorted by their fractional `order` index (board order).
 */
export type CardSortOption = 'created:asc' | 'created:desc' | 'modified:asc' | 'modified:desc'

/**
 * String alias representing a column or status identifier.
 * Corresponds to the `id` field of a {@link KanbanColumn} (e.g. `'backlog'`, `'in-progress'`).

/** Transport-safe unread cursor used by UI read models. */
export interface CardStateCursorTransport {
  cursor: string
  updatedAt?: string
}

/** Transport-safe open-state payload for UI read models. */
export interface CardOpenStateValueTransport {
  openedAt: string
  readThrough: CardStateCursorTransport | null
}

/** Transport-safe generic card-state record. */
export interface CardStateRecordTransport<TValue = Record<string, unknown>> {
  actorId: string
  boardId: string
  cardId: string
  domain: string
  value: TValue
  updatedAt: string
}

/** Side-effect-free unread summary emitted to UI hosts. */
export interface CardUnreadSummaryTransport {
  actorId: string
  boardId: string
  cardId: string
  latestActivity: CardStateCursorTransport | null
  readThrough: CardStateCursorTransport | null
  unread: boolean
}

/** Minimal card-state runtime status surfaced to UI hosts. */
export interface CardStateStatusTransport {
  backend: 'builtin' | 'external' | 'none'
  availability: 'available' | 'identity-unavailable' | 'unavailable'
  configured: boolean
  errorCode?: string
}

/** Machine-readable UI error for card-state read/open failures. */
export interface CardStateErrorTransport {
  code: string
  availability: 'identity-unavailable' | 'unavailable'
  message: string
}

/** Read-only card-state metadata attached to UI card read models. */
export interface CardStateReadModelTransport {
  unread: CardUnreadSummaryTransport | null
  open: CardStateRecordTransport<CardOpenStateValueTransport> | null
  status: CardStateStatusTransport
  error?: CardStateErrorTransport
}
export type CardStatus = string

/**
 * A single log entry attached to a kanban card.
 *
 * Logs are stored in a dedicated `<cardId>.log` text file.
 * Each line has the format: `timestamp [source] text {json}`
 */
export interface LogEntry {
  /** ISO 8601 timestamp of when the log was created. */
  timestamp: string
  /** Source/origin of the log entry (e.g. `'default'`, `'system'`, `'ci'`). */
  source: string
  /** Human-readable log message text. Supports inline markdown (bold, italic, emoji). */
  text: string
  /** Optional structured data object, stored as compacted JSON. */
  object?: Record<string, unknown>
}

/**
 * A comment attached to a kanban card.
 */
export interface Comment {
  /** Unique identifier for the comment. */
  id: string
  /** Display name of the comment author. */
  author: string
  /** ISO 8601 timestamp of when the comment was created. */
  created: string
  /** Markdown body of the comment. */
  content: string
  /**
   * When `true`, the comment is currently being streamed by an agent and has
   * not yet been fully written. The content field contains whatever has
   * accumulated so far. This field is stripped before persisting to storage.
   */
  streaming?: boolean
}

/**
 * A single rich checklist task item stored on a card.
 */
export interface CardTask {
  /** Short task title (required). */
  title: string
  /** Optional multi-line description. */
  description: string
  /** Whether the task has been completed. */
  checked: boolean
  /** ISO 8601 timestamp of when the task was created. */
  createdAt: string
  /** ISO 8601 timestamp of the last modification. */
  modifiedAt: string
  /** Actor who created the task. */
  createdBy: string
  /** Actor who last modified the task. */
  modifiedBy: string
}

/**
 * A kanban card with all associated metadata.
 *
 * Cards are persisted as markdown files with YAML frontmatter inside the
 * `.kanban/{status}/` directory structure.
 */
export interface Card {
  /** Card frontmatter schema version. 0 = legacy (pre-versioning). */
  version: number
  /** Unique identifier for the card (e.g. `'42-build-dashboard'`). */
  id: string
  /** Board this card belongs to. Omitted when only one board exists. */
  boardId?: string
  /** Current column/status of the card. */
  status: CardStatus
  /** Priority level of the card. */
  priority: Priority
  /** Assignee name, or `null` if unassigned. */
  assignee: string | null
  /** ISO 8601 due date string, or `null` if no due date is set. */
  dueDate: string | null
  /** ISO 8601 timestamp of when the card was created. */
  created: string
  cardState?: CardStateReadModelTransport
  /** ISO 8601 timestamp of the last modification. */
  modified: string
  /** ISO 8601 timestamp of when the card was moved to done, or `null`. */
  completedAt: string | null
  /** Tags/labels attached to the card. */
  labels: string[]
  /** File paths of attachments associated with the card. */
  attachments: string[]
  /** Rich checklist task items stored on the card. */
  tasks?: CardTask[]
  /** Discussion comments on the card. */
  comments: Comment[]
  /** Fractional index (base-62) controlling sort order within a column. */
  order: string
  /** Markdown body content of the card. */
  content: string
  /** Arbitrary user-defined metadata stored as YAML in the frontmatter. */
  metadata?: Record<string, unknown>
  /** Named actions that can be triggered via the action webhook. Either an array of action keys or a map of action key → display title. */
  actions?: string[] | Record<string, string>
  /** Forms attached to this card (named config-form references or inline definitions). */
  forms?: CardFormAttachment[]
  /**
   * Per-form persisted data keyed by the resolved form `id`.
   *
   * Entries **may be partial at rest** — they may contain only a subset of the
   * form schema properties (e.g. fields the user has previously submitted or
   * pre-seeded values). The full canonical object is produced at runtime by
   * `resolveCardForms()` (SDK) or `resolveCardFormDescriptors()` (webview),
   * which merge config defaults, attachment defaults, and this stored value,
   * then apply the metadata overlay. Submit results always persist the full
   * canonical merged payload back to `card.formData[formId]`.
   */
  formData?: CardFormDataMap
  /** Absolute path to the card's markdown file on disk. */
  filePath: string
}

/**
 * Summary information for a kanban board.
 */
export interface BoardInfo {
  /** Unique identifier for the board. */
  id: string
  /** Human-readable board name. */
  name: string
  /** Optional description of the board's purpose. */
  description?: string
  columns?: KanbanColumn[]
  /** Named board-level actions available in the toolbar. Map of action key to display title. */
  actions?: Record<string, string>
  /** Named metadata field definitions; keys with `highlighted: true` are shown on card previews. */
  metadata?: Record<string, BoardMetaFieldDef>
  /** Metadata keys whose rendered values prefix card display titles in user-visible surfaces. */
  title?: string[]
  /** Template string for card display titles (e.g. `${metadata.company}: ${title}`). When set, takes precedence over `title`. */
  titleTemplate?: string
  /** Reusable named workspace forms available for attachment/resolution on this board. */
  forms?: Record<string, FormDefinition>
}

/**
 * Extracts a title from markdown content by finding the first `# heading`.
 * Falls back to the first non-empty line if no heading is found,
 * or `'Untitled'` if the content is empty.
 *
 * @param content - Raw markdown string to extract the title from.
 * @returns The extracted title string.
 *
 * @example
 * getTitleFromContent('# My Card\nSome body text')
 * // => 'My Card'
 *
 * @example
 * getTitleFromContent('Just a line of text')
 * // => 'Just a line of text'
 */

export interface KanbanColumn {
  /** Unique identifier used as the card status value (e.g. `'in-progress'`). */
  id: string
  /** Human-readable column name displayed in the UI (e.g. `'In Progress'`). */
  name: string
  /** CSS color string for the column header (e.g. `'#f59e0b'`). */
  color: string
}


export const DELETED_STATUS_ID = 'deleted'
export const DELETED_COLUMN: KanbanColumn = { id: DELETED_STATUS_ID, name: 'Deleted', color: '#ef4444' }

export const BOARD_BACKGROUND_MODES = ['fancy', 'plain'] as const
export type BoardBackgroundMode = (typeof BOARD_BACKGROUND_MODES)[number]

export const FANCY_BOARD_BACKGROUND_PRESETS = ['aurora', 'sunset', 'meadow', 'nebula', 'lagoon', 'candy', 'ember', 'violet'] as const
export type FancyBoardBackgroundPreset = (typeof FANCY_BOARD_BACKGROUND_PRESETS)[number]

export const PLAIN_BOARD_BACKGROUND_PRESETS = ['paper', 'mist', 'sand'] as const
export type PlainBoardBackgroundPreset = (typeof PLAIN_BOARD_BACKGROUND_PRESETS)[number]

export type BoardBackgroundPreset = FancyBoardBackgroundPreset | PlainBoardBackgroundPreset

export const DEFAULT_BOARD_BACKGROUND_MODE: BoardBackgroundMode = 'fancy'
export const DEFAULT_FANCY_BOARD_BACKGROUND_PRESET: FancyBoardBackgroundPreset = 'aurora'
export const DEFAULT_PLAIN_BOARD_BACKGROUND_PRESET: PlainBoardBackgroundPreset = 'paper'

/**
 * Controls how much detail is shown on each kanban card.
 * - `compact`  — title + priority only, no description, no labels, no footer
 * - `normal`   — title + clipped description (1 line), no labels, show footer
 * - `large`    — title + description (2 lines) + up to 4 labels (default)
 * - `xlarge`   — title + description (8 lines) + up to 4 labels
 * - `xxlarge`  — title + description (12 lines) + all labels
 */
export type CardViewMode = 'compact' | 'normal' | 'large' | 'xlarge' | 'xxlarge'

/**
 * UI display preferences controlling which card fields are visible and
 * how the board renders cards.
 */
export interface CardDisplaySettings {
  /** Whether to show colored priority badges on cards. */
  showPriorityBadges: boolean
  /** Whether to display the assignee on cards. */
  showAssignee: boolean
  /** Whether to display the due date on cards. */
  showDueDate: boolean
  /** Whether to display labels/tags on cards. */
  showLabels: boolean
  /** Whether to show the "Build with AI" action on cards. */
  showBuildWithAI: boolean
  /** Whether to display the source filename on cards. */
  showFileName: boolean
  /**
   * How much detail to show on each card.
   * Default `'large'` (title + 2-line description + up to 4 labels).
   */
  cardViewMode?: CardViewMode
  /** Whether to use the markdown editor when editing card content. */
  markdownEditorMode: boolean
  /** Whether to display the hidden Deleted column on the board. */
  showDeletedColumn: boolean
  /** The default priority assigned to newly created cards. */
  defaultPriority: Priority
  /** The default column/status assigned to newly created cards. */
  defaultStatus: string
  /** Zoom level for the board view as a percentage (75–150). Default 100. */
  boardZoom: number
  /** Zoom level for the card detail panel as a percentage (75–150). Default 100. */
  cardZoom: number
  /** Column width in pixels (200–500). Default 288. */
  columnWidth?: number
  /** Whether the board canvas uses a plain or fancy background preset. Default `fancy`. */
  boardBackgroundMode: BoardBackgroundMode
  /** Selected board background preset within the active background mode. */
  boardBackgroundPreset: BoardBackgroundPreset
  /** Whether panels open as a centered popup or a right-side drawer. Default 'drawer'. */
  panelMode?: 'popup' | 'drawer'
  /** Width of the right-side drawer as a percentage of the viewport (20–80). Default 50. */
  drawerWidth?: number
  /** Which edge the drawer anchors to when panelMode is 'drawer'. Default 'right'. */
  drawerPosition?: 'right' | 'left' | 'top' | 'bottom'
  /** Persisted log panel filter preferences. */
  logsFilter?: {
    limit: number | 'all'
    order: 'asc' | 'desc'
    /** Sources hidden from the log view (stored as array, default includes 'system'). */
    disabledSources: string[]
    show: { timestamp: boolean; source: boolean; objects: boolean }
  }
}


/**
 * A form attached to a card, referencing a named workspace-config form
 * and/or declaring an inline card-local form definition.
 *
 * Either `name` (to reference a config-level form) or `schema` (for an inline
 * definition) must be present. When both are given, the inline `schema` takes
 * precedence over the config-level schema, but other config fields (e.g.
 * `data`) still act as the base layer for the merge order.
 */
export interface CardFormAttachment {
  /**
   * Name of a reusable form declared in `KanbanConfig.forms`.
   * When present, the resolved descriptor sources schema/ui/data from config
   * unless overridden by inline fields on this attachment.
   */
  name?: string
  /**
   * Inline JSON Schema for a card-local form.
   * Required when no `name` is provided.
   */
  schema?: Record<string, unknown>
  /** Optional JSON Forms UI schema for layout/rendering hints. */
  ui?: Record<string, unknown>
  /**
   * Optional attachment-level default data merged after the config-level
   * `FormDefinition.data` and before persisted `Card.formData` values.
   */
  data?: Record<string, unknown>
}

/**
 * Per-form persisted data map used in {@link Card.formData} and transport payloads.
 *
 * Keys are resolved form IDs; values are the stored form field records.
 *
 * **Partial-at-rest semantics:** Individual form records may omit fields — they
 * represent only the stored delta, not the full canonical form state. The
 * prepared runtime object (`ResolvedFormDescriptor.initialData`) is always the
 * full canonical shape produced by merging config defaults, attachment defaults,
 * this stored record, and card metadata. String values in stored records may
 * contain `${path}` placeholders that are resolved at preparation time via
 * `prepareFormData()` from `src/shared/formDataPreparation`.
 */
export type CardFormDataMap = Record<string, Record<string, unknown>>


// Kanban types

/**
 * Priority level for a kanban card.
 * Cards are ranked from most urgent (`'critical'`) to least urgent (`'low'`).
 *
 * @example
 * const p: Priority = 'high'
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low'

/**
 * String alias representing a column or status identifier.
 * Corresponds to the `id` field of a {@link KanbanColumn} (e.g. `'backlog'`, `'in-progress'`).
 */
export type FeatureStatus = string

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
}

/**
 * A kanban card with all associated metadata.
 *
 * Cards are persisted as markdown files with YAML frontmatter inside the
 * `.kanban/{status}/` directory structure.
 */
export interface Feature {
  /** Unique identifier for the card (e.g. `'42-build-dashboard'`). */
  id: string
  /** Board this card belongs to. Omitted when only one board exists. */
  boardId?: string
  /** Current column/status of the card. */
  status: FeatureStatus
  /** Priority level of the card. */
  priority: Priority
  /** Assignee name, or `null` if unassigned. */
  assignee: string | null
  /** ISO 8601 due date string, or `null` if no due date is set. */
  dueDate: string | null
  /** ISO 8601 timestamp of when the card was created. */
  created: string
  /** ISO 8601 timestamp of the last modification. */
  modified: string
  /** ISO 8601 timestamp of when the card was moved to done, or `null`. */
  completedAt: string | null
  /** Tags/labels attached to the card. */
  labels: string[]
  /** File paths of attachments associated with the card. */
  attachments: string[]
  /** Discussion comments on the card. */
  comments: Comment[]
  /** Fractional index (base-62) controlling sort order within a column. */
  order: string
  /** Markdown body content of the card. */
  content: string
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
export function getTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return firstLine || 'Untitled'
}

/**
 * Creates a filename-safe slug from a title string.
 *
 * The slug is lowercased, stripped of special characters, limited to 50
 * characters, and falls back to `'feature'` if the result would be empty.
 *
 * @param title - The human-readable title to slugify.
 * @returns A URL/filename-safe slug string.
 *
 * @example
 * generateSlug('Build Dashboard UI')
 * // => 'build-dashboard-ui'
 *
 * @example
 * generateSlug('Hello, World!!!')
 * // => 'hello-world'
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Trim hyphens from start/end
    .slice(0, 50) || 'feature' // Limit length, fallback
}

/**
 * Generates a card filename from an incremental numeric ID and a title.
 *
 * The filename is composed of the ID prefix followed by a slugified title
 * (e.g. `'42-build-dashboard'`).
 *
 * @param id - The numeric card ID.
 * @param title - The human-readable card title.
 * @returns A filename string in the format `'{id}-{slug}'`.
 *
 * @example
 * generateFeatureFilename(42, 'Build Dashboard')
 * // => '42-build-dashboard'
 */
export function generateFeatureFilename(id: number, title: string): string {
  const slug = generateSlug(title)
  return `${id}-${slug}`
}

/**
 * Extracts the numeric ID prefix from a filename or card ID string.
 *
 * Looks for a leading sequence of digits optionally followed by a hyphen
 * (e.g. `'42-build-dashboard'` yields `42`).
 *
 * @param filenameOrId - A filename or card ID string such as `'42-build-dashboard'`.
 * @returns The parsed numeric ID, or `null` if no numeric prefix is found.
 *
 * @example
 * extractNumericId('42-build-dashboard')
 * // => 42
 *
 * @example
 * extractNumericId('no-number')
 * // => null
 */
export function extractNumericId(filenameOrId: string): number | null {
  const match = filenameOrId.match(/^(\d+)(?:-|$)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Definition of a kanban board column.
 */
export interface KanbanColumn {
  /** Unique identifier used as the card status value (e.g. `'in-progress'`). */
  id: string
  /** Human-readable column name displayed in the UI (e.g. `'In Progress'`). */
  name: string
  /** CSS color string for the column header (e.g. `'#f59e0b'`). */
  color: string
}

/**
 * The default set of five kanban columns provided when no custom columns
 * are configured: Backlog, To Do, In Progress, Review, and Done.
 *
 * @example
 * // Use as the initial column configuration
 * const config = { columns: [...DEFAULT_COLUMNS] }
 */
export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
]

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
  /** Whether to use a compact card layout with reduced spacing. */
  compactMode: boolean
  /** Whether to use the markdown editor when editing card content. */
  markdownEditorMode: boolean
  /** The default priority assigned to newly created cards. */
  defaultPriority: Priority
  /** The default column/status assigned to newly created cards. */
  defaultStatus: string
}

/**
 * YAML frontmatter fields stored at the top of each card's markdown file.
 *
 * These fields are parsed from and serialized back to the frontmatter block
 * when reading/writing card files.
 */
export interface FeatureFrontmatter {
  /** Unique card identifier. */
  id: string
  /** Current column/status of the card. */
  status: string
  /** Priority level of the card. */
  priority: Priority
  /** Assignee name, or `null` if unassigned. */
  assignee: string | null
  /** ISO 8601 due date, or `null` if none. */
  dueDate: string | null
  /** ISO 8601 creation timestamp. */
  created: string
  /** ISO 8601 last-modified timestamp. */
  modified: string
  /** ISO 8601 completion timestamp, or `null` if not completed. */
  completedAt: string | null
  /** Tags/labels attached to the card. */
  labels: string[]
  /** File paths of attachments. */
  attachments: string[]
  /** Fractional index (base-62) for ordering within a column. */
  order: string
}

// Messages between extension and webview
export type ExtensionMessage =
  | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; boards?: BoardInfo[]; currentBoard?: string }
  | { type: 'featuresUpdated'; features: Feature[] }
  | { type: 'triggerCreateDialog' }
  | { type: 'featureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter; comments: Comment[] }
  | { type: 'showSettings'; settings: CardDisplaySettings }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'createFeature'; data: { status: string; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[] } }
  | { type: 'moveFeature'; featureId: string; newStatus: string; newOrder: number }
  | { type: 'deleteFeature'; featureId: string }
  | { type: 'updateFeature'; featureId: string; updates: Partial<Feature> }
  | { type: 'openFeature'; featureId: string }
  | { type: 'saveFeatureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter }
  | { type: 'closeFeature' }
  | { type: 'openFile'; featureId: string }
  | { type: 'addAttachment'; featureId: string }
  | { type: 'openAttachment'; featureId: string; attachment: string }
  | { type: 'removeAttachment'; featureId: string; attachment: string }
  | { type: 'openSettings' }
  | { type: 'saveSettings'; settings: CardDisplaySettings }
  | { type: 'addColumn'; column: { name: string; color: string } }
  | { type: 'editColumn'; columnId: string; updates: { name: string; color: string } }
  | { type: 'removeColumn'; columnId: string }
  | { type: 'addComment'; featureId: string; author: string; content: string }
  | { type: 'updateComment'; featureId: string; commentId: string; content: string }
  | { type: 'deleteComment'; featureId: string; commentId: string }
  | { type: 'switchBoard'; boardId: string }
  | { type: 'createBoard'; name: string }
  | { type: 'transferCard'; featureId: string; toBoard: string; targetStatus: string }

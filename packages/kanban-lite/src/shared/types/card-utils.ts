import {
  type KanbanColumn,
  type BoardBackgroundMode,
  type BoardBackgroundPreset,
  PLAIN_BOARD_BACKGROUND_PRESETS,
  FANCY_BOARD_BACKGROUND_PRESETS,
  DEFAULT_BOARD_BACKGROUND_MODE,
  DEFAULT_PLAIN_BOARD_BACKGROUND_PRESET,
  DEFAULT_FANCY_BOARD_BACKGROUND_PRESET,
} from './card'

export function getTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return firstLine || 'Untitled'
}

function getMetadataPathValue(metadata: Record<string, unknown> | undefined, path: string): unknown {
  if (!metadata || !path.trim()) return undefined
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    return (current as Record<string, unknown>)[key]
  }, metadata)
}

function stringifyDisplayTitlePrefix(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(item => stringifyDisplayTitlePrefix(item))
      .filter((item): item is string => Boolean(item))
    return parts.length > 0 ? parts.join(', ') : null
  }

  if (typeof value === 'object') {
    const json = JSON.stringify(value)
    return json && json !== '{}' && json !== '[]' ? json : null
  }

  return null
}

/**
 * Evaluates a title template string by replacing `${metadata.key}` and `${title}`
 * placeholders with their runtime values.
 *
 * @param template - Template string such as `${metadata.company}: ${title}`.
 * @param content - Raw markdown card content (used to extract the base title).
 * @param metadata - Optional card metadata object.
 * @returns Rendered title string.
 */
export function evaluateTitleTemplate(
  template: string,
  content: string,
  metadata?: Record<string, unknown>,
): string {
  const baseTitle = getTitleFromContent(content)
  const result = template.replace(/\$\{(title|metadata\.[^}]+)\}/g, (_, key: string) => {
    if (key === 'title') return baseTitle
    const metaKey = key.slice('metadata.'.length)
    return stringifyDisplayTitlePrefix(getMetadataPathValue(metadata, metaKey)) ?? ''
  })
  return result.trim() || baseTitle
}

/**
 * Returns the user-visible card title for a board by prefixing selected
 * metadata values ahead of the raw markdown-derived title.
 *
 * This helper is display-only. It does **not** modify stored markdown,
 * filename generation, or rename behavior.
 *
 * @param content - Raw markdown card content.
 * @param metadata - Optional card metadata object.
 * @param titleFields - Ordered metadata keys whose non-empty rendered values should prefix the title.
 * @param titleTemplate - Optional template string (e.g. `${metadata.company}: ${title}`). Takes precedence over `titleFields` when provided.
 * @returns The raw markdown title, optionally prefixed by configured metadata values.
 *
 * @example
 * getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42', sprint: 'Q1' }, ['ticket', 'sprint'])
 * // => 'REL-42 Q1 Ship release'
 *
 * @example
 * getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42' }, ['missing', 'ticket'])
 * // => 'REL-42 Ship release'
 */
export function getDisplayTitleFromContent(
  content: string,
  metadata?: Record<string, unknown>,
  titleFields?: readonly string[],
  titleTemplate?: string,
): string {
  const title = getTitleFromContent(content)

  if (titleTemplate) {
    return evaluateTitleTemplate(titleTemplate, content, metadata)
  }

  if (!titleFields || titleFields.length === 0) {
    return title
  }

  const prefixes = titleFields
    .map(field => stringifyDisplayTitlePrefix(getMetadataPathValue(metadata, field)))
    .filter((value): value is string => Boolean(value))

  return prefixes.length > 0 ? `${prefixes.join(' ')} ${title}` : title
}

/**
 * Creates a filename-safe slug from a title string.
 *
 * The slug is lowercased, stripped of special characters, limited to 50
 * characters, and falls back to `'card'` if the result would be empty.
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
    .slice(0, 50) || 'card' // Limit length, fallback
}

/**
 * Converts a stable form key such as `'bug-report'` into a human-friendly
 * display name such as `'Bug Report'`.
 *
 * This is used as the default display name for reusable config-backed forms
 * when `FormDefinition.name` is omitted.
 *
 * @param formKey - Stable config form key or resolved form identifier.
 * @returns A human-readable title-cased name.
 */
export function formatFormDisplayName(formKey: string): string {
  const normalized = formKey
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()

  if (!normalized) return formKey

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
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
 * generateCardFilename(42, 'Build Dashboard')
 * // => '42-build-dashboard'
 */
export function generateCardFilename(id: number, title: string): string {
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

const DEFAULT_COLUMN_DEFINITIONS = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
] as const satisfies readonly KanbanColumn[]

/**
 * Returns a shallow object clone for each provided board column.
 *
 * Use this before mutating column arrays so separate boards/config objects do
 * not share the same nested column objects by reference.
 */
export function cloneKanbanColumns(columns: readonly KanbanColumn[]): KanbanColumn[] {
  return columns.map((column) => ({ ...column }))
}

/**
 * Returns a fresh copy of the built-in default kanban columns.
 */
export function createDefaultColumns(): KanbanColumn[] {
  return cloneKanbanColumns(DEFAULT_COLUMN_DEFINITIONS)
}

/**
 * The default set of five kanban columns provided when no custom columns
 * are configured: Backlog, To Do, In Progress, Review, and Done.
 *
 * @example
 * // Use as the initial column configuration
 * const config = { columns: createDefaultColumns() }
 */
export const DEFAULT_COLUMNS: KanbanColumn[] = createDefaultColumns()


export function getDefaultBoardBackgroundPreset(mode: BoardBackgroundMode): BoardBackgroundPreset {
  return mode === 'plain' ? DEFAULT_PLAIN_BOARD_BACKGROUND_PRESET : DEFAULT_FANCY_BOARD_BACKGROUND_PRESET
}

export function isBoardBackgroundPresetForMode(mode: BoardBackgroundMode, preset: BoardBackgroundPreset): boolean {
  return mode === 'plain'
    ? (PLAIN_BOARD_BACKGROUND_PRESETS as readonly string[]).includes(preset)
    : (FANCY_BOARD_BACKGROUND_PRESETS as readonly string[]).includes(preset)
}

export function normalizeBoardBackgroundSettings(
  mode?: BoardBackgroundMode,
  preset?: BoardBackgroundPreset,
): { boardBackgroundMode: BoardBackgroundMode; boardBackgroundPreset: BoardBackgroundPreset } {
  const boardBackgroundMode = mode ?? DEFAULT_BOARD_BACKGROUND_MODE
  const boardBackgroundPreset = preset && isBoardBackgroundPresetForMode(boardBackgroundMode, preset)
    ? preset
    : getDefaultBoardBackgroundPreset(boardBackgroundMode)

  return { boardBackgroundMode, boardBackgroundPreset }
}


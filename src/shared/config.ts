import * as fs from 'fs'
import * as path from 'path'
import type { KanbanColumn, CardDisplaySettings, Priority } from './types'
import { DEFAULT_COLUMNS } from './types'

/**
 * A registered webhook endpoint that receives event notifications.
 *
 * Webhooks are stored in the workspace `.kanban.json` config file and
 * are fired asynchronously whenever a matching event occurs.
 */
export interface Webhook {
  /** Unique identifier (e.g., `'wh_a1b2c3d4e5f6'`). */
  id: string
  /** The HTTP(S) URL that receives POST requests with event payloads. */
  url: string
  /** Event names to subscribe to (e.g., `['task.created']`), or `['*']` for all events. */
  events: string[]
  /** Optional HMAC-SHA256 signing key for payload verification. */
  secret?: string
  /** Whether this webhook is active. Inactive webhooks are skipped during delivery. */
  active: boolean
}

/**
 * Configuration for a single kanban board.
 *
 * Each board has its own set of columns, card ID counter, and default
 * status/priority values. Boards are stored as entries in the
 * {@link KanbanConfig.boards} record.
 */
export interface BoardConfig {
  /** Human-readable name of the board. */
  name: string
  /** Optional description of the board's purpose. */
  description?: string
  /** Ordered list of columns displayed on this board. */
  columns: KanbanColumn[]
  /** Next auto-increment card ID to allocate for this board. */
  nextCardId: number
  /** Default column/status for newly created cards on this board. */
  defaultStatus: string
  /** Default priority for newly created cards on this board. */
  defaultPriority: Priority
}

/**
 * Root configuration object for the kanban workspace (v2 format).
 *
 * Supports multiple boards via the {@link boards} record. When read from
 * disk, v1 configs are automatically migrated to this v2 format.
 * Persisted as `.kanban.json` in the workspace root.
 */
export interface KanbanConfig {
  /** Schema version, always `2` for the current format. */
  version: 2
  /** Map of board IDs to their configurations. */
  boards: Record<string, BoardConfig>
  /** ID of the board to use when none is explicitly specified. */
  defaultBoard: string
  /** Directory (relative to workspace root) where card files are stored. */
  featuresDirectory: string
  /** AI agent identifier used for the "Build with AI" feature. */
  aiAgent: string
  /** Global default priority for new cards (used as fallback). */
  defaultPriority: Priority
  /** Global default status/column for new cards (used as fallback). */
  defaultStatus: string
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
  /** Port number for the standalone HTTP server. */
  port: number
  /** Registered webhook endpoints for event notifications. */
  webhooks?: Webhook[]
}

// Legacy v1 config (for migration)
interface KanbanConfigV1 {
  version?: 1
  featuresDirectory: string
  defaultPriority: Priority
  defaultStatus: string
  columns: KanbanColumn[]
  aiAgent: string
  nextCardId: number
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
}

const DEFAULT_BOARD_CONFIG: BoardConfig = {
  name: 'Default',
  columns: [...DEFAULT_COLUMNS],
  nextCardId: 1,
  defaultStatus: 'backlog',
  defaultPriority: 'medium'
}

/**
 * Default configuration used when no `.kanban.json` file exists or when
 * fields are missing from an existing config. Includes a single `'default'`
 * board with the standard five columns.
 */
export const DEFAULT_CONFIG: KanbanConfig = {
  version: 2,
  boards: {
    default: { ...DEFAULT_BOARD_CONFIG, columns: [...DEFAULT_COLUMNS] }
  },
  defaultBoard: 'default',
  featuresDirectory: '.kanban',
  aiAgent: 'claude',
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  port: 3000
}

/**
 * The filename used for the kanban configuration file: `'.kanban.json'`.
 */
export const CONFIG_FILENAME = '.kanban.json'

/**
 * Returns the absolute path to the `.kanban.json` config file for a workspace.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns Absolute path to the config file.
 *
 * @example
 * configPath('/home/user/my-project')
 * // => '/home/user/my-project/.kanban.json'
 */
export function configPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CONFIG_FILENAME)
}

function migrateConfigV1ToV2(raw: Record<string, unknown>): KanbanConfig {
  const v1Defaults: KanbanConfigV1 = {
    featuresDirectory: '.kanban',
    defaultPriority: 'medium',
    defaultStatus: 'backlog',
    columns: [...DEFAULT_COLUMNS],
    aiAgent: 'claude',
    nextCardId: 1,
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: true,
    showLabels: true,
    showBuildWithAI: true,
    showFileName: false,
    compactMode: false,
    markdownEditorMode: false
  }
  const v1 = { ...v1Defaults, ...raw } as KanbanConfigV1
  return {
    version: 2,
    boards: {
      default: {
        name: 'Default',
        columns: v1.columns,
        nextCardId: v1.nextCardId,
        defaultStatus: v1.defaultStatus,
        defaultPriority: v1.defaultPriority
      }
    },
    defaultBoard: 'default',
    featuresDirectory: v1.featuresDirectory,
    aiAgent: v1.aiAgent,
    defaultPriority: v1.defaultPriority,
    defaultStatus: v1.defaultStatus,
    showPriorityBadges: v1.showPriorityBadges,
    showAssignee: v1.showAssignee,
    showDueDate: v1.showDueDate,
    showLabels: v1.showLabels,
    showBuildWithAI: v1.showBuildWithAI,
    showFileName: v1.showFileName,
    compactMode: v1.compactMode,
    markdownEditorMode: v1.markdownEditorMode,
    port: 3000
  }
}

/**
 * Reads the kanban config from disk. If the file is missing or unreadable,
 * returns the default config. If the file contains a v1 config, it is
 * automatically migrated to v2 format and persisted back to disk.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns The parsed (and possibly migrated) kanban configuration.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * console.log(config.defaultBoard) // => 'default'
 */
export function readConfig(workspaceRoot: string): KanbanConfig {
  const filePath = configPath(workspaceRoot)
  const defaults = { ...DEFAULT_CONFIG, boards: { default: { ...DEFAULT_BOARD_CONFIG, columns: [...DEFAULT_COLUMNS] } } }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!raw.version || raw.version === 1) {
      // Migrate v1 to v2 and persist
      const v2 = migrateConfigV1ToV2(raw)
      writeConfig(workspaceRoot, v2)
      return v2
    }
    // Merge with defaults for any missing fields
    const config = { ...defaults, ...raw }
    // Ensure boards object exists with at least default board
    if (!config.boards || Object.keys(config.boards).length === 0) {
      config.boards = defaults.boards
    }
    return config
  } catch {
    return defaults
  }
}

/**
 * Writes the kanban config to disk as pretty-printed JSON.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param config - The kanban configuration to persist.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * config.defaultBoard = 'sprint-1'
 * writeConfig('/home/user/my-project', config)
 */
export function writeConfig(workspaceRoot: string, config: KanbanConfig): void {
  const filePath = configPath(workspaceRoot)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Returns the default board ID from the workspace config.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @returns The default board ID string (e.g. `'default'`).
 *
 * @example
 * const boardId = getDefaultBoardId('/home/user/my-project')
 * // => 'default'
 */
export function getDefaultBoardId(workspaceRoot: string): string {
  const config = readConfig(workspaceRoot)
  return config.defaultBoard
}

/**
 * Returns the configuration for a specific board. If `boardId` is omitted,
 * the default board is used.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param boardId - Optional board ID. Defaults to the workspace's default board.
 * @returns The board configuration object.
 * @throws {Error} If the resolved board ID does not exist in the config.
 *
 * @example
 * const board = getBoardConfig('/home/user/my-project', 'sprint-1')
 * console.log(board.name) // => 'Sprint 1'
 *
 * @example
 * // Uses default board
 * const board = getBoardConfig('/home/user/my-project')
 */
export function getBoardConfig(workspaceRoot: string, boardId?: string): BoardConfig {
  const config = readConfig(workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) {
    throw new Error(`Board '${resolvedId}' not found`)
  }
  return board
}

/**
 * Allocates the next card ID for a board by reading and incrementing the
 * board's `nextCardId` counter. The updated config is persisted to disk.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param boardId - Optional board ID. Defaults to the workspace's default board.
 * @returns The newly allocated numeric card ID.
 * @throws {Error} If the resolved board ID does not exist in the config.
 *
 * @example
 * const id = allocateCardId('/home/user/my-project')
 * // => 1 (first call), 2 (second call), etc.
 */
export function allocateCardId(workspaceRoot: string, boardId?: string): number {
  const config = readConfig(workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) {
    throw new Error(`Board '${resolvedId}' not found`)
  }
  const id = board.nextCardId
  board.nextCardId = id + 1
  writeConfig(workspaceRoot, config)
  return id
}

/**
 * Synchronizes the board's `nextCardId` counter to be greater than all
 * existing card IDs. This prevents ID collisions when cards have been
 * created outside the normal allocation flow (e.g. manual file creation).
 *
 * Does nothing if `existingIds` is empty or the counter is already ahead.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param boardId - The board ID to synchronize.
 * @param existingIds - Array of numeric card IDs currently present on the board.
 *
 * @example
 * syncCardIdCounter('/home/user/my-project', 'default', [1, 5, 12])
 * // Board's nextCardId is now at least 13
 */
export function syncCardIdCounter(workspaceRoot: string, boardId: string, existingIds: number[]): void {
  if (existingIds.length === 0) return
  const maxId = Math.max(...existingIds)
  const config = readConfig(workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) return
  if (board.nextCardId <= maxId) {
    board.nextCardId = maxId + 1
    writeConfig(workspaceRoot, config)
  }
}

/**
 * Extracts {@link CardDisplaySettings} from a {@link KanbanConfig} by
 * picking out the global display-related fields.
 *
 * @param config - The kanban configuration to extract settings from.
 * @returns A `CardDisplaySettings` object with the current display preferences.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * const settings = configToSettings(config)
 * console.log(settings.compactMode) // => false
 */
export function configToSettings(config: KanbanConfig): CardDisplaySettings {
  return {
    showPriorityBadges: config.showPriorityBadges,
    showAssignee: config.showAssignee,
    showDueDate: config.showDueDate,
    showLabels: config.showLabels,
    showBuildWithAI: config.showBuildWithAI,
    showFileName: config.showFileName,
    compactMode: config.compactMode,
    markdownEditorMode: config.markdownEditorMode,
    defaultPriority: config.defaultPriority,
    defaultStatus: config.defaultStatus
  }
}

/**
 * Merges {@link CardDisplaySettings} back into a {@link KanbanConfig},
 * returning a new config object with the display fields updated.
 *
 * @param config - The existing kanban configuration to update.
 * @param settings - The display settings to merge into the config.
 * @returns A new `KanbanConfig` with the display settings applied.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * const updated = settingsToConfig(config, { ...configToSettings(config), compactMode: true })
 * writeConfig('/home/user/my-project', updated)
 */
export function settingsToConfig(config: KanbanConfig, settings: CardDisplaySettings): KanbanConfig {
  return {
    ...config,
    showPriorityBadges: settings.showPriorityBadges,
    showAssignee: settings.showAssignee,
    showDueDate: settings.showDueDate,
    showLabels: settings.showLabels,
    showFileName: settings.showFileName,
    compactMode: settings.compactMode,
    defaultPriority: settings.defaultPriority,
    defaultStatus: settings.defaultStatus
  }
}

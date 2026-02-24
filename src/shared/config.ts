import * as fs from 'fs'
import * as path from 'path'
import type { KanbanColumn, CardDisplaySettings, Priority } from './types'
import { DEFAULT_COLUMNS } from './types'

// Per-board configuration
export interface BoardConfig {
  name: string
  description?: string
  columns: KanbanColumn[]
  nextCardId: number
  defaultStatus: string
  defaultPriority: Priority
}

// V2 config with multi-board support
export interface KanbanConfig {
  version: 2
  boards: Record<string, BoardConfig>
  defaultBoard: string
  featuresDirectory: string
  aiAgent: string
  // Global display settings (fallback defaults for defaultPriority/defaultStatus)
  defaultPriority: Priority
  defaultStatus: string
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
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
  markdownEditorMode: false
}

export const CONFIG_FILENAME = '.kanban.json'

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
    markdownEditorMode: v1.markdownEditorMode
  }
}

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

export function writeConfig(workspaceRoot: string, config: KanbanConfig): void {
  const filePath = configPath(workspaceRoot)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Get the default board ID from config */
export function getDefaultBoardId(workspaceRoot: string): string {
  const config = readConfig(workspaceRoot)
  return config.defaultBoard
}

/** Get board config, using default board if boardId is omitted */
export function getBoardConfig(workspaceRoot: string, boardId?: string): BoardConfig {
  const config = readConfig(workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const board = config.boards[resolvedId]
  if (!board) {
    throw new Error(`Board '${resolvedId}' not found`)
  }
  return board
}

/** Read and increment the nextCardId counter for a board, returning the allocated ID */
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

/** Ensure nextCardId is ahead of all existing numeric IDs for a board */
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

/** Extract CardDisplaySettings from a KanbanConfig (global settings + fallback defaults) */
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

/** Merge CardDisplaySettings back into a KanbanConfig */
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

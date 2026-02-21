import * as fs from 'fs'
import * as path from 'path'
import type { KanbanColumn, CardDisplaySettings, Priority, FeatureStatus } from './types'

export interface KanbanConfig {
  featuresDirectory: string
  defaultPriority: Priority
  defaultStatus: FeatureStatus
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

export const DEFAULT_CONFIG: KanbanConfig = {
  featuresDirectory: '.kanban',
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  columns: [
    { id: 'backlog', name: 'Backlog', color: '#6b7280' },
    { id: 'todo', name: 'To Do', color: '#3b82f6' },
    { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
    { id: 'review', name: 'Review', color: '#8b5cf6' },
    { id: 'done', name: 'Done', color: '#22c55e' }
  ],
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

export const CONFIG_FILENAME = '.kanban.json'

export function configPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CONFIG_FILENAME)
}

export function readConfig(workspaceRoot: string): KanbanConfig {
  const filePath = configPath(workspaceRoot)
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfig(workspaceRoot: string, config: KanbanConfig): void {
  const filePath = configPath(workspaceRoot)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Read and increment the nextCardId counter, returning the allocated ID */
export function allocateCardId(workspaceRoot: string): number {
  const config = readConfig(workspaceRoot)
  const id = config.nextCardId
  writeConfig(workspaceRoot, { ...config, nextCardId: id + 1 })
  return id
}

/** Ensure nextCardId is ahead of all existing numeric IDs */
export function syncCardIdCounter(workspaceRoot: string, existingIds: number[]): void {
  if (existingIds.length === 0) return
  const maxId = Math.max(...existingIds)
  const config = readConfig(workspaceRoot)
  if (config.nextCardId <= maxId) {
    writeConfig(workspaceRoot, { ...config, nextCardId: maxId + 1 })
  }
}

/** Extract CardDisplaySettings from a KanbanConfig */
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

import { readConfig, writeConfig, configToSettings, settingsToConfig } from '../../shared/config'
import type { CardDisplaySettings } from '../../shared/types'
import type { SDKContext } from './context'

// --- Settings management ---

/**
 * Returns the global card display settings for the workspace.
 */
export function getSettings(ctx: SDKContext): CardDisplaySettings {
  return configToSettings(readConfig(ctx.workspaceRoot))
}

/**
 * Updates the global card display settings for the workspace.
 */
export function updateSettings(ctx: SDKContext, { settings }: { settings: CardDisplaySettings }): void {
  const config = readConfig(ctx.workspaceRoot)
  writeConfig(ctx.workspaceRoot, settingsToConfig(config, settings))
}

/**
 * Sets the default board for the workspace.
 */
export function setDefaultBoard(ctx: SDKContext, { boardId }: { boardId: string }): void {
  const config = readConfig(ctx.workspaceRoot)
  if (!config.boards[boardId]) throw new Error(`Board not found: ${boardId}`)
  config.defaultBoard = boardId
  writeConfig(ctx.workspaceRoot, config)
}

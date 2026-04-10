import * as path from 'path'
import { loadWorkspaceEnv } from '../env'
import {
  ConfigRepositoryProviderError,
  readConfigRepositoryDocument,
  writeConfigRepositoryDocument,
  type ConfigRepositoryReadResult,
} from '../../sdk/modules/configRepository'
import type { KanbanColumn, CardDisplaySettings, CardViewMode, Priority, LabelDefinition } from '../types'
import { DEFAULT_BOARD_BACKGROUND_MODE, createDefaultColumns, getDefaultBoardBackgroundPreset, normalizeBoardBackgroundSettings } from '../types'
import type {
  ReadConfigOptions, ProviderRef, Webhook, BoardConfig, FormDefinition, KanbanConfig, BoardMetaFieldDef,
} from './types'

const VALID_BOARD_PRIORITIES: readonly Priority[] = ['critical', 'high', 'medium', 'low']

// Legacy v1 config (for migration)
interface KanbanConfigV1 {
  version?: 1
  kanbanDirectory: string
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
  /** @deprecated replaced by `cardViewMode` */
  compactMode?: boolean
  markdownEditorMode: boolean
}

const DEFAULT_BOARD_CONFIG: BoardConfig = {
  name: 'Default',
  columns: createDefaultColumns(),
  nextCardId: 1,
  defaultStatus: 'backlog',
  defaultPriority: 'medium'
}

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasRawBoardsRecord(value: unknown): value is Record<string, unknown> {
  return isConfigRecord(value)
}

function isKanbanColumnRecord(value: unknown): value is KanbanColumn {
  return isConfigRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.color === 'string'
}

function isBoardConfigRecord(value: unknown): value is BoardConfig {
  return isConfigRecord(value)
    && typeof value.name === 'string'
    && Array.isArray(value.columns)
    && value.columns.every(isKanbanColumnRecord)
    && typeof value.nextCardId === 'number'
    && typeof value.defaultStatus === 'string'
    && typeof value.defaultPriority === 'string'
    && VALID_BOARD_PRIORITIES.includes(value.defaultPriority as Priority)
}

function resolveBoardsConfig(
  rawBoards: unknown,
  defaults: KanbanConfig['boards'],
): KanbanConfig['boards'] {
  if (!hasRawBoardsRecord(rawBoards)) {
    return defaults
  }

  const entries = Object.entries(rawBoards)
  if (entries.length === 0) {
    return defaults
  }

  const boards = entries.every(([, board]) => isBoardConfigRecord(board))
    ? Object.fromEntries(entries) as KanbanConfig['boards']
    : defaults

  // Migrate old string[] metadata to Record<string, BoardMetaFieldDef>
  for (const board of Object.values(boards) as BoardConfig[]) {
    if (Array.isArray(board.metadata)) {
      const migrated: Record<string, BoardMetaFieldDef> = {}
      for (const key of board.metadata as unknown as string[]) {
        migrated[key] = { highlighted: true }
      }
      board.metadata = migrated
    }
  }

  return boards
}

/**
 * Default configuration used when no `.kanban.json` file exists or when
 * fields are missing from an existing config. Includes a single `'default'`
 * board with the standard five columns.
 */
export const DEFAULT_CONFIG: KanbanConfig = {
  version: 2,
  boards: {
    default: { ...DEFAULT_BOARD_CONFIG, columns: createDefaultColumns() }
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
  cardViewMode: 'large' as CardViewMode,
  markdownEditorMode: false,
  showDeletedColumn: false,
  boardZoom: 100,
  cardZoom: 100,
  boardBackgroundMode: DEFAULT_BOARD_BACKGROUND_MODE,
  boardBackgroundPreset: getDefaultBoardBackgroundPreset(DEFAULT_BOARD_BACKGROUND_MODE),
  port: 2954,
  drawerPosition: 'right',
  labels: {}
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
    kanbanDirectory: '.kanban',
    defaultPriority: 'medium',
    defaultStatus: 'backlog',
    columns: createDefaultColumns(),
    aiAgent: 'claude',
    nextCardId: 1,
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: true,
    showLabels: true,
    showBuildWithAI: true,
    showFileName: false,
    markdownEditorMode: false
  }
  const v1 = { ...v1Defaults, ...raw } as KanbanConfigV1
  const v2: KanbanConfig = {
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
    kanbanDirectory: v1.kanbanDirectory,
    aiAgent: v1.aiAgent,
    defaultPriority: v1.defaultPriority,
    defaultStatus: v1.defaultStatus,
    nextCardId: v1.nextCardId,
    showPriorityBadges: v1.showPriorityBadges,
    showAssignee: v1.showAssignee,
    showDueDate: v1.showDueDate,
    showLabels: v1.showLabels,
    showBuildWithAI: v1.showBuildWithAI,
    showFileName: v1.showFileName,
    cardViewMode: (v1.compactMode ? 'normal' : 'large') as CardViewMode,
    markdownEditorMode: v1.markdownEditorMode,
    showDeletedColumn: false,
    boardZoom: 100,
    cardZoom: 100,
    boardBackgroundMode: DEFAULT_BOARD_BACKGROUND_MODE,
    boardBackgroundPreset: getDefaultBoardBackgroundPreset(DEFAULT_BOARD_BACKGROUND_MODE),
    port: 2954
  }
  // Preserve modern fields that may exist even in legacy configs
  // (e.g. webhooks manually added before upgrading, or partially-upgraded configs)
  const modernPassthroughKeys = [
    'webhooks', 'webhookPlugin', 'labels', 'forms', 'plugins', 'auth',
    'storageEngine', 'sqlitePath', 'panelMode', 'drawerWidth', 'drawerPosition', 'logsFilter',
    'boardBackgroundMode', 'boardBackgroundPreset',
    'actionWebhookUrl', 'showDeletedColumn', 'boardZoom', 'cardZoom', 'columnWidth', 'port'
  ]
  const passthrough = v2 as unknown as Record<string, unknown>
  for (const key of modernPassthroughKeys) {
    if (raw[key] !== undefined) {
      passthrough[key] = raw[key]
    }
  }
  return v2
}

/**
 * Recursively resolves `${VAR_NAME}` placeholders in all string values of a
 * parsed config object against `process.env`. Mutates the object in place.
 *
 * Throws a descriptive error when a referenced environment variable is not
 * set, including the JSON path to the offending value so the operator can
 * locate it quickly. Example error message:
 *
 * ```
 * missing ALICE_PASSWORD_HASH in .kanban.json: .plugins."auth.identity".options.users[3].password "${ALICE_PASSWORD_HASH}"
 * ```
 *
 * Keys that contain non-identifier characters (e.g. dots) are quoted in the
 * path segment, matching the convention used in `.kanban.json` error messages.
 *
 * @param node - The current node to process (object, array, string, or scalar).
 * @param configFileName - Config filename used in error messages (e.g. `'.kanban.json'`).
 * @param nodePath - JSON path accumulated so far (empty string at root).
 * @returns The processed node (same reference for objects/arrays; new primitive for strings).
 */
function resolveConfigEnvVars(node: unknown, configFileName: string, nodePath = ''): unknown {
  const isFormDefaultDataPath = /^\.forms\.(?:[^.]+|"[^"]+")\.data(?:$|[.[])/.test(nodePath)
  const isCallbackInlineSourcePath = /^\.plugins\."callback\.runtime"\.options\.handlers\[\d+\]\.source$/.test(nodePath)

  if (isFormDefaultDataPath || isCallbackInlineSourcePath) {
    return node
  }

  if (typeof node === 'string') {
    return node.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName]
      if (envValue === undefined) {
        throw new Error(
          `missing ${varName} in ${configFileName}: ${nodePath} "${node}"`
        )
      }
      return envValue
    })
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = resolveConfigEnvVars(node[i], configFileName, `${nodePath}[${i}]`)
    }
    return node
  }
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const jsonKey = /[^a-zA-Z0-9_]/.test(key) ? `"${key}"` : key
      const childPath = nodePath ? `${nodePath}.${jsonKey}` : `.${jsonKey}`
      obj[key] = resolveConfigEnvVars(obj[key], configFileName, childPath)
    }
    return obj
  }
  return node
}

function createConfigReadError(
  readResult: Extract<ConfigRepositoryReadResult, { status: 'error' }>,
): Error {
  const action = readResult.reason === 'parse' ? 'parse' : 'read'
  if (readResult.cause instanceof ConfigRepositoryProviderError) {
    return new Error(
      `Configuration error: Failed to ${action} workspace config at '${readResult.filePath}' via config.storage provider '${readResult.cause.providerId}'. ${readResult.cause.message}`,
    )
  }

  const causeMessage = readResult.cause instanceof Error
    ? readResult.cause.message
    : String(readResult.cause)
  return new Error(
    `Configuration error: Failed to ${action} workspace config at '${readResult.filePath}'. ${causeMessage}`,
  )
}

/**
 * Reads the kanban config from the shared repository. If the config is
 * missing, returns the default config. If the repository/provider reports a
 * read or parse failure, throws a configuration error instead of silently
 * falling back to defaults. If the file contains a v1 config, it is
 * automatically migrated to v2 format and persisted back to disk.
 *
 * Any `${VAR_NAME}` placeholders found in string values are resolved against
 * `process.env` before the config is returned. If a referenced environment
 * variable is not set the process will throw a descriptive error rather than
 * silently falling back to defaults, because an unresolved secret is never a
 * safe default.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param options - Optional runtime read flags. Generic callers should use the
 *   default fail-closed behavior; control-plane/bootstrap paths may opt into
 *   seed fallback on provider errors.
 * @returns The parsed (and possibly migrated) kanban configuration.
 *
 * @example
 * const config = readConfig('/home/user/my-project')
 * console.log(config.defaultBoard) // => 'default'
 */
export function readConfig(workspaceRoot: string, options: ReadConfigOptions = {}): KanbanConfig {
  const defaults = {
    ...DEFAULT_CONFIG,
    boards: { default: { ...DEFAULT_BOARD_CONFIG, columns: createDefaultColumns() } },
    labels: { ...(DEFAULT_CONFIG.labels ?? {}) },
  }

  // Missing config still falls back to defaults. Repository/provider failures
  // must stay fail-closed so explicit config.storage overrides surface cleanly.
  const readResult = readConfigRepositoryDocument(
    workspaceRoot,
    options.allowSeedFallbackOnProviderError
      ? { allowSeedFallbackOnProviderError: true }
      : undefined,
  )
  if (readResult.status === 'missing') {
    return defaults
  }
  if (readResult.status === 'error') {
    throw createConfigReadError(readResult)
  }
  const raw = readResult.value

  // Load .env from workspace root before resolving placeholders so that
  // variables defined there are available without requiring the operator to
  // export them in their shell.
  loadWorkspaceEnv(workspaceRoot)

  // Resolve ${VAR_NAME} env placeholders. A missing env variable is a known,
  // operator-caused misconfiguration and should produce a clean, actionable
  // error rather than a Node.js stack trace.
  try {
    resolveConfigEnvVars(raw, CONFIG_FILENAME)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`\nConfiguration error: ${msg}\n\nSet the missing environment variable before starting the server.\n\n`)
    process.exit(1)
  }

  try {
    // True v1: explicitly version 1, OR version absent AND no boards object
    // A versionless modern config (has a boards object) must NOT be treated as v1
    const isV1 = raw.version === 1 || (raw.version == null && !hasRawBoardsRecord(raw.boards))
    if (isV1) {
      // Migrate v1 to v2 and persist
      const v2 = migrateConfigV1ToV2(raw)
      writeConfig(workspaceRoot, v2)
      return v2
    }
    // Merge with defaults for any missing fields
    const config: KanbanConfig = {
      ...defaults,
      ...raw,
      version: 2,
      boards: resolveBoardsConfig(raw.boards, defaults.boards),
    }
    // Ensure boards object exists with at least default board
    if (!config.boards || Object.keys(config.boards).length === 0) {
      config.boards = defaults.boards
    }
    // Migrate: if global nextCardId is missing, derive it from per-board counters
    if (!config.nextCardId || config.nextCardId < 1) {
      const boardMaxes = Object.values(config.boards as Record<string, BoardConfig>)
        .map((b) => b.nextCardId || 1)
      config.nextCardId = Math.max(...boardMaxes)
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
  const writeResult = writeConfigRepositoryDocument(workspaceRoot, config)
  if (writeResult.status === 'ok') return
  throw writeResult.cause
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
  if (!config.boards[resolvedId]) {
    throw new Error(`Board '${resolvedId}' not found`)
  }
  const id = config.nextCardId
  config.nextCardId = id + 1
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
  if (config.nextCardId <= maxId) {
    config.nextCardId = maxId + 1
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
 * console.log(settings.cardViewMode) // => 'large'
 */
export function configToSettings(config: KanbanConfig): CardDisplaySettings {
  const background = normalizeBoardBackgroundSettings(config.boardBackgroundMode, config.boardBackgroundPreset)

  return {
    showPriorityBadges: config.showPriorityBadges,
    showAssignee: config.showAssignee,
    showDueDate: config.showDueDate,
    showLabels: config.showLabels,
    showBuildWithAI: config.showBuildWithAI,
    showFileName: config.showFileName,
    cardViewMode: config.cardViewMode ?? 'large',
    markdownEditorMode: config.markdownEditorMode,
    showDeletedColumn: config.showDeletedColumn,
    defaultPriority: config.defaultPriority,
    defaultStatus: config.defaultStatus,
    boardZoom: config.boardZoom ?? 100,
    cardZoom: config.cardZoom ?? 100,
    columnWidth: config.columnWidth,
    boardBackgroundMode: background.boardBackgroundMode,
    boardBackgroundPreset: background.boardBackgroundPreset,
    panelMode: config.panelMode,
    drawerWidth: config.drawerWidth,
    drawerPosition: config.drawerPosition,
    logsFilter: config.logsFilter
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
 * const updated = settingsToConfig(config, { ...configToSettings(config), cardViewMode: 'normal' })
 * writeConfig('/home/user/my-project', updated)
 */
export function settingsToConfig(config: KanbanConfig, settings: CardDisplaySettings): KanbanConfig {
  const background = normalizeBoardBackgroundSettings(settings.boardBackgroundMode, settings.boardBackgroundPreset)

  return {
    ...config,
    showPriorityBadges: settings.showPriorityBadges,
    showAssignee: settings.showAssignee,
    showDueDate: settings.showDueDate,
    showLabels: settings.showLabels,
    showBuildWithAI: settings.showBuildWithAI,
    showFileName: settings.showFileName,
    cardViewMode: settings.cardViewMode,
    markdownEditorMode: settings.markdownEditorMode,
    showDeletedColumn: settings.showDeletedColumn,
    defaultPriority: settings.defaultPriority,
    defaultStatus: settings.defaultStatus,
    boardZoom: settings.boardZoom,
    cardZoom: settings.cardZoom,
    columnWidth: settings.columnWidth,
    boardBackgroundMode: background.boardBackgroundMode,
    boardBackgroundPreset: background.boardBackgroundPreset,
    panelMode: settings.panelMode,
    drawerWidth: settings.drawerWidth,
    drawerPosition: settings.drawerPosition,
    logsFilter: settings.logsFilter
  }
}



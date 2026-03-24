import * as fs from 'fs'
import * as path from 'path'
import type { KanbanColumn, CardDisplaySettings, Priority, LabelDefinition } from './types'
import { DEFAULT_BOARD_BACKGROUND_MODE, DEFAULT_COLUMNS, getDefaultBoardBackgroundPreset, normalizeBoardBackgroundSettings } from './types'

/** Capability namespaces supported by the storage plugin system. */
export type CapabilityNamespace = 'card.storage' | 'attachment.storage'

/** Provider selection for a capability namespace. */
export interface ProviderRef {
  /** Provider id (for built-ins this is e.g. `'markdown'`, `'sqlite'`, `'mysql'`, `'localfs'`). */
  provider: string
  /** Provider-specific configuration passed through to the plugin implementation. */
  options?: Record<string, unknown>
}

/** Partial capability selections from config or constructor overrides. */
export type CapabilitySelections = Partial<Record<CapabilityNamespace, ProviderRef>>

/** Fully normalized capability selections used at runtime. */
export type ResolvedCapabilities = Record<CapabilityNamespace, ProviderRef>

/** Capability namespaces supported by the auth plugin system. */
export type AuthCapabilityNamespace = 'auth.identity' | 'auth.policy'

/** Partial auth capability selections from config or constructor overrides. */
export type AuthCapabilitySelections = Partial<Record<AuthCapabilityNamespace, ProviderRef>>

/** Fully normalized auth capability selections used at runtime. */
export type ResolvedAuthCapabilities = Record<AuthCapabilityNamespace, ProviderRef>

/** Capability namespace for the webhook delivery provider. */
export type WebhookCapabilityNamespace = 'webhook.delivery'

/** Partial webhook capability selections from config or constructor overrides. */
export type WebhookCapabilitySelections = Partial<Record<WebhookCapabilityNamespace, ProviderRef>>

/** Fully normalized webhook capability selections used at runtime. */
export type ResolvedWebhookCapabilities = Record<WebhookCapabilityNamespace, ProviderRef>

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
 * Each board has its own set of columns and default status/priority values.
 * Boards are stored as entries in the {@link KanbanConfig.boards} record.
 */
export interface BoardConfig {
  /** Human-readable name of the board. */
  name: string
  /** Optional description of the board's purpose. */
  description?: string
  /** Ordered list of columns displayed on this board. */
  columns: KanbanColumn[]
  /**
   * @deprecated Card IDs are now allocated from the workspace-level
   * `nextCardId` counter to ensure uniqueness across all boards.
   * This field is kept for backward compatibility with existing config files
   * and is no longer incremented during card creation.
   */
  nextCardId: number
  /** Default column/status for newly created cards on this board. */
  defaultStatus: string
  /** Default priority for newly created cards on this board. */
  defaultPriority: Priority
  /** Named board-level actions available in the toolbar. Map of action key to display title. */
  actions?: Record<string, string>
  /** Metadata keys that are always shown in the card detail panel (before the Advanced section). */
  metadata?: string[]
  /** Column IDs currently minimized (shown as a narrow rail) on this board. */
  minimizedColumnIds?: string[]
}

/**
 * A reusable named form definition stored in the workspace config.
 *
 * When declared under {@link KanbanConfig.forms}, a form is available for
 * attachment to any card on any board in the workspace. Card-local
 * attachments may override or extend these definitions per card.
 *
 * Merge order for initial data (lowest → highest priority):
 * 1. `FormDefinition.data` — workspace-level defaults from this interface
 * 2. `CardFormAttachment.data` — card-scoped attachment defaults
 * 3. `Card.formData[id]` — per-card persisted form data (may be partial at rest)
 * 4. `Card.metadata` — card metadata fields whose keys appear in the schema
 *
 * Sources 1–3 are preprocessed with `${path}` placeholder interpolation against
 * the full card context before the merge. Placeholders that cannot be resolved
 * (missing or `undefined` keys) are replaced with an empty string.
 */
export interface FormDefinition {
  /**
   * Human-readable form name shown in the UI.
   * Defaults to a capitalized version of the form key when omitted.
   */
  name?: string
  /**
   * Optional explanatory text shown in the card form header.
   * Defaults to an empty string.
   */
  description?: string
  /** JSON Schema object describing the data shape for AJV validation. */
  schema: Record<string, unknown>
  /** Optional JSON Forms UI schema for layout/rendering hints. */
  ui?: Record<string, unknown>
  /**
   * Optional default field values applied as the base layer when computing
   * initial form state before card-level data and metadata are merged in.
   */
  data?: Record<string, unknown>
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
  kanbanDirectory: string
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
  /** Whether to show the deleted column in the UI. */
  showDeletedColumn: boolean
  /** Zoom level for the board view (75–150). */
  boardZoom: number
  /** Zoom level for the card detail panel (75–150). */
  cardZoom: number
  /** Whether the board canvas uses a plain or fancy background preset. */
  boardBackgroundMode: import('./types').BoardBackgroundMode
  /** Selected board background preset within the active background mode. */
  boardBackgroundPreset: import('./types').BoardBackgroundPreset
  /** Port number for the standalone HTTP server. */
  port: number
  /** Registered webhook endpoints for event notifications. */
  webhooks?: Webhook[]
  /** Label definitions keyed by label name, with color and optional group. */
  labels?: Record<string, LabelDefinition>
  /** Optional URL to POST to when a card action is triggered. */
  actionWebhookUrl?: string
  /**
   * Global auto-increment card ID counter shared across all boards.
   * Ensures every card gets a unique numeric ID regardless of which board
   * it is created on.
   */
  nextCardId: number
  /** Whether panels open as a centered popup or a right-side drawer. */
  panelMode?: 'popup' | 'drawer'
  /** Width of the right-side drawer as a percentage of the viewport (20–80). Default 50. */
  drawerWidth?: number
  /** Persisted log panel filter preferences. */
  logsFilter?: {
    limit: number | 'all'
    order: 'asc' | 'desc'
    disabledSources: string[]
    show: { timestamp: boolean; source: boolean; objects: boolean }
  }
  /**
    * Legacy card-storage selector kept for backward compatibility.
    * - `'markdown'` (default) — cards stored as individual `.md` files
    * - `'sqlite'` — cards/comments stored in a SQLite database file
    *
    * Prefer {@link plugins} for new configuration. When both forms are present,
    * `plugins['card.storage']` takes precedence at runtime.
   */
  storageEngine?: 'markdown' | 'sqlite'
  /**
    * Path to the SQLite database file when `storageEngine` is `'sqlite'`.
   * Relative paths are resolved from the workspace root.
   * @default '.kanban/kanban.db'
    *
    * This field is also kept for backward compatibility. Prefer
    * `plugins['card.storage'].options.sqlitePath` in new configs.
   */
  sqlitePath?: string
  /**
   * Optional capability-based storage provider selections.
   * When present, these override legacy `storageEngine` / `sqlitePath` for the
    * matching namespaces while preserving backward-compatible defaults for any
    * omitted namespaces (`markdown` for `card.storage`, `localfs` for
    * `attachment.storage`).
     *
     * Built-in attachment providers `sqlite` and `mysql` are additive opt-ins.
     * They require the matching `card.storage` provider and do not change the
     * legacy omitted-default behavior, which remains `attachment.storage: localfs`.
     *
     * Auth capabilities (`auth.identity`, `auth.policy`) can also be declared
     * here using the npm package name as the provider id (e.g.
     * `"provider": "kl-auth-plugin"`). When present they take precedence over
     * any value in the legacy {@link auth} key.
   */
  plugins?: CapabilitySelections & AuthCapabilitySelections
  /**
   * Legacy auth provider selections.
   * @deprecated Prefer declaring `auth.identity` and `auth.policy` inside the
   * `plugins` key using the package name as provider id. This field is still
   * supported for backward compatibility but `plugins` takes precedence.
   */
  auth?: AuthCapabilitySelections
  /**
   * Named reusable form definitions available on all boards in the workspace.
   * Cards attach forms by name via {@link Card.forms} and store their own
   * submitted data under {@link Card.formData}.
   *
   * @example
   * { "bug-report": { schema: { type: "object", properties: { title: { type: "string" } } } } }
   */
  forms?: Record<string, import('./config').FormDefinition>
  /**
   * Optional webhook provider selection.
   * When omitted, defaults to `{ provider: 'webhooks' }` at runtime, which maps to the
   * `kl-webhooks-plugin` external package. The persisted `.kanban.json` webhook registry
   * shape (`webhooks` array) is unchanged regardless of which provider is active.
   */
  webhookPlugin?: WebhookCapabilitySelections
}

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
  boardBackgroundMode: DEFAULT_BOARD_BACKGROUND_MODE,
  boardBackgroundPreset: getDefaultBoardBackgroundPreset(DEFAULT_BOARD_BACKGROUND_MODE),
  port: 2954,
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
    compactMode: v1.compactMode,
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
    'storageEngine', 'sqlitePath', 'panelMode', 'drawerWidth', 'logsFilter',
    'boardBackgroundMode', 'boardBackgroundPreset',
    'actionWebhookUrl', 'showDeletedColumn', 'boardZoom', 'cardZoom', 'port'
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
    // True v1: explicitly version 1, OR version absent AND no boards object
    // A versionless modern config (has a boards object) must NOT be treated as v1
    const isV1 = raw.version === 1 || (!raw.version && !(typeof raw.boards === 'object' && raw.boards !== null && !Array.isArray(raw.boards)))
    if (isV1) {
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
 * console.log(settings.compactMode) // => true
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
    compactMode: config.compactMode,
    markdownEditorMode: config.markdownEditorMode,
    showDeletedColumn: config.showDeletedColumn,
    defaultPriority: config.defaultPriority,
    defaultStatus: config.defaultStatus,
    boardZoom: config.boardZoom ?? 100,
    cardZoom: config.cardZoom ?? 100,
    boardBackgroundMode: background.boardBackgroundMode,
    boardBackgroundPreset: background.boardBackgroundPreset,
    panelMode: config.panelMode,
    drawerWidth: config.drawerWidth,
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
 * const updated = settingsToConfig(config, { ...configToSettings(config), compactMode: true })
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
    showFileName: settings.showFileName,
    compactMode: settings.compactMode,
    showDeletedColumn: settings.showDeletedColumn,
    defaultPriority: settings.defaultPriority,
    defaultStatus: settings.defaultStatus,
    boardZoom: settings.boardZoom,
    cardZoom: settings.cardZoom,
    boardBackgroundMode: background.boardBackgroundMode,
    boardBackgroundPreset: background.boardBackgroundPreset,
    panelMode: settings.panelMode,
    drawerWidth: settings.drawerWidth,
    logsFilter: settings.logsFilter
  }
}

function cloneProviderRef(ref: ProviderRef): ProviderRef {
  return ref.options !== undefined
    ? { provider: ref.provider, options: { ...ref.options } }
    : { provider: ref.provider }
}

/**
 * Normalizes auth capability selections into a complete runtime capability map.
 *
 * Omitted auth providers default to the `noop` compatibility ids. When the
 * external `kl-auth-plugin` package is installed those ids resolve there;
 * otherwise core keeps a built-in compatibility fallback so behavior is
 * unchanged when auth is not configured.
 *
 * The input object is never mutated.
 */
export function normalizeAuthCapabilities(
  config: Pick<KanbanConfig, 'auth' | 'plugins'>,
): ResolvedAuthCapabilities {
  return {
    'auth.identity': config.plugins?.['auth.identity']
      ? cloneProviderRef(config.plugins['auth.identity'])
      : config.auth?.['auth.identity']
        ? cloneProviderRef(config.auth['auth.identity'])
        : { provider: 'noop' },
    'auth.policy': config.plugins?.['auth.policy']
      ? cloneProviderRef(config.plugins['auth.policy'])
      : config.auth?.['auth.policy']
        ? cloneProviderRef(config.auth['auth.policy'])
        : { provider: 'noop' },
  }
}

/**
 * Normalizes legacy storage settings plus capability-based plugin selections
 * into a complete runtime capability map.
 *
 * Precedence:
 * 1. Explicit `plugins[namespace]`
 * 2. Legacy `storageEngine` / `sqlitePath` for `card.storage`
 * 3. Backward-compatible defaults (`markdown` + `localfs`)
 *
 * Explicit built-in `attachment.storage` providers such as `sqlite` and
 * `mysql` remain opt-in. Omitting `attachment.storage` never auto-switches
 * it away from the legacy `localfs` default.
 *
 * The input object is never mutated.
 */
export function normalizeStorageCapabilities(
  config: Pick<KanbanConfig, 'storageEngine' | 'sqlitePath' | 'plugins'>,
): ResolvedCapabilities {
  const legacyCardProvider: ProviderRef = config.storageEngine === 'sqlite'
    ? {
        provider: 'sqlite',
        options: { sqlitePath: config.sqlitePath ?? '.kanban/kanban.db' },
      }
    : { provider: 'markdown' }

  return {
    'card.storage': config.plugins?.['card.storage']
      ? cloneProviderRef(config.plugins['card.storage'])
      : legacyCardProvider,
    'attachment.storage': config.plugins?.['attachment.storage']
      ? cloneProviderRef(config.plugins['attachment.storage'])
      : { provider: 'localfs' },
  }
}

/**
 * Normalizes webhook capability selections into a complete runtime capability map.
 *
 * When no explicit provider is configured, defaults to `{ provider: 'webhooks' }`, which
 * maps to the `kl-webhooks-plugin` external package via `WEBHOOK_PROVIDER_ALIASES`.
 * The built-in webhook delivery path remains active as a compatibility fallback when
 * the external package is absent.
 *
 * The input object is never mutated.
 */
export function normalizeWebhookCapabilities(
  config: Pick<KanbanConfig, 'webhookPlugin'>,
): ResolvedWebhookCapabilities {
  return {
    'webhook.delivery': config.webhookPlugin?.['webhook.delivery']
      ? cloneProviderRef(config.webhookPlugin['webhook.delivery'])
      : { provider: 'webhooks' },
  }
}

import type { BoardInfo } from '../../shared/types'
import type { BoardConfig, KanbanConfig } from '../../shared/config'
import type { LabelDefinition } from '../../shared/types'
import type { FormDefinition } from '../../shared/config/types'
import { readConfig, writeConfig, getBoardConfig } from '../../shared/config'
import type { SDKContext } from './context'

// --- Payload types ---

interface WorkspaceExportFragment {
  labels?: Record<string, LabelDefinition>
  forms?: Record<string, FormDefinition>
  plugins?: {
    'webhook.delivery'?: KanbanConfig['plugins'] extends Record<string, infer V> | undefined ? V : unknown
    'callback.runtime'?: KanbanConfig['plugins'] extends Record<string, infer V> | undefined ? V : unknown
    'cron.runtime'?: KanbanConfig['plugins'] extends Record<string, infer V> | undefined ? V : unknown
  }
  webhookPlugin?: KanbanConfig['webhookPlugin']
  webhooks?: KanbanConfig['webhooks']
}

/**
 * Versioned board-settings archive produced by {@link exportBoardSettings}.
 * Contains board config plus board-relevant workspace fragments.
 */
export interface BoardSettingsExportV1 {
  kind: 'kanban-lite.board-settings'
  version: 1
  exportedAt: string
  board: {
    id: string
    config: BoardConfig
  }
  workspace: WorkspaceExportFragment
}

// --- Export ---

/**
 * Exports the settings for a board as a versioned JSON-safe archive.
 *
 * The payload includes the full board config plus labels, forms, and
 * hook-related workspace fragments (`webhook.delivery`, `callback.runtime`,
 * `cron.runtime`, `webhookPlugin`, `webhooks`).
 *
 * Card content, comments, attachments, and logs are not included.
 */
export function exportBoardSettings(
  ctx: SDKContext,
  { boardId }: { boardId?: string } = {},
): BoardSettingsExportV1 {
  const config = readConfig(ctx.workspaceRoot)
  const resolvedId = boardId || config.defaultBoard
  const boardConfig = getBoardConfig(ctx.workspaceRoot, resolvedId)

  const workspaceFragment: WorkspaceExportFragment = {}

  if (config.labels && Object.keys(config.labels).length > 0) {
    workspaceFragment.labels = structuredClone(config.labels)
  }

  if (config.forms && Object.keys(config.forms).length > 0) {
    workspaceFragment.forms = structuredClone(config.forms)
  }

  const pluginFragment: WorkspaceExportFragment['plugins'] = {}
  const plugins = config.plugins ?? {}

  if (plugins['webhook.delivery']) {
    pluginFragment['webhook.delivery'] = structuredClone(plugins['webhook.delivery'])
  }
  if (plugins['callback.runtime']) {
    pluginFragment['callback.runtime'] = structuredClone(plugins['callback.runtime'])
  }
  if (plugins['cron.runtime']) {
    pluginFragment['cron.runtime'] = structuredClone(plugins['cron.runtime'])
  }

  if (Object.keys(pluginFragment).length > 0) {
    workspaceFragment.plugins = pluginFragment
  }

  if (config.webhookPlugin) {
    workspaceFragment.webhookPlugin = structuredClone(config.webhookPlugin)
  }

  if (config.webhooks && config.webhooks.length > 0) {
    workspaceFragment.webhooks = structuredClone(config.webhooks)
  }

  return {
    kind: 'kanban-lite.board-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    board: {
      id: resolvedId,
      config: structuredClone(boardConfig),
    },
    workspace: workspaceFragment,
  }
}

// --- Validation ---

function validateExportPayload(payload: unknown): asserts payload is BoardSettingsExportV1 {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Import failed: payload must be a JSON object')
  }

  const p = payload as Record<string, unknown>

  if (p.kind !== 'kanban-lite.board-settings') {
    throw new Error(`Import failed: unsupported archive kind "${String(p.kind)}"`)
  }

  if (p.version !== 1) {
    throw new Error(`Import failed: unsupported archive version "${String(p.version)}"`)
  }

  if (!p.board || typeof p.board !== 'object') {
    throw new Error('Import failed: missing or invalid "board" field')
  }

  const board = p.board as Record<string, unknown>

  if (typeof board.id !== 'string' || !board.id) {
    throw new Error('Import failed: missing board.id')
  }

  if (!board.config || typeof board.config !== 'object') {
    throw new Error('Import failed: missing or invalid board.config')
  }

  const boardConfig = board.config as Record<string, unknown>

  if (!boardConfig.name || typeof boardConfig.name !== 'string') {
    throw new Error('Import failed: board.config.name must be a non-empty string')
  }

  if (!Array.isArray(boardConfig.columns)) {
    throw new Error('Import failed: board.config.columns must be an array')
  }
}

// --- Import ---

/**
 * Imports a board-settings archive produced by {@link exportBoardSettings}.
 *
 * By default, importing a board whose ID already exists throws an error.
 * Pass `{ overwrite: true }` to replace the existing board's config.
 *
 * Workspace fragments (labels, forms, hook-related plugin config, webhooks)
 * are merged into the existing config without touching unrelated global
 * settings such as storage or auth.
 *
 * @throws If the payload fails validation or the board already exists
 *   (unless `overwrite` is true).
 */
export function importBoardSettings(
  ctx: SDKContext,
  {
    payload,
    options,
  }: {
    payload: unknown
    options?: { overwrite?: boolean }
  },
): BoardInfo {
  validateExportPayload(payload)

  const { board: { id: boardId, config: boardConfig }, workspace } = payload

  const config = readConfig(ctx.workspaceRoot)

  if (config.boards[boardId] && !options?.overwrite) {
    throw new Error(`Board already exists: ${boardId}`)
  }

  // Write board config
  config.boards[boardId] = structuredClone(boardConfig) as BoardConfig

  // Merge workspace fragments
  if (workspace) {
    if (workspace.labels) {
      config.labels = { ...(config.labels ?? {}), ...structuredClone(workspace.labels) }
    }

    if (workspace.forms) {
      config.forms = { ...(config.forms ?? {}), ...structuredClone(workspace.forms) }
    }

    if (workspace.plugins) {
      config.plugins = config.plugins ?? {}
      const plugins = workspace.plugins as Record<string, unknown>
      for (const key of ['webhook.delivery', 'callback.runtime', 'cron.runtime'] as const) {
        if (plugins[key] !== undefined) {
          (config.plugins as Record<string, unknown>)[key] = structuredClone(plugins[key])
        }
      }
    }

    if (workspace.webhookPlugin) {
      config.webhookPlugin = structuredClone(workspace.webhookPlugin)
    }

    if (workspace.webhooks) {
      config.webhooks = structuredClone(workspace.webhooks)
    }
  }

  writeConfig(ctx.workspaceRoot, config)

  return {
    id: boardId,
    name: (boardConfig as BoardConfig).name,
    description: (boardConfig as BoardConfig).description,
    columns: (boardConfig as BoardConfig).columns,
    actions: (boardConfig as BoardConfig).actions,
    metadata: (boardConfig as BoardConfig).metadata,
    title: (boardConfig as BoardConfig).title,
    titleTemplate: (boardConfig as BoardConfig).titleTemplate,
    forms: config.forms,
  }
}

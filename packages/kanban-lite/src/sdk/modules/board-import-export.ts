import type { BoardInfo, Card, CardTask, CardFormAttachment, CardFormDataMap, Priority } from '../../shared/types'
import type { BoardConfig, KanbanConfig } from '../../shared/config'
import type { LabelDefinition } from '../../shared/types'
import type { FormDefinition } from '../../shared/config/types'
import { readConfig, writeConfig, getBoardConfig } from '../../shared/config'
import { DELETED_STATUS_ID } from '../../shared/types'
import type { SDKContext } from './context'
import { listCardsRaw, createCard } from './cards/crud'
import { permanentlyDeleteCard } from './cards/actions'

// --- Payload types ---

const SECRET_KEY_PATTERN = /(secret|token|password|passphrase|private[-_]?key|client[-_]?secret|secret[-_]?key|session[-_]?token|api[-_]?key)/i
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry))
  }

  if (!isRecord(value)) return structuredClone(value)

  const redacted: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue
    redacted[key] = redactSecrets(entry)
  }
  return redacted
}

function validateNoUnsafeObjectKeys(value: unknown, path = 'payload'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoUnsafeObjectKeys(entry, `${path}[${index}]`))
    return
  }

  if (!isRecord(value)) return

  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      throw new Error(`Import failed: unsafe object key "${key}" at ${path}`)
    }
    validateNoUnsafeObjectKeys(entry, `${path}.${key}`)
  }
}

/**
 * Card data snapshot included in a board export.
 * Captures all fields needed to recreate the card on import.
 * File attachments (binary blobs) are listed by filename but not embedded.
 */
export interface CardExportEntry {
  content: string
  status: string
  priority: Priority
  assignee: string | null
  dueDate: string | null
  labels: string[]
  attachments: string[]
  tasks?: CardTask[]
  metadata?: Record<string, unknown>
  actions?: string[] | Record<string, string>
  forms?: CardFormAttachment[]
  formData?: CardFormDataMap
}

/**
 * Versioned board-settings archive produced by {@link exportBoardSettings}.
 * Contains board config, board-relevant workspace fragments, and card data.
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
  cards?: CardExportEntry[]
}

// --- Export ---

/**
 * Exports the settings for a board as a versioned JSON-safe archive.
 *
 * The payload includes the full board config, labels, forms,
 * hook-related workspace fragments (`webhook.delivery`, `callback.runtime`,
 * `cron.runtime`, `webhookPlugin`, `webhooks`), and all non-deleted card data.
 *
 * File attachment blobs are not embedded — only filenames are listed.
 */
export async function exportBoardSettings(
  ctx: SDKContext,
  { boardId }: { boardId?: string } = {},
): Promise<BoardSettingsExportV1> {
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
    pluginFragment['webhook.delivery'] = redactSecrets(plugins['webhook.delivery']) as typeof pluginFragment['webhook.delivery']
  }
  if (plugins['callback.runtime']) {
    pluginFragment['callback.runtime'] = redactSecrets(plugins['callback.runtime']) as typeof pluginFragment['callback.runtime']
  }
  if (plugins['cron.runtime']) {
    pluginFragment['cron.runtime'] = redactSecrets(plugins['cron.runtime']) as typeof pluginFragment['cron.runtime']
  }

  if (Object.keys(pluginFragment).length > 0) {
    workspaceFragment.plugins = pluginFragment
  }

  if (config.webhookPlugin) {
    workspaceFragment.webhookPlugin = redactSecrets(config.webhookPlugin) as KanbanConfig['webhookPlugin']
  }

  if (config.webhooks && config.webhooks.length > 0) {
    workspaceFragment.webhooks = redactSecrets(config.webhooks) as KanbanConfig['webhooks']
  }

  // Export all non-deleted cards
  const rawCards = await listCardsRaw(ctx, { boardId: resolvedId })
  const cards: CardExportEntry[] = rawCards
    .filter(c => c.status !== DELETED_STATUS_ID)
    .map((c: Card): CardExportEntry => ({
      content: c.content,
      status: c.status,
      priority: c.priority,
      assignee: c.assignee,
      dueDate: c.dueDate,
      labels: c.labels,
      attachments: c.attachments,
      ...(c.tasks && c.tasks.length > 0 ? { tasks: structuredClone(c.tasks) } : {}),
      ...(c.metadata && Object.keys(c.metadata).length > 0 ? { metadata: structuredClone(c.metadata) } : {}),
      ...(c.actions ? { actions: structuredClone(c.actions) } : {}),
      ...(c.forms && c.forms.length > 0 ? { forms: structuredClone(c.forms) } : {}),
      ...(c.formData && Object.keys(c.formData).length > 0 ? { formData: structuredClone(c.formData) } : {}),
    }))

  return {
    kind: 'kanban-lite.board-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    board: {
      id: resolvedId,
      config: structuredClone(boardConfig),
    },
    workspace: workspaceFragment,
    ...(cards.length > 0 ? { cards } : {}),
  }
}

// --- Validation ---

function validateExportPayload(payload: unknown): asserts payload is BoardSettingsExportV1 {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Import failed: payload must be a JSON object')
  }

  validateNoUnsafeObjectKeys(payload)

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
 * Pass `{ overwrite: true }` to replace the existing board's config and cards.
 * In overwrite mode all existing non-deleted cards are permanently removed
 * before the exported cards are recreated.
 *
 * In merge mode (default) exported cards are appended alongside existing ones.
 *
 * Workspace fragments (labels, forms, hook-related plugin config, webhooks)
 * are merged into the existing config without touching unrelated global
 * settings such as storage or auth.
 *
 * @throws If the payload fails validation or the board already exists
 *   (unless `overwrite` is true).
 */
export async function importBoardSettings(
  ctx: SDKContext,
  {
    payload,
    options,
  }: {
    payload: unknown
    options?: { overwrite?: boolean }
  },
): Promise<BoardInfo> {
  validateExportPayload(payload)

  const { board: { id: boardId, config: boardConfig }, workspace, cards } = payload

  const config = readConfig(ctx.workspaceRoot)

  if (config.boards[boardId] && !options?.overwrite) {
    throw new Error(`Board already exists: ${boardId}`)
  }

  // In overwrite mode, permanently delete all existing non-deleted cards
  if (options?.overwrite && config.boards[boardId]) {
    const existingCards = await listCardsRaw(ctx, { boardId })
    await Promise.all(
      existingCards
        .filter(c => c.status !== DELETED_STATUS_ID)
        .map(c => permanentlyDeleteCard(ctx, { cardId: c.id, boardId })),
    )
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

  // Re-create exported cards
  if (Array.isArray(cards) && cards.length > 0) {
    for (const entry of cards as CardExportEntry[]) {
      await createCard(ctx, {
        content: entry.content,
        status: entry.status,
        priority: entry.priority,
        assignee: entry.assignee,
        dueDate: entry.dueDate,
        labels: entry.labels ?? [],
        attachments: entry.attachments ?? [],
        ...(entry.tasks ? { tasks: entry.tasks } : {}),
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
        ...(entry.actions ? { actions: entry.actions } : {}),
        ...(entry.forms ? { forms: entry.forms } : {}),
        boardId,
      })
    }
  }

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

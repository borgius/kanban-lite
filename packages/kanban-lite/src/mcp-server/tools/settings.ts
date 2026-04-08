import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { AuthError } from '../../sdk/types'
import { readConfig } from '../../shared/config'
import { type McpToolContext } from '../../sdk/plugins'
import {
  createMcpErrorResult,
  type McpAuthRunner,
  type McpToolRegistrar,
} from '../shared'
import {
  registerCardStateMcpTools,
  registerChecklistMcpTools,
  registerPluginMcpTools,
  registerPluginSettingsMcpTools,
} from '../registrars'

export function registerSettingsMcpTools(
  server: McpServer,
  sdk: KanbanSDK,
  runWithMcpAuth: McpAuthRunner,
  getMcpAuthStatus: () => unknown,
  workspaceRoot: string,
  kanbanDir: string,
  mcpPluginContext: McpToolContext,
): void {
  // --- Column Tools ---

  server.tool(
    'list_columns',
    'List all kanban board columns.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ boardId }) => {
      const columns = await sdk.listColumns(boardId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(columns, null, 2),
        }],
      }
    }
  )

  server.tool(
    'add_column',
    'Add a new column to the kanban board.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      id: z.string().describe('Unique column ID (used in card status field)'),
      name: z.string().describe('Display name for the column'),
      color: z.string().describe('Column color (hex format, e.g. "#3b82f6")'),
    },
    async ({ boardId, id, name, color }) => {
      try {
        const columns = await runWithMcpAuth(() => sdk.addColumn({ id, name, color }, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify(columns, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'update_column',
    'Update an existing kanban board column.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      columnId: z.string().describe('Column ID to update'),
      name: z.string().optional().describe('New display name'),
      color: z.string().optional().describe('New color (hex format)'),
    },
    async ({ boardId, columnId, name, color }) => {
      const updates: Record<string, string> = {}
      if (name) updates.name = name
      if (color) updates.color = color
      try {
        const columns = await runWithMcpAuth(() => sdk.updateColumn(columnId, updates, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify(columns, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'remove_column',
    'Remove a column from the kanban board. Fails if any cards are in the column.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      columnId: z.string().describe('Column ID to remove'),
    },
    async ({ boardId, columnId }) => {
      try {
        const columns = await runWithMcpAuth(() => sdk.removeColumn(columnId, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(columns, null, 2),
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'reorder_columns',
    'Reorder columns on a board by providing the full ordered list of column IDs.',
    {
      columnIds: z.array(z.string()).describe('Complete ordered list of all column IDs for the board.'),
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ columnIds, boardId }) => {
      try {
        const columns = await runWithMcpAuth(() => sdk.reorderColumns(columnIds, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify(columns, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'set_minimized_columns',
    'Persist the minimized column IDs for a board to the config file. Pass an empty array to clear all minimized columns.',
    {
      columnIds: z.array(z.string()).describe('Column IDs to mark as minimized. Pass [] to clear.'),
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ columnIds, boardId }) => {
      try {
        const minimized = await runWithMcpAuth(() => sdk.setMinimizedColumns(columnIds, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify({ minimizedColumnIds: minimized }, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'cleanup_column',
    'Move all cards in a column to the deleted (soft-delete) column. The column itself is kept.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      columnId: z.string().describe('Column ID to clean up'),
    },
    async ({ boardId, columnId }) => {
      const moved = await runWithMcpAuth(() => sdk.cleanupColumn(columnId, boardId))
      return {
        content: [{
          type: 'text' as const,
          text: `Moved ${moved} card${moved === 1 ? '' : 's'} from "${columnId}" to deleted`,
        }],
      }
    }
  )

  // --- Label Tools ---

  server.tool('list_labels', 'List all label definitions with colors and groups', {
    boardId: z.string().optional().describe('Board ID')
  }, async () => {
    const labels = sdk.getLabels()
    return { content: [{ type: 'text' as const, text: JSON.stringify(labels, null, 2) }] }
  })

  server.tool('set_label', 'Create or update a label definition', {
    name: z.string().describe('Label name'),
    color: z.string().describe('Hex color (e.g. "#e11d48")'),
    group: z.string().optional().describe('Optional group name (e.g. "Type", "Priority")')
  }, async ({ name, color, group }) => {
    try {
      await runWithMcpAuth(() => sdk.setLabel(name, { color, group }))
      return { content: [{ type: 'text' as const, text: `Label "${name}" set with color ${color}${group ? ` in group "${group}"` : ''}` }] }
    } catch (err) {
      if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  server.tool('rename_label', 'Rename a label (cascades to all cards)', {
    oldName: z.string().describe('Current label name'),
    newName: z.string().describe('New label name')
  }, async ({ oldName, newName }) => {
    await runWithMcpAuth(() => sdk.renameLabel(oldName, newName))
    return { content: [{ type: 'text' as const, text: `Label "${oldName}" renamed to "${newName}"` }] }
  })

  server.tool('delete_label', 'Remove a label definition and remove it from all cards', {
    name: z.string().describe('Label name to remove')
  }, async ({ name }) => {
    await runWithMcpAuth(() => sdk.deleteLabel(name))
    return { content: [{ type: 'text' as const, text: `Label "${name}" definition removed` }] }
  })

  // --- Settings Tools ---

  server.tool(
    'get_settings',
    'Get the current kanban board display settings.',
    {},
    async () => {
      const settings = sdk.getSettings()
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(settings, null, 2),
        }],
      }
    }
  )

  server.tool(
    'update_settings',
    'Update kanban board display settings. Only specified fields are changed.',
    {
      showPriorityBadges: z.boolean().optional().describe('Show priority badges on cards'),
      showAssignee: z.boolean().optional().describe('Show assignee on cards'),
      showDueDate: z.boolean().optional().describe('Show due date on cards'),
      showLabels: z.boolean().optional().describe('Show labels on cards'),
      showFileName: z.boolean().optional().describe('Show file name on cards'),
      cardViewMode: z.enum(['compact', 'normal', 'large', 'xlarge', 'xxlarge']).optional().describe('Card size mode controlling how much detail is shown on each card'),
      showDeletedColumn: z.boolean().optional().describe('Show the deleted cards column on the board'),
      defaultPriority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Default priority for new cards'),
      defaultStatus: z.string().optional().describe('Default status for new cards'),
      boardBackgroundMode: z.enum(['fancy', 'plain']).optional().describe('Whether the board canvas uses fancy or plain presets'),
      boardBackgroundPreset: z.enum(['aurora', 'sunset', 'meadow', 'nebula', 'lagoon', 'candy', 'ember', 'violet', 'paper', 'mist', 'sand']).optional().describe('Selected board background preset'),
    },
    async (updates) => {
      const settings = sdk.getSettings()
      const merged = { ...settings }
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          (merged as unknown as Record<string, unknown>)[key] = value
        }
      }
      try {
        await runWithMcpAuth(() => sdk.updateSettings(merged))
        return { content: [{ type: 'text' as const, text: JSON.stringify(sdk.getSettings(), null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  const toolRegistrar = server as unknown as McpToolRegistrar
  registerPluginSettingsMcpTools(toolRegistrar, {
    sdk,
    runWithAuth: runWithMcpAuth,
  })

  registerChecklistMcpTools(toolRegistrar, {
    sdk,
    runWithAuth: runWithMcpAuth,
  })

  registerPluginMcpTools(
    toolRegistrar,
    readConfig(workspaceRoot),
    mcpPluginContext,
  )

  registerCardStateMcpTools(toolRegistrar, {
    sdk,
    runWithAuth: runWithMcpAuth,
  })

  // --- Workspace Info Tool ---

  server.tool(
    'list_available_events',
    'List discoverable SDK events, including built-in before/after events and any plugin-declared additions. Supports optional phase and wildcard mask filtering.',
    {
      type: z.enum(['before', 'after', 'all']).optional().describe('Optional event phase filter.'),
      mask: z.string().optional().describe('Optional wildcard event mask such as task.* or comment.**.'),
    },
    async ({ type, mask }) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(sdk.listAvailableEvents({ type, mask }), null, 2),
        }],
      }
    }
  )

  server.tool(
    'get_auth_status',
    'Get the active auth providers and host token-source diagnostics for the MCP server.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(getMcpAuthStatus(), null, 2),
        }],
      }
    }
  )

  server.tool(
    'get_workspace_info',
    'Get the workspace root path, cards directory, active storage engine, and configured-versus-effective config.storage status.',
    {},
    async () => {
      const cfg = readConfig(workspaceRoot)
      const storageStatus = sdk.getStorageStatus()
      const providers = storageStatus.providers
        ? {
            'card.storage': storageStatus.providers['card.storage'].provider,
            'attachment.storage': storageStatus.providers['attachment.storage'].provider,
          }
        : null
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workspaceRoot,
            kanbanDir,
            port: cfg.port,
            storageEngine: storageStatus.storageEngine,
            sqlitePath: cfg.sqlitePath ?? null,
            providers,
            configStorage: storageStatus.configStorage,
            isFileBacked: storageStatus.isFileBacked,
            watchGlob: storageStatus.watchGlob,
            auth: getMcpAuthStatus(),
          }, null, 2),
        }],
      }
    }
  )

  // --- Storage Tools ---

  server.tool(
    'get_storage_status',
    'Get the current storage engine type plus configured-versus-effective config.storage status, including explicit failure or degraded state when present.',
    {},
    async () => {
      const cfg = readConfig(workspaceRoot)
      const storageStatus = sdk.getStorageStatus()
      const providers = storageStatus.providers
        ? {
            'card.storage': storageStatus.providers['card.storage'].provider,
            'attachment.storage': storageStatus.providers['attachment.storage'].provider,
          }
        : null
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            storageEngine: storageStatus.storageEngine,
            sqlitePath: cfg.sqlitePath ?? null,
            providers,
            configStorage: storageStatus.configStorage,
            isFileBacked: storageStatus.isFileBacked,
            watchGlob: storageStatus.watchGlob,
          }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'migrate_to_sqlite',
    'Migrate all card data from the current markdown storage to a SQLite database. Updates .kanban.json automatically.',
    {
      sqlitePath: z.string().optional().describe('Path to SQLite database file (default: .kanban/kanban.db). Relative to workspace root.'),
    },
    async ({ sqlitePath }) => {
      try {
        const count = await runWithMcpAuth(() => sdk.migrateToSqlite(sqlitePath))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ok: true, count, storageEngine: 'sqlite' }, null, 2),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'migrate_to_markdown',
    'Migrate all card data from SQLite back to individual markdown files. Updates .kanban.json automatically.',
    {},
    async () => {
      try {
        const count = await runWithMcpAuth(() => sdk.migrateToMarkdown())
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ok: true, count, storageEngine: 'markdown' }, null, 2),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        }
      }
    }
  )

}

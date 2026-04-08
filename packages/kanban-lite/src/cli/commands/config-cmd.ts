import * as path from 'path'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import type { CardDisplaySettings } from '../../shared/types'
import { configPath, readConfig } from '../../shared/config'
import { bold, cyan, dim, green, red } from '../output'
import { findPackageRoot, showDocHelp } from '../help'
import { cmdStorage, cmdPluginSettings } from '../runtime'
import {
  getBoardId,
  getConfigFilePath,
  handleAuthError,
  parseJsonObjectFlag,
  resolveCardId,
  resolveKanbanDirForFlags,
  resolveWorkspaceRootForFlags,
  runWithCliAuth,
  type Flags,
} from '../shared'

export async function cmdColumns(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  switch (subcommand) {
    case 'list': {
      const columns = await sdk.listColumns(boardId)
      if (flags.json) {
        console.log(JSON.stringify(columns, null, 2))
      } else {
        console.log(`  ${dim('ID'.padEnd(20))}  ${dim('NAME'.padEnd(20))}  ${dim('COLOR')}`)
        console.log(dim('  ' + '-'.repeat(50)))
        for (const col of columns) {
          console.log(`  ${bold(col.id.padEnd(20))}  ${col.name.padEnd(20)}  ${col.color}`)
        }
      }
      break
    }
    case 'add': {
      const id = typeof flags.id === 'string' ? flags.id : ''
      const name = typeof flags.name === 'string' ? flags.name : ''
      const color = typeof flags.color === 'string' ? flags.color : '#6b7280'
      if (!id || !name) {
        console.error(red('Usage: kl columns add --id <id> --name <name> [--color <hex>]'))
        process.exit(1)
      }
      const columns = await runWithCliAuth(sdk, flags, () => sdk.addColumn({ id, name, color }, boardId))
      console.log(green(`Added column: ${id} (${name})`))
      if (flags.json) console.log(JSON.stringify(columns, null, 2))
      break
    }
    case 'update': {
      const columnId = positional[1]
      if (!columnId) {
        console.error(red('Usage: kl columns update <id> [--name <name>] [--color <hex>]'))
        process.exit(1)
      }
      const updates: Record<string, string> = {}
      if (typeof flags.name === 'string') updates.name = flags.name
      if (typeof flags.color === 'string') updates.color = flags.color
      if (Object.keys(updates).length === 0) {
        console.error(red('No updates specified. Use --name or --color'))
        process.exit(1)
      }
      const columns = await runWithCliAuth(sdk, flags, () => sdk.updateColumn(columnId, updates, boardId))
      console.log(green(`Updated column: ${columnId}`))
      if (flags.json) console.log(JSON.stringify(columns, null, 2))
      break
    }
    case 'remove':
    case 'rm': {
      const columnId = positional[1]
      if (!columnId) {
        console.error(red('Usage: kl columns remove <id>'))
        process.exit(1)
      }
      const columns = await runWithCliAuth(sdk, flags, () => sdk.removeColumn(columnId, boardId))
      console.log(green(`Removed column: ${columnId}`))
      if (flags.json) console.log(JSON.stringify(columns, null, 2))
      break
    }
    case 'cleanup': {
      const columnId = positional[1]
      if (!columnId) {
        console.error(red('Usage: kl columns cleanup <id>'))
        process.exit(1)
      }
      const moved = await runWithCliAuth(sdk, flags, () => sdk.cleanupColumn(columnId, boardId))
      console.log(green(`Moved ${moved} card${moved === 1 ? '' : 's'} from "${columnId}" to deleted`))
      break
    }
    case 'reorder': {
      const columnIds = positional.slice(1)
      if (columnIds.length === 0) {
        console.error(red('Usage: kl columns reorder <id1> <id2> ...'))
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.reorderColumns(columnIds, boardId))
      console.log(green('Columns reordered.'))
      break
    }
    case 'set-minimized': {
      const columnIds = positional.slice(1)
      await runWithCliAuth(sdk, flags, () => sdk.setMinimizedColumns(columnIds, boardId))
      if (columnIds.length === 0) {
        console.log(green('Cleared all minimized columns.'))
      } else {
        console.log(green(`Minimized columns set: ${columnIds.join(', ')}`))
      }
      break
    }
    default:
      console.error(red(`Unknown columns subcommand: ${subcommand}`))
      console.error('Available: list, add, update, remove, cleanup, reorder, set-minimized')
      process.exit(1)
  }
}

// --- Label Commands ---

export async function cmdLabels(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'

  switch (subcommand) {
    case 'list': {
      const labels = sdk.getLabels()
      if (flags.json) {
        console.log(JSON.stringify(labels, null, 2))
      } else {
        const entries = Object.entries(labels)
        if (entries.length === 0) {
          console.log(dim('  No labels defined.'))
        } else {
          console.log(`  ${dim('NAME'.padEnd(20))}  ${dim('COLOR'.padEnd(10))}  ${dim('GROUP')}`)
          console.log(dim('  ' + '-'.repeat(50)))
          // Sort by group then name
          entries.sort((a, b) => {
            const ga = a[1].group || ''
            const gb = b[1].group || ''
            if (ga !== gb) return ga.localeCompare(gb)
            return a[0].localeCompare(b[0])
          })
          for (const [name, def] of entries) {
            console.log(`  ${bold(name.padEnd(20))}  ${def.color.padEnd(10)}  ${def.group || '-'}`)
          }
        }
      }
      break
    }
    case 'set': {
      const name = positional[1]
      if (!name) {
        console.error(red('Usage: kl labels set <name> --color <hex> [--group <group>]'))
        process.exit(1)
      }
      const color = typeof flags.color === 'string' ? flags.color : ''
      if (!color) {
        console.error(red('Error: --color is required'))
        process.exit(1)
      }
      const group = typeof flags.group === 'string' ? flags.group : undefined
      await runWithCliAuth(sdk, flags, () => sdk.setLabel(name, { color, group }))
      if (flags.json) {
        console.log(JSON.stringify({ name, color, group: group || null }, null, 2))
      } else {
        console.log(green(`Label set: ${name} (${color}${group ? ', group: ' + group : ''})`))
      }
      break
    }
    case 'rename': {
      const oldName = positional[1]
      const newName = positional[2]
      if (!oldName || !newName) {
        console.error(red('Usage: kl labels rename <old> <new>'))
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.renameLabel(oldName, newName))
      if (flags.json) {
        console.log(JSON.stringify({ old: oldName, new: newName }, null, 2))
      } else {
        console.log(green(`Renamed label: ${oldName} → ${newName}`))
      }
      break
    }
    case 'delete':
    case 'rm': {
      const name = positional[1]
      if (!name) {
        console.error(red('Usage: kl labels delete <name>'))
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.deleteLabel(name))
      if (flags.json) {
        console.log(JSON.stringify({ deleted: name }, null, 2))
      } else {
        console.log(green(`Deleted label: ${name}`))
      }
      break
    }
    default:
      console.error(red(`Unknown labels subcommand: ${subcommand}`))
      console.error('Available: list, set, rename, delete')
      process.exit(1)
  }
}

// --- Action Commands ---

export async function cmdAction(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'trigger'

  switch (subcommand) {
    case 'trigger': {
      const cardId = positional[1]
      const action = positional[2]
      if (!cardId || !action) {
        console.error(red('Usage: kl action trigger <cardId> <action> [--board <boardId>]'))
        process.exit(1)
      }
      const boardId = getBoardId(flags)
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.triggerAction(resolvedId, action, boardId))
      console.log(green(`Action "${action}" triggered on card ${resolvedId}`))
      break
    }
    default:
      console.error(red(`Unknown action subcommand: ${subcommand}`))
      console.error('Available: trigger')
      process.exit(1)
  }
}

// --- Settings Commands ---

const SETTINGS_KEYS = [
  'showPriorityBadges', 'showAssignee', 'showDueDate', 'showLabels',
  'showFileName', 'cardViewMode', 'showDeletedColumn', 'defaultPriority', 'defaultStatus',
  'boardBackgroundMode', 'boardBackgroundPreset'
] as const

export async function cmdSettings(positional: string[], flags: Flags, sdk: KanbanSDK): Promise<void> {
  const subcommand = positional[0] || 'show'

  switch (subcommand) {
    case 'show':
    case 'list': {
      const settings = sdk.getSettings()
      if (flags.json) {
        console.log(JSON.stringify(settings, null, 2))
      } else {
        console.log(`  ${dim('SETTING'.padEnd(24))}  ${dim('VALUE')}`)
        console.log(dim('  ' + '-'.repeat(40)))
        for (const key of SETTINGS_KEYS) {
          console.log(`  ${bold(key.padEnd(24))}  ${String(settings[key as keyof CardDisplaySettings])}`)
        }
      }
      break
    }
    case 'update':
    case 'set': {
      const settings = sdk.getSettings()
      let changed = false
      const settingsAny = settings as unknown as Record<string, unknown>
      for (const key of SETTINGS_KEYS) {
        if (typeof flags[key] === 'string') {
          const val = flags[key] as string
          if (val === 'true') {
            settingsAny[key] = true
          } else if (val === 'false') {
            settingsAny[key] = false
          } else {
            settingsAny[key] = val
          }
          changed = true
        }
      }
      if (!changed) {
        console.error(red('No settings specified. Use --<setting> <value>'))
        console.error(`Available: ${SETTINGS_KEYS.join(', ')}`)
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.updateSettings(settings))
      console.log(green('Settings updated.'))
      if (flags.json) {
        console.log(JSON.stringify(sdk.getSettings(), null, 2))
      }
      break
    }
    default:
      console.error(red(`Unknown settings subcommand: ${subcommand}`))
      console.error('Available: show, update')
      process.exit(1)
  }
}

// --- Serve Command ---

export async function cmdMcp(flags: Flags): Promise<void> {
  // Allow --dir flag to override the kanban directory via env var
  // (MCP server reads KANBAN_DIR from process.env and --dir from process.argv)
  if (typeof flags.dir === 'string') {
    process.env.KANBAN_DIR = path.resolve(flags.dir)
  }
  // Importing the MCP server module triggers its top-level main() bootstrap
  await import('../../mcp-server/index')
}

export async function cmdServe(flags: Flags): Promise<void> {
  const workspaceRoot = resolveWorkspaceRootForFlags(flags)
  const dir = resolveKanbanDirForFlags(flags)
  const resolvedConfigFilePath = getConfigFilePath(flags) ?? configPath(workspaceRoot)
  const config = readConfig(workspaceRoot)
  const port = typeof flags.port === 'string' ? parseInt(flags.port, 10) : config.port
  const noBrowser = !!flags['no-browser']

  // Dynamically import the standalone server
  const { startServer } = await import('../../standalone/server')
  const server = startServer(dir, port, undefined, resolvedConfigFilePath)

  if (!noBrowser) {
    server.on('listening', async () => {
      try {
        const open = (await import('open')).default
        open(`http://localhost:${port}`)
      } catch {
        // open is optional
      }
    })
  }

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    server.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    server.close()
    process.exit(0)
  })
}

// --- Main ---


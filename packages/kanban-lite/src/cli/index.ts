import * as fs from 'fs/promises'
import * as path from 'path'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { AuthError } from '../sdk/types'
import { findPackageRoot, showDocHelp, showHelp } from './help'
import { red } from './output'
import { cmdAuth, cmdCardState, cmdPluginSettings, cmdStorage, findCliPlugin, loadCliPlugins, runCliPlugin } from './runtime'
import { getBoardId, handleAuthError, parseArgs, resolveKanbanDirForFlags, resolveWorkspaceRootForFlags } from './shared'
import { cmdEvents, cmdList, cmdActive, cmdShow, cmdAdd, cmdMove, cmdEdit, cmdForm, cmdChecklist, cmdDelete, cmdPermanentDelete } from './commands/cards'
import { cmdInit, cmdBoards, cmdBoardActions, cmdTransfer } from './commands/boards'
import { cmdAttach, cmdComment, cmdLog, cmdBoardLog } from './commands/content'
import { cmdColumns, cmdLabels, cmdAction, cmdSettings, cmdMcp, cmdServe } from './commands/config-cmd'

export { cmdPluginSettings, parseArgs, showHelp }
export { cmdActive, cmdAdd, cmdChecklist, cmdEdit, cmdForm, cmdList } from './commands/cards'
export { cmdColumns, cmdLabels } from './commands/config-cmd'

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv)

  if (command === 'version' || flags.version) {
    const pkgRoot = await findPackageRoot()
    const pkg = JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf-8'))
    console.log(pkg.version)
    return
  }

  if (command === 'help' || flags.help) {
    const topic = command === 'help' ? positional[0] : undefined
    if (topic) {
      await showDocHelp(topic)
    } else {
      showHelp()
    }
    return
  }

  // Serve doesn't need SDK
  if (command === 'serve') {
    await cmdServe(flags)
    return
  }

  // MCP server doesn't need SDK — bootstrapped via its own main()
  if (command === 'mcp') {
    await cmdMcp(flags)
    return
  }

  const workspaceRoot = resolveWorkspaceRootForFlags(flags)
  const kanbanDir = resolveKanbanDirForFlags(flags)
  const cliPlugins = loadCliPlugins(workspaceRoot)
  const sdk = new KanbanSDK(kanbanDir)

  switch (command) {
    case 'list':
    case 'ls':
      await cmdList(sdk, flags)
      break
    case 'active':
      await cmdActive(sdk, flags)
      break
    case 'show':
    case 'view':
      await cmdShow(sdk, positional, flags)
      break
    case 'add':
    case 'create':
    case 'new':
      await cmdAdd(sdk, flags)
      break
    case 'move':
    case 'mv':
      await cmdMove(sdk, positional, flags)
      break
    case 'edit':
    case 'update':
      await cmdEdit(sdk, positional, flags)
      break
    case 'delete':
    case 'rm':
      await cmdDelete(sdk, positional, flags)
      break
    case 'permanent-delete':
    case 'purge':
      await cmdPermanentDelete(sdk, positional, flags)
      break
    case 'boards':
    case 'board':
      await cmdBoards(sdk, positional, flags, workspaceRoot)
      break
    case 'board-actions':
    case 'board-action':
      await cmdBoardActions(sdk, positional, flags)
      break
    case 'transfer':
      await cmdTransfer(sdk, positional, flags)
      break
    case 'attach':
      await cmdAttach(sdk, positional, flags)
      break
    case 'comment':
    case 'comments':
      await cmdComment(sdk, positional, flags)
      break
    case 'log':
    case 'logs':
      await cmdLog(sdk, positional, flags)
      break
    case 'board-log':
    case 'board-logs':
      await cmdBoardLog(sdk, positional, flags)
      break
    case 'columns':
    case 'cols':
      await cmdColumns(sdk, positional, flags)
      break
    case 'labels':
    case 'label':
      await cmdLabels(sdk, positional, flags)
      break
    case 'action':
      await cmdAction(sdk, positional, flags)
      break
    case 'form':
    case 'forms':
      await cmdForm(sdk, positional, flags)
      break
    case 'checklist':
    case 'checklists':
      await cmdChecklist(sdk, positional, flags)
      break
    case 'webhooks':
    case 'webhook':
    case 'wh': {
      const webhookPlugin = findCliPlugin(cliPlugins, command) ?? findCliPlugin(cliPlugins, 'webhooks')
      if (webhookPlugin) {
        await runCliPlugin(webhookPlugin, positional, flags, workspaceRoot, sdk)
      } else {
        console.error(red('Webhook commands require kl-plugin-webhook. Run: npm install kl-plugin-webhook'))
        process.exit(1)
      }
      break
    }
    case 'settings':
      await cmdSettings(positional, flags, sdk)
      break
    case 'pwd':
      if (flags.json) {
        console.log(JSON.stringify({ path: workspaceRoot }))
      } else {
        console.log(workspaceRoot)
      }
      break
    case 'init':
      await cmdInit(sdk)
      break
    case 'events':
    case 'event':
      await cmdEvents(sdk, flags)
      break
    case 'storage':
      await cmdStorage(sdk, positional, flags, workspaceRoot)
      break
    case 'card-state':
    case 'cardstate':
    case 'cs':
      await cmdCardState(sdk, positional, flags)
      break
    case 'auth':
      await cmdAuth(sdk, positional, flags, cliPlugins, workspaceRoot)
      break
    case 'plugin-settings':
      await cmdPluginSettings(sdk, positional, flags)
      break
    default: {
      const fallback = findCliPlugin(cliPlugins, command)
      if (fallback) {
        await runCliPlugin(fallback, positional, flags, workspaceRoot, sdk)
        break
      }
      console.error(red(`Unknown command: ${command}`))
      showHelp()
      process.exit(1)
    }
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch(err => {
    if (err instanceof AuthError) handleAuthError(err)
    console.error(red(`Error: ${err.message}`))
    process.exit(1)
  })
}

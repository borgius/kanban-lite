import { KanbanSDK } from '../../sdk/KanbanSDK'
import { readConfig } from '../../shared/config'
import { AuthError } from '../../sdk/types'
import { bold, colorStatus, cyan, dim, green, red } from '../output'
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

export async function cmdInit(sdk: KanbanSDK): Promise<void> {
  await sdk.init()
  console.log(green(`Initialized: ${sdk.kanbanDir}`))
}

// --- Board Commands ---

export async function cmdBoards(sdk: KanbanSDK, positional: string[], flags: Flags, workspaceRoot: string): Promise<void> {
  const subcommand = positional[0] || 'list'

  switch (subcommand) {
    case 'list': {
      const boards = sdk.listBoards()
      if (flags.json) {
        console.log(JSON.stringify(boards, null, 2))
      } else if (boards.length === 0) {
        console.log(dim('  No boards found.'))
      } else {
        console.log(`  ${dim('ID'.padEnd(20))}  ${dim('NAME'.padEnd(20))}  ${dim('DESCRIPTION')}`)
        console.log(dim('  ' + '-'.repeat(60)))
        for (const b of boards) {
          console.log(`  ${bold(b.id.padEnd(20))}  ${b.name.padEnd(20)}  ${b.description || '-'}`)
        }
      }
      break
    }
    case 'add': {
      const id = typeof flags.id === 'string' ? flags.id : ''
      const name = typeof flags.name === 'string' ? flags.name : ''
      if (!id || !name) {
        console.error(red('Usage: kl boards add --id <id> --name <name> [--description <desc>]'))
        process.exit(1)
      }
      const description = typeof flags.description === 'string' ? flags.description : undefined
      const board = await runWithCliAuth(sdk, flags, () => sdk.createBoard(id, name, { description }))
      if (flags.json) {
        console.log(JSON.stringify(board, null, 2))
      } else {
        console.log(green(`Created board: ${board.id} (${board.name})`))
      }
      break
    }
    case 'show': {
      const boardId = positional[1]
      if (!boardId) {
        console.error(red('Usage: kl boards show <id>'))
        process.exit(1)
      }
      const board = sdk.getBoard(boardId)
      if (flags.json) {
        console.log(JSON.stringify(board, null, 2))
      } else {
        console.log(`${bold(board.name)}`)
        console.log(`  ID:          ${boardId}`)
        if (board.description) console.log(`  Description: ${board.description}`)
        console.log(`  Columns:     ${board.columns.map(c => c.name).join(', ')}`)
        console.log(`  Next Card:   ${board.nextCardId}`)
        console.log(`  Default:     status=${board.defaultStatus}, priority=${board.defaultPriority}`)
      }
      break
    }
    case 'remove':
    case 'rm': {
      const boardId = positional[1]
      if (!boardId) {
        console.error(red('Usage: kl boards remove <id>'))
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.deleteBoard(boardId))
      console.log(green(`Removed board: ${boardId}`))
      break
    }
    case 'default': {
      const boardId = positional[1]
      if (!boardId) {
        const config = readConfig(workspaceRoot)
        console.log(config.defaultBoard)
        break
      }
      try {
        await runWithCliAuth(sdk, flags, () => sdk.setDefaultBoard(boardId))
      } catch (err) {
        if (err instanceof AuthError) handleAuthError(err)
        console.error(red(String(err)))
        process.exit(1)
      }
      console.log(green(`Default board set to: ${boardId}`))
      break
    }
    default:
      console.error(red(`Unknown boards subcommand: ${subcommand}`))
      console.error('Available: list, add, show, remove, default')
      process.exit(1)
  }
}

// --- Board Actions Command ---

export async function cmdBoardActions(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = typeof flags.board === 'string' ? flags.board : undefined

  switch (subcommand) {
    case 'list': {
      const actions = sdk.getBoardActions(boardId)
      if (flags.json) {
        console.log(JSON.stringify(actions, null, 2))
      } else {
        const entries = Object.entries(actions)
        if (entries.length === 0) {
          console.log(dim('  No actions defined.'))
        } else {
          for (const [key, title] of entries) {
            console.log(`  ${bold(key.padEnd(20))}  ${title}`)
          }
        }
      }
      break
    }
    case 'add': {
      const key = typeof flags.key === 'string' ? flags.key : ''
      const title = typeof flags.title === 'string' ? flags.title : ''
      if (!boardId || !key || !title) {
        console.error(red('Usage: kl board-actions add --board <id> --key <key> --title <title>'))
        process.exit(1)
      }
      const result = await runWithCliAuth(sdk, flags, () => sdk.addBoardAction(boardId, key, title))
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(green(`Added action "${key}" to board ${boardId}`))
      }
      break
    }
    case 'remove':
    case 'rm': {
      const key = typeof flags.key === 'string' ? flags.key : (positional[1] ?? '')
      if (!boardId || !key) {
        console.error(red('Usage: kl board-actions remove --board <id> <key>'))
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.removeBoardAction(boardId, key))
      console.log(green(`Removed action "${key}" from board ${boardId}`))
      break
    }
    case 'fire':
    case 'trigger': {
      const key = typeof flags.key === 'string' ? flags.key : (positional[1] ?? '')
      if (!boardId || !key) {
        console.error(red('Usage: kl board-actions fire --board <id> <key>'))
        process.exit(1)
      }
      await runWithCliAuth(sdk, flags, () => sdk.triggerBoardAction(boardId, key))
      console.log(green(`Fired board action "${key}" on board ${boardId}`))
      break
    }
    default:
      console.error(red(`Unknown board-actions subcommand: ${subcommand}`))
      process.exit(1)
  }
}

// --- Transfer Command ---

export async function cmdTransfer(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl transfer <card-id> --from <board> --to <board> [--status <status>]'))
    process.exit(1)
  }

  const fromBoard = typeof flags.from === 'string' ? flags.from : undefined
  const toBoard = typeof flags.to === 'string' ? flags.to : undefined

  if (!fromBoard || !toBoard) {
    console.error(red('Both --from and --to are required'))
    process.exit(1)
  }

  const targetStatus = typeof flags.status === 'string' ? flags.status : undefined
  const resolvedId = await resolveCardId(sdk, cardId, fromBoard, flags)
  const card = await runWithCliAuth(sdk, flags, () => sdk.transferCard(resolvedId, fromBoard, toBoard, targetStatus))
  console.log(green(`Transferred ${card.id} from ${fromBoard} → ${toBoard} (${colorStatus(card.status)})`))
}

// --- Attachment Commands ---


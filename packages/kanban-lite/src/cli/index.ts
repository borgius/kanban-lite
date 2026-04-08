import * as path from 'path'
import * as fs from 'fs/promises'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { buildChecklistReadModel, coerceChecklistSeedTasks, type ChecklistSeedTaskInput } from '../sdk/modules/checklist'
import type { Card, Priority, CardSortOption } from '../shared/types'
import { getDisplayTitleFromContent } from '../shared/types'
import { configPath, readConfig } from '../shared/config'
import type { CardDisplaySettings } from '../shared/types'
import { AuthError } from '../sdk/types'
import {
  bold,
  colorPriority,
  colorStatus,
  cyan,
  dim,
  formatCardDetail,
  formatCardRow,
  green,
  printAvailableEvents,
  printChecklistReadModel,
  red,
} from './output'
import { findPackageRoot, showDocHelp, showHelp } from './help'
import { cmdAuth, cmdCardState, cmdPluginSettings, cmdStorage, findCliPlugin, loadCliPlugins, runCliPlugin } from './runtime'
import {
  getBoardId,
  getConfigFilePath,
  getValidStatuses,
  handleAuthError,
  parseArgs,
  parseJsonArrayFlag,
  parseJsonObjectFlag,
  resolveCardId,
  resolveKanbanDirForFlags,
  resolveWorkspaceRootForFlags,
  runWithCliAuth,
  VALID_PRIORITIES,
  type Flags,
} from './shared'

export { cmdPluginSettings, parseArgs, showHelp }

// --- Formatters ---

function getBoardTitleFieldsForCli(sdk: Pick<KanbanSDK, 'getConfigSnapshot'>, boardId?: string): readonly string[] | undefined {
  const config = sdk.getConfigSnapshot()
  const resolvedBoardId = boardId || config.defaultBoard
  return config.boards[resolvedBoardId]?.title
}

async function cmdEvents(sdk: KanbanSDK, flags: Flags): Promise<void> {
  const type = typeof flags.type === 'string' ? flags.type : undefined
  if (type !== undefined && type !== 'before' && type !== 'after' && type !== 'all') {
    console.error(red('Error: --type must be one of before, after, or all'))
    process.exit(1)
  }

  const mask = typeof flags.mask === 'string' ? flags.mask : undefined
  const events = sdk.listAvailableEvents({
    type: type as 'before' | 'after' | 'all' | undefined,
    mask,
  })

  if (flags.json) {
    console.log(JSON.stringify(events, null, 2))
    return
  }

  printAvailableEvents(events)
}

// --- Card Commands ---

export async function cmdList(sdk: KanbanSDK, flags: Flags): Promise<void> {
  const boardId = getBoardId(flags)
  const boardTitleFields = getBoardTitleFieldsForCli(sdk, boardId)
  const searchQuery = typeof flags.search === 'string' ? flags.search : undefined
  const fuzzy = flags.fuzzy === true

  const metaFilter: Record<string, string> | undefined = Array.isArray(flags.meta) ? (() => {
    const mf: Record<string, string> = {}
    for (const entry of flags.meta as string[]) {
      const eq = entry.indexOf('=')
      if (eq < 1) {
        console.error(red(`Invalid --meta format: "${entry}". Expected key=value`))
        process.exit(1)
      }
      mf[entry.slice(0, eq)] = entry.slice(eq + 1)
    }
    return Object.keys(mf).length > 0 ? mf : undefined
  })() : undefined

  const VALID_SORTS: CardSortOption[] = ['created:asc', 'created:desc', 'modified:asc', 'modified:desc']
  let sortOpt: CardSortOption | undefined
  if (typeof flags.sort === 'string') {
    const sort = flags.sort as CardSortOption
    if (!VALID_SORTS.includes(sort)) {
      console.error(red(`Invalid --sort value: "${sort}". Must be one of: ${VALID_SORTS.join(', ')}`))
      process.exit(1)
    }
    sortOpt = sort
  }

  let cards = await runWithCliAuth(sdk, flags, () => sdk.listCards(undefined, boardId, {
    metaFilter,
    sort: sortOpt,
    searchQuery,
    fuzzy,
  }))

  if (!flags['include-deleted']) {
    cards = cards.filter(c => c.status !== 'deleted')
  }

  if (typeof flags.status === 'string') {
    cards = cards.filter(c => c.status === flags.status)
  }
  if (typeof flags.priority === 'string') {
    cards = cards.filter(c => c.priority === flags.priority)
  }
  if (typeof flags.assignee === 'string') {
    cards = cards.filter(c => c.assignee === flags.assignee)
  }
  if (typeof flags.label === 'string') {
    cards = cards.filter(c => c.labels.includes(flags.label as string))
  }
  if (typeof flags['label-group'] === 'string') {
    const groupLabels = sdk.getLabelsInGroup(flags['label-group'] as string)
    cards = cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
  }

  if (flags.json) {
    console.log(JSON.stringify(cards, null, 2))
    return
  }

  if (cards.length === 0) {
    console.log(dim('  No cards found.'))
    return
  }

  console.log(`  ${dim('ID'.padEnd(30))}  ${dim('STATUS'.padEnd(12))}  ${dim('PRIORITY'.padEnd(8))}  ${dim('ASSIGNEE'.padEnd(12))}  ${dim('TITLE')}`)
  console.log(dim('  ' + '-'.repeat(90)))
  for (const c of cards) {
    console.log(formatCardRow(c, getDisplayTitleFromContent(c.content, c.metadata, boardTitleFields)))
  }
  console.log(dim(`\n  ${cards.length} card(s)`))
}

export async function cmdActive(sdk: KanbanSDK, flags: Flags): Promise<void> {
  const boardId = getBoardId(flags)
  const boardTitleFields = getBoardTitleFieldsForCli(sdk, boardId)
  const card = await runWithCliAuth(sdk, flags, () => sdk.getActiveCard(boardId))

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
    return
  }

  if (!card) {
    console.log(dim('  No active card.'))
    return
  }

  console.log(formatCardDetail(card, getDisplayTitleFromContent(card.content, card.metadata, boardTitleFields)))
}

async function cmdShow(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Error: card ID required. Usage: kl show <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const boardTitleFields = getBoardTitleFieldsForCli(sdk, boardId)
  const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
  const card = await runWithCliAuth(sdk, flags, () => sdk.getCard(resolvedId, boardId))
  if (!card) {
    console.error(red(`Card not found: ${cardId}`))
    process.exit(1)
  }

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
  } else {
    console.log(formatCardDetail(card, getDisplayTitleFromContent(card.content, card.metadata, boardTitleFields)))
  }
}

export async function cmdAdd(sdk: KanbanSDK, flags: Flags): Promise<void> {
  const title = typeof flags.title === 'string' ? flags.title : ''
  if (!title) {
    console.error(red('Error: --title is required. Usage: kl add --title "My card"'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const status = typeof flags.status === 'string' ? flags.status : undefined
  if (status) {
    const validStatuses = await getValidStatuses(sdk, boardId)
    if (!validStatuses.includes(status)) {
      console.error(red(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`))
      process.exit(1)
    }
  }

  const priority = (typeof flags.priority === 'string' ? flags.priority : 'medium') as Priority
  if (!VALID_PRIORITIES.includes(priority)) {
    console.error(red(`Invalid priority: ${priority}. Must be one of: ${VALID_PRIORITIES.join(', ')}`))
    process.exit(1)
  }

  const assignee = typeof flags.assignee === 'string' ? flags.assignee : null
  const dueDate = typeof flags.due === 'string' ? flags.due : null
  const labels = typeof flags.label === 'string' ? flags.label.split(',').map(l => l.trim()) : []
  const body = typeof flags.body === 'string' ? flags.body : ''

  let metadata: Record<string, unknown> | undefined
  if (typeof flags.metadata === 'string') {
    try {
      metadata = JSON.parse(flags.metadata)
    } catch {
      console.error(red('Error: --metadata must be valid JSON'))
      process.exit(1)
    }
  }

  const actions = typeof flags.actions === 'string'
    ? flags.actions.split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined

  const hasFormsFlag = typeof flags.forms === 'string'
  const hasFormDataFlag = typeof flags['form-data'] === 'string'
  const forms = hasFormsFlag
    ? await parseJsonArrayFlag<Card['forms'] extends Array<infer T> ? T : never>(flags.forms as string, 'forms')
    : undefined
  const formData = hasFormDataFlag
    ? await parseJsonObjectFlag(flags['form-data'] as string, 'form-data') as Card['formData']
    : undefined
  const rawTasks = typeof flags.tasks === 'string'
    ? await parseJsonArrayFlag<ChecklistSeedTaskInput>(flags.tasks, 'tasks')
    : undefined
  let tasks: Card['tasks']
  try {
    tasks = coerceChecklistSeedTasks(rawTasks)
  } catch (err) {
    console.error(red(`Error: ${err instanceof Error ? err.message : String(err)}`))
    process.exit(1)
  }

  const content = `# ${title}${body ? '\n\n' + body : ''}`

  const card = await runWithCliAuth(sdk, flags, () => sdk.createCard({ content, status, priority, assignee, dueDate, labels, tasks, metadata, actions, boardId, forms, formData }))

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
  } else {
    console.log(green(`Created: ${card.id}`))
    console.log(`  Status: ${colorStatus(card.status)}, Priority: ${colorPriority(card.priority)}`)
    console.log(`  File: ${dim(card.filePath)}`)
  }
}

async function cmdMove(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  const newStatus = positional[1]

  if (!cardId || !newStatus) {
    console.error(red('Usage: kl move <id> <status> [--position <n>]'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const validStatuses = await getValidStatuses(sdk, boardId)
  if (!validStatuses.includes(newStatus)) {
    console.error(red(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`))
    process.exit(1)
  }

  // Support partial ID match
  const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)

  const position = typeof flags.position === 'string' ? parseInt(flags.position, 10) : undefined
  const updated = await runWithCliAuth(sdk, flags, () => sdk.moveCard(resolvedId, newStatus, position, boardId))
  console.log(green(`Moved ${updated.id} → ${colorStatus(newStatus)}`))
}

export async function cmdEdit(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl edit <id> [--status ...] [--priority ...] [--assignee ...] [--due ...] [--label ...] [--metadata ...]'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)

  // Support partial ID match
  const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)

  const updates: Partial<Card> = {}
  if (typeof flags.status === 'string') {
    const validStatuses = await getValidStatuses(sdk, boardId)
    if (!validStatuses.includes(flags.status)) {
      console.error(red(`Invalid status: ${flags.status}. Must be one of: ${validStatuses.join(', ')}`))
      process.exit(1)
    }
    updates.status = flags.status
  }
  if (typeof flags.priority === 'string') {
    if (!VALID_PRIORITIES.includes(flags.priority as Priority)) {
      console.error(red(`Invalid priority: ${flags.priority}`))
      process.exit(1)
    }
    updates.priority = flags.priority as Priority
  }
  if (typeof flags.assignee === 'string') updates.assignee = flags.assignee
  if (typeof flags.due === 'string') updates.dueDate = flags.due
  if (typeof flags.label === 'string') updates.labels = flags.label.split(',').map(l => l.trim())
  if (typeof flags.metadata === 'string') {
    try {
      updates.metadata = JSON.parse(flags.metadata)
    } catch {
      console.error(red('Error: --metadata must be valid JSON'))
      process.exit(1)
    }
  }
  if (typeof flags.actions === 'string') {
    updates.actions = flags.actions.split(',').map((s: string) => s.trim()).filter(Boolean)
  }
  if (typeof flags.forms === 'string') {
    updates.forms = await parseJsonArrayFlag<Card['forms'] extends Array<infer T> ? T : never>(flags.forms, 'forms')
  }
  if (typeof flags['form-data'] === 'string') {
    updates.formData = await parseJsonObjectFlag(flags['form-data'], 'form-data') as Card['formData']
  }

  if (Object.keys(updates).length === 0) {
    console.error(red('No updates specified. Use --status, --priority, --assignee, --due, --label, --metadata, --actions, --forms, or --form-data'))
    process.exit(1)
  }

  const updated = await runWithCliAuth(sdk, flags, () => sdk.updateCard(resolvedId, updates, boardId))
  console.log(green(`Updated: ${updated.id}`))
}

export async function cmdForm(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'submit'

  switch (subcommand) {
    case 'submit': {
      const cardId = positional[1]
      const formId = positional[2]
      if (!cardId || !formId) {
        console.error(red('Usage: kl form submit <card-id> <form-id> --data <json|@file>'))
        process.exit(1)
      }

      if (typeof flags.data !== 'string') {
        console.error(red('Error: --data is required and must be a JSON object'))
        process.exit(1)
      }

      const boardId = getBoardId(flags)
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const data = await parseJsonObjectFlag(flags.data, 'data')
      const result = await runWithCliAuth(sdk, flags, () => sdk.submitForm({
        cardId: resolvedId,
        formId,
        data,
        boardId,
      }))

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(green(`Submitted form "${result.form.id}" for card ${resolvedId}`))
      }
      break
    }
    default:
      console.error(red(`Unknown form subcommand: ${subcommand}`))
      console.error('Available: submit')
      process.exit(1)
  }
}

function parseChecklistIndex(value: string | undefined): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    console.error(red('Error: checklist item index is required'))
    process.exit(1)
  }

  const index = Number.parseInt(value, 10)
  if (!Number.isInteger(index) || index < 0) {
    console.error(red(`Error: invalid checklist index: ${value}`))
    process.exit(1)
  }

  return index
}

function printOrEmitChecklist(payload: ReturnType<typeof buildChecklistReadModel>, flags: Flags): void {
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  printChecklistReadModel(payload)
}

export async function cmdChecklist(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  switch (subcommand) {
    case 'list': {
      const cardId = positional[1]
      if (!cardId) {
        console.error(red('Usage: kl checklist list <card-id>'))
        process.exit(1)
      }

      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const card = await runWithCliAuth(sdk, flags, () => sdk.getCard(resolvedId, boardId))
      if (!card) {
        console.error(red(`Card not found: ${cardId}`))
        process.exit(1)
      }

      printOrEmitChecklist(buildChecklistReadModel(card), flags)
      break
    }

    case 'add': {
      const cardId = positional[1]
      const title = typeof flags.title === 'string' ? flags.title : undefined
      const description = typeof flags.description === 'string' ? flags.description : ''
      const expectedToken = typeof flags['expected-token'] === 'string' ? flags['expected-token'] : undefined
      if (!cardId || !title || !expectedToken) {
        console.error(red('Usage: kl checklist add <card-id> --title <title> --expected-token <token>'))
        process.exit(1)
      }

      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.addChecklistItem(resolvedId, title, description, expectedToken, boardId))
      printOrEmitChecklist(buildChecklistReadModel(updated), flags)
      break
    }

    case 'edit': {
      const cardId = positional[1]
      const index = parseChecklistIndex(positional[2])
      const title = typeof flags.title === 'string' ? flags.title : undefined
      const description = typeof flags.description === 'string' ? flags.description : ''
      const modifiedAt = typeof flags['modified-at'] === 'string' ? flags['modified-at'] : undefined
      if (!cardId || !title) {
        console.error(red('Usage: kl checklist edit <card-id> <index> --title <title> --modified-at <iso>'))
        process.exit(1)
      }

      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.editChecklistItem(resolvedId, index, title, description, modifiedAt, boardId))
      printOrEmitChecklist(buildChecklistReadModel(updated), flags)
      break
    }

    case 'delete':
    case 'remove':
    case 'rm': {
      const cardId = positional[1]
      const index = parseChecklistIndex(positional[2])
      const modifiedAt = typeof flags['modified-at'] === 'string' ? flags['modified-at'] : undefined
      if (!cardId) {
        console.error(red('Usage: kl checklist delete <card-id> <index> --modified-at <iso>'))
        process.exit(1)
      }

      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.deleteChecklistItem(resolvedId, index, modifiedAt, boardId))
      printOrEmitChecklist(buildChecklistReadModel(updated), flags)
      break
    }

    case 'check': {
      const cardId = positional[1]
      const index = parseChecklistIndex(positional[2])
      const modifiedAt = typeof flags['modified-at'] === 'string' ? flags['modified-at'] : undefined
      if (!cardId) {
        console.error(red('Usage: kl checklist check <card-id> <index> --modified-at <iso>'))
        process.exit(1)
      }

      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.checkChecklistItem(resolvedId, index, modifiedAt, boardId))
      printOrEmitChecklist(buildChecklistReadModel(updated), flags)
      break
    }

    case 'uncheck': {
      const cardId = positional[1]
      const index = parseChecklistIndex(positional[2])
      const modifiedAt = typeof flags['modified-at'] === 'string' ? flags['modified-at'] : undefined
      if (!cardId) {
        console.error(red('Usage: kl checklist uncheck <card-id> <index> --modified-at <iso>'))
        process.exit(1)
      }

      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.uncheckChecklistItem(resolvedId, index, modifiedAt, boardId))
      printOrEmitChecklist(buildChecklistReadModel(updated), flags)
      break
    }

    default:
      console.error(red(`Unknown checklist subcommand: ${subcommand}`))
      console.error('Available: list, add, edit, delete, check, uncheck')
      process.exit(1)
  }
}

async function cmdDelete(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl delete <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)

  // Support partial ID match
  const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)

  await runWithCliAuth(sdk, flags, () => sdk.deleteCard(resolvedId, boardId))
  console.log(green(`Soft-deleted: ${resolvedId} (moved to deleted)`))
}

async function cmdPermanentDelete(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl permanent-delete <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)

  await runWithCliAuth(sdk, flags, () => sdk.permanentlyDeleteCard(resolvedId, boardId))
  console.log(green(`Permanently deleted: ${resolvedId}`))
}

async function cmdInit(sdk: KanbanSDK): Promise<void> {
  await sdk.init()
  console.log(green(`Initialized: ${sdk.kanbanDir}`))
}

// --- Board Commands ---

async function cmdBoards(sdk: KanbanSDK, positional: string[], flags: Flags, workspaceRoot: string): Promise<void> {
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

async function cmdBoardActions(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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

async function cmdTransfer(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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

async function cmdAttach(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const cardId = positional[1]
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'rm' && subcommand !== 'remove') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId, flags)
    const attachments = await runWithCliAuth(sdk, flags, () => sdk.listAttachments(resolvedId, boardId))
    if (flags.json) {
      console.log(JSON.stringify(attachments, null, 2))
    } else if (attachments.length === 0) {
      console.log(dim('  No attachments.'))
    } else {
      for (const a of attachments) console.log(`  ${a}`)
    }
    return
  }

  switch (subcommand) {
    case 'list': {
      if (!cardId) {
        console.error(red('Usage: kl attach list <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const attachments = await runWithCliAuth(sdk, flags, () => sdk.listAttachments(resolvedId, boardId))
      if (flags.json) {
        console.log(JSON.stringify(attachments, null, 2))
      } else if (attachments.length === 0) {
        console.log(dim('  No attachments.'))
      } else {
        for (const a of attachments) console.log(`  ${a}`)
      }
      break
    }
    case 'add': {
      if (!cardId) {
        console.error(red('Usage: kl attach add <card-id> <file-path>'))
        process.exit(1)
      }
      const filePath = positional[2]
      if (!filePath) {
        console.error(red('Usage: kl attach add <card-id> <file-path>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.addAttachment(resolvedId, filePath, boardId))
      console.log(green(`Attached to ${updated.id}: ${path.basename(filePath)}`))
      break
    }
    case 'remove':
    case 'rm': {
      if (!cardId) {
        console.error(red('Usage: kl attach remove <card-id> <filename>'))
        process.exit(1)
      }
      const filename = positional[2]
      if (!filename) {
        console.error(red('Usage: kl attach remove <card-id> <filename>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.removeAttachment(resolvedId, filename, boardId))
      console.log(green(`Removed from ${updated.id}: ${filename}`))
      break
    }
  }
}

// --- Comment Commands ---

async function cmdComment(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'edit' && subcommand !== 'remove' && subcommand !== 'rm' && subcommand !== 'stream') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId, flags)
    const comments = await runWithCliAuth(sdk, flags, () => sdk.listComments(resolvedId, boardId))
    if (flags.json) {
      console.log(JSON.stringify(comments, null, 2))
    } else if (comments.length === 0) {
      console.log(dim('  No comments.'))
    } else {
      for (const c of comments) {
        console.log(`  ${bold(c.id)}  ${cyan(c.author)}  ${dim(c.created)}`)
        console.log(`    ${c.content.split('\n').join('\n    ')}`)
        console.log()
      }
    }
    return
  }

  const cardId = positional[1]

  switch (subcommand) {
    case 'list': {
      if (!cardId) {
        console.error(red('Usage: kl comment list <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const comments = await runWithCliAuth(sdk, flags, () => sdk.listComments(resolvedId, boardId))
      if (flags.json) {
        console.log(JSON.stringify(comments, null, 2))
      } else if (comments.length === 0) {
        console.log(dim('  No comments.'))
      } else {
        for (const c of comments) {
          console.log(`  ${bold(c.id)}  ${cyan(c.author)}  ${dim(c.created)}`)
          console.log(`    ${c.content.split('\n').join('\n    ')}`)
          console.log()
        }
      }
      break
    }
    case 'add': {
      if (!cardId) {
        console.error(red('Usage: kl comment add <card-id> --author <name> --body <text>'))
        process.exit(1)
      }
      const author = typeof flags.author === 'string' ? flags.author : ''
      const body = typeof flags.body === 'string' ? flags.body : ''
      if (!author) {
        console.error(red('Error: --author is required'))
        process.exit(1)
      }
      if (!body) {
        console.error(red('Error: --body is required'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const card = await runWithCliAuth(sdk, flags, () => sdk.addComment(resolvedId, author, body, boardId))
      const added = card.comments[card.comments.length - 1]
      if (flags.json) {
        console.log(JSON.stringify(added, null, 2))
      } else {
        console.log(green(`Added comment ${added.id} to card ${resolvedId}`))
      }
      break
    }
    case 'edit': {
      if (!cardId) {
        console.error(red('Usage: kl comment edit <card-id> <comment-id> --body <text>'))
        process.exit(1)
      }
      const commentId = positional[2]
      if (!commentId) {
        console.error(red('Usage: kl comment edit <card-id> <comment-id> --body <text>'))
        process.exit(1)
      }
      const body = typeof flags.body === 'string' ? flags.body : ''
      if (!body) {
        console.error(red('Error: --body is required'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.updateComment(resolvedId, commentId, body, boardId))
      if (flags.json) {
        const comments = await runWithCliAuth(sdk, flags, () => sdk.listComments(resolvedId, boardId))
        const updated = comments.find(c => c.id === commentId)
        console.log(JSON.stringify(updated, null, 2))
      } else {
        console.log(green(`Updated comment ${commentId}`))
      }
      break
    }
    case 'remove':
    case 'rm': {
      if (!cardId) {
        console.error(red('Usage: kl comment remove <card-id> <comment-id>'))
        process.exit(1)
      }
      const commentId = positional[2]
      if (!commentId) {
        console.error(red('Usage: kl comment remove <card-id> <comment-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.deleteComment(resolvedId, commentId, boardId))
      console.log(green(`Deleted comment ${commentId}`))
      break
    }
    case 'stream': {
      // Reads text from stdin and streams it as a comment in real-time.
      // Useful for piping LLM output: `llm-cli generate | kl comment stream <card-id> --author agent`
      if (!cardId) {
        console.error(red('Usage: kl comment stream <card-id> --author <name>'))
        process.exit(1)
      }
      const author = typeof flags.author === 'string' ? flags.author : ''
      if (!author) {
        console.error(red('Error: --author is required'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      async function* stdinStream(): AsyncIterable<string> {
        process.stdin.setEncoding('utf8')
        for await (const chunk of process.stdin) {
          if (!flags.json) process.stderr.write('.')
          yield chunk as string
        }
      }
      if (!flags.json) process.stderr.write('Streaming comment')
      const card = await runWithCliAuth(sdk, flags, () => sdk.streamComment(resolvedId, author, stdinStream(), { boardId }))
      if (!flags.json) process.stderr.write('\n')
      const added = card.comments?.[card.comments.length - 1]
      if (flags.json) {
        console.log(JSON.stringify(added, null, 2))
      } else {
        console.log(green(`Streamed comment ${added?.id ?? '?'} to card ${resolvedId}`))
      }
      break
    }
  }
}

// --- Log Commands ---

async function cmdLog(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'clear') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId, flags)
    const logs = await runWithCliAuth(sdk, flags, () => sdk.listLogs(resolvedId, boardId))
    if (flags.json) {
      console.log(JSON.stringify(logs, null, 2))
    } else if (logs.length === 0) {
      console.log(dim('  No logs.'))
    } else {
      for (const entry of logs) {
        const objStr = entry.object ? `  ${dim(JSON.stringify(entry.object))}` : ''
        console.log(`  ${dim(entry.timestamp)}  ${cyan(`[${entry.source}]`)}  ${entry.text}${objStr}`)
      }
    }
    return
  }

  const cardId = positional[1]

  switch (subcommand) {
    case 'list': {
      if (!cardId) {
        console.error(red('Usage: kl log list <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const logs = await runWithCliAuth(sdk, flags, () => sdk.listLogs(resolvedId, boardId))
      if (flags.json) {
        console.log(JSON.stringify(logs, null, 2))
      } else if (logs.length === 0) {
        console.log(dim('  No logs.'))
      } else {
        for (const entry of logs) {
          const objStr = entry.object ? `  ${dim(JSON.stringify(entry.object))}` : ''
          console.log(`  ${dim(entry.timestamp)}  ${cyan(`[${entry.source}]`)}  ${entry.text}${objStr}`)
        }
      }
      break
    }
    case 'add': {
      if (!cardId) {
        console.error(red('Usage: kl log add <card-id> --text <message> [--source <src>] [--object <json>]'))
        process.exit(1)
      }
      const text = typeof flags.text === 'string' ? flags.text : (typeof flags.body === 'string' ? flags.body : '')
      if (!text) {
        console.error(red('Error: --text is required'))
        process.exit(1)
      }
      const source = typeof flags.source === 'string' ? flags.source : undefined
      let obj: Record<string, unknown> | undefined
      if (typeof flags.object === 'string') {
        try {
          obj = JSON.parse(flags.object)
        } catch {
          console.error(red('Error: --object must be valid JSON'))
          process.exit(1)
        }
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const entry = await runWithCliAuth(sdk, flags, () => sdk.addLog(resolvedId, text, { source, object: obj }, boardId))
      if (flags.json) {
        console.log(JSON.stringify(entry, null, 2))
      } else {
        console.log(green(`Added log to card ${resolvedId}`))
      }
      break
    }
    case 'clear': {
      if (!cardId) {
        console.error(red('Usage: kl log clear <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.clearLogs(resolvedId, boardId))
      console.log(green(`Cleared logs for card ${resolvedId}`))
      break
    }
  }
}

// --- Board Log Commands ---

async function cmdBoardLog(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  switch (subcommand) {
    case 'list': {
      const logs = await sdk.listBoardLogs(boardId)
      if (flags.json) {
        console.log(JSON.stringify(logs, null, 2))
      } else if (logs.length === 0) {
        console.log(dim('  No board logs.'))
      } else {
        for (const entry of logs) {
          const objStr = entry.object ? `  ${dim(JSON.stringify(entry.object))}` : ''
          console.log(`  ${dim(entry.timestamp)}  ${cyan(`[${entry.source}]`)}  ${entry.text}${objStr}`)
        }
      }
      break
    }
    case 'add': {
      const text = typeof flags.text === 'string' ? flags.text : (typeof flags.body === 'string' ? flags.body : '')
      if (!text) {
        console.error(red('Error: --text is required'))
        process.exit(1)
      }
      const source = typeof flags.source === 'string' ? flags.source : undefined
      let obj: Record<string, unknown> | undefined
      if (typeof flags.object === 'string') {
        try {
          obj = JSON.parse(flags.object)
        } catch {
          console.error(red('Error: --object must be valid JSON'))
          process.exit(1)
        }
      }
      const entry = await runWithCliAuth(sdk, flags, () => sdk.addBoardLog(text, { source, object: obj }, boardId))
      if (flags.json) {
        console.log(JSON.stringify(entry, null, 2))
      } else {
        console.log(green('Added board log entry'))
      }
      break
    }
    case 'clear': {
      await runWithCliAuth(sdk, flags, () => sdk.clearBoardLogs(boardId))
      console.log(green('Cleared board logs'))
      break
    }
    default: {
      console.error(red(`Unknown subcommand: ${subcommand}`))
      process.exit(1)
    }
  }
}

// --- Column Commands ---

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

async function cmdAction(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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

async function cmdSettings(positional: string[], flags: Flags, sdk: KanbanSDK): Promise<void> {
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

async function cmdMcp(flags: Flags): Promise<void> {
  // Allow --dir flag to override the kanban directory via env var
  // (MCP server reads KANBAN_DIR from process.env and --dir from process.argv)
  if (typeof flags.dir === 'string') {
    process.env.KANBAN_DIR = path.resolve(flags.dir)
  }
  // Importing the MCP server module triggers its top-level main() bootstrap
  await import('../mcp-server/index')
}

async function cmdServe(flags: Flags): Promise<void> {
  const workspaceRoot = resolveWorkspaceRootForFlags(flags)
  const dir = resolveKanbanDirForFlags(flags)
  const resolvedConfigFilePath = getConfigFilePath(flags) ?? configPath(workspaceRoot)
  const config = readConfig(workspaceRoot)
  const port = typeof flags.port === 'string' ? parseInt(flags.port, 10) : config.port
  const noBrowser = !!flags['no-browser']

  // Dynamically import the standalone server
  const { startServer } = await import('../standalone/server')
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

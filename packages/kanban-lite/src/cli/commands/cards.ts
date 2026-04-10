import * as path from 'path'
import * as fs from 'fs/promises'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { buildChecklistReadModel, coerceChecklistSeedTasks, type ChecklistSeedTaskInput } from '../../sdk/modules/checklist'
import type { Card, Priority, CardSortOption, CardDisplaySettings } from '../../shared/types'
import { getDisplayTitleFromContent } from '../../shared/types'
import { AuthError } from '../../sdk/types'
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
} from '../output'
import {
  getBoardId,
  getConfigFilePath,
  getValidStatuses,
  handleAuthError,
  parseJsonArrayFlag,
  parseJsonObjectFlag,
  resolveCardId,
  resolveKanbanDirForFlags,
  resolveWorkspaceRootForFlags,
  runWithCliAuth,
  VALID_PRIORITIES,
  type Flags,
} from '../shared'


function getBoardTitleFieldsForCli(sdk: Pick<KanbanSDK, 'getConfigSnapshot'>, boardId?: string): { fields: readonly string[] | undefined; template: string | undefined } {
  const config = sdk.getConfigSnapshot()
  const resolvedBoardId = boardId || config.defaultBoard
  const board = config.boards[resolvedBoardId]
  return { fields: board?.title, template: board?.titleTemplate }
}

export async function cmdEvents(sdk: KanbanSDK, flags: Flags): Promise<void> {
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
  const { fields: boardTitleFields, template: boardTitleTemplate } = getBoardTitleFieldsForCli(sdk, boardId)
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
    console.log(formatCardRow(c, getDisplayTitleFromContent(c.content, c.metadata, boardTitleFields, boardTitleTemplate)))
  }
  console.log(dim(`\n  ${cards.length} card(s)`))
}

export async function cmdActive(sdk: KanbanSDK, flags: Flags): Promise<void> {
  const boardId = getBoardId(flags)
  const { fields: boardTitleFields, template: boardTitleTemplate } = getBoardTitleFieldsForCli(sdk, boardId)
  const card = await runWithCliAuth(sdk, flags, () => sdk.getActiveCard(boardId))

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
    return
  }

  if (!card) {
    console.log(dim('  No active card.'))
    return
  }

  console.log(formatCardDetail(card, getDisplayTitleFromContent(card.content, card.metadata, boardTitleFields, boardTitleTemplate)))
}

export async function cmdShow(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Error: card ID required. Usage: kl show <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const { fields: boardTitleFields, template: boardTitleTemplate } = getBoardTitleFieldsForCli(sdk, boardId)
  const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
  const card = await runWithCliAuth(sdk, flags, () => sdk.getCard(resolvedId, boardId))
  if (!card) {
    console.error(red(`Card not found: ${cardId}`))
    process.exit(1)
  }

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
  } else {
    console.log(formatCardDetail(card, getDisplayTitleFromContent(card.content, card.metadata, boardTitleFields, boardTitleTemplate)))
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

export async function cmdMove(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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

export async function cmdDelete(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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

export async function cmdPermanentDelete(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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


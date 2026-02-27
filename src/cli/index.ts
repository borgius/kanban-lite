import * as path from 'path'
import * as fs from 'fs/promises'
import { KanbanSDK } from '../sdk/KanbanSDK'
import type { Feature, Priority, CardSortOption } from '../shared/types'
import { loadWebhooks, createWebhook, deleteWebhook, updateWebhook, fireWebhooks } from '../standalone/webhooks'
import { readConfig, writeConfig, configToSettings, settingsToConfig } from '../shared/config'
import type { CardDisplaySettings } from '../shared/types'
import { matchesMetaFilter } from '../sdk/metaUtils'

const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

type Flags = Record<string, string | true | string[]>

// --- Arg parsing ---

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const args = argv.slice(2)
  const command = args[0] || 'help'
  const positional: string[] = []
  const flags: Flags = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (key === 'meta') {
        if (!next || next.startsWith('--')) {
          console.error(red('--meta requires a value in key=value format'))
          process.exit(1)
        }
        const existing = flags.meta
        flags.meta = Array.isArray(existing) ? [...existing, next] : [next]
        i++
      } else if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }

  return { command, positional, flags }
}

// --- Board ID helper ---

function getBoardId(flags: Flags): string | undefined {
  return typeof flags.board === 'string' ? flags.board : undefined
}

// --- Dynamic status validation ---

async function getValidStatuses(sdk: KanbanSDK, boardId?: string): Promise<string[]> {
  const columns = await sdk.listColumns(boardId)
  return columns.map(c => c.id)
}

// --- Resolve features directory ---

async function findWorkspaceRoot(startDir: string): Promise<string> {
  let dir = startDir
  while (true) {
    try {
      await fs.access(path.join(dir, '.git'))
      return dir
    } catch {
      // try package.json
    }
    try {
      await fs.access(path.join(dir, 'package.json'))
      return dir
    } catch {
      // continue up
    }
    const parent = path.dirname(dir)
    if (parent === dir) return startDir // reached filesystem root
    dir = parent
  }
}

async function resolveFeaturesDir(flags: Flags): Promise<string> {
  if (typeof flags.dir === 'string') {
    return path.resolve(flags.dir)
  }
  const root = await findWorkspaceRoot(process.cwd())
  return path.join(root, '.kanban')
}

// --- Colors ---

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`

function colorStatus(status: string): string {
  switch (status) {
    case 'backlog': return dim(status)
    case 'todo': return cyan(status)
    case 'in-progress': return yellow(status)
    case 'review': return magenta(status)
    case 'done': return green(status)
    default: return status
  }
}

function colorPriority(priority: string): string {
  switch (priority) {
    case 'critical': return red(priority)
    case 'high': return yellow(priority)
    case 'medium': return priority
    case 'low': return dim(priority)
    default: return priority
  }
}

// --- Formatters ---

function getTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return firstLine || 'Untitled'
}

function formatCardRow(c: Feature): string {
  const title = getTitleFromContent(c.content)
  const truncTitle = title.length > 40 ? title.slice(0, 37) + '...' : title
  const assignee = c.assignee || '-'
  return `  ${bold(c.id.slice(0, 30).padEnd(30))}  ${colorStatus(c.status.padEnd(12))}  ${colorPriority(c.priority.padEnd(8))}  ${assignee.padEnd(12)}  ${truncTitle}`
}

function formatCardDetail(c: Feature): string {
  const title = getTitleFromContent(c.content)
  const lines = [
    `${bold(title)}`,
    '',
    `  ID:        ${c.id}`,
    `  Status:    ${colorStatus(c.status)}`,
    `  Priority:  ${colorPriority(c.priority)}`,
    `  Assignee:  ${c.assignee || '-'}`,
    `  Due:       ${c.dueDate || '-'}`,
    `  Labels:    ${c.labels.length > 0 ? c.labels.join(', ') : '-'}`,
    `  Created:   ${c.created}`,
    `  Modified:  ${c.modified}`,
    `  File:      ${c.filePath}`,
  ]
  if (c.boardId) {
    lines.push(`  Board:     ${c.boardId}`)
  }
  if (c.completedAt) {
    lines.push(`  Completed: ${c.completedAt}`)
  }
  if (c.metadata && Object.keys(c.metadata).length > 0) {
    lines.push(`  Metadata:  ${JSON.stringify(c.metadata, null, 2).split('\n').join('\n             ')}`)
  }
  // Show body content (minus the title heading)
  const body = c.content.replace(/^#\s+.+\n?/, '').trim()
  if (body) {
    lines.push('', dim('  --- Content ---'), '', '  ' + body.split('\n').join('\n  '))
  }
  return lines.join('\n')
}

// --- Card Commands ---

async function cmdList(sdk: KanbanSDK, flags: Flags): Promise<void> {
  const boardId = getBoardId(flags)
  let cards = await sdk.listCards(undefined, boardId)

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
  if (Array.isArray(flags.meta)) {
    const metaFilter: Record<string, string> = {}
    for (const entry of flags.meta) {
      const eq = entry.indexOf('=')
      if (eq < 1) {
        console.error(red(`Invalid --meta format: "${entry}". Expected key=value`))
        process.exit(1)
      }
      metaFilter[entry.slice(0, eq)] = entry.slice(eq + 1)
    }
    cards = cards.filter(c => matchesMetaFilter(c.metadata, metaFilter))
  }

  const VALID_SORTS: CardSortOption[] = ['created:asc', 'created:desc', 'modified:asc', 'modified:desc']
  if (typeof flags.sort === 'string') {
    const sort = flags.sort as CardSortOption
    if (!VALID_SORTS.includes(sort)) {
      console.error(red(`Invalid --sort value: "${sort}". Must be one of: ${VALID_SORTS.join(', ')}`))
      process.exit(1)
    }
    const [field, dir] = sort.split(':')
    cards = [...cards].sort((a, b) => {
      const aVal = field === 'created' ? a.created : a.modified
      const bVal = field === 'created' ? b.created : b.modified
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })
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
    console.log(formatCardRow(c))
  }
  console.log(dim(`\n  ${cards.length} card(s)`))
}

async function cmdShow(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Error: card ID required. Usage: kl show <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const card = await sdk.getCard(cardId, boardId)
  if (!card) {
    // Try partial match
    const all = await sdk.listCards(undefined, boardId)
    const matches = all.filter(c => c.id.includes(cardId))
    if (matches.length === 1) {
      if (flags.json) {
        console.log(JSON.stringify(matches[0], null, 2))
      } else {
        console.log(formatCardDetail(matches[0]))
      }
      return
    } else if (matches.length > 1) {
      console.error(red(`Multiple cards match "${cardId}":`))
      for (const m of matches) console.error(`  ${m.id}`)
      process.exit(1)
    }
    console.error(red(`Card not found: ${cardId}`))
    process.exit(1)
  }

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
  } else {
    console.log(formatCardDetail(card))
  }
}

async function cmdAdd(sdk: KanbanSDK, flags: Flags): Promise<void> {
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

  let metadata: Record<string, any> | undefined
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

  const content = `# ${title}${body ? '\n\n' + body : ''}`

  const card = await sdk.createCard({ content, status, priority, assignee, dueDate, labels, metadata, actions, boardId })

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
  const resolvedId = await resolveCardId(sdk, cardId, boardId)

  const position = typeof flags.position === 'string' ? parseInt(flags.position, 10) : undefined
  const updated = await sdk.moveCard(resolvedId, newStatus, position, boardId)
  console.log(green(`Moved ${updated.id} → ${colorStatus(newStatus)}`))
}

async function cmdEdit(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl edit <id> [--status ...] [--priority ...] [--assignee ...] [--due ...] [--label ...] [--metadata ...]'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)

  // Support partial ID match
  const resolvedId = await resolveCardId(sdk, cardId, boardId)

  const updates: Partial<Feature> = {}
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

  if (Object.keys(updates).length === 0) {
    console.error(red('No updates specified. Use --status, --priority, --assignee, --due, --label, --metadata, or --actions'))
    process.exit(1)
  }

  const updated = await sdk.updateCard(resolvedId, updates, boardId)
  console.log(green(`Updated: ${updated.id}`))
}

async function cmdDelete(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl delete <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)

  // Support partial ID match
  const resolvedId = await resolveCardId(sdk, cardId, boardId)

  await sdk.deleteCard(resolvedId, boardId)
  console.log(green(`Soft-deleted: ${resolvedId} (moved to deleted)`))
}

async function cmdPermanentDelete(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl permanent-delete <id>'))
    process.exit(1)
  }

  const boardId = getBoardId(flags)
  const resolvedId = await resolveCardId(sdk, cardId, boardId)

  await sdk.permanentlyDeleteCard(resolvedId, boardId)
  console.log(green(`Permanently deleted: ${resolvedId}`))
}

async function cmdInit(sdk: KanbanSDK): Promise<void> {
  await sdk.init()
  console.log(green(`Initialized: ${sdk.featuresDir}`))
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
      const board = await sdk.createBoard(id, name, { description })
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
      await sdk.deleteBoard(boardId)
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
      const config = readConfig(workspaceRoot)
      if (!config.boards[boardId]) {
        console.error(red(`Board not found: ${boardId}`))
        process.exit(1)
      }
      config.defaultBoard = boardId
      writeConfig(workspaceRoot, config)
      console.log(green(`Default board set to: ${boardId}`))
      break
    }
    default:
      console.error(red(`Unknown boards subcommand: ${subcommand}`))
      console.error('Available: list, add, show, remove, default')
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
  const resolvedId = await resolveCardId(sdk, cardId, fromBoard)
  const card = await sdk.transferCard(resolvedId, fromBoard, toBoard, targetStatus)
  console.log(green(`Transferred ${card.id} from ${fromBoard} → ${toBoard} (${colorStatus(card.status)})`))
}

// --- Attachment Commands ---

async function cmdAttach(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const cardId = positional[1]
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'rm' && subcommand !== 'remove') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId)
    const attachments = await sdk.listAttachments(resolvedId, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      const attachments = await sdk.listAttachments(resolvedId, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      const updated = await sdk.addAttachment(resolvedId, filePath, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      const updated = await sdk.removeAttachment(resolvedId, filename, boardId)
      console.log(green(`Removed from ${updated.id}: ${filename}`))
      break
    }
  }
}

async function resolveCardId(sdk: KanbanSDK, cardId: string, boardId?: string): Promise<string> {
  const card = await sdk.getCard(cardId, boardId)
  if (card) return cardId

  const all = await sdk.listCards(undefined, boardId)
  const matches = all.filter(c => c.id.includes(cardId))
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    console.error(red(`Multiple cards match "${cardId}":`))
    for (const m of matches) console.error(`  ${m.id}`)
    process.exit(1)
  }
  console.error(red(`Card not found: ${cardId}`))
  process.exit(1)
}

// --- Comment Commands ---

async function cmdComment(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'edit' && subcommand !== 'remove' && subcommand !== 'rm') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId)
    const comments = await sdk.listComments(resolvedId, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      const comments = await sdk.listComments(resolvedId, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      const card = await sdk.addComment(resolvedId, author, body, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      await sdk.updateComment(resolvedId, commentId, body, boardId)
      if (flags.json) {
        const comments = await sdk.listComments(resolvedId, boardId)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      await sdk.deleteComment(resolvedId, commentId, boardId)
      console.log(green(`Deleted comment ${commentId}`))
      break
    }
  }
}

// --- Column Commands ---

async function cmdColumns(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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
      const columns = await sdk.addColumn({ id, name, color }, boardId)
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
      const columns = await sdk.updateColumn(columnId, updates, boardId)
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
      const columns = await sdk.removeColumn(columnId, boardId)
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
      const moved = await sdk.cleanupColumn(columnId, boardId)
      console.log(green(`Moved ${moved} card${moved === 1 ? '' : 's'} from "${columnId}" to deleted`))
      break
    }
    default:
      console.error(red(`Unknown columns subcommand: ${subcommand}`))
      console.error('Available: list, add, update, remove, cleanup')
      process.exit(1)
  }
}

// --- Label Commands ---

async function cmdLabels(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
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
      sdk.setLabel(name, { color, group })
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
      await sdk.renameLabel(oldName, newName)
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
      await sdk.deleteLabel(name)
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
      const resolvedId = await resolveCardId(sdk, cardId, boardId)
      await sdk.triggerAction(resolvedId, action, boardId)
      console.log(green(`Action "${action}" triggered on card ${resolvedId}`))
      break
    }
    default:
      console.error(red(`Unknown action subcommand: ${subcommand}`))
      console.error('Available: trigger')
      process.exit(1)
  }
}

// --- Webhook Commands ---

async function cmdWebhooks(positional: string[], flags: Flags, workspaceRoot: string): Promise<void> {
  const subcommand = positional[0] || 'list'

  switch (subcommand) {
    case 'list': {
      const webhooks = loadWebhooks(workspaceRoot)
      if (flags.json) {
        console.log(JSON.stringify(webhooks, null, 2))
      } else if (webhooks.length === 0) {
        console.log(dim('  No webhooks registered.'))
      } else {
        console.log(`  ${dim('ID'.padEnd(22))}  ${dim('URL'.padEnd(40))}  ${dim('EVENTS'.padEnd(20))}  ${dim('ACTIVE')}`)
        console.log(dim('  ' + '-'.repeat(90)))
        for (const w of webhooks) {
          const events = w.events.join(', ')
          const active = w.active ? green('yes') : red('no')
          console.log(`  ${bold(w.id.padEnd(22))}  ${w.url.padEnd(40)}  ${events.padEnd(20)}  ${active}`)
        }
      }
      break
    }
    case 'add': {
      const url = typeof flags.url === 'string' ? flags.url : ''
      if (!url) {
        console.error(red('Usage: kl webhooks add --url <url> [--events <event1,event2>] [--secret <key>]'))
        process.exit(1)
      }
      const events = typeof flags.events === 'string' ? flags.events.split(',').map(e => e.trim()) : ['*']
      const secret = typeof flags.secret === 'string' ? flags.secret : undefined
      const webhook = createWebhook(workspaceRoot, { url, events, secret })
      if (flags.json) {
        console.log(JSON.stringify(webhook, null, 2))
      } else {
        console.log(green(`Created webhook: ${webhook.id}`))
        console.log(`  URL:    ${webhook.url}`)
        console.log(`  Events: ${webhook.events.join(', ')}`)
        if (webhook.secret) console.log(`  Secret: ${dim('(configured)')}`)
      }
      break
    }
    case 'remove':
    case 'rm': {
      const webhookId = positional[1]
      if (!webhookId) {
        console.error(red('Usage: kl webhooks remove <id>'))
        process.exit(1)
      }
      const removed = deleteWebhook(workspaceRoot, webhookId)
      if (removed) {
        console.log(green(`Removed webhook: ${webhookId}`))
      } else {
        console.error(red(`Webhook not found: ${webhookId}`))
        process.exit(1)
      }
      break
    }
    case 'update': {
      const webhookId = positional[1]
      if (!webhookId) {
        console.error(red('Usage: kl webhooks update <id> [--url <url>] [--events <e1,e2>] [--secret <key>] [--active true|false]'))
        process.exit(1)
      }
      const updates: Partial<{ url: string; events: string[]; secret: string; active: boolean }> = {}
      if (typeof flags.url === 'string') updates.url = flags.url
      if (typeof flags.events === 'string') updates.events = flags.events.split(',').map(e => e.trim())
      if (typeof flags.secret === 'string') updates.secret = flags.secret
      if (typeof flags.active === 'string') updates.active = flags.active === 'true'
      const updated = updateWebhook(workspaceRoot, webhookId, updates)
      if (!updated) {
        console.error(red(`Webhook not found: ${webhookId}`))
        process.exit(1)
      }
      if (flags.json) {
        console.log(JSON.stringify(updated, null, 2))
      } else {
        console.log(green(`Updated webhook: ${updated.id}`))
        console.log(`  URL:    ${updated.url}`)
        console.log(`  Events: ${updated.events.join(', ')}`)
        console.log(`  Active: ${updated.active ? green('yes') : red('no')}`)
      }
      break
    }
    default:
      console.error(red(`Unknown webhooks subcommand: ${subcommand}`))
      console.error('Available: list, add, update, remove')
      process.exit(1)
  }
}

// --- Settings Commands ---

const SETTINGS_KEYS = [
  'showPriorityBadges', 'showAssignee', 'showDueDate', 'showLabels',
  'showFileName', 'compactMode', 'showDeletedColumn', 'defaultPriority', 'defaultStatus'
] as const

async function cmdSettings(positional: string[], flags: Flags, workspaceRoot: string): Promise<void> {
  const subcommand = positional[0] || 'show'

  switch (subcommand) {
    case 'show':
    case 'list': {
      const config = readConfig(workspaceRoot)
      const settings = configToSettings(config)
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
      const config = readConfig(workspaceRoot)
      const settings = configToSettings(config)
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
      writeConfig(workspaceRoot, settingsToConfig(config, settings))
      console.log(green('Settings updated.'))
      if (flags.json) {
        console.log(JSON.stringify(configToSettings(readConfig(workspaceRoot)), null, 2))
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

async function cmdServe(flags: Flags): Promise<void> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.kanban'
  const config = readConfig(process.cwd())
  const port = typeof flags.port === 'string' ? parseInt(flags.port, 10) : config.port
  const noBrowser = !!flags['no-browser']

  // Dynamically import the standalone server
  const { startServer } = await import('../standalone/server')
  const server = startServer(dir, port)

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

const HELP_TOPICS: Record<string, string> = {
  sdk: 'docs/sdk.md',
  api: 'docs/api.md',
}

function formatMarkdownForTerminal(md: string): string {
  return md
    .split('\n')
    .map(line => {
      // Headers
      if (line.startsWith('# ')) return '\n' + bold(line.slice(2))
      if (line.startsWith('## ')) return '\n' + bold(line.slice(3))
      if (line.startsWith('### ')) return '\n' + cyan(line.slice(4))
      if (line.startsWith('#### ')) return dim(line.slice(5))
      // Horizontal rules
      if (/^---+$/.test(line.trim())) return ''
      // Bold text inline
      return line.replace(/\*\*(.+?)\*\*/g, (_m, p1) => bold(p1))
    })
    .join('\n')
}

async function findPackageRoot(): Promise<string> {
  let dir = __dirname
  while (true) {
    try {
      await fs.access(path.join(dir, 'package.json'))
      return dir
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) return __dirname
      dir = parent
    }
  }
}

async function showDocHelp(topic: string): Promise<void> {
  const relativePath = HELP_TOPICS[topic]
  if (!relativePath) {
    console.error(red(`Unknown help topic: ${topic}`))
    console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(', ')}`)
    process.exit(1)
  }

  const pkgRoot = await findPackageRoot()
  const docPath = path.join(pkgRoot, relativePath)

  try {
    const content = await fs.readFile(docPath, 'utf-8')
    console.log(formatMarkdownForTerminal(content))
  } catch {
    console.error(red(`Documentation not found: ${docPath}`))
    process.exit(1)
  }
}

function showHelp(): void {
  console.log(`
${bold('kanban-lite')} (${bold('kl')}) - Manage your kanban board from the command line

${bold('Usage:')}
  kanban-lite <command> [options]
  kl <command> [options]

${bold('Card Commands:')}
  list                        List cards
  show <id>                   Show card details
  add --title "..."           Create a new card
  move <id> <status>          Move card to a new status (--position <n>)
  edit <id> [--field value]   Update card fields
  delete <id>                 Delete a card

${bold('Board Commands:')}
  boards                      List boards
  boards add                  Create a board (--id, --name, --description)
  boards show <id>            Show board details
  boards remove <id>          Remove a board
  boards default [id]         Get or set the default board
  transfer <id>               Transfer a card (--from, --to, --status)

${bold('Attachment Commands:')}
  attach <id>                 List attachments on a card
  attach add <id> <path>      Attach a file to a card
  attach remove <id> <name>   Remove an attachment from a card

${bold('Comment Commands:')}
  comment <id>                List comments on a card
  comment add <id>            Add a comment (--author, --body)
  comment edit <id> <cid>     Edit a comment (--body)
  comment remove <id> <cid>   Remove a comment

${bold('Column Commands:')}
  columns                     List columns
  columns add                 Add a column (--id, --name, --color)
  columns update <id>         Update a column (--name, --color)
  columns remove <id>         Remove a column

${bold('Label Commands:')}
  labels                      List label definitions
  labels set <name>           Set a label (--color, --group)
  labels rename <old> <new>   Rename a label (cascades to cards)
  labels delete <name>        Remove a label definition

${bold('Webhook Commands:')}
  webhooks                    List registered webhooks
  webhooks add                Register a webhook (--url, --events, --secret)
  webhooks update <id>        Update a webhook (--url, --events, --secret, --active)
  webhooks remove <id>        Remove a webhook

${bold('Settings Commands:')}
  settings                    Show current settings
  settings update             Update settings (--<key> <value>)

${bold('Server:')}
  serve                       Start standalone web server with REST API

${bold('Other:')}
  init                        Initialize features directory
  pwd                         Print workspace root path

${bold('Global Options:')}
  --dir <path>                Features directory (default: .kanban)
  --board <id>                Target board (default: default board)
  --json                      Output as JSON

${bold('List Filters:')}
  --status <status>           Filter by status
  --priority <priority>       Filter by priority (critical, high, medium, low)
  --assignee <name>           Filter by assignee
  --label <label>             Filter by label
  --label-group <group>       Filter by label group
  --meta key=value            Filter by metadata field, dot-notation supported (repeatable)
                              e.g. --meta sprint=Q1 --meta links.jira=PROJ-123

${bold('Add/Edit Options:')}
  --title <title>             Card title (required for add)
  --body <text>               Card body content
  --status <status>           Status
  --priority <priority>       Priority
  --assignee <name>           Assignee
  --due <date>                Due date
  --label <l1,l2>             Labels (comma-separated)
  --metadata '<json>'         Metadata as JSON string

${bold('Transfer Options:')}
  --from <board>              Source board (required)
  --to <board>                Destination board (required)
  --status <status>           Target status in destination board

${bold('Webhook Options:')}
  --url <url>                 Webhook target URL (required for add)
  --events <e1,e2>            Events to subscribe to (default: *)
  --secret <key>              HMAC-SHA256 signing secret

${bold('Serve Options:')}
  --port <number>             Port to listen on (default: 3000)
  --no-browser                Don't open browser automatically
`)
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

  const featuresDir = await resolveFeaturesDir(flags)
  const workspaceRoot = path.dirname(featuresDir)
  const sdk = new KanbanSDK(featuresDir, {
    onEvent: (event, data) => fireWebhooks(workspaceRoot, event, data)
  })

  switch (command) {
    case 'list':
    case 'ls':
      await cmdList(sdk, flags)
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
    case 'webhooks':
    case 'webhook':
    case 'wh':
      await cmdWebhooks(positional, flags, workspaceRoot)
      break
    case 'settings':
      await cmdSettings(positional, flags, workspaceRoot)
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
    default:
      console.error(red(`Unknown command: ${command}`))
      showHelp()
      process.exit(1)
  }
}

main().catch(err => {
  console.error(red(`Error: ${err.message}`))
  process.exit(1)
})

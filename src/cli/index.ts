import * as path from 'path'
import * as fs from 'fs/promises'
import { KanbanSDK } from '../sdk/KanbanSDK'
import type { Feature, FeatureStatus, Priority } from '../shared/types'
import { loadWebhooks, createWebhook, deleteWebhook } from '../standalone/webhooks'
import { readConfig, writeConfig, configToSettings, settingsToConfig } from '../shared/config'
import type { CardDisplaySettings } from '../shared/types'

const VALID_STATUSES: FeatureStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done']
const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

// --- Arg parsing ---

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | true> } {
  const args = argv.slice(2)
  const command = args[0] || 'help'
  const positional: string[] = []
  const flags: Record<string, string | true> = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
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

async function resolveFeaturesDir(flags: Record<string, string | true>): Promise<string> {
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
  if (c.completedAt) {
    lines.push(`  Completed: ${c.completedAt}`)
  }
  // Show body content (minus the title heading)
  const body = c.content.replace(/^#\s+.+\n?/, '').trim()
  if (body) {
    lines.push('', dim('  --- Content ---'), '', '  ' + body.split('\n').join('\n  '))
  }
  return lines.join('\n')
}

// --- Card Commands ---

async function cmdList(sdk: KanbanSDK, flags: Record<string, string | true>): Promise<void> {
  let cards = await sdk.listCards()

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

async function cmdShow(sdk: KanbanSDK, positional: string[], flags: Record<string, string | true>): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Error: card ID required. Usage: kl show <id>'))
    process.exit(1)
  }

  const card = await sdk.getCard(cardId)
  if (!card) {
    // Try partial match
    const all = await sdk.listCards()
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

async function cmdAdd(sdk: KanbanSDK, flags: Record<string, string | true>): Promise<void> {
  const title = typeof flags.title === 'string' ? flags.title : ''
  if (!title) {
    console.error(red('Error: --title is required. Usage: kl add --title "My card"'))
    process.exit(1)
  }

  const status = (typeof flags.status === 'string' ? flags.status : 'backlog') as FeatureStatus
  if (!VALID_STATUSES.includes(status)) {
    console.error(red(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`))
    process.exit(1)
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

  const content = `# ${title}${body ? '\n\n' + body : ''}`

  const card = await sdk.createCard({ content, status, priority, assignee, dueDate, labels })

  if (flags.json) {
    console.log(JSON.stringify(card, null, 2))
  } else {
    console.log(green(`Created: ${card.id}`))
    console.log(`  Status: ${colorStatus(card.status)}, Priority: ${colorPriority(card.priority)}`)
    console.log(`  File: ${dim(card.filePath)}`)
  }
}

async function cmdMove(sdk: KanbanSDK, positional: string[], flags: Record<string, string | true>): Promise<void> {
  const cardId = positional[0]
  const newStatus = positional[1] as FeatureStatus

  if (!cardId || !newStatus) {
    console.error(red('Usage: kl move <id> <status> [--position <n>]'))
    process.exit(1)
  }
  if (!VALID_STATUSES.includes(newStatus)) {
    console.error(red(`Invalid status: ${newStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`))
    process.exit(1)
  }

  // Support partial ID match
  let resolvedId = cardId
  const card = await sdk.getCard(cardId)
  if (!card) {
    const all = await sdk.listCards()
    const matches = all.filter(c => c.id.includes(cardId))
    if (matches.length === 1) {
      resolvedId = matches[0].id
    } else if (matches.length > 1) {
      console.error(red(`Multiple cards match "${cardId}":`))
      for (const m of matches) console.error(`  ${m.id}`)
      process.exit(1)
    } else {
      console.error(red(`Card not found: ${cardId}`))
      process.exit(1)
    }
  }

  const position = typeof flags.position === 'string' ? parseInt(flags.position, 10) : undefined
  const updated = await sdk.moveCard(resolvedId, newStatus, position)
  console.log(green(`Moved ${updated.id} → ${colorStatus(newStatus)}`))
}

async function cmdEdit(sdk: KanbanSDK, positional: string[], flags: Record<string, string | true>): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl edit <id> [--status ...] [--priority ...] [--assignee ...] [--due ...] [--label ...]'))
    process.exit(1)
  }

  // Support partial ID match
  let resolvedId = cardId
  const card = await sdk.getCard(cardId)
  if (!card) {
    const all = await sdk.listCards()
    const matches = all.filter(c => c.id.includes(cardId))
    if (matches.length === 1) {
      resolvedId = matches[0].id
    } else if (matches.length > 1) {
      console.error(red(`Multiple cards match "${cardId}":`))
      for (const m of matches) console.error(`  ${m.id}`)
      process.exit(1)
    } else {
      console.error(red(`Card not found: ${cardId}`))
      process.exit(1)
    }
  }

  const updates: Partial<Feature> = {}
  if (typeof flags.status === 'string') {
    if (!VALID_STATUSES.includes(flags.status as FeatureStatus)) {
      console.error(red(`Invalid status: ${flags.status}`))
      process.exit(1)
    }
    updates.status = flags.status as FeatureStatus
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

  if (Object.keys(updates).length === 0) {
    console.error(red('No updates specified. Use --status, --priority, --assignee, --due, or --label'))
    process.exit(1)
  }

  const updated = await sdk.updateCard(resolvedId, updates)
  console.log(green(`Updated: ${updated.id}`))
}

async function cmdDelete(sdk: KanbanSDK, positional: string[]): Promise<void> {
  const cardId = positional[0]
  if (!cardId) {
    console.error(red('Usage: kl delete <id>'))
    process.exit(1)
  }

  // Support partial ID match
  let resolvedId = cardId
  const card = await sdk.getCard(cardId)
  if (!card) {
    const all = await sdk.listCards()
    const matches = all.filter(c => c.id.includes(cardId))
    if (matches.length === 1) {
      resolvedId = matches[0].id
    } else if (matches.length > 1) {
      console.error(red(`Multiple cards match "${cardId}":`))
      for (const m of matches) console.error(`  ${m.id}`)
      process.exit(1)
    } else {
      console.error(red(`Card not found: ${cardId}`))
      process.exit(1)
    }
  }

  await sdk.deleteCard(resolvedId)
  console.log(green(`Deleted: ${resolvedId}`))
}

async function cmdInit(sdk: KanbanSDK): Promise<void> {
  await sdk.init()
  console.log(green(`Initialized: ${sdk.featuresDir}`))
}

// --- Attachment Commands ---

async function cmdAttach(sdk: KanbanSDK, positional: string[], flags: Record<string, string | true>): Promise<void> {
  const subcommand = positional[0] || 'list'
  const cardId = positional[1]

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'rm' && subcommand !== 'remove') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand)
    const attachments = await sdk.listAttachments(resolvedId)
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
      const resolvedId = await resolveCardId(sdk, cardId)
      const attachments = await sdk.listAttachments(resolvedId)
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
      const resolvedId = await resolveCardId(sdk, cardId)
      const updated = await sdk.addAttachment(resolvedId, filePath)
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
      const resolvedId = await resolveCardId(sdk, cardId)
      const updated = await sdk.removeAttachment(resolvedId, filename)
      console.log(green(`Removed from ${updated.id}: ${filename}`))
      break
    }
  }
}

async function resolveCardId(sdk: KanbanSDK, cardId: string): Promise<string> {
  const card = await sdk.getCard(cardId)
  if (card) return cardId

  const all = await sdk.listCards()
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

// --- Column Commands ---

async function cmdColumns(sdk: KanbanSDK, positional: string[], flags: Record<string, string | true>): Promise<void> {
  const subcommand = positional[0] || 'list'

  switch (subcommand) {
    case 'list': {
      const columns = await sdk.listColumns()
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
      const columns = await sdk.addColumn({ id, name, color })
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
      const columns = await sdk.updateColumn(columnId, updates)
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
      const columns = await sdk.removeColumn(columnId)
      console.log(green(`Removed column: ${columnId}`))
      if (flags.json) console.log(JSON.stringify(columns, null, 2))
      break
    }
    default:
      console.error(red(`Unknown columns subcommand: ${subcommand}`))
      console.error('Available: list, add, update, remove')
      process.exit(1)
  }
}

// --- Webhook Commands ---

async function cmdWebhooks(positional: string[], flags: Record<string, string | true>, workspaceRoot: string): Promise<void> {
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
    default:
      console.error(red(`Unknown webhooks subcommand: ${subcommand}`))
      console.error('Available: list, add, remove')
      process.exit(1)
  }
}

// --- Settings Commands ---

const SETTINGS_KEYS = [
  'showPriorityBadges', 'showAssignee', 'showDueDate', 'showLabels',
  'showFileName', 'compactMode', 'defaultPriority', 'defaultStatus'
] as const

async function cmdSettings(positional: string[], flags: Record<string, string | true>, workspaceRoot: string): Promise<void> {
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

async function cmdServe(flags: Record<string, string | true>): Promise<void> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.kanban'
  const port = typeof flags.port === 'string' ? parseInt(flags.port, 10) : 3000
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

${bold('Attachment Commands:')}
  attach <id>                 List attachments on a card
  attach add <id> <path>      Attach a file to a card
  attach remove <id> <name>   Remove an attachment from a card

${bold('Column Commands:')}
  columns                     List columns
  columns add                 Add a column (--id, --name, --color)
  columns update <id>         Update a column (--name, --color)
  columns remove <id>         Remove a column

${bold('Webhook Commands:')}
  webhooks                    List registered webhooks
  webhooks add                Register a webhook (--url, --events, --secret)
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
  --json                      Output as JSON

${bold('List Filters:')}
  --status <status>           Filter by status
  --priority <priority>       Filter by priority (critical, high, medium, low)
  --assignee <name>           Filter by assignee
  --label <label>             Filter by label

${bold('Add/Edit Options:')}
  --title <title>             Card title (required for add)
  --body <text>               Card body content
  --status <status>           Status
  --priority <priority>       Priority
  --assignee <name>           Assignee
  --due <date>                Due date
  --label <l1,l2>             Labels (comma-separated)

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

  if (command === 'help' || flags.help) {
    showHelp()
    return
  }

  // Serve doesn't need SDK
  if (command === 'serve') {
    await cmdServe(flags)
    return
  }

  const featuresDir = await resolveFeaturesDir(flags)
  const workspaceRoot = path.dirname(featuresDir)
  const sdk = new KanbanSDK(featuresDir)

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
      await cmdDelete(sdk, positional)
      break
    case 'attach':
      await cmdAttach(sdk, positional, flags)
      break
    case 'columns':
    case 'cols':
      await cmdColumns(sdk, positional, flags)
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

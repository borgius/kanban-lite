import * as fs from 'fs/promises'
import * as path from 'path'
import { bold, cyan, dim, red } from './output'

const HELP_TOPICS: Record<string, string> = {
  sdk: 'docs/sdk.md',
  api: 'docs/api.md',
}

function formatMarkdownForTerminal(md: string): string {
  return md
    .split('\n')
    .map(line => {
      if (line.startsWith('# ')) return '\n' + bold(line.slice(2))
      if (line.startsWith('## ')) return '\n' + bold(line.slice(3))
      if (line.startsWith('### ')) return '\n' + cyan(line.slice(4))
      if (line.startsWith('#### ')) return dim(line.slice(5))
      if (/^---+$/.test(line.trim())) return ''
      return line.replace(/\*\*(.+?)\*\*/g, (_m, p1) => bold(p1))
    })
    .join('\n')
}

export async function findPackageRoot(): Promise<string> {
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

export async function showDocHelp(topic: string): Promise<void> {
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

export function showHelp(): void {
  console.log(`
${bold('kanban-lite')} (${bold('kl')}) - Manage your kanban board from the command line

${bold('Usage:')}
  kanban-lite <command> [options]
  kl <command> [options]

${bold('Card Commands:')}
  list                        List cards
  active                      Show the currently active/open card
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
  comment stream <id>         Stream a comment from stdin (--author)
  comment edit <id> <cid>     Edit a comment (--body)
  comment remove <id> <cid>   Remove a comment

${bold('Log Commands:')}
  log list <id>               List log entries on a card
  log add <id>                Add a log entry (--text, --source, --object)
  log clear <id>              Clear all log entries

${bold('Board Log Commands:')}
  board-log list              List board-level log entries
  board-log add               Add a board log entry (--text, --source, --object)
  board-log clear             Clear all board log entries

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

${bold('Form Commands:')}
  form submit <id> <form>     Submit a card form (--data <json|@file>)

${bold('Checklist Commands:')}
  checklist list <id>         List checklist items on a card
  checklist add <id> --title <title> --expected-token <token>
                              Add a checklist item to a card
  checklist edit <id> <index> Edit a checklist item (--title, --description, --modified-at)
  checklist delete <id> <index>
                              Delete a checklist item (--modified-at)
  checklist check <id> <index> --modified-at <iso>
                              Check a checklist item
  checklist uncheck <id> <index> --modified-at <iso>
                              Uncheck a checklist item

${bold('Settings Commands:')}
  settings                    Show current settings
  settings update             Update settings (--<key> <value>)

${bold('Plugin Settings Commands:')}
  plugin-settings list                               List plugin providers
  plugin-settings show <capability> <provider>      Read plugin settings
  plugin-settings select <capability> <provider>    Select plugin provider
  plugin-settings update-options <capability> <provider>
                                                    Update plugin options (--options <json|@file>)
  plugin-settings install <packageName> --scope <workspace|global>
                                                    Install a supported plugin package

${bold('Server:')}
  serve                       Start standalone web server with REST API
  mcp                         Start MCP server over stdio (for AI integrations)

${bold('Other:')}
  init                        Initialize cards directory
  events                      List available built-in and plugin-declared events
  pwd                         Print workspace root path

${bold('Global Options:')}
  --dir <path>                Kanban directory (default: .kanban)
  --config <path>             Path to the workspace .kanban.json file
  --token <value>             API token override for this CLI invocation
  --board <id>                Target board (default: default board)
  --json                      Output as JSON
  --type <phase>              Event phase filter for [1mevents[0m (before, after, all)
  --mask <pattern>            Wildcard event mask for [1mevents[0m (for example task.*)

${bold('List Filters:')}
  --search <text>            Search card content and inline metadata tokens
  --fuzzy                    Enable fuzzy search for --search and metadata token matching
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
  --tasks '<json|@file>'      Seed checklist items as a JSON array of markdown lines
  --metadata '<json>'         Metadata as JSON string
  --forms '<json|@file>'      Form attachments as a JSON array
  --form-data '<json|@file>'  Per-form data map as a JSON object

${bold('Form Options:')}
  --data '<json|@file>'       Form submission payload as a JSON object

${bold('Checklist Options:')}
  --text <text>               Checklist item text for add/edit
  --expected-token <token>   Latest checklist token required for add optimistic concurrency
  --title <title>            Checklist item title for add/edit
  --description <text>       Checklist item description for add/edit
  --modified-at <iso>        Current checklist item modifiedAt value for stale-write protection

${bold('Transfer Options:')}
  --from <board>              Source board (required)
  --to <board>                Destination board (required)
  --status <status>           Target status in destination board

${bold('Log Options:')}
  --text <text>               Log message text (required for log add, supports markdown)
  --source <label>            Source/origin label (default: "default")
  --object '<json>'           Structured data object as JSON string

${bold('Serve Options:')}
  --port <number>             Port to listen on (default: 3000)
  --no-browser                Don't open browser automatically

${bold('Storage Commands:')}
  storage status              Show current storage engine
  storage migrate-to-sqlite   Migrate cards to SQLite (--sqlite-path <path>)
  storage migrate-to-markdown Migrate cards back to markdown files

${bold('Card State Commands:')}
  card-state status [id]      Show backend/default-actor status or a card unread summary
  card-state open <id>        Explicitly acknowledge unread activity and record open-card state
  card-state read <id>        Explicitly acknowledge unread activity without changing open-card state

${bold('Auth Commands:')}
  auth status                 Show active auth providers and token diagnostics
`)
}

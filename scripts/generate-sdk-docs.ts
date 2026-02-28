#!/usr/bin/env npx tsx
/**
 * Generates docs/sdk.md from JSDoc comments in the SDK source files
 * using jsdoc-to-markdown.
 *
 * Steps:
 * 1. Compile TypeScript sources → temporary JS (preserving JSDoc)
 * 2. Run jsdoc-to-markdown on the compiled JS
 * 3. Assemble the final markdown with header/footer sections
 * 4. Clean up temp files
 *
 * Usage: npx tsx scripts/generate-sdk-docs.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import jsdoc2md from 'jsdoc-to-markdown'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'sdk.md')
const TEMP_DIR = path.join(ROOT, '.tmp-docs')

const HEADER = `# Kanban Lite SDK

The \`KanbanSDK\` class is the core engine behind Kanban Lite. It provides a complete, async API for managing cards, comments, attachments, columns, and board settings. The CLI, MCP server, VSCode extension, and standalone web server all delegate to this single SDK — so behavior is consistent everywhere.

## Installation

\`\`\`bash
npm install kanban-lite
\`\`\`

## Import

\`\`\`typescript
import { KanbanSDK } from 'kanban-lite/sdk'
\`\`\`

You can also import types and utilities:

\`\`\`typescript
import type { Card, CardStatus, Priority, KanbanColumn, CardDisplaySettings, CreateCardInput } from 'kanban-lite/sdk'
import { parseCardFile, serializeCard, getTitleFromContent, DEFAULT_COLUMNS } from 'kanban-lite/sdk'
import { readConfig, writeConfig, configToSettings, settingsToConfig } from 'kanban-lite/sdk'
\`\`\`

## Quick Start

\`\`\`typescript
import { KanbanSDK } from 'kanban-lite/sdk'

const sdk = new KanbanSDK('/path/to/project/.kanban')

// Create a card
const card = await sdk.createCard({
  content: '# Implement auth\\n\\nAdd OAuth2 login flow.',
  status: 'todo',
  priority: 'high',
  labels: ['backend', 'security']
})

// List all cards (sorted by order)
const cards = await sdk.listCards()

// Move card to a different column
await sdk.moveCard(card.id, 'in-progress')

// Add a comment
await sdk.addComment(card.id, 'alice', 'Started working on this')

// Clean up
await sdk.deleteCard(card.id)
\`\`\`

---

`

// Source files in rendering order, with relative paths from ROOT
const SOURCE_GROUPS: { title: string; files: string[] }[] = [
  {
    title: 'KanbanSDK Class',
    files: ['src/sdk/KanbanSDK.ts'],
  },
  {
    title: 'Types',
    files: ['src/shared/types.ts', 'src/sdk/types.ts'],
  },
  {
    title: 'Configuration',
    files: ['src/shared/config.ts'],
  },
  {
    title: 'Parser',
    files: ['src/sdk/parser.ts'],
  },
  {
    title: 'File Utilities',
    files: ['src/sdk/fileUtils.ts'],
  },
]

function compileTypeScript(): void {
  // Collect all source files as absolute paths
  const allFiles = SOURCE_GROUPS.flatMap(g =>
    g.files.map(f => path.join(ROOT, f))
  )

  // Create a temporary tsconfig for doc generation
  // jsdoc-to-markdown requires CommonJS output to parse correctly
  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'CommonJS',
      moduleResolution: 'node',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      removeComments: false,
      declaration: false,
      outDir: TEMP_DIR,
      rootDir: path.join(ROOT, 'src'),
    },
    files: allFiles,
  }

  const tsconfigPath = path.join(TEMP_DIR, 'tsconfig.docs.json')
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))

  execSync(`npx tsc -p ${tsconfigPath}`, {
    cwd: ROOT,
    stdio: 'pipe',
  })
}

function cleanup(): void {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true })
}

function getTempFile(tsRelativePath: string): string {
  // src/sdk/KanbanSDK.ts → .tmp-docs/sdk/KanbanSDK.js
  return path.join(TEMP_DIR, tsRelativePath.replace(/^src\//, '').replace(/\.ts$/, '.js'))
}

async function main() {
  console.log('Compiling TypeScript sources...')
  try {
    compileTypeScript()
  } catch (err) {
    console.error('TypeScript compilation failed:', err)
    cleanup()
    process.exit(1)
  }

  const sections: string[] = [HEADER]

  for (const group of SOURCE_GROUPS) {
    const jsFiles = group.files.map(f => getTempFile(f))

    // Verify compiled files exist
    for (const f of jsFiles) {
      if (!fs.existsSync(f)) {
        console.error(`Compiled file not found: ${f}`)
        cleanup()
        process.exit(1)
      }
    }

    let md: string
    try {
      md = await jsdoc2md.render({
        files: jsFiles,
        'heading-depth': 3,
        'module-index-format': 'none',
        'global-index-format': 'none',
        'param-list-format': 'table',
        'property-list-format': 'table',
        separators: true,
      })
    } catch (err) {
      console.error(`Failed to render ${group.title}:`, err)
      cleanup()
      process.exit(1)
    }

    if (md.trim()) {
      sections.push(`## ${group.title}\n\n${md}`)
    }
  }

  // Add data storage and error sections
  sections.push(`## Data Storage

Cards are stored as markdown files with YAML frontmatter:

\`\`\`
.kanban/
  boards/
    default/
      backlog/
        1-implement-auth.md
        2-setup-ci.md
      todo/
      in-progress/
      review/
      done/
    bugs/
      new/
      investigating/
      fixed/
  .kanban.json          # Board configuration (v2)
  .kanban-webhooks.json # Webhook definitions
\`\`\`

Each card file contains YAML frontmatter (id, status, priority, assignee, dates, labels, order) followed by markdown content and optional comment sections.

---

## Error Handling

All SDK methods throw standard \`Error\` objects with descriptive messages:

| Error | Cause |
|-------|-------|
| \`Card not found: {id}\` | No card matches the given ID |
| \`Board not found: {id}\` | Board ID doesn't exist in config |
| \`Board already exists: {id}\` | Duplicate board ID on create |
| \`Cannot delete the default board: {id}\` | Attempted to delete default board |
| \`Cannot delete board "{id}": N card(s) still exist\` | Board has cards |
| \`Column not found: {id}\` | Column ID doesn't exist |
| \`Column already exists: {id}\` | Duplicate column ID on add |
| \`Cannot remove column "{id}": N card(s) still in this column\` | Column has cards |
| \`Must include all column IDs when reordering\` | Missing columns in reorder |
| \`Comment not found: {id}\` | Comment ID doesn't exist |
`)

  cleanup()

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, sections.join('\n'), 'utf-8')
  console.log(`Generated ${OUT} (${sections.join('\n').length} bytes)`)
}

main().catch(err => {
  console.error(err)
  cleanup()
  process.exit(1)
})

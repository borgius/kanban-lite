import * as path from 'path'
import * as fs from 'fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { KanbanSDK } from '../sdk/KanbanSDK'
import type { FeatureStatus, Priority } from '../shared/types'

// --- Resolve features directory ---

async function findWorkspaceRoot(startDir: string): Promise<string> {
  let dir = startDir
  while (true) {
    try {
      await fs.access(path.join(dir, '.git'))
      return dir
    } catch { /* continue */ }
    try {
      await fs.access(path.join(dir, 'package.json'))
      return dir
    } catch { /* continue */ }
    const parent = path.dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
}

async function resolveFeaturesDir(): Promise<string> {
  // 1. CLI arg --dir
  const dirIndex = process.argv.indexOf('--dir')
  if (dirIndex !== -1 && process.argv[dirIndex + 1]) {
    return path.resolve(process.argv[dirIndex + 1])
  }
  // 2. Environment variable
  if (process.env.KANBAN_FEATURES_DIR) {
    return path.resolve(process.env.KANBAN_FEATURES_DIR)
  }
  // 3. Auto-detect from cwd
  const root = await findWorkspaceRoot(process.cwd())
  return path.join(root, '.devtool', 'features')
}

function getTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return firstLine || 'Untitled'
}

// --- Main ---

async function main(): Promise<void> {
  const featuresDir = await resolveFeaturesDir()
  const sdk = new KanbanSDK(featuresDir)

  const server = new McpServer({
    name: 'kanban-markdown',
    version: '1.0.0',
  })

  // --- Card Tools ---

  server.tool(
    'list_cards',
    'List all kanban cards. Optionally filter by status, priority, assignee, or label.',
    {
      status: z.enum(['backlog', 'todo', 'in-progress', 'review', 'done']).optional().describe('Filter by status'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter by priority'),
      assignee: z.string().optional().describe('Filter by assignee name'),
      label: z.string().optional().describe('Filter by label'),
    },
    async ({ status, priority, assignee, label }) => {
      let cards = await sdk.listCards()
      if (status) cards = cards.filter(c => c.status === status)
      if (priority) cards = cards.filter(c => c.priority === priority)
      if (assignee) cards = cards.filter(c => c.assignee === assignee)
      if (label) cards = cards.filter(c => c.labels.includes(label))

      const summary = cards.map(c => ({
        id: c.id,
        title: getTitleFromContent(c.content),
        status: c.status,
        priority: c.priority,
        assignee: c.assignee,
        labels: c.labels,
        dueDate: c.dueDate,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2),
        }],
      }
    }
  )

  server.tool(
    'get_card',
    'Get full details of a specific kanban card by ID. Supports partial ID matching.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ cardId }) => {
      let card = await sdk.getCard(cardId)
      if (!card) {
        // Try partial match
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          card = matches[0]
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(card, null, 2),
        }],
      }
    }
  )

  server.tool(
    'create_card',
    'Create a new kanban card. Returns the created card.',
    {
      title: z.string().describe('Card title'),
      body: z.string().optional().describe('Card body/description (markdown)'),
      status: z.enum(['backlog', 'todo', 'in-progress', 'review', 'done']).optional().describe('Initial status (default: backlog)'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Priority level (default: medium)'),
      assignee: z.string().optional().describe('Assignee name'),
      dueDate: z.string().optional().describe('Due date (ISO format or YYYY-MM-DD)'),
      labels: z.array(z.string()).optional().describe('Labels/tags'),
    },
    async ({ title, body, status, priority, assignee, dueDate, labels }) => {
      const content = `# ${title}${body ? '\n\n' + body : ''}`

      const card = await sdk.createCard({
        content,
        status: status as FeatureStatus | undefined,
        priority: priority as Priority | undefined,
        assignee: assignee || null,
        dueDate: dueDate || null,
        labels: labels || [],
      })

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(card, null, 2),
        }],
      }
    }
  )

  server.tool(
    'update_card',
    'Update fields of an existing kanban card. Only specified fields are changed.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
      status: z.enum(['backlog', 'todo', 'in-progress', 'review', 'done']).optional().describe('New status'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('New priority'),
      assignee: z.string().optional().describe('New assignee'),
      dueDate: z.string().optional().describe('New due date'),
      labels: z.array(z.string()).optional().describe('New labels (replaces existing)'),
      content: z.string().optional().describe('New markdown content (replaces existing body)'),
    },
    async ({ cardId, status, priority, assignee, dueDate, labels, content }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId)
      if (!card) {
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          resolvedId = matches[0].id
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      const updates: Record<string, unknown> = {}
      if (status) updates.status = status
      if (priority) updates.priority = priority
      if (assignee !== undefined) updates.assignee = assignee || null
      if (dueDate !== undefined) updates.dueDate = dueDate || null
      if (labels) updates.labels = labels
      if (content !== undefined) updates.content = content

      const updated = await sdk.updateCard(resolvedId, updates)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(updated, null, 2),
        }],
      }
    }
  )

  server.tool(
    'move_card',
    'Move a kanban card to a different status column.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
      status: z.enum(['backlog', 'todo', 'in-progress', 'review', 'done']).describe('Target status column'),
    },
    async ({ cardId, status }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId)
      if (!card) {
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          resolvedId = matches[0].id
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      const updated = await sdk.moveCard(resolvedId, status as FeatureStatus)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ id: updated.id, status: updated.status, order: updated.order }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'delete_card',
    'Permanently delete a kanban card.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ cardId }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId)
      if (!card) {
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          resolvedId = matches[0].id
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      await sdk.deleteCard(resolvedId)

      return {
        content: [{
          type: 'text' as const,
          text: `Deleted card: ${resolvedId}`,
        }],
      }
    }
  )

  // --- Attachment Tools ---

  server.tool(
    'list_attachments',
    'List all attachments on a kanban card.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ cardId }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId)
      if (!card) {
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          resolvedId = matches[0].id
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      const attachments = await sdk.listAttachments(resolvedId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(attachments, null, 2),
        }],
      }
    }
  )

  server.tool(
    'add_attachment',
    'Add a file attachment to a kanban card. Copies the file to the card directory.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
      filePath: z.string().describe('Absolute path to the file to attach'),
    },
    async ({ cardId, filePath }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId)
      if (!card) {
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          resolvedId = matches[0].id
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      const updated = await sdk.addAttachment(resolvedId, filePath)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ id: updated.id, attachments: updated.attachments }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'remove_attachment',
    'Remove an attachment from a kanban card. Only removes the reference, not the file.',
    {
      cardId: z.string().describe('Card ID (or partial ID)'),
      attachment: z.string().describe('Attachment filename to remove'),
    },
    async ({ cardId, attachment }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId)
      if (!card) {
        const all = await sdk.listCards()
        const matches = all.filter(c => c.id.includes(cardId))
        if (matches.length === 1) {
          resolvedId = matches[0].id
        } else if (matches.length > 1) {
          return {
            content: [{ type: 'text' as const, text: `Multiple cards match "${cardId}": ${matches.map(m => m.id).join(', ')}` }],
            isError: true,
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
            isError: true,
          }
        }
      }

      const updated = await sdk.removeAttachment(resolvedId, attachment)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ id: updated.id, attachments: updated.attachments }, null, 2),
        }],
      }
    }
  )

  // --- Column Tools ---

  server.tool(
    'list_columns',
    'List all kanban board columns.',
    {},
    async () => {
      const columns = await sdk.listColumns()
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
      id: z.string().describe('Unique column ID (used in card status field)'),
      name: z.string().describe('Display name for the column'),
      color: z.string().describe('Column color (hex format, e.g. "#3b82f6")'),
    },
    async ({ id, name, color }) => {
      const columns = await sdk.addColumn({ id, name, color })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(columns, null, 2),
        }],
      }
    }
  )

  server.tool(
    'update_column',
    'Update an existing kanban board column.',
    {
      columnId: z.string().describe('Column ID to update'),
      name: z.string().optional().describe('New display name'),
      color: z.string().optional().describe('New color (hex format)'),
    },
    async ({ columnId, name, color }) => {
      const updates: Record<string, string> = {}
      if (name) updates.name = name
      if (color) updates.color = color
      const columns = await sdk.updateColumn(columnId, updates)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(columns, null, 2),
        }],
      }
    }
  )

  server.tool(
    'remove_column',
    'Remove a column from the kanban board. Fails if any cards are in the column.',
    {
      columnId: z.string().describe('Column ID to remove'),
    },
    async ({ columnId }) => {
      const columns = await sdk.removeColumn(columnId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(columns, null, 2),
        }],
      }
    }
  )

  // --- Start server ---

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error(`MCP Server error: ${err.message}`)
  process.exit(1)
})

import * as path from 'path'
import * as fs from 'fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { DELETED_STATUS_ID, type Priority, type CardSortOption } from '../shared/types'
import { readConfig, writeConfig, configToSettings, settingsToConfig } from '../shared/config'
import { loadWebhooks, createWebhook, deleteWebhook, updateWebhook, fireWebhooks } from '../standalone/webhooks'
import { matchesMetaFilter } from '../sdk/metaUtils'

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
  const workspaceRoot = path.dirname(featuresDir)
  const sdk = new KanbanSDK(featuresDir, {
    onEvent: (event, data) => fireWebhooks(workspaceRoot, event, data)
  })

  const server = new McpServer({
    name: 'kanban-lite',
    version: '1.0.0',
  })

  // --- Board Management Tools ---

  server.tool('list_boards', 'List all kanban boards.', {}, async () => {
    const boards = sdk.listBoards()
    return { content: [{ type: 'text' as const, text: JSON.stringify(boards, null, 2) }] }
  })

  server.tool('create_board', 'Create a new kanban board.', {
    id: z.string().describe('Board ID (used in directory name)'),
    name: z.string().describe('Display name'),
    description: z.string().optional().describe('Board description'),
    columns: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).optional().describe('Board columns (defaults to standard columns)'),
  }, async ({ id, name, description, columns }) => {
    try {
      const board = sdk.createBoard(id, name, { description, columns })
      return { content: [{ type: 'text' as const, text: JSON.stringify(board, null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  server.tool('get_board', 'Get details of a specific board.', {
    boardId: z.string().describe('Board ID'),
  }, async ({ boardId }) => {
    try {
      const board = sdk.getBoard(boardId)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: boardId, ...board }, null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  server.tool('delete_board', 'Delete an empty kanban board.', {
    boardId: z.string().describe('Board ID to delete'),
  }, async ({ boardId }) => {
    try {
      await sdk.deleteBoard(boardId)
      return { content: [{ type: 'text' as const, text: `Deleted board: ${boardId}` }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  server.tool('transfer_card', 'Transfer a card from one board to another.', {
    cardId: z.string().describe('Card ID'),
    fromBoard: z.string().describe('Source board ID'),
    toBoard: z.string().describe('Target board ID'),
    targetStatus: z.string().optional().describe('Status in the target board (defaults to board default)'),
  }, async ({ cardId, fromBoard, toBoard, targetStatus }) => {
    try {
      const card = await sdk.transferCard(cardId, fromBoard, toBoard, targetStatus)
      return { content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  // --- Card Tools ---

  server.tool(
    'list_cards',
    'List all kanban cards. Optionally filter by status, priority, assignee, label, or metadata fields.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      status: z.string().optional().describe('Filter by status'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter by priority'),
      assignee: z.string().optional().describe('Filter by assignee name'),
      label: z.string().optional().describe('Filter by label'),
      labelGroup: z.string().optional().describe('Filter by label group name'),
      includeDeleted: z.boolean().optional().default(false).describe('Include soft-deleted cards in results'),
      metaFilter: z.record(z.string(), z.string()).optional().describe('Filter by metadata fields using dot-notation keys (e.g. { "links.jira": "PROJ-123" }). Substring match, case-insensitive.'),
      sort: z.enum(['created:asc', 'created:desc', 'modified:asc', 'modified:desc']).optional().describe('Sort order: created:asc, created:desc, modified:asc, or modified:desc. Defaults to board order.'),
    },
    async ({ boardId, status, priority, assignee, label, labelGroup, includeDeleted, metaFilter, sort }) => {
      let cards = await sdk.listCards(undefined, boardId)
      if (!includeDeleted) cards = cards.filter(c => c.status !== DELETED_STATUS_ID)
      if (status) cards = cards.filter(c => c.status === status)
      if (priority) cards = cards.filter(c => c.priority === priority)
      if (assignee) cards = cards.filter(c => c.assignee === assignee)
      if (label) cards = cards.filter(c => c.labels.includes(label))
      if (labelGroup) {
        const groupLabels = sdk.getLabelsInGroup(labelGroup)
        cards = cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
      }
      if (metaFilter && Object.keys(metaFilter).length > 0)
        cards = cards.filter(c => matchesMetaFilter(c.metadata, metaFilter))
      if (sort) {
        const [field, dir] = (sort as CardSortOption).split(':')
        cards = [...cards].sort((a, b) => {
          const aVal = field === 'created' ? a.created : a.modified
          const bVal = field === 'created' ? b.created : b.modified
          return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
        })
      }

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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      let card = await sdk.getCard(cardId, boardId)
      if (!card) {
        // Try partial match
        const all = await sdk.listCards(undefined, boardId)
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      title: z.string().describe('Card title'),
      body: z.string().optional().describe('Card body/description (markdown)'),
      status: z.string().optional().describe('Initial status (default: backlog)'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Priority level (default: medium)'),
      assignee: z.string().optional().describe('Assignee name'),
      dueDate: z.string().optional().describe('Due date (ISO format or YYYY-MM-DD)'),
      labels: z.array(z.string()).optional().describe('Labels/tags'),
      metadata: z.record(z.string(), z.any()).optional().describe('Custom metadata as key-value pairs (supports nested objects)'),
      actions: z.array(z.string()).optional().describe('Action names available on this card (e.g. ["retry", "sendEmail"])'),
    },
    async ({ boardId, title, body, status, priority, assignee, dueDate, labels, metadata, actions }) => {
      const content = `# ${title}${body ? '\n\n' + body : ''}`

      const card = await sdk.createCard({
        content,
        status: status || undefined,
        priority: priority as Priority | undefined,
        assignee: assignee || null,
        dueDate: dueDate || null,
        labels: labels || [],
        metadata,
        actions,
        boardId,
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      status: z.string().optional().describe('New status'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('New priority'),
      assignee: z.string().optional().describe('New assignee'),
      dueDate: z.string().optional().describe('New due date'),
      labels: z.array(z.string()).optional().describe('New labels (replaces existing)'),
      content: z.string().optional().describe('New markdown content (replaces existing body)'),
      metadata: z.record(z.string(), z.any()).optional().describe('Custom metadata as key-value pairs (replaces existing)'),
      actions: z.array(z.string()).optional().describe('Action names available on this card (replaces existing)'),
    },
    async ({ boardId, cardId, status, priority, assignee, dueDate, labels, content, metadata, actions }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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
      if (metadata !== undefined) updates.metadata = metadata
      if (actions !== undefined) updates.actions = actions

      const updated = await sdk.updateCard(resolvedId, updates, boardId)

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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      status: z.string().describe('Target status column'),
    },
    async ({ boardId, cardId, status }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      const updated = await sdk.moveCard(resolvedId, status, undefined, boardId)

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
    'Soft-delete a kanban card (moves to deleted status). Use permanent_delete_card to remove from disk.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      await sdk.deleteCard(resolvedId, boardId)

      return {
        content: [{
          type: 'text' as const,
          text: `Soft-deleted card: ${resolvedId} (moved to deleted status)`,
        }],
      }
    }
  )

  server.tool(
    'permanent_delete_card',
    'Permanently delete a kanban card from disk. This cannot be undone.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      // Resolve partial ID
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      await sdk.permanentlyDeleteCard(resolvedId, boardId)

      return {
        content: [{
          type: 'text' as const,
          text: `Permanently deleted card: ${resolvedId}`,
        }],
      }
    }
  )

  server.tool(
    'trigger_action',
    'Trigger a named action on a card. The action name must match one of the card\'s configured actions. Calls the configured action webhook URL with the action name and card details.',
    {
      card_id: z.string().describe('Card ID (partial match supported)'),
      action: z.string().describe('Action name to trigger'),
      board_id: z.string().optional().describe('Board ID (omit for default board)'),
    },
    async ({ card_id, action, board_id }) => {
      try {
        await sdk.triggerAction(card_id, action, board_id)
        return {
          content: [{ type: 'text' as const, text: `Action "${action}" triggered successfully on card ${card_id}` }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        }
      }
    }
  )

  // --- Attachment Tools ---

  server.tool(
    'list_attachments',
    'List all attachments on a kanban card.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      const attachments = await sdk.listAttachments(resolvedId, boardId)
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      filePath: z.string().describe('Absolute path to the file to attach'),
    },
    async ({ boardId, cardId, filePath }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      const updated = await sdk.addAttachment(resolvedId, filePath, boardId)
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      attachment: z.string().describe('Attachment filename to remove'),
    },
    async ({ boardId, cardId, attachment }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      const updated = await sdk.removeAttachment(resolvedId, attachment, boardId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ id: updated.id, attachments: updated.attachments }, null, 2),
        }],
      }
    }
  )

  // --- Comment Tools ---

  server.tool(
    'list_comments',
    'List all comments on a kanban card.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      const comments = await sdk.listComments(resolvedId, boardId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(comments, null, 2),
        }],
      }
    }
  )

  server.tool(
    'add_comment',
    'Add a comment to a kanban card.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      author: z.string().describe('Comment author name'),
      content: z.string().describe('Comment text (supports markdown)'),
    },
    async ({ boardId, cardId, author, content }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      const updated = await sdk.addComment(resolvedId, author, content, boardId)
      const added = updated.comments[updated.comments.length - 1]
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(added, null, 2),
        }],
      }
    }
  )

  server.tool(
    'update_comment',
    'Update the content of a comment on a kanban card.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      commentId: z.string().describe('Comment ID (e.g. "c1")'),
      content: z.string().describe('New comment text'),
    },
    async ({ boardId, cardId, commentId, content }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      try {
        const updated = await sdk.updateComment(resolvedId, commentId, content, boardId)
        const comment = updated.comments.find(c => c.id === commentId)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(comment, null, 2),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'delete_comment',
    'Delete a comment from a kanban card.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      commentId: z.string().describe('Comment ID (e.g. "c1")'),
    },
    async ({ boardId, cardId, commentId }) => {
      let resolvedId = cardId
      const card = await sdk.getCard(cardId, boardId)
      if (!card) {
        const all = await sdk.listCards(undefined, boardId)
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

      try {
        await sdk.deleteComment(resolvedId, commentId, boardId)
        return {
          content: [{
            type: 'text' as const,
            text: `Deleted comment ${commentId} from card ${resolvedId}`,
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        }
      }
    }
  )

  // --- Column Tools ---

  server.tool(
    'list_columns',
    'List all kanban board columns.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ boardId }) => {
      const columns = await sdk.listColumns(boardId)
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      id: z.string().describe('Unique column ID (used in card status field)'),
      name: z.string().describe('Display name for the column'),
      color: z.string().describe('Column color (hex format, e.g. "#3b82f6")'),
    },
    async ({ boardId, id, name, color }) => {
      const columns = await sdk.addColumn({ id, name, color }, boardId)
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      columnId: z.string().describe('Column ID to update'),
      name: z.string().optional().describe('New display name'),
      color: z.string().optional().describe('New color (hex format)'),
    },
    async ({ boardId, columnId, name, color }) => {
      const updates: Record<string, string> = {}
      if (name) updates.name = name
      if (color) updates.color = color
      const columns = await sdk.updateColumn(columnId, updates, boardId)
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
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      columnId: z.string().describe('Column ID to remove'),
    },
    async ({ boardId, columnId }) => {
      const columns = await sdk.removeColumn(columnId, boardId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(columns, null, 2),
        }],
      }
    }
  )

  server.tool(
    'cleanup_column',
    'Move all cards in a column to the deleted (soft-delete) column. The column itself is kept.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      columnId: z.string().describe('Column ID to clean up'),
    },
    async ({ boardId, columnId }) => {
      const moved = await sdk.cleanupColumn(columnId, boardId)
      return {
        content: [{
          type: 'text' as const,
          text: `Moved ${moved} card${moved === 1 ? '' : 's'} from "${columnId}" to deleted`,
        }],
      }
    }
  )

  // --- Label Tools ---

  server.tool('list_labels', 'List all label definitions with colors and groups', {
    boardId: z.string().optional().describe('Board ID')
  }, async () => {
    const labels = sdk.getLabels()
    return { content: [{ type: 'text' as const, text: JSON.stringify(labels, null, 2) }] }
  })

  server.tool('set_label', 'Create or update a label definition', {
    name: z.string().describe('Label name'),
    color: z.string().describe('Hex color (e.g. "#e11d48")'),
    group: z.string().optional().describe('Optional group name (e.g. "Type", "Priority")')
  }, async ({ name, color, group }) => {
    sdk.setLabel(name, { color, group })
    return { content: [{ type: 'text' as const, text: `Label "${name}" set with color ${color}${group ? ` in group "${group}"` : ''}` }] }
  })

  server.tool('rename_label', 'Rename a label (cascades to all cards)', {
    oldName: z.string().describe('Current label name'),
    newName: z.string().describe('New label name')
  }, async ({ oldName, newName }) => {
    await sdk.renameLabel(oldName, newName)
    return { content: [{ type: 'text' as const, text: `Label "${oldName}" renamed to "${newName}"` }] }
  })

  server.tool('delete_label', 'Remove a label definition and remove it from all cards', {
    name: z.string().describe('Label name to remove')
  }, async ({ name }) => {
    await sdk.deleteLabel(name)
    return { content: [{ type: 'text' as const, text: `Label "${name}" definition removed` }] }
  })

  // --- Settings Tools ---

  server.tool(
    'get_settings',
    'Get the current kanban board display settings.',
    {},
    async () => {
      const config = readConfig(workspaceRoot)
      const settings = configToSettings(config)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(settings, null, 2),
        }],
      }
    }
  )

  server.tool(
    'update_settings',
    'Update kanban board display settings. Only specified fields are changed.',
    {
      showPriorityBadges: z.boolean().optional().describe('Show priority badges on cards'),
      showAssignee: z.boolean().optional().describe('Show assignee on cards'),
      showDueDate: z.boolean().optional().describe('Show due date on cards'),
      showLabels: z.boolean().optional().describe('Show labels on cards'),
      showFileName: z.boolean().optional().describe('Show file name on cards'),
      compactMode: z.boolean().optional().describe('Enable compact card display'),
      showDeletedColumn: z.boolean().optional().describe('Show the deleted cards column on the board'),
      defaultPriority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Default priority for new cards'),
      defaultStatus: z.string().optional().describe('Default status for new cards'),
    },
    async (updates) => {
      const config = readConfig(workspaceRoot)
      const settings = configToSettings(config)
      const merged = { ...settings }
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          (merged as unknown as Record<string, unknown>)[key] = value
        }
      }
      writeConfig(workspaceRoot, settingsToConfig(config, merged))
      const updated = configToSettings(readConfig(workspaceRoot))
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(updated, null, 2),
        }],
      }
    }
  )

  // --- Webhook Tools ---

  server.tool(
    'list_webhooks',
    'List all registered webhooks.',
    {},
    async () => {
      const webhooks = loadWebhooks(workspaceRoot)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(webhooks, null, 2),
        }],
      }
    }
  )

  server.tool(
    'add_webhook',
    'Register a new webhook to receive event notifications.',
    {
      url: z.string().describe('Webhook target URL (HTTP/HTTPS)'),
      events: z.array(z.string()).optional().describe('Events to subscribe to (e.g. ["task.created", "task.updated"]). Default: ["*"] for all.'),
      secret: z.string().optional().describe('Optional HMAC-SHA256 signing secret'),
    },
    async ({ url, events, secret }) => {
      const webhook = createWebhook(workspaceRoot, {
        url,
        events: events || ['*'],
        secret,
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(webhook, null, 2),
        }],
      }
    }
  )

  server.tool(
    'remove_webhook',
    'Remove a registered webhook by ID.',
    {
      webhookId: z.string().describe('Webhook ID (e.g. "wh_abc123")'),
    },
    async ({ webhookId }) => {
      const removed = deleteWebhook(workspaceRoot, webhookId)
      if (!removed) {
        return {
          content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }],
          isError: true,
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Deleted webhook: ${webhookId}`,
        }],
      }
    }
  )

  server.tool(
    'update_webhook',
    'Update an existing webhook configuration (URL, events, secret, or active status).',
    {
      webhookId: z.string().describe('Webhook ID (e.g. "wh_abc123")'),
      url: z.string().optional().describe('New webhook target URL'),
      events: z.array(z.string()).optional().describe('New events to subscribe to'),
      secret: z.string().optional().describe('New HMAC-SHA256 signing secret'),
      active: z.boolean().optional().describe('Set webhook active (true) or inactive (false)'),
    },
    async ({ webhookId, url, events, secret, active }) => {
      const updates: Partial<{ url: string; events: string[]; secret: string; active: boolean }> = {}
      if (url !== undefined) updates.url = url
      if (events !== undefined) updates.events = events
      if (secret !== undefined) updates.secret = secret
      if (active !== undefined) updates.active = active
      const updated = updateWebhook(workspaceRoot, webhookId, updates)
      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }],
          isError: true,
        }
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(updated, null, 2),
        }],
      }
    }
  )

  // --- Workspace Info Tool ---

  server.tool(
    'get_workspace_info',
    'Get the workspace root path and features directory.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ workspaceRoot, featuresDir, port: readConfig(workspaceRoot).port }, null, 2),
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

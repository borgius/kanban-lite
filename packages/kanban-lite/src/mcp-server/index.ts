import * as path from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveKanbanDir as resolveDefaultKanbanDir, resolveWorkspaceRoot } from '../sdk/fileUtils'
import { DELETED_STATUS_ID, getTitleFromContent, type Priority, type CardSortOption } from '../shared/types'
import { readConfig } from '../shared/config'
import { AuthError, type AuthContext } from '../sdk/types'

const cardFormAttachmentSchema = z.object({
  name: z.string().optional().describe('Name of a reusable workspace-config form declared under forms.<name>.'),
  schema: z.record(z.string(), z.unknown()).optional().describe('Inline JSON Schema for a card-local form. Required when name is omitted.'),
  ui: z.record(z.string(), z.unknown()).optional().describe('Optional JSON Forms UI schema for layout/rendering hints.'),
  data: z.record(z.string(), z.unknown()).optional().describe('Optional default data merged after config defaults and before persisted card form data.'),
}).refine((value) => Boolean(value.name) || Boolean(value.schema), {
  message: 'Each form attachment must include either name or schema.',
})

const cardFormDataMapSchema = z.record(z.string(), z.record(z.string(), z.unknown()))

async function resolveKanbanDir(): Promise<string> {
  // 1. CLI arg --dir
  const dirIndex = process.argv.indexOf('--dir')
  if (dirIndex !== -1 && process.argv[dirIndex + 1]) {
    return path.resolve(process.argv[dirIndex + 1])
  }
  // 2. Environment variable (KANBAN_DIR preferred, KANBAN_FEATURES_DIR kept as alias)
  const envDir = process.env.KANBAN_DIR || process.env.KANBAN_FEATURES_DIR
  if (envDir) {
    return path.resolve(envDir)
  }
  // 3. Optional explicit config file
  const configIndex = process.argv.indexOf('--config')
  const configFilePath = configIndex !== -1 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : undefined
  // 4. Auto-detect from cwd / config
  return resolveDefaultKanbanDir(process.cwd(), configFilePath)
}

// --- Main ---

async function main(): Promise<void> {
  const kanbanDir = await resolveKanbanDir()
  const configIndex = process.argv.indexOf('--config')
  const configFilePath = configIndex !== -1 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : undefined
  const workspaceRoot = resolveWorkspaceRoot(process.cwd(), configFilePath)
  const sdk = new KanbanSDK(kanbanDir)

  const server = new McpServer({
    name: 'kanban-lite',
    version: '1.0.0',
  })

  function resolveMcpAuthContext(): AuthContext {
    const token = process.env.KANBAN_LITE_TOKEN || process.env.KANBAN_TOKEN
    return token ? { token, tokenSource: 'env', transport: 'mcp' } : { transport: 'mcp' }
  }

  function runWithMcpAuth<T>(fn: () => Promise<T>): Promise<T> {
    return sdk.runWithAuth(resolveMcpAuthContext(), fn)
  }

  function getMcpAuthStatus() {
    const auth = sdk.getAuthStatus()
    const ctx = resolveMcpAuthContext()
    return {
      ...auth,
      configured: auth.identityEnabled || auth.policyEnabled,
      tokenPresent: Boolean(ctx.token),
      tokenSource: ctx.tokenSource ?? null,
      transport: ctx.transport ?? 'mcp',
    }
  }

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
      const board = await runWithMcpAuth(() => sdk.createBoard(id, name, { description, columns }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(board, null, 2) }] }
    } catch (err) {
      if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
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
      await runWithMcpAuth(() => sdk.deleteBoard(boardId))
      return { content: [{ type: 'text' as const, text: `Deleted board: ${boardId}` }] }
    } catch (err) {
      if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
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
      const card = await runWithMcpAuth(() => sdk.transferCard(cardId, fromBoard, toBoard, targetStatus))
      return { content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  // --- Card Tools ---

  server.tool(
    'list_cards',
    'List all kanban cards. Optionally filter by status, priority, assignee, label, searchQuery, or metadata fields. Fuzzy search also applies to metadata values, while metaFilter remains available for structured field-specific searches.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      status: z.string().optional().describe('Filter by status'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter by priority'),
      assignee: z.string().optional().describe('Filter by assignee name'),
      label: z.string().optional().describe('Filter by label'),
      labelGroup: z.string().optional().describe('Filter by label group name'),
      includeDeleted: z.boolean().optional().default(false).describe('Include soft-deleted cards in results'),
      searchQuery: z.string().optional().describe('Free-text search query. Supports inline metadata tokens like "meta.team: backend".'),
      fuzzy: z.boolean().optional().describe('Enable fuzzy matching across free text and metadata values. metaFilter remains available for structured field-specific searches.'),
      metaFilter: z.record(z.string(), z.string()).optional().describe('Structured metadata filter using dot-notation keys (e.g. { "links.jira": "PROJ-123" }). Case-insensitive substring match. Remains available alongside searchQuery/fuzzy for field-specific searches.'),
      sort: z.enum(['created:asc', 'created:desc', 'modified:asc', 'modified:desc']).optional().describe('Sort order: created:asc, created:desc, modified:asc, or modified:desc. Defaults to board order.'),
    },
    async ({ boardId, status, priority, assignee, label, labelGroup, includeDeleted, searchQuery, fuzzy, metaFilter, sort }) => {
      let cards = await sdk.listCards(undefined, boardId, {
        metaFilter: metaFilter && Object.keys(metaFilter).length > 0 ? metaFilter : undefined,
        sort: sort || undefined,
        searchQuery: searchQuery?.trim() ? searchQuery : undefined,
        fuzzy,
      })
      if (!includeDeleted) cards = cards.filter(c => c.status !== DELETED_STATUS_ID)
      if (status) cards = cards.filter(c => c.status === status)
      if (priority) cards = cards.filter(c => c.priority === priority)
      if (assignee) cards = cards.filter(c => c.assignee === assignee)
      if (label) cards = cards.filter(c => c.labels.includes(label))
      if (labelGroup) {
        const groupLabels = sdk.getLabelsInGroup(labelGroup)
        cards = cards.filter(c => c.labels.some(l => groupLabels.includes(l)))
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
    'get_active_card',
    'Get the card currently marked as active/open in the workspace. Returns null when no card is active.',
    {
      boardId: z.string().optional().describe('Board ID (returns the active card only if it belongs to this board)'),
    },
    async ({ boardId }) => {
      const card = await sdk.getActiveCard(boardId)
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
    'Create a new kanban card. Returns the created card. Supports form attachments and persisted per-form data for form-aware workflows.',
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
      forms: z.array(cardFormAttachmentSchema).optional().describe('Optional forms attached to this card. Each item may reference a named workspace form and/or provide an inline schema/ui/data override.'),
      formData: cardFormDataMapSchema.optional().describe('Optional persisted per-form data keyed by resolved form id. Useful when seeding card-scoped form state at creation time.'),
    },
    async ({ boardId, title, body, status, priority, assignee, dueDate, labels, metadata, actions, forms, formData }) => {
      const content = `# ${title}${body ? '\n\n' + body : ''}`

      try {
        const card = await runWithMcpAuth(() => sdk.createCard({
          content,
          status: status || undefined,
          priority: priority as Priority | undefined,
          assignee: assignee || null,
          dueDate: dueDate || null,
          labels: labels || [],
          metadata,
          actions,
          boardId,
          forms,
          formData,
        }))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(card, null, 2),
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'update_card',
    'Update fields of an existing kanban card. Only specified fields are changed. Supports replacing attached forms and persisted per-form data.',
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
      forms: z.array(cardFormAttachmentSchema).optional().describe('Forms attached to this card (replaces existing attachments when provided).'),
      formData: cardFormDataMapSchema.optional().describe('Per-form persisted data keyed by resolved form id (replaces existing formData when provided).'),
    },
    async ({ boardId, cardId, status, priority, assignee, dueDate, labels, content, metadata, actions, forms, formData }) => {
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
      if (forms !== undefined) updates.forms = forms
      if (formData !== undefined) updates.formData = formData

      try {
        const updated = await runWithMcpAuth(() => sdk.updateCard(resolvedId, updates, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(updated, null, 2),
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'submit_card_form',
    'Submit a named/resolved form for a card using the SDK-owned validation and persistence contract. Returns the canonical persisted payload and form/card context.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      formId: z.string().describe('Resolved form identifier to submit (for named workspace forms this is usually the form name).'),
      data: z.record(z.string(), z.unknown()).describe('Submitted field values merged over the resolved form base payload before SDK validation.'),
    },
    async ({ boardId, cardId, formId, data }) => {
      try {
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

        const result = await runWithMcpAuth(() => sdk.submitForm({
          boardId,
          cardId: resolvedId,
          formId,
          data,
        }))

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
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

      try {
        const updated = await runWithMcpAuth(() => sdk.moveCard(resolvedId, status, undefined, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ id: updated.id, status: updated.status, order: updated.order }, null, 2),
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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

      try {
        await runWithMcpAuth(() => sdk.deleteCard(resolvedId, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: `Soft-deleted card: ${resolvedId} (moved to deleted status)`,
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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

      try {
        await runWithMcpAuth(() => sdk.permanentlyDeleteCard(resolvedId, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: `Permanently deleted card: ${resolvedId}`,
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
        await runWithMcpAuth(() => sdk.triggerAction(card_id, action, board_id))
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

  // --- Board Action Tools ---

  server.tool(
    'list_board_actions',
    'List all named actions defined on a board.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ boardId }) => {
      const actions = sdk.getBoardActions(boardId)
      return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] }
    }
  )

  server.tool(
    'add_board_action',
    'Add or update a named action on a board. Actions appear in the board toolbar and fire webhooks when triggered.',
    {
      boardId: z.string().describe('Board ID'),
      key: z.string().describe('Unique action key identifier'),
      title: z.string().describe('Human-readable display title for the action'),
    },
    async ({ boardId, key, title }) => {
      try {
        const actions = await runWithMcpAuth(() => sdk.addBoardAction(boardId, key, title))
        return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'remove_board_action',
    'Remove a named action from a board.',
    {
      boardId: z.string().describe('Board ID'),
      key: z.string().describe('Action key to remove'),
    },
    async ({ boardId, key }) => {
      try {
        const actions = await runWithMcpAuth(() => sdk.removeBoardAction(boardId, key))
        return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'trigger_board_action',
    'Fire a named board action, emitting a board.action webhook event.',
    {
      boardId: z.string().describe('Board ID'),
      actionKey: z.string().describe('Key of the action to trigger'),
    },
    async ({ boardId, actionKey }) => {
      await runWithMcpAuth(() => sdk.triggerBoardAction(boardId, actionKey))
      return { content: [{ type: 'text', text: `Board action "${actionKey}" fired on board "${boardId}".` }] }
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

      const updated = await runWithMcpAuth(() => sdk.addAttachment(resolvedId, filePath, boardId))
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

      const updated = await runWithMcpAuth(() => sdk.removeAttachment(resolvedId, attachment, boardId))
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

      const updated = await runWithMcpAuth(() => sdk.addComment(resolvedId, author, content, boardId))
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
        const updated = await runWithMcpAuth(() => sdk.updateComment(resolvedId, commentId, content, boardId))
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
        await runWithMcpAuth(() => sdk.deleteComment(resolvedId, commentId, boardId))
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

  // --- Log Tools ---

  server.tool(
    'list_logs',
    'List all log entries for a kanban card. Logs are stored in a dedicated .log file.',
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

      const logs = await sdk.listLogs(resolvedId, boardId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(logs, null, 2),
        }],
      }
    }
  )

  server.tool(
    'add_log',
    'Add a log entry to a kanban card. The log is appended to the card\'s .log file.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      text: z.string().describe('Log message text (supports markdown: bold, italic, emoji)'),
      source: z.string().optional().describe('Source/origin label (defaults to "default")'),
      object: z.record(z.string(), z.any()).optional().describe('Optional structured data object stored as JSON'),
    },
    async ({ boardId, cardId, text, source, object }) => {
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

      const entry = await runWithMcpAuth(() => sdk.addLog(resolvedId, text, { source, object }, boardId))
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(entry, null, 2),
        }],
      }
    }
  )

  server.tool(
    'clear_logs',
    'Clear all log entries for a kanban card by deleting the .log file. New logs will recreate it.',
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

      try {
        await runWithMcpAuth(() => sdk.clearLogs(resolvedId, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: `Cleared all logs for card ${resolvedId}`,
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

  // --- Board Log Tools ---

  server.tool(
    'list_board_logs',
    'List all board-level log entries from the board.log file.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ boardId }) => {
      const logs = await sdk.listBoardLogs(boardId)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(logs, null, 2),
        }],
      }
    }
  )

  server.tool(
    'add_board_log',
    'Append a new entry to the board-level log file.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      text: z.string().describe('Log message text'),
      source: z.string().optional().describe('Source label (e.g. "api", "mcp", "cli")'),
      object: z.record(z.string(), z.unknown()).optional().describe('Optional structured JSON object to attach'),
    },
    async ({ boardId, text, source, object }) => {
      try {
        const entry = await runWithMcpAuth(() => sdk.addBoardLog(text, { source, object: object as Record<string, unknown> | undefined }, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(entry, null, 2),
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
    'clear_board_logs',
    'Clear all board-level log entries by deleting the board.log file.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ boardId }) => {
      try {
        await runWithMcpAuth(() => sdk.clearBoardLogs(boardId))
        return {
          content: [{
            type: 'text' as const,
            text: 'Board logs cleared.',
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
      try {
        const columns = await runWithMcpAuth(() => sdk.addColumn({ id, name, color }, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify(columns, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
      try {
        const columns = await runWithMcpAuth(() => sdk.updateColumn(columnId, updates, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify(columns, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
      try {
        const columns = await runWithMcpAuth(() => sdk.removeColumn(columnId, boardId))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(columns, null, 2),
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'reorder_columns',
    'Reorder columns on a board by providing the full ordered list of column IDs.',
    {
      columnIds: z.array(z.string()).describe('Complete ordered list of all column IDs for the board.'),
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ columnIds, boardId }) => {
      try {
        const columns = await runWithMcpAuth(() => sdk.reorderColumns(columnIds, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify(columns, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  server.tool(
    'set_minimized_columns',
    'Persist the minimized column IDs for a board to the config file. Pass an empty array to clear all minimized columns.',
    {
      columnIds: z.array(z.string()).describe('Column IDs to mark as minimized. Pass [] to clear.'),
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
    },
    async ({ columnIds, boardId }) => {
      try {
        const minimized = await runWithMcpAuth(() => sdk.setMinimizedColumns(columnIds, boardId))
        return { content: [{ type: 'text' as const, text: JSON.stringify({ minimizedColumnIds: minimized }, null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
      const moved = await runWithMcpAuth(() => sdk.cleanupColumn(columnId, boardId))
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
    try {
      await runWithMcpAuth(() => sdk.setLabel(name, { color, group }))
      return { content: [{ type: 'text' as const, text: `Label "${name}" set with color ${color}${group ? ` in group "${group}"` : ''}` }] }
    } catch (err) {
      if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
      return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
    }
  })

  server.tool('rename_label', 'Rename a label (cascades to all cards)', {
    oldName: z.string().describe('Current label name'),
    newName: z.string().describe('New label name')
  }, async ({ oldName, newName }) => {
    await runWithMcpAuth(() => sdk.renameLabel(oldName, newName))
    return { content: [{ type: 'text' as const, text: `Label "${oldName}" renamed to "${newName}"` }] }
  })

  server.tool('delete_label', 'Remove a label definition and remove it from all cards', {
    name: z.string().describe('Label name to remove')
  }, async ({ name }) => {
    await runWithMcpAuth(() => sdk.deleteLabel(name))
    return { content: [{ type: 'text' as const, text: `Label "${name}" definition removed` }] }
  })

  // --- Settings Tools ---

  server.tool(
    'get_settings',
    'Get the current kanban board display settings.',
    {},
    async () => {
      const settings = sdk.getSettings()
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
      boardBackgroundMode: z.enum(['fancy', 'plain']).optional().describe('Whether the board canvas uses fancy or plain presets'),
      boardBackgroundPreset: z.enum(['aurora', 'sunset', 'meadow', 'nebula', 'lagoon', 'candy', 'ember', 'violet', 'paper', 'mist', 'sand']).optional().describe('Selected board background preset'),
    },
    async (updates) => {
      const settings = sdk.getSettings()
      const merged = { ...settings }
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          (merged as unknown as Record<string, unknown>)[key] = value
        }
      }
      try {
        await runWithMcpAuth(() => sdk.updateSettings(merged))
        return { content: [{ type: 'text' as const, text: JSON.stringify(sdk.getSettings(), null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  // --- Webhook Tools ---

  /** Strip the HMAC secret from a webhook object before returning it to an MCP caller. */
  function redactWebhook<T extends { secret?: string }>(w: T): Omit<T, 'secret'> {
    const { secret: _s, ...safe } = w
    return safe as Omit<T, 'secret'>
  }

  server.tool(
    'list_webhooks',
    'List all registered webhooks.',
    {},
    async () => {
      try {
        const webhooks = await runWithMcpAuth(() => Promise.resolve(sdk.listWebhooks()))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(webhooks.map(redactWebhook), null, 2),
          }],
        }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
      try {
        const webhook = await runWithMcpAuth(() => sdk.createWebhook({ url, events: events || ['*'], secret }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(redactWebhook(webhook), null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
      try {
        const removed = await runWithMcpAuth(() => sdk.deleteWebhook(webhookId))
        if (!removed) {
          return { content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }], isError: true }
        }
        return { content: [{ type: 'text' as const, text: `Deleted webhook: ${webhookId}` }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
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
      try {
        const updated = await runWithMcpAuth(() => sdk.updateWebhook(webhookId, updates))
        if (!updated) {
          return { content: [{ type: 'text' as const, text: `Webhook not found: ${webhookId}` }], isError: true }
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(redactWebhook(updated), null, 2) }] }
      } catch (err) {
        if (err instanceof AuthError) return { content: [{ type: 'text' as const, text: err.message }], isError: true }
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    }
  )

  // --- Workspace Info Tool ---

  server.tool(
    'get_auth_status',
    'Get the active auth providers and host token-source diagnostics for the MCP server.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(getMcpAuthStatus(), null, 2),
        }],
      }
    }
  )

  server.tool(
    'get_workspace_info',
    'Get the workspace root path, cards directory, and active storage engine.',
    {},
    async () => {
      const cfg = readConfig(workspaceRoot)
      const storageStatus = sdk.getStorageStatus()
      const providers = storageStatus.providers
        ? {
            'card.storage': storageStatus.providers['card.storage'].provider,
            'attachment.storage': storageStatus.providers['attachment.storage'].provider,
          }
        : null
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workspaceRoot,
            kanbanDir,
            port: cfg.port,
            storageEngine: storageStatus.storageEngine,
            sqlitePath: cfg.sqlitePath ?? null,
            providers,
            isFileBacked: storageStatus.isFileBacked,
            watchGlob: storageStatus.watchGlob,
            auth: getMcpAuthStatus(),
          }, null, 2),
        }],
      }
    }
  )

  // --- Storage Tools ---

  server.tool(
    'get_storage_status',
    'Get the current storage engine type and configuration.',
    {},
    async () => {
      const cfg = readConfig(workspaceRoot)
      const storageStatus = sdk.getStorageStatus()
      const providers = storageStatus.providers
        ? {
            'card.storage': storageStatus.providers['card.storage'].provider,
            'attachment.storage': storageStatus.providers['attachment.storage'].provider,
          }
        : null
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            storageEngine: storageStatus.storageEngine,
            sqlitePath: cfg.sqlitePath ?? null,
            providers,
            isFileBacked: storageStatus.isFileBacked,
            watchGlob: storageStatus.watchGlob,
          }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'migrate_to_sqlite',
    'Migrate all card data from the current markdown storage to a SQLite database. Updates .kanban.json automatically.',
    {
      sqlitePath: z.string().optional().describe('Path to SQLite database file (default: .kanban/kanban.db). Relative to workspace root.'),
    },
    async ({ sqlitePath }) => {
      try {
        const count = await runWithMcpAuth(() => sdk.migrateToSqlite(sqlitePath))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ok: true, count, storageEngine: 'sqlite' }, null, 2),
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
    'migrate_to_markdown',
    'Migrate all card data from SQLite back to individual markdown files. Updates .kanban.json automatically.',
    {},
    async () => {
      try {
        const count = await runWithMcpAuth(() => sdk.migrateToMarkdown())
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ok: true, count, storageEngine: 'markdown' }, null, 2),
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

  // --- Start server ---

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error(`MCP Server error: ${err.message}`)
  process.exit(1)
})

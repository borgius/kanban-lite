import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { AuthError } from '../../sdk/types'
import { coerceChecklistSeedTasks } from '../../sdk/modules/checklist'
import { DELETED_STATUS_ID, getDisplayTitleFromContent, type Priority } from '../../shared/types'
import {
  createMcpErrorResult,
  decorateMcpCardTitle,
  getBoardTitleFieldsForMcp,
  runWithResolvedMcpCardId,
  type McpAuthRunner,
} from '../shared'

const cardFormAttachmentSchema = z.object({
  name: z.string().optional().describe('Name of a reusable workspace-config form declared under forms.<name>.'),
  schema: z.record(z.string(), z.unknown()).optional().describe('Inline JSON Schema for a card-local form. Required when name is omitted.'),
  ui: z.record(z.string(), z.unknown()).optional().describe('Optional JSON Forms UI schema for layout/rendering hints.'),
  data: z.record(z.string(), z.unknown()).optional().describe('Optional default data merged after config defaults and before persisted card form data.'),
}).refine((value) => Boolean(value.name) || Boolean(value.schema), {
  message: 'Each form attachment must include either name or schema.',
})

const cardFormDataMapSchema = z.record(z.string(), z.record(z.string(), z.unknown()))

export function registerCardMcpTools(
  server: McpServer,
  sdk: KanbanSDK,
  runWithMcpAuth: McpAuthRunner,
): void {
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
      try {
        const titleFields = getBoardTitleFieldsForMcp(sdk, boardId)
        const summary = await runWithMcpAuth(async () => {
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

          return cards.map(c => ({
            id: c.id,
            title: getDisplayTitleFromContent(c.content, c.metadata, titleFields),
            status: c.status,
            priority: c.priority,
            assignee: c.assignee,
            labels: c.labels,
            dueDate: c.dueDate,
          }))
        })

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const card = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, async (resolvedId) => {
          const resolvedCard = await sdk.getCard(resolvedId, boardId)
          if (!resolvedCard) throw new Error(`Card not found: ${cardId}`)
          return resolvedCard
        })

        const titleFields = getBoardTitleFieldsForMcp(sdk, card.boardId ?? boardId)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(decorateMcpCardTitle(card, titleFields), null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const card = await runWithMcpAuth(() => sdk.getActiveCard(boardId))
        const titleFields = card ? getBoardTitleFieldsForMcp(sdk, card.boardId ?? boardId) : undefined
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(card ? decorateMcpCardTitle(card, titleFields) : null, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      tasks: z.array(z.string()).optional().describe('Optional checklist items seeded as raw markdown task lines (for example "- [ ] Review docs").'),
      metadata: z.record(z.string(), z.any()).optional().describe('Custom metadata as key-value pairs (supports nested objects)'),
      actions: z.array(z.string()).optional().describe('Action names available on this card (e.g. ["retry", "sendEmail"])'),
      forms: z.array(cardFormAttachmentSchema).optional().describe('Optional forms attached to this card. Each item may reference a named workspace form and/or provide an inline schema/ui/data override.'),
      formData: cardFormDataMapSchema.optional().describe('Optional persisted per-form data keyed by resolved form id. Useful when seeding card-scoped form state at creation time.'),
    },
    async ({ boardId, title, body, status, priority, assignee, dueDate, labels, tasks, metadata, actions, forms, formData }) => {
      const content = `# ${title}${body ? '\n\n' + body : ''}`

      try {
        const card = await runWithMcpAuth(() => sdk.createCard({
          content,
          status: status || undefined,
          priority: priority as Priority | undefined,
          assignee: assignee || null,
          dueDate: dueDate || null,
          labels: labels || [],
          tasks: coerceChecklistSeedTasks(tasks),
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
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.updateCard(resolvedId, updates, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(updated, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
        const result = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.submitForm({
            boardId,
            cardId: resolvedId,
            formId,
            data,
          })
        )

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.moveCard(resolvedId, status, undefined, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ id: updated.id, status: updated.status, order: updated.order }, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const resolvedId = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, async (nextResolvedId) => {
          await sdk.deleteCard(nextResolvedId, boardId)
          return nextResolvedId
        })
        return {
          content: [{
            type: 'text' as const,
            text: `Soft-deleted card: ${resolvedId} (moved to deleted status)`,
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const resolvedId = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, async (nextResolvedId) => {
          await sdk.permanentlyDeleteCard(nextResolvedId, boardId)
          return nextResolvedId
        })
        return {
          content: [{
            type: 'text' as const,
            text: `Permanently deleted card: ${resolvedId}`,
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
      }
    }
  )

  server.tool(
    'trigger_action',
    'Trigger a named action on a card. The action name must match one of the card\'s configured actions. Emits a card.action.triggered event delivered to registered webhooks.',
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

}

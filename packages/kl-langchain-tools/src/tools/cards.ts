import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'
import { extractTitle } from './helpers'

export class ListCardsTool extends StructuredTool {
  name = 'kanban_list_cards'
  description = 'List all cards on a kanban board. Returns cards with id, title, status, priority, assignee, labels, and more.'
  schema = z.object({
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
    status: z.string().optional().describe('Filter cards by status column (e.g. "todo", "in-progress").'),
    sortBy: z.enum(['created:asc', 'created:desc', 'modified:asc', 'modified:desc']).optional().describe('Sort order for results.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const cards = await this.sdk.listCards(input.sortBy as any, input.boardId)
    const filtered = input.status ? cards.filter(c => c.status === input.status) : cards
    return JSON.stringify(filtered.map(c => ({
      id: c.id, title: extractTitle(c.content), status: c.status,
      priority: c.priority, assignee: c.assignee, labels: c.labels, dueDate: c.dueDate,
      commentCount: c.comments?.length ?? 0, created: c.created, modified: c.modified,
    })))
  }
}

export class GetCardTool extends StructuredTool {
  name = 'kanban_get_card'
  description = 'Get full details of a single kanban card by its ID, including content, comments, labels, and metadata.'
  schema = z.object({
    cardId: z.string().describe('The card ID to retrieve.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const card = await this.sdk.getCard(input.cardId, input.boardId)
    return JSON.stringify(card)
  }
}

export class CreateCardTool extends StructuredTool {
  name = 'kanban_create_card'
  description = 'Create a new kanban card with title, content, status, priority, assignee, labels, and due date.'
  schema = z.object({
    title: z.string().describe('Card title.'),
    content: z.string().optional().describe('Card body content in markdown (appended after title).'),
    status: z.string().optional().describe('Initial status column (e.g. "todo"). Defaults to first column.'),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Card priority level.'),
    assignee: z.string().optional().describe('Person assigned to the card.'),
    labels: z.array(z.string()).optional().describe('Labels to attach to the card.'),
    dueDate: z.string().optional().describe('Due date in ISO 8601 format.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
    metadata: z.record(z.any()).optional().describe('Arbitrary metadata key-value pairs.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const body = input.content ? `# ${input.title}\n\n${input.content}` : `# ${input.title}`
    const card = await this.sdk.createCard({
      content: body,
      status: input.status as any,
      priority: input.priority as any,
      assignee: input.assignee ?? null,
      labels: input.labels ?? [],
      dueDate: input.dueDate ?? null,
      boardId: input.boardId,
      metadata: input.metadata,
    })
    return JSON.stringify({ id: card.id, status: card.status, created: card.created })
  }
}

export class UpdateCardTool extends StructuredTool {
  name = 'kanban_update_card'
  description = 'Update fields on an existing kanban card (content, priority, assignee, labels, due date, metadata).'
  schema = z.object({
    cardId: z.string().describe('The card ID to update.'),
    content: z.string().optional().describe('New full markdown content (including title as H1).'),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('New priority level.'),
    assignee: z.string().nullable().optional().describe('New assignee (null to unassign).'),
    labels: z.array(z.string()).optional().describe('Replace labels with this list.'),
    dueDate: z.string().nullable().optional().describe('New due date (null to clear).'),
    metadata: z.record(z.any()).optional().describe('Metadata fields to merge.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { cardId, boardId, ...updates } = input
    const card = await this.sdk.updateCard(cardId, updates as any, boardId)
    return JSON.stringify({ id: card.id, modified: card.modified })
  }
}

export class MoveCardTool extends StructuredTool {
  name = 'kanban_move_card'
  description = 'Move a kanban card to a different status column, optionally specifying position (top/bottom).'
  schema = z.object({
    cardId: z.string().describe('The card ID to move.'),
    newStatus: z.string().describe('Target status column ID (e.g. "in-progress", "done").'),
    position: z.enum(['top', 'bottom']).optional().describe('Position in the target column.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const card = await this.sdk.moveCard(input.cardId, input.newStatus as any, input.position, input.boardId)
    return JSON.stringify({ id: card.id, status: card.status, modified: card.modified })
  }
}

export class DeleteCardTool extends StructuredTool {
  name = 'kanban_delete_card'
  description = 'Soft-delete a kanban card (moves to deleted status). Use permanently_delete for permanent removal.'
  schema = z.object({
    cardId: z.string().describe('The card ID to delete.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    await this.sdk.deleteCard(input.cardId, input.boardId)
    return JSON.stringify({ deleted: true, cardId: input.cardId })
  }
}

export class GetCardsByStatusTool extends StructuredTool {
  name = 'kanban_get_cards_by_status'
  description = 'Get all cards in a specific status column.'
  schema = z.object({
    status: z.string().describe('The status column ID to filter by.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const cards = await this.sdk.getCardsByStatus(input.status, input.boardId)
    return JSON.stringify(cards.map(c => ({
      id: c.id, title: extractTitle(c.content), status: c.status,
      priority: c.priority, assignee: c.assignee, labels: c.labels,
    })))
  }
}

export class TriggerActionTool extends StructuredTool {
  name = 'kanban_trigger_action'
  description = 'Trigger a configured action on a kanban card (e.g. run a script, automation).'
  schema = z.object({
    cardId: z.string().describe('The card ID to trigger the action on.'),
    action: z.string().describe('The action key to trigger.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const result = await this.sdk.triggerAction(input.cardId, input.action, input.boardId)
    return JSON.stringify(result)
  }
}

export function createCardTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new ListCardsTool(sdk),
    new GetCardTool(sdk),
    new CreateCardTool(sdk),
    new UpdateCardTool(sdk),
    new MoveCardTool(sdk),
    new DeleteCardTool(sdk),
    new GetCardsByStatusTool(sdk),
    new TriggerActionTool(sdk),
  ]
}

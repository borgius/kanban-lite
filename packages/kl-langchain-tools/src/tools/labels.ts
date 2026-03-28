import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'

// ---------------------------------------------------------------------------
// Label tools
// ---------------------------------------------------------------------------

export class GetLabelsTool extends StructuredTool {
  name = 'kanban_get_labels'
  description = 'Get all label definitions configured in the workspace (name, color, group, description).'
  schema = z.object({})

  constructor(private sdk: KanbanSDK) { super() }

  async _call(): Promise<string> {
    const labels = this.sdk.getLabels()
    return JSON.stringify(labels)
  }
}

export class SetLabelTool extends StructuredTool {
  name = 'kanban_set_label'
  description = 'Create or update a label definition in the workspace.'
  schema = z.object({
    name: z.string().describe('Label name.'),
    color: z.string().optional().describe('Hex color for the label.'),
    description: z.string().optional().describe('Label description.'),
    group: z.string().optional().describe('Group to organize the label under.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { name, ...definition } = input
    this.sdk.setLabel(name, definition)
    return JSON.stringify({ set: true, name })
  }
}

export class DeleteLabelTool extends StructuredTool {
  name = 'kanban_delete_label'
  description = 'Delete a label definition from the workspace.'
  schema = z.object({
    name: z.string().describe('Label name to delete.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    this.sdk.deleteLabel(input.name)
    return JSON.stringify({ deleted: true, name: input.name })
  }
}

export class RenameLabelTool extends StructuredTool {
  name = 'kanban_rename_label'
  description = 'Rename a label (updates all cards that use it).'
  schema = z.object({
    oldName: z.string().describe('Current label name.'),
    newName: z.string().describe('New label name.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    this.sdk.renameLabel(input.oldName, input.newName)
    return JSON.stringify({ renamed: true, from: input.oldName, to: input.newName })
  }
}

export class GetUniqueAssigneesTool extends StructuredTool {
  name = 'kanban_get_unique_assignees'
  description = 'Get a sorted list of unique assignee names across all cards on a board.'
  schema = z.object({
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const assignees = await this.sdk.getUniqueAssignees(input.boardId)
    return JSON.stringify(assignees)
  }
}

export class GetUniqueLabelsTool extends StructuredTool {
  name = 'kanban_get_unique_labels'
  description = 'Get a sorted list of unique labels used across all cards on a board.'
  schema = z.object({
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const labels = await this.sdk.getUniqueLabels(input.boardId)
    return JSON.stringify(labels)
  }
}

export class FilterCardsByLabelGroupTool extends StructuredTool {
  name = 'kanban_filter_cards_by_label_group'
  description = 'Get all cards tagged with any label belonging to a specific label group.'
  schema = z.object({
    group: z.string().describe('Label group name to filter by.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const cards = await this.sdk.filterCardsByLabelGroup(input.group, input.boardId)
    return JSON.stringify(cards.map(c => ({
      id: c.id, title: c.content?.split('\n')[0]?.replace(/^#\s*/, '') ?? '', labels: c.labels,
    })))
  }
}

export function createLabelTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new GetLabelsTool(sdk),
    new SetLabelTool(sdk),
    new DeleteLabelTool(sdk),
    new RenameLabelTool(sdk),
    new GetUniqueAssigneesTool(sdk),
    new GetUniqueLabelsTool(sdk),
    new FilterCardsByLabelGroupTool(sdk),
  ]
}

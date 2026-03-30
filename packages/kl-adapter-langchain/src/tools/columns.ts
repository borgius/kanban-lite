import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'

// ---------------------------------------------------------------------------
// Column tools
// ---------------------------------------------------------------------------

export class ListColumnsTool extends StructuredTool {
  name = 'kanban_list_columns'
  description = 'List all columns (status categories) defined for a kanban board.'
  schema = z.object({
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const columns = this.sdk.listColumns(input.boardId)
    return JSON.stringify(columns)
  }
}

export class AddColumnTool extends StructuredTool {
  name = 'kanban_add_column'
  description = 'Add a new column (status category) to a kanban board.'
  schema = z.object({
    id: z.string().describe('Column ID (slug, e.g. "in-review").'),
    name: z.string().describe('Display name for the column.'),
    color: z.string().optional().describe('Hex color code for the column (e.g. "#ef4444").'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { boardId, ...column } = input
    const result = this.sdk.addColumn(column, boardId)
    return JSON.stringify(result)
  }
}

export class UpdateColumnTool extends StructuredTool {
  name = 'kanban_update_column'
  description = 'Update properties of a kanban board column.'
  schema = z.object({
    columnId: z.string().describe('Column ID to update.'),
    name: z.string().optional().describe('New display name.'),
    color: z.string().optional().describe('New hex color.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { columnId, boardId, ...updates } = input
    const result = this.sdk.updateColumn(columnId, updates, boardId)
    return JSON.stringify(result)
  }
}

export class RemoveColumnTool extends StructuredTool {
  name = 'kanban_remove_column'
  description = 'Remove a column from a kanban board.'
  schema = z.object({
    columnId: z.string().describe('Column ID to remove.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    this.sdk.removeColumn(input.columnId, input.boardId)
    return JSON.stringify({ removed: true, columnId: input.columnId })
  }
}

export class ReorderColumnsTool extends StructuredTool {
  name = 'kanban_reorder_columns'
  description = 'Reorder columns on a kanban board by providing the full ordered list of column IDs.'
  schema = z.object({
    columnIds: z.array(z.string()).describe('Ordered list of all column IDs.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    this.sdk.reorderColumns(input.columnIds, input.boardId)
    return JSON.stringify({ reordered: true, columnIds: input.columnIds })
  }
}

export function createColumnTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new ListColumnsTool(sdk),
    new AddColumnTool(sdk),
    new UpdateColumnTool(sdk),
    new RemoveColumnTool(sdk),
    new ReorderColumnsTool(sdk),
  ]
}

import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'

// ---------------------------------------------------------------------------
// Board tools
// ---------------------------------------------------------------------------

export class ListBoardsTool extends StructuredTool {
  name = 'kanban_list_boards'
  description = 'List all boards in the kanban workspace.'
  schema = z.object({})

  constructor(private sdk: KanbanSDK) { super() }

  async _call(): Promise<string> {
    const boards = this.sdk.listBoards()
    return JSON.stringify(boards)
  }
}

export class GetBoardTool extends StructuredTool {
  name = 'kanban_get_board'
  description = 'Get details of a specific kanban board, including columns and actions.'
  schema = z.object({
    boardId: z.string().describe('The board ID to retrieve.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const board = this.sdk.getBoard(input.boardId)
    return JSON.stringify(board)
  }
}

export class CreateBoardTool extends StructuredTool {
  name = 'kanban_create_board'
  description = 'Create a new kanban board with an ID and display name.'
  schema = z.object({
    id: z.string().describe('Board ID (slug, e.g. "bugs").'),
    name: z.string().describe('Display name for the board.'),
    description: z.string().optional().describe('Board description.'),
    columns: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().optional(),
    })).optional().describe('Initial columns. Inherits from default board if omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { id, name, ...opts } = input
    const board = this.sdk.createBoard(id, name, opts)
    return JSON.stringify(board)
  }
}

export class DeleteBoardTool extends StructuredTool {
  name = 'kanban_delete_board'
  description = 'Delete a kanban board.'
  schema = z.object({
    boardId: z.string().describe('The board ID to delete.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    this.sdk.deleteBoard(input.boardId)
    return JSON.stringify({ deleted: true, boardId: input.boardId })
  }
}

export class UpdateBoardTool extends StructuredTool {
  name = 'kanban_update_board'
  description = 'Update a kanban board (name, description).'
  schema = z.object({
    boardId: z.string().describe('The board ID to update.'),
    name: z.string().optional().describe('New display name.'),
    description: z.string().optional().describe('New description.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { boardId, ...updates } = input
    const board = this.sdk.updateBoard(boardId, updates)
    return JSON.stringify(board)
  }
}

export class GetBoardActionsTool extends StructuredTool {
  name = 'kanban_get_board_actions'
  description = 'Get all configured actions for a board.'
  schema = z.object({
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const actions = this.sdk.getBoardActions(input.boardId)
    return JSON.stringify(actions)
  }
}

export function createBoardTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new ListBoardsTool(sdk),
    new GetBoardTool(sdk),
    new CreateBoardTool(sdk),
    new DeleteBoardTool(sdk),
    new UpdateBoardTool(sdk),
    new GetBoardActionsTool(sdk),
  ]
}

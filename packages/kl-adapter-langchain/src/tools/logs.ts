import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'

// ---------------------------------------------------------------------------
// Log tools
// ---------------------------------------------------------------------------

export class ListLogsTool extends StructuredTool {
  name = 'kanban_list_logs'
  description = 'List timestamped log entries for a specific card.'
  schema = z.object({
    cardId: z.string().describe('The card ID whose logs to list.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const logs = await this.sdk.listLogs(input.cardId, input.boardId)
    return JSON.stringify(logs)
  }
}

export class AddLogTool extends StructuredTool {
  name = 'kanban_add_log'
  description = 'Append a timestamped log entry to a card. Supports markdown text, optional source label, and structured data.'
  schema = z.object({
    cardId: z.string().describe('The card ID to add a log entry to.'),
    text: z.string().describe('Log text (supports markdown).'),
    source: z.string().optional().describe('Source label (e.g. "agent", "ci").'),
    object: z.record(z.any()).optional().describe('Structured data to attach to the log entry.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { cardId, text, boardId, ...opts } = input
    const entry = await this.sdk.addLog(cardId, text, opts, boardId)
    return JSON.stringify(entry)
  }
}

export class ClearLogsTool extends StructuredTool {
  name = 'kanban_clear_logs'
  description = 'Clear all log entries from a card.'
  schema = z.object({
    cardId: z.string().describe('The card ID whose logs to clear.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    await this.sdk.clearLogs(input.cardId, input.boardId)
    return JSON.stringify({ cleared: true, cardId: input.cardId })
  }
}

export class ListBoardLogsTool extends StructuredTool {
  name = 'kanban_list_board_logs'
  description = 'List timestamped log entries at the board level.'
  schema = z.object({
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const logs = await this.sdk.listBoardLogs(input.boardId)
    return JSON.stringify(logs)
  }
}

export class AddBoardLogTool extends StructuredTool {
  name = 'kanban_add_board_log'
  description = 'Append a timestamped log entry at the board level.'
  schema = z.object({
    text: z.string().describe('Log text (supports markdown).'),
    source: z.string().optional().describe('Source label.'),
    object: z.record(z.any()).optional().describe('Structured data to attach.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { text, boardId, ...opts } = input
    const entry = await this.sdk.addBoardLog(text, opts, boardId)
    return JSON.stringify(entry)
  }
}

export function createLogTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new ListLogsTool(sdk),
    new AddLogTool(sdk),
    new ClearLogsTool(sdk),
    new ListBoardLogsTool(sdk),
    new AddBoardLogTool(sdk),
  ]
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { AuthError } from '../../sdk/types'
import {
  createMcpErrorResult,
  getBoardTitleFieldsForMcp,
  runWithResolvedMcpCardId,
  type McpAuthRunner,
} from '../shared'

export function registerBoardMcpTools(
  server: McpServer,
  sdk: KanbanSDK,
  runWithMcpAuth: McpAuthRunner,
): void {
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

}

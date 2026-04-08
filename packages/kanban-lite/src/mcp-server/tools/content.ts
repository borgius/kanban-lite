import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import {
  createMcpErrorResult,
  runWithResolvedMcpCardId,
  type McpAuthRunner,
} from '../shared'

export function registerContentMcpTools(
  server: McpServer,
  sdk: KanbanSDK,
  runWithMcpAuth: McpAuthRunner,
): void {
  // --- Attachment Tools ---

  server.tool(
    'list_attachments',
    'List all attachments on a kanban card.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      try {
        const attachments = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.listAttachments(resolvedId, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(attachments, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.addAttachment(resolvedId, filePath, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ id: updated.id, attachments: updated.attachments }, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.removeAttachment(resolvedId, attachment, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ id: updated.id, attachments: updated.attachments }, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const comments = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.listComments(resolvedId, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(comments, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.addComment(resolvedId, author, content, boardId)
        )
        const added = updated.comments[updated.comments.length - 1]
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(added, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
      }
    }
  )

  server.tool(
    'stream_comment',
    'Add a comment to a kanban card from a streaming text source. Provide the full content string; it will be written via the streaming path so connected webview clients see it arrive incrementally.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      author: z.string().describe('Comment author name'),
      content: z.string().describe('Full comment text (supports markdown). The content is streamed word-by-word to connected viewers.'),
    },
    async ({ boardId, cardId, author, content }) => {
      // Wrap the full content string as an async iterable so it exercises the
      // same SDK streaming code path that a real token stream would use.
      async function* singleChunk(): AsyncIterable<string> { yield content }

      try {
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.streamComment(resolvedId, author, singleChunk(), { boardId })
        )
        const added = updated.comments?.[updated.comments.length - 1]
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(added, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const updated = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.updateComment(resolvedId, commentId, content, boardId)
        )
        const comment = updated.comments.find(c => c.id === commentId)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(comment, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const resolvedId = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, async (nextResolvedId) => {
          await sdk.deleteComment(nextResolvedId, commentId, boardId)
          return nextResolvedId
        })
        return {
          content: [{
            type: 'text' as const,
            text: `Deleted comment ${commentId} from card ${resolvedId}`,
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const logs = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.listLogs(resolvedId, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(logs, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const entry = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, (resolvedId) =>
          sdk.addLog(resolvedId, text, { source, object }, boardId)
        )
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(entry, null, 2),
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
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
      try {
        const resolvedId = await runWithResolvedMcpCardId(sdk, runWithMcpAuth, cardId, boardId, async (nextResolvedId) => {
          await sdk.clearLogs(nextResolvedId, boardId)
          return nextResolvedId
        })
        return {
          content: [{
            type: 'text' as const,
            text: `Cleared all logs for card ${resolvedId}`,
          }],
        }
      } catch (err) {
        return createMcpErrorResult(err)
      }
    }
  )

}

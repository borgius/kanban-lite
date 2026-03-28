import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'

// ---------------------------------------------------------------------------
// Comment tools
// ---------------------------------------------------------------------------

export class ListCommentsTool extends StructuredTool {
  name = 'kanban_list_comments'
  description = 'List all comments on a kanban card.'
  schema = z.object({
    cardId: z.string().describe('The card ID whose comments to list.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const comments = await this.sdk.listComments(input.cardId, input.boardId)
    return JSON.stringify(comments)
  }
}

export class AddCommentTool extends StructuredTool {
  name = 'kanban_add_comment'
  description = 'Add a comment to a kanban card.'
  schema = z.object({
    cardId: z.string().describe('The card ID to comment on.'),
    author: z.string().describe('Display name of the comment author.'),
    content: z.string().describe('Comment text (supports markdown).'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const card = await this.sdk.addComment(input.cardId, input.author, input.content, input.boardId)
    const comment = card.comments?.[card.comments.length - 1]
    return JSON.stringify(comment ?? { cardId: input.cardId, added: true })
  }
}

export class UpdateCommentTool extends StructuredTool {
  name = 'kanban_update_comment'
  description = 'Update the content of an existing comment on a kanban card.'
  schema = z.object({
    cardId: z.string().describe('The card ID containing the comment.'),
    commentId: z.string().describe('The comment ID to update (e.g. "c1", "c2").'),
    content: z.string().describe('New comment content.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const card = await this.sdk.updateComment(input.cardId, input.commentId, input.content, input.boardId)
    const comment = card.comments?.find((c: any) => c.id === input.commentId)
    return JSON.stringify(comment ?? { cardId: input.cardId, commentId: input.commentId, updated: true })
  }
}

export class DeleteCommentTool extends StructuredTool {
  name = 'kanban_delete_comment'
  description = 'Delete a comment from a kanban card.'
  schema = z.object({
    cardId: z.string().describe('The card ID containing the comment.'),
    commentId: z.string().describe('The comment ID to delete.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    await this.sdk.deleteComment(input.cardId, input.commentId, input.boardId)
    return JSON.stringify({ deleted: true, commentId: input.commentId })
  }
}

/**
 * Stream a comment onto a kanban card from an async text source.
 *
 * This tool is designed for AI agent workflows where comment text is generated
 * incrementally (e.g. from an LLM textStream). The caller supplies an
 * `AsyncIterable<string>` and optional callbacks for live progress.
 *
 * Because LangChain tool invocations are text-in/text-out, this tool accepts
 * a plain `content` string **or** callers can use {@link streamCommentDirect}
 * for full streaming control.
 */
export class StreamCommentTool extends StructuredTool {
  name = 'kanban_stream_comment'
  description = 'Add a comment to a card. Designed for streaming AI-generated text; the comment is persisted atomically after the full text is provided.'
  schema = z.object({
    cardId: z.string().describe('The card ID to comment on.'),
    author: z.string().describe('Display name of the streaming author.'),
    content: z.string().describe('Full comment text to stream as a comment.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    // Convert the content string into a single-chunk async iterable so the
    // SDK streaming path is exercised (live viewers still see the stream).
    const chunks = input.content
    async function* toStream(): AsyncIterable<string> { yield chunks }
    const card = await this.sdk.streamComment(input.cardId, input.author, toStream(), { boardId: input.boardId })
    const comment = card.comments?.[card.comments.length - 1]
    return JSON.stringify(comment ?? { cardId: input.cardId, streamed: true })
  }
}

/**
 * Directly stream a comment using an AsyncIterable — not invoked via LangChain
 * tool calling but useful when composing LangGraph nodes that have access to
 * the adapter.
 */
export async function streamCommentDirect(
  sdk: KanbanSDK,
  opts: {
    cardId: string
    author: string
    stream: AsyncIterable<string>
    boardId?: string
    onStart?: (commentId: string, author: string, created: string) => void
    onChunk?: (commentId: string, chunk: string) => void
  },
) {
  return sdk.streamComment(opts.cardId, opts.author, opts.stream, {
    boardId: opts.boardId,
    onStart: opts.onStart,
    onChunk: opts.onChunk,
  })
}

export function createCommentTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new ListCommentsTool(sdk),
    new AddCommentTool(sdk),
    new UpdateCommentTool(sdk),
    new DeleteCommentTool(sdk),
    new StreamCommentTool(sdk),
  ]
}

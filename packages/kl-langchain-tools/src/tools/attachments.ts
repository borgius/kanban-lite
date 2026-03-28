import { z } from 'zod'
import { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './types'

// ---------------------------------------------------------------------------
// Attachment tools
// ---------------------------------------------------------------------------

export class ListAttachmentsTool extends StructuredTool {
  name = 'kanban_list_attachments'
  description = 'List all attachment filenames for a kanban card.'
  schema = z.object({
    cardId: z.string().describe('The card ID whose attachments to list.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const files = await this.sdk.listAttachments(input.cardId, input.boardId)
    return JSON.stringify(files)
  }
}

export class AddAttachmentTool extends StructuredTool {
  name = 'kanban_add_attachment'
  description = 'Attach a file to a kanban card by providing its absolute file path.'
  schema = z.object({
    cardId: z.string().describe('The card ID to attach the file to.'),
    sourcePath: z.string().describe('Absolute path to the file to attach.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const result = await this.sdk.addAttachment(input.cardId, input.sourcePath, input.boardId)
    return JSON.stringify(result)
  }
}

export class RemoveAttachmentTool extends StructuredTool {
  name = 'kanban_remove_attachment'
  description = 'Remove an attachment from a kanban card.'
  schema = z.object({
    cardId: z.string().describe('The card ID to remove the attachment from.'),
    attachment: z.string().describe('Filename of the attachment to remove.'),
    boardId: z.string().optional().describe('Board ID. Uses default board when omitted.'),
  })

  constructor(private sdk: KanbanSDK) { super() }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    await this.sdk.removeAttachment(input.cardId, input.attachment, input.boardId)
    return JSON.stringify({ removed: true, attachment: input.attachment })
  }
}

export function createAttachmentTools(sdk: KanbanSDK): StructuredTool[] {
  return [
    new ListAttachmentsTool(sdk),
    new AddAttachmentTool(sdk),
    new RemoveAttachmentTool(sdk),
  ]
}

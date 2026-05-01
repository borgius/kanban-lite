import * as path from 'path'
import type { Card, Comment, LabelDefinition, LogEntry } from '../shared/types'
import { sanitizeCard } from './types'
import * as Labels from './modules/labels'
import * as Attachments from './modules/attachments'
import * as Comments from './modules/comments'
import * as Logs from './modules/logs'
import type { MethodInput } from './KanbanSDK-types'
import { KanbanSDKCards } from './KanbanSDK-cards'

export { KanbanSDKCards }

export class KanbanSDKData extends KanbanSDKCards {
  // --- Label definitions ---

  getLabels(): Record<string, LabelDefinition> {
    return Labels.getLabels(this._ctx)
  }

  async setLabel(name: string, definition: LabelDefinition): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Labels.setLabel>>('label.set', { name, definition: { ...definition } })
    Labels.setLabel(this._ctx, mergedInput)
  }

  async deleteLabel(name: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Labels.deleteLabel>>('label.delete', { name })
    return Labels.deleteLabel(this._ctx, mergedInput)
  }

  async renameLabel(oldName: string, newName: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Labels.renameLabel>>('label.rename', { oldName, newName })
    return Labels.renameLabel(this._ctx, mergedInput)
  }

  getLabelsInGroup(group: string): string[] {
    return Labels.getLabelsInGroup(this._ctx, { group })
  }

  async filterCardsByLabelGroup(group: string, boardId?: string): Promise<Card[]> {
    return Labels.filterCardsByLabelGroup(this._ctx, { group, boardId })
  }

  // --- Attachments ---

  async addAttachment(cardId: string, sourcePath: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Attachments.addAttachment>>('attachment.add', { cardId, sourcePath, boardId }, undefined, boardId)
    const card = await Attachments.addAttachment(this._ctx, mergedInput)
    this._runAfterEvent('attachment.added', { cardId: mergedInput.cardId, attachment: path.basename(mergedInput.sourcePath) }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return this._getScopedMutationCard(card)
  }

  async addAttachmentData(cardId: string, filename: string, data: string | Uint8Array, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Attachments.addAttachmentData>>(
      'attachment.add',
      { cardId, filename, data, boardId },
      undefined,
      boardId,
    )
    const card = await Attachments.addAttachmentData(this._ctx, mergedInput)
    this._runAfterEvent('attachment.added', { cardId: mergedInput.cardId, attachment: path.basename(mergedInput.filename) }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return this._getScopedMutationCard(card)
  }

  async removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Attachments.removeAttachment>>('attachment.remove', { cardId, attachment, boardId }, undefined, boardId)
    const card = await Attachments.removeAttachment(this._ctx, mergedInput)
    this._runAfterEvent('attachment.removed', { cardId: mergedInput.cardId, attachment: mergedInput.attachment }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return this._getScopedMutationCard(card)
  }

  async listAttachments(cardId: string, boardId?: string): Promise<string[]> {
    return Attachments.listAttachments(this._ctx, { cardId, boardId })
  }

  async getAttachmentData(cardId: string, filename: string, boardId?: string): Promise<{ data: Uint8Array; contentType?: string } | null> {
    return Attachments.getAttachmentData(this._ctx, { cardId, filename, boardId })
  }

  async getAttachmentDir(cardId: string, boardId?: string): Promise<string | null> {
    return Attachments.getAttachmentDir(this._ctx, { cardId, boardId })
  }

  // --- Comments ---

  async listComments(cardId: string, boardId?: string): Promise<Comment[]> {
    return Comments.listComments(this._ctx, { cardId, boardId })
  }

  async addComment(cardId: string, author: string, content: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Comments.addComment>>('comment.create', { cardId, author, content, boardId }, undefined, boardId)
    const card = await Comments.addComment(this._ctx, mergedInput)
    const newComment = card.comments[card.comments.length - 1]
    if (newComment) this._runAfterEvent('comment.created', { ...newComment, cardId: mergedInput.cardId }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return this._getScopedMutationCard(card)
  }

  async updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Comments.updateComment>>('comment.update', { cardId, commentId, content, boardId }, undefined, boardId)
    const card = await Comments.updateComment(this._ctx, mergedInput)
    const updatedComment = card.comments?.find(c => c.id === mergedInput.commentId)
    if (updatedComment) this._runAfterEvent('comment.updated', { ...updatedComment, cardId: mergedInput.cardId }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return this._getScopedMutationCard(card)
  }

  async deleteComment(cardId: string, commentId: string, boardId?: string): Promise<Card> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Comments.deleteComment>>('comment.delete', { cardId, commentId, boardId }, undefined, boardId)
    const cardBefore = await this.getCard(mergedInput.cardId, mergedInput.boardId)
    const deletedComment = cardBefore?.comments?.find(c => c.id === mergedInput.commentId)
    const card = await Comments.deleteComment(this._ctx, mergedInput)
    if (deletedComment) this._runAfterEvent('comment.deleted', { ...deletedComment, cardId: mergedInput.cardId }, undefined, card.boardId ?? this._resolveBoardId(mergedInput.boardId))
    return this._getScopedMutationCard(card)
  }

  async streamComment(
    cardId: string,
    author: string,
    stream: AsyncIterable<string>,
    options?: {
      boardId?: string
      onStart?: (commentId: string, author: string, created: string) => void
      onChunk?: (commentId: string, chunk: string) => void
    }
  ): Promise<Card> {
    const { boardId, onStart, onChunk } = options ?? {}
    const card = await Comments.streamComment(this._ctx, { cardId, author, boardId, stream, onStart, onChunk })
    const newComment = card.comments?.[card.comments.length - 1]
    if (newComment) this._runAfterEvent('comment.created', { ...newComment, cardId }, undefined, card.boardId ?? this._resolveBoardId(boardId))
    return this._getScopedMutationCard(card)
  }

  // --- Card logs ---

  async getLogFilePath(cardId: string, boardId?: string): Promise<string | null> {
    return Logs.getLogFilePath(this._ctx, { cardId, boardId })
  }

  async listLogs(cardId: string, boardId?: string): Promise<LogEntry[]> {
    return Logs.listLogs(this._ctx, { cardId, boardId })
  }

  async addLog(
    cardId: string,
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string,
  ): Promise<LogEntry> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.addLog>>('log.add', { cardId, text, boardId, options }, undefined, boardId)
    const entry = await Logs.addLog(this._ctx, mergedInput)
    this._runAfterEvent('log.added', { cardId: mergedInput.cardId, entry }, undefined, this._resolveBoardId(mergedInput.boardId))
    return entry
  }

  async clearLogs(cardId: string, boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.clearLogs>>('log.clear', { cardId, boardId }, undefined, boardId)
    await Logs.clearLogs(this._ctx, mergedInput)
    this._runAfterEvent('log.cleared', { cardId: mergedInput.cardId }, undefined, this._resolveBoardId(mergedInput.boardId))
  }

  // --- Board logs ---

  getBoardLogFilePath(boardId?: string): string {
    return Logs.getBoardLogFilePath(this._ctx, { boardId })
  }

  async listBoardLogs(boardId?: string): Promise<LogEntry[]> {
    return Logs.listBoardLogs(this._ctx, { boardId })
  }

  async addBoardLog(
    text: string,
    options?: { source?: string; timestamp?: string; object?: Record<string, unknown> },
    boardId?: string,
  ): Promise<LogEntry> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.addBoardLog>>('board.log.add', { text, boardId, options }, undefined, boardId)
    const entry = await Logs.addBoardLog(this._ctx, mergedInput)
    this._runAfterEvent('board.log.added', { boardId: this._resolveBoardId(mergedInput.boardId), entry }, undefined, this._resolveBoardId(mergedInput.boardId))
    return entry
  }

  async clearBoardLogs(boardId?: string): Promise<void> {
    const mergedInput = await this._runBeforeEvent<MethodInput<typeof Logs.clearBoardLogs>>('board.log.clear', { boardId }, undefined, boardId)
    await Logs.clearBoardLogs(this._ctx, mergedInput)
    this._runAfterEvent('board.log.cleared', { boardId: this._resolveBoardId(mergedInput.boardId as string | undefined) }, undefined, this._resolveBoardId(mergedInput.boardId as string | undefined))
  }
}

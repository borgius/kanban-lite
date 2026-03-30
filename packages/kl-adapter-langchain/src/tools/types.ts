/**
 * Minimal KanbanSDK interface consumed by the LangChain tools layer.
 *
 * Mirrors the public surface of `KanbanSDK` from `kanban-lite/sdk` so that
 * this package does not require a hard compile-time dependency on the main
 * kanban-lite package. Consumers pass a real `KanbanSDK` instance at runtime.
 */
export interface KanbanSDK {
  // Board
  listBoards(): any[]
  getBoard(boardId: string): any
  createBoard(id: string, name: string, options?: any): any
  deleteBoard(boardId: string): void
  updateBoard(boardId: string, updates: any): any
  getBoardActions(boardId?: string): Record<string, string>

  // Card
  listCards(sortBy?: any, boardId?: string): Promise<any[]>
  getCard(cardId: string, boardId?: string): Promise<any>
  createCard(data: any): Promise<any>
  updateCard(cardId: string, updates: any, boardId?: string): Promise<any>
  moveCard(cardId: string, newStatus: any, position?: string, boardId?: string): Promise<any>
  deleteCard(cardId: string, boardId?: string): Promise<void>
  triggerAction(cardId: string, action: string, boardId?: string): Promise<any>
  getCardsByStatus(status: string, boardId?: string): Promise<any[]>
  getUniqueAssignees(boardId?: string): Promise<string[]>
  getUniqueLabels(boardId?: string): Promise<string[]>

  // Comment
  listComments(cardId: string, boardId?: string): Promise<any[]>
  addComment(cardId: string, author: string, content: string, boardId?: string): Promise<any>
  updateComment(cardId: string, commentId: string, content: string, boardId?: string): Promise<any>
  deleteComment(cardId: string, commentId: string, boardId?: string): Promise<any>
  streamComment(
    cardId: string,
    author: string,
    stream: AsyncIterable<string>,
    options?: {
      boardId?: string
      onStart?: (commentId: string, author: string, created: string) => void
      onChunk?: (commentId: string, chunk: string) => void
    },
  ): Promise<any>

  // Column
  listColumns(boardId?: string): any[]
  addColumn(column: any, boardId?: string): any
  updateColumn(columnId: string, updates: any, boardId?: string): any
  removeColumn(columnId: string, boardId?: string): void
  reorderColumns(columnIds: string[], boardId?: string): void

  // Label
  getLabels(): Record<string, any>
  setLabel(name: string, definition: any): void
  deleteLabel(name: string): void
  renameLabel(oldName: string, newName: string): void
  filterCardsByLabelGroup(group: string, boardId?: string): Promise<any[]>

  // Attachment
  listAttachments(cardId: string, boardId?: string): Promise<string[]>
  addAttachment(cardId: string, sourcePath: string, boardId?: string): Promise<any>
  removeAttachment(cardId: string, attachment: string, boardId?: string): Promise<void>

  // Log
  listLogs(cardId: string, boardId?: string): Promise<any[]>
  addLog(cardId: string, text: string, options?: any, boardId?: string): Promise<any>
  clearLogs(cardId: string, boardId?: string): Promise<void>
  listBoardLogs(boardId?: string): Promise<any[]>
  addBoardLog(text: string, options?: any, boardId?: string): Promise<any>
  clearBoardLogs(boardId?: string): Promise<void>

  // Settings
  getSettings(): any
  updateSettings(settings: any): void

  // Lifecycle
  workspaceRoot: string
  init(): Promise<void>
}

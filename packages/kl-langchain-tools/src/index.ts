/**
 * kl-langchain-tools – LangChain / LangGraph adapter for kanban-lite.
 *
 * Exposes all kanban-lite features (cards, comments, columns, labels, boards,
 * logs, attachments, actions) as LangChain {@link StructuredTool} instances.
 *
 * Provides optional LangGraph integration with a board-state annotation and
 * pre-built graph nodes for stateful agent workflows.
 *
 * @example
 * ```ts
 * import { KanbanSDK } from 'kanban-lite/sdk'
 * import { createKanbanToolkit } from 'kl-langchain-tools'
 *
 * const sdk = new KanbanSDK('/path/to/.kanban')
 * await sdk.init()
 *
 * // All tools for a LangChain agent
 * const tools = createKanbanToolkit(sdk)
 * ```
 *
 * @packageDocumentation
 */

// Toolkit
export { createKanbanToolkit } from './toolkit'
export type { KanbanToolkitOptions } from './toolkit'

// Individual tool classes and factory helpers
export {
  // Cards
  createCardTools,
  ListCardsTool,
  GetCardTool,
  CreateCardTool,
  UpdateCardTool,
  MoveCardTool,
  DeleteCardTool,
  GetCardsByStatusTool,
  TriggerActionTool,
  // Comments
  createCommentTools,
  ListCommentsTool,
  AddCommentTool,
  UpdateCommentTool,
  DeleteCommentTool,
  StreamCommentTool,
  streamCommentDirect,
  // Columns
  createColumnTools,
  ListColumnsTool,
  AddColumnTool,
  UpdateColumnTool,
  RemoveColumnTool,
  ReorderColumnsTool,
  // Labels
  createLabelTools,
  GetLabelsTool,
  SetLabelTool,
  DeleteLabelTool,
  RenameLabelTool,
  GetUniqueAssigneesTool,
  GetUniqueLabelsTool,
  FilterCardsByLabelGroupTool,
  // Boards
  createBoardTools,
  ListBoardsTool,
  GetBoardTool,
  CreateBoardTool,
  DeleteBoardTool,
  UpdateBoardTool,
  GetBoardActionsTool,
  // Logs
  createLogTools,
  ListLogsTool,
  AddLogTool,
  ClearLogsTool,
  ListBoardLogsTool,
  AddBoardLogTool,
  // Attachments
  createAttachmentTools,
  ListAttachmentsTool,
  AddAttachmentTool,
  RemoveAttachmentTool,
} from './tools'

// KanbanSDK interface type
export type { KanbanSDK } from './tools/types'

// LangGraph helpers (optional peer dependency)
export {
  getKanbanBoardState,
  createRefreshBoardNode,
  createKanbanToolNode,
} from './langgraph'
export type { CardSummary, ColumnSummary, BoardSnapshot } from './langgraph'

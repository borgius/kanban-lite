import type { StructuredTool } from '@langchain/core/tools'
import type { KanbanSDK } from './tools/types'
import { createCardTools } from './tools/cards'
import { createCommentTools } from './tools/comments'
import { createColumnTools } from './tools/columns'
import { createLabelTools } from './tools/labels'
import { createBoardTools } from './tools/boards'
import { createLogTools } from './tools/logs'
import { createAttachmentTools } from './tools/attachments'

/**
 * Options for configuring which tool categories the toolkit exposes.
 */
export interface KanbanToolkitOptions {
  /** Include card tools (list, get, create, update, move, delete, actions). Default: true. */
  cards?: boolean
  /** Include comment tools (list, add, update, delete, stream). Default: true. */
  comments?: boolean
  /** Include column tools (list, add, update, remove, reorder). Default: true. */
  columns?: boolean
  /** Include label tools (get, set, delete, rename, filter). Default: true. */
  labels?: boolean
  /** Include board tools (list, get, create, delete, update, actions). Default: true. */
  boards?: boolean
  /** Include log tools (list, add, clear, board-level). Default: true. */
  logs?: boolean
  /** Include attachment tools (list, add, remove). Default: true. */
  attachments?: boolean
}

/**
 * Creates a complete set of LangChain {@link StructuredTool} instances
 * backed by a kanban-lite SDK instance.
 *
 * Use this as the primary entry point when integrating kanban-lite with
 * LangChain agents or LangGraph workflows.
 *
 * @example
 * ```ts
 * import { KanbanSDK } from 'kanban-lite/sdk'
 * import { createKanbanToolkit } from 'kl-adapter-langchain'
 *
 * const sdk = new KanbanSDK('/path/to/.kanban')
 * await sdk.init()
 *
 * const tools = createKanbanToolkit(sdk)
 * // Pass `tools` to a LangChain agent or LangGraph ToolNode
 * ```
 */
export function createKanbanToolkit(
  sdk: KanbanSDK,
  options?: KanbanToolkitOptions,
): StructuredTool[] {
  const opts: Required<KanbanToolkitOptions> = {
    cards: true,
    comments: true,
    columns: true,
    labels: true,
    boards: true,
    logs: true,
    attachments: true,
    ...options,
  }

  const tools: StructuredTool[] = []
  if (opts.cards) tools.push(...createCardTools(sdk))
  if (opts.comments) tools.push(...createCommentTools(sdk))
  if (opts.columns) tools.push(...createColumnTools(sdk))
  if (opts.labels) tools.push(...createLabelTools(sdk))
  if (opts.boards) tools.push(...createBoardTools(sdk))
  if (opts.logs) tools.push(...createLogTools(sdk))
  if (opts.attachments) tools.push(...createAttachmentTools(sdk))
  return tools
}

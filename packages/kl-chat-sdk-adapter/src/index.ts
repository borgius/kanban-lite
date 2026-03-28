// ---------------------------------------------------------------------------
// kl-chat-sdk-adapter — Vercel AI Chat SDK adapter for kanban-lite
//
// Public API surface:
//   - KanbanClient          – configurable REST client
//   - createKanbanTools()   – Vercel AI SDK tool definitions factory
//   - Types                 – shared type definitions
// ---------------------------------------------------------------------------

export { KanbanClient } from './client'
export { createKanbanTools } from './tools'
export type { KanbanToolsOptions } from './tools'

export type {
  ApiEnvelope,
  CreateCardOptions,
  KanbanBoardInfo,
  KanbanCard,
  KanbanClientConfig,
  KanbanColumn,
  KanbanComment,
  KanbanFormAttachment,
  KanbanFormSubmitResult,
  KanbanLogEntry,
  KanbanResolvedForm,
  Priority,
} from './types'

import type { Card, CardTask, Priority, KanbanColumn, BoardInfo, Comment, LogEntry, CardStateReadModelTransport, CardDisplaySettings, CardFormAttachment, CardFormDataMap } from './card'
import type { CardFrontmatter, LabelDefinition, WorkspaceInfo, ResolvedFormDescriptor } from './forms'
import type { ShowSettingsMessage, PluginSettingsResultMessage, PluginSettingsPayload, PluginSettingsInstallScope } from './plugin-settings'
import type { PluginCapabilityNamespace } from '../config'

export interface CreateCardPayload {
  status: string
  priority: Priority
  content: string
  assignee: string | null
  dueDate: string | null
  labels: string[]
  tasks?: CardTask[]
  metadata?: Record<string, unknown>
  actions?: string[] | Record<string, string>
  forms?: CardFormAttachment[]
  formData?: CardFormDataMap
}

/**
 * Webview transport request for submitting a form attached to a card.
 */
export interface SubmitFormMessage {
  type: 'submitForm'
  cardId: string
  formId: string
  data: Record<string, unknown>
  callbackKey: string
  boardId?: string
}

export interface AddChecklistItemMessage {
  type: 'addChecklistItem'
  cardId: string
  title: string
  description: string
  expectedToken: string
  boardId?: string
}

export interface EditChecklistItemMessage {
  type: 'editChecklistItem'
  cardId: string
  index: number
  title: string
  description: string
  modifiedAt?: string
  boardId?: string
}

export interface DeleteChecklistItemMessage {
  type: 'deleteChecklistItem'
  cardId: string
  index: number
  modifiedAt?: string
  boardId?: string
}

export interface CheckChecklistItemMessage {
  type: 'checkChecklistItem'
  cardId: string
  index: number
  modifiedAt?: string
  boardId?: string
}

export interface UncheckChecklistItemMessage {
  type: 'uncheckChecklistItem'
  cardId: string
  index: number
  modifiedAt?: string
  boardId?: string
}

/**
 * Transport-safe result for a successful form submission.
 * Mirrors the SDK `submitForm` contract while keeping shared types decoupled
 * from the SDK module graph.
 */
export interface SubmitFormTransportResult {
  boardId: string
  card: Omit<Card, 'filePath'>
  form: ResolvedFormDescriptor
  data: Record<string, unknown>
}

/**
 * Standalone transport lifecycle status emitted to the frontend.
 *
 * This is produced by the standalone shim only; the native VS Code webview
 * path does not emit these messages.
 */
export interface ConnectionStatusMessage {
  type: 'connectionStatus'
  connected: boolean
  reconnecting: boolean
  fatal: boolean
  retryCount?: number
  maxRetries?: number
  retryDelayMs?: number
  reason?: string
}

export type SyncTransportMode = 'websocket' | 'http-sync-websocket-notify'

// Messages between extension and webview
export type ExtensionMessage =
  | { type: 'init'; cards: Card[]; columns: KanbanColumn[]; settings: CardDisplaySettings; boards?: BoardInfo[]; currentBoard?: string; workspace?: WorkspaceInfo; labels?: Record<string, LabelDefinition>; minimizedColumnIds?: string[] }
  | ConnectionStatusMessage
  | { type: 'syncTransportMode'; mode: SyncTransportMode }
  | { type: 'syncRequired'; reason?: string }
  | { type: 'cardsUpdated'; cards: Card[] }
  | { type: 'triggerCreateDialog' }
  | { type: 'cardContent'; cardId: string; content: string; frontmatter: CardFrontmatter; comments: Comment[]; logs?: LogEntry[]; canUpdateMetadata?: boolean }
  | ShowSettingsMessage
  | PluginSettingsResultMessage
  | { type: 'labelsUpdated'; labels: Record<string, LabelDefinition> }
  | { type: 'actionResult'; callbackKey: string; error?: string }
  | { type: 'boardActionResult'; callbackKey: string; error?: string }
  | { type: 'submitFormResult'; callbackKey: string; result?: SubmitFormTransportResult; error?: string }
  | { type: 'logsUpdated'; cardId: string; logs: LogEntry[] }
  | { type: 'boardLogsUpdated'; boardId: string; logs: LogEntry[] }
  | { type: 'commentStreamStart'; cardId: string; commentId: string; author: string; created: string }
  | { type: 'commentChunk'; cardId: string; commentId: string; chunk: string }
  | { type: 'commentStreamDone'; cardId: string; commentId: string }
  | { type: 'cardStates'; states: Record<string, CardStateReadModelTransport> }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'createCard'; data: CreateCardPayload }
  | { type: 'moveCard'; cardId: string; newStatus: string; newOrder: number }
  | { type: 'deleteCard'; cardId: string }
  | { type: 'updateCard'; cardId: string; updates: Partial<Card> }
  | { type: 'openCard'; cardId: string }
  | { type: 'saveCardContent'; cardId: string; content: string; frontmatter: CardFrontmatter }
  | AddChecklistItemMessage
  | EditChecklistItemMessage
  | DeleteChecklistItemMessage
  | CheckChecklistItemMessage
  | UncheckChecklistItemMessage
  | { type: 'closeCard' }
  | { type: 'openFile'; cardId: string }
  | { type: 'openMetadataFile'; path: string }
  | { type: 'downloadCard'; cardId: string }
  | { type: 'addAttachment'; cardId: string }
  | { type: 'openAttachment'; cardId: string; attachment: string }
  | { type: 'removeAttachment'; cardId: string; attachment: string }
  | { type: 'openSettings' }
  | { type: 'toggleTheme' }
  | { type: 'loadPluginSettings' }
  | { type: 'readPluginSettings'; capability: PluginCapabilityNamespace; providerId: string }
  | { type: 'selectPluginSettingsProvider'; capability: PluginCapabilityNamespace; providerId: string }
  | { type: 'updatePluginSettingsOptions'; capability: PluginCapabilityNamespace; providerId: string; options: Record<string, unknown> }
  | { type: 'installPluginSettingsPackage'; packageName: string; scope: PluginSettingsInstallScope }
  | { type: 'saveSettings'; settings: CardDisplaySettings }
  | { type: 'addColumn'; column: { name: string; color: string } }
  | { type: 'editColumn'; columnId: string; updates: { name: string; color: string } }
  | { type: 'removeColumn'; columnId: string }
  | { type: 'reorderColumns'; columnIds: string[]; boardId?: string }
  | { type: 'setMinimizedColumns'; columnIds: string[]; boardId?: string }
  | { type: 'addComment'; cardId: string; author: string; content: string }
  | { type: 'updateComment'; cardId: string; commentId: string; content: string }
  | { type: 'deleteComment'; cardId: string; commentId: string }
  | { type: 'switchBoard'; boardId: string }
  | { type: 'createBoard'; name: string }
  | { type: 'permanentDeleteCard'; cardId: string }
  | { type: 'restoreCard'; cardId: string }
  | { type: 'purgeDeletedCards' }
  | { type: 'transferCard'; cardId: string; toBoard: string; targetStatus: string }
  | { type: 'setLabel'; name: string; definition: LabelDefinition }
  | { type: 'updateBoardTitle'; boardId?: string; title: string[] }
  | { type: 'updateBoardActions'; boardId?: string; actions: Record<string, string> }
  | { type: 'renameLabel'; oldName: string; newName: string }
  | { type: 'deleteLabel'; name: string }
  | { type: 'triggerAction'; cardId: string; action: string; callbackKey: string }
  | { type: 'triggerBoardAction'; boardId: string; actionKey: string; callbackKey: string }
  | SubmitFormMessage
  | { type: 'addLog'; cardId: string; text: string; source?: string; object?: Record<string, unknown>; timestamp?: string }
  | { type: 'clearLogs'; cardId: string }
  | { type: 'getLogs'; cardId: string }
  | { type: 'addBoardLog'; text: string; source?: string; object?: Record<string, unknown>; timestamp?: string }
  | { type: 'clearBoardLogs' }
  | { type: 'getBoardLogs' }
  | { type: 'getCardStates'; cardIds: string[] }

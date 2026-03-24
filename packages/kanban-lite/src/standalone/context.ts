import type { Card } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import type { WebSocket, WebSocketServer } from 'ws'
import type chokidar from 'chokidar'

/** Shared mutable runtime state for the standalone server. */
export interface StandaloneContext {
  absoluteKanbanDir: string
  workspaceRoot: string
  sdk: KanbanSDK
  wss: WebSocketServer
  cards: Card[]
  migrating: boolean
  suppressWatcherEventsUntil: number
  currentEditingCardId: string | null
  clientEditingCardIds: Map<WebSocket, string | null>
  lastWrittenContent: string
  currentBoardId: string | undefined
  tempFilePath: string | undefined
  tempFileCardId: string | undefined
  tempFileWatcher: ReturnType<typeof chokidar.watch> | undefined
  tempFileWriting: boolean
}

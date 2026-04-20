import type { Card } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import type { AuthContext } from '../sdk/types'
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
  clientAuthContexts: Map<WebSocket, AuthContext>
  lastWrittenContent: string
  currentBoardId: string | undefined
  tempFilePath: string | undefined
  tempFileCardId: string | undefined
  tempFileAuthContext: AuthContext | undefined
  tempFileWatcher: ReturnType<typeof chokidar.watch> | undefined
  tempFileWriting: boolean
  /**
   * When `true`, mutations skip `loadCards` + `broadcast` after SDK calls.
   * Used by the HTTP sync path where broadcasts target no real WebSocket
   * clients and the post-sync rebuild handles state refresh instead.
   */
  skipMutationBroadcast?: boolean
  /**
   * Per-request cache for `scanCards` results keyed by `boardDir:boardId`.
   * Set by `enableScanCardsCache()` and cleared by `clearScanCardsCache()`.
   */
  _scanCardsCache?: Map<string, Card[]>
}

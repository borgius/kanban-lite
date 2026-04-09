import type { AuthContext } from '../../sdk/types'
import { getAuthErrorLike } from '../authUtils'
import {
  buildScopedInitMessage,
  clearClientAuthContext,
  clearClientEditingCard,
  setClientAuthContext,
  setClientEditingCard,
} from '../broadcastService'
import type { StandaloneContext } from '../context'
import { handleMessage } from '../messageHandlers'

type SyncOutboundMessage = Record<string, unknown>
const OPEN_WEBSOCKET_STATE = 1
const POST_SYNC_INIT_MESSAGE_TYPES = new Set([
  'createCard',
  'moveCard',
  'deleteCard',
  'permanentDeleteCard',
  'restoreCard',
  'purgeDeletedCards',
  'updateCard',
  'bulkUpdateCard',
  'saveCardContent',
  'addChecklistItem',
  'editChecklistItem',
  'deleteChecklistItem',
  'checkChecklistItem',
  'uncheckChecklistItem',
  'submitForm',
  'closeCard',
  'removeAttachment',
  'addComment',
  'updateComment',
  'deleteComment',
  'addLog',
  'clearLogs',
  'addBoardLog',
  'clearBoardLogs',
  'transferCard',
  'switchBoard',
  'createBoard',
  'setLabel',
  'renameLabel',
  'deleteLabel',
  'triggerAction',
  'triggerBoardAction',
  'saveSettings',
  'addColumn',
  'editColumn',
  'removeColumn',
  'cleanupColumn',
  'reorderColumns',
  'setMinimizedColumns',
])

function parseOutboundMessage(payload: unknown): SyncOutboundMessage | null {
  if (typeof payload !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    return parsed && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}

function requiresPostSyncInit(message: unknown): boolean {
  const type = (message as { type?: unknown } | null)?.type
  return typeof type === 'string' && POST_SYNC_INIT_MESSAGE_TYPES.has(type)
}

export async function syncWebviewMessages(
  ctx: StandaloneContext,
  messages: unknown[],
  authContext: AuthContext,
): Promise<SyncOutboundMessage[]> {
  const outbound: SyncOutboundMessage[] = []
  const client = {
    readyState: OPEN_WEBSOCKET_STATE,
    send(payload: unknown) {
      const parsed = parseOutboundMessage(payload)
      if (parsed) {
        outbound.push(parsed)
      }
    },
  } as { readyState: number; send: (payload: unknown) => void }

  const wsClient = client as Parameters<typeof setClientAuthContext>[1]

  ctx.wss.clients.add(wsClient)
  setClientAuthContext(ctx, wsClient, authContext)
  setClientEditingCard(ctx, wsClient, null)

  try {
    for (const message of messages) {
      await handleMessage(ctx, wsClient, message, authContext)
    }

    if (messages.some(requiresPostSyncInit)) {
      const initMessage = await buildScopedInitMessage(ctx, authContext)
      if (initMessage && typeof initMessage === 'object' && !Array.isArray(initMessage)) {
        outbound.push(initMessage as SyncOutboundMessage)
      }
    }
  } catch (error) {
    const authErr = getAuthErrorLike(error)
    if (authErr) {
      outbound.push({
        type: 'authDenied',
        category: authErr.category,
        message: authErr.message,
      })
    } else {
      throw error
    }
  } finally {
    clearClientAuthContext(ctx, wsClient)
    clearClientEditingCard(ctx, wsClient)
    ctx.wss.clients.delete(wsClient)
  }

  return outbound
}

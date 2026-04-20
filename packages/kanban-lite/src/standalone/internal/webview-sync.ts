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

// Card-scoped operations (saveCardContent, addComment, updateComment,
// deleteComment, addLog, clearLogs, addChecklistItem, editChecklistItem,
// deleteChecklistItem, checkChecklistItem, uncheckChecklistItem,
// removeAttachment, closeCard) are intentionally excluded from
// POST_SYNC_INIT_MESSAGE_TYPES.  They only affect the currently-open card's
// content — the mutation handler already sends a targeted `cardContent`
// message back, so a full init/cardsUpdated rebuild would be redundant and
// waste a D1 scanCards + decorateCardsForWebview pass.

const POST_SYNC_INIT_MESSAGE_TYPES = new Set([
  'createCard',
  'moveCard',
  'deleteCard',
  'permanentDeleteCard',
  'restoreCard',
  'purgeDeletedCards',
  'updateCard',
  'bulkUpdateCard',
  'submitForm',
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
  'addBoardLog',
  'clearBoardLogs',
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
  // Track the index of the last emitted init/cardsUpdated so we can
  // coalesce duplicates instead of sending multiple ~MB-sized snapshots
  // back to the browser. Multiple handlers (e.g. ready + switchBoard
  // broadcast + post-sync rebuild) can each emit an init for the same
  // resulting state; only the last one is authoritative.
  const coalesceIndexByType = new Map<string, number>()
  const COALESCE_TYPES = new Set(['init', 'cardsUpdated'])
  const client = {
    readyState: OPEN_WEBSOCKET_STATE,
    send(payload: unknown) {
      const parsed = parseOutboundMessage(payload)
      if (!parsed) return
      const type = typeof parsed.type === 'string' ? parsed.type : null
      if (type && COALESCE_TYPES.has(type)) {
        const existing = coalesceIndexByType.get(type)
        if (existing !== undefined) {
          outbound[existing] = parsed
          return
        }
        coalesceIndexByType.set(type, outbound.length)
      }
      outbound.push(parsed)
    },
  } as { readyState: number; send: (payload: unknown) => void }

  const wsClient = client as Parameters<typeof setClientAuthContext>[1]

  // Intentionally do NOT register the pseudo-client in `ctx.wss.clients`:
  // broadcast fan-out (`broadcastPerClient`) would otherwise run an
  // expensive `decorateCardsForWebview` pass for us on every mutation
  // (e.g. `switchBoard` → broadcast init) while this same request also
  // produces an authoritative init via the `ready` handler or the
  // post-sync rebuild below. Skipping fan-out keeps decoration to a
  // single pass per HTTP sync, which is critical against high-latency
  // backends like Cloudflare D1.
  setClientAuthContext(ctx, wsClient, authContext)
  setClientEditingCard(ctx, wsClient, null)

  try {
    for (const message of messages) {
      await handleMessage(ctx, wsClient, message, authContext)
    }

    // Because this pseudo-client is not registered for broadcasts, we
    // must rebuild the init ourselves whenever a message mutated state
    // but no handler explicitly sent an init to this client (e.g. the
    // `ready` handler does so directly, but `switchBoard` alone does
    // not — it only broadcasts, which we intentionally skipped). Build
    // the fresh init so the browser has an authoritative snapshot.
    // expensive on high-latency backends like Cloudflare KV, so we avoid
    // duplicating that work.
    if (!coalesceIndexByType.has('init') && messages.some(requiresPostSyncInit)) {
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
  }

  return outbound
}

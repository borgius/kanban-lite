import * as http from 'http'
import { extractAuthContext, getAuthErrorLike } from '../authUtils'
import type { AuthContext } from '../../sdk/types'
import type { StandaloneContext } from '../context'
import { clearClientAuthContext, clearClientEditingCard, setClientAuthContext, setClientEditingCard } from '../broadcastService'
import { handleMessage } from '../messageHandlers'

export function attachWebSocketHandlers(
  ctx: StandaloneContext,
  resolveAuthContext?: (req: http.IncomingMessage) => Promise<AuthContext>,
): void {
  ctx.wss.on('connection', async (ws, req) => {
    // Buffer messages that arrive while auth is being resolved asynchronously.
    // Without this, the browser's immediate 'ready' message (sent on WS open)
    // is dropped because the real message handler isn't registered yet.
    const buffered: Buffer[] = []
    ws.on('message', (data) => { buffered.push(data as Buffer) })
    ws.on('close', () => {
      clearClientAuthContext(ctx, ws)
      clearClientEditingCard(ctx, ws)
    })

    let authContext: AuthContext
    try {
      authContext = resolveAuthContext ? await resolveAuthContext(req) : extractAuthContext(req)
    } catch {
      authContext = extractAuthContext(req)
    }
    setClientAuthContext(ctx, ws, authContext)
    setClientEditingCard(ctx, ws, null)

    function dispatch(data: Buffer) {
      let message: unknown
      try {
        message = JSON.parse(data.toString())
      } catch (err) {
        console.error('Failed to parse websocket message:', err)
        return
      }
      handleMessage(ctx, ws, message, authContext).catch((err) => {
        const authErr = getAuthErrorLike(err)
        if (authErr) {
          ws.send(JSON.stringify({ type: 'authDenied', category: authErr.category, message: authErr.message }))
        } else {
          console.error('Failed to handle message:', err)
        }
      })
    }

    // Swap the temporary buffer listener for the real one, then replay.
    ws.removeAllListeners('message')
    ws.on('message', dispatch)
    for (const data of buffered) dispatch(data)
  })
}

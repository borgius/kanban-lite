import { extractAuthContext, getAuthErrorLike } from '../authUtils'
import type { StandaloneContext } from '../context'
import { clearClientEditingCard, setClientEditingCard } from '../broadcastService'
import { handleMessage } from '../messageHandlers'

export function attachWebSocketHandlers(ctx: StandaloneContext): void {
  ctx.wss.on('connection', (ws, req) => {
    const authContext = extractAuthContext(req)
    setClientEditingCard(ctx, ws, null)
    ws.on('message', (data) => {
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
    })
    ws.on('close', () => {
      clearClientEditingCard(ctx, ws)
    })
  })
}

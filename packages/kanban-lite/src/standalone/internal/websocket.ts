import { extractAuthContext } from '../authUtils'
import type { StandaloneContext } from '../context'
import { handleMessage } from '../messageHandlers'
import { AuthError } from '../../sdk/types'

export function attachWebSocketHandlers(ctx: StandaloneContext): void {
  ctx.wss.on('connection', (ws, req) => {
    const authContext = extractAuthContext(req)
    ws.on('message', (data) => {
      let message: unknown
      try {
        message = JSON.parse(data.toString())
      } catch (err) {
        console.error('Failed to parse websocket message:', err)
        return
      }
      handleMessage(ctx, ws, message, authContext).catch((err) => {
        if (err instanceof AuthError) {
          ws.send(JSON.stringify({ type: 'authDenied', category: err.category, message: err.message }))
        } else {
          console.error('Failed to handle message:', err)
        }
      })
    })
  })
}

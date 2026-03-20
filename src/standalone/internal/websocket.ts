import { extractAuthContext } from '../authUtils'
import type { StandaloneContext } from '../context'
import { handleMessage } from '../messageHandlers'

export function attachWebSocketHandlers(ctx: StandaloneContext): void {
  ctx.wss.on('connection', (ws, req) => {
    const authContext = extractAuthContext(req)
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        void handleMessage(ctx, ws, message, authContext)
      } catch (err) {
        console.error('Failed to handle message:', err)
      }
    })
  })
}

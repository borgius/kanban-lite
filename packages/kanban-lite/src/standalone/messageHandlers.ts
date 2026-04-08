import { WebSocket } from 'ws'
import type { AuthContext } from '../sdk/types'
import type { StandaloneContext } from './context'
import { dispatchCardMessage } from './messageHandlers/card-dispatch'
import { dispatchSettingsMessage } from './messageHandlers/settings-dispatch'
import { dispatchBoardMessage } from './messageHandlers/board-dispatch'

export async function handleMessage(ctx: StandaloneContext, ws: WebSocket, message: unknown, authContext: AuthContext): Promise<void> {
  const msg = message as Record<string, unknown>
  const runWithScopedAuth = <T>(fn: () => Promise<T>): Promise<T> => ctx.sdk.runWithAuth(authContext, fn)
  if (await dispatchCardMessage(ctx, ws, msg, runWithScopedAuth, authContext)) return
  if (await dispatchSettingsMessage(ctx, ws, msg, runWithScopedAuth)) return
  await dispatchBoardMessage(ctx, ws, msg, runWithScopedAuth, authContext)
}

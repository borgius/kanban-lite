import { KanbanSDK } from '../sdk/KanbanSDK'
import type { AuthContext } from '../sdk/types'

export function createMcpAuthHelpers(sdk: KanbanSDK) {
  function resolveAuthContext(): AuthContext {
    const token = process.env.KANBAN_LITE_TOKEN || process.env.KANBAN_TOKEN
    return token ? { token, tokenSource: 'env', transport: 'mcp' } : { transport: 'mcp' }
  }

  function runWithAuth<T>(fn: () => Promise<T>): Promise<T> {
    return sdk.runWithAuth(resolveAuthContext(), fn)
  }

  function getAuthStatus() {
    const auth = sdk.getAuthStatus()
    const ctx = resolveAuthContext()
    return {
      ...auth,
      configured: auth.identityEnabled || auth.policyEnabled,
      tokenPresent: Boolean(ctx.token),
      tokenSource: ctx.tokenSource ?? null,
      transport: ctx.transport ?? 'mcp',
    }
  }

  return {
    resolveAuthContext,
    runWithAuth,
    getAuthStatus,
  }
}

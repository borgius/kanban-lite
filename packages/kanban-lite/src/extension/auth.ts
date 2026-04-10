import * as vscode from 'vscode'

import { KanbanSDK } from '../sdk/KanbanSDK'
import { resolveCurrentUserName } from '../sdk/resolveCurrentUserName'
import type { AuthContext } from '../sdk/types'

export const AUTH_TOKEN_SECRET_KEY = 'kanban-lite.authToken'

export async function resolveExtensionAuthContext(context: vscode.ExtensionContext): Promise<AuthContext> {
  const token = await context.secrets.get(AUTH_TOKEN_SECRET_KEY)
  return token
    ? { token, tokenSource: 'secret-storage', transport: 'extension' }
    : { transport: 'extension' }
}

export async function getExtensionAuthStatus(context: vscode.ExtensionContext, sdk: KanbanSDK) {
  const auth = sdk.getAuthStatus()
  const token = await context.secrets.get(AUTH_TOKEN_SECRET_KEY)
  return {
    ...auth,
    configured: auth.identityEnabled || auth.policyEnabled,
    tokenPresent: Boolean(token),
    tokenSource: token ? 'secret-storage' : null,
    transport: 'extension',
  }
}

export async function resolveExtensionCurrentUser(context: vscode.ExtensionContext, sdk: KanbanSDK): Promise<string> {
  return resolveCurrentUserName(sdk, await resolveExtensionAuthContext(context))
}

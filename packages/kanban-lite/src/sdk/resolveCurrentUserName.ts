import type { KanbanSDK } from './KanbanSDK'
import type { AuthContext } from './types'

/**
 * Resolves the best available display name for the current caller.
 *
 * Host surfaces can use this for UI defaults that should prefer the authenticated
 * identity subject when available, while still falling back to a stable anonymous
 * label for logged-out or unresolved sessions.
 */
export async function resolveCurrentUserName(
  sdk: Pick<KanbanSDK, 'capabilities'>,
  authContext?: AuthContext,
  fallback = 'User',
): Promise<string> {
  const normalizedFallback = fallback.trim() || 'User'
  const trustedSubject = authContext?.identity?.subject?.trim()

  if (trustedSubject) {
    return trustedSubject
  }

  try {
    const identity = await sdk.capabilities?.authIdentity.resolveIdentity(authContext ?? {})
    const resolvedSubject = identity?.subject?.trim()
    if (resolvedSubject) {
      return resolvedSubject
    }
  } catch {
    // Logged-out or invalid sessions should still keep the UI usable.
  }

  return normalizedFallback
}

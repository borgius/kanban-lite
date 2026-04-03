import * as Linking from 'expo-linking'
import { useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { useSessionController } from './session-store'

/**
 * Returns true only when `url` looks like an intentional mobile entry link —
 * i.e. it carries a `workspaceOrigin`/`bootstrapToken` query parameter or uses
 * a non-http custom scheme.  On web, `Linking.getInitialURL()` returns the
 * browser's current `window.location.href` (e.g. `http://localhost:8081`),
 * which must NOT be treated as a workspace URL.
 */
function isMobileEntryUrl(url: string | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    return parsed.searchParams.has('workspaceOrigin') || parsed.searchParams.has('bootstrapToken')
  } catch {
    return url.trim().length > 0
  }
}

export function SessionRuntimeBridge() {
  const router = useRouter()
  const segments = useSegments()
  const { controller, state } = useSessionController()
  const isBusy = state.phase === 'restoring' || state.phase === 'signing-in'
  const topLevelSegment = segments[0]

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      const initialUrl = await Linking.getInitialURL()
      if (cancelled) {
        return
      }

      await controller.initialize(isMobileEntryUrl(initialUrl) ? initialUrl : null)
    }

    void start()

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void controller.handleIncomingEntry(url, 'deep-link')
    })

    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [controller])

  useEffect(() => {
    const inAuthGroup = topLevelSegment === '(auth)'
    const inProtectedSurface = topLevelSegment === '(app)' || topLevelSegment === 'tasks'

    if (state.isProtectedReady) {
      if (inAuthGroup) {
        router.replace('/(app)')
      }
      return
    }

    if (!isBusy && inProtectedSurface) {
      router.replace('/(auth)')
    }
  }, [isBusy, router, state.isProtectedReady, topLevelSegment])

  return null
}
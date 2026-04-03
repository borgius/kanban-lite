import * as Linking from 'expo-linking'
import { useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { useSessionController } from './session-store'

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

      await controller.initialize(initialUrl)
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
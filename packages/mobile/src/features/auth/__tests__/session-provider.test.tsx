import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import {
  SessionControllerProvider,
  createMemorySessionStorage,
  useSessionController,
  type MobileSessionClient,
  type MobileSessionStatus,
  type ResolvedMobileBootstrap,
} from '../session-store'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as unknown as { React?: typeof React }).React = React

const AUTHENTICATION = {
  provider: 'local' as const,
  browserLoginTransport: 'cookie-session' as const,
  mobileSessionTransport: 'opaque-bearer' as const,
  sessionKind: 'local-mobile-session-v1' as const,
}

function createStatus(overrides: Partial<MobileSessionStatus> = {}): MobileSessionStatus {
  return {
    workspaceOrigin: 'https://field.example.com',
    workspaceId: 'workspace_123',
    subject: 'worker',
    roles: ['user'],
    expiresAt: null,
    authentication: AUTHENTICATION,
    ...overrides,
  }
}

function createBootstrapResult(
  overrides: Partial<ResolvedMobileBootstrap> = {},
): ResolvedMobileBootstrap {
  return {
    workspaceOrigin: 'https://field.example.com',
    workspaceId: 'workspace_123',
    authentication: AUTHENTICATION,
    bootstrapToken: {
      provided: false,
      mode: 'none',
    },
    nextStep: 'local-login',
    ...overrides,
  }
}

function createClient(overrides: Partial<MobileSessionClient> = {}): MobileSessionClient {
  return {
    resolveBootstrap: vi.fn().mockResolvedValue(createBootstrapResult()),
    createSession: vi.fn().mockResolvedValue({
      session: {
        kind: 'local-mobile-session-v1',
        token: 'opaque-worker-token',
      },
      status: createStatus(),
    }),
    inspectSession: vi.fn().mockResolvedValue(createStatus()),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('SessionControllerProvider', () => {
  it('shares one controller instance and pending-target state across consumers', async () => {
    const storage = createMemorySessionStorage()
    const client = createClient()
    const seen: Record<'first' | 'second', ReturnType<typeof useSessionController> | null> = {
      first: null,
      second: null,
    }

    function Consumer({ id }: { id: 'first' | 'second' }) {
      const session = useSessionController()

      React.useEffect(() => {
        seen[id] = session
      }, [id, session])

      return null
    }

    await act(async () => {
      TestRenderer.create(
        <SessionControllerProvider dependencies={{ client, storage }}>
          <Consumer id="first" />
          <Consumer id="second" />
        </SessionControllerProvider>,
      )
    })

    expect(seen.first?.controller).toBeTruthy()
    expect(seen.first?.controller).toBe(seen.second?.controller)

    await act(async () => {
      await seen.first?.controller.handleIncomingEntry(
        'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&target=%2Fcards%2F42',
        'deep-link',
      )
    })

    expect(client.resolveBootstrap).toHaveBeenCalledTimes(1)
    expect(seen.first?.state).toMatchObject({
      phase: 'credentials',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      pendingTarget: '/cards/42',
    })
    expect(seen.second?.state).toMatchObject({
      phase: 'credentials',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      pendingTarget: '/cards/42',
    })
  })
})

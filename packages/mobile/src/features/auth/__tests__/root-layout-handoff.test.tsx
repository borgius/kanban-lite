import React from 'react'
import type { AuthSessionState } from '../session-store'
import type { ReactTestRenderer } from 'react-test-renderer'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as unknown as { React?: typeof React }).React = React

const AUTHENTICATION = {
  provider: 'local' as const,
  browserLoginTransport: 'cookie-session' as const,
  mobileSessionTransport: 'opaque-bearer' as const,
  sessionKind: 'local-mobile-session-v1' as const,
}

function createAuthState(overrides: Partial<AuthSessionState> = {}): AuthSessionState {
  return {
    phase: 'workspace-entry',
    statusMessage: null,
    workspaceInput: '',
    resolvedWorkspaceOrigin: null,
    pendingTarget: null,
    banner: null,
    sessionStatus: null,
    isProtectedReady: false,
    ...overrides,
  }
}

const harness = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  colorScheme: 'dark' as 'dark' | 'light',
  controller: {
    handleIncomingEntry: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
  },
  getInitialURL: vi.fn().mockResolvedValue(
    'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&target=%2Ftasks%2F42',
  ),
  removeListener: vi.fn(),
  replace: vi.fn(),
  segments: ['(auth)'] as string[],
  state: createAuthState(),
  urlListener: null as null | ((event: { url: string }) => void),
}))

vi.mock('expo-router', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')

  return {
    Stack: ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('Stack', props, children),
    useRouter: () => ({ replace: harness.replace }),
    useSegments: () => harness.segments,
  }
})

vi.mock('expo-linking', () => ({
  addEventListener: harness.addEventListener,
  getInitialURL: harness.getInitialURL,
}))

vi.mock('../session-store', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')

  return {
    SessionControllerProvider: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    useSessionController: () => ({
      controller: harness.controller,
      state: harness.state,
    }),
  }
})

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderLayout(): Promise<ReactTestRenderer> {
  const module = await import('../SessionRuntimeBridge')
  let renderer: ReactTestRenderer | null = null

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.SessionRuntimeBridge))
  })
  await flushEffects()

  if (!renderer) {
    throw new Error('Expected root layout renderer')
  }

  return renderer
}

beforeEach(() => {
  harness.addEventListener.mockImplementation((_event: string, listener: (event: { url: string }) => void) => {
    harness.urlListener = listener
    return { remove: harness.removeListener }
  })
  harness.colorScheme = 'dark'
  harness.controller.handleIncomingEntry.mockClear()
  harness.controller.initialize.mockClear()
  harness.getInitialURL.mockClear()
  harness.removeListener.mockClear()
  harness.replace.mockClear()
  harness.segments = ['(auth)']
  harness.state = createAuthState()
  harness.urlListener = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('mobile root layout auth/runtime handoff', () => {
  it('initializes the shared session runtime once and forwards incoming deep links', async () => {
    const renderer = await renderLayout()

    expect(harness.getInitialURL).toHaveBeenCalledTimes(1)
    expect(harness.controller.initialize).toHaveBeenCalledWith(
      'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&target=%2Ftasks%2F42',
    )
    expect(harness.addEventListener).toHaveBeenCalledTimes(1)
    expect(harness.addEventListener).toHaveBeenCalledWith('url', expect.any(Function))

    await act(async () => {
      harness.urlListener?.({
        url: 'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&target=%2Ftasks%2F99',
      })
    })

    expect(harness.controller.handleIncomingEntry).toHaveBeenCalledWith(
      'kanbanlite-mobile-dev://open?workspaceOrigin=https%3A%2F%2Ffield.example.com%2Fmobile%2F&target=%2Ftasks%2F99',
      'deep-link',
    )

    await act(async () => {
      renderer.unmount()
    })
    expect(harness.removeListener).toHaveBeenCalledTimes(1)
  })

  it('exits the auth group into the protected app shell once auth succeeds', async () => {
    harness.state = createAuthState({
      phase: 'authenticated',
      workspaceInput: 'https://field.example.com',
      resolvedWorkspaceOrigin: 'https://field.example.com',
      pendingTarget: '/tasks/42',
      sessionStatus: {
        workspaceOrigin: 'https://field.example.com',
        workspaceId: 'workspace_123',
        subject: 'worker',
        roles: ['user'],
        expiresAt: null,
        authentication: AUTHENTICATION,
      },
      isProtectedReady: true,
    })
    harness.segments = ['(auth)']

    await renderLayout()

    expect(harness.replace).toHaveBeenCalledWith('/(app)')
  })

  it('routes protected surfaces back to auth when the shared session is no longer ready', async () => {
    harness.state = createAuthState()
    harness.segments = ['tasks', '[id]']

    await renderLayout()

    expect(harness.replace).toHaveBeenCalledWith('/(auth)')
  })
})

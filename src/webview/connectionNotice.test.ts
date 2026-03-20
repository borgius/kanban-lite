import { describe, expect, it } from 'vitest'
import type { ConnectionStatusMessage } from '../shared/types'
import { buildConnectionNotice } from './connectionStatusNotice'

describe('buildConnectionNotice', () => {
  it('returns a transient reconnecting notice while retries remain', () => {
    const message: ConnectionStatusMessage = {
      type: 'connectionStatus',
      connected: false,
      reconnecting: true,
      fatal: false,
      retryCount: 2,
      maxRetries: 5,
      retryDelayMs: 1000,
      reason: 'socket-closed',
    }

    const notice = buildConnectionNotice(message)

    expect(notice).not.toBeNull()
    expect(notice?.title).toBe('Reconnecting…')
    expect(notice?.tone).toBe('info')
    expect(notice?.message).toContain('attempt 2 of 5')
    expect(notice?.message).toContain('1s')
    expect(notice?.message).toContain('Form submissions pause until the backend reconnects')
  })

  it('returns a persistent fatal notice when reconnect recovery is exhausted', () => {
    const message: ConnectionStatusMessage = {
      type: 'connectionStatus',
      connected: false,
      reconnecting: false,
      fatal: true,
      retryCount: 5,
      maxRetries: 5,
      reason: 'socket-closed',
    }

    const notice = buildConnectionNotice(message)

    expect(notice).not.toBeNull()
    expect(notice?.title).toBe('Connection lost')
    expect(notice?.tone).toBe('error')
    expect(notice?.message).toContain('Form submissions are unavailable until the backend is reachable again')
    expect(notice?.message).toContain('Refresh or reopen this page')
  })

  it('clears the notice when a fresh connection or init arrives', () => {
    expect(buildConnectionNotice({ type: 'init' })).toBeNull()
    expect(buildConnectionNotice({
      type: 'connectionStatus',
      connected: true,
      reconnecting: false,
      fatal: false,
      retryCount: 0,
      maxRetries: 5,
    })).toBeNull()
  })
})

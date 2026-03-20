import { afterEach, describe, expect, it, vi } from 'vitest'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly listeners = new Map<string, Array<(event?: unknown) => void>>()
  readonly sent: string[] = []
  readyState = MockWebSocket.CONNECTING

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event?: unknown) => void) {
    const current = this.listeners.get(type) ?? []
    current.push(listener)
    this.listeners.set(type, current)
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatch('close')
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.dispatch('open')
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatch('close')
  }

  private dispatch(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

function createStorageMock() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
}

function installStandaloneGlobals(postMessageSpy: ReturnType<typeof vi.fn>) {
  MockWebSocket.instances = []

  const bodyClassList = {
    contains: vi.fn(() => false),
    toggle: vi.fn(),
  }

  const documentMock = {
    body: {
      classList: bodyClassList,
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    addEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      style: {},
      click: vi.fn(),
      remove: vi.fn(),
    })),
  }

  const sessionStorageMock = createStorageMock()
  const localStorageMock = createStorageMock()

  const windowMock = {
    location: { host: 'localhost:4010' },
    postMessage: postMessageSpy,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
    matchMedia: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
    })),
    open: vi.fn(),
  }

  vi.stubGlobal('window', windowMock)
  vi.stubGlobal('document', documentMock)
  vi.stubGlobal('sessionStorage', sessionStorageMock)
  vi.stubGlobal('localStorage', localStorageMock)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'))
  vi.stubGlobal('WebSocket', MockWebSocket)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('standalone shim reconnect behavior', () => {
  it('retries after an unexpected close and replays the ready handshake on recovery', async () => {
    vi.useFakeTimers()
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({ type: 'ready' })

    const firstSocket = MockWebSocket.instances[0]
    expect(firstSocket.url).toBe('ws://localhost:4010/ws')

    firstSocket.open()
    expect(firstSocket.sent).toEqual([JSON.stringify({ type: 'ready' })])

    firstSocket.emitClose()

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'connectionStatus',
        connected: false,
        reconnecting: true,
        fatal: false,
        retryCount: 1,
        maxRetries: 5,
        retryDelayMs: 250,
        reason: 'socket-closed',
      }),
      '*',
    )

    vi.advanceTimersByTime(250)

    const secondSocket = MockWebSocket.instances[1]
    expect(secondSocket).toBeDefined()

    secondSocket.open()
    expect(secondSocket.sent).toEqual([JSON.stringify({ type: 'ready' })])
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'connectionStatus',
        connected: true,
        reconnecting: false,
        fatal: false,
        retryCount: 0,
        maxRetries: 5,
      }),
      '*',
    )
  })

  it('fails form submits immediately while disconnected instead of leaving them in-flight', async () => {
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)
    vi.stubGlobal('navigator', { onLine: false })

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({
      type: 'submitForm',
      cardId: '42',
      formId: 'bug-report',
      data: { severity: 'high' },
      callbackKey: 'submit-1',
    })

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'submitFormResult',
        callbackKey: 'submit-1',
        error: 'You are offline. Form submissions are unavailable until the standalone backend reconnects.',
      }),
      '*',
    )
    expect(MockWebSocket.instances[0]?.sent).toEqual([])
  })
})

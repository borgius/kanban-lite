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

  emitMessage(payload: unknown) {
    this.dispatch('message', { data: JSON.stringify(payload) })
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

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('standalone shim reconnect behavior', () => {
  it('falls back to the HTTP bridge when websocket bootstrap cannot connect', async () => {
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          messages: [
            {
              type: 'init',
              cards: [],
              columns: [{ id: 'todo', name: 'Todo', color: '#000000' }],
              settings: { defaultStatus: 'backlog' },
            },
          ],
        },
      }),
    })))

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({ type: 'ready' })

    const firstSocket = MockWebSocket.instances[0]
    firstSocket.emitClose()

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/webview-sync',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ type: 'ready' }],
    })
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'init',
        columns: [{ id: 'todo', name: 'Todo', color: '#000000' }],
      }),
      '*',
    )
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

  it('replays the active board and open card after reconnecting', async () => {
    vi.useFakeTimers()
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({ type: 'ready' })
    api.postMessage({ type: 'switchBoard', boardId: 'ops' })

    const firstSocket = MockWebSocket.instances[0]
    firstSocket.open()

    api.postMessage({ type: 'openCard', cardId: 'incident-42' })
    expect(firstSocket.sent).toEqual([
      JSON.stringify({ type: 'ready' }),
      JSON.stringify({ type: 'switchBoard', boardId: 'ops' }),
      JSON.stringify({ type: 'openCard', cardId: 'incident-42' }),
    ])

    firstSocket.emitClose()
    vi.advanceTimersByTime(250)

    const secondSocket = MockWebSocket.instances[1]
    secondSocket.open()

    expect(secondSocket.sent).toEqual([
      JSON.stringify({ type: 'ready' }),
      JSON.stringify({ type: 'switchBoard', boardId: 'ops' }),
      JSON.stringify({ type: 'openCard', cardId: 'incident-42' }),
    ])

    api.postMessage({ type: 'closeCard' })
    secondSocket.emitClose()
    vi.advanceTimersByTime(250)

    const thirdSocket = MockWebSocket.instances[2]
    thirdSocket.open()

    expect(thirdSocket.sent).toEqual([
      JSON.stringify({ type: 'ready' }),
      JSON.stringify({ type: 'switchBoard', boardId: 'ops' }),
    ])
  })

  it('switches to HTTP snapshot sync when Cloudflare notify transport is negotiated', async () => {
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          messages: [
            {
              type: 'init',
              cards: [],
              columns: [{ id: 'todo', name: 'Todo', color: '#000000' }],
              settings: { defaultStatus: 'backlog' },
            },
          ],
        },
      }),
    })))

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({ type: 'ready' })

    const socket = MockWebSocket.instances[0]
    socket.open()

    api.postMessage({ type: 'switchBoard', boardId: 'ops' })
    api.postMessage({ type: 'openCard', cardId: 'incident-42' })

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    socket.emitMessage({ type: 'syncTransportMode', mode: 'http-sync-websocket-notify' })
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [
        { type: 'switchBoard', boardId: 'ops' },
        { type: 'openCard', cardId: 'incident-42' },
        { type: 'ready' },
      ],
    })

    fetchMock.mockClear()
    api.postMessage({ type: 'switchBoard', boardId: 'ops-2' })
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [{ type: 'switchBoard', boardId: 'ops-2' }],
    })
    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'ready' }),
      JSON.stringify({ type: 'switchBoard', boardId: 'ops' }),
      JSON.stringify({ type: 'openCard', cardId: 'incident-42' }),
    ])
  })

  it('resyncs the current HTTP snapshot when Cloudflare sends an invalidation notice', async () => {
    vi.useFakeTimers()
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          messages: [
            {
              type: 'init',
              cards: [],
              columns: [{ id: 'todo', name: 'Todo', color: '#000000' }],
              settings: { defaultStatus: 'backlog' },
            },
          ],
        },
      }),
    })))

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({ type: 'ready' })

    const socket = MockWebSocket.instances[0]
    socket.open()

    api.postMessage({ type: 'switchBoard', boardId: 'ops' })
    api.postMessage({ type: 'openCard', cardId: 'incident-42' })
    socket.emitMessage({ type: 'syncTransportMode', mode: 'http-sync-websocket-notify' })
    await flushAsyncWork()

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    socket.emitMessage({ type: 'syncRequired', reason: 'task.updated' })
    // syncRequired is debounced — advance past the debounce window
    await vi.advanceTimersByTimeAsync(200)
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messages: [
        { type: 'switchBoard', boardId: 'ops' },
        { type: 'openCard', cardId: 'incident-42' },
        { type: 'ready' },
      ],
    })
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

  it('uploads voice comment attachments through the hidden standalone endpoint', async () => {
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })))

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({
      type: 'uploadVoiceCommentAttachment',
      cardId: '42',
      filename: 'nested/path/voice-note.webm',
      dataBase64: 'dm9pY2U=',
      callbackKey: 'voice-upload-1',
    })

    await flushAsyncWork()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload-attachment',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      cardId: '42',
      files: [{ name: 'voice-note.webm', data: 'dm9pY2U=' }],
    })
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'voiceCommentAttachmentResult',
        callbackKey: 'voice-upload-1',
        filename: 'voice-note.webm',
      }),
      '*',
    )
    expect(MockWebSocket.instances[0]?.sent).toEqual([])
  })

  it('resolves standalone voice playback to the attachment route URL', async () => {
    const postMessageSpy = vi.fn()
    installStandaloneGlobals(postMessageSpy)

    await import('./standalone-shim')

    const api = (window as typeof window & {
      acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
    }).acquireVsCodeApi()

    api.postMessage({
      type: 'resolveVoiceCommentPlayback',
      cardId: '42',
      attachment: 'voice note.webm',
      callbackKey: 'voice-play-1',
    })

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'voiceCommentPlaybackResult',
        callbackKey: 'voice-play-1',
        url: '/api/attachment?cardId=42&filename=voice%20note.webm',
      }),
      '*',
    )
    expect(MockWebSocket.instances[0]?.sent).toEqual([])
  })
})

// WebSocket bridge that provides acquireVsCodeApi() for standalone mode.
// Must be imported BEFORE App.tsx so the global is available at module load time.
// When loaded inside VS Code the native acquireVsCodeApi is already injected —
// skip this entire shim so we never overwrite the real API.
import type { ConnectionStatusMessage, ExtensionMessage, SyncTransportMode, WebviewMessage } from '../shared/types'

if (!('acquireVsCodeApi' in window)) {

const kbBase = (window as unknown as { __KB_BASE__?: string }).__KB_BASE__ ?? ''
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${kbBase}/ws`
const HTTP_SYNC_URL = `${kbBase}/api/webview-sync`
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000] as const
const MAX_RETRIES = RECONNECT_DELAYS_MS.length

let ws: WebSocket | null = null
const pendingMessages: string[] = []
let connected = false
let hasConnectedOnce = false
let readyRequested = false
let latestSwitchBoardMessage: string | null = null
let latestOpenCardMessage: string | null = null
let reconnectAttemptCount = 0
let reconnectTimer: number | null = null
let allowReconnect = true
let httpFallbackActive = false
let httpFallbackActivation: Promise<boolean> | null = null
let syncTransportMode: SyncTransportMode = 'websocket'

function getDisconnectedSubmitErrorMessage(): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You are offline. Form submissions are unavailable until the standalone backend reconnects.'
  }

  return 'Cannot submit while disconnected from the standalone backend. Wait for reconnection and try again.'
}

function emitConnectionStatus(status: Omit<ConnectionStatusMessage, 'type'>) {
  const message: ExtensionMessage = { type: 'connectionStatus', ...status }
  window.postMessage(message, '*')
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function isSocketOpen(): boolean {
  return connected && ws !== null && ws.readyState === WebSocket.OPEN
}

function shouldUseHttpSyncTransport(): boolean {
  return httpFallbackActive || syncTransportMode === 'http-sync-websocket-notify'
}

function parseCachedMessage(json: string | null): Record<string, unknown> | null {
  if (!json) {
    return null
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    return parsed && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}

function buildHttpSyncMessages(message: unknown): unknown[] {
  const msg = message as { type?: unknown } | null
  const replayedSwitchBoardMessage = parseCachedMessage(latestSwitchBoardMessage)
  const replayedOpenCardMessage = parseCachedMessage(latestOpenCardMessage)
  const messages: unknown[] = []

  if (replayedSwitchBoardMessage && msg?.type !== 'switchBoard') {
    messages.push(replayedSwitchBoardMessage)
  }

  if (
    replayedOpenCardMessage
    && msg?.type !== 'openCard'
    && msg?.type !== 'switchBoard'
    && msg?.type !== 'createBoard'
  ) {
    messages.push(replayedOpenCardMessage)
  }

  messages.push(message)
  return messages
}

async function syncMessagesOverHttp(messages: unknown[]): Promise<void> {
  const response = await fetch(HTTP_SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })

  const payload = await response.json() as {
    ok?: boolean
    error?: string
    data?: { messages?: unknown[] }
  }

  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error ?? `HTTP sync failed with status ${response.status}`)
  }

  for (const message of payload.data?.messages ?? []) {
    window.postMessage(message, '*')
  }
}

async function syncCurrentStateOverHttp(): Promise<void> {
  if (!readyRequested) {
    return
  }

  await syncMessagesOverHttp(buildHttpSyncMessages({ type: 'ready' }))
}

async function activateHttpFallback(): Promise<boolean> {
  if (httpFallbackActive) {
    return true
  }

  if (httpFallbackActivation) {
    return httpFallbackActivation
  }

  httpFallbackActivation = (async () => {
    try {
      await syncMessagesOverHttp(buildHttpSyncMessages({ type: 'ready' }))
      httpFallbackActive = true
      connected = true
      clearReconnectTimer()
      reconnectAttemptCount = 0
      emitConnectionStatus({
        connected: true,
        reconnecting: false,
        fatal: false,
        retryCount: 0,
        maxRetries: MAX_RETRIES,
      })
      return true
    } catch {
      return false
    } finally {
      httpFallbackActivation = null
    }
  })()

  return httpFallbackActivation
}

function sendPendingBootstrapState(socket: WebSocket) {
  if (readyRequested) {
    socket.send(JSON.stringify({ type: 'ready' } satisfies Extract<WebviewMessage, { type: 'ready' }>))
  }

  if (latestSwitchBoardMessage) {
    socket.send(latestSwitchBoardMessage)
  }

  if (latestOpenCardMessage) {
    socket.send(latestOpenCardMessage)
  }
}

function flushInitialPendingMessages(socket: WebSocket) {
  for (const msg of pendingMessages) {
    socket.send(msg)
  }
  pendingMessages.length = 0
}

function scheduleReconnect(reason: string) {
  connected = false

  if (!allowReconnect || httpFallbackActive || httpFallbackActivation) {
    return
  }

  if (reconnectTimer !== null) {
    return
  }

  if (reconnectAttemptCount >= MAX_RETRIES) {
    emitConnectionStatus({
      connected: false,
      reconnecting: false,
      fatal: true,
      retryCount: reconnectAttemptCount,
      maxRetries: MAX_RETRIES,
      reason
    })
    return
  }

  const retryDelayMs = RECONNECT_DELAYS_MS[reconnectAttemptCount]
  reconnectAttemptCount += 1
  emitConnectionStatus({
    connected: false,
    reconnecting: true,
    fatal: false,
    retryCount: reconnectAttemptCount,
    maxRetries: MAX_RETRIES,
    retryDelayMs,
    reason
  })

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connect()
  }, retryDelayMs)
}

function connect() {
  if (httpFallbackActive) {
    return
  }

  const socket = new WebSocket(WS_URL)
  ws = socket

  socket.addEventListener('open', () => {
    if (ws !== socket) {
      return
    }

    connected = true
    const shouldFlushInitialQueue = !hasConnectedOnce
    hasConnectedOnce = true
    clearReconnectTimer()
    reconnectAttemptCount = 0

    sendPendingBootstrapState(socket)
    if (shouldFlushInitialQueue) {
      flushInitialPendingMessages(socket)
    }

    emitConnectionStatus({
      connected: true,
      reconnecting: false,
      fatal: false,
      retryCount: 0,
      maxRetries: MAX_RETRIES
    })

    if (syncTransportMode === 'http-sync-websocket-notify' && readyRequested) {
      void syncCurrentStateOverHttp().catch((err) => {
        console.error('Standalone HTTP resync failed:', err)
      })
    }
  })

  socket.addEventListener('message', (event) => {
    if (ws !== socket) {
      return
    }

    try {
      const data = JSON.parse(event.data) as ExtensionMessage
      if (data.type === 'syncTransportMode') {
        syncTransportMode = data.mode
        if (data.mode === 'http-sync-websocket-notify' && readyRequested) {
          void syncCurrentStateOverHttp().catch((err) => {
            console.error('Standalone HTTP resync failed:', err)
          })
        }
        return
      }
      if (data.type === 'syncRequired' && syncTransportMode === 'http-sync-websocket-notify') {
        void syncCurrentStateOverHttp().catch((err) => {
          console.error('Standalone HTTP resync failed:', err)
        })
        return
      }
      window.postMessage(data, '*')
    } catch {
      // ignore malformed messages
    }
  })

  socket.addEventListener('error', () => {
    if (ws !== socket) {
      return
    }

    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close()
    }
  })

  socket.addEventListener('close', () => {
    if (ws !== socket) {
      return
    }

    ws = null
    if (!hasConnectedOnce && readyRequested) {
      void activateHttpFallback().then((activated) => {
        if (!activated && ws === null) {
          scheduleReconnect('socket-closed')
        }
      })
      return
    }

    scheduleReconnect('socket-closed')
  })
}

window.addEventListener('beforeunload', () => {
  allowReconnect = false
  clearReconnectTimer()
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    ws.close()
  }
})

connect()

// State persistence via sessionStorage
let savedState: unknown = null
try {
  const stored = sessionStorage.getItem('kanban-standalone-state')
  if (stored) savedState = JSON.parse(stored)
} catch {
  // ignore
}

// --- Standalone attachment handling ---
function handleAddAttachment(cardId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.style.display = 'none'
  document.body.appendChild(input)

  const cleanup = () => {
    input.remove()
  }

  input.onchange = async () => {
    if (!input.files || input.files.length === 0) {
      cleanup()
      return
    }
    const files: { name: string; data: string }[] = []
    for (const file of Array.from(input.files)) {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      // Encode in chunks to avoid stack overflow on large files
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      files.push({ name: file.name, data: btoa(binary) })
    }
    try {
      await fetch('/api/upload-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, files })
      })
    } catch (err) {
      console.error('Failed to upload attachment:', err)
    }
    cleanup()
  }

  input.click()
}

function handleOpenAttachment(cardId: string, attachment: string) {
  const url = `/api/attachment?cardId=${encodeURIComponent(cardId)}&filename=${encodeURIComponent(attachment)}`
  window.open(url, '_blank')
}

// Provide the same API shape as acquireVsCodeApi()
;(window as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage(message: unknown) {
    const msg = message as WebviewMessage & Record<string, unknown>
    // Intercept attachment messages — handle browser-side in standalone
    if (msg.type === 'openFile') {
      const cardId = msg.cardId as string
      fetch(`/api/card-file?cardId=${encodeURIComponent(cardId)}`)
        .then(r => r.json())
        .then((result: { ok: boolean; data?: { path: string } }) => {
          const filePath = result?.data?.path
          if (!filePath) { console.error('card-file: missing path in response', result); return }
          const a = document.createElement('a')
          a.href = `vscode://file/${filePath}`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        })
        .catch(err => console.error('Failed to open card in VS Code:', err))
      return
    }
    if (msg.type === 'openMetadataFile') {
      const rawPath = msg.path as string
      fetch(`/api/resolve-path?path=${encodeURIComponent(rawPath)}`)
        .then(r => r.json())
        .then((result: { ok: boolean; data?: { path: string } }) => {
          const filePath = result?.data?.path
          if (!filePath) { console.error('resolve-path: missing path in response', result); return }
          const a = document.createElement('a')
          a.href = `vscode://file/${filePath}`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        })
        .catch(err => console.error('Failed to open metadata file in VS Code:', err))
      return
    }
    if (msg.type === 'addAttachment') {
      handleAddAttachment(msg.cardId as string)
      return
    }
    if (msg.type === 'openAttachment') {
      handleOpenAttachment(msg.cardId as string, msg.attachment as string)
      return
    }
    if (msg.type === 'toggleTheme') {
      const isDark = document.body.classList.contains('vscode-dark')
      const newDark = !isDark
      localStorage.setItem('kanban-standalone-theme', newDark ? 'dark' : 'light')
      applyTheme(newDark)
      return
    }

    const json = JSON.stringify(message)
    const syncMessages = buildHttpSyncMessages(message)

    if (msg.type === 'ready') {
      readyRequested = true
      if (shouldUseHttpSyncTransport()) {
        void syncCurrentStateOverHttp().catch((err) => {
          console.error('Standalone HTTP fallback failed:', err)
        })
        return
      }
      if (isSocketOpen()) {
        ws.send(json)
      }
      return
    }

    if (msg.type === 'switchBoard') {
      latestSwitchBoardMessage = json
    }

    if (msg.type === 'openCard') {
      latestOpenCardMessage = json
    }

    if (msg.type === 'closeCard') {
      latestOpenCardMessage = null
    }

    if (msg.type === 'switchBoard' || msg.type === 'openCard' || msg.type === 'closeCard') {
      if (shouldUseHttpSyncTransport()) {
        void syncMessagesOverHttp(syncMessages).catch((err) => {
          console.error('Standalone HTTP fallback failed:', err)
        })
        return
      }
      if (isSocketOpen()) {
        ws.send(json)
      }
      return
    }

    if (msg.type === 'submitForm' && !shouldUseHttpSyncTransport() && !isSocketOpen()) {
      window.postMessage({
        type: 'submitFormResult',
        callbackKey: msg.callbackKey,
        error: getDisconnectedSubmitErrorMessage(),
      } satisfies ExtensionMessage, '*')
      return
    }

    if (shouldUseHttpSyncTransport()) {
      void syncMessagesOverHttp(syncMessages).catch((err) => {
        console.error('Standalone HTTP fallback failed:', err)
      })
    } else if (isSocketOpen()) {
      ws.send(json)
    } else if (!hasConnectedOnce) {
      pendingMessages.push(json)
    } else {
      console.warn('Dropping standalone message while disconnected', msg.type)
    }
  },
  getState() {
    return savedState
  },
  setState(state: unknown) {
    savedState = state
    try {
      sessionStorage.setItem('kanban-standalone-state', JSON.stringify(state))
    } catch {
      // ignore
    }
  }
})

// Set dark mode class — persists user override in localStorage, falls back to system preference
const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme(dark: boolean) {
  document.body.classList.toggle('vscode-dark', dark)
  document.body.classList.toggle('vscode-light', !dark)
}
darkMq.addEventListener('change', (e) => {
  // Only follow system preference when user hasn't set an explicit override
  if (localStorage.getItem('kanban-standalone-theme') === null) {
    applyTheme(e.matches)
  }
})
function applyInitialTheme() {
  const saved = localStorage.getItem('kanban-standalone-theme')
  applyTheme(saved !== null ? saved === 'dark' : darkMq.matches)
}
// Apply immediately (body may not exist yet, so also apply on DOMContentLoaded)
if (document.body) {
  applyInitialTheme()
} else {
  document.addEventListener('DOMContentLoaded', applyInitialTheme)
}

} // end: !acquireVsCodeApi guard

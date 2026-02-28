// WebSocket bridge that provides acquireVsCodeApi() for standalone mode.
// Must be imported BEFORE App.tsx so the global is available at module load time.

const ws = new WebSocket(`ws://${window.location.host}/ws`)
const pendingMessages: string[] = []
let connected = false

ws.addEventListener('open', () => {
  connected = true
  for (const msg of pendingMessages) {
    ws.send(msg)
  }
  pendingMessages.length = 0
})

ws.addEventListener('message', (event) => {
  try {
    const data = JSON.parse(event.data)
    window.postMessage(data, '*')
  } catch {
    // ignore malformed messages
  }
})

ws.addEventListener('close', () => {
  connected = false
})

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
    const msg = message as Record<string, unknown>
    // Intercept attachment messages — handle browser-side in standalone
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
      applyTheme(!isDark)
      return
    }

    const json = JSON.stringify(message)
    if (connected) {
      ws.send(json)
    } else {
      pendingMessages.push(json)
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

// Set dark mode class based on system preference (replaces VSCode's vscode-dark class)
const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme(dark: boolean) {
  document.body.classList.toggle('vscode-dark', dark)
  document.body.classList.toggle('vscode-light', !dark)
}
darkMq.addEventListener('change', (e) => applyTheme(e.matches))
// Apply immediately (body may not exist yet, so also apply on DOMContentLoaded)
if (document.body) {
  applyTheme(darkMq.matches)
} else {
  document.addEventListener('DOMContentLoaded', () => applyTheme(darkMq.matches))
}

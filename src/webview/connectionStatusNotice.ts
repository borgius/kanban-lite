import type { ConnectionStatusMessage } from '../shared/types'

export interface ConnectionNotice {
  title: string
  message: string
  tone: 'info' | 'error'
}

function formatRetryDelay(retryDelayMs?: number): string {
  if (!retryDelayMs || retryDelayMs <= 0) {
    return ''
  }

  if (retryDelayMs < 1000) {
    return ` Next retry in ${retryDelayMs}ms.`
  }

  const seconds = retryDelayMs / 1000
  const displaySeconds = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
  return ` Next retry in ${displaySeconds}s.`
}

function formatReason(reason?: string): string {
  if (!reason) {
    return ''
  }

  if (reason === 'socket-closed') {
    return ' The previous socket closed unexpectedly.'
  }

  return ` Last signal: ${reason}.`
}

export function buildConnectionNotice(message: ConnectionStatusMessage | { type: 'init' }): ConnectionNotice | null {
  if (message.type === 'init') {
    return null
  }

  if (message.connected || (!message.reconnecting && !message.fatal)) {
    return null
  }

  if (message.fatal) {
    return {
      title: 'Connection lost',
      message: `The standalone backend is unavailable and automatic reconnect has stopped.${formatReason(message.reason)} Refresh or reopen this page after the backend is available again.`,
      tone: 'error',
    }
  }

  const attempt = message.retryCount ?? 1
  const maxRetries = message.maxRetries ?? attempt

  return {
    title: 'Reconnecting…',
    message: `Trying to reconnect to the standalone backend (attempt ${attempt} of ${maxRetries}).${formatRetryDelay(message.retryDelayMs)}${formatReason(message.reason)}`,
    tone: 'info',
  }
}

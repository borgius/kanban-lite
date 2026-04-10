import type { ExtensionMessage } from '../../shared/types'
import { getVsCodeApi } from '../vsCodeApi'

const VOICE_COMMENT_CALLBACK_TIMEOUT_MS = 30_000

function createCallbackKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function waitForCallbackMessage<T extends ExtensionMessage & { callbackKey: string }>(
  type: T['type'],
  callbackKey: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage)
      reject(new Error(`Timed out waiting for ${String(type)}`))
    }, VOICE_COMMENT_CALLBACK_TIMEOUT_MS)

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionMessage
      if (!message || message.type !== type || message.callbackKey !== callbackKey) {
        return
      }

      window.clearTimeout(timeoutId)
      window.removeEventListener('message', handleMessage)
      resolve(message as T)
    }

    window.addEventListener('message', handleMessage)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read the recorded audio blob'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to encode the recorded audio blob'))
        return
      }

      const [, dataBase64 = ''] = reader.result.split(',', 2)
      resolve(dataBase64)
    }
    reader.readAsDataURL(blob)
  })
}

function decodeBase64(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function uploadVoiceCommentAttachment(
  {
    cardId,
    filename,
    blob,
    contentType,
    boardId,
  }: {
    cardId: string
    filename: string
    blob: Blob
    contentType?: string
    boardId?: string
  },
): Promise<{ filename: string }> {
  const vscode = getVsCodeApi()
  const dataBase64 = await blobToBase64(blob)
  const callbackKey = createCallbackKey('voice-upload')
  const resultPromise = waitForCallbackMessage<Extract<ExtensionMessage, { type: 'voiceCommentAttachmentResult'; callbackKey: string }>>(
    'voiceCommentAttachmentResult',
    callbackKey,
  )

  vscode.postMessage({
    type: 'uploadVoiceCommentAttachment',
    cardId,
    filename,
    dataBase64,
    ...(contentType ? { contentType } : {}),
    ...(boardId ? { boardId } : {}),
    callbackKey,
  })

  const result = await resultPromise
  if (result.error) {
    throw new Error(result.error)
  }
  if (!result.filename) {
    throw new Error('Voice comment upload completed without a filename')
  }

  return { filename: result.filename }
}

export interface VoiceCommentPlaybackSource {
  src: string
  contentType?: string
  revoke?: () => void
}

export async function resolveVoiceCommentPlaybackSource(
  {
    cardId,
    attachment,
    fallbackContentType,
    boardId,
  }: {
    cardId: string
    attachment: string
    fallbackContentType?: string
    boardId?: string
  },
): Promise<VoiceCommentPlaybackSource> {
  const vscode = getVsCodeApi()
  const callbackKey = createCallbackKey('voice-playback')
  const resultPromise = waitForCallbackMessage<Extract<ExtensionMessage, { type: 'voiceCommentPlaybackResult'; callbackKey: string }>>(
    'voiceCommentPlaybackResult',
    callbackKey,
  )

  vscode.postMessage({
    type: 'resolveVoiceCommentPlayback',
    cardId,
    attachment,
    ...(boardId ? { boardId } : {}),
    callbackKey,
  })

  const result = await resultPromise
  if (result.error) {
    throw new Error(result.error)
  }
  if (result.url) {
    return {
      src: result.url,
      ...(result.contentType ? { contentType: result.contentType } : {}),
    }
  }
  if (!result.dataBase64) {
    throw new Error('Voice playback resolution completed without audio data')
  }

  const contentType = result.contentType ?? fallbackContentType ?? 'audio/webm'
  const blob = new Blob([decodeBase64(result.dataBase64)], { type: contentType })
  const src = URL.createObjectURL(blob)

  return {
    src,
    contentType,
    revoke: () => URL.revokeObjectURL(src),
  }
}

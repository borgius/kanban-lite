import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { formatVoiceCommentDuration } from './voice-comments'

interface PlayerColors {
  background: string
  border: string
  card: string
  primary: string
  text: string
}

export interface VoiceCommentPlaybackAuth {
  token: string
  workspaceOrigin: string
}

interface VoiceCommentPlayerProps {
  colors: PlayerColors
  durationMs?: number
  fileName?: string
  localUri?: string | null
  playbackAuth?: VoiceCommentPlaybackAuth | null
  taskId?: string | null
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return 'voice-comment'
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function buildAttachmentUrl(workspaceOrigin: string, taskId: string, fileName: string): string {
  const url = new URL(
    `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(fileName)}`,
    workspaceOrigin,
  )
  return url.toString()
}

async function deleteLocalPlaybackFile(uri: string): Promise<void> {
  try {
    const fileSystem = await import('expo-file-system/legacy')
    await fileSystem.deleteAsync(uri, { idempotent: true })
  } catch {
    // Best-effort cleanup only.
  }
}

async function resolveRemotePlaybackUri(input: {
  fileName: string
  playbackAuth: VoiceCommentPlaybackAuth
  taskId: string
}): Promise<{ cleanup?: () => void; uri: string }> {
  const attachmentUrl = buildAttachmentUrl(
    input.playbackAuth.workspaceOrigin,
    input.taskId,
    input.fileName,
  )

  const fileSystem = await import('expo-file-system/legacy')
  const baseDirectory = fileSystem.cacheDirectory ?? fileSystem.documentDirectory

  if (baseDirectory) {
    const directoryUri = `${baseDirectory}kanban-lite/voice-playback/`
    await fileSystem.makeDirectoryAsync(directoryUri, { intermediates: true })
    const fileUri = `${directoryUri}${Date.now()}-${sanitizePathSegment(input.fileName)}`
    const result = await fileSystem.downloadAsync(attachmentUrl, fileUri, {
      headers: {
        Authorization: `Bearer ${input.playbackAuth.token}`,
      },
    })

    if (result.status < 200 || result.status >= 300) {
      await deleteLocalPlaybackFile(fileUri)
      throw new Error(
        result.status === 401 || result.status === 403
          ? 'Session expired. Sign in again to play this voice comment.'
          : 'Unable to load this voice comment right now.',
      )
    }

    return { uri: result.uri }
  }

  const response = await fetch(attachmentUrl, {
    headers: {
      Authorization: `Bearer ${input.playbackAuth.token}`,
    },
  })
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Session expired. Sign in again to play this voice comment.'
        : 'Unable to load this voice comment right now.',
    )
  }

  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('Audio playback storage is unavailable on this device.')
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  return {
    cleanup: () => {
      URL.revokeObjectURL(objectUrl)
    },
    uri: objectUrl,
  }
}

export function VoiceCommentPlayer({
  colors,
  durationMs,
  fileName,
  localUri,
  playbackAuth,
  taskId,
}: VoiceCommentPlayerProps) {
  const player = useAudioPlayer(null, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [remoteUri, setRemoteUri] = useState<string | null>(null)
  const downloadedFileUriRef = useRef<string | null>(null)
  const objectUrlCleanupRef = useRef<(() => void) | null>(null)
  const loadedUriRef = useRef<string | null>(null)
  const sourceKey = `${localUri ?? ''}|${taskId ?? ''}|${fileName ?? ''}|${playbackAuth?.workspaceOrigin ?? ''}`

  const currentTimeLabel = useMemo(
    () => formatVoiceCommentDuration(Math.max(0, Math.round(status.currentTime * 1000))) ?? '0:00',
    [status.currentTime],
  )
  const durationLabel = useMemo(() => {
    const liveDurationMs = status.duration > 0 ? status.duration * 1000 : undefined
    return formatVoiceCommentDuration(durationMs ?? liveDurationMs)
  }, [durationMs, status.duration])
  const summaryLabel = useMemo(() => {
    if (!durationLabel) {
      return 'Voice comment'
    }

    if (status.playing || status.currentTime > 0) {
      return `${currentTimeLabel} / ${durationLabel}`
    }

    return durationLabel
  }, [currentTimeLabel, durationLabel, status.currentTime, status.playing])

  const cleanupRemoteUri = useCallback(async () => {
    const downloadedUri = downloadedFileUriRef.current
    downloadedFileUriRef.current = null
    if (downloadedUri) {
      await deleteLocalPlaybackFile(downloadedUri)
    }

    const cleanupObjectUrl = objectUrlCleanupRef.current
    objectUrlCleanupRef.current = null
    cleanupObjectUrl?.()
  }, [])

  useEffect(() => {
    setErrorMessage(null)
    setIsResolving(false)
    setRemoteUri(null)
    loadedUriRef.current = null
    player.pause()
    void cleanupRemoteUri()
  }, [cleanupRemoteUri, player, sourceKey])

  useEffect(() => {
    return () => {
      player.pause()
      void cleanupRemoteUri()
    }
  }, [cleanupRemoteUri, player])

  const ensurePlaybackUri = useCallback(async (): Promise<string> => {
    if (localUri) {
      return localUri
    }

    if (remoteUri) {
      return remoteUri
    }

    if (!fileName || !playbackAuth || !taskId) {
      throw new Error('A live session is required to play this voice comment.')
    }

    setIsResolving(true)
    try {
      const resolved = await resolveRemotePlaybackUri({
        fileName,
        playbackAuth,
        taskId,
      })
      downloadedFileUriRef.current = resolved.cleanup ? null : resolved.uri
      objectUrlCleanupRef.current = resolved.cleanup ?? null
      setRemoteUri(resolved.uri)
      return resolved.uri
    } finally {
      setIsResolving(false)
    }
  }, [fileName, localUri, playbackAuth, remoteUri, taskId])

  const handleTogglePlayback = useCallback(async () => {
    if (status.playing) {
      player.pause()
      return
    }

    setErrorMessage(null)

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'duckOthers',
        playsInSilentMode: true,
      })
    } catch {
      // The player can still attempt playback even if audio mode configuration fails.
    }

    try {
      const playbackUri = await ensurePlaybackUri()
      if (loadedUriRef.current !== playbackUri) {
        player.replace(playbackUri)
        loadedUriRef.current = playbackUri
      } else if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
        await player.seekTo(0)
      }

      player.play()
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to play this voice comment right now.',
      )
    }
  }, [ensurePlaybackUri, player, status.currentTime, status.didJustFinish, status.duration, status.playing])

  return (
    <View style={[styles.container, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={isResolving || (!localUri && (!fileName || !taskId || !playbackAuth))}
          onPress={() => {
            void handleTogglePlayback()
          }}
          style={[
            styles.playButton,
            {
              backgroundColor: `${colors.primary}18`,
              borderColor: colors.primary,
              opacity: isResolving ? 0.7 : 1,
            },
          ]}
        >
          {isResolving ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          <Text style={[styles.playButtonText, { color: colors.text }]}>
            {status.playing ? 'Pause' : 'Play'}
          </Text>
        </Pressable>
        <View style={styles.metaBlock}>
          <Text style={[styles.titleText, { color: colors.text }]}>Voice comment</Text>
          <Text style={[styles.metaText, { color: colors.text }]}>{summaryLabel}</Text>
        </View>
      </View>
      {errorMessage ? <Text style={[styles.errorText, { color: colors.text }]}>{errorMessage}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  metaBlock: {
    flex: 1,
    gap: 2,
  },
  metaText: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.85,
  },
  playButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 108,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  playButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '700',
  },
})

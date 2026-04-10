import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import {
  createVoiceCommentFilename,
  formatVoiceCommentDuration,
} from './voice-comments'

interface RecorderColors {
  background: string
  border: string
  card: string
  primary: string
  text: string
}

export interface RecordedVoiceCommentClip {
  durationMs?: number
  fileName: string
  mimeType: string
  uri: string
}

const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
}

function normalizeMetering(metering?: number): number {
  if (!Number.isFinite(metering)) {
    return 0.06
  }

  return Math.max(0.06, Math.min(1, ((metering ?? -60) + 60) / 60))
}

function resolveRecordingMimeType(): string {
  return Platform.OS === 'web'
    ? VOICE_RECORDING_OPTIONS.web?.mimeType?.trim() || 'audio/webm'
    : 'audio/mp4'
}

function resolveRecorderMessage(input: {
  canAttach: boolean
  durationMs: number
  errorMessage: string | null
  isPaused: boolean
  isRecording: boolean
}): string {
  if (input.errorMessage) {
    return input.errorMessage
  }

  if (input.isRecording) {
    return `Recording ${formatVoiceCommentDuration(input.durationMs) ?? '0:00'}`
  }

  if (input.isPaused) {
    return `Paused at ${formatVoiceCommentDuration(input.durationMs) ?? '0:00'}`
  }

  if (input.canAttach) {
    return `Ready to attach ${formatVoiceCommentDuration(input.durationMs) ?? '0:00'}`
  }

  return 'Voice clip stays on this device until you attach the comment.'
}

function SheetActionButton({
  colors,
  disabled = false,
  label,
  onPress,
  testID,
  tone = 'secondary',
}: {
  colors: RecorderColors
  disabled?: boolean
  label: string
  onPress: () => void
  testID?: string
  tone?: 'primary' | 'secondary'
}) {
  const isPrimary = tone === 'primary'

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        {
          backgroundColor: isPrimary ? `${colors.primary}18` : colors.card,
          borderColor: isPrimary ? colors.primary : colors.border,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.actionButtonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

export function VoiceCommentRecorderSheet({
  colors,
  onAttach,
  onClose,
}: {
  colors: RecorderColors
  onAttach: (clip: RecordedVoiceCommentClip) => void
  onClose: () => void
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS)
  const recorderState = useAudioRecorderState(recorder, 120)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isAttaching, setIsAttaching] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const preparedRef = useRef(false)
  const canAttach = recorderState.durationMillis > 0 || isPaused || Boolean(recorder.uri)
  const meterLevel = useMemo(() => normalizeMetering(recorderState.metering), [recorderState.metering])
  const statusMessage = useMemo(() => resolveRecorderMessage({
    canAttach,
    durationMs: recorderState.durationMillis,
    errorMessage,
    isPaused,
    isRecording: recorderState.isRecording,
  }), [canAttach, errorMessage, isPaused, recorderState.durationMillis, recorderState.isRecording])

  useEffect(() => {
    return () => {
      void (async () => {
        try {
          if (recorderState.isRecording || isPaused) {
            await recorder.stop()
          }
        } catch {
          // Ignore recorder shutdown errors during dismiss/unmount.
        }

        try {
          await setAudioModeAsync({
            allowsRecording: false,
            interruptionMode: 'mixWithOthers',
            playsInSilentMode: true,
          })
        } catch {
          // Ignore audio mode shutdown errors during dismiss/unmount.
        }
      })()
    }
  }, [isPaused, recorder, recorderState.isRecording])

  const ensureRecordingReady = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      throw new Error(
        permission.canAskAgain
          ? 'Microphone access is needed to record a voice comment.'
          : 'Microphone access is off for this app. Enable it in system settings and try again.',
      )
    }

    await setAudioModeAsync({
      allowsRecording: true,
      interruptionMode: 'duckOthers',
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    })

    if (!preparedRef.current) {
      await recorder.prepareToRecordAsync()
      preparedRef.current = true
    }
  }, [recorder])

  const handleToggleRecording = useCallback(async () => {
    setErrorMessage(null)

    if (recorderState.isRecording) {
      recorder.pause()
      setIsPaused(true)
      return
    }

    setIsPreparing(true)
    try {
      await ensureRecordingReady()
      recorder.record()
      setIsPaused(false)
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to start recording right now.',
      )
    } finally {
      setIsPreparing(false)
    }
  }, [ensureRecordingReady, recorder, recorderState.isRecording])

  const handleAttach = useCallback(async () => {
    if (!canAttach) {
      return
    }

    setIsAttaching(true)
    setErrorMessage(null)

    try {
      if (recorderState.isRecording || isPaused) {
        await recorder.stop()
        setIsPaused(false)
      }

      const durationMs = recorderState.durationMillis
      if (durationMs < 250) {
        throw new Error('Record a little more audio before attaching it to the comment.')
      }

      const uri = recorder.uri
      if (!uri) {
        throw new Error('The recording is still finishing. Try attaching it again in a moment.')
      }

      try {
        await setAudioModeAsync({
          allowsRecording: false,
          interruptionMode: 'mixWithOthers',
          playsInSilentMode: true,
        })
      } catch {
        // Recording already finished; continue with the captured clip.
      }

      const mimeType = resolveRecordingMimeType()
      onAttach({
        durationMs,
        fileName: createVoiceCommentFilename({ mimeType }),
        mimeType,
        uri,
      })
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to attach this recording right now.',
      )
    } finally {
      setIsAttaching(false)
    }
  }, [canAttach, isPaused, onAttach, recorder, recorderState.durationMillis, recorderState.isRecording])

  return (
    <View style={styles.backdrop}>
      <Pressable onPress={onClose} style={StyleSheet.absoluteFill} testID="task-comment-voice-close" />
      <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} testID="task-comment-voice-sheet">
        <Text style={[styles.eyebrow, { color: colors.primary }]}>Voice comment</Text>
        <Text style={[styles.title, { color: colors.text }]}>Record task update</Text>
        <Text style={[styles.bodyText, { color: colors.text }]}>Capture a quick field note, then attach it to the current comment.</Text>

        <View style={[styles.meterCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.meterTrack, { backgroundColor: `${colors.primary}12`, borderColor: colors.border }]}>
            <View style={[styles.meterFill, { backgroundColor: colors.primary, width: `${meterLevel * 100}%` }]} />
          </View>
          <Text style={[styles.meterLabel, { color: colors.text }]}>{statusMessage}</Text>
        </View>

        <View style={styles.actionRow}>
          <SheetActionButton
            colors={colors}
            disabled={isPreparing || isAttaching}
            label={recorderState.isRecording ? 'Pause' : isPaused ? 'Resume' : 'Start recording'}
            onPress={() => {
              void handleToggleRecording()
            }}
            testID="task-comment-voice-toggle"
            tone="primary"
          />
          <SheetActionButton
            colors={colors}
            disabled={!canAttach || isPreparing || isAttaching}
            label="Attach voice"
            onPress={() => {
              void handleAttach()
            }}
            testID="task-comment-voice-attach"
          />
          <SheetActionButton
            colors={colors}
            disabled={isPreparing || isAttaching}
            label="Close"
            onPress={onClose}
            testID="task-comment-voice-close-button"
          />
        </View>

        {isPreparing || isAttaching ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={[styles.busyText, { color: colors.text }]}>Preparing the recorder…</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 132,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  backdrop: {
    backgroundColor: 'rgba(3, 8, 20, 0.68)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  busyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  busyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  meterCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  meterFill: {
    borderRadius: 999,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  meterLabel: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  meterTrack: {
    borderRadius: 999,
    borderWidth: 1,
    height: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 16,
    paddingBottom: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
})

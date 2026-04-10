import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Mic, Paperclip, Pause, Play, X } from 'lucide-react'
import { createVoiceCommentFilename, type VoiceCommentAttachmentRef } from '../../shared/voiceComments'
import { uploadVoiceCommentAttachment } from '../lib/voiceCommentTransport'

type RecorderState = 'starting' | 'recording' | 'paused' | 'ready' | 'error'

type RecordedClip = {
  blob: Blob
  mimeType: string
  durationMs: number
}

interface VoiceCommentRecorderProps {
  cardId: string
  onAttached: (voiceAttachment: VoiceCommentAttachmentRef) => void
  onClose: () => void
}

const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const

function getPreferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }

  return RECORDING_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  return window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

export function VoiceCommentRecorder({ cardId, onAttached, onClose }: VoiceCommentRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const levelFrameRef = useRef<number | null>(null)
  const durationTimerRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const pausedDurationRef = useRef(0)

  const [recorderState, setRecorderState] = useState<RecorderState>('starting')
  const [level, setLevel] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [recordedClip, setRecordedClip] = useState<RecordedClip | null>(null)

  const statusText = useMemo(() => {
    if (error) {
      return error
    }

    switch (recorderState) {
      case 'starting':
        return 'Requesting microphone access…'
      case 'recording':
        return 'Recording now'
      case 'paused':
        return 'Recording paused'
      case 'ready':
        return 'Recording ready to attach'
      default:
        return 'Microphone unavailable'
    }
  }, [error, recorderState])

  const stopLevelLoop = useCallback(() => {
    if (levelFrameRef.current !== null) {
      window.cancelAnimationFrame(levelFrameRef.current)
      levelFrameRef.current = null
    }
  }, [])

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current !== null) {
      window.clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }, [])

  const getElapsedDurationMs = useCallback(() => {
    if (recordedClip) {
      return recordedClip.durationMs
    }

    const startedAt = startedAtRef.current
    if (startedAt === null) {
      return 0
    }

    const endTime = pausedAtRef.current ?? Date.now()
    return Math.max(0, endTime - startedAt - pausedDurationRef.current)
  }, [recordedClip])

  const cleanupMediaResources = useCallback(() => {
    stopLevelLoop()
    stopDurationTimer()
    setLevel(0)

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null
      mediaRecorderRef.current.onpause = null
      mediaRecorderRef.current.onresume = null
      mediaRecorderRef.current.onstart = null
      mediaRecorderRef.current = null
    }

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    analyserRef.current = null

    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext) {
      void audioContext.close().catch(() => {})
    }
  }, [stopDurationTimer, stopLevelLoop])

  const startDurationTimer = useCallback(() => {
    stopDurationTimer()
    durationTimerRef.current = window.setInterval(() => {
      setDurationMs(getElapsedDurationMs())
    }, 200)
  }, [getElapsedDurationMs, stopDurationTimer])

  const startLevelLoop = useCallback(() => {
    stopLevelLoop()

    const analyser = analyserRef.current
    if (!analyser) {
      return
    }

    const samples = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state !== 'recording') {
        setLevel(0)
        return
      }

      analyser.getByteFrequencyData(samples)
      const average = samples.reduce((sum, value) => sum + value, 0) / (samples.length || 1)
      setLevel(Math.min(1, average / 160))
      levelFrameRef.current = window.requestAnimationFrame(tick)
    }

    tick()
  }, [stopLevelLoop])

  useEffect(() => {
    let disposed = false

    const startRecording = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser does not support microphone recording.')
        setRecorderState('error')
        return
      }
      if (typeof MediaRecorder === 'undefined') {
        setError('This browser does not support voice recording.')
        setRecorderState('error')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        mediaStreamRef.current = stream
        const AudioContextCtor = getAudioContextCtor()
        if (AudioContextCtor) {
          const audioContext = new AudioContextCtor()
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          const source = audioContext.createMediaStreamSource(stream)
          source.connect(analyser)
          audioContextRef.current = audioContext
          analyserRef.current = analyser
        }

        const preferredMimeType = getPreferredRecordingMimeType()
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream)

        chunksRef.current = []
        mediaRecorderRef.current = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data)
          }
        }
        recorder.onstart = () => {
          startedAtRef.current = Date.now()
          pausedAtRef.current = null
          pausedDurationRef.current = 0
          setDurationMs(0)
          setError(null)
          setRecordedClip(null)
          setRecorderState('recording')
          startDurationTimer()
          startLevelLoop()
        }
        recorder.onpause = () => {
          pausedAtRef.current = Date.now()
          setDurationMs(getElapsedDurationMs())
          setRecorderState('paused')
          stopDurationTimer()
          stopLevelLoop()
          setLevel(0)
        }
        recorder.onresume = () => {
          if (pausedAtRef.current !== null) {
            pausedDurationRef.current += Date.now() - pausedAtRef.current
          }
          pausedAtRef.current = null
          setRecorderState('recording')
          startDurationTimer()
          startLevelLoop()
        }
        recorder.start(250)
      } catch (startError) {
        setError(startError instanceof Error ? startError.message : String(startError))
        setRecorderState('error')
        cleanupMediaResources()
      }
    }

    void startRecording()

    return () => {
      disposed = true
      cleanupMediaResources()
    }
  }, [cleanupMediaResources, getElapsedDurationMs, startDurationTimer, startLevelLoop, stopDurationTimer, stopLevelLoop])

  const finalizeRecording = useCallback(async (): Promise<RecordedClip> => {
    if (recordedClip) {
      return recordedClip
    }

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      throw new Error('There is no recording to attach yet.')
    }

    return await new Promise((resolve, reject) => {
      const handleStop = () => {
        const nextDurationMs = getElapsedDurationMs()
        const mimeType = recorder.mimeType || 'audio/webm'
        const nextClip = {
          blob: new Blob(chunksRef.current, { type: mimeType }),
          mimeType,
          durationMs: nextDurationMs,
        } satisfies RecordedClip

        setDurationMs(nextDurationMs)
        setRecordedClip(nextClip)
        setRecorderState('ready')
        cleanupMediaResources()
        resolve(nextClip)
      }

      const handleError = () => {
        reject(new Error('Recording stopped unexpectedly. Please try again.'))
      }

      recorder.addEventListener('stop', handleStop, { once: true })
      recorder.addEventListener('error', handleError, { once: true })
      recorder.stop()
    })
  }, [cleanupMediaResources, getElapsedDurationMs, recordedClip])

  const handlePauseToggle = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      return
    }

    if (recorder.state === 'paused') {
      recorder.resume()
      return
    }

    recorder.pause()
  }, [])

  const handleAttach = useCallback(async () => {
    if (isUploading) {
      return
    }

    setError(null)
    setIsUploading(true)
    try {
      const clip = await finalizeRecording()
      const filename = createVoiceCommentFilename({ mimeType: clip.mimeType })
      const uploaded = await uploadVoiceCommentAttachment({
        cardId,
        filename,
        blob: clip.blob,
        contentType: clip.mimeType,
      })

      onAttached({
        filename: uploaded.filename,
        mimeType: clip.mimeType,
        durationMs: clip.durationMs,
      })
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : String(attachError))
    } finally {
      setIsUploading(false)
    }
  }, [cardId, finalizeRecording, isUploading, onAttached])

  const canPause = recorderState === 'recording' || recorderState === 'paused'
  const canAttach = recorderState === 'recording' || recorderState === 'paused' || recorderState === 'ready'

  return (
    <div className="comment-recorder-popover" role="dialog" aria-label="Voice comment recorder">
      <div className="comment-recorder-popover__header">
        <div>
          <p className="comment-recorder-popover__eyebrow">Voice comment</p>
          <h3 className="comment-recorder-popover__title">Capture a quick voice note</h3>
        </div>
        <button
          type="button"
          className="comment-recorder-popover__close"
          onClick={onClose}
          disabled={isUploading}
          title="Close voice recorder"
        >
          <X size={14} />
        </button>
      </div>

      <div className="comment-recorder-popover__status">
        <div className="comment-recorder-popover__status-icon">
          {recorderState === 'recording' ? <Mic size={14} /> : recorderState === 'paused' ? <Pause size={14} /> : <Paperclip size={14} />}
        </div>
        <div>
          <p className="comment-recorder-popover__status-text">{statusText}</p>
          <p className="comment-recorder-popover__duration">{Math.round(durationMs / 1000)}s captured</p>
        </div>
      </div>

      <div className="comment-recorder-popover__meter" aria-hidden="true">
        <div className="comment-recorder-popover__meter-fill" style={{ transform: `scaleX(${Math.max(0.08, level)})` }} />
      </div>

      <div className="comment-recorder-popover__actions">
        <button
          type="button"
          onClick={handlePauseToggle}
          disabled={!canPause || isUploading}
          className="comment-recorder-popover__secondary"
        >
          {recorderState === 'paused' ? <Play size={14} /> : <Pause size={14} />}
          <span>{recorderState === 'paused' ? 'Resume' : 'Pause'}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleAttach()}
          disabled={!canAttach || isUploading}
          className="comment-recorder-popover__primary"
        >
          {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
          <span>{isUploading ? 'Attaching…' : 'Attach'}</span>
        </button>
      </div>
    </div>
  )
}
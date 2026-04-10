import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Pause, Volume2 } from 'lucide-react'
import { formatVoiceCommentDuration, type VoiceCommentAttachmentRef } from '../../shared/voiceComments'
import { resolveVoiceCommentPlaybackSource } from '../lib/voiceCommentTransport'

interface VoiceCommentPlayerProps {
  cardId?: string
  voiceAttachment: VoiceCommentAttachmentRef
  label?: string
  className?: string
}

export function VoiceCommentPlayer({
  cardId,
  voiceAttachment,
  label = 'Voice comment',
  className,
}: VoiceCommentPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const revokeSourceRef = useRef<(() => void) | null>(null)
  const [resolvedSource, setResolvedSource] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const durationLabel = useMemo(
    () => formatVoiceCommentDuration(voiceAttachment.durationMs),
    [voiceAttachment.durationMs],
  )

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      revokeSourceRef.current?.()
      revokeSourceRef.current = null
    }
  }, [])

  const ensureSource = useCallback(async (): Promise<string> => {
    if (!cardId) {
      throw new Error('Voice playback is unavailable for this comment.')
    }
    if (resolvedSource) {
      return resolvedSource
    }

    const playback = await resolveVoiceCommentPlaybackSource({
      cardId,
      attachment: voiceAttachment.filename,
      fallbackContentType: voiceAttachment.mimeType,
    })

    revokeSourceRef.current?.()
    revokeSourceRef.current = playback.revoke ?? null
    setResolvedSource(playback.src)
    return playback.src
  }, [cardId, resolvedSource, voiceAttachment.filename, voiceAttachment.mimeType])

  const handleTogglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    if (isPlaying) {
      audio.pause()
      return
    }

    setError(null)
    setIsLoading(true)
    try {
      const src = await ensureSource()
      if (audio.src !== src) {
        audio.src = src
      }
      await audio.play()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsLoading(false)
    }
  }, [ensureSource, isPlaying])

  return (
    <div className={['voice-comment-player', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={() => void handleTogglePlayback()}
        disabled={!cardId || isLoading}
        className="voice-comment-player__button"
        title={cardId ? `${isPlaying ? 'Pause' : 'Play'} voice comment` : 'Voice playback unavailable'}
      >
        {isLoading ? <Loader2 size={14} className="animate-spin" /> : isPlaying ? <Pause size={14} /> : <Volume2 size={14} />}
        <span>{isPlaying ? 'Pause' : 'Play'}</span>
      </button>
      <div className="voice-comment-player__meta">
        <span className="voice-comment-player__label">{label}</span>
        {durationLabel && <span className="voice-comment-player__duration">{durationLabel}</span>}
      </div>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      {error && <p className="voice-comment-player__error">{error}</p>}
    </div>
  )
}
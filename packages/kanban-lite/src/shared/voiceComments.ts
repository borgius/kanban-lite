export const VOICE_COMMENT_LINK_TEXT = 'Voice comment'
export const VOICE_COMMENT_FLAG_PARAM = 'voiceComment'
export const VOICE_COMMENT_FLAG_VALUE = '1'

export interface VoiceCommentAttachmentRef {
  filename: string
  mimeType?: string
  durationMs?: number
}

export interface ParsedVoiceCommentContent {
  marker: string | null
  note: string
  voiceAttachment: VoiceCommentAttachmentRef | null
}

const VOICE_COMMENT_MARKER_RE = new RegExp(
  `^\\s*(\\[${escapeForRegExp(VOICE_COMMENT_LINK_TEXT)}\\]\\((attachment:\\/\\/\\/[^\\s)]+(?:\\?[^)]*)?)\\))`,
)

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeDurationMs(durationMs?: number): number | undefined {
  if (!Number.isFinite(durationMs) || durationMs == null || durationMs < 0) {
    return undefined
  }

  return Math.round(durationMs)
}

function stripLeadingBlankLines(value: string): string {
  return value.replace(/^(?:[ \t]*\r?\n)+/, '')
}

/**
 * Builds the canonical attachment href for a voice comment marker.
 */
export function buildVoiceCommentHref({ filename, mimeType, durationMs }: VoiceCommentAttachmentRef): string {
  const trimmedFilename = filename.trim()
  if (!trimmedFilename) {
    throw new Error('Voice comment filename cannot be empty')
  }

  const params = new URLSearchParams()
  params.set(VOICE_COMMENT_FLAG_PARAM, VOICE_COMMENT_FLAG_VALUE)

  const trimmedMimeType = mimeType?.trim()
  if (trimmedMimeType) {
    params.set('mimeType', trimmedMimeType)
  }

  const normalizedDuration = normalizeDurationMs(durationMs)
  if (normalizedDuration !== undefined) {
    params.set('durationMs', String(normalizedDuration))
  }

  return `attachment:///${encodeURIComponent(trimmedFilename)}?${params.toString()}`
}

/**
 * Returns a preferred file extension for a recorded voice comment.
 */
export function getVoiceCommentFileExtension(mimeType?: string): string {
  const normalizedMimeType = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (!normalizedMimeType) {
    return 'webm'
  }

  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.endsWith('/mp3')) {
    return 'mp3'
  }
  if (normalizedMimeType.includes('mp4') || normalizedMimeType.includes('m4a')) {
    return 'm4a'
  }
  if (normalizedMimeType.includes('wav')) {
    return 'wav'
  }
  if (normalizedMimeType.includes('ogg')) {
    return 'ogg'
  }
  if (normalizedMimeType.includes('aac')) {
    return 'aac'
  }

  return 'webm'
}

/**
 * Builds a stable, user-safe filename for a recorded voice comment.
 */
export function createVoiceCommentFilename(
  { mimeType, createdAt = new Date(), suffix }: { mimeType?: string; createdAt?: Date | number | string; suffix?: string } = {},
): string {
  const resolvedDate = createdAt instanceof Date ? createdAt : new Date(createdAt)
  const timestampDate = Number.isNaN(resolvedDate.getTime()) ? new Date() : resolvedDate
  const timestamp = [
    timestampDate.getUTCFullYear(),
    String(timestampDate.getUTCMonth() + 1).padStart(2, '0'),
    String(timestampDate.getUTCDate()).padStart(2, '0'),
  ].join('') + `-${String(timestampDate.getUTCHours()).padStart(2, '0')}${String(timestampDate.getUTCMinutes()).padStart(2, '0')}${String(timestampDate.getUTCSeconds()).padStart(2, '0')}`
  const rawSuffix = (suffix ?? Math.random().toString(36).slice(2, 8)).toLowerCase()
  const sanitizedSuffix = rawSuffix.replace(/[^a-z0-9-]+/g, '').slice(0, 12) || 'clip'

  return `voice-comment-${timestamp}-${sanitizedSuffix}.${getVoiceCommentFileExtension(mimeType)}`
}

/**
 * Builds the canonical markdown marker for an attachment-backed voice comment.
 */
export function buildVoiceCommentMarker(voiceAttachment: VoiceCommentAttachmentRef): string {
  return `[${VOICE_COMMENT_LINK_TEXT}](${buildVoiceCommentHref(voiceAttachment)})`
}

/**
 * Builds the stored markdown body for a voice comment with an optional note.
 */
export function buildVoiceCommentContent(
  { voiceAttachment, note = '' }: { voiceAttachment: VoiceCommentAttachmentRef; note?: string },
): string {
  const marker = buildVoiceCommentMarker(voiceAttachment)
  if (!note.trim()) {
    return marker
  }

  return `${marker}\n\n${note}`
}

/**
 * Parses a canonical voice comment attachment href.
 */
export function parseVoiceCommentHref(href: string): VoiceCommentAttachmentRef | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'attachment:') {
      return null
    }
    if (url.searchParams.get(VOICE_COMMENT_FLAG_PARAM) !== VOICE_COMMENT_FLAG_VALUE) {
      return null
    }

    const filename = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim()
    if (!filename) {
      return null
    }

    const mimeType = url.searchParams.get('mimeType')?.trim() || undefined
    const durationParam = url.searchParams.get('durationMs')
    const durationMs = durationParam == null ? undefined : normalizeDurationMs(Number(durationParam))

    return {
      filename,
      ...(mimeType ? { mimeType } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Parses a stored comment body and extracts a voice marker plus note text.
 */
export function parseVoiceCommentContent(content: string): ParsedVoiceCommentContent {
  const match = content.match(VOICE_COMMENT_MARKER_RE)
  if (!match) {
    return {
      marker: null,
      note: content,
      voiceAttachment: null,
    }
  }

  const marker = match[1]
  const voiceAttachment = parseVoiceCommentHref(match[2])
  if (!voiceAttachment) {
    return {
      marker: null,
      note: content,
      voiceAttachment: null,
    }
  }

  return {
    marker,
    note: stripLeadingBlankLines(content.slice(match[0].length)),
    voiceAttachment,
  }
}

/**
 * Removes a canonical voice marker from a comment body, returning only the note.
 */
export function stripVoiceCommentMarker(content: string): string {
  return parseVoiceCommentContent(content).note
}

/**
 * Formats a voice duration for compact UI labels.
 */
export function formatVoiceCommentDuration(durationMs?: number): string | null {
  const normalizedDuration = normalizeDurationMs(durationMs)
  if (normalizedDuration === undefined) {
    return null
  }

  const totalSeconds = Math.round(normalizedDuration / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Returns true when the supplied comment body contains a canonical voice marker.
 */
export function isVoiceCommentContent(content: string): boolean {
  return parseVoiceCommentContent(content).voiceAttachment !== null
}

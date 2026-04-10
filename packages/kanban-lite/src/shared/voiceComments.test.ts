import { describe, expect, it } from 'vitest'

import {
  buildVoiceCommentContent,
  buildVoiceCommentHref,
  createVoiceCommentFilename,
  formatVoiceCommentDuration,
  parseVoiceCommentContent,
  stripVoiceCommentMarker,
} from './voiceComments'

describe('voiceComments', () => {
  it('builds and parses a voice-only comment marker', () => {
    const content = buildVoiceCommentContent({
      voiceAttachment: {
        filename: 'site-walk.webm',
        mimeType: 'audio/webm',
        durationMs: 4123,
      },
    })

    expect(content).toBe(
      '[Voice comment](attachment:///site-walk.webm?voiceComment=1&mimeType=audio%2Fwebm&durationMs=4123)',
    )

    expect(parseVoiceCommentContent(content)).toEqual({
      marker: '[Voice comment](attachment:///site-walk.webm?voiceComment=1&mimeType=audio%2Fwebm&durationMs=4123)',
      note: '',
      voiceAttachment: {
        filename: 'site-walk.webm',
        mimeType: 'audio/webm',
        durationMs: 4123,
      },
    })
  })

  it('preserves the optional note body when round-tripping a voice comment', () => {
    const note = 'Heard a rattling noise near gate 4.'
    const content = buildVoiceCommentContent({
      voiceAttachment: {
        filename: 'gate 4.m4a',
        mimeType: 'audio/mp4',
        durationMs: 65000,
      },
      note,
    })

    const parsed = parseVoiceCommentContent(content)

    expect(parsed.note).toBe(note)
    expect(parsed.voiceAttachment).toEqual({
      filename: 'gate 4.m4a',
      mimeType: 'audio/mp4',
      durationMs: 65000,
    })
    expect(stripVoiceCommentMarker(content)).toBe(note)
    expect(formatVoiceCommentDuration(parsed.voiceAttachment?.durationMs)).toBe('1:05')
  })

  it('leaves plain comments untouched when no voice marker is present', () => {
    const content = 'Plain markdown comment with **no audio**.'

    expect(parseVoiceCommentContent(content)).toEqual({
      marker: null,
      note: content,
      voiceAttachment: null,
    })
    expect(stripVoiceCommentMarker(content)).toBe(content)
  })

  it('treats malformed attachment links as plain comment text', () => {
    const malformed = '[Voice comment](attachment:///voice.webm?mimeType=audio%2Fwebm)\n\nNeeds a proper marker flag.'

    expect(parseVoiceCommentContent(malformed)).toEqual({
      marker: null,
      note: malformed,
      voiceAttachment: null,
    })
  })

  it('formats long voice durations with hours when needed', () => {
    expect(buildVoiceCommentHref({ filename: 'crew-check.m4a' })).toBe(
      'attachment:///crew-check.m4a?voiceComment=1',
    )
    expect(formatVoiceCommentDuration(3_661_000)).toBe('1:01:01')
  })

  it('builds stable voice filenames from the recording mime type', () => {
    expect(createVoiceCommentFilename({
      mimeType: 'audio/mp4',
      createdAt: '2026-04-10T13:45:09.000Z',
      suffix: 'Field Team',
    })).toBe('voice-comment-20260410-134509-fieldteam.m4a')
  })
})

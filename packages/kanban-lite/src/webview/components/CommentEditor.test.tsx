import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildVoiceCommentContent } from '../../shared/voiceComments'

const commentEditorStore = vi.hoisted(() => ({
  currentUser: 'User',
}))

vi.mock('../store', () => ({
  useStore: <T,>(selector: (state: { currentUser: string }) => T) => selector(commentEditorStore),
}))

import { CommentEditor } from './CommentEditor'

describe('CommentEditor', () => {
  beforeEach(() => {
    commentEditorStore.currentUser = 'Octavia'
  })

  afterEach(() => {
    commentEditorStore.currentUser = 'User'
  })

  it('renders the shared markdown editor surface for writing comments', () => {
    const markup = renderToStaticMarkup(
      <CommentEditor onSubmit={() => {}} />,
    )

    expect(markup).toContain('data-testid="comment-markdown-editor"')
    expect(markup).toContain('aria-label="Comment markdown editor"')
    expect(markup).toContain('Add a comment... (Markdown supported)')
    expect(markup).toContain('value="Octavia"')
    expect(markup).toContain('Your name')
  })

  it('falls back to "User" when no logged-in username is available', () => {
    commentEditorStore.currentUser = ''

    const markup = renderToStaticMarkup(
      <CommentEditor onSubmit={() => {}} />,
    )

    expect(markup).toContain('value="User"')
  })

  it('shows the recorder affordance when a card id is available', () => {
    const markup = renderToStaticMarkup(
      <CommentEditor cardId="card-1" onSubmit={() => {}} />,
    )

    expect(markup).toContain('title="Record voice comment"')
  })

  it('renders an attached voice summary without exposing the raw marker', () => {
    const markup = renderToStaticMarkup(
      <CommentEditor
        cardId="card-1"
        initialContent={buildVoiceCommentContent({
          voiceAttachment: {
            filename: 'voice-note.webm',
            mimeType: 'audio/webm',
            durationMs: 2400,
          },
          note: 'Need a follow-up visit.',
        })}
        onSubmit={() => {}}
      />,
    )

    expect(markup).toContain('Voice comment')
    expect(markup).not.toContain('attachment:///voice-note.webm')
  })
})

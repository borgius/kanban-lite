import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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
})

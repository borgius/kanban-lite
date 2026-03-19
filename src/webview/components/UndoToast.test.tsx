import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { UndoToast } from './UndoToast'

describe('UndoToast', () => {
  it('keeps the existing undo action and progress bar by default', () => {
    const markup = renderToStaticMarkup(
      <UndoToast
        message="Deleted \"Card\""
        onUndo={vi.fn()}
        onExpire={vi.fn()}
        duration={5000}
        index={0}
      />,
    )

    expect(markup).toContain('Deleted &quot;Card&quot;')
    expect(markup).toContain('Undo')
    expect(markup).toContain('h-[2px] w-full')
  })

  it('supports persistent informational notices without undo controls', () => {
    const markup = renderToStaticMarkup(
      <UndoToast
        title="Reconnecting…"
        message="Trying to restore the backend connection."
        persistent
        tone="info"
        index={0}
      />,
    )

    expect(markup).toContain('Reconnecting…')
    expect(markup).toContain('Trying to restore the backend connection.')
    expect(markup).not.toContain('Undo')
    expect(markup).not.toContain('h-[2px] w-full')
  })
})

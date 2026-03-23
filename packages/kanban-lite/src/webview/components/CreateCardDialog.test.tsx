import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CardDisplaySettings } from '../../shared/types'

const DEFAULT_CARD_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  showDeletedColumn: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  boardZoom: 100,
  cardZoom: 100,
  boardBackgroundMode: 'fancy',
  boardBackgroundPreset: 'aurora',
  panelMode: 'drawer',
  drawerWidth: 50,
}

const storeState = {
  cardSettings: { ...DEFAULT_CARD_SETTINGS },
  effectiveDrawerWidth: 64,
  columns: [{ id: 'backlog', name: 'Backlog', color: '#3b82f6' }],
  cards: [],
  labelDefs: {},
  setDrawerWidthPreview: vi.fn(),
  clearDrawerWidthPreview: vi.fn(),
  setCardSettings: vi.fn(),
}

vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}))

vi.mock('./DatePicker', () => ({ DatePicker: () => null }))
vi.mock('./MarkdownEditor', () => ({ MarkdownEditor: () => null }))

import { CreateCardDialog } from './CreateCardDialog'

describe('CreateCardDialog drawer resize integration', () => {
  it('renders a resize handle in drawer mode and uses the effective drawer width', () => {
    const markup = renderToStaticMarkup(
      <CreateCardDialog
        isOpen
        onClose={() => {}}
        onCreate={() => {}}
        onSaveSettings={() => {}}
      />
    )

    expect(markup).toContain('data-panel-resize-handle')
    expect(markup).toContain('width:64%')
  })

  it('does not render a resize handle in popup mode', () => {
    storeState.cardSettings = {
      ...DEFAULT_CARD_SETTINGS,
      panelMode: 'popup',
    }

    const markup = renderToStaticMarkup(
      <CreateCardDialog
        isOpen
        onClose={() => {}}
        onCreate={() => {}}
        onSaveSettings={() => {}}
      />
    )

    expect(markup).not.toContain('data-panel-resize-handle')
  })
})

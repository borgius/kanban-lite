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
  panelMode: 'drawer',
  drawerWidth: 50,
}

const storeState = {
  labelDefs: {},
  cards: [],
  columns: [],
  effectiveDrawerWidth: 62,
  setDrawerWidthPreview: vi.fn(),
  clearDrawerWidthPreview: vi.fn(),
}

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel drawer resize integration', () => {
  it('renders a resize handle in drawer mode and uses the effective drawer width', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS, panelMode: 'drawer', drawerWidth: 50 }}
        workspace={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).toContain('data-panel-resize-handle')
    expect(markup).toContain('width:62%')
  })

  it('does not render a resize handle in popup mode', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        isOpen
        settings={{ ...DEFAULT_CARD_SETTINGS, panelMode: 'popup' }}
        workspace={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(markup).not.toContain('data-panel-resize-handle')
  })
})
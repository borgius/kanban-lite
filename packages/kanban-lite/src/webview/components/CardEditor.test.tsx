import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CardDisplaySettings, CardFrontmatter } from '../../shared/types'

const DEFAULT_CARD_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  cardViewMode: 'large',
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
  boards: [{ id: 'default', name: 'Default', metadata: ['customer'], title: ['customer', 'ticket'] }],
  currentBoard: 'default',
  cards: [],
  columns: [{ id: 'backlog', name: 'Backlog', color: '#3b82f6' }],
  labelDefs: {},
  applyLabelFilter: vi.fn(),
  applyMetadataFilterToken: vi.fn(),
}

vi.mock('../store', () => ({
  useStore: Object.assign((selector?: (state: typeof storeState) => unknown) => selector ? selector(storeState) : storeState, {
    getState: () => storeState,
  }),
}))

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-markdown-editor="" />,
}))

import { CardEditor } from './CardEditor'

function createFrontmatter(overrides: Partial<CardFrontmatter> = {}): CardFrontmatter {
  return {
    id: '58',
    title: 'Ignored title',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    labels: ['onsite'],
    attachments: ['resume.pdf'],
    created: '2026-03-01T12:00:00.000Z',
    modified: '2026-03-21T12:00:00.000Z',
    metadata: { customer: 'Acme Co', ticket: 'BIZ-77' },
    ...overrides,
  } as CardFrontmatter
}

describe('CardEditor', () => {
  it('renders a hero title from markdown content with configured metadata prefixes and the redesigned surfaces', () => {
    const markup = renderToStaticMarkup(
      <CardEditor
        cardId="58"
        content={'# Artificial Intelligence and Business Development\n\nNeed final review.'}
        frontmatter={createFrontmatter()}
        comments={[]}
        onSave={() => {}}
        onClose={() => {}}
        onDelete={() => {}}
        onPermanentDelete={() => {}}
        onRestore={() => {}}
        onOpenFile={() => {}}
        onDownloadCard={() => {}}
        onStartWithAI={() => {}}
        onAddAttachment={() => {}}
        onOpenAttachment={() => {}}
        onRemoveAttachment={() => {}}
        onAddComment={() => {}}
        onUpdateComment={() => {}}
        onDeleteComment={() => {}}
        onTransferToBoard={() => {}}
      />,
    )

    expect(markup).toContain('card-editor-title')
    expect(markup).toContain('Acme Co BIZ-77 Artificial Intelligence and Business Development')
    expect(markup).toContain('Attachments')
    expect(markup).toContain('resume.pdf')
    expect(markup).toContain('customer')
    expect(markup).toContain('Acme Co')
    expect(markup).toContain('data-markdown-editor')
  })

  it('does not render pinned metadata rows when the configured field has no value', () => {
    const markup = renderToStaticMarkup(
      <CardEditor
        cardId="58"
        content={'# Artificial Intelligence and Business Development\n\nNeed final review.'}
        frontmatter={createFrontmatter({ metadata: {} })}
        comments={[]}
        onSave={() => {}}
        onClose={() => {}}
        onDelete={() => {}}
        onPermanentDelete={() => {}}
        onRestore={() => {}}
        onOpenFile={() => {}}
        onDownloadCard={() => {}}
        onStartWithAI={() => {}}
        onAddAttachment={() => {}}
        onOpenAttachment={() => {}}
        onRemoveAttachment={() => {}}
        onAddComment={() => {}}
        onUpdateComment={() => {}}
        onDeleteComment={() => {}}
        onTransferToBoard={() => {}}
      />,
    )

    expect(markup).not.toContain('card-metadata-highlight')
    expect(markup).not.toContain('>customer<')
    expect(markup).toContain('Artificial Intelligence and Business Development')
  })

  it('renders attachments as inline tags', () => {
    const markup = renderToStaticMarkup(
      <CardEditor
        cardId="58"
        content={'# Artificial Intelligence and Business Development\n\nNeed final review.'}
        frontmatter={createFrontmatter()}
        comments={[]}
        onSave={() => {}}
        onClose={() => {}}
        onDelete={() => {}}
        onPermanentDelete={() => {}}
        onRestore={() => {}}
        onOpenFile={() => {}}
        onDownloadCard={() => {}}
        onStartWithAI={() => {}}
        onAddAttachment={() => {}}
        onOpenAttachment={() => {}}
        onRemoveAttachment={() => {}}
        onAddComment={() => {}}
        onUpdateComment={() => {}}
        onDeleteComment={() => {}}
        onTransferToBoard={() => {}}
      />,
    )

    expect(markup).toContain('card-attachment-tags')
    expect(markup).toContain('card-attachment-tag')
  })
})

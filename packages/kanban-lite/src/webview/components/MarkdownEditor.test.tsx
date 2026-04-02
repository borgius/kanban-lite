import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CardFrontmatter } from '../../shared/types'

const storeState = {
  activeCardTab: 'tasks',
  setActiveCardTab: vi.fn(),
  boards: [{ id: 'default', name: 'Default' }],
  currentBoard: 'default',
}

vi.mock('../store', () => ({
  useStore: Object.assign((selector?: (state: typeof storeState) => unknown) => selector ? selector(storeState) : storeState, {
    getState: () => storeState,
  }),
  createFormCardTabId: (formId: string) => `form:${formId}`,
}))

vi.mock('./CommentsSection', () => ({
  CommentsSection: () => <div data-comments-section="" />,
}))

vi.mock('./LogsSection', () => ({
  LogsSection: () => <div data-logs-section="" />,
}))

vi.mock('./CardFormTab', () => ({
  CardFormTab: () => <div data-card-form-tab="" />,
  resolveCardFormDescriptors: () => [],
}))

import { MarkdownEditor } from './MarkdownEditor'

function createFrontmatter(overrides: Partial<CardFrontmatter> = {}): CardFrontmatter {
  return {
    version: 1,
    id: 'card-1',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-24T00:00:00.000Z',
    modified: '2026-03-24T00:00:00.000Z',
    completedAt: null,
    labels: ['tasks', 'in-progress'],
    attachments: [],
    tasks: ['- [ ] Review **docs**', '- [x] Ship fix'],
    order: 'a0',
    ...overrides,
  }
}

describe('MarkdownEditor checklist tab', () => {
  it('renders a fixed checklist tab with progress and inline markdown task text', () => {
    const markup = renderToStaticMarkup(
      <MarkdownEditor
        value={'# Card title'}
        onChange={() => {}}
        mode="edit"
        cardId="card-1"
        frontmatter={createFrontmatter()}
        onAddChecklistItem={() => {}}
        onEditChecklistItem={() => {}}
        onDeleteChecklistItem={() => {}}
        onCheckChecklistItem={() => {}}
        onUncheckChecklistItem={() => {}}
      />,
    )

    expect(markup).toContain('Tasks 1/2')
    expect(markup).toContain('<strong>docs</strong>')
    expect(markup).toContain('Add task')
  })

  it('renders legacy raw HTML and markdown image checklist text inert while preserving safe checklist links', () => {
    const markup = renderToStaticMarkup(
      <MarkdownEditor
        value={'# Card title'}
        onChange={() => {}}
        mode="edit"
        cardId="card-1"
        frontmatter={createFrontmatter({
          tasks: ['- [ ] <img src=x onerror="alert(1)"> ![logo](https://example.com/logo.png) ![bad](data:text/html,hi) **docs** _today_ `api` [guide](https://example.com) [mail](mailto:test@example.com) [bad-js](javascript:alert(1)) [bad-data](data:text/html,hi)'],
        })}
        onAddChecklistItem={() => {}}
        onEditChecklistItem={() => {}}
        onDeleteChecklistItem={() => {}}
        onCheckChecklistItem={() => {}}
        onUncheckChecklistItem={() => {}}
      />,
    )

    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img src=x onerror=')
    expect(markup).toContain('&quot;alert(1)&quot;')
    expect(markup).toContain('![logo](https://example.com/logo.png)')
    expect(markup).toContain('![bad](data:text/html,hi)')
    expect(markup).toContain('<strong>docs</strong>')
    expect(markup).toContain('<em>today</em>')
    expect(markup).toContain('<code>api</code>')
    expect(markup).toContain('href="https://example.com"')
    expect(markup).toContain('href="mailto:test@example.com"')
    expect(markup).not.toContain('href="javascript:alert(1)"')
    expect(markup).not.toContain('href="data:text/html,hi"')
    expect(markup).toContain('bad-js')
    expect(markup).toContain('bad-data')
  })
})

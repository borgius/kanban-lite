import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CardFrontmatter, CardTask } from '../../shared/types'

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

function createTask(overrides: Partial<CardTask> = {}): CardTask {
  return {
    title: 'Review docs',
    description: '',
    checked: false,
    createdAt: '2026-03-24T00:00:00.000Z',
    modifiedAt: '2026-03-24T00:00:00.000Z',
    createdBy: '',
    modifiedBy: '',
    ...overrides,
  }
}

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
    tasks: [createTask(), createTask({ title: 'Ship fix', checked: true })],
    order: 'a0',
    ...overrides,
  }
}

describe('MarkdownEditor checklist tab', () => {
  it('renders a checklist tab with progress and task titles', () => {
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
    expect(markup).toContain('Review docs')
    expect(markup).toContain('Ship fix')
    expect(markup).toContain('Add task')
    expect(markup).toContain('2026-03-24')
  })
})

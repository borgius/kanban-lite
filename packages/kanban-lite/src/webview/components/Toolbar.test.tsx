import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookRuntime = {
  cursor: 0,
  beginRender() {
    this.cursor = 0
  },
}

const storeState = {
  searchQuery: '',
  setSearchQuery: vi.fn(),
  fuzzySearch: false,
  setFuzzySearch: vi.fn(),
  clearPlainTextSearch: vi.fn(),
  removeMetadataFilterToken: vi.fn(),
  priorityFilter: 'all' as const,
  setPriorityFilter: vi.fn(),
  assigneeFilter: 'all' as const,
  setAssigneeFilter: vi.fn(),
  labelFilter: [] as string[],
  setLabelFilter: vi.fn(),
  dueDateFilter: 'all' as const,
  setDueDateFilter: vi.fn(),
  clearAllFilters: vi.fn(),
  layout: 'horizontal' as const,
  toggleLayout: vi.fn(),
  isDarkMode: false,
  cardSettings: {
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: true,
    showLabels: true,
    showBuildWithAI: true,
    showFileName: false,
    compactMode: false,
    markdownEditorMode: false,
    showDeletedColumn: false,
    defaultPriority: 'medium' as const,
    defaultStatus: 'backlog',
    boardZoom: 100,
    cardZoom: 100,
    panelMode: 'drawer' as const,
    drawerWidth: 50,
  },
  boards: [{ id: 'board-a', name: 'Board A' }],
  currentBoard: 'board-a',
  columns: [
    { id: 'todo', name: 'To Do', color: '#3b82f6' },
    { id: 'doing', name: 'Doing', color: '#22c55e' },
    { id: 'deleted', name: 'Deleted', color: '#ef4444' },
  ],
  labelDefs: {},
  cards: [],
  starredBoards: [],
  toggleStarBoard: vi.fn(),
  savedViews: [],
  saveCurrentView: vi.fn(),
  removeView: vi.fn(),
  getHiddenColumnIds: () => ['doing'],
  setColumnHidden: vi.fn(),
}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()

  return {
    ...actual,
    useState<T>(initialState: T | (() => T)) {
      const index = hookRuntime.cursor++
      const initialValue = typeof initialState === 'function'
        ? (initialState as () => T)()
        : initialState

      if (index === 4) return [true, vi.fn()] as const
      if (index === 5) return [true, vi.fn()] as const

      return [initialValue, vi.fn()] as const
    },
    useEffect() {},
    useRef<T>(initialValue: T) {
      return { current: initialValue }
    },
  }
})

vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: typeof storeState) => unknown) => selector(storeState), {
    getState: () => ({
      columnSorts: {},
      setSearchQuery: vi.fn(),
      setFuzzySearch: vi.fn(),
      setPriorityFilter: vi.fn(),
      setAssigneeFilter: vi.fn(),
      setLabelFilter: vi.fn(),
      setDueDateFilter: vi.fn(),
    }),
  }),
}))

vi.mock('./LabelPicker', () => ({ LabelPicker: () => null }))
vi.mock('./BoardSwitcher', () => ({ BoardSwitcher: () => null }))

import { Toolbar } from './Toolbar'

describe('Toolbar columns submenu', () => {
  beforeEach(() => {
    hookRuntime.beginRender()
  })

  it('lists non-deleted columns and reflects hidden state via checkbox items', () => {
    const markup = renderToStaticMarkup(
      <Toolbar
        onOpenSettings={() => {}}
        onAddColumn={() => {}}
        onCreateCard={() => {}}
        onToggleTheme={() => {}}
        onSwitchBoard={() => {}}
        onCreateBoard={() => {}}
      />
    )

    expect(markup).toContain('Columns')
    expect(markup).toContain('To Do')
    expect(markup).toContain('Doing')
    expect(markup).not.toContain('Deleted')
    expect(markup).toMatch(/role="menuitemcheckbox" aria-checked="true"[^>]*>.*To Do/s)
    expect(markup).toMatch(/role="menuitemcheckbox" aria-checked="false"[^>]*>.*Doing/s)
  })
})

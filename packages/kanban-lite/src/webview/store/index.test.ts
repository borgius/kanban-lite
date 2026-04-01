import { afterEach, describe, expect, it } from 'vitest'
import type { BoardInfo, Card, CardDisplaySettings, KanbanColumn } from '../../shared/types'
import { createFormCardTabId, DEFAULT_CARD_TAB, getCardFormTabIds, isCardTabRouteCandidate, useStore } from './index'

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

function makeCard(overrides: Partial<Card>): Card {
  return {
    version: 1,
    id: `card-${Math.random().toString(36).slice(2)}`,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-18T00:00:00.000Z',
    modified: '2026-03-18T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: 'a0',
    content: '# Card',
    filePath: '/tmp/card.md',
    ...overrides,
  }
}

function makeColumn(overrides: Partial<KanbanColumn> = {}): KanbanColumn {
  return {
    id: 'todo',
    name: 'To Do',
    color: '#3b82f6',
    ...overrides,
  }
}

function makeBoard(overrides: Partial<BoardInfo> = {}): BoardInfo {
  return {
    id: 'default',
    name: 'Default',
    ...overrides,
  }
}

function resetStore() {
  useStore.setState({
    cards: [],
    columns: [],
    boards: [],
    columnVisibilityByBoard: {},
    currentBoard: 'default',
    isDarkMode: false,
    searchQuery: '',
    fuzzySearch: false,
    priorityFilter: 'all',
    assigneeFilter: 'all',
    labelFilter: [],
    dueDateFilter: 'all',
    columnSorts: {},
    layout: 'horizontal',
    workspace: null,
    cardSettings: DEFAULT_CARD_SETTINGS,
    drawerWidthPreview: null,
    effectiveDrawerWidth: 50,
    settingsOpen: false,
    labelDefs: {},
    activeCardId: null,
    activeCardTab: 'preview',
    selectedCardIds: [],
    lastClickedCardId: null,
    starredBoards: [],
    savedViews: [],
  })
}

afterEach(() => {
  resetStore()
})

describe('webview store fuzzy search state', () => {
  it('uses the shared SDK matcher for exact and fuzzy search semantics', () => {
    const store = useStore.getState()
    store.setCards([
      makeCard({
        id: 'card-api-plumbing',
        content: '# API plumbing\n\nImplements API plumbing.',
        metadata: { team: 'backend', region: 'useast' },
      }),
      makeCard({
        id: 'card-design',
        content: '# Design\n\nRefines the UX.',
        metadata: { team: 'frontend', region: 'euwest' },
        order: 'a1',
      }),
    ])
    store.setSearchQuery('meta.team: backnd api plumbng')

    expect(store.getFilteredCardsByStatus('todo')).toHaveLength(0)

    store.setFuzzySearch(true)

    const fuzzyMatches = store.getFilteredCardsByStatus('todo')
    expect(fuzzyMatches).toHaveLength(1)
    expect(fuzzyMatches[0].id).toBe('card-api-plumbing')
  })

  it('round-trips fuzzySearch through saved views', () => {
    const store = useStore.getState()
    store.setSearchQuery('meta.team: backnd')
    store.setFuzzySearch(true)
    store.setPriorityFilter('high')
    store.saveCurrentView('Backend fuzzy')

    const [savedView] = useStore.getState().savedViews
    expect(savedView.searchQuery).toBe('meta.team: backnd')
    expect(savedView.fuzzySearch).toBe(true)

    store.setSearchQuery('')
    store.setFuzzySearch(false)
    store.setPriorityFilter('all')

    store.setSearchQuery(savedView.searchQuery)
    store.setFuzzySearch(savedView.fuzzySearch)
    store.setPriorityFilter(savedView.priorityFilter)

    const restored = useStore.getState()
    expect(restored.searchQuery).toBe('meta.team: backnd')
    expect(restored.fuzzySearch).toBe(true)
    expect(restored.priorityFilter).toBe('high')
  })

  it('inserts and updates metadata filter tokens without discarding plain text', () => {
    const store = useStore.getState()

    store.setSearchQuery('release prep meta.team: frontend meta.region: useast')
    store.applyMetadataFilterToken('team', 'backend platform')

    expect(useStore.getState().searchQuery).toBe('release prep meta.team: "backend platform" meta.region: useast')

    store.applyMetadataFilterToken('links.jira', 'PROJ-123')

    expect(useStore.getState().searchQuery).toBe(
      'release prep meta.team: "backend platform" meta.region: useast meta.links.jira: PROJ-123'
    )
  })

  it('applies UI-inserted metadata tokens in both exact and fuzzy modes', () => {
    const store = useStore.getState()
    store.setCards([
      makeCard({
        id: 'card-backend-platform',
        content: '# Release prep',
        metadata: { team: 'backend platform' },
      }),
    ])

    store.applyMetadataFilterToken('team', 'backend platform')
    expect(store.getFilteredCardsByStatus('todo').map(card => card.id)).toEqual(['card-backend-platform'])

    store.setSearchQuery('meta.team: "backnd platfrm"')
    expect(store.getFilteredCardsByStatus('todo')).toHaveLength(0)

    store.setFuzzySearch(true)
    expect(store.getFilteredCardsByStatus('todo').map(card => card.id)).toEqual(['card-backend-platform'])
  })

  it('clears only the plain-text portion of a mixed search query', () => {
    const store = useStore.getState()

    store.setSearchQuery('release prep meta.team: "backend platform" meta.region: useast')
    store.clearPlainTextSearch()

    expect(useStore.getState().searchQuery).toBe('meta.team: "backend platform" meta.region: useast')
  })

  it('removes individual metadata tokens without discarding other search terms', () => {
    const store = useStore.getState()

    store.setSearchQuery('release prep meta.team: frontend meta.region: useast')
    store.removeMetadataFilterToken('team')

    expect(useStore.getState().searchQuery).toBe('release prep meta.region: useast')

    store.removeMetadataFilterToken('region')

    expect(useStore.getState().searchQuery).toBe('release prep')
  })

  it('applies a clicked label as the active label filter without disturbing other filters', () => {
    const store = useStore.getState()
    store.setCards([
      makeCard({
        id: 'card-backend',
        labels: ['backend'],
        metadata: { team: 'platform' },
      }),
      makeCard({
        id: 'card-frontend',
        labels: ['frontend'],
        metadata: { team: 'platform' },
        order: 'a1',
      }),
    ])

    store.setSearchQuery('meta.team: platform')
    store.setLabelFilter(['frontend', 'ops'])
    store.applyLabelFilter('backend')

    expect(useStore.getState().labelFilter).toEqual(['backend'])
    expect(useStore.getState().searchQuery).toBe('meta.team: platform')
    expect(store.getFilteredCardsByStatus('todo').map(card => card.id)).toEqual(['card-backend'])
  })
})

describe('webview store column visibility state', () => {
  it('stores hidden and minimized column ids separately per board', () => {
    const store = useStore.getState()

    store.setColumnHidden('board-a', 'todo', true)
    store.setColumnMinimized('board-a', 'in-progress', true)
    store.setColumnHidden('board-b', 'done', true)

    expect(useStore.getState().getHiddenColumnIds('board-a')).toEqual(['todo'])
    expect(useStore.getState().getMinimizedColumnIds('board-a')).toEqual(['in-progress'])
    expect(useStore.getState().getHiddenColumnIds('board-b')).toEqual(['done'])
    expect(useStore.getState().getMinimizedColumnIds('board-b')).toEqual([])
    expect(useStore.getState().isColumnHidden('todo', 'board-a')).toBe(true)
    expect(useStore.getState().isColumnMinimized('in-progress', 'board-a')).toBe(true)
  })

  it('supports board-scoped show/hide and minimize/expand round-trips', () => {
    const store = useStore.getState()

    store.setColumnHidden('board-a', 'todo', true)
    store.setColumnMinimized('board-a', 'doing', true)
    store.setColumnHidden('board-b', 'done', true)

    store.setColumnHidden('board-a', 'todo', false)
    store.setColumnMinimized('board-a', 'doing', false)

    expect(useStore.getState().getColumnVisibility('board-a')).toEqual({
      hiddenColumnIds: [],
      minimizedColumnIds: [],
    })
    expect(useStore.getState().getColumnVisibility('board-b')).toEqual({
      hiddenColumnIds: ['done'],
      minimizedColumnIds: [],
    })
  })

  it('clears a minimized flag when a column is hidden', () => {
    const store = useStore.getState()

    store.setColumnMinimized('board-a', 'todo', true)
    store.setColumnHidden('board-a', 'todo', true)

    expect(useStore.getState().getColumnVisibility('board-a')).toEqual({
      hiddenColumnIds: ['todo'],
      minimizedColumnIds: [],
    })
    expect(useStore.getState().isColumnMinimized('todo', 'board-a')).toBe(false)
  })

  it('sanitizes stale visibility ids when active board columns change', () => {
    const store = useStore.getState()

    store.setCurrentBoard('board-a')
    store.setColumnHidden('board-a', 'todo', true)
    store.setColumnHidden('board-a', 'ghost', true)
    store.setColumnMinimized('board-a', 'review', true)
    store.setColumnMinimized('board-a', 'phantom', true)
    store.setColumns([
      makeColumn({ id: 'todo' }),
      makeColumn({ id: 'done', name: 'Done', color: '#22c55e' }),
    ])

    expect(useStore.getState().getColumnVisibility('board-a')).toEqual({
      hiddenColumnIds: ['todo'],
      minimizedColumnIds: [],
    })
  })

  it('removes visibility state for boards that no longer exist', () => {
    const store = useStore.getState()

    store.setColumnHidden('board-a', 'todo', true)
    store.setColumnMinimized('board-b', 'done', true)
    store.setBoards([
      makeBoard({ id: 'board-a', name: 'Board A' }),
    ])

    expect(useStore.getState().columnVisibilityByBoard).toEqual({
      'board-a': {
        hiddenColumnIds: ['todo'],
        minimizedColumnIds: [],
      },
    })
  })

  it('uses explicit sanitization helpers for the active board selectors', () => {
    const store = useStore.getState()

    store.setCurrentBoard('board-a')
    store.setColumnMinimized('board-a', 'todo', true)
    store.setColumnHidden('board-a', 'ghost', true)
    store.sanitizeColumnVisibility('board-a', ['todo'])

    expect(useStore.getState().getHiddenColumnIds()).toEqual([])
    expect(useStore.getState().getMinimizedColumnIds()).toEqual(['todo'])
  })
})

describe('webview store dynamic form tabs', () => {
  it('keeps fixed tabs and derives stable dynamic form tab ids for attached forms', () => {
    const board = makeBoard({
      forms: {
        'bug-report': {
          schema: { type: 'object', title: 'Bug Report' },
        },
      },
    })
    const card = makeCard({
      forms: [
        { name: 'bug-report' },
        { schema: { type: 'object', title: 'Release Checklist' } },
        { schema: { type: 'object', title: 'Release Checklist' } },
      ],
    })

    expect(isCardTabRouteCandidate('preview')).toBe(true)
    expect(isCardTabRouteCandidate('comments')).toBe(true)
    expect(isCardTabRouteCandidate('form:bug-report')).toBe(true)
    expect(isCardTabRouteCandidate('mystery')).toBe(false)

    expect(getCardFormTabIds(card, board)).toEqual([
      createFormCardTabId('bug-report'),
      createFormCardTabId('release-checklist'),
      createFormCardTabId('release-checklist-2'),
    ])
  })

  it('preserves pending form tabs for deep links until the matching card is opened', () => {
    const store = useStore.getState()
    const bugReportTab = createFormCardTabId('bug-report')

    store.setBoards([
      makeBoard({
        forms: {
          'bug-report': {
            schema: { type: 'object', title: 'Bug Report' },
          },
        },
      }),
    ])
    store.setCards([
      makeCard({
        id: 'card-with-form',
        forms: [{ name: 'bug-report' }],
      }),
    ])

    store.setActiveCardTab(bugReportTab)
    expect(useStore.getState().activeCardTab).toBe(bugReportTab)

    store.setActiveCardId('card-with-form')
    expect(useStore.getState().activeCardTab).toBe(bugReportTab)
  })

  it('resets stale form tabs when switching cards or closing the editor', () => {
    const store = useStore.getState()
    const bugReportTab = createFormCardTabId('bug-report')

    store.setBoards([
      makeBoard({
        forms: {
          'bug-report': {
            schema: { type: 'object', title: 'Bug Report' },
          },
        },
      }),
    ])
    store.setCards([
      makeCard({
        id: 'card-with-form',
        forms: [{ name: 'bug-report' }],
      }),
      makeCard({
        id: 'card-without-form',
      }),
    ])

    store.setActiveCardTab(bugReportTab)
    store.setActiveCardId('card-with-form')
    expect(useStore.getState().activeCardTab).toBe(bugReportTab)

    store.setActiveCardId('card-without-form')
    expect(useStore.getState().activeCardTab).toBe(DEFAULT_CARD_TAB)

    store.setActiveCardId(null)
    store.setActiveCardTab(bugReportTab)
    store.setActiveCardId('card-with-form')
    expect(useStore.getState().activeCardTab).toBe(bugReportTab)

    store.setActiveCardId(null)
    expect(useStore.getState().activeCardTab).toBe(DEFAULT_CARD_TAB)
  })

  it('keeps card-state metadata untouched when only active-card navigation changes', () => {
    const store = useStore.getState()

    store.setCards([
      makeCard({
        id: 'card-with-state',
        cardState: {
          unread: {
            actorId: 'default-user',
            boardId: 'default',
            cardId: 'card-with-state',
            latestActivity: { cursor: 'card:default:card-with-state:3', updatedAt: '2026-03-24T12:00:00.000Z' },
            readThrough: null,
            unread: true,
          },
          open: null,
          status: {
            backend: 'builtin',
            availability: 'available',
            configured: false,
          },
        },
      }),
    ])

    const before = useStore.getState().cards[0].cardState

    store.setActiveCardId('card-with-state')

    expect(useStore.getState().cards[0].cardState).toEqual(before)
    expect(useStore.getState().cards[0].cardState?.unread?.unread).toBe(true)
  })
})

describe('webview store drawer resize state', () => {
  it('tracks preview width separately from persisted card settings', () => {
    const store = useStore.getState()

    store.setDrawerWidthPreview(68)

    expect(useStore.getState().drawerWidthPreview).toBe(68)
    expect(useStore.getState().effectiveDrawerWidth).toBe(68)
    expect(useStore.getState().cardSettings.drawerWidth).toBe(50)
  })

  it('clamps preview and committed drawer widths and falls back after clearing preview', () => {
    const store = useStore.getState()

    store.setDrawerWidthPreview(10)
    expect(useStore.getState().effectiveDrawerWidth).toBe(20)

    store.setCardSettings({ ...DEFAULT_CARD_SETTINGS, drawerWidth: 90 })
    expect(useStore.getState().drawerWidthPreview).toBe(20)
    expect(useStore.getState().cardSettings.drawerWidth).toBe(80)
    expect(useStore.getState().effectiveDrawerWidth).toBe(20)

    store.clearDrawerWidthPreview()
    expect(useStore.getState().drawerWidthPreview).toBeNull()
    expect(useStore.getState().effectiveDrawerWidth).toBe(80)
  })
})

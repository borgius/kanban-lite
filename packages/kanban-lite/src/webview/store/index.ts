import { create } from 'zustand'
import type { Card, KanbanColumn, Priority, CardDisplaySettings, BoardInfo, WorkspaceInfo, LabelDefinition, CardFormAttachment, CardStateReadModelTransport, CardViewMode } from '../../shared/types'
import { matchesCardSearch, parseSearchQuery } from '../../sdk/metaUtils'
import { generateSlug, normalizeBoardBackgroundSettings } from '../../shared/types'
import { clampDrawerWidthPercent } from '../drawerResize'
import type { SettingsTab } from '../settingsTabs'

import type { DueDateFilter, LayoutMode, SortOrder, CardTab, FixedCardTab, FormCardTab } from './card-tabs'
import { FIXED_CARD_TABS, DEFAULT_CARD_TAB, FORM_CARD_TAB_PREFIX, isFixedCardTab, isFormCardTab, isCardTabRouteCandidate, createFormCardTabId, isRecord, sanitizeCardTab, hasResolvedAttachmentSchema, getCardFormTabIds, normalizeCardTab } from './card-tabs'
import type { SavedView, ColumnVisibilityState, ColumnVisibilityByBoard } from './column-visibility'
import { EMPTY_COLUMN_VISIBILITY, getBoardInfo, normalizeColumnVisibilityState, sanitizeColumnVisibilityState, hasColumnVisibilityState, getColumnVisibilityState, setBoardColumnVisibility, columnVisibilityStateEquals, sanitizeColumnVisibilityByBoard } from './column-visibility'
import type { KanbanState } from './state'
import { getInitialDarkMode, isToday, isThisWeek, isOverdue, formatMetadataTokenValue, buildSearchQuery } from './state'

export type { DueDateFilter, LayoutMode, SortOrder, CardTab, FixedCardTab, FormCardTab } from './card-tabs'
export { FIXED_CARD_TABS, DEFAULT_CARD_TAB, isFixedCardTab, isFormCardTab, isCardTabRouteCandidate, createFormCardTabId, getCardFormTabIds, normalizeCardTab } from './card-tabs'
export type { SavedView, ColumnVisibilityState, ColumnVisibilityByBoard } from './column-visibility'
export { sanitizeColumnVisibilityByBoard } from './column-visibility'

export const useStore = create<KanbanState>((set, get) => ({
  cards: [],
  columns: [],
  boards: [],
  columnVisibilityByBoard: {},
  currentBoard: 'default',
  isDarkMode: getInitialDarkMode(),
  searchQuery: '',
  fuzzySearch: false,
  priorityFilter: 'all',
  assigneeFilter: 'all',
  labelFilter: [],
  dueDateFilter: 'all',
  columnSorts: {},
  layout: 'horizontal',
  workspace: null,
  cardSettings: {
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: true,
    showLabels: true,
    showBuildWithAI: true,
    showFileName: false,
    cardViewMode: 'large' as CardViewMode,
    markdownEditorMode: false,
    showDeletedColumn: false,
    defaultPriority: 'medium',
    defaultStatus: 'backlog',
    boardZoom: 100,
    cardZoom: 100,
    boardBackgroundMode: 'fancy',
    boardBackgroundPreset: 'aurora',
    panelMode: 'drawer' as const,
    drawerWidth: 50,
    drawerPosition: 'right' as const,
  },
  drawerWidthPreview: null,
  effectiveDrawerWidth: 50,
  settingsOpen: false,
  settingsTab: 'general' as SettingsTab,
  settingsPluginId: null,
  labelDefs: {},
  activeCardId: null,
  activeCardTab: DEFAULT_CARD_TAB,
  selectedCardIds: [] as string[],
  lastClickedCardId: null,
  starredBoards: [] as string[],
  savedViews: [] as SavedView[],

  toggleStarBoard: (boardId) => set((state) => ({
    starredBoards: state.starredBoards.includes(boardId)
      ? state.starredBoards.filter(id => id !== boardId)
      : [...state.starredBoards, boardId]
  })),

  saveCurrentView: (name) => set((state) => {
    const id = `view-${Date.now()}`
    const view: SavedView = {
      id,
      name,
      searchQuery: state.searchQuery,
      fuzzySearch: state.fuzzySearch,
      priorityFilter: state.priorityFilter,
      assigneeFilter: state.assigneeFilter,
      labelFilter: [...state.labelFilter],
      dueDateFilter: state.dueDateFilter,
    }
    return { savedViews: [...state.savedViews, view] }
  }),

  removeView: (id) => set((state) => ({
    savedViews: state.savedViews.filter(v => v.id !== id)
  })),

  setActiveCardId: (id) => set((state) => {
    if (!id) {
      return {
        activeCardId: null,
        activeCardTab: DEFAULT_CARD_TAB,
      }
    }

    const board = getBoardInfo(state.boards, state.currentBoard)
    const card = state.cards.find((candidate) => candidate.id === id)

    return {
      activeCardId: id,
      activeCardTab: normalizeCardTab(state.activeCardTab, card, board),
    }
  }),
  setActiveCardTab: (tab) => set((state) => ({
    activeCardTab: normalizeCardTab(
      tab,
      state.activeCardId ? state.cards.find((candidate) => candidate.id === state.activeCardId) : undefined,
      getBoardInfo(state.boards, state.currentBoard)
    ),
  })),
  setWorkspace: (workspace) => set({ workspace }),
  setLabelDefs: (labels) => set({ labelDefs: labels }),
  setCards: (cards) => set((state) => ({
    cards,
    activeCardTab: state.activeCardId
      ? normalizeCardTab(
        state.activeCardTab,
        cards.find((candidate) => candidate.id === state.activeCardId),
        getBoardInfo(state.boards, state.currentBoard)
      )
      : state.activeCardTab,
  })),
  setColumns: (columns) => set((state) => ({
    columns,
    columnVisibilityByBoard: setBoardColumnVisibility(
      state.columnVisibilityByBoard,
      state.currentBoard,
      sanitizeColumnVisibilityState(getColumnVisibilityState(state.columnVisibilityByBoard, state.currentBoard), columns.map((column) => column.id))
    ),
  })),
  setBoards: (boards) => set((state) => {
    const validBoardIds = new Set(boards.map((board) => board.id))
    const board = getBoardInfo(boards, state.currentBoard)
    return {
      boards,
      columnVisibilityByBoard: Object.fromEntries(
        Object.entries(state.columnVisibilityByBoard).filter(([boardId]) => validBoardIds.has(boardId))
      ),
      activeCardTab: state.activeCardId
        ? normalizeCardTab(
          state.activeCardTab,
          state.cards.find((candidate) => candidate.id === state.activeCardId),
          board
        )
        : state.activeCardTab,
    }
  }),
  setCurrentBoard: (boardId) => set((state) => ({
    currentBoard: boardId,
    activeCardTab: state.activeCardId
      ? normalizeCardTab(
        state.activeCardTab,
        state.cards.find((candidate) => candidate.id === state.activeCardId),
        getBoardInfo(state.boards, boardId)
      )
      : state.activeCardTab,
  })),
  getColumnVisibility: (boardId) => {
    const resolvedBoardId = boardId ?? get().currentBoard
    return getColumnVisibilityState(get().columnVisibilityByBoard, resolvedBoardId)
  },
  getHiddenColumnIds: (boardId) => get().getColumnVisibility(boardId).hiddenColumnIds,
  getMinimizedColumnIds: (boardId) => get().getColumnVisibility(boardId).minimizedColumnIds,
  isColumnHidden: (columnId, boardId) => get().getHiddenColumnIds(boardId).includes(columnId),
  isColumnMinimized: (columnId, boardId) => get().getMinimizedColumnIds(boardId).includes(columnId),
  setColumnHidden: (boardId, columnId, hidden) => set((state) => {
    const visibility = getColumnVisibilityState(state.columnVisibilityByBoard, boardId)
    const hiddenColumnIds = hidden
      ? [...visibility.hiddenColumnIds, columnId]
      : visibility.hiddenColumnIds.filter((id) => id !== columnId)

    return {
      columnVisibilityByBoard: setBoardColumnVisibility(state.columnVisibilityByBoard, boardId, normalizeColumnVisibilityState({
        hiddenColumnIds,
        minimizedColumnIds: visibility.minimizedColumnIds.filter((id) => id !== columnId),
      })),
    }
  }),
  setColumnMinimized: (boardId, columnId, minimized) => set((state) => {
    const visibility = getColumnVisibilityState(state.columnVisibilityByBoard, boardId)
    const minimizedColumnIds = minimized
      ? [...visibility.minimizedColumnIds, columnId]
      : visibility.minimizedColumnIds.filter((id) => id !== columnId)

    return {
      columnVisibilityByBoard: setBoardColumnVisibility(state.columnVisibilityByBoard, boardId, normalizeColumnVisibilityState({
        hiddenColumnIds: visibility.hiddenColumnIds,
        minimizedColumnIds,
      })),
    }
  }),
  toggleColumnMinimized: (boardId, columnId) => {
    const state = get()
    state.setColumnMinimized(boardId, columnId, !state.isColumnMinimized(columnId, boardId))
  },
  sanitizeColumnVisibility: (boardId, validColumnIds) => set((state) => ({
    columnVisibilityByBoard: setBoardColumnVisibility(
      state.columnVisibilityByBoard,
      boardId,
      sanitizeColumnVisibilityState(getColumnVisibilityState(state.columnVisibilityByBoard, boardId), validColumnIds)
    ),
  })),
  setIsDarkMode: (dark) => set({ isDarkMode: dark }),
  setCardSettings: (settings) => set((state) => {
    const nextDrawerWidth = clampDrawerWidthPercent(settings.drawerWidth ?? state.cardSettings.drawerWidth ?? 50)
    const background = normalizeBoardBackgroundSettings(
      settings.boardBackgroundMode ?? state.cardSettings.boardBackgroundMode,
      settings.boardBackgroundPreset ?? state.cardSettings.boardBackgroundPreset,
    )

    return {
      cardSettings: {
        ...settings,
        boardZoom: settings.boardZoom ?? state.cardSettings.boardZoom,
        cardZoom: settings.cardZoom ?? state.cardSettings.cardZoom,
        boardBackgroundMode: background.boardBackgroundMode,
        boardBackgroundPreset: background.boardBackgroundPreset,
        panelMode: settings.panelMode ?? state.cardSettings.panelMode,
        drawerWidth: nextDrawerWidth,
        drawerPosition: settings.drawerPosition ?? state.cardSettings.drawerPosition,
        columnWidth: settings.columnWidth ?? state.cardSettings.columnWidth,
      },
      effectiveDrawerWidth: state.drawerWidthPreview ?? nextDrawerWidth,
    }
  }),
  setDrawerWidthPreview: (width) => set(() => {
    const nextPreview = clampDrawerWidthPercent(width)
    return {
      drawerWidthPreview: nextPreview,
      effectiveDrawerWidth: nextPreview,
    }
  }),
  clearDrawerWidthPreview: () => set((state) => ({
    drawerWidthPreview: null,
    effectiveDrawerWidth: clampDrawerWidthPercent(state.cardSettings.drawerWidth ?? 50),
  })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setSettingsPluginId: (id) => set({ settingsPluginId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFuzzySearch: (enabled) => set({ fuzzySearch: enabled }),
  clearPlainTextSearch: () => set((state) => {
    const { metaFilter } = parseSearchQuery(state.searchQuery)
    return {
      searchQuery: buildSearchQuery('', metaFilter),
    }
  }),
  applyMetadataFilterToken: (path, value) => set((state) => {
    const normalizedPath = path.trim()
    const normalizedValue = value.trim().replace(/\s+/g, ' ')
    if (!normalizedPath || !normalizedValue) return {}

    const { metaFilter, plainText } = parseSearchQuery(state.searchQuery)
    metaFilter[normalizedPath] = normalizedValue

    return {
      searchQuery: buildSearchQuery(plainText, metaFilter),
    }
  }),
  removeMetadataFilterToken: (path) => set((state) => {
    const normalizedPath = path.trim()
    if (!normalizedPath) return {}

    const { metaFilter, plainText } = parseSearchQuery(state.searchQuery)
    if (!(normalizedPath in metaFilter)) return {}

    delete metaFilter[normalizedPath]

    return {
      searchQuery: buildSearchQuery(plainText, metaFilter),
    }
  }),
  applyLabelFilter: (label) => set(() => {
    const normalizedLabel = label.trim()
    if (!normalizedLabel) return {}

    return {
      labelFilter: [normalizedLabel],
    }
  }),
  setPriorityFilter: (priority) => set({ priorityFilter: priority }),
  setAssigneeFilter: (assignee) => set({ assigneeFilter: assignee }),
  setLabelFilter: (labels) => set({ labelFilter: labels }),
  setDueDateFilter: (filter) => set({ dueDateFilter: filter }),
  setColumnSort: (columnId, sort) => set((state) => ({
    columnSorts: sort === 'order'
      ? Object.fromEntries(Object.entries(state.columnSorts).filter(([k]) => k !== columnId))
      : { ...state.columnSorts, [columnId]: sort }
  })),
  setLayout: (layout) => set({ layout }),
  toggleLayout: () => set((state) => ({ layout: state.layout === 'horizontal' ? 'vertical' : 'horizontal' })),

  clearAllFilters: () =>
    set({
      searchQuery: '',
      fuzzySearch: false,
      priorityFilter: 'all',
      assigneeFilter: 'all',
      labelFilter: [],
      dueDateFilter: 'all',
      columnSorts: {}
    }),

  addCard: (card) =>
    set((state) => ({
      cards: [...state.cards, card]
    })),

  updateCard: (id, updates) =>
    set((state) => ({
      cards: state.cards.map((f) => (f.id === id ? { ...f, ...updates } : f))
    })),

  removeCard: (id) =>
    set((state) => ({
      cards: state.cards.filter((f) => f.id !== id)
    })),

  mergeCardStates: (states) =>
    set((state) => ({
      cards: state.cards.map((c) => (states[c.id] !== undefined ? { ...c, cardState: states[c.id] } : c))
    })),

  getCardsByStatus: (status) => {
    const { cards } = get()
    return cards
      .filter((f) => f.status === status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  },

  getFilteredCardsByStatus: (status) => {
    const {
      cards,
      searchQuery,
      fuzzySearch,
      priorityFilter,
      assigneeFilter,
      labelFilter,
      dueDateFilter,
      columnSorts
    } = get()
    const sortOrder: SortOrder = columnSorts[status] || 'order'

    return cards
      .filter((f) => {
        if (f.status !== status) return false

        // Priority filter
        if (priorityFilter !== 'all' && f.priority !== priorityFilter) return false

        // Assignee filter
        if (assigneeFilter !== 'all') {
          if (assigneeFilter === 'unassigned') {
            if (f.assignee) return false
          } else if (f.assignee !== assigneeFilter) {
            return false
          }
        }

        // Label filter (multiselect) — 'unread' is a virtual label backed by card state
        if (labelFilter.length > 0) {
          const realLabels = labelFilter.filter(l => l !== 'unread')
          const wantsUnread = labelFilter.includes('unread')
          const matchesReal = realLabels.length > 0 && f.labels.some(l => realLabels.includes(l))
          const matchesUnread = wantsUnread && !!f.cardState?.unread?.unread
          if (!matchesReal && !matchesUnread) return false
        }

        // Due date filter
        if (dueDateFilter !== 'all') {
          if (dueDateFilter === 'no-date') {
            if (f.dueDate) return false
          } else if (!f.dueDate) {
            return false
          } else {
            const dueDate = new Date(f.dueDate)
            if (dueDateFilter === 'overdue' && !isOverdue(dueDate)) return false
            if (dueDateFilter === 'today' && !isToday(dueDate)) return false
            if (dueDateFilter === 'this-week' && !isThisWeek(dueDate)) return false
          }
        }

        if (searchQuery && !matchesCardSearch(f, searchQuery, {}, fuzzySearch)) {
          return false
        }

        return true
      })
      .sort((a, b) => {
        if (sortOrder === 'created:asc') return a.created.localeCompare(b.created)
        if (sortOrder === 'created:desc') return b.created.localeCompare(a.created)
        if (sortOrder === 'modified:asc') return a.modified.localeCompare(b.modified)
        if (sortOrder === 'modified:desc') return b.modified.localeCompare(a.modified)
        return a.order < b.order ? -1 : a.order > b.order ? 1 : 0
      })
  },

  getUniqueAssignees: () => {
    const { cards } = get()
    const assignees = new Set<string>()
    cards.forEach((f) => {
      if (f.assignee) assignees.add(f.assignee)
    })
    return Array.from(assignees).sort()
  },

  getUniqueLabels: () => {
    const { cards } = get()
    const labels = new Set<string>()
    cards.forEach((f) => {
      f.labels.forEach((l) => labels.add(l))
    })
    return Array.from(labels).sort()
  },

  hasActiveFilters: () => {
    const {
      searchQuery,
      fuzzySearch,
      priorityFilter,
      assigneeFilter,
      labelFilter,
      dueDateFilter,
      columnSorts
    } = get()
    return (
      searchQuery !== '' ||
      fuzzySearch ||
      priorityFilter !== 'all' ||
      assigneeFilter !== 'all' ||
      labelFilter.length > 0 ||
      dueDateFilter !== 'all' ||
      Object.keys(columnSorts).length > 0
    )
  },

  toggleSelectCard: (cardId) => set((state) => {
    const has = state.selectedCardIds.includes(cardId)
    const next = has
      ? state.selectedCardIds.filter(id => id !== cardId)
      : [...state.selectedCardIds, cardId]
    return { selectedCardIds: next, lastClickedCardId: cardId }
  }),

  selectCardRange: (cardId) => set((state) => {
    if (!state.lastClickedCardId) {
      return { selectedCardIds: [cardId], lastClickedCardId: cardId }
    }
    // Find both cards in the visible card list across all columns
    const allVisible: Card[] = []
    for (const col of state.columns) {
      allVisible.push(...get().getFilteredCardsByStatus(col.id))
    }
    const startIdx = allVisible.findIndex(c => c.id === state.lastClickedCardId)
    const endIdx = allVisible.findIndex(c => c.id === cardId)
    if (startIdx === -1 || endIdx === -1) {
      return { selectedCardIds: [cardId], lastClickedCardId: cardId }
    }
    const lo = Math.min(startIdx, endIdx)
    const hi = Math.max(startIdx, endIdx)
    const existing = new Set(state.selectedCardIds)
    for (let i = lo; i <= hi; i++) {
      existing.add(allVisible[i].id)
    }
    return { selectedCardIds: Array.from(existing), lastClickedCardId: cardId }
  }),

  selectAllInColumn: (status) => set((state) => {
    const colCards = get().getFilteredCardsByStatus(status)
    const existing = new Set(state.selectedCardIds)
    for (const c of colCards) {
      existing.add(c.id)
    }
    return { selectedCardIds: Array.from(existing) }
  }),

  clearSelection: () => set({ selectedCardIds: [], lastClickedCardId: null }),

  setSelectedCardIds: (ids) => set(() => ({ selectedCardIds: ids }))
}))


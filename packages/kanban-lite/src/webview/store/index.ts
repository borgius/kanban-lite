import { create } from 'zustand'
import type { Card, KanbanColumn, Priority, CardDisplaySettings, BoardInfo, WorkspaceInfo, LabelDefinition, CardFormAttachment } from '../../shared/types'
import { matchesCardSearch, parseSearchQuery } from '../../sdk/metaUtils'
import { generateSlug, normalizeBoardBackgroundSettings } from '../../shared/types'
import { clampDrawerWidthPercent } from '../drawerResize'

export type DueDateFilter = 'all' | 'overdue' | 'today' | 'this-week' | 'no-date'
export type LayoutMode = 'horizontal' | 'vertical'
export type SortOrder = 'order' | 'created:asc' | 'created:desc' | 'modified:asc' | 'modified:desc'
export const FIXED_CARD_TABS = ['write', 'preview', 'comments', 'logs'] as const
export const DEFAULT_CARD_TAB = 'preview'

export type FixedCardTab = (typeof FIXED_CARD_TABS)[number]
export type FormCardTab = `form:${string}`
export type CardTab = FixedCardTab | FormCardTab

const FORM_CARD_TAB_PREFIX = 'form:'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isFixedCardTab(tab: string): tab is FixedCardTab {
  return (FIXED_CARD_TABS as readonly string[]).includes(tab)
}

export function isFormCardTab(tab: string): tab is FormCardTab {
  return tab.startsWith(FORM_CARD_TAB_PREFIX) && tab.length > FORM_CARD_TAB_PREFIX.length
}

export function isCardTabRouteCandidate(tab: string): tab is CardTab {
  return isFixedCardTab(tab) || isFormCardTab(tab)
}

export function createFormCardTabId(formId: string): FormCardTab {
  return `${FORM_CARD_TAB_PREFIX}${formId}` as FormCardTab
}

function sanitizeCardTab(tab: string): CardTab {
  return isCardTabRouteCandidate(tab) ? tab : DEFAULT_CARD_TAB
}

function hasResolvedAttachmentSchema(attachment: CardFormAttachment, board?: BoardInfo): boolean {
  if (isRecord(attachment.schema)) {
    return true
  }

  return Boolean(
    attachment.name
    && board?.forms
    && isRecord(board.forms[attachment.name]?.schema)
  )
}

export function getCardFormTabIds(card?: Pick<Card, 'forms'> | null, board?: BoardInfo): FormCardTab[] {
  const attachments = card?.forms ?? []
  if (attachments.length === 0) {
    return []
  }

  const usedIds = new Set<string>()

  return attachments.flatMap((attachment, index) => {
    if (!hasResolvedAttachmentSchema(attachment, board)) {
      return []
    }

    const schema = isRecord(attachment.schema) ? attachment.schema : undefined
    const baseId = attachment.name
      ?? (schema && typeof schema.title === 'string' && schema.title.trim().length > 0
        ? generateSlug(schema.title)
        : `form-${index}`)

    let candidate = baseId || `form-${index}`
    let suffix = 2

    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix++}`
    }

    usedIds.add(candidate)
    return [createFormCardTabId(candidate)]
  })
}

export function normalizeCardTab(tab: string, card?: Pick<Card, 'forms'> | null, board?: BoardInfo): CardTab {
  const candidate = sanitizeCardTab(tab)

  if (!card || isFixedCardTab(candidate)) {
    return candidate
  }

  return isFormCardTab(candidate) && getCardFormTabIds(card, board).includes(candidate)
    ? candidate
    : DEFAULT_CARD_TAB
}

function getBoardInfo(boards: BoardInfo[], boardId: string): BoardInfo | undefined {
  return boards.find((board) => board.id === boardId)
}

export interface SavedView {
  id: string
  name: string
  searchQuery: string
  fuzzySearch: boolean
  priorityFilter: Priority | 'all'
  assigneeFilter: string | 'all'
  labelFilter: string[]
  dueDateFilter: DueDateFilter
}

export interface ColumnVisibilityState {
  hiddenColumnIds: string[]
  minimizedColumnIds: string[]
}

export type ColumnVisibilityByBoard = Record<string, ColumnVisibilityState>

const EMPTY_COLUMN_VISIBILITY: ColumnVisibilityState = {
  hiddenColumnIds: [],
  minimizedColumnIds: [],
}

function normalizeColumnVisibilityState(visibility?: Partial<ColumnVisibilityState>): ColumnVisibilityState {
  const hiddenColumnIds = Array.from(new Set(visibility?.hiddenColumnIds ?? []))
  const hiddenSet = new Set(hiddenColumnIds)

  return {
    hiddenColumnIds,
    minimizedColumnIds: Array.from(new Set(visibility?.minimizedColumnIds ?? [])).filter((columnId) => !hiddenSet.has(columnId)),
  }
}

function sanitizeColumnVisibilityState(
  visibility: ColumnVisibilityState,
  validColumnIds: readonly string[]
): ColumnVisibilityState {
  const validIds = new Set(validColumnIds)

  return normalizeColumnVisibilityState({
    hiddenColumnIds: visibility.hiddenColumnIds.filter((columnId) => validIds.has(columnId)),
    minimizedColumnIds: visibility.minimizedColumnIds.filter((columnId) => validIds.has(columnId)),
  })
}

function hasColumnVisibilityState(visibility: ColumnVisibilityState): boolean {
  return visibility.hiddenColumnIds.length > 0 || visibility.minimizedColumnIds.length > 0
}

function getColumnVisibilityState(
  columnVisibilityByBoard: ColumnVisibilityByBoard,
  boardId: string
): ColumnVisibilityState {
  return columnVisibilityByBoard[boardId] ?? EMPTY_COLUMN_VISIBILITY
}

function setBoardColumnVisibility(
  columnVisibilityByBoard: ColumnVisibilityByBoard,
  boardId: string,
  visibility: ColumnVisibilityState
): ColumnVisibilityByBoard {
  if (!hasColumnVisibilityState(visibility)) {
    if (!(boardId in columnVisibilityByBoard)) {
      return columnVisibilityByBoard
    }

    return Object.fromEntries(Object.entries(columnVisibilityByBoard).filter(([id]) => id !== boardId))
  }

  return {
    ...columnVisibilityByBoard,
    [boardId]: visibility,
  }
}

function columnVisibilityStateEquals(a: ColumnVisibilityState, b: ColumnVisibilityState): boolean {
  return a.hiddenColumnIds.length === b.hiddenColumnIds.length
    && a.minimizedColumnIds.length === b.minimizedColumnIds.length
    && a.hiddenColumnIds.every((columnId, index) => columnId === b.hiddenColumnIds[index])
    && a.minimizedColumnIds.every((columnId, index) => columnId === b.minimizedColumnIds[index])
}

export function sanitizeColumnVisibilityByBoard(
  columnVisibilityByBoard: ColumnVisibilityByBoard,
  boardId: string,
  validColumnIds: readonly string[]
): ColumnVisibilityByBoard {
  const currentVisibility = getColumnVisibilityState(columnVisibilityByBoard, boardId)
  const sanitizedVisibility = sanitizeColumnVisibilityState(currentVisibility, validColumnIds)

  return columnVisibilityStateEquals(currentVisibility, sanitizedVisibility)
    ? columnVisibilityByBoard
    : setBoardColumnVisibility(columnVisibilityByBoard, boardId, sanitizedVisibility)
}

interface KanbanState {
  cards: Card[]
  columns: KanbanColumn[]
  boards: BoardInfo[]
  columnVisibilityByBoard: Record<string, ColumnVisibilityState>
  currentBoard: string
  isDarkMode: boolean
  searchQuery: string
  fuzzySearch: boolean
  priorityFilter: Priority | 'all'
  assigneeFilter: string | 'all'
  labelFilter: string[]
  dueDateFilter: DueDateFilter
  columnSorts: Record<string, SortOrder>
  layout: LayoutMode
  workspace: WorkspaceInfo | null
  cardSettings: CardDisplaySettings
  drawerWidthPreview: number | null
  effectiveDrawerWidth: number
  settingsOpen: boolean
  labelDefs: Record<string, LabelDefinition>

  /** ID of the currently open card in the editor (null if none) */
  activeCardId: string | null
  /** Active tab in the card editor */
  activeCardTab: CardTab

  /** Multi-select: array of selected card IDs */
  selectedCardIds: string[]
  /** Multi-select: last clicked card ID for shift-range selection */
  lastClickedCardId: string | null

  /** Starred board IDs (UI-only, not persisted to disk) */
  starredBoards: string[]
  /** Named saved views capturing the current filter state */
  savedViews: SavedView[]

  toggleStarBoard: (boardId: string) => void
  saveCurrentView: (name: string) => void
  removeView: (id: string) => void

  setActiveCardId: (id: string | null) => void
  setActiveCardTab: (tab: CardTab) => void
  setWorkspace: (workspace: WorkspaceInfo) => void
  setLabelDefs: (labels: Record<string, LabelDefinition>) => void
  setCards: (cards: Card[]) => void
  setColumns: (columns: KanbanColumn[]) => void
  setBoards: (boards: BoardInfo[]) => void
  setCurrentBoard: (boardId: string) => void
  getColumnVisibility: (boardId?: string) => ColumnVisibilityState
  getHiddenColumnIds: (boardId?: string) => string[]
  getMinimizedColumnIds: (boardId?: string) => string[]
  isColumnHidden: (columnId: string, boardId?: string) => boolean
  isColumnMinimized: (columnId: string, boardId?: string) => boolean
  setColumnHidden: (boardId: string, columnId: string, hidden: boolean) => void
  setColumnMinimized: (boardId: string, columnId: string, minimized: boolean) => void
  toggleColumnMinimized: (boardId: string, columnId: string) => void
  sanitizeColumnVisibility: (boardId: string, validColumnIds: string[]) => void
  setIsDarkMode: (dark: boolean) => void
  setCardSettings: (settings: CardDisplaySettings) => void
  setDrawerWidthPreview: (width: number) => void
  clearDrawerWidthPreview: () => void
  setSettingsOpen: (open: boolean) => void
  setSearchQuery: (query: string) => void
  setFuzzySearch: (enabled: boolean) => void
  clearPlainTextSearch: () => void
  applyMetadataFilterToken: (path: string, value: string) => void
  removeMetadataFilterToken: (path: string) => void
  applyLabelFilter: (label: string) => void
  setPriorityFilter: (priority: Priority | 'all') => void
  setAssigneeFilter: (assignee: string | 'all') => void
  setLabelFilter: (labels: string[]) => void
  setDueDateFilter: (filter: DueDateFilter) => void
  setColumnSort: (columnId: string, sort: SortOrder) => void
  setLayout: (layout: LayoutMode) => void
  toggleLayout: () => void
  clearAllFilters: () => void

  addCard: (card: Card) => void
  updateCard: (id: string, updates: Partial<Card>) => void
  removeCard: (id: string) => void
  getCardsByStatus: (status: string) => Card[]
  getFilteredCardsByStatus: (status: string) => Card[]
  getUniqueAssignees: () => string[]
  getUniqueLabels: () => string[]
  hasActiveFilters: () => boolean

  /** Multi-select actions */
  toggleSelectCard: (cardId: string) => void
  selectCardRange: (cardId: string) => void
  selectAllInColumn: (status: string) => void
  clearSelection: () => void
  setSelectedCardIds: (ids: string[]) => void
}

const getInitialDarkMode = (): boolean => {
  // Check for VSCode theme
  if (typeof document !== 'undefined') {
    return document.body.classList.contains('vscode-dark') ||
           document.body.classList.contains('vscode-high-contrast')
  }
  return false
}

const isToday = (date: Date): boolean => {
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

const isThisWeek = (date: Date): boolean => {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  startOfWeek.setHours(0, 0, 0, 0)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  return date >= startOfWeek && date < endOfWeek
}

const isOverdue = (date: Date): boolean => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

function formatMetadataTokenValue(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return /\s/.test(normalized) ? JSON.stringify(normalized) : normalized
}

function buildSearchQuery(plainText: string, metaFilter: Record<string, string>): string {
  const metaTokens = Object.entries(metaFilter)
    .map(([path, value]) => [path.trim(), value.trim()] as const)
    .filter(([path, value]) => path.length > 0 && value.length > 0)
    .map(([path, value]) => `meta.${path}: ${formatMetadataTokenValue(value)}`)

  return [plainText.trim(), ...metaTokens].filter(Boolean).join(' ').trim()
}

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
    compactMode: false,
    markdownEditorMode: false,
    showDeletedColumn: false,
    defaultPriority: 'medium',
    defaultStatus: 'backlog',
    boardZoom: 100,
    cardZoom: 100,
    boardBackgroundMode: 'fancy',
    boardBackgroundPreset: 'aurora',
    panelMode: 'drawer' as const,
    drawerWidth: 50
  },
  drawerWidthPreview: null,
  effectiveDrawerWidth: 50,
  settingsOpen: false,
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
      },
      effectiveDrawerWidth: state.drawerWidthPreview ?? nextDrawerWidth,
    }
  }),
  setDrawerWidthPreview: (width) => set((state) => {
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

  setSelectedCardIds: (ids) => set({ selectedCardIds: ids })
}))

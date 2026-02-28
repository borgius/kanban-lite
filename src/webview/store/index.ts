import { create } from 'zustand'
import type { Card, KanbanColumn, Priority, CardDisplaySettings, BoardInfo, WorkspaceInfo, LabelDefinition } from '../../shared/types'

export type DueDateFilter = 'all' | 'overdue' | 'today' | 'this-week' | 'no-date'
export type LayoutMode = 'horizontal' | 'vertical'
export type SortOrder = 'order' | 'created:asc' | 'created:desc' | 'modified:asc' | 'modified:desc'

interface KanbanState {
  cards: Card[]
  columns: KanbanColumn[]
  boards: BoardInfo[]
  currentBoard: string
  isDarkMode: boolean
  searchQuery: string
  priorityFilter: Priority | 'all'
  assigneeFilter: string | 'all'
  labelFilter: string[]
  dueDateFilter: DueDateFilter
  columnSorts: Record<string, SortOrder>
  layout: LayoutMode
  workspace: WorkspaceInfo | null
  cardSettings: CardDisplaySettings
  settingsOpen: boolean
  labelDefs: Record<string, LabelDefinition>

  setWorkspace: (workspace: WorkspaceInfo) => void
  setLabelDefs: (labels: Record<string, LabelDefinition>) => void
  setCards: (cards: Card[]) => void
  setColumns: (columns: KanbanColumn[]) => void
  setBoards: (boards: BoardInfo[]) => void
  setCurrentBoard: (boardId: string) => void
  setIsDarkMode: (dark: boolean) => void
  setCardSettings: (settings: CardDisplaySettings) => void
  setSettingsOpen: (open: boolean) => void
  setSearchQuery: (query: string) => void
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

/**
 * Parses `meta.path: value` tokens from the search query string.
 * Returns the extracted meta filters and the remaining plain-text query.
 *
 * @example
 * parseMetaTokens('meta.sprint: Q1 bug fix')
 * // => { metaFilter: { sprint: 'Q1' }, plainText: 'bug fix' }
 */
function parseMetaTokens(query: string): { metaFilter: Record<string, string>; plainText: string } {
  const metaFilter: Record<string, string> = {}
  const plainText = query.replace(/meta\.([a-zA-Z0-9_.]+):\s*(\S+)/g, (_full, key, value) => {
    metaFilter[key] = value
    return ''
  }).trim()
  return { metaFilter, plainText }
}

export const useStore = create<KanbanState>((set, get) => ({
  cards: [],
  columns: [],
  boards: [],
  currentBoard: 'default',
  isDarkMode: getInitialDarkMode(),
  searchQuery: '',
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
    cardZoom: 100
  },
  settingsOpen: false,
  labelDefs: {},

  setWorkspace: (workspace) => set({ workspace }),
  setLabelDefs: (labels) => set({ labelDefs: labels }),
  setCards: (cards) => set({ cards }),
  setColumns: (columns) => set({ columns }),
  setBoards: (boards) => set({ boards }),
  setCurrentBoard: (boardId) => set({ currentBoard: boardId }),
  setIsDarkMode: (dark) => set({ isDarkMode: dark }),
  setCardSettings: (settings) => set((state) => ({ cardSettings: { ...settings, boardZoom: settings.boardZoom ?? state.cardSettings.boardZoom, cardZoom: settings.cardZoom ?? state.cardSettings.cardZoom } })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSearchQuery: (query) => set({ searchQuery: query }),
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

        // Label filter (multiselect)
        if (labelFilter.length > 0) {
          if (!f.labels.some(l => labelFilter.includes(l))) return false
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

        // Search query - supports meta.field: value tokens and plain text
        if (searchQuery) {
          const { metaFilter, plainText } = parseMetaTokens(searchQuery)

          if (Object.keys(metaFilter).length > 0) {
            const passes = Object.entries(metaFilter).every(([path, needle]) => {
              if (!f.metadata) return false
              const val = path.split('.').reduce((curr: unknown, k) =>
                curr != null && typeof curr === 'object' ? (curr as Record<string, unknown>)[k] : undefined, f.metadata)
              return val != null && String(val).toLowerCase().includes(needle.toLowerCase())
            })
            if (!passes) return false
          }

          if (plainText) {
            const q = plainText.toLowerCase()
            const textMatch = (
              f.content.toLowerCase().includes(q) ||
              f.id.toLowerCase().includes(q) ||
              f.assignee?.toLowerCase().includes(q) ||
              f.labels.some((l) => l.toLowerCase().includes(q))
            )
            if (!textMatch) return false
          }
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
      priorityFilter,
      assigneeFilter,
      labelFilter,
      dueDateFilter,
      columnSorts
    } = get()
    return (
      searchQuery !== '' ||
      priorityFilter !== 'all' ||
      assigneeFilter !== 'all' ||
      labelFilter.length > 0 ||
      dueDateFilter !== 'all' ||
      Object.keys(columnSorts).length > 0
    )
  }
}))

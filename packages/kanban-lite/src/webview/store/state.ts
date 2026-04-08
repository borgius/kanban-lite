import { create } from 'zustand'
import type { Card, KanbanColumn, Priority, CardDisplaySettings, BoardInfo, WorkspaceInfo, LabelDefinition, CardFormAttachment, CardStateReadModelTransport, CardViewMode } from '../../shared/types'
import { matchesCardSearch, parseSearchQuery } from '../../sdk/metaUtils'
import { generateSlug, normalizeBoardBackgroundSettings } from '../../shared/types'
import { clampDrawerWidthPercent } from '../drawerResize'
import type { SettingsTab } from '../settingsTabs'

import type { DueDateFilter, LayoutMode, SortOrder, CardTab } from './card-tabs'
import type { SavedView, ColumnVisibilityState, ColumnVisibilityByBoard } from './column-visibility'

export interface KanbanState {
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
  settingsTab: SettingsTab
  settingsPluginId: string | null
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
  setSettingsTab: (tab: SettingsTab) => void
  setSettingsPluginId: (id: string | null) => void
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
  mergeCardStates: (states: Record<string, CardStateReadModelTransport>) => void
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

export const getInitialDarkMode = (): boolean => {
  // Check for VSCode theme
  if (typeof document !== 'undefined') {
    return document.body.classList.contains('vscode-dark') ||
           document.body.classList.contains('vscode-high-contrast')
  }
  return false
}

export const isToday = (date: Date): boolean => {
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

export const isThisWeek = (date: Date): boolean => {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  startOfWeek.setHours(0, 0, 0, 0)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  return date >= startOfWeek && date < endOfWeek
}

export const isOverdue = (date: Date): boolean => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

export function formatMetadataTokenValue(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return /\s/.test(normalized) ? JSON.stringify(normalized) : normalized
}

export function buildSearchQuery(plainText: string, metaFilter: Record<string, string>): string {
  const metaTokens = Object.entries(metaFilter)
    .map(([path, value]) => [path.trim(), value.trim()] as const)
    .filter(([path, value]) => path.length > 0 && value.length > 0)
    .map(([path, value]) => `meta.${path}: ${formatMetadataTokenValue(value)}`)

  return [plainText.trim(), ...metaTokens].filter(Boolean).join(' ').trim()
}



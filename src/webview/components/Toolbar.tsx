import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Search, X, Columns, Rows, Settings, Plus, Moon, Sun, ChevronDown, Check, ScrollText, Tag, Zap, SlidersHorizontal, MoreHorizontal, Keyboard, Star, BookmarkPlus } from 'lucide-react'
import { useStore, type DueDateFilter, type SavedView } from '../store'
import { LabelPicker } from './LabelPicker'
import { BoardSwitcher } from './BoardSwitcher'
import type { Priority } from '../../shared/types'

const priorities: { value: Priority | 'all'; label: string }[] = [
  { value: 'all', label: 'All Priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
]

const dueDateOptions: { value: DueDateFilter; label: string }[] = [
  { value: 'all', label: 'All Dates' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due Today' },
  { value: 'this-week', label: 'Due This Week' },
  { value: 'no-date', label: 'No Due Date' }
]

const selectClassName =
  'text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100'

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-full">
      <span className="max-w-[180px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 flex-shrink-0"
        aria-label={`Remove ${label} filter`}
      >
        <X size={12} />
      </button>
    </span>
  )
}

export function Toolbar({ onOpenSettings, onAddColumn, onCreateCard, onToggleTheme, onSwitchBoard, onCreateBoard, onOpenBoardLogs, boardLogsOpen, onTriggerBoardAction, onOpenShortcutHelp }: { onOpenSettings: () => void; onAddColumn: () => void; onCreateCard: () => void; onToggleTheme: () => void; onSwitchBoard: (boardId: string) => void; onCreateBoard: (name: string) => void; onOpenBoardLogs?: () => void; boardLogsOpen?: boolean; onTriggerBoardAction?: (boardId: string, actionKey: string) => void; onOpenShortcutHelp?: () => void }) {
  const searchQuery = useStore(s => s.searchQuery)
  const setSearchQuery = useStore(s => s.setSearchQuery)
  const priorityFilter = useStore(s => s.priorityFilter)
  const setPriorityFilter = useStore(s => s.setPriorityFilter)
  const assigneeFilter = useStore(s => s.assigneeFilter)
  const setAssigneeFilter = useStore(s => s.setAssigneeFilter)
  const labelFilter = useStore(s => s.labelFilter)
  const setLabelFilter = useStore(s => s.setLabelFilter)
  const dueDateFilter = useStore(s => s.dueDateFilter)
  const setDueDateFilter = useStore(s => s.setDueDateFilter)
  const clearAllFilters = useStore(s => s.clearAllFilters)
  const layout = useStore(s => s.layout)
  const toggleLayout = useStore(s => s.toggleLayout)
  const isDarkMode = useStore(s => s.isDarkMode)
  const cardSettings = useStore(s => s.cardSettings)
  const boards = useStore(s => s.boards)
  const currentBoard = useStore(s => s.currentBoard)
  const labelDefs = useStore(s => s.labelDefs)
  const cards = useStore(s => s.cards)
  const starredBoards = useStore(s => s.starredBoards)
  const toggleStarBoard = useStore(s => s.toggleStarBoard)
  const savedViews = useStore(s => s.savedViews)
  const saveCurrentView = useStore(s => s.saveCurrentView)
  const removeView = useStore(s => s.removeView)

  const assignees = useMemo(() => {
    const s = new Set<string>()
    cards.forEach(c => { if (c.assignee) s.add(c.assignee) })
    return Array.from(s).sort()
  }, [cards])

  const labels = useMemo(() => {
    const s = new Set<string>()
    cards.forEach(c => c.labels.forEach(l => s.add(l)))
    return Array.from(s).sort()
  }, [cards])

  const filtersActive = useMemo(() => {
    const columnSorts = useStore.getState().columnSorts
    return (
      searchQuery !== '' ||
      priorityFilter !== 'all' ||
      assigneeFilter !== 'all' ||
      labelFilter.length > 0 ||
      dueDateFilter !== 'all' ||
      Object.values(columnSorts).some(s => s !== 'order')
    )
  }, [searchQuery, priorityFilter, assigneeFilter, labelFilter, dueDateFilter])

  const [boardSwitcherOpen, setBoardSwitcherOpen] = useState(false)
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const boardSwitcherRef = useRef<HTMLDivElement>(null)
  const newBoardInputRef = useRef<HTMLInputElement>(null)

  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)

  const [boardMenuOpen, setBoardMenuOpen] = useState(false)
  const boardMenuRef = useRef<HTMLDivElement>(null)
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false)
  const actionsDropdownRef = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [viewsDropdownOpen, setViewsDropdownOpen] = useState(false)
  const viewsDropdownRef = useRef<HTMLDivElement>(null)
  const [savingView, setSavingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const newViewInputRef = useRef<HTMLInputElement>(null)

  const currentBoardActions = useMemo(() => boards.find(b => b.id === currentBoard)?.actions ?? {}, [boards, currentBoard])
  const boardActionEntries = useMemo(() => Object.entries(currentBoardActions), [currentBoardActions])
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (priorityFilter !== 'all') count += 1
    if (assigneeFilter !== 'all') count += 1
    if (labelFilter.length > 0) count += 1
    if (dueDateFilter !== 'all') count += 1
    return count
  }, [priorityFilter, assigneeFilter, labelFilter, dueDateFilter])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (boardSwitcherRef.current && !boardSwitcherRef.current.contains(e.target as Node)) {
        setBoardSwitcherOpen(false)
        setCreatingBoard(false)
        setNewBoardName('')
      }
    }
    if (boardSwitcherOpen || creatingBoard) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [boardSwitcherOpen, creatingBoard])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setLabelDropdownOpen(false)
      }
    }
    if (labelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [labelDropdownOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (boardMenuRef.current && !boardMenuRef.current.contains(e.target as Node)) {
        setBoardMenuOpen(false)
      }
    }
    if (boardMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [boardMenuOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsDropdownRef.current && !actionsDropdownRef.current.contains(e.target as Node)) {
        setActionsDropdownOpen(false)
      }
    }
    if (actionsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [actionsDropdownOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (viewsDropdownRef.current && !viewsDropdownRef.current.contains(e.target as Node)) {
        setViewsDropdownOpen(false)
      }
    }
    if (viewsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [viewsDropdownOpen])

  useEffect(() => {
    if (savingView && newViewInputRef.current) {
      newViewInputRef.current.focus()
    }
  }, [savingView])

  useEffect(() => {
    if (creatingBoard && newBoardInputRef.current) {
      newBoardInputRef.current.focus()
    }
  }, [creatingBoard])

  const currentBoardName = boards.find(b => b.id === currentBoard)?.name || currentBoard
  const isCurrentBoardStarred = starredBoards.includes(currentBoard)

  const handleSaveView = useCallback(() => {
    const name = newViewName.trim()
    if (!name) return
    saveCurrentView(name)
    setNewViewName('')
    setSavingView(false)
    setViewsDropdownOpen(false)
  }, [newViewName, saveCurrentView])

  const applyView = useCallback((view: SavedView) => {
    const store = useStore.getState()
    store.setSearchQuery(view.searchQuery)
    store.setPriorityFilter(view.priorityFilter)
    store.setAssigneeFilter(view.assigneeFilter)
    store.setLabelFilter(view.labelFilter)
    store.setDueDateFilter(view.dueDateFilter)
  }, [])

  const handleCreateBoard = () => {
    const name = newBoardName.trim()
    if (!name) return
    onCreateBoard(name)
    setNewBoardName('')
    setCreatingBoard(false)
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        setBoardSwitcherOpen(open => !open)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <div className="flex flex-col border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
    <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
      {/* Board Selector */}
      <div className="relative flex items-center gap-0.5" ref={boardSwitcherRef}>
        <button
          type="button"
          onClick={() => setBoardSwitcherOpen(!boardSwitcherOpen)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
          title="Switch board (b)"
        >
          <span className="max-w-[120px] truncate">{currentBoardName}</span>
          <ChevronDown size={14} className={`text-zinc-400 transition-transform ${boardSwitcherOpen ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => toggleStarBoard(currentBoard)}
          className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          title={isCurrentBoardStarred ? 'Unstar board' : 'Star board'}
        >
          <Star size={14} className={isCurrentBoardStarred ? 'fill-amber-400 text-amber-400' : 'text-zinc-400'} />
        </button>
        {creatingBoard ? (
          <div className="flex items-center gap-1 ml-1">
            <input
              ref={newBoardInputRef}
              type="text"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateBoard()
                if (e.key === 'Escape') { setCreatingBoard(false); setNewBoardName('') }
              }}
              placeholder="Board name..."
              className="w-28 px-2 py-1 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
            />
            <button
              type="button"
              onClick={handleCreateBoard}
              className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreatingBoard(false); setNewBoardName('') }}
              className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingBoard(true)}
            className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            title="Create new board"
          >
            <Plus size={14} className="text-zinc-400" />
          </button>
        )}
        {boardSwitcherOpen && (
          <BoardSwitcher
            boards={boards}
            currentBoard={currentBoard}
            starredBoards={starredBoards}
            onSelect={(boardId) => { onSwitchBoard(boardId); setBoardSwitcherOpen(false) }}
            onClose={() => setBoardSwitcherOpen(false)}
          />
        )}
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search cards, people, labels..."
          title="Search cards by text. Advanced metadata search also works with meta.field: value"
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
        />
      </div>

      {/* Primary action */}
      <button
        onClick={onCreateCard}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm"
        title="Create a new card"
      >
        <Plus size={16} />
        <span>New Card</span>
      </button>

      {/* Filters Toggle */}
      <button
        type="button"
        onClick={() => setFiltersOpen(open => !open)}
        className={`flex items-center gap-1.5 px-2 py-1.5 text-sm border rounded-md transition-colors ${
          filtersOpen || activeFilterCount > 0
            ? 'text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30'
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700'
        }`}
        title="Show or hide filters"
      >
        <SlidersHorizontal size={14} />
        <span>{activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}</span>
      </button>

      {/* Priority Filter */}
      {filtersOpen && cardSettings.showPriorityBadges && (
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
          className={selectClassName}
        >
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {/* Assignee Filter */}
      {filtersOpen && cardSettings.showAssignee && (
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className={selectClassName}
        >
          <option value="all">All Assignees</option>
          <option value="unassigned">Unassigned</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}

      {/* Label Filter */}
      {filtersOpen && cardSettings.showLabels && (
        <div className="relative" ref={labelDropdownRef}>
          <button
            type="button"
            onClick={() => setLabelDropdownOpen(!labelDropdownOpen)}
            className={`flex items-center gap-1.5 text-sm bg-white dark:bg-zinc-800 border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 transition-colors ${
              labelFilter.length > 0
                ? 'border-blue-500 dark:border-blue-400'
                : 'border-zinc-200 dark:border-zinc-600'
            }`}
          >
            <Tag size={14} className="text-zinc-400 shrink-0" />
            <span className="max-w-[100px] truncate">
              {labelFilter.length === 0
                ? 'All Labels'
                : labelFilter.length === 1
                ? labelFilter[0]
                : `${labelFilter.length} Labels`}
            </span>
            <ChevronDown size={14} className={`text-zinc-400 transition-transform ${labelDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {labelDropdownOpen && (
            <LabelPicker
              labels={labels}
              labelDefs={labelDefs}
              selected={labelFilter}
              onChange={setLabelFilter}
              showAllOption
            />
          )}
        </div>
      )}

      {/* Due Date Filter */}
      {filtersOpen && cardSettings.showDueDate && (
        <select
          value={dueDateFilter}
          onChange={(e) => setDueDateFilter(e.target.value as DueDateFilter)}
          className={selectClassName}
        >
          {dueDateOptions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}

      {/* Clear Filters Button */}
      {filtersActive && (
        <button
          onClick={clearAllFilters}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          title="Clear all filters"
        >
          <X size={14} />
          <span>Clear</span>
        </button>
      )}

      {/* Saved Views */}
      <div className="relative" ref={viewsDropdownRef}>
        <button
          type="button"
          onClick={() => setViewsDropdownOpen(!viewsDropdownOpen)}
          className={`flex items-center gap-1.5 px-2 py-1.5 text-sm border rounded-md transition-colors ${
            savedViews.length > 0
              ? 'text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700'
          }`}
          title="Saved views"
        >
          <BookmarkPlus size={14} />
          <span>Views{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</span>
        </button>
        {viewsDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 min-w-[220px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg z-50 py-1">
            {savedViews.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">Saved views</div>
                {savedViews.map(view => (
                  <div key={view.id} className="flex items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => { applyView(view); setViewsDropdownOpen(false) }}
                      className="flex-1 text-sm text-left py-1.5 px-1 text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 truncate transition-colors"
                    >
                      {view.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeView(view.id)}
                      className="p-1 text-zinc-400 hover:text-red-500 transition-colors shrink-0"
                      title="Remove view"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className="border-t border-zinc-200 dark:border-zinc-600 my-1" />
              </>
            )}
            {savingView ? (
              <div className="px-3 py-1.5 flex items-center gap-1">
                <input
                  ref={newViewInputRef}
                  type="text"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveView()
                    if (e.key === 'Escape') { setSavingView(false); setNewViewName('') }
                  }}
                  placeholder="View name..."
                  className="flex-1 px-2 py-1 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                />
                <button
                  type="button"
                  onClick={handleSaveView}
                  className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setSavingView(false); setNewViewName('') }}
                  className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSavingView(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-blue-600 dark:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <BookmarkPlus size={14} />
                <span>Save current filters</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add List */}
      <button
        onClick={onAddColumn}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        title="Add new list"
      >
        <Plus size={16} />
        <span>Add List</span>
      </button>

      {/* Keyboard shortcuts help */}
      {onOpenShortcutHelp && (
        <button
          type="button"
          onClick={onOpenShortcutHelp}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard size={16} />
        </button>
      )}

      {/* Layout Toggle — promoted from board menu */}
      <button
        type="button"
        onClick={toggleLayout}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        title={layout === 'horizontal' ? 'Switch to row layout' : 'Switch to column layout'}
      >
        {layout === 'horizontal' ? <Rows size={16} /> : <Columns size={16} />}
      </button>

      {/* Board Menu — theme, settings, logs */}
      <div className="relative" ref={boardMenuRef}>
        <button
          type="button"
          onClick={() => setBoardMenuOpen(!boardMenuOpen)}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          title="Board options"
        >
          <MoreHorizontal size={16} />
        </button>
        {boardMenuOpen && (
          <div className="absolute top-full right-0 mt-1 min-w-[200px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg z-50 py-1">
            <button
              type="button"
              onClick={() => { onToggleTheme(); setBoardMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
            >
              {isDarkMode ? <Sun size={14} className="shrink-0 text-zinc-400" /> : <Moon size={14} className="shrink-0 text-zinc-400" />}
              <span>{isDarkMode ? 'Light Theme' : 'Dark Theme'}</span>
            </button>
            <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />
            <button
              type="button"
              onClick={() => { onOpenSettings(); setBoardMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
            >
              <Settings size={14} className="shrink-0 text-zinc-400" />
              <span>Settings</span>
            </button>
            {onOpenBoardLogs && (
              <>
                <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />
                <button
                  type="button"
                  onClick={() => { onOpenBoardLogs(); setBoardMenuOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${boardLogsOpen ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-900 dark:text-zinc-100'}`}
                >
                  <ScrollText size={14} className={`shrink-0 ${boardLogsOpen ? 'text-blue-500' : 'text-zinc-400'}`} />
                  <span>Board Logs</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Board Actions Dropdown — always rightmost */}
      {boardActionEntries.length > 0 && onTriggerBoardAction && (
        <div className="relative ml-auto" ref={actionsDropdownRef}>
          <button
            type="button"
            onClick={() => setActionsDropdownOpen(!actionsDropdownOpen)}
            className="flex items-center gap-1.5 px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
            title="Board actions"
          >
            <Zap size={14} className="text-amber-500" />
            <span>Actions</span>
            <ChevronDown size={14} className={`text-zinc-400 transition-transform ${actionsDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {actionsDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 min-w-[180px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg z-50 py-1">
              {boardActionEntries.map(([key, title]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setActionsDropdownOpen(false)
                    onTriggerBoardAction(currentBoard, key)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
                >
                  <Zap size={12} className="text-amber-500 shrink-0" />
                  <span className="truncate">{title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    {filtersActive && (
      <div className="flex flex-wrap gap-1.5 px-4 pb-2">
        {searchQuery && (
          <FilterChip label={`Search: "${searchQuery}"`} onRemove={() => setSearchQuery('')} />
        )}
        {priorityFilter !== 'all' && (
          <FilterChip label={`Priority: ${priorities.find(p => p.value === priorityFilter)?.label ?? priorityFilter}`} onRemove={() => setPriorityFilter('all')} />
        )}
        {assigneeFilter !== 'all' && (
          <FilterChip label={`Assignee: ${assigneeFilter === 'unassigned' ? 'Unassigned' : assigneeFilter}`} onRemove={() => setAssigneeFilter('all')} />
        )}
        {labelFilter.map(label => (
          <FilterChip key={label} label={`Label: ${label}`} onRemove={() => setLabelFilter(labelFilter.filter(l => l !== label))} />
        ))}
        {dueDateFilter !== 'all' && (
          <FilterChip label={`Due: ${dueDateOptions.find(d => d.value === dueDateFilter)?.label ?? dueDateFilter}`} onRemove={() => setDueDateFilter('all')} />
        )}
      </div>
    )}
    </div>
  )
}

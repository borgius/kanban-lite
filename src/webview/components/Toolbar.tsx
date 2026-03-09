import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, Columns, Rows, Settings, Plus, Moon, Sun, ChevronDown, Check, ScrollText, Tag, Zap } from 'lucide-react'
import { useStore, type DueDateFilter } from '../store'
import { LabelPicker } from './LabelPicker'
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

export function Toolbar({ onOpenSettings, onAddColumn, onToggleTheme, onSwitchBoard, onCreateBoard, onOpenBoardLogs, boardLogsOpen, onTriggerBoardAction }: { onOpenSettings: () => void; onAddColumn: () => void; onToggleTheme: () => void; onSwitchBoard: (boardId: string) => void; onCreateBoard: (name: string) => void; onOpenBoardLogs?: () => void; boardLogsOpen?: boolean; onTriggerBoardAction?: (boardId: string, actionKey: string) => void }) {
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

  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false)
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const newBoardInputRef = useRef<HTMLInputElement>(null)

  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)

  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false)
  const actionsDropdownRef = useRef<HTMLDivElement>(null)

  const currentBoardActions = useMemo(() => boards.find(b => b.id === currentBoard)?.actions ?? {}, [boards, currentBoard])
  const boardActionEntries = useMemo(() => Object.entries(currentBoardActions), [currentBoardActions])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setBoardDropdownOpen(false)
        setCreatingBoard(false)
        setNewBoardName('')
      }
    }
    if (boardDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [boardDropdownOpen])

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
    if (creatingBoard && newBoardInputRef.current) {
      newBoardInputRef.current.focus()
    }
  }, [creatingBoard])

  const currentBoardName = boards.find(b => b.id === currentBoard)?.name || currentBoard

  const handleCreateBoard = () => {
    const name = newBoardName.trim()
    if (!name) return
    onCreateBoard(name)
    setNewBoardName('')
    setCreatingBoard(false)
    setBoardDropdownOpen(false)
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 flex-wrap">
      {/* Board Selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setBoardDropdownOpen(!boardDropdownOpen)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
        >
          <span className="max-w-[120px] truncate">{currentBoardName}</span>
          <ChevronDown size={14} className={`text-zinc-400 transition-transform ${boardDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        {boardDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 min-w-[180px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg z-50 py-1">
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onSwitchBoard(b.id)
                  setBoardDropdownOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
              >
                <Check size={14} className={b.id === currentBoard ? 'text-blue-500' : 'invisible'} />
                <span className="truncate">{b.name}</span>
              </button>
            ))}
            <div className="border-t border-zinc-200 dark:border-zinc-600 my-1" />
            {creatingBoard ? (
              <div className="px-3 py-1.5">
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
                  className="w-full px-2 py-1 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreatingBoard(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-blue-600 dark:text-blue-400 transition-colors"
              >
                <Plus size={14} />
                <span>New Board</span>
              </button>
            )}
          </div>
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
          placeholder="Search... (meta.field: value)"
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
        />
      </div>

      {/* Priority Filter */}
      {cardSettings.showPriorityBadges && (
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
      {cardSettings.showAssignee && (
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
      {cardSettings.showLabels && (
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
      {cardSettings.showDueDate && (
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

      {/* Add List */}
      <button
        onClick={onAddColumn}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        title="Add new list"
      >
        <Plus size={16} />
        <span>Add List</span>
      </button>

      {/* Layout Toggle */}
      <button
        onClick={toggleLayout}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        title={layout === 'horizontal' ? 'Switch to vertical layout' : 'Switch to horizontal layout'}
      >
        {layout === 'horizontal' ? <Rows size={16} /> : <Columns size={16} />}
      </button>

      {/* Theme Toggle */}
      <button
        onClick={onToggleTheme}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        title={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
        title="Open settings"
      >
        <Settings size={16} />
      </button>

      {/* Board Actions Dropdown */}
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
      {/* Board Logs */}
      {onOpenBoardLogs && (
        <button
          onClick={onOpenBoardLogs}
          className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-md transition-colors ${
            boardLogsOpen
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
          title="Board logs"
        >
          <ScrollText size={16} />
        </button>
      )}
    </div>
  )
}

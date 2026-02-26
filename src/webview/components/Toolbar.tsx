import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, Columns, Rows, Settings, Plus, Moon, Sun, ChevronDown, Check } from 'lucide-react'
import { useStore, type DueDateFilter } from '../store'
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

export function Toolbar({ onOpenSettings, onAddColumn, onToggleTheme, onSwitchBoard, onCreateBoard }: { onOpenSettings: () => void; onAddColumn: () => void; onToggleTheme: () => void; onSwitchBoard: (boardId: string) => void; onCreateBoard: (name: string) => void }) {
  const {
    searchQuery,
    setSearchQuery,
    priorityFilter,
    setPriorityFilter,
    assigneeFilter,
    setAssigneeFilter,
    labelFilter,
    setLabelFilter,
    dueDateFilter,
    setDueDateFilter,
    clearAllFilters,
    getUniqueAssignees,
    getUniqueLabels,
    hasActiveFilters,
    layout,
    toggleLayout,
    isDarkMode,
    cardSettings,
    boards,
    currentBoard
  } = useStore()

  const labelDefs = useStore(s => s.labelDefs)

  const assignees = getUniqueAssignees()
  const labels = getUniqueLabels()
  const filtersActive = hasActiveFilters()

  const groupedLabels = useMemo(() => {
    const groups: Record<string, string[]> = {}
    labels.forEach(label => {
      const def = labelDefs[label]
      const group = def?.group || 'Other'
      if (!groups[group]) groups[group] = []
      groups[group].push(label)
    })
    return groups
  }, [labels, labelDefs])

  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false)
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const newBoardInputRef = useRef<HTMLInputElement>(null)

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
      <select
        value={labelFilter}
        onChange={(e) => setLabelFilter(e.target.value)}
        className={selectClassName}
      >
        <option value="all">All Labels</option>
        {Object.entries(groupedLabels).map(([group, groupLabels]) => (
          <optgroup key={group} label={group}>
            <option value={`group:${group}`}>All {group}</option>
            {groupLabels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </optgroup>
        ))}
      </select>
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

      {/* Keyboard hint */}
      <div className="ml-auto text-xs text-zinc-400">
        Press <kbd className="px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded">n</kbd> to add
      </div>
    </div>
  )
}

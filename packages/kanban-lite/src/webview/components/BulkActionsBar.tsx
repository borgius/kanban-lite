import { useState, useRef, useEffect, useMemo } from 'react'
import { X, ArrowRight, Tag, Trash2, User, Signal, ChevronDown, Check, Minus } from 'lucide-react'
import { useStore } from '../store'
import type { Priority, KanbanColumn } from '../../shared/types'

const priorities: Priority[] = ['critical', 'high', 'medium', 'low']
const priorityLabels: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}
const priorityDots: Record<Priority, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

interface BulkActionsBarProps {
  selectedCount: number
  onClearSelection: () => void
  onMoveToColumn: (columnId: string) => void
  onSetPriority: (priority: Priority) => void
  onSetAssignee: (assignee: string | null) => void
  onApplyLabels: (toAdd: string[], toRemove: string[]) => void
  onDelete: () => void
}

type OpenMenu = null | 'moveTo' | 'priority' | 'assignee' | 'labels'

export function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onMoveToColumn,
  onSetPriority,
  onSetAssignee,
  onApplyLabels,
  onDelete
}: BulkActionsBarProps) {
  const columns = useStore(s => s.columns)
  const cards = useStore(s => s.cards)
  const labelDefs = useStore(s => s.labelDefs)
  const selectedCardIds = useStore(s => s.selectedCardIds)

  const assignees = useMemo(() => {
    const s = new Set<string>()
    cards.forEach(c => { if (c.assignee) s.add(c.assignee) })
    return Array.from(s).sort()
  }, [cards])

  const allLabels = useMemo(() => {
    const s = new Set<string>()
    cards.forEach(c => c.labels.forEach(l => s.add(l)))
    return Array.from(s).sort()
  }, [cards])

  const selectedCards = useMemo(
    () => cards.filter(c => selectedCardIds.includes(c.id)),
    [cards, selectedCardIds]
  )

  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleMenu = (menu: OpenMenu) => {
    if (openMenu === menu) {
      setOpenMenu(null)
    } else {
      setOpenMenu(menu)
    }
  }

  return (
    <div
      ref={barRef}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg shadow-xl px-3 py-2"
    >
      {/* Count + clear */}
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
        {selectedCount} selected
      </span>
      <button
        type="button"
        onClick={onClearSelection}
        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        title="Clear selection"
      >
        <X size={14} className="text-zinc-500" />
      </button>

      <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600" />

      {/* Move to */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu('moveTo')}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-200"
        >
          <ArrowRight size={14} />
          Move to
          <ChevronDown size={12} />
        </button>
        {openMenu === 'moveTo' && (
          <DropdownMenu>
            {columns.map((col: KanbanColumn) => (
              <button
                key={col.id}
                type="button"
                onClick={() => { onMoveToColumn(col.id); setOpenMenu(null) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                {col.name}
              </button>
            ))}
          </DropdownMenu>
        )}
      </div>

      {/* Priority */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu('priority')}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-200"
        >
          <Signal size={14} />
          Priority
          <ChevronDown size={12} />
        </button>
        {openMenu === 'priority' && (
          <DropdownMenu>
            {priorities.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { onSetPriority(p); setOpenMenu(null) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${priorityDots[p]}`} />
                {priorityLabels[p]}
              </button>
            ))}
          </DropdownMenu>
        )}
      </div>

      {/* Assignee */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu('assignee')}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-200"
        >
          <User size={14} />
          Assign
          <ChevronDown size={12} />
        </button>
        {openMenu === 'assignee' && (
          <DropdownMenu>
            <button
              type="button"
              onClick={() => { onSetAssignee(null); setOpenMenu(null) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors italic"
            >
              Unassign
            </button>
            {assignees.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => { onSetAssignee(a); setOpenMenu(null) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold bg-zinc-200 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300">
                  {a.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </span>
                {a}
              </button>
            ))}
          </DropdownMenu>
        )}
      </div>

      {/* Labels */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu('labels')}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-200"
        >
          <Tag size={14} />
          Labels
          <ChevronDown size={12} />
        </button>
        {openMenu === 'labels' && (
          <LabelPickerWithApply
            allLabels={allLabels}
            labelDefs={labelDefs}
            selectedCards={selectedCards}
            onApply={(toAdd, toRemove) => { onApplyLabels(toAdd, toRemove); setOpenMenu(null) }}
          />
        )}
      </div>

      <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600" />

      {/* Delete */}
      <button
        type="button"
        onClick={() => { onDelete(); }}
        className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-red-600 dark:text-red-400"
      >
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  )
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-full mb-1 left-0 z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg py-1 min-w-[160px] max-h-64 overflow-y-auto">
      {children}
    </div>
  )
}

type LabelInitialState = 'all' | 'some' | 'none'

/** Wraps label selection with tri-state pending state + Apply button for bulk actions */
function LabelPickerWithApply({ allLabels, labelDefs, selectedCards, onApply }: {
  allLabels: string[]
  labelDefs: Record<string, import('../../shared/types').LabelDefinition>
  selectedCards: import('../../shared/types').Card[]
  onApply: (toAdd: string[], toRemove: string[]) => void
}) {
  const [pending, setPending] = useState<Map<string, 'add' | 'remove'>>(new Map())
  const [search, setSearch] = useState('')

  /** 'all' = every selected card has it, 'some' = partial, 'none' = no card has it */
  const initialStates = useMemo((): Map<string, LabelInitialState> => {
    const map = new Map<string, LabelInitialState>()
    if (selectedCards.length === 0) return map
    for (const label of allLabels) {
      const count = selectedCards.filter(c => c.labels.includes(label)).length
      map.set(label, count === 0 ? 'none' : count === selectedCards.length ? 'all' : 'some')
    }
    return map
  }, [allLabels, selectedCards])

  const getEffective = (label: string): 'checked' | 'unchecked' | 'indeterminate' => {
    const change = pending.get(label)
    if (change === 'add') return 'checked'
    if (change === 'remove') return 'unchecked'
    const initial = initialStates.get(label) ?? 'none'
    return initial === 'all' ? 'checked' : initial === 'some' ? 'indeterminate' : 'unchecked'
  }

  const handleToggle = (label: string) => {
    const initial = initialStates.get(label) ?? 'none'
    const effective = getEffective(label)
    const next = new Map(pending)
    if (effective === 'unchecked' || effective === 'indeterminate') {
      next.set(label, 'add')
    } else if (initial === 'all') {
      // was fully checked — mark for removal
      if (pending.get(label) === 'remove') next.delete(label)
      else next.set(label, 'remove')
    } else {
      // was 'none'/'some' with pending=add — cancel the add
      next.delete(label)
    }
    setPending(next)
  }

  const filtered = useMemo(() => {
    if (!search) return allLabels
    const q = search.toLowerCase()
    return allLabels.filter(l => l.toLowerCase().includes(q))
  }, [allLabels, search])

  const toAdd = Array.from(pending.entries()).filter(([, v]) => v === 'add').map(([k]) => k)
  const toRemove = Array.from(pending.entries()).filter(([, v]) => v === 'remove').map(([k]) => k)
  const hasChanges = toAdd.length > 0 || toRemove.length > 0

  const applyLabel =
    toAdd.length > 0 && toRemove.length > 0
      ? `Apply changes (+${toAdd.length} −${toRemove.length})`
      : toAdd.length > 0
        ? `Add ${toAdd.length} label${toAdd.length !== 1 ? 's' : ''}`
        : `Remove ${toRemove.length} label${toRemove.length !== 1 ? 's' : ''}`

  return (
    <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[200px]">
      <div className="max-h-72 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg py-1">
        <div className="px-2 pb-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter labels..."
            autoFocus
            className="w-full px-2 py-1 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
          />
        </div>
        {filtered.map((l) => {
          const def = labelDefs[l]
          const effective = getEffective(l)
          return (
            <button
              key={l}
              type="button"
              onClick={() => handleToggle(l)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                effective === 'checked'
                  ? 'border-blue-500 bg-blue-500'
                  : effective === 'indeterminate'
                    ? 'border-zinc-400 bg-zinc-200 dark:border-zinc-400 dark:bg-zinc-600'
                    : 'border-zinc-300 dark:border-zinc-500'
              }`}>
                {effective === 'checked' && <Check size={10} className="text-white" />}
                {effective === 'indeterminate' && <Minus size={10} className="text-zinc-600 dark:text-zinc-300" />}
              </div>
              {def?.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: def.color }}
                />
              )}
              <span className="truncate">{l}</span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-zinc-400 dark:text-zinc-500">No labels found</div>
        )}
      </div>
      {hasChanges && (
        <div className="bg-white dark:bg-zinc-800 border border-t-0 border-zinc-200 dark:border-zinc-600 rounded-b-md shadow-lg px-1 py-1">
          <button
            type="button"
            onClick={() => onApply(toAdd, toRemove)}
            className="flex items-center justify-center gap-1 w-full px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
          >
            {applyLabel}
          </button>
        </div>
      )}
    </div>
  )
}

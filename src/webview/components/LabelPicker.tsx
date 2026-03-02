import { useState, useMemo } from 'react'
import { Check } from 'lucide-react'
import type { LabelDefinition } from '../../shared/types'

interface LabelPickerProps {
  /** All available labels */
  labels: string[]
  /** Label definitions (for colors and groups) */
  labelDefs: Record<string, LabelDefinition>
  /** Currently selected labels */
  selected: string[]
  /** Called when selection changes */
  onChange: (selected: string[]) => void
  /** Whether to show an "All Labels" option that clears selection */
  showAllOption?: boolean
  /** Position the dropdown above or below the trigger */
  position?: 'above' | 'below'
}

export function LabelPicker({
  labels,
  labelDefs,
  selected,
  onChange,
  showAllOption = false,
  position = 'below'
}: LabelPickerProps) {
  const [search, setSearch] = useState('')

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

  const filteredGroupedLabels = useMemo(() => {
    if (!search) return groupedLabels
    const q = search.toLowerCase()
    const result: Record<string, string[]> = {}
    Object.entries(groupedLabels).forEach(([group, groupLabels]) => {
      const matched = groupLabels.filter(l => l.toLowerCase().includes(q))
      if (matched.length > 0) result[group] = matched
    })
    return result
  }, [groupedLabels, search])

  const toggle = (label: string) => {
    if (selected.includes(label)) {
      onChange(selected.filter(x => x !== label))
    } else {
      onChange([...selected, label])
    }
  }

  const positionClass = position === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'

  return (
    <div className={`absolute ${positionClass} left-0 min-w-[200px] max-h-72 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-lg z-50 py-1`}>
      {/* Search */}
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
      {/* All Labels option */}
      {showAllOption && !search && (
        <button
          type="button"
          onClick={() => onChange([])}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${
            selected.length === 0 ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-zinc-900 dark:text-zinc-100'
          }`}
        >
          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
            selected.length === 0 ? 'border-blue-500 bg-blue-500' : 'border-zinc-300 dark:border-zinc-500'
          }`}>
            {selected.length === 0 && <Check size={10} className="text-white" />}
          </div>
          <span>All Labels</span>
        </button>
      )}
      {/* Grouped labels */}
      {Object.entries(filteredGroupedLabels).map(([group, groupLabels]) => (
        <div key={group}>
          {Object.keys(filteredGroupedLabels).length > 1 && (
            <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">
              {group}
            </div>
          )}
          {groupLabels.map((l) => {
            const def = labelDefs[l]
            const checked = selected.includes(l)
            return (
              <button
                key={l}
                type="button"
                onClick={() => toggle(l)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors"
              >
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                  checked ? 'border-blue-500 bg-blue-500' : 'border-zinc-300 dark:border-zinc-500'
                }`}>
                  {checked && <Check size={10} className="text-white" />}
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
        </div>
      ))}
      {Object.keys(filteredGroupedLabels).length === 0 && (
        <div className="px-3 py-2 text-sm text-zinc-400 dark:text-zinc-500">No labels found</div>
      )}
    </div>
  )
}

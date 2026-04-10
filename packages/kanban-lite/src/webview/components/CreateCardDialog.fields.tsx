import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { isReservedChecklistLabel } from '../../sdk/modules/checklist'
import { cn } from '../lib/utils'
import { useStore } from '../store'

interface DropdownProps {
  value: string
  options: { value: string; label: string; dot?: string; dotColor?: string }[]
  onChange: (value: string) => void
  className?: string
}

export function Dropdown({ value, options, onChange, className }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const current = options.find(o => o.value === value)

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded transition-colors"
        style={{
          color: 'var(--vscode-foreground)',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {current?.dot && <span className={cn('w-2 h-2 rounded-full shrink-0', current.dot)} />}
        {!current?.dot && current?.dotColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: current.dotColor }} />}
        <span>{current?.label}</span>
        <ChevronDown size={12} style={{ color: 'var(--vscode-descriptionForeground)' }} className="ml-0.5" />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            {options.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                style={{
                  color: 'var(--vscode-dropdown-foreground)',
                  background: option.value === value ? 'var(--vscode-list-activeSelectionBackground)' : undefined,
                }}
                onMouseEnter={e => {
                  if (option.value !== value) e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'
                }}
                onMouseLeave={e => {
                  if (option.value !== value) e.currentTarget.style.background = 'transparent'
                }}
              >
                {option.dot && <span className={cn('w-2 h-2 rounded-full shrink-0', option.dot)} />}
                {!option.dot && option.dotColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: option.dotColor }} />}
                <span className="flex-1 text-left">{option.label}</span>
                {option.value === value && <Check size={12} style={{ color: 'var(--vscode-focusBorder)' }} className="shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function AssigneeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cards = useStore(s => s.cards)

  const existingAssignees = useMemo(() => {
    const assignees = new Set<string>()
    cards.forEach(f => { if (f.assignee) assignees.add(f.assignee) })
    return Array.from(assignees).sort()
  }, [cards])

  const suggestions = useMemo(() => {
    if (!value.trim()) return existingAssignees
    return existingAssignees.filter(a => a.toLowerCase().includes(value.toLowerCase()) && a !== value)
  }, [value, existingAssignees])

  const showSuggestions = isFocused && suggestions.length > 0

  const initials = value.trim()
    ? value.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : null

  return (
    <div ref={containerRef} className="relative flex-1">
      <div
        className="flex items-center gap-2 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {initials && (
          <span
            className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
            style={{
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
            }}
          >{initials}</span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          placeholder="No assignee"
          className="flex-1 bg-transparent border-none outline-none text-xs"
          style={{ color: value ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
        />
      </div>
      {showSuggestions && (
        <div
          className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg py-1 max-h-[160px] overflow-auto min-w-[180px]"
          style={{
            background: 'var(--vscode-dropdown-background)',
            border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
          }}
        >
          {suggestions.map(assignee => (
            <button
              key={assignee}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(assignee) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--vscode-dropdown-foreground)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span
                className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                style={{
                  background: 'var(--vscode-badge-background)',
                  color: 'var(--vscode-badge-foreground)',
                }}
              >{assignee.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)}</span>
              <span>{assignee}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function LabelInput({ labels, onChange }: { labels: string[]; onChange: (labels: string[]) => void }) {
  const [newLabel, setNewLabel] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cards = useStore(s => s.cards)
  const labelDefs = useStore(s => s.labelDefs)

  const existingLabels = useMemo(() => {
    const labelSet = new Set<string>()
    cards.forEach((card) => {
      card.labels.forEach((label) => {
        if (!isReservedChecklistLabel(label)) {
          labelSet.add(label)
        }
      })
    })
    return Array.from(labelSet).sort()
  }, [cards])

  const suggestions = useMemo(() => {
    const available = existingLabels.filter(l => !labels.includes(l))
    if (!newLabel.trim()) return available
    return available.filter(l => l.toLowerCase().includes(newLabel.toLowerCase()))
  }, [newLabel, existingLabels, labels])

  const showSuggestions = isFocused && suggestions.length > 0

  const addLabel = (label?: string) => {
    const l = (label || newLabel).trim()
    if (l && !labels.includes(l) && !isReservedChecklistLabel(l)) {
      onChange([...labels, l])
    }
    setNewLabel('')
  }

  return (
    <div className="relative flex-1">
      <div
        className="flex items-center gap-1.5 flex-wrap cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {labels.map(label => {
          const def = labelDefs[label]
          return (
            <span
              key={label}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded"
              style={def ? { backgroundColor: `${def.color}20`, color: def.color } : {
                background: 'var(--vscode-badge-background)',
                color: 'var(--vscode-badge-foreground)',
              }}
            >
              {label}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(labels.filter(l => l !== label)) }}
                className="hover:text-red-500 transition-colors"
              >
                <X size={9} />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addLabel() }
            if (e.key === 'Backspace' && !newLabel && labels.length > 0) {
              onChange(labels.slice(0, -1))
            }
            if (e.key === 'Escape') { setNewLabel(''); inputRef.current?.blur() }
          }}
          placeholder={labels.length === 0 ? 'Add labels...' : ''}
          className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-xs"
          style={{ color: 'var(--vscode-foreground)' }}
        />
      </div>
      {showSuggestions && (
        <div
          className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg py-1 max-h-[160px] overflow-auto min-w-[180px]"
          style={{
            background: 'var(--vscode-dropdown-background)',
            border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
          }}
        >
          {suggestions.map(label => {
            const def = labelDefs[label]
            return (
              <button
                key={label}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addLabel(label) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                style={{ color: 'var(--vscode-dropdown-foreground)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span
                  className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded"
                  style={def ? { backgroundColor: `${def.color}20`, color: def.color } : {
                    background: 'var(--vscode-badge-background)',
                    color: 'var(--vscode-badge-foreground)',
                  }}
                >{label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ActionInput({ actions, onChange }: { actions: string[]; onChange: (actions: string[]) => void }) {
  const [newAction, setNewAction] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addAction = (action?: string) => {
    const a = (action || newAction).trim()
    if (a && !actions.includes(a)) {
      onChange([...actions, a])
    }
    setNewAction('')
  }

  return (
    <div className="relative flex-1">
      <label className="flex items-center gap-1.5 flex-wrap cursor-text">
        {actions.map(action => (
          <span
            key={action}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded"
            style={{
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
            }}
          >
            {action}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(actions.filter(a => a !== action)) }}
              className="hover:text-red-500 transition-colors"
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={newAction}
          onChange={(e) => setNewAction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAction() }
            if (e.key === 'Backspace' && !newAction && actions.length > 0) {
              onChange(actions.slice(0, -1))
            }
            if (e.key === 'Escape') { setNewAction(''); inputRef.current?.blur() }
          }}
          placeholder={actions.length === 0 ? 'Add actions...' : ''}
          className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-xs"
          style={{ color: 'var(--vscode-foreground)' }}
        />
      </label>
    </div>
  )
}

export function PropertyRow({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-[5px] transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="flex items-center gap-2 w-[90px] shrink-0">
        <span style={{ color: 'var(--vscode-descriptionForeground)' }}>{icon}</span>
        <span className="text-[11px]" style={{ color: 'var(--vscode-descriptionForeground)' }}>{label}</span>
      </div>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}

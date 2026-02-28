import { useState, useEffect, useMemo } from 'react'
import { X, ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react'
import type { CardDisplaySettings, Priority, CardStatus, WorkspaceInfo, LabelDefinition } from '../../shared/types'
import { LABEL_PRESET_COLORS } from '../../shared/types'
import { useStore } from '../store'
import { cn } from '../lib/utils'

const priorityConfig: { value: Priority; label: string; dot: string }[] = [
  { value: 'critical', label: 'Critical', dot: 'bg-red-500' },
  { value: 'high', label: 'High', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dot: 'bg-green-500' }
]

const statusConfig: { value: CardStatus; label: string; dot: string }[] = [
  { value: 'backlog', label: 'Backlog', dot: 'bg-zinc-400' },
  { value: 'todo', label: 'To Do', dot: 'bg-blue-400' },
  { value: 'in-progress', label: 'In Progress', dot: 'bg-amber-400' },
  { value: 'review', label: 'Review', dot: 'bg-purple-400' },
  { value: 'done', label: 'Done', dot: 'bg-emerald-400' }
]

interface SettingsPanelProps {
  isOpen: boolean
  settings: CardDisplaySettings
  workspace?: WorkspaceInfo | null
  onClose: () => void
  onSave: (settings: CardDisplaySettings) => void
  onSetLabel?: (name: string, definition: LabelDefinition) => void
  onRenameLabel?: (oldName: string, newName: string) => void
  onDeleteLabel?: (name: string) => void
}

export function SettingsPanel({ isOpen, settings, workspace, onClose, onSave, onSetLabel, onRenameLabel, onDeleteLabel }: SettingsPanelProps) {
  if (!isOpen) return null
  return <SettingsPanelContent settings={settings} workspace={workspace} onClose={onClose} onSave={onSave} onSetLabel={onSetLabel} onRenameLabel={onRenameLabel} onDeleteLabel={onDeleteLabel} />
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0'
      )}
      style={{
        background: checked
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-badge-background, #6b7280)'
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{
          transform: checked ? 'translateX(18px)' : 'translateX(3px)'
        }}
      />
    </button>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <h3
        className="px-4 pb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--vscode-descriptionForeground)' }}
      >
        {title}
      </h3>
      <div>{children}</div>
    </div>
  )
}

function SettingsToggle({ label, description, checked, onChange }: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors cursor-pointer"
      onClick={() => onChange(!checked)}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--vscode-descriptionForeground)' }}>{description}</div>
        )}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  )
}

function SettingsInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-1.5">
      <div className="text-sm" style={{ color: 'var(--vscode-descriptionForeground)' }}>{label}</div>
      <div
        className="text-xs font-mono truncate max-w-[60%] text-right"
        style={{ color: 'var(--vscode-foreground)', opacity: 0.7 }}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function SettingsDropdown({ label, value, options, onChange }: {
  label: string
  value: string
  options: { value: string; label: string; dot?: string }[]
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const current = options.find(o => o.value === value)

  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded transition-colors"
          style={{ color: 'var(--vscode-foreground)' }}
        >
          {current?.dot && <span className={cn('w-2 h-2 rounded-full shrink-0', current.dot)} />}
          <span>{current?.label}</span>
          <ChevronDown size={12} style={{ color: 'var(--vscode-descriptionForeground)' }} />
        </button>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
            <div
              className="absolute top-full right-0 mt-1 z-20 rounded-lg shadow-lg py-1 min-w-[140px]"
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
                  <span className="flex-1 text-left">{option.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsSlider({ label, description, value, min, max, step, unit, onChange }: {
  label: string
  description?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2 transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--vscode-descriptionForeground)' }}>{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="settings-slider"
          style={{
            background: `linear-gradient(to right, var(--vscode-button-background) ${pct}%, var(--vscode-badge-background, #6b7280) ${pct}%)`,
          }}
        />
        <span
          className="text-xs font-mono w-12 text-right tabular-nums"
          style={{ color: 'var(--vscode-foreground)' }}
        >
          {value}{unit || '%'}
        </span>
      </div>
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [customHex, setCustomHex] = useState('')

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-5 h-5 rounded-full border border-white/20 cursor-pointer shrink-0"
        style={{ backgroundColor: value }}
      />
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg p-2 min-w-[180px]"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {LABEL_PRESET_COLORS.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => { onChange(c.hex); setIsOpen(false) }}
                  className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c.hex,
                    borderColor: value === c.hex ? 'white' : 'transparent'
                  }}
                  title={c.name}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="#hex"
                value={customHex}
                onChange={e => setCustomHex(e.target.value)}
                className="flex-1 px-2 py-1 text-xs rounded"
                style={{
                  background: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border, transparent)',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (/^#[0-9a-fA-F]{6}$/.test(customHex)) {
                    onChange(customHex)
                    setIsOpen(false)
                    setCustomHex('')
                  }
                }}
                className="px-2 py-1 text-xs rounded"
                style={{
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LabelsSection({ onSetLabel, onRenameLabel, onDeleteLabel }: {
  onSetLabel?: (name: string, definition: LabelDefinition) => void
  onRenameLabel?: (oldName: string, newName: string) => void
  onDeleteLabel?: (name: string) => void
}) {
  const labelDefs = useStore(s => s.labelDefs)
  const cards = useStore(s => s.cards)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_PRESET_COLORS[0].hex)
  const [newGroup, setNewGroup] = useState('')
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  // Merge config labels + orphan labels from cards
  const allLabels = useMemo(() => {
    const labels = new Map<string, LabelDefinition | undefined>()
    for (const [name, def] of Object.entries(labelDefs)) {
      labels.set(name, def)
    }
    for (const f of cards) {
      for (const l of f.labels) {
        if (!labels.has(l)) labels.set(l, undefined)
      }
    }
    return labels
  }, [labelDefs, cards])

  // Group labels
  const groupedLabels = useMemo(() => {
    const groups: Record<string, { name: string; def?: LabelDefinition }[]> = {}
    allLabels.forEach((def, name) => {
      const group = def?.group || 'Other'
      if (!groups[group]) groups[group] = []
      groups[group].push({ name, def })
    })
    const sorted: [string, typeof groups[string]][] = Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Other') return 1
      if (b === 'Other') return -1
      return a.localeCompare(b)
    })
    return sorted
  }, [allLabels])

  // Existing group names for autocomplete
  const existingGroups = useMemo(() => {
    const groups = new Set<string>()
    Object.values(labelDefs).forEach(def => {
      if (def.group) groups.add(def.group)
    })
    return Array.from(groups).sort()
  }, [labelDefs])

  const getCardCount = (labelName: string) =>
    cards.filter(f => f.labels.includes(labelName)).length

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    onSetLabel?.(trimmed, { color: newColor, group: newGroup || undefined })
    setNewName('')
    setNewColor(LABEL_PRESET_COLORS[0].hex)
    setNewGroup('')
  }

  const handleRename = (oldName: string) => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== oldName) {
      onRenameLabel?.(oldName, trimmed)
    }
    setRenamingLabel(null)
    setRenameValue('')
  }

  const handleDelete = (name: string) => {
    onDeleteLabel?.(name)
    setConfirmingDelete(null)
  }

  const inputStyle = {
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border, transparent)',
  }

  return (
    <div className="px-4 space-y-3">
      {groupedLabels.map(([group, labels]) => (
        <div key={group}>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
          >
            {group}
          </div>
          <div className="space-y-1">
            {labels.map(({ name, def }) => (
              <div
                key={name}
                className="flex items-center gap-2 px-2 py-1.5 rounded group/label transition-colors"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <ColorPicker
                  value={def?.color || '#6b7280'}
                  onChange={color => onSetLabel?.(name, { ...def, color, group: def?.group })}
                />
                {renamingLabel === name ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(name)
                      if (e.key === 'Escape') { setRenamingLabel(null); setRenameValue('') }
                    }}
                    onBlur={() => handleRename(name)}
                    autoFocus
                    className="flex-1 px-1.5 py-0.5 text-xs rounded min-w-0"
                    style={inputStyle}
                  />
                ) : (
                  <span className="flex-1 text-xs truncate" style={{ color: 'var(--vscode-foreground)' }}>
                    {name}
                  </span>
                )}
                {def?.group && renamingLabel !== name && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                      background: 'var(--vscode-badge-background)',
                      color: 'var(--vscode-badge-foreground)',
                    }}
                  >
                    {def.group}
                  </span>
                )}
                {confirmingDelete === name ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px]" style={{ color: 'var(--vscode-errorForeground, #f44)' }}>
                      {getCardCount(name)} card{getCardCount(name) !== 1 ? 's' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(name)}
                      className="px-1.5 py-0.5 text-[10px] rounded"
                      style={{
                        background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
                        color: 'var(--vscode-errorForeground, #f44)',
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(null)}
                      className="px-1.5 py-0.5 text-[10px] rounded"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/label:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => { setRenamingLabel(name); setRenameValue(name) }}
                      className="p-1 rounded transition-colors"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--vscode-foreground)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--vscode-descriptionForeground)'}
                      title="Rename label"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(name)}
                      className="p-1 rounded transition-colors"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--vscode-errorForeground, #f44)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--vscode-descriptionForeground)'}
                      title="Delete label"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add new label form */}
      <div
        className="rounded-lg p-2 space-y-2"
        style={{
          background: 'var(--vscode-input-background)',
          border: '1px solid var(--vscode-input-border, transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input
            type="text"
            placeholder="New label name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            className="flex-1 px-1.5 py-1 text-xs rounded bg-transparent min-w-0"
            style={{
              color: 'var(--vscode-input-foreground)',
              outline: 'none',
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Group (optional)"
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            list="label-groups"
            className="flex-1 px-1.5 py-1 text-xs rounded"
            style={inputStyle}
          />
          <datalist id="label-groups">
            {existingGroups.map(g => <option key={g} value={g} />)}
          </datalist>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsPanelContent({ settings, workspace, onClose, onSave, onSetLabel, onRenameLabel, onDeleteLabel }: Omit<SettingsPanelProps, 'isOpen'>) {
  const [local, setLocal] = useState<CardDisplaySettings>(settings)
  const [activeTab, setActiveTab] = useState<'general' | 'defaults' | 'labels'>('general')

  useEffect(() => { setLocal(settings) }, [settings])

  const update = (patch: Partial<CardDisplaySettings>) => {
    const next = { ...local, ...patch }
    setLocal(next)
    onSave(next)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative h-full w-1/2 max-w-lg shadow-xl flex flex-col animate-in slide-in-from-right duration-200"
        style={{
          background: 'var(--vscode-editor-background)',
          borderLeft: '1px solid var(--vscode-panel-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          <h2 className="font-medium" style={{ color: 'var(--vscode-foreground)' }}>Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Bar */}
        <div
          className="flex"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          {(['general', 'defaults', 'labels'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-xs font-medium transition-colors relative"
              style={{
                color: activeTab === tab
                  ? 'var(--vscode-foreground)'
                  : 'var(--vscode-descriptionForeground)',
                background: 'transparent',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {activeTab === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ background: 'var(--vscode-button-background)' }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'general' && (
            <>
              {workspace && (
                <>
                  <SettingsSection title="Workspace">
                    <SettingsInfo label="Project Path" value={workspace.projectPath} />
                    <SettingsInfo label="Kanban Directory" value={workspace.kanbanDirectory} />
                    <SettingsInfo label="Server Port" value={String(workspace.port)} />
                    <SettingsInfo label="Config Version" value={String(workspace.configVersion)} />
                  </SettingsSection>
                  <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
                </>
              )}
              <SettingsSection title="Card Display">
                <SettingsToggle
                  label="Show Priority Badges"
                  description="Display priority indicators on card cards"
                  checked={local.showPriorityBadges}
                  onChange={v => update({ showPriorityBadges: v })}
                />
                <SettingsToggle
                  label="Show Assignee"
                  description="Display assigned person on card cards"
                  checked={local.showAssignee}
                  onChange={v => update({ showAssignee: v })}
                />
                <SettingsToggle
                  label="Show Due Date"
                  description="Display due dates on card cards"
                  checked={local.showDueDate}
                  onChange={v => update({ showDueDate: v })}
                />
                <SettingsToggle
                  label="Show Labels"
                  description="Display labels on card cards and in editors"
                  checked={local.showLabels}
                  onChange={v => update({ showLabels: v })}
                />
                <SettingsToggle
                  label="Show Filename"
                  description="Display the source markdown filename on cards"
                  checked={local.showFileName}
                  onChange={v => update({ showFileName: v })}
                />
                <SettingsToggle
                  label="Compact Mode"
                  description="Use compact card layout to show more cards"
                  checked={local.compactMode}
                  onChange={v => update({ compactMode: v })}
                />
                <SettingsToggle
                  label="Show Deleted Column"
                  description="Display the Deleted column to manage soft-deleted cards"
                  checked={local.showDeletedColumn}
                  onChange={v => update({ showDeletedColumn: v })}
                />
              </SettingsSection>
              <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />
              <SettingsSection title="Zoom">
                <SettingsSlider
                  label="Board Zoom"
                  description="Scale text size on the board view"
                  value={local.boardZoom}
                  min={75}
                  max={150}
                  step={5}
                  onChange={v => update({ boardZoom: v })}
                />
                <SettingsSlider
                  label="Card Detail Zoom"
                  description="Scale text size in the card detail panel"
                  value={local.cardZoom}
                  min={75}
                  max={150}
                  step={5}
                  onChange={v => update({ cardZoom: v })}
                />
              </SettingsSection>
            </>
          )}

          {activeTab === 'defaults' && (
            <SettingsSection title="Defaults">
              <SettingsDropdown
                label="Default Priority"
                value={local.defaultPriority}
                options={priorityConfig}
                onChange={v => update({ defaultPriority: v as Priority })}
              />
              <SettingsDropdown
                label="Default Status"
                value={local.defaultStatus}
                options={statusConfig}
                onChange={v => update({ defaultStatus: v as CardStatus })}
              />
            </SettingsSection>
          )}

          {activeTab === 'labels' && (
            <SettingsSection title="Labels">
              <LabelsSection
                onSetLabel={onSetLabel}
                onRenameLabel={onRenameLabel}
                onDeleteLabel={onDeleteLabel}
              />
            </SettingsSection>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2"
          style={{ borderTop: '1px solid var(--vscode-panel-border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Settings are saved automatically and apply to all connected clients.
          </p>
        </div>
      </div>
    </div>
  )
}

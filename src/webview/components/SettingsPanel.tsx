import { useState, useEffect } from 'react'
import { X, ChevronDown } from 'lucide-react'
import type { CardDisplaySettings, Priority, FeatureStatus } from '../../shared/types'
import { cn } from '../lib/utils'

const priorityConfig: { value: Priority; label: string; dot: string }[] = [
  { value: 'critical', label: 'Critical', dot: 'bg-red-500' },
  { value: 'high', label: 'High', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dot: 'bg-green-500' }
]

const statusConfig: { value: FeatureStatus; label: string; dot: string }[] = [
  { value: 'backlog', label: 'Backlog', dot: 'bg-zinc-400' },
  { value: 'todo', label: 'To Do', dot: 'bg-blue-400' },
  { value: 'in-progress', label: 'In Progress', dot: 'bg-amber-400' },
  { value: 'review', label: 'Review', dot: 'bg-purple-400' },
  { value: 'done', label: 'Done', dot: 'bg-emerald-400' }
]

interface SettingsPanelProps {
  isOpen: boolean
  settings: CardDisplaySettings
  onClose: () => void
  onSave: (settings: CardDisplaySettings) => void
}

export function SettingsPanel({ isOpen, settings, onClose, onSave }: SettingsPanelProps) {
  if (!isOpen) return null
  return <SettingsPanelContent settings={settings} onClose={onClose} onSave={onSave} />
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

function SettingsPanelContent({ settings, onClose, onSave }: Omit<SettingsPanelProps, 'isOpen'>) {
  const [local, setLocal] = useState<CardDisplaySettings>(settings)

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

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <SettingsSection title="Card Display">
            <SettingsToggle
              label="Show Priority Badges"
              description="Display priority indicators on feature cards"
              checked={local.showPriorityBadges}
              onChange={v => update({ showPriorityBadges: v })}
            />
            <SettingsToggle
              label="Show Assignee"
              description="Display assigned person on feature cards"
              checked={local.showAssignee}
              onChange={v => update({ showAssignee: v })}
            />
            <SettingsToggle
              label="Show Due Date"
              description="Display due dates on feature cards"
              checked={local.showDueDate}
              onChange={v => update({ showDueDate: v })}
            />
            <SettingsToggle
              label="Show Labels"
              description="Display labels on feature cards and in editors"
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
              description="Use compact card layout to show more features"
              checked={local.compactMode}
              onChange={v => update({ compactMode: v })}
            />
          </SettingsSection>

          <div style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />

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
              onChange={v => update({ defaultStatus: v as FeatureStatus })}
            />
          </SettingsSection>
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

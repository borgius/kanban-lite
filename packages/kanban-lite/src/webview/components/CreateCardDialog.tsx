import { useState, useEffect, useRef, useMemo } from 'react'
import { X, User, Tag, CircleDot, Signal, Calendar, Zap } from 'lucide-react'
import type { CardStatus, Priority } from '../../shared/types'
import { DELETED_STATUS_ID } from '../../shared/types'
import { useStore } from '../store'
import { DatePicker } from './DatePicker'
import { MarkdownEditor } from './MarkdownEditor'
import { DrawerResizeHandle } from './DrawerResizeHandle'
import { ActionInput, AssigneeInput, Dropdown, LabelInput, PropertyRow } from './CreateCardDialog.fields'
import type { CardDisplaySettings } from '../../shared/types'

interface CreateCardDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: { status: CardStatus; priority: Priority; content: string; assignee: string | null; dueDate: string | null; labels: string[]; actions: string[]; metadata?: Record<string, unknown> }) => void
  onSaveSettings: (settings: CardDisplaySettings) => void
  initialStatus?: CardStatus
}

const priorityConfig: { value: Priority; label: string; dot: string }[] = [
  { value: 'critical', label: 'Critical', dot: 'bg-red-500' },
  { value: 'high', label: 'High', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dot: 'bg-green-500' }
]

// Wrapper that unmounts and remounts content when dialog opens to reset state
export function CreateCardDialog({ isOpen, ...props }: CreateCardDialogProps) {
  if (!isOpen) return null
  return <CreateCardDialogContent isOpen={isOpen} {...props} />
}

function CreateCardDialogContent({
  isOpen,
  onClose,
  onCreate,
  onSaveSettings,
  initialStatus
}: CreateCardDialogProps) {
  const cardSettings = useStore(s => s.cardSettings)
  const effectiveDrawerWidth = useStore(s => s.effectiveDrawerWidth)
  const setDrawerWidthPreview = useStore(s => s.setDrawerWidthPreview)
  const clearDrawerWidthPreview = useStore(s => s.clearDrawerWidthPreview)
  const setCardSettings = useStore(s => s.setCardSettings)
  const columns = useStore(s => s.columns)
  const statusOptions = useMemo(
    () => columns.filter(c => c.id !== DELETED_STATUS_ID).map(c => ({ value: c.id, label: c.name, dotColor: c.color })),
    [columns]
  )
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<CardStatus>(initialStatus ?? cardSettings.defaultStatus)
  const [priority, setPriority] = useState<Priority>(cardSettings.defaultPriority)
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [localMetadata, setLocalMetadata] = useState<Record<string, unknown> | undefined>(undefined)
  const [metadataInvalid, setMetadataInvalid] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [])

  const handleSubmit = () => {
    if (metadataInvalid) return
    const desc = description.trim()
    const heading = title.trim()
    const content = heading
      ? `# ${heading}${desc ? `\n\n${desc}` : ''}`
      : desc
    const metadata = localMetadata && Object.keys(localMetadata).length > 0 ? localMetadata : undefined
    onCreate({ status, priority, content, assignee: assignee.trim() || null, dueDate: dueDate || null, labels, actions, metadata })
  }

  const handleSaveAndClose = () => {
    if (metadataInvalid) return
    handleSubmit()
    onClose()
  }

  const handleCancel = () => {
    onClose()
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        handleSaveAndClose()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSaveAndClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  })

  return (
    <div className={`fixed inset-0 z-50 flex ${(cardSettings.panelMode ?? 'drawer') === 'drawer' ? 'justify-end pointer-events-none' : 'items-center justify-center p-4'}`}>
      {(cardSettings.panelMode ?? 'drawer') !== 'drawer' && <div className="absolute inset-0 bg-black/50" onClick={handleCancel} />}
      <div
        className={(cardSettings.panelMode ?? 'drawer') === 'drawer'
          ? 'relative h-full shadow-xl flex flex-col animate-in slide-in-from-right duration-200 pointer-events-auto'
          : 'relative w-full max-w-2xl max-h-[85vh] shadow-xl flex flex-col rounded-xl animate-in zoom-in-95 fade-in duration-200'}
        style={{
          background: 'var(--vscode-editor-background)',
          ...((cardSettings.panelMode ?? 'drawer') === 'drawer'
            ? { width: `${effectiveDrawerWidth}%`, borderLeft: '1px solid var(--vscode-panel-border)' }
            : { border: '1px solid var(--vscode-panel-border)' }),
        }}
        {...((cardSettings.panelMode ?? 'drawer') === 'drawer' ? { 'data-panel-drawer': '' } : {})}
      >
        <DrawerResizeHandle
          panelMode={(cardSettings.panelMode ?? 'drawer') === 'drawer' ? 'drawer' : 'popup'}
          onPreview={setDrawerWidthPreview}
          onCommit={(width) => {
            clearDrawerWidthPreview()
            const next = { ...useStore.getState().cardSettings, drawerWidth: width }
            setCardSettings(next)
            onSaveSettings(next)
          }}
          onCancel={clearDrawerWidthPreview}
        />
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          <div className="flex items-center gap-3">
            <h2 className="font-medium" style={{ color: 'var(--vscode-foreground)' }}>
              Create Card
            </h2>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Metadata */}
        <div
          className="flex flex-col py-0.5"
          style={{
            borderBottom: '1px solid var(--vscode-panel-border)',
          }}
        >
          <PropertyRow label="Status" icon={<CircleDot size={13} />}>
            <Dropdown
              value={status}
              options={statusOptions}
              onChange={(v) => setStatus(v as CardStatus)}
            />
          </PropertyRow>
          {cardSettings.showPriorityBadges && (
            <PropertyRow label="Priority" icon={<Signal size={13} />}>
              <Dropdown
                value={priority}
                options={priorityConfig.map(p => ({ value: p.value, label: p.label, dot: p.dot }))}
                onChange={(v) => setPriority(v as Priority)}
              />
            </PropertyRow>
          )}
          {cardSettings.showAssignee && (
            <PropertyRow label="Assignee" icon={<User size={13} />}>
              <AssigneeInput value={assignee} onChange={setAssignee} />
            </PropertyRow>
          )}
          {cardSettings.showDueDate && (
            <PropertyRow label="Due date" icon={<Calendar size={13} />}>
              <DatePicker value={dueDate} onChange={setDueDate} />
            </PropertyRow>
          )}
          {cardSettings.showLabels && (
          <PropertyRow label="Labels" icon={<Tag size={13} />}>
            <LabelInput labels={labels} onChange={setLabels} />
          </PropertyRow>
          )}
          <PropertyRow label="Actions" icon={<Zap size={13} />}>
            <ActionInput actions={actions} onChange={setActions} />
          </PropertyRow>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <textarea
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title..."
            className="w-full text-lg font-medium bg-transparent border-none outline-none resize-none mb-4"
            style={{
              color: 'var(--vscode-foreground)',
            }}
            rows={1}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = target.scrollHeight + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
              }
            }}
          />
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            placeholder="Add a description..."
            currentMetadata={localMetadata}
            onMetadataChange={(md) => {
              setLocalMetadata(md)
              setMetadataInvalid(false)
            }}
            onMetadataInvalid={() => setMetadataInvalid(true)}
          />
        </div>

        {/* Footer with Cancel / Save buttons */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            borderTop: '1px solid var(--vscode-panel-border)',
            background: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            <kbd
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{ background: 'var(--vscode-keybindingLabel-background, var(--vscode-badge-background))', color: 'var(--vscode-keybindingLabel-foreground, var(--vscode-foreground))', border: '1px solid var(--vscode-keybindingLabel-border, var(--vscode-panel-border))' }}
            >Esc</kbd>{' '}cancel ·{' '}
            <kbd
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{ background: 'var(--vscode-keybindingLabel-background, var(--vscode-badge-background))', color: 'var(--vscode-keybindingLabel-foreground, var(--vscode-foreground))', border: '1px solid var(--vscode-keybindingLabel-border, var(--vscode-panel-border))' }}
            >⌘S</kbd>{' '}save
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
              style={{
                color: 'var(--vscode-foreground)',
                background: 'transparent',
                border: '1px solid var(--vscode-panel-border)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              disabled={metadataInvalid}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
              style={{
                color: 'var(--vscode-button-foreground)',
                background: 'var(--vscode-button-background)',
                opacity: metadataInvalid ? 0.5 : undefined,
                cursor: metadataInvalid ? 'not-allowed' : undefined,
              }}
              onMouseEnter={e => { if (!metadataInvalid) e.currentTarget.style.background = 'var(--vscode-button-hoverBackground)' }}
              onMouseLeave={e => { if (!metadataInvalid) e.currentTarget.style.background = 'var(--vscode-button-background)' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

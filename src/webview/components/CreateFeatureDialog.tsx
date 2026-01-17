import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import type { FeatureStatus, Priority } from '../../shared/types'

interface CreateFeatureDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: { title: string; status: FeatureStatus; priority: Priority; content?: string }) => void
  initialStatus?: FeatureStatus
}

export function CreateFeatureDialog({
  isOpen,
  onClose,
  onCreate,
  initialStatus = 'backlog'
}: CreateFeatureDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<FeatureStatus>(initialStatus)
  const [priority, setPriority] = useState<Priority>('medium')
  const inputRef = useRef<HTMLInputElement>(null)

  const columns = useStore((s) => s.columns)

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setStatus(initialStatus)
      setPriority('medium')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen, initialStatus])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    onCreate({ title: title.trim(), status, priority, content: description.trim() })
    onClose()
  }

  if (!isOpen) return null

  const priorities: Priority[] = ['critical', 'high', 'medium', 'low']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--vscode-editor-background)] rounded-lg shadow-xl w-full max-w-md mx-4 border border-[var(--vscode-panel-border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--vscode-panel-border)]">
          <h2 className="text-lg font-semibold text-[var(--vscode-foreground)]">New Feature</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
              Title
            </label>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter feature title..."
              className="w-full px-3 py-2 text-sm bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)] text-[var(--vscode-input-foreground)]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
              Description <span className="text-[var(--vscode-descriptionForeground)] font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)] text-[var(--vscode-input-foreground)] resize-none"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {columns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => setStatus(col.id as FeatureStatus)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    status === col.id
                      ? 'border-[var(--vscode-focusBorder)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)]'
                      : 'border-[var(--vscode-panel-border)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                  {col.name}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
              Priority
            </label>
            <div className="flex gap-2">
              {priorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`px-3 py-1.5 text-sm rounded-md border capitalize transition-colors ${
                    priority === p
                      ? 'border-[var(--vscode-focusBorder)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)]'
                      : 'border-[var(--vscode-panel-border)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 text-sm font-medium bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded-md hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create Feature
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

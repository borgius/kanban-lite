import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const PRESET_COLORS = [
  '#6b7280', '#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e',
  '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#06b6d4'
]

interface ColumnDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; color: string }) => void
  initial?: { name: string; color: string }
  title: string
}

export function ColumnDialog({ isOpen, onClose, onSave, initial, title }: ColumnDialogProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? '#3b82f6')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? '')
      setColor(initial?.color ?? '#3b82f6')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen, initial])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && name.trim()) {
        onSave({ name: name.trim(), color })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onSave, name, color])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-800 rounded-lg shadow-xl w-full max-w-sm mx-4 border border-zinc-200 dark:border-zinc-600">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          >
            <X size={16} className="text-zinc-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="List name..."
              className="w-full px-3 py-1.5 text-sm bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-zinc-900 dark:border-white scale-110' : 'border-transparent hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                title="Custom color"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { if (name.trim()) onSave({ name: name.trim(), color }) }}
            disabled={!name.trim()}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

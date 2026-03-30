import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ShortcutHelpProps {
  isOpen: boolean
  onClose: () => void
}

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['n'], description: 'Create a new card' },
  { keys: ['?'], description: 'Show / hide this shortcut reference' },
  { keys: ['Ctrl', 'Z'], description: 'Undo last card deletion' },
  { keys: ['Ctrl', '+'], description: 'Increase board zoom' },
  { keys: ['Ctrl', '-'], description: 'Decrease board zoom' },
  { keys: ['Ctrl', 'Shift', '+'], description: 'Increase card detail zoom' },
  { keys: ['Ctrl', 'Shift', '-'], description: 'Decrease card detail zoom' },
  { keys: ['Esc'], description: 'Close dialog / clear selection' },
  { keys: ['Ctrl', 'Enter'], description: 'Save and close card (in create dialog)' },
  { keys: ['Ctrl', 'S'], description: 'Save card (in create dialog)' },
  { keys: ['Enter'], description: 'Add card (in inline quick-add)' },
]

export function ShortcutHelp({ isOpen, onClose }: ShortcutHelpProps) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          <span className="font-semibold text-sm" style={{ color: 'var(--vscode-foreground)' }}>
            Keyboard Shortcuts
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcut list */}
        <div className="overflow-y-auto max-h-[60vh]">
          {SHORTCUTS.map((s) => (
            <div
              key={s.description}
              className="flex items-center justify-between px-5 py-2"
              style={{ borderBottom: '1px solid var(--vscode-panel-border)', opacity: 0.95 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span className="text-sm" style={{ color: 'var(--vscode-foreground)' }}>
                {s.description}
              </span>
              <div className="flex items-center gap-1 shrink-0 ml-4">
                {s.keys.map((k, keyIndex) => (
                  <span key={`${s.description}-${k}`} className="flex items-center gap-1">
                    {keyIndex > 0 && <span className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>+</span>}
                    <kbd
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{
                        background: 'var(--vscode-badge-background)',
                        color: 'var(--vscode-badge-foreground)',
                        border: '1px solid var(--vscode-panel-border)',
                      }}
                    >
                      {k}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div
          className="px-5 py-2 text-xs"
          style={{ borderTop: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-descriptionForeground)' }}
        >
          Press <kbd
            className="inline-flex items-center px-1 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
              border: '1px solid var(--vscode-panel-border)',
            }}
          >?</kbd> or <kbd
            className="inline-flex items-center px-1 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
              border: '1px solid var(--vscode-panel-border)',
            }}
          >Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}

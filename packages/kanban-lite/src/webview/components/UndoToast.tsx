import { useEffect, useState } from 'react'

interface UndoToastProps {
  title?: string
  message: string
  onUndo?: () => void
  onExpire?: () => void
  duration?: number
  index: number
  actionLabel?: string
  persistent?: boolean
  tone?: 'default' | 'info' | 'error'
}

export function UndoToast({
  title,
  message,
  onUndo,
  onExpire,
  duration,
  index,
  actionLabel = 'Undo',
  persistent = false,
  tone = 'default',
}: UndoToastProps) {
  const [progress, setProgress] = useState(100)
  const showProgress = !persistent && typeof duration === 'number' && typeof onExpire === 'function'
  const accentColor = tone === 'error'
    ? 'var(--vscode-errorForeground, #f14c4c)'
    : tone === 'info'
      ? 'var(--vscode-progressBar-background)'
      : undefined

  useEffect(() => {
    if (!showProgress || !duration) {
      setProgress(100)
      return
    }

    const interval = 50
    const step = (interval / duration) * 100
    const timer = setInterval(() => {
      setProgress(prev => {
        const next = prev - step
        if (next <= 0) {
          clearInterval(timer)
          return 0
        }
        return next
      })
    }, interval)

    return () => clearInterval(timer)
  }, [duration, showProgress])

  useEffect(() => {
    if (showProgress && progress <= 0 && onExpire) {
      onExpire()
    }
  }, [progress, onExpire, showProgress])

  return (
    <div
      className="fixed right-4 z-50 flex flex-col min-w-[320px] max-w-[420px] shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-[bottom] duration-200 ease-out"
      style={{
        bottom: `${24 + index * 52}px`,
        background: 'var(--vscode-notifications-background)',
        color: 'var(--vscode-notifications-foreground)',
        border: '1px solid var(--vscode-notifications-border, var(--vscode-widget-border))',
        borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
      }}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {title && <div className="mb-0.5 text-[12px] font-semibold">{title}</div>}
          <span className={`text-[13px] leading-snug ${title ? 'block' : 'truncate'}`}>{message}</span>
        </div>
        {onUndo && (
          <button
            onClick={onUndo}
            className="text-[13px] px-2 py-0.5 shrink-0"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-button-hoverBackground)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--vscode-button-background)'}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {showProgress && (
        <div className="h-[2px] w-full" style={{ background: 'var(--vscode-widget-border)' }}>
          <div
            className="h-full transition-none"
            style={{ width: `${progress}%`, background: 'var(--vscode-progressBar-background)' }}
          />
        </div>
      )}
    </div>
  )
}

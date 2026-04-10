import type { CSSProperties, ComponentType, ReactNode } from 'react'

export const surfaceStyle: CSSProperties = {
  borderColor: 'var(--vscode-panel-border)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
  boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
}

export const heroStyle: CSSProperties = {
  ...surfaceStyle,
  background: 'linear-gradient(135deg, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 94%, transparent))',
}

export const mutedTextStyle: CSSProperties = { color: 'var(--vscode-descriptionForeground)' }
export const bodyTextStyle: CSSProperties = { color: 'var(--vscode-foreground)' }

export const inputStyle: CSSProperties = {
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
  borderRadius: 12,
  padding: '10px 12px',
  fontSize: 13,
  minWidth: 0,
  width: '100%',
}

export function MetaStat({
  icon,
  label,
  value,
}: {
  icon: ComponentType<{ size?: string | number; className?: string }>
  label: string
  value: string
}) {
  const Icon = icon

  return (
    <div
      className="min-w-[120px] rounded-2xl border px-3 py-3"
      style={{
        borderColor: 'color-mix(in srgb, var(--vscode-panel-border) 85%, transparent)',
        background: 'color-mix(in srgb, var(--vscode-editor-background) 60%, transparent)',
      }}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
        <Icon size={14} className="shrink-0" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold leading-none tabular-nums" style={bodyTextStyle}>
        {value}
      </div>
    </div>
  )
}

export function MetaBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'subtle'
}) {
  const style = tone === 'accent'
    ? {
        background: 'var(--vscode-button-background)',
        color: 'var(--vscode-button-foreground)',
      }
    : tone === 'subtle'
      ? {
          background: 'color-mix(in srgb, var(--vscode-badge-background, #6b7280) 55%, transparent)',
          color: 'var(--vscode-descriptionForeground)',
        }
      : {
          background: 'var(--vscode-badge-background)',
          color: 'var(--vscode-badge-foreground)',
        }

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
      style={style}
    >
      {children}
    </span>
  )
}

export function MetaFieldActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-[background-color,color,border-color,transform] hover:-translate-y-px"
      style={{
        borderColor: 'var(--vscode-panel-border)',
        color: danger ? 'var(--vscode-errorForeground, #f87171)' : 'var(--vscode-descriptionForeground)',
        background: 'color-mix(in srgb, var(--vscode-editor-background) 60%, transparent)',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = danger
          ? 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 12%, transparent)'
          : 'var(--vscode-list-hoverBackground)'
        event.currentTarget.style.color = danger
          ? 'var(--vscode-errorForeground, #f87171)'
          : 'var(--vscode-foreground)'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'color-mix(in srgb, var(--vscode-editor-background) 60%, transparent)'
        event.currentTarget.style.color = danger
          ? 'var(--vscode-errorForeground, #f87171)'
          : 'var(--vscode-descriptionForeground)'
      }}
    >
      {children}
    </button>
  )
}

export function MetaVisibilitySwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? 'Shown on card previews' : 'Hidden from card previews'}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-[background-color,border-color,box-shadow]"
      style={{
        borderColor: checked
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-panel-border)',
        background: checked
          ? 'var(--vscode-button-background)'
          : 'color-mix(in srgb, var(--vscode-editor-background) 70%, transparent)',
      }}
    >
      <span
        className="inline-block h-5 w-5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(24px)' : 'translateX(3px)' }}
      />
    </button>
  )
}

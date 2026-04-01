import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import { X, User, ChevronDown, Wand2, Tag, Plus, Check, CircleDot, Signal, Calendar, Trash2, Paperclip, Clock, Download, ExternalLink, Filter, Undo2, FileUp, PanelRight, PanelLeft, PanelTop, PanelBottom } from 'lucide-react'
import type { Comment, CardFrontmatter, Priority, CardStatus, LogEntry, SubmitFormTransportResult } from '../../shared/types'
import { DELETED_STATUS_ID, getDisplayTitleFromContent } from '../../shared/types'
import { cn, formatAbsoluteDate, formatRelativeCompact, formatVerboseRelative } from '../lib/utils'
import { CopyableValue } from '../lib/CopyableValue'
import { useStore } from '../store'
import { NEXT_POSITION, type DrawerPosition } from '../drawerPositionHelpers'
import { getVsCodeApi } from '../vsCodeApi'
import { MarkdownEditor } from './MarkdownEditor'

type AIAgent = 'claude' | 'codex' | 'opencode'
type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

interface CardEditorProps {
  cardId: string
  content: string
  frontmatter: CardFrontmatter
  comments: Comment[]
  contentVersion?: number
  onSave: (content: string, frontmatter: CardFrontmatter) => void
  onClose: () => void
  onDelete: () => void
  onPermanentDelete: () => void
  onRestore: () => void
  onOpenFile: () => void
  onOpenMetadataFile?: (path: string) => void
  onDownloadCard: () => void
  onStartWithAI: (agent: AIAgent, permissionMode: PermissionMode) => void
  onAddAttachment: () => void
  onOpenAttachment: (attachment: string) => void
  onRemoveAttachment: (attachment: string) => void
  onAddComment: (author: string, content: string) => void
  onUpdateComment: (commentId: string, content: string) => void
  onDeleteComment: (commentId: string) => void
  onTransferToBoard: (toBoard: string, targetStatus: string) => void
  onTriggerAction?: (action: string) => void
  logs?: LogEntry[]
  onClearLogs?: () => void
  logsFilter?: import('../../shared/types').CardDisplaySettings['logsFilter']
  onLogsFilterChange?: (filter: NonNullable<import('../../shared/types').CardDisplaySettings['logsFilter']>) => void
}

const priorityLabels: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

const priorities: Priority[] = ['critical', 'high', 'medium', 'low']

const priorityDots: Record<Priority, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

const aiAgentTabs: { agent: AIAgent; label: string; color: string; activeColor: string }[] = [
  { agent: 'claude', label: 'Claude', color: 'hover:bg-amber-100 dark:hover:bg-amber-900/30', activeColor: 'bg-amber-700 text-white' },
  { agent: 'codex', label: 'Codex', color: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/30', activeColor: 'bg-emerald-500 text-white' },
  { agent: 'opencode', label: 'OpenCode', color: 'hover:bg-slate-100 dark:hover:bg-slate-700/30', activeColor: 'bg-slate-500 text-white' },
]

const agentButtonColors: Record<AIAgent, { bg: string; hover: string; shadow: string; border: string }> = {
  claude: {
    bg: 'bg-amber-700',
    hover: 'hover:bg-amber-800',
    shadow: 'shadow-sm',
    border: 'border border-amber-800/50'
  },
  codex: {
    bg: 'bg-emerald-600',
    hover: 'hover:bg-emerald-700',
    shadow: 'shadow-sm',
    border: 'border border-emerald-700/50'
  },
  opencode: {
    bg: 'bg-slate-600',
    hover: 'hover:bg-slate-700',
    shadow: 'shadow-sm',
    border: 'border border-slate-700/50'
  },
}

const aiModesByAgent: Record<AIAgent, { permissionMode: PermissionMode; label: string; description: string }[]> = {
  claude: [
    { permissionMode: 'default', label: 'Default', description: 'With confirmations' },
    { permissionMode: 'plan', label: 'Plan', description: 'Creates a plan first' },
    { permissionMode: 'acceptEdits', label: 'Auto-edit', description: 'Auto-accepts file edits' },
    { permissionMode: 'bypassPermissions', label: 'Full Auto', description: 'Bypasses all prompts' },
  ],
  codex: [
    { permissionMode: 'default', label: 'Suggest', description: 'Suggests changes' },
    { permissionMode: 'acceptEdits', label: 'Auto-edit', description: 'Auto-accepts edits' },
    { permissionMode: 'bypassPermissions', label: 'Full Auto', description: 'Full automation' },
  ],
  opencode: [
    { permissionMode: 'default', label: 'Default', description: 'Standard mode' },
  ],
}

interface DropdownProps {
  value: string
  options: { value: string; label: string; dot?: string }[]
  onChange: (value: string) => void
  className?: string
}

function Dropdown({ value, options, onChange, className }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const current = options.find(o => o.value === value)

  return (
    <div className={cn('relative', isOpen && 'z-30', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="card-select-trigger"
        style={{ color: 'var(--vscode-foreground)' }}
      >
        {current?.dot && <span className={cn('w-2 h-2 rounded-full shrink-0', current.dot)} />}
        <span>{current?.label}</span>
        <ChevronDown size={12} style={{ color: 'var(--vscode-descriptionForeground)' }} className="ml-0.5" />
      </button>
      {isOpen && (
        <>
          <div className="card-floating-dismiss" onClick={() => setIsOpen(false)} />
          <div
            className="card-floating-menu absolute top-full left-0 mt-1.5 min-w-[172px]"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className="card-floating-menu__item w-full flex items-center gap-2 text-[11px] transition-colors"
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
                {option.value === value && <Check size={12} style={{ color: 'var(--vscode-focusBorder)' }} className="shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface StatusDropdownProps {
  value: string
  onChange: (status: string) => void
  onTransferToBoard: (toBoard: string, targetStatus: string) => void
}

function StatusDropdown({ value, onChange, onTransferToBoard }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const columns = useStore(s => s.columns)
  const boards = useStore(s => s.boards)
  const currentBoard = useStore(s => s.currentBoard)

  const otherBoards = boards.filter(b => b.id !== currentBoard)

  return (
    <div className={cn('relative', isOpen && 'z-30')}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="card-select-trigger"
        style={{ color: 'var(--vscode-foreground)' }}
      >
        {(() => {
          const col = columns.find(c => c.id === value)
          return col ? (
            <>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
              <span>{col.name}</span>
            </>
          ) : (
            <span>{value}</span>
          )
        })()}
        <ChevronDown size={12} style={{ color: 'var(--vscode-descriptionForeground)' }} className="ml-0.5" />
      </button>
      {isOpen && (
        <>
          <div className="card-floating-dismiss" onClick={() => setIsOpen(false)} />
          <div
            className="card-floating-menu absolute top-full left-0 mt-1.5 min-w-[204px] max-h-[320px] overflow-y-auto"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            {/* Current board statuses (flat) */}
            {columns.map(col => (
              <button
                key={col.id}
                onClick={() => {
                  onChange(col.id)
                  setIsOpen(false)
                }}
                className="card-floating-menu__item w-full flex items-center gap-2 text-[11px] transition-colors"
                style={{
                  color: 'var(--vscode-dropdown-foreground)',
                  background: col.id === value ? 'var(--vscode-list-activeSelectionBackground)' : undefined,
                }}
                onMouseEnter={e => {
                  if (col.id !== value) e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'
                }}
                onMouseLeave={e => {
                  if (col.id !== value) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                <span className="flex-1 text-left">{col.name}</span>
                {col.id === value && <Check size={12} style={{ color: 'var(--vscode-focusBorder)' }} className="shrink-0" />}
              </button>
            ))}

            {/* Other boards section */}
            {otherBoards.length > 0 && (
              <>
                <div
                  className="mx-2 my-1"
                  style={{ borderTop: '1px solid var(--vscode-panel-border)' }}
                />
                <div
                  className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--vscode-descriptionForeground)' }}
                >
                  Move to...
                </div>
                {otherBoards.map(board => (
                  <div key={board.id}>
                    <div
                      className="px-4 py-1 text-[10px] font-semibold"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      {board.name}
                    </div>
                    {(board.columns || []).map(col => (
                      <button
                        key={`${board.id}-${col.id}`}
                        onClick={() => {
                          onTransferToBoard(board.id, col.id)
                          setIsOpen(false)
                        }}
                        className="card-floating-menu__item w-full flex items-center gap-2 pl-5 text-[11px] transition-colors"
                        style={{ color: 'var(--vscode-dropdown-foreground)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                        <span className="flex-1 text-left">{col.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function PropertyRow({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="card-property-row"
    >
      <div className="card-property-label-group">
        <span className="card-property-icon" style={{ color: 'var(--vscode-descriptionForeground)' }}>{icon}</span>
        <span className="card-property-label" style={{ color: 'var(--vscode-descriptionForeground)' }}>{label}</span>
      </div>
      <div className="card-property-value">
        {children}
      </div>
    </div>
  )
}

function normalizeMetadataFilterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item)).join(',')
  return String(value)
}

function MetadataFilterButton({ path, value }: { path: string; value: string }) {
  const applyMetadataFilterToken = useStore(s => s.applyMetadataFilterToken)

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        applyMetadataFilterToken(path, value)
      }}
      className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
      style={{ color: 'var(--vscode-descriptionForeground)' }}
      title={`Filter cards by ${path}`}
      aria-label={`Filter cards by metadata ${path} = ${value}`}
    >
      <Filter size={11} />
    </button>
  )
}

interface AIDropdownProps {
  onSelect: (agent: AIAgent, permissionMode: PermissionMode) => void
}

function AIDropdown({ onSelect }: AIDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedTab, setSelectedTab] = useState<AIAgent>('claude')

  const modes = aiModesByAgent[selectedTab]
  const buttonColors = agentButtonColors[selectedTab]

  return (
    <div className={cn('relative', isOpen && 'z-30')}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'card-inline-action card-inline-action--solid',
          buttonColors.bg,
          buttonColors.hover,
          buttonColors.shadow,
          buttonColors.border
        )}
      >
        <Wand2 size={13} />
        <span>Build with AI</span>
        <kbd className="ml-0.5 text-[9px] opacity-60 font-mono">⌘B</kbd>
        <ChevronDown size={11} className={cn('ml-0.5 opacity-60 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <>
          <div className="card-floating-dismiss" onClick={() => setIsOpen(false)} />
          <div className="card-floating-menu absolute top-full right-0 mt-1 min-w-[240px] overflow-hidden bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
            {/* Tabs */}
            <div className="flex">
              {aiAgentTabs.map((tab) => (
                <button
                  key={tab.agent}
                  onClick={() => setSelectedTab(tab.agent)}
                  className={cn(
                    'flex-1 px-3 py-2 text-[11px] font-medium transition-all',
                    selectedTab === tab.agent
                      ? tab.activeColor
                      : cn('text-zinc-600 dark:text-zinc-400', tab.color)
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Options */}
            <div className="p-1 space-y-1">
              {modes.map((mode) => (
                <button
                  key={mode.permissionMode}
                  onClick={() => {
                    onSelect(selectedTab, mode.permissionMode)
                    setIsOpen(false)
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-[8px] hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors"
                >
                  <div className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100">{mode.label}</div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{mode.description}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface RunActionsDropdownProps {
  actions: string[] | Record<string, string>
  onTriggerAction: (action: string) => void
}

function RunActionsDropdown({ actions, onTriggerAction }: RunActionsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  const entries: { key: string; label: string }[] = Array.isArray(actions)
    ? actions.map(a => ({ key: a, label: a }))
    : Object.entries(actions).map(([k, v]) => ({ key: k, label: v }))

  return (
    <div className={cn('relative', isOpen && 'z-30')}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="card-inline-action"
        style={{
          color: 'var(--vscode-foreground)',
          border: '1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, rgba(128,128,128,0.35)))',
        }}
      >
        <span>Run Action</span>
        <ChevronDown size={11} className={cn('opacity-60 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close actions menu"
            className="card-floating-dismiss"
            onClick={() => setIsOpen(false)}
          />
          <div
            className="card-floating-menu absolute top-full right-0 mt-1"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
          >
            {entries.map(({ key, label }) => (
              <button
                type="button"
                key={key}
                onClick={() => { setIsOpen(false); onTriggerAction(key) }}
                className="card-floating-menu__item w-full flex items-center gap-2 text-[11px] transition-colors whitespace-nowrap"
                style={{ color: 'var(--vscode-dropdown-foreground)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** VS Code logo icon (monochrome, inline SVG) */
function VSCodeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 19.88V4.12a1.5 1.5 0 0 0-.85-1.533zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  )
}

function CardActionButton({
  title,
  icon,
  onClick,
  variant = 'default',
  label,
}: {
  title: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger' | 'primary'
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('card-action-button', variant !== 'default' && `card-action-button--${variant}`)}
      title={title}
      aria-label={title}
    >
      <span className="card-action-button__icon">{icon}</span>
      {label && <span className="card-action-button__label">{label}</span>}
    </button>
  )
}

const DRAWER_POSITION_ICON: Record<DrawerPosition, React.ReactNode> = {
  right: <PanelRight size={15} />,
  left: <PanelLeft size={15} />,
  top: <PanelTop size={15} />,
  bottom: <PanelBottom size={15} />,
}

const DRAWER_POSITION_LABEL: Record<DrawerPosition, string> = {
  right: 'Move drawer to bottom',
  left: 'Move drawer to top',
  top: 'Move drawer to right',
  bottom: 'Move drawer to left',
}

function isUrl(v: string): boolean {
  return /^https?:\/\//i.test(v)
}

function isFilePath(v: string): boolean {
  return /^(\/|~\/|\.{1,2}\/|[A-Za-z]:[/\\])/i.test(v)
}

/** Renders a URL value as a clickable external link with copy icon. */
function UrlValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span className="group/val inline-flex items-center gap-1">
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        title={value}
        onClick={e => e.stopPropagation()}
      >
        <ExternalLink size={10} className="shrink-0" />
        <span className="break-all">{value}</span>
      </a>
      <button
        className="opacity-0 group-hover/val:opacity-100 transition-opacity cursor-pointer"
        onClick={handleCopy}
        title="Copy URL"
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  )
}

/** Renders a file path value with a VS Code open button and copy icon. */
function FilePathValue({ value, onOpenFile }: { value: string; onOpenFile?: (path: string) => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span className="group/val inline-flex items-center gap-1">
      {onOpenFile && (
        <button
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
          onClick={e => { e.stopPropagation(); onOpenFile(value) }}
          title="Open in VS Code"
        >
          <VSCodeIcon size={11} />
        </button>
      )}
      <span className="text-zinc-700 dark:text-zinc-300 break-all">{value}</span>
      <button
        className="opacity-0 group-hover/val:opacity-100 transition-opacity cursor-pointer"
        onClick={handleCopy}
        title="Copy path"
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  )
}

function MetadataSection({ metadata, onOpenMetadataFile }: { metadata?: Record<string, unknown>; onOpenMetadataFile?: (path: string) => void }) {
  if (!metadata || Object.keys(metadata).length === 0) return null

  const keys = Object.keys(metadata)

  return (
    <div className="card-metadata-section">
      <div className="card-metadata-section__header">
        <span>Metadata</span>
        <span className="card-metadata-section__count">{keys.length}</span>
      </div>
      <div className="card-metadata-tree-shell">
        <MetadataTree data={metadata} depth={0} onOpenMetadataFile={onOpenMetadataFile} />
      </div>
    </div>
  )
}

function MetadataTree({ data, depth, pathPrefix = '', onOpenMetadataFile }: { data: Record<string, unknown>; depth: number; pathPrefix?: string; onOpenMetadataFile?: (path: string) => void }) {
  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {Object.entries(data).map(([key, value]) => {
        const path = pathPrefix ? `${pathPrefix}.${key}` : key
        const normalizedValue = normalizeMetadataFilterValue(value)

        return (
        <div key={key} className="py-0.5">
          {value && typeof value === 'object' && !Array.isArray(value) ? (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">{key}:</span>
              <MetadataTree data={value as Record<string, unknown>} depth={depth + 1} pathPrefix={path} onOpenMetadataFile={onOpenMetadataFile} />
            </>
          ) : Array.isArray(value) ? (
            <div className="flex items-baseline gap-1">
              <span className="text-zinc-500 dark:text-zinc-400">{key}: </span>
              <CopyableValue value={`[${value.join(', ')}]`} />
              <MetadataFilterButton path={path} value={normalizedValue} />
            </div>
          ) : (
            <div className="flex items-baseline gap-1 flex-wrap">
              <span className="text-zinc-500 dark:text-zinc-400">{key}: </span>
              {isUrl(String(value)) ? (
                <UrlValue value={String(value)} />
              ) : isFilePath(String(value)) ? (
                <FilePathValue value={String(value)} onOpenFile={onOpenMetadataFile} />
              ) : (
                <CopyableValue value={String(value)} />
              )}
              <MetadataFilterButton path={path} value={normalizedValue} />
            </div>
          )}
        </div>
        )
      })}
    </div>
  )
}

function LabelEditor({ labels, onChange }: { labels: string[]; onChange: (labels: string[]) => void }) {
  const [newLabel, setNewLabel] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const allCards = useStore(s => s.cards)
  const labelDefs = useStore(s => s.labelDefs)
  const applyLabelFilter = useStore(s => s.applyLabelFilter)

  const existingLabels = useMemo(() => {
    const labelSet = new Set<string>()
    allCards.forEach(f => f.labels.forEach(l => labelSet.add(l)))
    return Array.from(labelSet).sort()
  }, [allCards])

  const suggestions = useMemo(() => {
    const available = existingLabels.filter(l => !labels.includes(l))
    if (!newLabel.trim()) return available
    return available.filter(l => l.toLowerCase().includes(newLabel.toLowerCase()))
  }, [newLabel, existingLabels, labels])

  const showSuggestions = isFocused && suggestions.length > 0

  const addLabel = (label?: string) => {
    const l = (label || newLabel).trim()
    if (l && !labels.includes(l)) {
      onChange([...labels, l])
    }
    setNewLabel('')
  }

  const removeLabel = (label: string) => {
    onChange(labels.filter(l => l !== label))
  }

  return (
    <div className={cn('relative flex items-center gap-2 flex-wrap', showSuggestions && 'z-30')}>
      {labels.map(label => {
        const def = labelDefs[label]
        return (
          <span
            key={label}
            className="card-label-pill"
            style={def ? { backgroundColor: `${def.color}20`, color: def.color } : {
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
            }}
          >
            <button
              type="button"
              onClick={() => applyLabelFilter(label)}
              className="hover:underline"
              title={`Filter cards by label ${label}`}
              aria-label={`Filter cards by label ${label}`}
            >
              {label}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeLabel(label)
              }}
              className="hover:text-red-500 transition-colors"
              aria-label={`Remove label ${label}`}
            >
              <X size={9} />
            </button>
          </span>
        )
      })}
      <button
        onClick={() => { setIsFocused(true); setTimeout(() => inputRef.current?.focus(), 0) }}
        className="card-label-add"
        style={{ color: 'var(--vscode-descriptionForeground)' }}
      >
        <Plus size={10} />
        <span>Add label</span>
      </button>
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
        className="card-label-input"
        style={{ color: 'var(--vscode-foreground)', display: isFocused || newLabel ? 'block' : 'none' }}
      />
      {showSuggestions && (
        <div
          className="card-floating-menu absolute top-full left-0 mt-1.5 max-h-[200px] overflow-auto min-w-[220px]"
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
                className="card-floating-menu__item w-full flex items-center gap-2 text-[11px] transition-colors"
                style={{ color: 'var(--vscode-dropdown-foreground)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span
                  className="card-label-pill"
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

export function CardEditor({ cardId, content, frontmatter, comments, contentVersion, onSave, onClose, onDelete, onPermanentDelete, onRestore, onOpenFile, onOpenMetadataFile, onDownloadCard, onStartWithAI, onAddAttachment, onOpenAttachment, onRemoveAttachment, onAddComment, onUpdateComment, onDeleteComment, onTransferToBoard, onTriggerAction, logs, onClearLogs, logsFilter, onLogsFilterChange }: CardEditorProps) {
  const { cardSettings, boards, currentBoard, setCardSettings } = useStore()
  const pinnedMetadataKeys = useMemo(
    () => boards.find(b => b.id === currentBoard)?.metadata ?? [],
    [boards, currentBoard],
  )
  const titleMetadataKeys = useMemo(
    () => boards.find(b => b.id === currentBoard)?.title,
    [boards, currentBoard],
  )
  const [currentFrontmatter, setCurrentFrontmatter] = useState(frontmatter)
  const [currentContent, setCurrentContent] = useState(content)
  const [confirmingPermanentDelete, setConfirmingPermanentDelete] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isDeleted = currentFrontmatter.status === DELETED_STATUS_ID
  const cardTitle = getDisplayTitleFromContent(currentContent, currentFrontmatter.metadata, titleMetadataKeys)
  const metadata = useMemo(() => currentFrontmatter.metadata ?? {}, [currentFrontmatter.metadata])
  const pinnedMetadataEntries = useMemo(
    () => pinnedMetadataKeys
      .map((key) => ({ key, value: metadata[key] }))
      .filter(({ value }) => value !== undefined && value !== null && String(value).trim() !== ''),
    [metadata, pinnedMetadataKeys]
  )
  const isDrawerMode = (cardSettings.panelMode ?? 'drawer') === 'drawer'
  const drawerPosition: DrawerPosition = cardSettings.drawerPosition ?? 'right'

  const handleCycleDrawerPosition = useCallback(() => {
    const next = { ...useStore.getState().cardSettings, drawerPosition: NEXT_POSITION[drawerPosition] }
    setCardSettings(next)
    getVsCodeApi().postMessage({ type: 'saveSettings', settings: next })
  }, [drawerPosition, setCardSettings])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentFrontmatterRef = useRef(currentFrontmatter)
  const currentContentRef = useRef(currentContent)
  currentFrontmatterRef.current = currentFrontmatter
  currentContentRef.current = currentContent

  const save = useCallback(() => {
    onSave(currentContentRef.current, currentFrontmatterRef.current)
  }, [onSave])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Set content when a new card is opened (keyed by cardId)
  useEffect(() => {
    setCurrentContent(content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, contentVersion])

  // Reset frontmatter when prop changes
  useEffect(() => {
    setCurrentFrontmatter(frontmatter)
  }, [frontmatter])

  const handleContentChange = useCallback((value: string) => {
    setCurrentContent(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSave(value, currentFrontmatterRef.current)
    }, 800)
  }, [onSave])

  const handleFrontmatterUpdate = useCallback((updates: Partial<CardFrontmatter>) => {
    setCurrentFrontmatter(prev => {
      const next = { ...prev, ...updates }
      // Schedule a save with the updated frontmatter
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSave(currentContentRef.current, next)
      }, 800)
      return next
    })
  }, [onSave])

  const handleFormSubmitSuccess = useCallback((result: SubmitFormTransportResult) => {
    setCurrentFrontmatter(prev => ({
      ...prev,
      formData: result.card.formData,
      modified: result.card.modified,
    }))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        // Flush any pending debounce and save immediately
        if (debounceRef.current) clearTimeout(debounceRef.current)
        save()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b' && cardSettings.showBuildWithAI) {
        e.preventDefault()
        onStartWithAI('claude', 'default')
      }
      if (e.key === 'Escape') {
        // Flush any pending save before closing
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
          save()
        }
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [save, onClose, onStartWithAI, cardSettings.showBuildWithAI])

  return (
    <div className="card-editor-shell h-full flex flex-col">
      <div className="card-editor-content flex-1 min-h-0 overflow-auto">
        <div className="card-editor-stack">
          <header className="card-editor-hero">
            <div className="card-editor-hero-copy">
              <div className="card-editor-hero-meta">
                <span className="card-editor-card-id">{cardId}</span>
                <span className="card-editor-hero-separator" aria-hidden="true" />
                <span title={formatVerboseRelative(currentFrontmatter.modified)}>{formatRelativeCompact(currentFrontmatter.modified)}</span>
              </div>
              <h1 className="card-editor-title">{cardTitle}</h1>
            </div>
            <div className="card-editor-hero-actions">
              {currentFrontmatter.actions && (Array.isArray(currentFrontmatter.actions) ? currentFrontmatter.actions.length > 0 : Object.keys(currentFrontmatter.actions).length > 0) && onTriggerAction && (
                <RunActionsDropdown actions={currentFrontmatter.actions} onTriggerAction={onTriggerAction} />
              )}
              {cardSettings.showBuildWithAI && <AIDropdown onSelect={onStartWithAI} />}
              {isDeleted ? (
                confirmingPermanentDelete ? (
                  <div className="card-delete-confirmation">
                    <span className="card-delete-confirmation__text">Delete this card from disk?</span>
                    <CardActionButton title="Confirm permanent delete" icon={<Trash2 size={15} />} label="Delete" onClick={() => { setConfirmingPermanentDelete(false); onPermanentDelete() }} variant="danger" />
                    <CardActionButton title="Cancel permanent delete" icon={<Undo2 size={15} />} label="Keep" onClick={() => setConfirmingPermanentDelete(false)} />
                  </div>
                ) : (
                  <>
                    <CardActionButton title="Restore card" icon={<Undo2 size={15} />} label="Restore" onClick={onRestore} variant="primary" />
                    <CardActionButton title="Permanently delete from disk" icon={<Trash2 size={15} />} label="Delete forever" onClick={() => setConfirmingPermanentDelete(true)} variant="danger" />
                  </>
                )
              ) : (
                <>
                  <CardActionButton title="Open in VS Code" icon={<VSCodeIcon size={15} />} onClick={onOpenFile} />
                  <CardActionButton title="Download card as Markdown" icon={<Download size={15} />} onClick={onDownloadCard} />
                  <CardActionButton title="Move to deleted" icon={<Trash2 size={15} />} onClick={onDelete} variant="danger" />
                </>
              )}
              {isDrawerMode && (
                <CardActionButton
                  title={DRAWER_POSITION_LABEL[drawerPosition]}
                  icon={DRAWER_POSITION_ICON[drawerPosition]}
                  onClick={handleCycleDrawerPosition}
                />
              )}
              <CardActionButton title="Close card" icon={<X size={16} />} onClick={onClose} />
            </div>
          </header>

          <div className={cn('card-editor-desktop-columns', (cardSettings.cardViewMode === 'compact' || cardSettings.cardViewMode === 'normal') && 'is-compact')}>
            <div className="card-editor-top-row">
              <section className="card-surface card-surface--details">
                <div className="card-surface-header">
                  <div>
                    <span className="card-surface-kicker">Overview</span>
                    <h2 className="card-surface-title">Details</h2>
                  </div>
                </div>

                <div className="card-property-list">
        <PropertyRow label="Status" icon={<CircleDot size={13} />}>
          <StatusDropdown
            value={currentFrontmatter.status}
            onChange={(v) => handleFrontmatterUpdate({ status: v as CardStatus })}
            onTransferToBoard={onTransferToBoard}
          />
        </PropertyRow>
        {cardSettings.showPriorityBadges && (
          <PropertyRow label="Priority" icon={<Signal size={13} />}>
            <Dropdown
              value={currentFrontmatter.priority}
              options={priorities.map(p => ({ value: p, label: priorityLabels[p], dot: priorityDots[p] }))}
              onChange={(v) => handleFrontmatterUpdate({ priority: v as Priority })}
            />
          </PropertyRow>
        )}
        {cardSettings.showAssignee && (
          <PropertyRow label="Assignee" icon={<User size={13} />}>
            <div className="card-property-chip card-property-chip--input">
              <span
                className="card-property-avatar"
                style={{
                  background: currentFrontmatter.assignee ? 'var(--vscode-badge-background)' : 'rgba(148, 163, 184, 0.18)',
                  color: currentFrontmatter.assignee ? 'var(--vscode-badge-foreground)' : 'var(--vscode-descriptionForeground)',
                }}
              >
                {currentFrontmatter.assignee
                  ? currentFrontmatter.assignee.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
                  : <User size={12} />}
              </span>
              <input
                type="text"
                value={currentFrontmatter.assignee || ''}
                onChange={(e) => handleFrontmatterUpdate({ assignee: e.target.value || null })}
                placeholder="No assignee"
                className="card-property-text-input"
                style={{ color: currentFrontmatter.assignee ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
              />
            </div>
          </PropertyRow>
        )}
        {cardSettings.showDueDate && (
          <PropertyRow label="Due date" icon={<Calendar size={13} />}>
            <input
              type="date"
              value={currentFrontmatter.dueDate || ''}
              onChange={(e) => handleFrontmatterUpdate({ dueDate: e.target.value || null })}
              className="card-date-input"
              style={{ color: currentFrontmatter.dueDate ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
            />
          </PropertyRow>
        )}
        {cardSettings.showLabels && (
        <PropertyRow label="Labels" icon={<Tag size={13} />}>
          <LabelEditor
            labels={currentFrontmatter.labels}
            onChange={(labels) => handleFrontmatterUpdate({ labels })}
          />
        </PropertyRow>
        )}
        {pinnedMetadataEntries.map(({ key, value: rawVal }) => {
          const strVal = String(rawVal)
          return (
            <PropertyRow key={key} label={key} icon={<ExternalLink size={13} />}>
              <div className="card-metadata-highlight min-w-0">
                {isUrl(strVal) ? (
                  <a
                    href={strVal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card-metadata-highlight__link truncate"
                    style={{ color: 'var(--vscode-textLink-foreground)' }}
                  >
                    {strVal}
                  </a>
                ) : (
                  <span className="card-metadata-highlight__value" style={{ color: 'var(--vscode-foreground)' }}>{strVal}</span>
                )}
                <MetadataFilterButton path={key} value={normalizeMetadataFilterValue(rawVal)} />
              </div>
            </PropertyRow>
          )
        })}
        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="card-advanced-toggle"
          style={{ color: 'var(--vscode-descriptionForeground)' }}
        >
          <ChevronDown
            size={11}
            className={`opacity-60 transition-transform ${showAdvanced ? '' : '-rotate-90'}`}
          />
          <span className="text-[10px] font-semibold uppercase tracking-widest">Advanced</span>
        </button>
        {showAdvanced && (
          <>
            <PropertyRow label="Created" icon={<Clock size={13} />}>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--vscode-foreground)' }}>
                  {formatAbsoluteDate(currentFrontmatter.created)}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--vscode-descriptionForeground)' }}
                  title={formatVerboseRelative(currentFrontmatter.created)}
                >
                  {formatRelativeCompact(currentFrontmatter.created)}
                </span>
              </div>
            </PropertyRow>
            <PropertyRow label="Modified" icon={<Clock size={13} />}>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--vscode-foreground)' }}>
                  {formatAbsoluteDate(currentFrontmatter.modified)}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--vscode-descriptionForeground)' }}
                  title={formatVerboseRelative(currentFrontmatter.modified)}
                >
                  {formatRelativeCompact(currentFrontmatter.modified)}
                </span>
              </div>
            </PropertyRow>
            <div className="px-4 pb-2">
              <MetadataSection metadata={metadata} onOpenMetadataFile={onOpenMetadataFile} />
            </div>
          </>
        )}
                </div>
              </section>

              <section className={cn('card-surface card-surface--attachments', (cardSettings.cardViewMode === 'compact' || cardSettings.cardViewMode === 'normal') && 'card-surface--attachments-compact')}>
                <div className="card-surface-header">
                  <div>
                    <span className="card-surface-kicker">Files</span>
                    <h2 className="card-surface-title">Attachments</h2>
                  </div>
                  <button
                    type="button"
                    onClick={onAddAttachment}
                    className="card-inline-action"
                  >
                    <FileUp size={14} />
                    <span>Add attachment</span>
                  </button>
                </div>

                {currentFrontmatter.attachments.length > 0 ? (
                  <div className="card-attachment-tags">
                    {currentFrontmatter.attachments.map(attachment => (
                      <div key={attachment} className="card-attachment-tag">
                        <button
                          type="button"
                          onClick={() => onOpenAttachment(attachment)}
                          className="card-attachment-tag__link"
                          title={attachment}
                        >
                          <Paperclip size={12} />
                          <span>{attachment}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveAttachment(attachment)}
                          className="card-attachment-tag__remove"
                          aria-label={`Remove ${attachment}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="card-empty-state">No attachments yet.</p>
                )}
              </section>
            </div>

            <section className="card-surface card-surface--editor card-editor-main-surface">
              <MarkdownEditor
                value={currentContent}
                onChange={handleContentChange}
                placeholder="Start writing..."
                className="flex-1 min-h-[26rem]"
                mode="edit"
                comments={comments}
                onAddComment={onAddComment}
                onUpdateComment={onUpdateComment}
                onDeleteComment={onDeleteComment}
                logs={logs}
                onClearLogs={onClearLogs}
                logsFilter={logsFilter}
                onLogsFilterChange={onLogsFilterChange}
                cardId={cardId}
                frontmatter={currentFrontmatter}
                onFormSubmitSuccess={handleFormSubmitSuccess}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

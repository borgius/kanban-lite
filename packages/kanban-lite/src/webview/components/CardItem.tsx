import { Calendar, Check, Clock, FileText, Paperclip } from 'lucide-react'
import { getDisplayTitleFromContent } from '../../shared/types'
import type { Card, Priority } from '../../shared/types'
import { useStore } from '../store'
import { formatRelativeCompact, buildDateTooltip } from '../lib/utils'

interface CardItemProps {
  card: Card
  onClick: (e: React.MouseEvent) => void
  isDragging?: boolean
  isSelected?: boolean
}

const priorityColors: Record<Priority, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
}

const priorityLabels: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Med',
  low: 'Low'
}

function getDescriptionFromContent(content: string): string {
  const lines = content.split('\n')
  const headingIndex = lines.findIndex(l => /^#\s+/.test(l))
  const afterHeading = headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines
  return afterHeading.join('\n').trim()
}

/** Strip markdown syntax and return scannable plain text — safe, no HTML rendered. */
function getPlainTextExcerpt(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
}

export function CardItem({ card, onClick, isDragging, isSelected }: CardItemProps) {
  const cardSettings = useStore(s => s.cardSettings)
  const labelDefs = useStore(s => s.labelDefs)
  const applyLabelFilter = useStore(s => s.applyLabelFilter)
  const boardTitleFields = useStore(s => s.boards.find(board => board.id === s.currentBoard)?.title)
  const title = getDisplayTitleFromContent(card.content, card.metadata, boardTitleFields)
  const description = getDescriptionFromContent(card.content)
  const fileName = card.filePath ? card.filePath.split('/').pop() || '' : ''

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return null
    const date = new Date(dateStr)
    const now = new Date()
    const diff = date.getTime() - now.getTime()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))

    if (days < 0) return { text: 'Overdue', className: 'text-red-500' }
    if (days === 0) return { text: 'Today', className: 'text-orange-500' }
    if (days === 1) return { text: 'Tomorrow', className: 'text-yellow-600 dark:text-yellow-400' }
    if (days <= 7) return { text: `${days}d`, className: 'text-zinc-500 dark:text-zinc-400' }

    return {
      text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      className: 'text-zinc-500 dark:text-zinc-400'
    }
  }

  const dueInfo = card.status === 'done' ? null : formatDueDate(card.dueDate)

  const formatCompletedAt = (dateStr: string | null) => {
    if (!dateStr) return null
    const completed = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - completed.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return '1d ago'
    if (diffDays < 30) return `${diffDays}d ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
    return `${Math.floor(diffDays / 365)}y ago`
  }

  const completedText = card.status === 'done' ? formatCompletedAt(card.completedAt) : null
  const cardStateBadge = (() => {
    if (card.cardState?.error?.availability === 'identity-unavailable') {
      return {
        label: 'Sign in',
        className: 'kb-card-state-badge kb-card-state-badge--identity bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        title: card.cardState.error.message,
      }
    }

    if (card.cardState?.error?.availability === 'unavailable') {
      return {
        label: 'State off',
        className: 'kb-card-state-badge kb-card-state-badge--unavailable bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
        title: card.cardState.error.message,
      }
    }

    if (card.cardState?.unread?.unread) {
      return {
        label: 'Unread',
        className: 'kb-card-state-badge kb-card-state-badge--unread bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
        title: 'Unread activity is waiting on this card',
      }
    }

    if (card.cardState?.open) {
      return {
        label: 'Opened',
        className: 'kb-card-state-badge kb-card-state-badge--opened bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        title: `Last opened ${new Date(card.cardState.open.value.openedAt).toLocaleString()}`,
      }
    }

    return null
  })()

  return (
    <div
      onClick={onClick}
      className={[
        'group kb-card',
        `kb-card-priority--${card.priority}`,
        isSelected ? 'kb-card--selected' : '',
        isDragging ? 'shadow-lg opacity-90' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Title & Content */}
      <div className="flex-1">
        {/* File Name + Priority badge row (when fileName enabled) */}
        {cardSettings.showFileName && fileName && (
          <div className="flex items-center gap-1.5 mb-1">
            <FileText size={10} className="shrink-0 text-zinc-400 dark:text-zinc-400" />
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-400 truncate flex-1">
              {fileName}
            </span>
            {cardSettings.showPriorityBadges && (
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${priorityColors[card.priority]}`}
              >
                {priorityLabels[card.priority]}
              </span>
            )}
          </div>
        )}

        <div className={`flex items-start gap-2 ${description ? 'mb-1' : 'mb-2'}`}>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2 flex-1">
            {title}
          </h3>
          {cardStateBadge && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${cardStateBadge.className}`}
              title={cardStateBadge.title}
            >
              {cardStateBadge.label}
            </span>
          )}
          {cardSettings.showPriorityBadges && !(cardSettings.showFileName && fileName) && (
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${priorityColors[card.priority]}`}
            >
              {priorityLabels[card.priority]}
            </span>
          )}
        </div>

        {/* Description — plain-text excerpt (markdown stripped, no HTML rendered) */}
        {description && (
          <p className={`text-xs text-zinc-500 dark:text-zinc-400 ${cardSettings.compactMode ? 'line-clamp-1' : 'line-clamp-2'} mb-1.5`}>
            {getPlainTextExcerpt(description)}
          </p>
        )}

        {/* Labels */}
        {cardSettings.showLabels && card.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {(cardSettings.compactMode ? card.labels.slice(0, 2) : card.labels.slice(0, 4)).map((label) => {
              const def = labelDefs[label]
              return (
                <button
                  type="button"
                  key={label}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    applyLabelFilter(label)
                  }}
                  className={`text-xs px-1.5 py-0.5 rounded ${!def ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300' : ''}`}
                  style={def ? { backgroundColor: `${def.color}20`, color: def.color } : undefined}
                  title={`Filter cards by label ${label}`}
                  aria-label={`Filter cards by label ${label}`}
                >
                  {label}
                </button>
              )
            })}
            {(cardSettings.compactMode ? card.labels.length > 2 : card.labels.length > 4) && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-400 px-0.5 py-0.5 leading-tight">
                +{card.labels.length - (cardSettings.compactMode ? 2 : 4)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs mt-auto">
        <div className="flex items-center gap-1">
          {cardSettings.showAssignee && card.assignee && card.assignee !== 'null' && (
            <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold bg-zinc-200 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300">
                {card.assignee.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
              </span>
              <span>{card.assignee}</span>
            </div>
          )}
        </div>
        {card.attachments.length > 0 && (
          <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
            <Paperclip size={12} />
            <span>{card.attachments.length}</span>
          </div>
        )}
        {card.metadata && Object.keys(card.metadata).length > 0 && (
          <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
            <span className="text-[10px] font-mono">{`{${Object.keys(card.metadata).length}}`}</span>
          </div>
        )}
        {cardSettings.showDueDate && dueInfo && (
          <div className={`flex items-center gap-1 ${dueInfo.className}`}>
            <Calendar size={12} />
            <span>{dueInfo.text}</span>
          </div>
        )}
        {completedText && (
          <div className="flex items-center gap-1" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            <Check size={12} />
            <span>{completedText}</span>
          </div>
        )}
        <div
          className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400"
          title={buildDateTooltip(card.created, card.modified)}
        >
          <Clock size={12} />
          <span>{formatRelativeCompact(card.modified)}</span>
        </div>
      </div>
    </div>
  )
}

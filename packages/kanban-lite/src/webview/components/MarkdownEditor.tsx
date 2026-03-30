import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { marked } from 'marked'
import { Heading, Bold, Italic, Quote, Code, Link, List, ListOrdered, ListChecks, MessageCircle, ScrollText } from 'lucide-react'
import type { Comment, LogEntry, CardFrontmatter, SubmitFormTransportResult } from '../../shared/types'
import { cn } from '../lib/utils'
import { CommentsSection } from './CommentsSection'
import { LogsSection } from './LogsSection'
import { wrapSelection, ToolbarButton, type FormatAction } from '../lib/markdownTools'
import { useStore, type CardTab, createFormCardTabId } from '../store'
import { CardFormTab, resolveCardFormDescriptors } from './CardFormTab'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  mode?: 'create' | 'edit'
  comments?: Comment[]
  onAddComment?: (author: string, content: string) => void
  onUpdateComment?: (commentId: string, content: string) => void
  onDeleteComment?: (commentId: string) => void
  logs?: LogEntry[]
  onClearLogs?: () => void
  logsFilter?: import('../../shared/types').CardDisplaySettings['logsFilter']
  onLogsFilterChange?: (filter: NonNullable<import('../../shared/types').CardDisplaySettings['logsFilter']>) => void
  cardId?: string
  frontmatter?: CardFrontmatter
  onFormSubmitSuccess?: (result: SubmitFormTransportResult) => void
}


export function MarkdownEditor({ value, onChange, placeholder = 'Write markdown...', className, autoFocus, mode = 'create', comments, onAddComment, onUpdateComment, onDeleteComment, logs, onClearLogs, logsFilter, onLogsFilterChange, cardId, frontmatter, onFormSubmitSuccess }: MarkdownEditorProps) {
  const isEditMode = mode === 'edit'
  const writeLabel = isEditMode ? 'Edit' : 'Write'

  // In edit mode, sync active tab with the global store (enables URL-based tab restore).
  // In create mode, use local state.
  const storeActiveCardTab = useStore(s => s.activeCardTab)
  const setStoreActiveCardTab = useStore(s => s.setActiveCardTab)
  const boards = useStore(s => s.boards)
  const currentBoard = useStore(s => s.currentBoard)
  const [localTab, setLocalTab] = useState<CardTab>('write')
  const activeTab: CardTab = isEditMode ? storeActiveCardTab : localTab
  const setActiveTab = (tab: CardTab) => {
    if (isEditMode) setStoreActiveCardTab(tab)
    else setLocalTab(tab)
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeBoard = useMemo(
    () => boards.find((board) => board.id === currentBoard),
    [boards, currentBoard],
  )
  const resolvedForms = useMemo(
    () => (isEditMode && frontmatter ? resolveCardFormDescriptors({ ...frontmatter, content: value }, activeBoard) : []),
    [activeBoard, frontmatter, isEditMode, value],
  )

  const previewHtml = useMemo(() => {
    if (!value.trim()) return ''
    return marked.parse(value, { async: false, gfm: true, breaks: true }) as string
  }, [value])

  // Auto-focus textarea when switching to write tab
  useEffect(() => {
    if (activeTab === 'write' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [activeTab])

  // Initial auto-focus
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  const handleFormat = useCallback((action: FormatAction) => {
    if (textareaRef.current) {
      wrapSelection(textareaRef.current, value, onChange, action)
    }
  }, [value, onChange])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key inserts spaces instead of changing focus
    if (e.key === 'Tab') {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = value.substring(0, start) + '  ' + value.substring(end)
      onChange(newValue)
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      })
    }
    // Ctrl/Cmd+B for bold
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault()
      e.stopPropagation()
      handleFormat('bold')
    }
    // Ctrl/Cmd+I for italic
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault()
      handleFormat('italic')
    }
    // Ctrl/Cmd+K for link
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      handleFormat('link')
    }
  }

  return (
    <div className={cn('card-markdown-shell h-full', className)}>
      {/* Tab bar + toolbar */}
      <div
        className="card-markdown-header shrink-0"
      >
        {/* Tabs */}
        <div className="card-markdown-tabs">
          {(isEditMode ? ['preview', 'write'] as const : ['write', 'preview'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn('card-markdown-tab', activeTab === tab && 'is-active')}
            >
              {tab === 'write' ? writeLabel : 'Preview'}
            </button>
          ))}
          {resolvedForms.map((form) => {
            const tabId = createFormCardTabId(form.id)
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={cn('card-markdown-tab', activeTab === tabId && 'is-active')}
              >
                {`form: ${form.name}`}
              </button>
            )
          })}
          {comments && (
            <button
              type="button"
              onClick={() => setActiveTab('comments')}
              className={cn('card-markdown-tab', activeTab === 'comments' && 'is-active')}
            >
              <MessageCircle size={12} />
              Comments
              {comments.length > 0 && (
                <span
                  className="text-[10px] px-1 rounded-full"
                  style={{
                    background: 'var(--vscode-badge-background)',
                    color: 'var(--vscode-badge-foreground)',
                  }}
                >
                  {comments.length}
                </span>
              )}
            </button>
          )}
          {logs && (
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={cn('card-markdown-tab', activeTab === 'logs' && 'is-active')}
            >
              <ScrollText size={12} />
              Logs
              {logs.length > 0 && (
                <span
                  className="text-[10px] px-1 rounded-full"
                  style={{
                    background: 'var(--vscode-badge-background)',
                    color: 'var(--vscode-badge-foreground)',
                  }}
                >
                  {logs.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Toolbar - only visible on Write tab */}
        {activeTab === 'write' && (
          <div className="card-markdown-toolbar">
            <ToolbarButton icon={<Heading size={14} />} title="Heading" onClick={() => handleFormat('heading')} />
            <ToolbarButton icon={<Bold size={14} />} title="Bold (⌘B)" onClick={() => handleFormat('bold')} />
            <ToolbarButton icon={<Italic size={14} />} title="Italic (⌘I)" onClick={() => handleFormat('italic')} />
            <ToolbarButton icon={<Quote size={14} />} title="Quote" onClick={() => handleFormat('quote')} separator />
            <ToolbarButton icon={<Code size={14} />} title="Code" onClick={() => handleFormat('code')} />
            <ToolbarButton icon={<Link size={14} />} title="Link (⌘K)" onClick={() => handleFormat('link')} />
            <ToolbarButton icon={<List size={14} />} title="Bulleted list" onClick={() => handleFormat('ul')} separator />
            <ToolbarButton icon={<ListOrdered size={14} />} title="Numbered list" onClick={() => handleFormat('ol')} />
            <ToolbarButton icon={<ListChecks size={14} />} title="Task list" onClick={() => handleFormat('tasklist')} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'write' && (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="markdown-editor-textarea"
            spellCheck={false}
          />
        )}
        {activeTab === 'preview' && (
          <div className="min-h-[200px]">
            {previewHtml ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none p-4"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <p
                className="p-4 text-sm italic"
                style={{ color: 'var(--vscode-descriptionForeground)' }}
              >
                Nothing to preview
              </p>
            )}
          </div>
        )}
        {resolvedForms.map((form) => {
          const tabId = createFormCardTabId(form.id)
          if (!cardId) return null

          return (
            <div key={tabId} className={cn('h-full', activeTab === tabId ? 'block' : 'hidden')}>
              <CardFormTab
                cardId={cardId}
                boardId={activeBoard?.id}
                form={form}
                onSubmitted={onFormSubmitSuccess}
              />
            </div>
          )
        })}
        {activeTab === 'comments' && comments && onAddComment && onUpdateComment && onDeleteComment && (
          <CommentsSection
            comments={comments}
            onAddComment={onAddComment}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
          />
        )}
        {activeTab === 'logs' && logs && onClearLogs && (
          <LogsSection
            logs={logs}
            onClearLogs={onClearLogs}
            logsFilter={logsFilter}
            onLogsFilterChange={onLogsFilterChange}
          />
        )}
      </div>
    </div>
  )
}

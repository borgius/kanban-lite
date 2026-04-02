import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { marked, Marked, type RendererObject, type Tokens } from 'marked'
import { Heading, Bold, Italic, Quote, Code, Link, List, ListOrdered, ListChecks, MessageCircle, ScrollText } from 'lucide-react'
import type { Comment, LogEntry, CardFrontmatter, SubmitFormTransportResult } from '../../shared/types'
import { buildChecklistReadModel, isSafeChecklistLinkHref, type ChecklistReadModel } from '../../sdk/modules/checklist'
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
  onAddChecklistItem?: (text: string, expectedToken: string) => void
  onEditChecklistItem?: (index: number, text: string, expectedRaw?: string) => void
  onDeleteChecklistItem?: (index: number, expectedRaw?: string) => void
  onCheckChecklistItem?: (index: number, expectedRaw?: string) => void
  onUncheckChecklistItem?: (index: number, expectedRaw?: string) => void
}

function escapeChecklistLegacyHtml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeChecklistHtmlAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderChecklistLegacyImageMarkdown({ raw, href, title, text }: Tokens.Image): string {
  const fallback = `![${text}](${href ?? ''}${title ? ` "${title}"` : ''})`
  return escapeChecklistLegacyHtml(raw || fallback)
}

const checklistRenderer: RendererObject<string, string> = {
  image(token: Tokens.Image) {
    return renderChecklistLegacyImageMarkdown(token)
  },
  link({ href, title, tokens }: Tokens.Link) {
    const text = this.parser.parseInline(tokens)
    if (!href || !isSafeChecklistLinkHref(href)) {
      return text
    }

    const titleAttr = title ? ` title="${escapeChecklistHtmlAttribute(title)}"` : ''
    return `<a href="${escapeChecklistHtmlAttribute(href)}"${titleAttr}>${text}</a>`
  },
}

const checklistMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: checklistRenderer,
})

function renderChecklistItemHtml(text: string): string {
  const rendered = checklistMarked.parse(escapeChecklistLegacyHtml(text), { async: false }) as string
  return rendered.match(/^<p>([\s\S]*)<\/p>\s*$/)?.[1] ?? rendered
}

interface ChecklistSectionProps {
  checklist: ChecklistReadModel
  onAddChecklistItem?: (text: string, expectedToken: string) => void
  onEditChecklistItem?: (index: number, text: string, expectedRaw?: string) => void
  onDeleteChecklistItem?: (index: number, expectedRaw?: string) => void
  onCheckChecklistItem?: (index: number, expectedRaw?: string) => void
  onUncheckChecklistItem?: (index: number, expectedRaw?: string) => void
}

function ChecklistSection({
  checklist,
  onAddChecklistItem,
  onEditChecklistItem,
  onDeleteChecklistItem,
  onCheckChecklistItem,
  onUncheckChecklistItem,
}: ChecklistSectionProps) {
  const [draft, setDraft] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')

  const handleAddTask = useCallback(() => {
    const nextTask = draft.trim()
    if (!nextTask) return
    onAddChecklistItem?.(nextTask, checklist.token)
    setDraft('')
  }, [checklist.token, draft, onAddChecklistItem])

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--vscode-descriptionForeground)' }}>
          {`${checklist.summary.completed} of ${checklist.summary.total} complete`}
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-auto">
        {checklist.items.length > 0 ? checklist.items.map((item) => {
          const isEditing = editingIndex === item.index

          return (
            <div
              key={`${item.index}:${item.expectedRaw}`}
              className="flex items-start gap-3 rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--vscode-panel-border)' }}
            >
              <button
                type="button"
                onClick={() => {
                  if (item.checked) {
                    onUncheckChecklistItem?.(item.index, item.expectedRaw)
                  } else {
                    onCheckChecklistItem?.(item.index, item.expectedRaw)
                  }
                }}
                className="mt-0.5 shrink-0 text-sm"
                style={{ color: 'var(--vscode-foreground)' }}
                aria-label={`${item.checked ? 'Uncheck' : 'Check'} task ${item.text}`}
              >
                {item.checked ? '☑' : '☐'}
              </button>

              <div className="min-w-0 flex-1 space-y-2">
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      className="w-full rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
                        background: 'var(--vscode-input-background)',
                        color: 'var(--vscode-input-foreground)',
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const nextText = editingText.trim()
                          if (!nextText) return
                          onEditChecklistItem?.(item.index, nextText, item.expectedRaw)
                          setEditingIndex(null)
                          setEditingText('')
                        }}
                        className="rounded px-2 py-1 text-xs font-medium"
                        style={{
                          background: 'var(--vscode-button-background)',
                          color: 'var(--vscode-button-foreground)',
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIndex(null)
                          setEditingText('')
                        }}
                        className="rounded px-2 py-1 text-xs"
                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className={cn('text-sm', item.checked && 'opacity-70 line-through')}
                      style={{ color: 'var(--vscode-foreground)' }}
                      dangerouslySetInnerHTML={{ __html: renderChecklistItemHtml(item.text) }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIndex(item.index)
                          setEditingText(item.text)
                        }}
                        className="rounded px-2 py-1 text-xs"
                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                        disabled={!onEditChecklistItem}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteChecklistItem?.(item.index, item.expectedRaw)}
                        className="rounded px-2 py-1 text-xs"
                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                        disabled={!onDeleteChecklistItem}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        }) : (
          <p className="text-sm italic" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            No tasks yet.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleAddTask()
            }
          }}
          placeholder="Add a task..."
          className="flex-1 rounded border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
          }}
        />
        <button
          type="button"
          onClick={handleAddTask}
          className="rounded px-3 py-2 text-sm font-medium"
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
          }}
          disabled={!onAddChecklistItem}
        >
          Add task
        </button>
      </div>
    </div>
  )
}


export function MarkdownEditor({ value, onChange, placeholder = 'Write markdown...', className, autoFocus, mode = 'create', comments, onAddComment, onUpdateComment, onDeleteComment, logs, onClearLogs, logsFilter, onLogsFilterChange, cardId, frontmatter, onFormSubmitSuccess, onAddChecklistItem, onEditChecklistItem, onDeleteChecklistItem, onCheckChecklistItem, onUncheckChecklistItem }: MarkdownEditorProps) {
  const isEditMode = mode === 'edit'
  const writeLabel = isEditMode ? 'Edit' : 'Write'

  // In edit mode, sync active tab with the global store (enables URL-based tab restore).
  // In create mode, use local state.
  const storeActiveCardTab = useStore(s => s.activeCardTab)
  const setStoreActiveCardTab = useStore(s => s.setActiveCardTab)
  const boards = useStore(s => s.boards)
  const currentBoard = useStore(s => s.currentBoard)
  const [localTab, setLocalTab] = useState<CardTab>('write')
  const selectedTab: CardTab = isEditMode ? storeActiveCardTab : localTab
  const setActiveTab = useCallback((tab: CardTab) => {
    if (isEditMode) setStoreActiveCardTab(tab)
    else setLocalTab(tab)
  }, [isEditMode, setStoreActiveCardTab])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeBoard = useMemo(
    () => boards.find((board) => board.id === currentBoard),
    [boards, currentBoard],
  )
  const checklist = useMemo(() => {
    if (!isEditMode || !frontmatter || !Array.isArray(frontmatter.tasks)) {
      return null
    }

    return buildChecklistReadModel({
      id: frontmatter.id,
      boardId: frontmatter.boardId,
      tasks: frontmatter.tasks,
    })
  }, [frontmatter, isEditMode])
  const activeTab: CardTab = selectedTab === 'tasks' && !checklist ? 'preview' : selectedTab
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
          {checklist && (
            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              className={cn('card-markdown-tab', activeTab === 'tasks' && 'is-active')}
            >
              {`Tasks ${checklist.summary.completed}/${checklist.summary.total}`}
            </button>
          )}
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
        {activeTab === 'tasks' && checklist && (
          <ChecklistSection
            checklist={checklist}
            onAddChecklistItem={onAddChecklistItem}
            onEditChecklistItem={onEditChecklistItem}
            onDeleteChecklistItem={onDeleteChecklistItem}
            onCheckChecklistItem={onCheckChecklistItem}
            onUncheckChecklistItem={onUncheckChecklistItem}
          />
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

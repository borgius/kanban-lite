import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { marked } from 'marked'
import { Heading, Bold, Italic, Quote, Code, Link, List, ListOrdered, ListChecks, MessageCircle, ScrollText } from 'lucide-react'
import type { Comment, LogEntry, CardFrontmatter, SubmitFormTransportResult } from '../../shared/types'
import { buildChecklistReadModel, type ChecklistReadModel } from '../../sdk/modules/checklist'
import { cn } from '../lib/utils'
import { CommentsSection } from './CommentsSection'
import { LogsSection } from './LogsSection'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { MetadataEditorTab } from './MetadataEditorTab'
import { wrapEditorSelection, ToolbarButton, type FormatAction } from '../lib/markdownTools'
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
  onAddChecklistItem?: (title: string, description: string, expectedToken: string) => void
  onEditChecklistItem?: (index: number, title: string, description: string, modifiedAt?: string) => void
  onDeleteChecklistItem?: (index: number, modifiedAt?: string) => void
  onCheckChecklistItem?: (index: number, modifiedAt?: string) => void
  onUncheckChecklistItem?: (index: number, modifiedAt?: string) => void
  currentMetadata?: Record<string, unknown>
  onMetadataChange?: (metadata: Record<string, unknown>) => void
  onMetadataInvalid?: () => void
}

function formatChecklistModifiedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  return match?.[1] ?? ''
}

interface ChecklistSectionProps {
  checklist: ChecklistReadModel
  onAddChecklistItem?: (title: string, description: string, expectedToken: string) => void
  onEditChecklistItem?: (index: number, title: string, description: string, modifiedAt?: string) => void
  onDeleteChecklistItem?: (index: number, modifiedAt?: string) => void
  onCheckChecklistItem?: (index: number, modifiedAt?: string) => void
  onUncheckChecklistItem?: (index: number, modifiedAt?: string) => void
}

function ChecklistSection({
  checklist,
  onAddChecklistItem,
  onEditChecklistItem,
  onDeleteChecklistItem,
  onCheckChecklistItem,
  onUncheckChecklistItem,
}: ChecklistSectionProps) {
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const handleAddTask = useCallback(() => {
    const nextTitle = draftTitle.trim()
    if (!nextTitle) return
    onAddChecklistItem?.(nextTitle, draftDescription, checklist.token)
    setDraftTitle('')
    setDraftDescription('')
  }, [checklist.token, draftTitle, draftDescription, onAddChecklistItem])

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
          const isExpanded = expandedIndex === item.index
          const firstDescLine = item.description ? item.description.split('\n')[0] : ''

          return (
            <div
              key={`${item.index}:${item.modifiedAt}`}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--vscode-panel-border)' }}
            >
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    placeholder="Title"
                    className="w-full rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
                      background: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                    }}
                  />
                  <textarea
                    value={editingDescription}
                    onChange={(event) => setEditingDescription(event.target.value)}
                    placeholder="Description (optional)"
                    rows={3}
                    className="w-full rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
                      background: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      resize: 'vertical',
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextTitle = editingTitle.trim()
                        if (!nextTitle) return
                        onEditChecklistItem?.(item.index, nextTitle, editingDescription, item.modifiedAt)
                        setEditingIndex(null)
                        setEditingTitle('')
                        setEditingDescription('')
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
                        setEditingTitle('')
                        setEditingDescription('')
                      }}
                      className="rounded px-2 py-1 text-xs"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.checked) {
                          onUncheckChecklistItem?.(item.index, item.modifiedAt)
                        } else {
                          onCheckChecklistItem?.(item.index, item.modifiedAt)
                        }
                      }}
                      className="shrink-0 text-sm"
                      style={{ color: 'var(--vscode-foreground)' }}
                      aria-label={`${item.checked ? 'Uncheck' : 'Check'} task ${item.title}`}
                    >
                      {item.checked ? '☑' : '☐'}
                    </button>
                    <span
                      className={cn('min-w-0 flex-1 truncate text-sm', item.checked && 'opacity-70 line-through')}
                      style={{ color: 'var(--vscode-foreground)' }}
                    >
                      {item.title}
                    </span>
                    {item.modifiedAt && (
                      <span
                        className="shrink-0 text-xs"
                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                        title={item.modifiedAt}
                      >
                        {formatChecklistModifiedAt(item.modifiedAt)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIndex(item.index)
                        setEditingTitle(item.title)
                        setEditingDescription(item.description ?? '')
                      }}
                      className="shrink-0 rounded px-1 py-0.5 text-xs"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      disabled={!onEditChecklistItem}
                      aria-label="Edit task"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteChecklistItem?.(item.index, item.modifiedAt)}
                      className="shrink-0 rounded px-1 py-0.5 text-xs"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      disabled={!onDeleteChecklistItem}
                      aria-label="Delete task"
                    >
                      🗑️
                    </button>
                  </div>
                  {firstDescLine && (
                    <button
                      type="button"
                      onClick={() => setExpandedIndex(isExpanded ? null : item.index)}
                      className="mt-1 w-full text-left text-xs"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      {isExpanded ? item.description : firstDescLine}
                    </button>
                  )}
                </>
              )}
            </div>
          )
        }) : (
          <p className="text-sm italic" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            No tasks yet.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleAddTask()
            }
          }}
          placeholder="New task title..."
          className="w-full rounded border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
          }}
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="Description (optional)"
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
    </div>
  )
}


export function MarkdownEditor({ value, onChange, placeholder = 'Write markdown...', className, autoFocus, mode = 'create', comments, onAddComment, onUpdateComment, onDeleteComment, logs, onClearLogs, logsFilter, onLogsFilterChange, cardId, frontmatter, onFormSubmitSuccess, onAddChecklistItem, onEditChecklistItem, onDeleteChecklistItem, onCheckChecklistItem, onUncheckChecklistItem, currentMetadata, onMetadataChange, onMetadataInvalid }: MarkdownEditorProps) {
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
  const editorRef = useRef<CodeMirrorEditorHandle>(null)
  const activeBoard = useMemo(
    () => boards.find((board) => board.id === currentBoard),
    [boards, currentBoard],
  )
  const markdownExtensions = useMemo(() => [markdown()], [])
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
    if (activeTab === 'write') {
      editorRef.current?.focus()
    }
  }, [activeTab])

  // Initial auto-focus
  useEffect(() => {
    if (autoFocus) {
      editorRef.current?.focus()
    }
  }, [autoFocus])

  const handleFormat = useCallback((action: FormatAction) => {
    const editorView = editorRef.current?.getView()
    if (!editorView) return
    wrapEditorSelection(editorView, action)
  }, [])

  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const editorView = editorRef.current?.getView()
    if (!editorView) return

    // Tab key inserts spaces instead of changing focus
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const selection = editorView.state.selection.main
      editorView.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: '  ',
        },
        selection: {
          anchor: selection.from + 2,
          head: selection.from + 2,
        },
        userEvent: 'input',
      })
      editorView.focus()
      return
    }

    // Ctrl/Cmd+B for bold
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      e.stopPropagation()
      handleFormat('bold')
      return
    }
    // Ctrl/Cmd+I for italic
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      handleFormat('italic')
      return
    }
    // Ctrl/Cmd+K for link
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      handleFormat('link')
    }
  }, [handleFormat])

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
          {onMetadataChange && (
            <button
              type="button"
              onClick={() => setActiveTab('meta')}
              className={cn('card-markdown-tab', activeTab === 'meta' && 'is-active')}
            >
              Meta
            </button>
          )}
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
          <CodeMirrorEditor
            ref={editorRef}
            value={value}
            onChange={onChange}
            onKeyDown={handleEditorKeyDown}
            placeholder={placeholder}
            extensions={markdownExtensions}
            className="kl-codemirror-surface card-markdown-codemirror"
            fallbackTextareaClassName="markdown-editor-textarea"
            minHeight="200px"
            spellCheck={false}
            autoFocus={autoFocus}
            testId="card-markdown-editor"
            ariaLabel="Card markdown editor"
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
            cardId={cardId}
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
        {activeTab === 'meta' && onMetadataChange && (
          <MetadataEditorTab
            metadata={currentMetadata}
            onMetadataChange={onMetadataChange}
            onInvalidYaml={onMetadataInvalid}
          />
        )}
      </div>
    </div>
  )
}

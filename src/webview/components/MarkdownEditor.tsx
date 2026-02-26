import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { marked } from 'marked'
import { Heading, Bold, Italic, Quote, Code, Link, List, ListOrdered, ListChecks, MessageCircle } from 'lucide-react'
import type { Comment } from '../../shared/types'
import { cn } from '../lib/utils'
import { CommentsSection } from './CommentsSection'
import { wrapSelection, ToolbarButton, type FormatAction } from '../lib/markdownTools'

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
}


export function MarkdownEditor({ value, onChange, placeholder = 'Write markdown...', className, autoFocus, mode = 'create', comments, onAddComment, onUpdateComment, onDeleteComment }: MarkdownEditorProps) {
  const isEditMode = mode === 'edit'
  const writeLabel = isEditMode ? 'Edit' : 'Write'
  const [activeTab, setActiveTab] = useState<'write' | 'preview' | 'comments'>(isEditMode ? 'preview' : 'write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    <div className={cn('flex flex-col h-full', className)}>
      {/* Tab bar + toolbar */}
      <div
        className="flex items-center shrink-0"
        style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
      >
        {/* Tabs */}
        {(isEditMode ? ['preview', 'write'] as const : ['write', 'preview'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="px-3 py-2 text-xs font-medium transition-colors relative"
            style={{
              color: activeTab === tab ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)',
            }}
          >
            {tab === 'write' ? writeLabel : 'Preview'}
            {activeTab === tab && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t"
                style={{ background: 'var(--vscode-focusBorder)' }}
              />
            )}
          </button>
        ))}
        {comments && (
          <button
            type="button"
            onClick={() => setActiveTab('comments')}
            className="px-3 py-2 text-xs font-medium transition-colors relative flex items-center gap-1.5"
            style={{
              color: activeTab === 'comments' ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)',
            }}
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
            {activeTab === 'comments' && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t"
                style={{ background: 'var(--vscode-focusBorder)' }}
              />
            )}
          </button>
        )}

        {/* Toolbar - only visible on Write tab */}
        {activeTab === 'write' && (
          <div className="flex items-center ml-auto pr-2 gap-0.5">
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
        {activeTab === 'comments' && comments && onAddComment && onUpdateComment && onDeleteComment && (
          <CommentsSection
            comments={comments}
            onAddComment={onAddComment}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
          />
        )}
      </div>
    </div>
  )
}

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { marked } from 'marked'
import { Heading, Bold, Italic, Quote, Code, Link, List, ListOrdered, ListChecks, MessageCircle } from 'lucide-react'
import type { Comment } from '../../shared/types'
import { cn } from '../lib/utils'
import { CommentsSection } from './CommentsSection'

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

type FormatAction = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol' | 'tasklist'

function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  action: FormatAction
) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = value.substring(start, end)
  let before = value.substring(0, start)
  const after = value.substring(end)
  let replacement = selected
  let cursorOffset = 0

  switch (action) {
    case 'heading': {
      // Insert/cycle heading at line start
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const linePrefix = value.substring(lineStart, start)
      if (linePrefix.startsWith('### ')) {
        // Remove heading
        before = value.substring(0, lineStart) + linePrefix.slice(4)
        replacement = selected
        cursorOffset = -4
      } else if (linePrefix.startsWith('## ')) {
        before = value.substring(0, lineStart) + '### ' + linePrefix.slice(3)
        replacement = selected
        cursorOffset = 1
      } else if (linePrefix.startsWith('# ')) {
        before = value.substring(0, lineStart) + '## ' + linePrefix.slice(2)
        replacement = selected
        cursorOffset = 1
      } else {
        before = value.substring(0, lineStart) + '# ' + linePrefix
        replacement = selected
        cursorOffset = 2
      }
      break
    }
    case 'bold':
      replacement = selected ? `**${selected}**` : '**bold**'
      cursorOffset = selected ? 4 : 2
      break
    case 'italic':
      replacement = selected ? `_${selected}_` : '_italic_'
      cursorOffset = selected ? 2 : 1
      break
    case 'quote': {
      const lines = selected ? selected.split('\n').map(l => `> ${l}`).join('\n') : '> '
      replacement = lines
      cursorOffset = selected ? replacement.length - selected.length : 2
      break
    }
    case 'code':
      if (selected.includes('\n')) {
        replacement = `\`\`\`\n${selected}\n\`\`\``
        cursorOffset = 4
      } else {
        replacement = selected ? `\`${selected}\`` : '`code`'
        cursorOffset = selected ? 2 : 1
      }
      break
    case 'link':
      replacement = selected ? `[${selected}](url)` : '[text](url)'
      cursorOffset = selected ? selected.length + 3 : 1
      break
    case 'ul': {
      const ulLines = selected ? selected.split('\n').map(l => `- ${l}`).join('\n') : '- '
      replacement = ulLines
      cursorOffset = selected ? replacement.length - selected.length : 2
      break
    }
    case 'ol': {
      const olLines = selected ? selected.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') : '1. '
      replacement = olLines
      cursorOffset = selected ? replacement.length - selected.length : 3
      break
    }
    case 'tasklist': {
      const tlLines = selected ? selected.split('\n').map(l => `- [ ] ${l}`).join('\n') : '- [ ] '
      replacement = tlLines
      cursorOffset = selected ? replacement.length - selected.length : 6
      break
    }
  }

  const newValue = before + replacement + after
  onChange(newValue)
  requestAnimationFrame(() => {
    textarea.focus()
    const newPos = start + (selected ? replacement.length : cursorOffset)
    textarea.selectionStart = textarea.selectionEnd = newPos
  })
}

interface ToolbarButtonProps {
  icon: React.ReactNode
  title: string
  onClick: () => void
  separator?: boolean
}

function ToolbarButton({ icon, title, onClick, separator }: ToolbarButtonProps) {
  return (
    <>
      {separator && (
        <div
          className="w-px h-4 mx-1"
          style={{ background: 'var(--vscode-panel-border)' }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--vscode-descriptionForeground)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {icon}
      </button>
    </>
  )
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

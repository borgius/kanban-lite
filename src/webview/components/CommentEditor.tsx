// src/webview/components/CommentEditor.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bold, Italic, Quote, Code, Link, List, ListOrdered } from 'lucide-react'
import { wrapSelection, ToolbarButton, parseCommentMarkdown, type FormatAction } from '../lib/markdownTools'

const AUTHOR_KEY = 'kanban-comment-author'

interface CommentEditorProps {
  initialContent?: string
  onSubmit: (author: string, content: string) => void
  onCancel?: () => void
  submitLabel?: string
}

export function CommentEditor({
  initialContent = '',
  onSubmit,
  onCancel,
  submitLabel = 'Comment',
}: CommentEditorProps) {
  const [author, setAuthor] = useState(() => localStorage.getItem(AUTHOR_KEY) ?? '')
  const [content, setContent] = useState(initialContent)
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (activeTab === 'write') {
      textareaRef.current?.focus()
    }
  }, [activeTab])

  const previewHtml = useMemo(() => {
    if (!content.trim()) return ''
    return parseCommentMarkdown(content)
  }, [content])

  const handleFormat = useCallback((action: FormatAction) => {
    if (textareaRef.current) {
      wrapSelection(textareaRef.current, content, setContent, action)
    }
  }, [content])

  const handleSubmit = () => {
    const trimmedAuthor = author.trim()
    const trimmedContent = content.trim()
    if (!trimmedAuthor || !trimmedContent) return
    localStorage.setItem(AUTHOR_KEY, trimmedAuthor)
    onSubmit(trimmedAuthor, trimmedContent)
    if (!initialContent) {
      setContent('')
      setActiveTab('write')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault()
      handleFormat('bold')
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault()
      handleFormat('italic')
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      handleFormat('link')
    }
  }

  const canSubmit = author.trim().length > 0 && content.trim().length > 0

  return (
    <div className="comment-editor-shell">
      <input
        type="text"
        value={author}
        onChange={e => setAuthor(e.target.value)}
        placeholder="Your name"
        aria-label="Comment author name"
        className="comment-editor-author outline-none"
        style={{ color: 'var(--vscode-foreground)' }}
      />

      <div
        className="comment-editor-frame"
      >
        <div className="comment-editor-tabs">
          {(['write', 'preview'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`comment-editor-tab${activeTab === tab ? ' is-active' : ''}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'write' ? (
          <>
            <div className="comment-editor-toolbar">
              <ToolbarButton icon={<Bold size={12} />} title="Bold (Cmd+B)" onClick={() => handleFormat('bold')} />
              <ToolbarButton icon={<Italic size={12} />} title="Italic (Cmd+I)" onClick={() => handleFormat('italic')} />
              <ToolbarButton icon={<Quote size={12} />} title="Quote" onClick={() => handleFormat('quote')} separator />
              <ToolbarButton icon={<Code size={12} />} title="Code" onClick={() => handleFormat('code')} />
              <ToolbarButton icon={<Link size={12} />} title="Link (Cmd+K)" onClick={() => handleFormat('link')} separator />
              <ToolbarButton icon={<List size={12} />} title="Unordered list" onClick={() => handleFormat('ul')} separator />
              <ToolbarButton icon={<ListOrdered size={12} />} title="Ordered list" onClick={() => handleFormat('ol')} />
            </div>

            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment... (Markdown supported)"
              className="comment-editor-textarea text-xs outline-none"
              style={{ color: 'var(--vscode-foreground)' }}
              rows={5}
            />
          </>
        ) : (
          previewHtml ? (
            // eslint-disable-next-line react/no-danger
            <div
              className="comment-editor-preview text-xs comment-markdown"
              style={{ color: 'var(--vscode-foreground)' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <div
              className="comment-editor-empty text-xs"
              style={{ color: 'var(--vscode-descriptionForeground)' }}
            >
              Nothing to preview
            </div>
          )
        )}
      </div>

      <div className="comment-editor-actions">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs rounded transition-colors"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="card-inline-action card-inline-action--solid disabled:opacity-30"
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
          }}
          title={`${submitLabel} (Cmd+Enter)`}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

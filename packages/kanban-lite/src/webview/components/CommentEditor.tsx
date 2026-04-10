// src/webview/components/CommentEditor.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { Bold, Italic, Quote, Code, Link, List, ListOrdered } from 'lucide-react'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { wrapEditorSelection, ToolbarButton, parseCommentMarkdown, type FormatAction } from '../lib/markdownTools'
import { useStore } from '../store'

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
  const currentUser = useStore((state) => state.currentUser)
  const suggestedAuthor = currentUser.trim() || 'User'
  const [author, setAuthor] = useState(suggestedAuthor)
  const [content, setContent] = useState(initialContent)
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const [editorResetKey, setEditorResetKey] = useState(0)
  const editorRef = useRef<CodeMirrorEditorHandle>(null)
  const isFirstRender = useRef(true)
  const lastSuggestedAuthorRef = useRef(suggestedAuthor)
  const markdownExtensions = useMemo(() => [markdown()], [])

  useEffect(() => {
    const previousSuggestedAuthor = lastSuggestedAuthorRef.current
    setAuthor((currentAuthor) => {
      if (currentAuthor.trim().length === 0 || currentAuthor === previousSuggestedAuthor) {
        return suggestedAuthor
      }

      return currentAuthor
    })
    lastSuggestedAuthorRef.current = suggestedAuthor
  }, [suggestedAuthor])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (activeTab === 'write') {
      editorRef.current?.focus()
    }
  }, [activeTab])

  useEffect(() => {
    if (editorResetKey > 0) {
      editorRef.current?.focus()
    }
  }, [editorResetKey])

  const previewHtml = useMemo(() => {
    if (!content.trim()) return ''
    return parseCommentMarkdown(content)
  }, [content])

  const handleFormat = useCallback((action: FormatAction) => {
    const editorView = editorRef.current?.getView()
    if (!editorView) return
    wrapEditorSelection(editorView, action)
  }, [])

  const handleSubmit = () => {
    const trimmedAuthor = author.trim()
    const trimmedContent = content.trim()
    if (!trimmedAuthor || !trimmedContent) return
    onSubmit(trimmedAuthor, trimmedContent)
    if (!initialContent) {
      setContent('')
      setActiveTab('write')
      setEditorResetKey(value => value + 1)
    }
  }

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const editorView = editorRef.current?.getView()
    if (!editorView) return

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
      return
    }
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

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      e.stopPropagation()
      handleFormat('bold')
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      handleFormat('italic')
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
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

            <CodeMirrorEditor
              key={editorResetKey}
              ref={editorRef}
              value={content}
              onChange={setContent}
              onKeyDown={handleEditorKeyDown}
              placeholder="Add a comment... (Markdown supported)"
              extensions={markdownExtensions}
              className="comment-editor-codemirror"
              fallbackTextareaClassName="comment-editor-textarea"
              fallbackTextareaStyle={{
                color: 'var(--vscode-foreground)',
                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                fontSize: 'var(--vscode-editor-font-size, 13px)',
              }}
              minHeight="140px"
              spellCheck={false}
              testId="comment-markdown-editor"
              ariaLabel="Comment markdown editor"
            />
          </>
        ) : (
          previewHtml ? (
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

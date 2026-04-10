// src/webview/components/CommentEditor.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { Bold, Italic, Quote, Code, Link, List, ListOrdered, Mic, Trash2 } from 'lucide-react'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { wrapEditorSelection, ToolbarButton, parseCommentMarkdown, type FormatAction } from '../lib/markdownTools'
import { buildVoiceCommentContent, parseVoiceCommentContent, type VoiceCommentAttachmentRef } from '../../shared/voiceComments'
import { useStore } from '../store'
import { getVsCodeApi } from '../vsCodeApi'
import { VoiceCommentPlayer } from './VoiceCommentPlayer'
import { VoiceCommentRecorder } from './VoiceCommentRecorder'

interface CommentEditorProps {
  cardId?: string
  initialContent?: string
  onSubmit: (author: string, content: string) => void
  onCancel?: () => void
  submitLabel?: string
}

export function CommentEditor({
  cardId,
  initialContent = '',
  onSubmit,
  onCancel,
  submitLabel = 'Comment',
}: CommentEditorProps) {
  const initialParsedContent = useMemo(() => parseVoiceCommentContent(initialContent), [initialContent])
  const currentUser = useStore((state) => state.currentUser)
  const suggestedAuthor = currentUser.trim() || 'User'
  const [author, setAuthor] = useState(suggestedAuthor)
  const [content, setContent] = useState(initialParsedContent.note)
  const [voiceAttachment, setVoiceAttachment] = useState<VoiceCommentAttachmentRef | null>(initialParsedContent.voiceAttachment)
  const [draftVoiceAttachmentFilename, setDraftVoiceAttachmentFilename] = useState<string | null>(null)
  const [isRecorderOpen, setIsRecorderOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const [editorResetKey, setEditorResetKey] = useState(0)
  const editorRef = useRef<CodeMirrorEditorHandle>(null)
  const isFirstRender = useRef(true)
  const lastSuggestedAuthorRef = useRef(suggestedAuthor)
  const draftVoiceAttachmentFilenameRef = useRef<string | null>(null)
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

  useEffect(() => {
    draftVoiceAttachmentFilenameRef.current = draftVoiceAttachmentFilename
  }, [draftVoiceAttachmentFilename])

  useEffect(() => {
    return () => {
      const draftFilename = draftVoiceAttachmentFilenameRef.current
      if (cardId && draftFilename) {
        getVsCodeApi().postMessage({ type: 'removeAttachment', cardId, attachment: draftFilename })
        draftVoiceAttachmentFilenameRef.current = null
      }
    }
  }, [cardId])

  const previewHtml = useMemo(() => {
    if (!content.trim()) return ''
    return parseCommentMarkdown(content)
  }, [content])

  const hasDraftVoiceAttachment = draftVoiceAttachmentFilename !== null && draftVoiceAttachmentFilename === voiceAttachment?.filename

  const clearDraftVoiceAttachment = useCallback(() => {
    const draftFilename = draftVoiceAttachmentFilenameRef.current
    if (!draftFilename) {
      return
    }

    if (cardId) {
      getVsCodeApi().postMessage({ type: 'removeAttachment', cardId, attachment: draftFilename })
    }

    draftVoiceAttachmentFilenameRef.current = null
    setDraftVoiceAttachmentFilename(null)
    setVoiceAttachment((currentAttachment) => currentAttachment?.filename === draftFilename ? null : currentAttachment)
  }, [cardId])

  const handleRecorderAttached = useCallback((nextVoiceAttachment: VoiceCommentAttachmentRef) => {
    draftVoiceAttachmentFilenameRef.current = nextVoiceAttachment.filename
    setDraftVoiceAttachmentFilename(nextVoiceAttachment.filename)
    setVoiceAttachment(nextVoiceAttachment)
    setIsRecorderOpen(false)
  }, [])

  const renderVoiceAttachmentSummary = useCallback(() => {
    if (!voiceAttachment) {
      return null
    }

    return (
      <div className="comment-editor-voice-summary">
        <VoiceCommentPlayer
          cardId={cardId}
          voiceAttachment={voiceAttachment}
          label={hasDraftVoiceAttachment ? 'Attached voice comment' : 'Voice comment'}
        />
        {hasDraftVoiceAttachment && (
          <button
            type="button"
            onClick={clearDraftVoiceAttachment}
            className="comment-editor-voice-discard"
            title="Discard attached voice draft"
          >
            <Trash2 size={12} />
            <span>Discard draft audio</span>
          </button>
        )}
      </div>
    )
  }, [cardId, clearDraftVoiceAttachment, hasDraftVoiceAttachment, voiceAttachment])

  const handleFormat = useCallback((action: FormatAction) => {
    const editorView = editorRef.current?.getView()
    if (!editorView) return
    wrapEditorSelection(editorView, action)
  }, [])

  const handleSubmit = () => {
    const trimmedAuthor = author.trim()
    const trimmedContent = content.trim()
    if (!trimmedAuthor || (!trimmedContent && !voiceAttachment)) return

    const nextContent = voiceAttachment
      ? buildVoiceCommentContent({ voiceAttachment, note: content })
      : trimmedContent

    draftVoiceAttachmentFilenameRef.current = null
    setDraftVoiceAttachmentFilename(null)
    onSubmit(trimmedAuthor, nextContent)
    if (!initialContent) {
      setContent('')
      setVoiceAttachment(null)
      setIsRecorderOpen(false)
      setActiveTab('write')
      setEditorResetKey(value => value + 1)
    }
  }

  const handleCancel = () => {
    clearDraftVoiceAttachment()
    onCancel?.()
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

  const canSubmit = author.trim().length > 0 && (content.trim().length > 0 || voiceAttachment !== null)
  const canOpenRecorder = Boolean(cardId) && voiceAttachment === null

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
              <div
                className="w-px h-4 mx-1"
                style={{ background: 'var(--vscode-panel-border)' }}
              />
              <button
                type="button"
                onClick={() => {
                  if (canOpenRecorder) {
                    setIsRecorderOpen((current) => !current)
                  }
                }}
                title={canOpenRecorder ? 'Record voice comment' : 'Voice comment already attached'}
                disabled={!canOpenRecorder}
                className={`comment-editor-voice-toolbar-button${isRecorderOpen ? ' is-active' : ''}`}
              >
                <Mic size={12} />
              </button>
            </div>

            {voiceAttachment && renderVoiceAttachmentSummary()}

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
          previewHtml || voiceAttachment ? (
            <div className="comment-editor-preview-stack">
              {voiceAttachment && renderVoiceAttachmentSummary()}
              {previewHtml && (
                <div
                  className="comment-editor-preview text-xs comment-markdown"
                  style={{ color: 'var(--vscode-foreground)' }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
            </div>
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

      {isRecorderOpen && cardId && !voiceAttachment && (
        <VoiceCommentRecorder
          cardId={cardId}
          onAttached={handleRecorderAttached}
          onClose={() => setIsRecorderOpen(false)}
        />
      )}

      <div className="comment-editor-actions">
        {onCancel && (
          <button
            type="button"
            onClick={handleCancel}
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

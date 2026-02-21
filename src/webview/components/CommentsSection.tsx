import { useState, useRef } from 'react'
import { Send, Pencil, Trash2 } from 'lucide-react'
import type { Comment } from '../../shared/types'

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

interface CommentsSectionProps {
  comments: Comment[]
  onAddComment: (author: string, content: string) => void
  onUpdateComment: (commentId: string, content: string) => void
  onDeleteComment: (commentId: string) => void
}

export function CommentsSection({ comments, onAddComment, onUpdateComment, onDeleteComment }: CommentsSectionProps) {
  const [newAuthor, setNewAuthor] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const author = newAuthor.trim()
    const content = newContent.trim()
    if (!author || !content) return
    onAddComment(author, content)
    setNewContent('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const startEdit = (comment: Comment) => {
    setEditingId(comment.id)
    setEditContent(comment.content)
  }

  const saveEdit = () => {
    if (!editingId || !editContent.trim()) return
    onUpdateComment(editingId, editContent.trim())
    setEditingId(null)
    setEditContent('')
  }

  return (
    <div className="flex flex-col">
      {/* Comment list */}
      {comments.length > 0 && (
        <div className="flex flex-col gap-1 px-4 pb-2">
          {comments.map(comment => (
            <div
              key={comment.id}
              className="rounded p-2 text-xs group"
              style={{ background: 'var(--vscode-input-background)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{
                      background: 'var(--vscode-badge-background)',
                      color: 'var(--vscode-badge-foreground)',
                    }}
                  >
                    {comment.author.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--vscode-foreground)' }}>
                    {comment.author}
                  </span>
                  <span style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {timeAgo(comment.created)}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(comment)}
                    className="p-0.5 rounded transition-colors vscode-hover-bg"
                    style={{ color: 'var(--vscode-descriptionForeground)' }}
                    title="Edit"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    onClick={() => onDeleteComment(comment.id)}
                    className="p-0.5 rounded transition-colors hover:text-red-500"
                    style={{ color: 'var(--vscode-descriptionForeground)' }}
                    title="Delete"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              {editingId === comment.id ? (
                <div className="flex flex-col gap-1 mt-1">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full rounded px-2 py-1 text-xs resize-none outline-none"
                    style={{
                      background: 'var(--vscode-editor-background)',
                      color: 'var(--vscode-foreground)',
                      border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
                    }}
                    rows={2}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        saveEdit()
                      }
                      if (e.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    autoFocus
                  />
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-0.5 text-[10px] rounded transition-colors vscode-hover-bg"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors"
                      style={{
                        background: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="whitespace-pre-wrap"
                  style={{ color: 'var(--vscode-foreground)' }}
                >
                  {comment.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add comment form */}
      <div className="px-4 pb-3 flex flex-col gap-1.5">
        <input
          type="text"
          value={newAuthor}
          onChange={e => setNewAuthor(e.target.value)}
          placeholder="Your name"
          className="w-full rounded px-2 py-1 text-xs outline-none"
          style={{
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-foreground)',
            border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
          }}
        />
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment..."
            className="flex-1 rounded px-2 py-1 text-xs resize-none outline-none"
            style={{
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-foreground)',
              border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
            }}
            rows={2}
          />
          <button
            onClick={handleSubmit}
            disabled={!newAuthor.trim() || !newContent.trim()}
            className="shrink-0 p-1.5 rounded transition-colors disabled:opacity-30"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
            title="Send (Cmd+Enter)"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { parseCommentMarkdown } from '../lib/markdownTools'
import type { Comment } from '../../shared/types'
import { CommentEditor } from './CommentEditor'

function CommentBody({ content }: { content: string }) {
  const html = useMemo(() => parseCommentMarkdown(content), [content])
  return (
    <div
      className="comment-markdown"
      style={{ color: 'var(--vscode-foreground)' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

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
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="card-comments-shell">
      {comments.length > 0 && (
        <div className="card-comment-list">
          {comments.map(comment => (
            <div
              key={comment.id}
              className={`card-comment-item${comment.streaming ? ' card-comment-streaming' : ''}`}
            >
              <span className="card-comment-avatar">
                {comment.author.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </span>
              <div className="card-comment-bubble">
                <div className="card-comment-meta">
                  <span className="card-comment-author">{comment.author}</span>
                  {comment.streaming && (
                    <span className="card-comment-streaming-badge" title="Being written by an agent…">streaming</span>
                  )}
                  <span className="card-comment-time">{timeAgo(comment.created)}</span>
                  {!comment.streaming && (
                    <div className="card-comment-actions">
                      <button
                        onClick={() => setEditingId(comment.id)}
                        className="p-1 rounded-full transition-colors vscode-hover-bg"
                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => onDeleteComment(comment.id)}
                        className="p-1 rounded-full transition-colors hover:text-red-500"
                        style={{ color: 'var(--vscode-descriptionForeground)' }}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {editingId === comment.id ? (
                  <div className="mt-1">
                    <CommentEditor
                      initialContent={comment.content}
                      submitLabel="Save"
                      onSubmit={(_, content) => {
                        onUpdateComment(comment.id, content)
                        setEditingId(null)
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <div className="card-comment-content-wrap">
                    <CommentBody content={comment.content} />
                    {comment.streaming && <span className="card-comment-cursor" aria-hidden="true" />}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card-comments-composer">
        <CommentEditor
          onSubmit={(author, content) => onAddComment(author, content)}
          submitLabel="Comment"
        />
      </div>
    </div>
  )
}

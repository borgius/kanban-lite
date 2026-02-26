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
    <div className="flex flex-col">
      {comments.length > 0 && (
        <div className="flex flex-col gap-2 px-4 py-3">
          {comments.map(comment => (
            <div
              key={comment.id}
              className="rounded p-2 pl-3 text-xs group"
              style={{
                background: 'var(--vscode-input-background)',
                borderLeft: '2px solid var(--vscode-textLink-foreground, #3b82f6)',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
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
                  <span className="text-[10px]" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {timeAgo(comment.created)}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditingId(comment.id)}
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
                <CommentBody content={comment.content} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pb-3">
        <CommentEditor
          onSubmit={(author, content) => onAddComment(author, content)}
          submitLabel="Comment"
        />
      </div>
    </div>
  )
}

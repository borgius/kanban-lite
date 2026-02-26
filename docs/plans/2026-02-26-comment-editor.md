# Comment Editor Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bare textarea comment forms with a GitHub-style editor featuring Write/Preview tabs, a markdown toolbar, and localStorage-backed author name.

**Architecture:** Extract `wrapSelection` + `ToolbarButton` to a shared module so both `MarkdownEditor` and the new `CommentEditor` can use them without duplication. Create `CommentEditor` as a self-contained component used in both add-new and edit-existing flows inside `CommentsSection`.

**Tech Stack:** React, TypeScript, lucide-react, marked (already in use), Tailwind CSS (via class names), VSCode CSS custom properties for theming.

---

### Task 1: Extract shared markdown toolbar utilities

The `wrapSelection` function and `ToolbarButton` component currently live only in `MarkdownEditor.tsx`. Both will also be needed in `CommentEditor`. Extract them to avoid duplication.

**Files:**
- Create: `src/webview/lib/markdownTools.ts`
- Modify: `src/webview/components/MarkdownEditor.tsx`

> No webview component tests exist in this project. Manual verification instructions are provided instead.

**Step 1: Create `src/webview/lib/markdownTools.ts`**

Copy the `wrapSelection` function and `ToolbarButton` component out of `MarkdownEditor.tsx` into this new file. Export both.

```ts
// src/webview/lib/markdownTools.ts
import type React from 'react'

export type FormatAction = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol' | 'tasklist'

export function wrapSelection(
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
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const linePrefix = value.substring(lineStart, start)
      if (linePrefix.startsWith('### ')) {
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

export function ToolbarButton({ icon, title, onClick, separator }: ToolbarButtonProps) {
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
```

**Step 2: Update `MarkdownEditor.tsx` to import from the shared module**

At the top of `MarkdownEditor.tsx`:
- Remove the local `FormatAction` type definition and `wrapSelection` function (lines 21–116).
- Remove the local `ToolbarButtonProps` interface and `ToolbarButton` function (lines 118–147).
- Add this import:

```ts
import { wrapSelection, ToolbarButton, type FormatAction } from '../lib/markdownTools'
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Build and manually verify**

```bash
npm run build
```

Open the extension in VSCode, open a card — the card body editor should still work exactly as before (Write/Preview/Comments tabs, all toolbar buttons functional).

**Step 5: Commit**

```bash
git add src/webview/lib/markdownTools.ts src/webview/components/MarkdownEditor.tsx
git commit -m "refactor(webview): extract wrapSelection and ToolbarButton to markdownTools"
```

---

### Task 2: Create the `CommentEditor` component

**Files:**
- Create: `src/webview/components/CommentEditor.tsx`

**Step 1: Create `src/webview/components/CommentEditor.tsx`**

```tsx
// src/webview/components/CommentEditor.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Marked } from 'marked'
import { Bold, Italic, Quote, Code, Link, List, ListOrdered } from 'lucide-react'
import { wrapSelection, ToolbarButton, type FormatAction } from '../lib/markdownTools'

const AUTHOR_KEY = 'kanban-comment-author'

// Reuse the same GFM + autolink renderer from CommentsSection
const commentMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  }
})

function parseCommentMarkdown(content: string): string {
  const processed = content.replace(
    /(?<!\]\(|"|'|<)(https?:\/\/[^\s<>\])"']+)/g,
    '<$1>'
  )
  return commentMarked.parse(processed, { async: false }) as string
}

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

  // Focus textarea on mount and when switching to write tab
  useEffect(() => {
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
      // Only clear content for add-new mode; edit mode is unmounted by parent
      setContent('')
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
    <div className="flex flex-col gap-1.5">
      {/* Author input */}
      <input
        type="text"
        value={author}
        onChange={e => setAuthor(e.target.value)}
        placeholder="Your name"
        className="w-full rounded px-2 py-1 text-xs outline-none"
        style={{
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-foreground)',
          border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
        }}
      />

      {/* Editor box */}
      <div
        className="flex flex-col rounded overflow-hidden"
        style={{ border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))' }}
      >
        {/* Tab row */}
        <div
          className="flex items-center"
          style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
        >
          {(['write', 'preview'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="px-3 py-1.5 text-xs font-medium transition-colors relative capitalize"
              style={{
                color: activeTab === tab
                  ? 'var(--vscode-foreground)'
                  : 'var(--vscode-descriptionForeground)',
                background: 'transparent',
              }}
            >
              {tab}
              {activeTab === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t"
                  style={{ background: 'var(--vscode-focusBorder)' }}
                />
              )}
            </button>
          ))}
        </div>

        {activeTab === 'write' ? (
          <>
            {/* Toolbar */}
            <div
              className="flex items-center px-1 py-0.5"
              style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
            >
              <ToolbarButton icon={<Bold size={12} />} title="Bold (Cmd+B)" onClick={() => handleFormat('bold')} />
              <ToolbarButton icon={<Italic size={12} />} title="Italic (Cmd+I)" onClick={() => handleFormat('italic')} />
              <ToolbarButton icon={<Quote size={12} />} title="Quote" onClick={() => handleFormat('quote')} separator />
              <ToolbarButton icon={<Code size={12} />} title="Code" onClick={() => handleFormat('code')} />
              <ToolbarButton icon={<Link size={12} />} title="Link (Cmd+K)" onClick={() => handleFormat('link')} separator />
              <ToolbarButton icon={<List size={12} />} title="Unordered list" onClick={() => handleFormat('ul')} separator />
              <ToolbarButton icon={<ListOrdered size={12} />} title="Ordered list" onClick={() => handleFormat('ol')} />
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment... (Markdown supported)"
              className="w-full px-2 py-1.5 text-xs resize-none outline-none"
              style={{
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-foreground)',
                minHeight: '72px',
              }}
              rows={3}
            />
          </>
        ) : (
          /* Preview */
          <div
            className="px-2 py-1.5 text-xs comment-markdown"
            style={{
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-foreground)',
              minHeight: '72px',
            }}
            dangerouslySetInnerHTML={{ __html: previewHtml || '<span style="opacity:0.5">Nothing to preview</span>' }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-1.5">
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
          className="px-2.5 py-1 text-xs font-medium rounded transition-colors disabled:opacity-30"
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
          }}
          title="Submit (Cmd+Enter)"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/webview/components/CommentEditor.tsx
git commit -m "feat(webview): add CommentEditor component with Write/Preview tabs and toolbar"
```

---

### Task 3: Update `CommentsSection` to use `CommentEditor`

**Files:**
- Modify: `src/webview/components/CommentsSection.tsx`

**Step 1: Rewrite `CommentsSection.tsx`**

Replace the file content entirely with the following. Changes from the current version:
- Import `CommentEditor` instead of managing `newAuthor`/`newContent` state locally.
- Remove `handleSubmit`, `handleKeyDown`, `textareaRef` (all moved into `CommentEditor`).
- Replace the add-new `<input>` + `<textarea>` + Send button with `<CommentEditor>`.
- Replace the edit inline `<textarea>` + Save/Cancel buttons with `<CommentEditor initialContent onCancel submitLabel="Save">`.
- Keep `commentMarked`, `parseCommentMarkdown`, `CommentBody`, and `timeAgo` helpers unchanged — but since `CommentEditor` also defines `commentMarked`/`parseCommentMarkdown`, extract those to the shared `markdownTools.ts` in step 2 of this task.

> **Note:** For now, keep `commentMarked` and `parseCommentMarkdown` duplicated in `CommentsSection` (they're already there and correct). We'll clean that up after the smoke test. See step 2.

```tsx
// src/webview/components/CommentsSection.tsx
import { useState, useMemo } from 'react'
import { Marked } from 'marked'
import { Pencil, Trash2 } from 'lucide-react'
import type { Comment } from '../../shared/types'
import { CommentEditor } from './CommentEditor'

const commentMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  }
})

function parseCommentMarkdown(content: string): string {
  const processed = content.replace(
    /(?<!\]\(|"|'|<)(https?:\/\/[^\s<>\])"']+)/g,
    '<$1>'
  )
  return commentMarked.parse(processed, { async: false }) as string
}

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
      {/* Comment list */}
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

      {/* Add comment */}
      <div className="px-4 pb-3">
        <CommentEditor
          onSubmit={(author, content) => onAddComment(author, content)}
          submitLabel="Comment"
        />
      </div>
    </div>
  )
}
```

**Step 2: Move `commentMarked` / `parseCommentMarkdown` to `markdownTools.ts` to eliminate duplication**

Add the following to `src/webview/lib/markdownTools.ts` (append after the existing exports):

```ts
import { Marked } from 'marked'

export const commentMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  }
})

export function parseCommentMarkdown(content: string): string {
  const processed = content.replace(
    /(?<!\]\(|"|'|<)(https?:\/\/[^\s<>\])"']+)/g,
    '<$1>'
  )
  return commentMarked.parse(processed, { async: false }) as string
}
```

Then update both `CommentsSection.tsx` and `CommentEditor.tsx`:
- Remove their local `commentMarked` and `parseCommentMarkdown` definitions.
- Remove the `import { Marked } from 'marked'` line (no longer needed in those files).
- Add `import { parseCommentMarkdown } from '../lib/markdownTools'` (and `commentMarked` if used directly — `CommentsSection` doesn't use `commentMarked` directly, only `parseCommentMarkdown`).

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Build**

```bash
npm run build
```

Expected: build completes with no errors.

**Step 5: Manual smoke test**

Open the extension in VSCode:
1. Open any card → go to Comments tab.
2. **Add-new form:** Author field pre-fills from localStorage (or is empty on first use). Write/Preview tabs visible. Toolbar buttons work (select text, click Bold → wraps in `**`). Preview renders markdown. Cmd+Enter submits. After submit, author saved to localStorage; reopen card and author is pre-filled.
3. **Edit existing:** Hover a comment → pencil icon → editor opens with content pre-filled, author field visible. Save updates. Cancel restores view. Escape key should close (this is handled by the `onCancel` prop).
4. **Delete:** Red trash icon still deletes comment.
5. **Disabled state:** Clear author field → Comment button grays out.

**Step 6: Commit**

```bash
git add src/webview/components/CommentsSection.tsx src/webview/components/CommentEditor.tsx src/webview/lib/markdownTools.ts
git commit -m "feat(webview): GitHub-style comment editor with Write/Preview tabs and toolbar"
```

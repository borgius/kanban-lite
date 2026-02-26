# Comment Editor Redesign — Design Doc

**Date:** 2026-02-26
**Status:** Approved

## Problem

The comment add/edit forms in `CommentsSection` are bare textareas with no toolbar and no preview. They look visually inconsistent with the card body editor and lack basic markdown authoring support.

## Goal

GitHub-style comment editor: Write/Preview tabs, a markdown toolbar, and remembered author name — reused for both "add new" and "edit existing" comment flows.

## Approach

Extract a new `CommentEditor` component (Option A). It gets exactly the toolbar buttons comments need, has Write/Preview tabs, and is used in both add and edit modes inside `CommentsSection`. No other files need changes.

## Component: `CommentEditor`

**File:** `src/webview/components/CommentEditor.tsx`

### Props

```ts
interface CommentEditorProps {
  initialContent?: string   // pre-filled for edit mode; empty for add mode
  onSubmit: (author: string, content: string) => void
  onCancel?: () => void     // rendered only when provided (edit mode)
  submitLabel?: string      // "Comment" (default) | "Save"
}
```

### Author Name

- Read from `localStorage.getItem('kanban-comment-author')` on mount.
- Rendered as a compact single-line input above the tab row.
- Saved to `localStorage` on successful submit.

### Tabs

Two tabs at the top of the bordered editor box:

- **Write** — textarea with toolbar above it.
- **Preview** — rendered markdown using `commentMarked` (same instance as today, with GFM autolink).

Active tab indicated by a bottom border (GitHub style). Tabs switch on click; no keyboard navigation required.

### Toolbar (Write tab only)

Buttons: Bold · Italic · Quote · Code · Link · Unordered list · Ordered list.

Uses the same `wrapSelection` helper logic already in `MarkdownEditor`. No heading or tasklist buttons (not appropriate for comments).

Icons from `lucide-react`. Color: `var(--vscode-descriptionForeground)`. Hover: `vscode-hover-bg`.

### Footer

Right-aligned row below the editor box:

- **Cancel** button — only rendered when `onCancel` is provided (edit mode).
- **Submit** button — label from `submitLabel` prop; disabled when author or content is empty.
- `Cmd/Ctrl+Enter` submits from the textarea.

### Visual Style

- Outer box has `border: 1px solid var(--vscode-input-border)` and a focus ring on focus.
- Tabs sit flush with the top of the box.
- Toolbar row sits between tabs and textarea inside the box.
- Matches GitHub comment box proportions at a VSCode-theme scale.

## Changes to `CommentsSection`

1. **Add-new form** — replace `<input>` (author) + `<textarea>` + Send icon with a single `<CommentEditor submitLabel="Comment" onSubmit={...} />`.
2. **Edit mode** — replace the inline `<textarea>` + Save/Cancel buttons with `<CommentEditor initialContent={comment.content} submitLabel="Save" onSubmit={...} onCancel={...} />`.
3. Remove local state: `newAuthor`, `newContent`, `handleSubmit`, `handleKeyDown` (all move into `CommentEditor`).

## Files Changed

| File | Change |
|------|--------|
| `src/webview/components/CommentEditor.tsx` | New file |
| `src/webview/components/CommentsSection.tsx` | Replace add/edit forms with `<CommentEditor>` |

No changes to `MarkdownEditor`, `FeatureEditor`, `App.tsx`, types, or store.

## Testing

- Add a comment: author pre-filled from localStorage, write tab active, toolbar wraps selection, preview renders markdown, submit fires `onAddComment`, author saved to localStorage.
- Edit a comment: content pre-filled, tabs work, cancel restores view, save fires `onUpdateComment`.
- Disabled state: submit button disabled when author or content empty.

// src/webview/lib/markdownTools.tsx
import { Marked } from 'marked'
import type React from 'react'
import type { EditorView } from '@uiw/react-codemirror'

export type FormatAction = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol' | 'tasklist'

interface FormatSelectionResult {
  nextValue: string
  selectionStart: number
  selectionEnd: number
}

export function formatMarkdownSelection(value: string, start: number, end: number, action: FormatAction): FormatSelectionResult {
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

  const nextValue = before + replacement + after
  const nextCursor = start + (selected ? replacement.length : cursorOffset)

  return {
    nextValue,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  }
}

export function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  action: FormatAction
) {
  const result = formatMarkdownSelection(value, textarea.selectionStart, textarea.selectionEnd, action)
  onChange(result.nextValue)
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.selectionStart = result.selectionStart
    textarea.selectionEnd = result.selectionEnd
  })
}

export function wrapEditorSelection(editorView: EditorView, action: FormatAction) {
  const selection = editorView.state.selection.main
  const result = formatMarkdownSelection(editorView.state.doc.toString(), selection.from, selection.to, action)

  editorView.dispatch({
    changes: {
      from: 0,
      to: editorView.state.doc.length,
      insert: result.nextValue,
    },
    selection: {
      anchor: result.selectionStart,
      head: result.selectionEnd,
    },
    userEvent: 'input',
  })
  editorView.focus()
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

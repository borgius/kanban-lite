import type { CardFrontmatter } from './types'

export type { CardFrontmatter }

// Messages from the extension to the editor webview
export type EditorExtensionMessage =
  | { type: 'init'; content: string; frontmatter: CardFrontmatter | null; fileName: string }

// Messages from the editor webview to the extension
export type EditorWebviewMessage =
  | { type: 'ready' }
  | { type: 'frontmatterUpdate'; frontmatter: CardFrontmatter }
  | { type: 'requestSave' }
  | { type: 'startWithAI'; agent?: 'claude' | 'codex' | 'opencode'; permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' }

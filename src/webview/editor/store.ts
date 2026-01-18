import { create } from 'zustand'
import type { FeatureFrontmatter } from '../../shared/editorTypes'

interface EditorState {
  content: string
  frontmatter: FeatureFrontmatter | null
  fileName: string
  isDarkMode: boolean

  setContent: (content: string) => void
  setFrontmatter: (frontmatter: FeatureFrontmatter) => void
  setFileName: (fileName: string) => void
  setIsDarkMode: (dark: boolean) => void
}

const getInitialDarkMode = (): boolean => {
  if (typeof document !== 'undefined') {
    return document.body.classList.contains('vscode-dark') ||
           document.body.classList.contains('vscode-high-contrast')
  }
  return false
}

export const useEditorStore = create<EditorState>((set) => ({
  content: '',
  frontmatter: null,
  fileName: '',
  isDarkMode: getInitialDarkMode(),

  setContent: (content) => set({ content }),
  setFrontmatter: (frontmatter) => set({ frontmatter }),
  setFileName: (fileName) => set({ fileName }),
  setIsDarkMode: (dark) => set({ isDarkMode: dark })
}))

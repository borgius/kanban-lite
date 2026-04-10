import { forwardRef, useImperativeHandle, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import CodeMirror, { EditorView, type BasicSetupOptions, type Extension, type ReactCodeMirrorRef } from '@uiw/react-codemirror'

export interface CodeMirrorEditorHandle {
  focus: () => void
  getView: () => EditorView | null
}

interface CodeMirrorEditorProps {
  value: string
  onChange: (value: string) => void
  extensions?: Extension[]
  placeholder?: string
  className?: string
  id?: string
  testId?: string
  ariaLabel?: string
  height?: string
  minHeight?: string
  autoFocus?: boolean
  editable?: boolean
  readOnly?: boolean
  indentWithTab?: boolean
  basicSetup?: boolean | BasicSetupOptions
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  fallbackTextareaClassName?: string
  fallbackTextareaStyle?: CSSProperties
  spellCheck?: boolean
}

function resolveCodeEditorTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark'

  const root = document.body ?? document.documentElement
  const hasClass = (className: string) => root?.classList?.contains(className) ?? false

  if (hasClass('vscode-light') || hasClass('vscode-high-contrast-light')) {
    return 'light'
  }
  if (hasClass('vscode-dark') || hasClass('vscode-high-contrast')) {
    return 'dark'
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor({
  value,
  onChange,
  extensions,
  placeholder,
  className,
  id,
  testId,
  ariaLabel,
  height,
  minHeight,
  autoFocus,
  editable = true,
  readOnly = false,
  indentWithTab = false,
  basicSetup,
  onKeyDown,
  fallbackTextareaClassName,
  fallbackTextareaStyle,
  spellCheck = false,
}, ref) {
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null)
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null)
  const useServerFallback = typeof window === 'undefined' || typeof document === 'undefined'
  const editorTheme = useMemo(() => resolveCodeEditorTheme(), [])
  const resolvedExtensions = useMemo(
    () => [EditorView.lineWrapping, ...(extensions ?? [])],
    [extensions],
  )

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (useServerFallback) {
        fallbackTextareaRef.current?.focus()
        return
      }

      codeMirrorRef.current?.view?.focus()
    },
    getView: () => codeMirrorRef.current?.view ?? null,
  }), [useServerFallback])

  const resolvedReadOnly = readOnly || editable === false
  const resolvedBasicSetup = basicSetup ?? {
    foldGutter: false,
    lintKeymap: false,
  }

  if (useServerFallback) {
    return (
      <textarea
        ref={fallbackTextareaRef}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown as ((event: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined}
        readOnly={resolvedReadOnly}
        spellCheck={spellCheck}
        placeholder={typeof placeholder === 'string' ? placeholder : undefined}
        className={fallbackTextareaClassName}
        style={{
          ...fallbackTextareaStyle,
          ...(minHeight ? { minHeight } : null),
          ...(height ? { height } : null),
        }}
        data-testid={testId}
        aria-label={ariaLabel}
      />
    )
  }

  return (
    <CodeMirror
      ref={codeMirrorRef}
      id={id}
      value={value}
      height={height}
      minHeight={minHeight}
      theme={editorTheme}
      extensions={resolvedExtensions}
      placeholder={placeholder}
      editable={!resolvedReadOnly}
      readOnly={resolvedReadOnly}
      indentWithTab={indentWithTab}
      basicSetup={resolvedBasicSetup}
      onChange={(nextValue) => onChange(nextValue)}
      className={className}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown as ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined}
      data-testid={testId}
      aria-label={ariaLabel}
      spellCheck={spellCheck}
    />
  )
})

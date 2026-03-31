import { useCallback, useMemo } from 'react'
import { and, isStringControl, optionIs, type ControlProps, rankWith, type RankedTester, type UISchemaElement } from '@jsonforms/core'
import { withJsonFormsControlProps } from '@jsonforms/react'
import { javascript } from '@codemirror/lang-javascript'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'

type CodeEditorUiSchemaOptions = {
  editor?: string
  language?: string
  placeholder?: string
  height?: string
}

const javascriptCodeEditorExtensions = [javascript({ jsx: true }), EditorView.lineWrapping]
const plainTextCodeEditorExtensions = [EditorView.lineWrapping]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getCodeEditorUiSchemaOptions(uischema: UISchemaElement | undefined): CodeEditorUiSchemaOptions {
  if (!isRecord(uischema) || !isRecord(uischema.options)) {
    return {}
  }

  return uischema.options as CodeEditorUiSchemaOptions
}

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(' ')
}

function resolveCodeEditorTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark'

  const root = document.body ?? document.documentElement
  if (root.classList.contains('vscode-light') || root.classList.contains('vscode-high-contrast-light')) {
    return 'light'
  }
  if (root.classList.contains('vscode-dark') || root.classList.contains('vscode-high-contrast')) {
    return 'dark'
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function getCodeEditorExtensions(language: string | undefined) {
  switch (language) {
    case 'javascript':
    case 'js':
      return javascriptCodeEditorExtensions
    default:
      return plainTextCodeEditorExtensions
  }
}

function CodeEditorControlRenderer(props: ControlProps) {
  const {
    data,
    description,
    enabled,
    errors,
    handleChange,
    id,
    label,
    path,
    required,
    uischema,
    visible,
  } = props

  const options = useMemo(() => getCodeEditorUiSchemaOptions(uischema), [uischema])
  const editorExtensions = useMemo(() => getCodeEditorExtensions(options.language), [options.language])
  const editorTheme = useMemo(() => resolveCodeEditorTheme(), [])
  const handleEditorChange = useCallback((value: string) => {
    handleChange(path, value)
  }, [handleChange, path])

  const value = typeof data === 'string' ? data : ''
  const descriptionText = typeof description === 'string' ? description.trim() : ''
  const errorText = typeof errors === 'string' ? errors.trim() : ''
  const labelText = typeof label === 'string' ? label : ''
  const isEnabled = enabled !== false
  const editorHeight = options.height ?? '220px'
  const placeholder = options.placeholder ?? ''
  const useServerFallback = typeof window === 'undefined' || typeof document === 'undefined'

  if (visible === false) return null

  return (
    <div className="control">
      {labelText.length > 0 && (
        <label className="control-label" htmlFor={id}>
          {labelText}
          {required ? ' *' : ''}
        </label>
      )}

      {descriptionText.length > 0 && (
        <p className="description">{descriptionText}</p>
      )}

      <div
        className={joinClassNames(
          'kl-jsonforms-code-editor',
          errorText.length > 0 && 'kl-jsonforms-code-editor--error',
          !isEnabled && 'kl-jsonforms-code-editor--disabled',
        )}
        data-code-editor-language={options.language ?? 'plain'}
      >
        {useServerFallback ? (
          <textarea
            id={id}
            readOnly={!isEnabled}
            value={value}
            placeholder={placeholder}
            style={{ minHeight: editorHeight }}
          />
        ) : (
          <CodeMirror
            id={id}
            value={value}
            height={editorHeight}
            theme={editorTheme}
            extensions={editorExtensions}
            placeholder={placeholder}
            editable={isEnabled}
            readOnly={!isEnabled}
            indentWithTab
            basicSetup={{
              foldGutter: false,
              lintKeymap: false,
            }}
            onChange={handleEditorChange}
          />
        )}
      </div>

      <p className="validation_error">{errorText}</p>
    </div>
  )
}

export const jsonFormsCodeEditorTester: RankedTester = rankWith(
  1000,
  and(isStringControl, optionIs('editor', 'code')),
)

export const JsonFormsCodeEditorControl = withJsonFormsControlProps(CodeEditorControlRenderer)

import { useState, useCallback, useMemo } from 'react'
import { yaml } from '@codemirror/lang-yaml'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { metadataToYaml, yamlToMetadata } from './metadata-yaml'

interface MetadataEditorTabProps {
  metadata: Record<string, unknown> | undefined
  onMetadataChange: (metadata: Record<string, unknown>) => void
  onInvalidYaml?: () => void
}

export function MetadataEditorTab({ metadata, onMetadataChange, onInvalidYaml }: MetadataEditorTabProps) {
  const [draft, setDraft] = useState(() => metadataToYaml(metadata))
  const [error, setError] = useState<string | null>(null)
  const yamlExtensions = useMemo(() => [yaml()], [])

  const handleChange = useCallback((text: string) => {
    setDraft(text)
    const result = yamlToMetadata(text)
    if (result.ok) {
      setError(null)
      onMetadataChange(result.value)
    } else {
      setError(result.error)
      onInvalidYaml?.()
    }
  }, [onMetadataChange, onInvalidYaml])

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <p className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
        Edit card metadata as YAML. Changes are saved automatically when the YAML is valid.
      </p>
      <CodeMirrorEditor
        value={draft}
        onChange={handleChange}
        placeholder={'key: value\nanother: 123'}
        extensions={yamlExtensions}
        className={error
          ? 'kl-codemirror-surface kl-codemirror-surface--error card-metadata-codemirror'
          : 'kl-codemirror-surface card-metadata-codemirror'}
        fallbackTextareaClassName="markdown-editor-textarea"
        fallbackTextareaStyle={{
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          fontSize: 'var(--vscode-editor-font-size, 13px)',
        }}
        minHeight="12rem"
        spellCheck={false}
        testId="card-metadata-editor"
        ariaLabel="Card metadata YAML editor"
      />
      {error && (
        <p
          className="text-xs"
          style={{ color: 'var(--vscode-editorError-foreground, #f48771)' }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  )
}

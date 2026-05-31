import { useCallback, useMemo, useState } from 'react'
import { and, isStringControl, optionIs, type ControlProps, rankWith, type RankedTester, type UISchemaElement } from '@jsonforms/core'
import { withJsonFormsControlProps } from '@jsonforms/react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'

type JqTransformUiSchemaOptions = {
  editor?: string
  placeholder?: string
  height?: string
  testEndpoint?: string
}

const plainTextCodeEditorExtensions = [EditorView.lineWrapping]

/**
 * A representative webhook delivery envelope used to prefill the transform
 * tester. Mirrors the sample payload produced by the webhook plugin so the jq
 * expression can be validated before saving the webhook.
 */
const SAMPLE_PAYLOAD = {
  event: 'task.created',
  timestamp: '2026-02-24T12:00:00.000Z',
  actor: { subject: 'user:alice', roles: ['admin'] },
  boardId: 'board-1',
  meta: { source: 'api' },
  data: {
    id: 'card-42',
    title: 'Investigate webhook delivery',
    status: 'in-progress',
    priority: 'high',
    boardId: 'board-1',
    assignee: 'alice',
    metadata: { company: 'Acme', estimate: 3 },
  },
}

const DEFAULT_TEST_ENDPOINT = '/api/webhooks/transform/test'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getJqTransformUiSchemaOptions(uischema: UISchemaElement | undefined): JqTransformUiSchemaOptions {
  if (!isRecord(uischema) || !isRecord(uischema.options)) {
    return {}
  }
  return uischema.options as JqTransformUiSchemaOptions
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

function resolveTestEndpoint(configured: string | undefined): string {
  const base = (window as unknown as { __KB_BASE__?: string }).__KB_BASE__ ?? ''
  const path = configured ?? DEFAULT_TEST_ENDPOINT
  return `${base}${path}`
}

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'success'; output: string }
  | { status: 'error'; message: string }

function JqTransformControlRenderer(props: ControlProps) {
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

  const options = useMemo(() => getJqTransformUiSchemaOptions(uischema), [uischema])
  const editorTheme = useMemo(() => resolveCodeEditorTheme(), [])
  const [sample, setSample] = useState<string>(() => JSON.stringify(SAMPLE_PAYLOAD, null, 2))
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  const handleEditorChange = useCallback((value: string) => {
    handleChange(path, value)
  }, [handleChange, path])

  const value = typeof data === 'string' ? data : ''
  const descriptionText = typeof description === 'string' ? description.trim() : ''
  const errorText = typeof errors === 'string' ? errors.trim() : ''
  const labelText = typeof label === 'string' ? label : ''
  const isEnabled = enabled !== false
  const editorHeight = options.height ?? '160px'
  const placeholder = options.placeholder ?? ''
  const canTest = typeof window !== 'undefined' && typeof window.fetch === 'function'
  const useServerFallback = typeof window === 'undefined' || typeof document === 'undefined'

  const runTest = useCallback(async () => {
    if (!value.trim()) {
      setTestState({ status: 'error', message: 'Enter a jq expression to test.' })
      return
    }
    let payload: unknown
    const sampleText = sample.trim()
    if (sampleText.length > 0) {
      try {
        payload = JSON.parse(sampleText)
      } catch {
        setTestState({ status: 'error', message: 'Sample payload is not valid JSON.' })
        return
      }
    }
    setTestState({ status: 'running' })
    try {
      const body: Record<string, unknown> = { transform: value }
      if (payload !== undefined) body.payload = payload
      const response = await fetch(resolveTestEndpoint(options.testEndpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: { result?: unknown }; error?: string }
        | null
      if (!response.ok || !json || json.ok === false) {
        const message = (json && json.error) || `Transform failed (HTTP ${response.status}).`
        setTestState({ status: 'error', message })
        return
      }
      const result = json.data?.result
      setTestState({ status: 'success', output: JSON.stringify(result, null, 2) })
    } catch (err) {
      setTestState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unable to reach the transform test endpoint.',
      })
    }
  }, [options.testEndpoint, sample, value])

  if (visible === false) return null

  return (
    <div className="control kl-jq-transform">
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
        data-code-editor-language="jq"
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
            extensions={plainTextCodeEditorExtensions}
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

      <div className="kl-jq-transform__tester">
        <label className="control-label" htmlFor={`${id}-sample`}>
          Sample payload
        </label>
        <p className="description">
          Edit the sample envelope and run the expression to preview the transformed body before saving. Leave blank to use the built-in sample.
        </p>
        <textarea
          id={`${id}-sample`}
          className="kl-jq-transform__sample"
          value={sample}
          spellCheck={false}
          onChange={(event) => setSample(event.target.value)}
          style={{ minHeight: '140px', width: '100%', fontFamily: 'monospace' }}
        />
        <div className="kl-jq-transform__actions">
          <button
            type="button"
            className="kl-jq-transform__test-button"
            onClick={() => { void runTest() }}
            disabled={!canTest || !isEnabled || testState.status === 'running'}
          >
            {testState.status === 'running' ? 'Testing…' : 'Test expression'}
          </button>
          {!canTest && (
            <span className="kl-jq-transform__hint">
              Testing is available when running the standalone web server.
            </span>
          )}
        </div>

        {testState.status === 'error' && (
          <p className="validation_error" role="alert">{testState.message}</p>
        )}
        {testState.status === 'success' && (
          <pre className="kl-jq-transform__output">{testState.output}</pre>
        )}
      </div>

      <p className="validation_error">{errorText}</p>
    </div>
  )
}

export const jsonFormsJqTransformTester: RankedTester = rankWith(
  1000,
  and(isStringControl, optionIs('editor', 'jq')),
)

export const JsonFormsJqTransformControl = withJsonFormsControlProps(JqTransformControlRenderer)

import { useRef, useMemo, useState, type CSSProperties } from 'react'
import type { BoardMetaFieldDef } from '../../shared/config'

interface TitleBuilderSectionProps {
  boardMeta?: Record<string, BoardMetaFieldDef>
  boardTitleTemplate?: string
  onSave?: (titleTemplate: string) => void
}

const sectionStyle: CSSProperties = {
  borderColor: 'var(--vscode-panel-border)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
}

const inputStyle: CSSProperties = {
  borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  outline: 'none',
  boxShadow: 'inset 0 0 0 1px var(--vscode-input-border, var(--vscode-panel-border))',
}

/** Placeholder token used when no template is set. */
const DEFAULT_TEMPLATE = '${title}'

function getAvailableFields(boardMeta?: Record<string, BoardMetaFieldDef>): string[] {
  return Object.keys(boardMeta ?? {})
}

function createResetKey(boardMeta?: Record<string, BoardMetaFieldDef>): string {
  return JSON.stringify({
    metadata: Object.keys(boardMeta ?? {}).sort(),
  })
}

/** Insert a placeholder at the cursor in a text input, inserting after any enclosing placeholder. */
function insertPlaceholder(el: HTMLInputElement, placeholder: string): { value: string; cursor: number } {
  const { selectionStart, selectionEnd, value } = el
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)

  // If cursor is inside a placeholder, insert after it
  const openIdx = before.lastIndexOf('${')
  const closeIdx = before.lastIndexOf('}')
  if (openIdx !== -1 && openIdx > closeIdx) {
    const closingInAfter = value.indexOf('}', selectionStart)
    if (closingInAfter !== -1) {
      const newValue = value.slice(0, closingInAfter + 1) + placeholder + value.slice(Math.max(selectionEnd, closingInAfter + 1))
      return { value: newValue, cursor: closingInAfter + 1 + placeholder.length }
    }
  }

  const newValue = before + placeholder + after
  return { value: newValue, cursor: selectionStart + placeholder.length }
}

export function TitleBuilderSection({ boardMeta, boardTitleTemplate, onSave }: TitleBuilderSectionProps) {
  const availableFields = useMemo(() => getAvailableFields(boardMeta), [boardMeta])
  // Only reset on metadata field changes, not on every template save — avoids focus loss
  const resetKey = useMemo(() => createResetKey(boardMeta), [boardMeta])

  return (
    <TitleBuilderSectionContent
      key={resetKey}
      availableFields={availableFields}
      boardMeta={boardMeta}
      initialTemplate={boardTitleTemplate ?? DEFAULT_TEMPLATE}
      onSave={onSave}
    />
  )
}

function TitleBuilderSectionContent({
  availableFields,
  boardMeta,
  initialTemplate,
  onSave,
}: {
  availableFields: string[]
  boardMeta?: Record<string, BoardMetaFieldDef>
  initialTemplate: string
  onSave?: (titleTemplate: string) => void
}) {
  const [template, setTemplate] = useState(initialTemplate)
  const inputRef = useRef<HTMLInputElement>(null)

  const usedPlaceholders = useMemo(() => {
    const matches = [...template.matchAll(/\$\{(title|metadata\.([^}]+))\}/g)]
    return new Set(matches.map(m => m[0]))
  }, [template])

  const handleBlur = () => {
    onSave?.(template)
  }

  const handleInsertField = (field: string) => {
    const placeholder = field === 'title' ? '${title}' : `\${metadata.${field}}`

    // If already in template, remove all occurrences
    if (usedPlaceholders.has(placeholder)) {
      const newValue = template.replace(new RegExp(`\\$\\{${field === 'title' ? 'title' : `metadata\\.${field}`}\\}`, 'g'), '').replace(/\s{2,}/g, ' ').trim()
      setTemplate(newValue)
      onSave?.(newValue)
      return
    }

    const el = inputRef.current
    if (!el) {
      const newValue = template + placeholder
      setTemplate(newValue)
      onSave?.(newValue)
      return
    }
    const { value, cursor } = insertPlaceholder(el, placeholder)
    setTemplate(value)
    onSave?.(value)
    // Restore focus and cursor after React re-render
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(cursor, cursor)
    })
  }

  // Build preview: replace placeholders with example values
  const previewText = useMemo(() => {
    return template.replace(/\$\{(title|metadata\.([^}]+))\}/g, (_, key: string, metaKey: string | undefined) => {
      if (key === 'title') return 'Card Title'
      const fieldName = metaKey ?? key.slice('metadata.'.length)
      return boardMeta?.[fieldName]?.description?.trim() ? `[${fieldName}]` : `[${fieldName}]`
    })
  }, [template, boardMeta])

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="rounded-xl border px-3 py-3 space-y-2" style={sectionStyle}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
            Title Template
          </h3>
          <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Build a template for card titles. Use <code className="font-mono">{'${title}'}</code> for the card title and click a field below to insert it at the cursor.
          </p>
        </div>

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={template}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded border px-2 py-1.5 font-mono text-sm"
            style={inputStyle}
            placeholder={DEFAULT_TEMPLATE}
            onChange={(e) => setTemplate(e.target.value)}
            onBlur={handleBlur}
            aria-label="Title template"
          />
          {template !== previewText && (
            <p className="text-xs leading-5 truncate" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              Preview: <span className="font-medium" style={{ color: 'var(--vscode-foreground)' }}>{previewText}</span>
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border px-3 py-3 space-y-3" style={sectionStyle}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Insert field
          </p>
          <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Click a field to insert it at the cursor position in the template.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* ${title} is always available */}
          <button
            type="button"
            onClick={() => handleInsertField('title')}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              usedPlaceholders.has('${title}')
                ? {
                    borderColor: 'var(--vscode-button-background)',
                    background: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                  }
                : {
                    borderColor: 'var(--vscode-panel-border)',
                    background: 'transparent',
                    color: 'var(--vscode-foreground)',
                  }
            }
            title="Insert ${title} placeholder"
          >
            title
          </button>

          {availableFields.length === 0 && (
            <span className="text-xs leading-5 self-center" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              No metadata fields — add some in the Meta tab.
            </span>
          )}

          {availableFields.map((field) => {
            const placeholder = `\${metadata.${field}}`
            const isUsed = usedPlaceholders.has(placeholder)
            const description = boardMeta?.[field]?.description?.trim() ?? ''
            return (
              <button
                key={field}
                type="button"
                onClick={() => handleInsertField(field)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                style={
                  isUsed
                    ? {
                        borderColor: 'var(--vscode-button-background)',
                        background: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                      }
                    : {
                        borderColor: 'var(--vscode-panel-border)',
                        background: 'transparent',
                        color: 'var(--vscode-foreground)',
                      }
                }
                title={description || `Insert \${metadata.${field}} placeholder`}
              >
                {field}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

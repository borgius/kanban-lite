import { useId, useMemo, useState, type CSSProperties } from 'react'
import type { BoardMetaFieldDef } from '../../shared/config'

interface MetaBuilderSectionProps {
  boardMeta?: Record<string, BoardMetaFieldDef>
  onSave?: (meta: Record<string, BoardMetaFieldDef>) => void
}

const sectionStyle: CSSProperties = {
  borderColor: 'var(--vscode-panel-border)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
}

const inputStyle: CSSProperties = {
  borderColor: 'var(--vscode-input-border, var(--vscode-panel-border))',
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
}

const codeStyle: CSSProperties = {
  background: 'var(--vscode-textCodeBlock-background, var(--vscode-editor-background))',
  color: 'var(--vscode-foreground)',
}

const accentBadgeStyle: CSSProperties = {
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
}

const subtleBadgeStyle: CSSProperties = {
  background: 'var(--vscode-badge-background)',
  color: 'var(--vscode-badge-foreground)',
}

function cloneBoardMeta(boardMeta?: Record<string, BoardMetaFieldDef>): Record<string, BoardMetaFieldDef> {
  return boardMeta ? structuredClone(boardMeta) : {}
}

function formatMetaPreviewValue(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)

  try {
    const json = JSON.stringify(value)
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function createMetaBuilderResetKey(boardMeta: Record<string, BoardMetaFieldDef>): string {
  return JSON.stringify(boardMeta)
}

function createMetaSummaryText(total: number, visible: number, described: number): string {
  if (total === 0) return 'No fields yet.'

  return [
    `${total} total`,
    `${visible} shown on cards`,
    `${described} with descriptions`,
  ].join(' • ')
}

export function MetaBuilderSection({ boardMeta, onSave }: MetaBuilderSectionProps) {
  const initialBoardMeta = useMemo(() => cloneBoardMeta(boardMeta), [boardMeta])
  const resetKey = useMemo(() => createMetaBuilderResetKey(initialBoardMeta), [initialBoardMeta])

  return <MetaBuilderSectionContent key={resetKey} initialBoardMeta={initialBoardMeta} onSave={onSave} />
}

function MetaBuilderSectionContent({
  initialBoardMeta,
  onSave,
}: {
  initialBoardMeta: Record<string, BoardMetaFieldDef>
  onSave?: (meta: Record<string, BoardMetaFieldDef>) => void
}) {
  const editorIdBase = useId()
  const [meta, setMeta] = useState<Record<string, BoardMetaFieldDef>>(() => initialBoardMeta)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [draftDefault, setDraftDefault] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftHighlighted, setDraftHighlighted] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)

  const entries = useMemo(() => Object.entries(meta), [meta])
  const visibleCount = useMemo(() => entries.filter(([, def]) => def.highlighted).length, [entries])
  const describedCount = useMemo(
    () => entries.filter(([, def]) => typeof def.description === 'string' && def.description.trim().length > 0).length,
    [entries],
  )

  const trimmedKey = draftKey.trim()
  const trimmedDefault = draftDefault.trim()
  const trimmedDescription = draftDescription.trim()
  const previewDefault = trimmedDefault.length > 0 ? trimmedDefault : null
  const isDuplicateKey = trimmedKey.length > 0
    && trimmedKey !== editingKey
    && Object.prototype.hasOwnProperty.call(meta, trimmedKey)
  const visibleEntries = useMemo(
    () => entries.filter(([key]) => key !== editingKey),
    [editingKey, entries],
  )
  const summaryText = useMemo(
    () => createMetaSummaryText(entries.length, visibleCount, describedCount),
    [describedCount, entries.length, visibleCount],
  )
  const validationMessage = trimmedKey.length === 0
    ? 'Name is required so cards have a stable metadata key.'
    : isDuplicateKey
      ? 'A field with this name already exists. Pick a unique key or edit the existing field instead.'
      : null
  const canSave = validationMessage === null

  const resetDraft = () => {
    setDraftKey('')
    setDraftDefault('')
    setDraftDescription('')
    setDraftHighlighted(false)
  }

  const startAdd = () => {
    resetDraft()
    setEditingKey(null)
    setIsAdding(true)
    setPendingDeleteKey(null)
  }

  const startEdit = (key: string) => {
    const def = meta[key] ?? {}
    setEditingKey(key)
    setIsAdding(false)
    setPendingDeleteKey(null)
    setDraftKey(key)
    setDraftDefault(def.default !== undefined ? formatMetaPreviewValue(def.default) : '')
    setDraftDescription(def.description ?? '')
    setDraftHighlighted(def.highlighted ?? false)
  }

  const cancelEdit = () => {
    resetDraft()
    setEditingKey(null)
    setIsAdding(false)
  }

  const commitEdit = () => {
    if (!canSave) return

    const next = { ...meta }
    if (editingKey && editingKey !== trimmedKey) {
      delete next[editingKey]
    }

    const nextDef: BoardMetaFieldDef = {}
    if (trimmedDefault.length > 0) nextDef.default = trimmedDefault
    if (trimmedDescription.length > 0) nextDef.description = trimmedDescription
    if (draftHighlighted) nextDef.highlighted = true

    next[trimmedKey] = nextDef
    setMeta(next)
    onSave?.(next)
    setPendingDeleteKey(null)
    cancelEdit()
  }

  const deleteField = (key: string) => {
    const next = { ...meta }
    delete next[key]
    setMeta(next)
    onSave?.(next)
    setPendingDeleteKey(null)
    if (editingKey === key) {
      cancelEdit()
    }
  }

  const renderEditor = () => {
    const title = editingKey ? `Edit ${editingKey}` : 'Add metadata field'
    const nameInputId = `${editorIdBase}-name`
    const nameHintId = `${editorIdBase}-name-hint`
    const defaultInputId = `${editorIdBase}-default`
    const defaultHintId = `${editorIdBase}-default-hint`
    const descriptionInputId = `${editorIdBase}-description`
    const descriptionHintId = `${editorIdBase}-description-hint`
    const visibilityInputId = `${editorIdBase}-visibility`
    const visibilityHintId = `${editorIdBase}-visibility-hint`
    const validationId = `${editorIdBase}-validation`
    const fieldScopeSummary = trimmedKey.length > 0
      ? draftHighlighted
        ? `${trimmedKey} will be shown on card previews.`
        : `${trimmedKey} will stay in the card details only.`
      : 'Choose a stable field name and decide whether it belongs on card previews.'

    return (
      <div className="max-w-4xl rounded-xl border px-4 py-4 space-y-4" style={sectionStyle}>
        <div className="max-w-2xl space-y-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>{title}</div>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              Use a stable key, an optional default value, and a short description so the field stays clear and consistent.
            </p>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              {fieldScopeSummary}
              {previewDefault ? ` Default: ${previewDefault}.` : ''}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              Name
            </span>
            <input
              id={nameInputId}
              name="metadataFieldName"
              aria-describedby={nameHintId}
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder="ticketId…"
              className="rounded border px-2 py-1.5 text-sm"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') cancelEdit()
              }}
              autoFocus
            />
            <span id={nameHintId} className="block text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              Use stable keys like <code>ticketId</code>, <code>customer.segment</code>, or <code>location</code>.
            </span>
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              Default
            </span>
            <input
              id={defaultInputId}
              name="metadataFieldDefault"
              aria-describedby={defaultHintId}
              value={draftDefault}
              onChange={(event) => setDraftDefault(event.target.value)}
              placeholder="Optional starter value…"
              className="rounded border px-2 py-1.5 text-sm"
              style={inputStyle}
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') cancelEdit()
              }}
            />
            <span id={defaultHintId} className="block text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
              Prefill a sensible starting value when new cards don’t provide one yet.
            </span>
          </label>
        </div>

        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Description
          </span>
          <textarea
            id={descriptionInputId}
            name="metadataFieldDescription"
            aria-describedby={descriptionHintId}
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="Explain when teammates should use this field…"
            rows={3}
            className="min-h-[88px] resize-y rounded border px-2 py-2 text-sm"
            style={inputStyle}
          />
          <span id={descriptionHintId} className="block text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Optional. Explain what belongs in this field so teammates know when to use it.
          </span>
        </label>

        <div className="rounded-xl border px-3 py-3" style={{ borderColor: 'var(--vscode-panel-border)' }}>
          <label className="flex items-start gap-3">
            <input
              id={visibilityInputId}
              name="metadataFieldHighlighted"
              type="checkbox"
              checked={draftHighlighted}
              onChange={(event) => setDraftHighlighted(event.target.checked)}
              aria-describedby={visibilityHintId}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium" style={{ color: 'var(--vscode-foreground)' }}>
                Show on card previews
              </span>
              <span id={visibilityHintId} className="block text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                Turn this on only for fields people should notice while scanning the board.
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-3 border-t pt-3" style={{ borderColor: 'var(--vscode-panel-border)' }}>
          <div
            className="rounded border px-3 py-2 text-xs leading-5"
            style={{
              borderColor: validationMessage ? 'var(--vscode-errorForeground, #f87171)' : 'var(--vscode-panel-border)',
              background: validationMessage ? 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 10%, transparent)' : 'transparent',
              color: validationMessage ? 'var(--vscode-errorForeground, #f87171)' : 'var(--vscode-descriptionForeground)',
            }}
            id={validationId}
            role={validationMessage ? 'alert' : 'status'}
            aria-live="polite"
          >
            {validationMessage ?? 'Looks good. Saving updates the board metadata immediately.'}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="rounded px-3 py-1.5 text-xs font-medium"
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
              }}
              onClick={cancelEdit}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSave}
              className="rounded px-3 py-1.5 text-xs font-medium disabled:cursor-default disabled:opacity-60"
              style={{
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
              }}
              onClick={commitEdit}
            >
              Save field
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border px-3 py-3 md:flex-row md:items-start md:justify-between" style={sectionStyle}>
        <div className="space-y-1">
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
                Metadata Fields
              </h3>
              <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                Keep board metadata simple: define reusable keys, add optional defaults, and decide which fields should appear on cards.
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                {summaryText}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={startAdd}
            className="rounded px-3 py-1.5 text-xs font-medium"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            Add field
          </button>
        </div>
      </div>

      {(isAdding || editingKey !== null) && renderEditor()}

      {entries.length === 0 && !isAdding ? (
        <div
          className="rounded-xl border border-dashed px-6 py-8 text-center"
          style={{
            borderColor: 'var(--vscode-panel-border)',
            background: 'transparent',
          }}
        >
          <h4 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>No metadata fields yet</h4>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Add your first field to capture extra card context like ticket IDs, customer names, or locations.
          </p>
          <button
            type="button"
            onClick={startAdd}
            className="mt-5 rounded px-3 py-1.5 text-xs font-medium"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            Add field
          </button>
        </div>
      ) : visibleEntries.length > 0 ? (
        <div className="rounded-xl border" style={sectionStyle}>
          {visibleEntries.map(([key, def], index) => {
            const defaultValue = def.default !== undefined ? formatMetaPreviewValue(def.default) : ''
            const isPendingDelete = pendingDeleteKey === key

            return (
              <div
                key={key}
                className="space-y-3 px-3 py-3"
                style={index === 0 ? undefined : { borderTop: '1px solid var(--vscode-panel-border)' }}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        translate="no"
                        className="inline-flex max-w-full items-center rounded px-2 py-0.5 font-mono text-xs"
                        style={codeStyle}
                      >
                        {key}
                      </span>
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={def.highlighted ? accentBadgeStyle : subtleBadgeStyle}
                      >
                        {def.highlighted ? 'Shown on cards' : 'Details only'}
                      </span>
                      {defaultValue && (
                        <span className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                          Default: <span className="font-mono" style={{ color: 'var(--vscode-foreground)' }}>{defaultValue}</span>
                        </span>
                      )}
                    </div>

                    <p className="break-words text-sm leading-5" style={{ color: def.description ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}>
                      {def.description || 'No description yet.'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => startEdit(key)}
                      className="rounded border px-2 py-1 text-xs font-medium"
                      style={{
                        borderColor: 'var(--vscode-panel-border)',
                        color: 'var(--vscode-foreground)',
                      }}
                    >
                      Edit
                    </button>
                    {isPendingDelete ? (
                      <>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium"
                          style={{
                            borderColor: 'var(--vscode-panel-border)',
                            color: 'var(--vscode-foreground)',
                          }}
                          onClick={() => setPendingDeleteKey(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium"
                          style={{
                            borderColor: 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 40%, var(--vscode-panel-border))',
                            color: 'var(--vscode-errorForeground, #f87171)',
                          }}
                          onClick={() => deleteField(key)}
                        >
                          Confirm delete
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteKey(key)}
                        className="rounded border px-2 py-1 text-xs font-medium"
                        style={{
                          borderColor: 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 40%, var(--vscode-panel-border))',
                          color: 'var(--vscode-errorForeground, #f87171)',
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {isPendingDelete && (
                  <p className="text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    Delete this field from the board metadata configuration?
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

import { useId, useMemo, useState } from 'react'
import { Eye, FileText, Hash, Pencil, Plus, Trash2 } from 'lucide-react'
import type { BoardMetaFieldDef } from '../../shared/config'
import {
  MetaBadge,
  MetaFieldActionButton,
  MetaStat,
  MetaVisibilitySwitch,
  bodyTextStyle,
  heroStyle,
  inputStyle,
  mutedTextStyle,
  surfaceStyle,
} from './MetaBuilderSection.chrome'

interface MetaBuilderSectionProps {
  boardMeta?: Record<string, BoardMetaFieldDef>
  onSave?: (meta: Record<string, BoardMetaFieldDef>) => void
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
  const validationMessage = trimmedKey.length === 0
    ? 'Name is required so cards have a stable metadata key to store values under.'
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
    const title = editingKey ? `Editing ${editingKey}` : 'Create a metadata field'
    const nameInputId = `${editorIdBase}-name`
    const nameHintId = `${editorIdBase}-name-hint`
    const defaultInputId = `${editorIdBase}-default`
    const defaultHintId = `${editorIdBase}-default-hint`
    const descriptionInputId = `${editorIdBase}-description`
    const visibilityHintId = `${editorIdBase}-visibility-hint`
    const validationId = `${editorIdBase}-validation`

    return (
      <div className="rounded-3xl border p-4 md:p-5" style={surfaceStyle}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <MetaBadge tone="accent">{editingKey ? 'Field editor' : 'New field'}</MetaBadge>
            <div>
              <div className="text-base font-semibold" style={bodyTextStyle}>{title}</div>
              <p className="mt-1 max-w-2xl text-xs leading-6" style={mutedTextStyle}>
                Give the field a stable key, an optional default value, and a short description so teammates know when to use it.
              </p>
            </div>
          </div>

          <div
            className="min-w-0 rounded-2xl border p-4 xl:w-[280px]"
            style={{
              borderColor: 'color-mix(in srgb, var(--vscode-panel-border) 82%, transparent)',
              background: 'color-mix(in srgb, var(--vscode-editor-background) 66%, transparent)',
            }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
              Preview
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                translate="no"
                className="inline-flex max-w-full items-center rounded-full px-3 py-1 font-mono text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 78%, transparent)',
                  color: 'var(--vscode-foreground)',
                }}
              >
                {trimmedKey || 'field_key'}
              </span>
              <MetaBadge tone={draftHighlighted ? 'accent' : 'subtle'}>
                {draftHighlighted ? 'Shown on cards' : 'Details only'}
              </MetaBadge>
            </div>
            <p className="mt-3 text-xs leading-6" style={mutedTextStyle}>
              {trimmedDescription || 'Add a description to clarify what belongs in this field.'}
            </p>
            {previewDefault && (
              <div className="mt-3 rounded-2xl border px-3 py-2" style={{ borderColor: 'var(--vscode-panel-border)' }}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
                  Default value
                </div>
                <div className="mt-1 font-mono text-xs" style={bodyTextStyle}>{previewDefault}</div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
              Name
            </span>
            <input
              id={nameInputId}
              name="metadataFieldName"
              aria-describedby={nameHintId}
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder="ticketId…"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') cancelEdit()
              }}
              autoFocus
            />
            <span id={nameHintId} className="text-xs leading-5" style={mutedTextStyle}>
              Use stable keys like <code>ticketId</code>, <code>customer.segment</code>, or <code>location</code>.
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
              Default
            </span>
            <input
              id={defaultInputId}
              name="metadataFieldDefault"
              aria-describedby={defaultHintId}
              value={draftDefault}
              onChange={(event) => setDraftDefault(event.target.value)}
              placeholder="Optional starter value…"
              style={inputStyle}
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') cancelEdit()
              }}
            />
            <span id={defaultHintId} className="text-xs leading-5" style={mutedTextStyle}>
              Prefill a sensible starting value when new cards don’t provide one yet.
            </span>
          </label>
        </div>

        <label className="mt-3 block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
            Description
          </span>
          <input
            id={descriptionInputId}
            name="metadataFieldDescription"
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="Explain when teammates should use this field…"
            style={inputStyle}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitEdit()
              if (event.key === 'Escape') cancelEdit()
            }}
          />
        </label>

        <div
          className="mt-4 rounded-2xl border px-4 py-3"
          style={{
            borderColor: 'var(--vscode-panel-border)',
            background: 'color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium" style={bodyTextStyle}>Show on card previews</div>
              <p id={visibilityHintId} className="mt-1 text-xs leading-5" style={mutedTextStyle}>
                Highlight important metadata directly on board cards so people can scan it without opening details.
              </p>
            </div>
            <MetaVisibilitySwitch checked={draftHighlighted} onChange={setDraftHighlighted} />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div
            className="rounded-2xl border px-3 py-2 text-xs leading-5"
            style={{
              borderColor: validationMessage ? 'var(--vscode-errorForeground, #f87171)' : 'var(--vscode-panel-border)',
              background: validationMessage
                ? 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 10%, transparent)'
                : 'color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)',
              color: validationMessage ? 'var(--vscode-errorForeground, #f87171)' : 'var(--vscode-descriptionForeground)',
            }}
            id={validationId}
            role={validationMessage ? 'alert' : 'status'}
            aria-live="polite"
          >
            {validationMessage ?? 'Looks good. Save to apply this field to the board configuration immediately.'}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm font-medium"
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
              className="rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-default disabled:opacity-60"
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
    <div className="px-4 py-4">
      <div className="rounded-3xl border p-4 md:p-5" style={heroStyle}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <MetaBadge tone="accent">Metadata fields</MetaBadge>
            <div>
              <h3 className="text-balance text-lg font-semibold" style={bodyTextStyle}>
                Shape richer card context without cluttering the board.
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6" style={mutedTextStyle}>
                Define reusable metadata keys, keep defaults close at hand, and choose which fields deserve a spot on the card preview.
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <MetaStat icon={Hash} label="Fields" value={String(entries.length)} />
            <MetaStat icon={Eye} label="Shown on cards" value={String(visibleCount)} />
            <MetaStat icon={FileText} label="Documented" value={String(describedCount)} />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-xs leading-5" style={mutedTextStyle}>
            Tip: highlight only the fields people need for quick scanning — everything else can stay tucked into the card details.
          </p>
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <Plus size={15} />
            Add field
          </button>
        </div>
      </div>

      {(isAdding || editingKey !== null) && <div className="mt-4">{renderEditor()}</div>}

      {entries.length === 0 && !isAdding ? (
        <div
          className="mt-4 rounded-3xl border border-dashed px-6 py-8 text-center"
          style={{
            borderColor: 'var(--vscode-panel-border)',
            background: 'color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 82%, transparent)',
          }}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'color-mix(in srgb, var(--vscode-button-background) 14%, transparent)' }}>
            <Hash size={20} style={{ color: 'var(--vscode-button-background)' }} />
          </div>
          <h4 className="mt-4 text-base font-semibold" style={bodyTextStyle}>No metadata fields yet</h4>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6" style={mutedTextStyle}>
            Add your first field to capture extra card context like ticket IDs, customer names, or locations.
          </p>
          <button
            type="button"
            onClick={startAdd}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <Plus size={15} />
            Create first field
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {entries.map(([key, def]) => {
            if (editingKey === key) {
              return <div key={key}>{renderEditor()}</div>
            }

            const defaultValue = def.default !== undefined ? formatMetaPreviewValue(def.default) : ''
            const isPendingDelete = pendingDeleteKey === key

            return (
              <div
                key={key}
                className="rounded-3xl border p-4 transition-colors md:p-5"
                style={def.highlighted
                  ? {
                      ...surfaceStyle,
                      borderColor: 'color-mix(in srgb, var(--vscode-button-background) 38%, var(--vscode-panel-border))',
                      background: 'linear-gradient(180deg, color-mix(in srgb, var(--vscode-button-background) 8%, transparent), var(--vscode-editorWidget-background, var(--vscode-sideBar-background)))',
                    }
                  : surfaceStyle}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = 'color-mix(in srgb, var(--vscode-list-hoverBackground) 68%, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)))'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = def.highlighted
                    ? 'linear-gradient(180deg, color-mix(in srgb, var(--vscode-button-background) 8%, transparent), var(--vscode-editorWidget-background, var(--vscode-sideBar-background)))'
                    : 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))'
                }}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        translate="no"
                        className="inline-flex max-w-full items-center rounded-full px-3 py-1 font-mono text-xs"
                        style={{
                          background: 'color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 78%, transparent)',
                          color: 'var(--vscode-foreground)',
                        }}
                      >
                        {key}
                      </span>
                      <MetaBadge tone={def.highlighted ? 'accent' : 'subtle'}>
                        {def.highlighted ? 'Shown on cards' : 'Details only'}
                      </MetaBadge>
                      {defaultValue && <MetaBadge>Default · {defaultValue}</MetaBadge>}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.9fr)]">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
                          Description
                        </div>
                        <p className="mt-2 break-words text-sm leading-6" style={def.description ? bodyTextStyle : mutedTextStyle}>
                          {def.description || 'No description yet. Add one to explain how this field should be used.'}
                        </p>
                      </div>

                      <div
                        className="rounded-2xl border px-4 py-3"
                        style={{
                          borderColor: 'var(--vscode-panel-border)',
                          background: 'color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)',
                        }}
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={mutedTextStyle}>
                          Preview behavior
                        </div>
                        <p className="mt-2 break-words text-xs leading-6" style={mutedTextStyle}>
                          {def.highlighted
                            ? 'This field appears directly on the board card preview for faster scanning.'
                            : 'This field stays inside the card details until you decide it should appear on previews.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    {isPendingDelete ? (
                      <>
                        <span className="text-xs font-medium" style={mutedTextStyle}>Delete this field?</span>
                        <button
                          type="button"
                          className="rounded-xl px-3 py-2 text-xs font-medium"
                          style={{
                            background: 'var(--vscode-button-secondaryBackground)',
                            color: 'var(--vscode-button-secondaryForeground)',
                          }}
                          onClick={() => setPendingDeleteKey(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded-xl px-3 py-2 text-xs font-medium"
                          style={{
                            background: 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 14%, transparent)',
                            color: 'var(--vscode-errorForeground, #f87171)',
                          }}
                          onClick={() => deleteField(key)}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <MetaFieldActionButton label={`Edit ${key}`} onClick={() => startEdit(key)}>
                          <Pencil size={15} />
                        </MetaFieldActionButton>
                        <MetaFieldActionButton label={`Delete ${key}`} danger onClick={() => setPendingDeleteKey(key)}>
                          <Trash2 size={15} />
                        </MetaFieldActionButton>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

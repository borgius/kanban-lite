import { useMemo, useState, type CSSProperties } from 'react'
import type { BoardMetaFieldDef } from '../../shared/config'

interface TitleBuilderSectionProps {
  boardMeta?: Record<string, BoardMetaFieldDef>
  boardTitle?: string[]
  onSave?: (title: string[]) => void
}

const sectionStyle: CSSProperties = {
  borderColor: 'var(--vscode-panel-border)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
}

function normalizeBoardTitle(boardTitle?: string[]): string[] {
  if (!Array.isArray(boardTitle)) return []

  return Array.from(new Set(boardTitle.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function getAvailableTitleFields(
  boardMeta?: Record<string, BoardMetaFieldDef>,
  boardTitle?: string[],
): string[] {
  const metadataKeys = Object.keys(boardMeta ?? {})
  const selectedKeys = normalizeBoardTitle(boardTitle)
  const ordered = [...selectedKeys, ...metadataKeys]

  return Array.from(new Set(ordered))
}

function createResetKey(boardMeta?: Record<string, BoardMetaFieldDef>, boardTitle?: string[]): string {
  return JSON.stringify({
    metadata: Object.keys(boardMeta ?? {}).sort(),
    title: normalizeBoardTitle(boardTitle),
  })
}

export function TitleBuilderSection({ boardMeta, boardTitle, onSave }: TitleBuilderSectionProps) {
  const availableFields = useMemo(() => getAvailableTitleFields(boardMeta, boardTitle), [boardMeta, boardTitle])
  const initialSelection = useMemo(() => normalizeBoardTitle(boardTitle), [boardTitle])
  const resetKey = useMemo(() => createResetKey(boardMeta, boardTitle), [boardMeta, boardTitle])

  return (
    <TitleBuilderSectionContent
      key={resetKey}
      availableFields={availableFields}
      initialSelection={initialSelection}
      boardMeta={boardMeta}
      onSave={onSave}
    />
  )
}

function TitleBuilderSectionContent({
  availableFields,
  initialSelection,
  boardMeta,
  onSave,
}: {
  availableFields: string[]
  initialSelection: string[]
  boardMeta?: Record<string, BoardMetaFieldDef>
  onSave?: (title: string[]) => void
}) {
  const [selectedFields, setSelectedFields] = useState<string[]>(() => initialSelection)

  const highlightedCount = useMemo(
    () => selectedFields.filter((field) => boardMeta?.[field]?.highlighted).length,
    [boardMeta, selectedFields],
  )

  const toggleField = (field: string) => {
    const nextSelection = selectedFields.includes(field)
      ? selectedFields.filter((value) => value !== field)
      : [...selectedFields, field]

    setSelectedFields(nextSelection)
    onSave?.(nextSelection)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="rounded-xl border px-3 py-3 space-y-2" style={sectionStyle}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
            Title Fields
          </h3>
          <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Choose which metadata keys prefix card titles in board views, toasts, and other user-facing surfaces.
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            {selectedFields.length === 0
              ? 'No title fields selected yet.'
              : `${selectedFields.length} selected • ${highlightedCount} already highlighted on cards`}
          </p>
        </div>
      </div>

      {availableFields.length === 0 ? (
        <div
          className="rounded-xl border border-dashed px-6 py-8 text-center"
          style={{ borderColor: 'var(--vscode-panel-border)' }}
        >
          <h4 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
            No metadata fields available
          </h4>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Add board metadata fields first, then choose which ones should become part of the rendered card title.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border px-3 py-3 space-y-3" style={sectionStyle}>
          <div className="flex flex-wrap gap-2">
            {availableFields.map((field) => {
              const selected = selectedFields.includes(field)
              const description = boardMeta?.[field]?.description?.trim() ?? ''

              return (
                <button
                  key={field}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleField(field)}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                  style={selected
                    ? {
                        borderColor: 'var(--vscode-button-background)',
                        background: 'var(--vscode-button-background)',
                        color: 'var(--vscode-button-foreground)',
                      }
                    : {
                        borderColor: 'var(--vscode-panel-border)',
                        background: 'transparent',
                        color: 'var(--vscode-foreground)',
                      }}
                  title={description || undefined}
                >
                  {field}
                </button>
              )
            })}
          </div>

          <div className="space-y-2">
            {availableFields.map((field) => {
              const description = boardMeta?.[field]?.description?.trim() ?? ''
              const isSelected = selectedFields.includes(field)
              const isHighlighted = boardMeta?.[field]?.highlighted === true

              return (
                <div
                  key={`${field}-description`}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: 'var(--vscode-panel-border)',
                    background: isSelected
                      ? 'color-mix(in srgb, var(--vscode-button-background) 10%, transparent)'
                      : 'transparent',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs" style={{ color: 'var(--vscode-foreground)' }}>
                      {field}
                    </span>
                    {isSelected && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: 'var(--vscode-button-background)',
                          color: 'var(--vscode-button-foreground)',
                        }}
                      >
                        In title
                      </span>
                    )}
                    {isHighlighted && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: 'var(--vscode-badge-background)',
                          color: 'var(--vscode-badge-foreground)',
                        }}
                      >
                        Highlighted
                      </span>
                    )}
                  </div>
                  {description.length > 0 && (
                    <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                      {description}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

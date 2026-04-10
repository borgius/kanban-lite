import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

interface ActionsBuilderSectionProps {
  boardActions?: Record<string, string>
  onSave?: (actions: Record<string, string>) => void
}

interface ActionDraftRow {
  id: string
  key: string
  title: string
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

function normalizeBoardActions(boardActions?: Record<string, string>): ActionDraftRow[] {
  return Object.entries(boardActions ?? {}).map(([key, title], index) => ({
    id: `action-${index}-${key}`,
    key,
    title,
  }))
}

function createActionsResetKey(boardActions?: Record<string, string>): string {
  return JSON.stringify(boardActions ?? {})
}

function buildPersistedActions(rows: ActionDraftRow[]): Record<string, string> {
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.key.trim()
    if (!key) return acc
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim()
    const title = row.title.trim()
    if (!key || !title) return acc
    if ((counts[key] ?? 0) !== 1) return acc
    acc[key] = title
    return acc
  }, {})
}

function getRowValidationMessage(row: ActionDraftRow, rows: ActionDraftRow[]): string | null {
  const key = row.key.trim()
  const title = row.title.trim()
  const duplicateCount = rows.filter((candidate) => candidate.key.trim() === key && key.length > 0).length

  if (key.length === 0 && title.length === 0) return 'Add a key and title to save this action.'
  if (key.length === 0) return 'Action key is required.'
  if (title.length === 0) return 'Action title is required.'
  if (duplicateCount > 1) return 'Action keys must be unique.'
  return null
}

export function ActionsBuilderSection({ boardActions, onSave }: ActionsBuilderSectionProps) {
  const initialRows = useMemo(() => normalizeBoardActions(boardActions), [boardActions])
  const resetKey = useMemo(() => createActionsResetKey(boardActions), [boardActions])

  return <ActionsBuilderSectionContent key={resetKey} initialRows={initialRows} onSave={onSave} />
}

function ActionsBuilderSectionContent({
  initialRows,
  onSave,
}: {
  initialRows: ActionDraftRow[]
  onSave?: (actions: Record<string, string>) => void
}) {
  const [rows, setRows] = useState<ActionDraftRow[]>(() => initialRows)
  const nextIdRef = useRef(initialRows.length)
  const lastSavedRef = useRef(JSON.stringify(buildPersistedActions(initialRows)))

  const persistedActions = useMemo(() => buildPersistedActions(rows), [rows])
  const persistedActionCount = Object.keys(persistedActions).length

  useEffect(() => {
    const serialized = JSON.stringify(persistedActions)
    if (serialized === lastSavedRef.current) {
      return
    }

    lastSavedRef.current = serialized
    onSave?.(persistedActions)
  }, [onSave, persistedActions])

  const addRow = () => {
    const nextId = nextIdRef.current
    nextIdRef.current += 1
    setRows((current) => [...current, { id: `draft-${nextId}`, key: '', title: '' }])
  }

  const updateRow = (rowId: string, patch: Partial<Pick<ActionDraftRow, 'key' | 'title'>>) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, ...patch } : row))
  }

  const deleteRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId))
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border px-3 py-3 md:flex-row md:items-start md:justify-between" style={sectionStyle}>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
            Board Actions
          </h3>
          <p className="mt-1 text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Configure toolbar actions for the current board. Each action needs a stable key and a human-friendly title.
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            {persistedActionCount === 0
              ? 'No board actions saved yet.'
              : `${persistedActionCount} saved action${persistedActionCount === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={addRow}
            className="rounded px-3 py-1.5 text-xs font-medium"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            Add action
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-xl border border-dashed px-6 py-8 text-center"
          style={{ borderColor: 'var(--vscode-panel-border)' }}
        >
          <h4 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>
            No board actions yet
          </h4>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Add a named action like deploy, rollback, or triage to make it available from the board toolbar.
          </p>
          <button
            type="button"
            onClick={addRow}
            className="mt-5 rounded px-3 py-1.5 text-xs font-medium"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            Add action
          </button>
        </div>
      ) : (
        <div className="rounded-xl border" style={sectionStyle}>
          {rows.map((row, index) => {
            const validationMessage = getRowValidationMessage(row, rows)

            return (
              <div
                key={row.id}
                className="space-y-3 px-3 py-3"
                style={index === 0 ? undefined : { borderTop: '1px solid var(--vscode-panel-border)' }}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-start">
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                      Key
                    </span>
                    <input
                      type="text"
                      value={row.key}
                      placeholder="Action Key"
                      onChange={(event) => updateRow(row.id, { key: event.target.value })}
                      className="rounded border px-2 py-1.5 text-sm"
                      style={inputStyle}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>

                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vscode-descriptionForeground)' }}>
                      Title
                    </span>
                    <input
                      type="text"
                      value={row.title}
                      placeholder="Action Title"
                      onChange={(event) => updateRow(row.id, { title: event.target.value })}
                      className="rounded border px-2 py-1.5 text-sm"
                      style={inputStyle}
                      autoComplete="off"
                    />
                  </label>

                  <div className="flex items-end justify-end lg:pt-[22px]">
                    <button
                      type="button"
                      onClick={() => deleteRow(row.id)}
                      className="rounded border px-3 py-1.5 text-xs font-medium"
                      style={{
                        borderColor: 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 40%, var(--vscode-panel-border))',
                        color: 'var(--vscode-errorForeground, #f87171)',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div
                  className="rounded border px-3 py-2 text-xs leading-5"
                  style={{
                    borderColor: validationMessage
                      ? 'var(--vscode-panel-border)'
                      : 'color-mix(in srgb, var(--vscode-button-background) 30%, var(--vscode-panel-border))',
                    background: validationMessage
                      ? 'transparent'
                      : 'color-mix(in srgb, var(--vscode-button-background) 8%, transparent)',
                    color: validationMessage
                      ? 'var(--vscode-descriptionForeground)'
                      : 'var(--vscode-foreground)',
                  }}
                >
                  {validationMessage ?? 'Saved automatically once both fields are valid.'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useCallback, useId, useMemo, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import type { BoardMetaFieldDef } from '../../shared/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TextSeg = { type: 'text'; id: string; value: string }
type MetaSeg = { type: 'meta'; id: string; key: string }
type TitleSeg = { type: 'title'; id: string }
type Segment = TextSeg | MetaSeg | TitleSeg

interface TitleBuilderSectionProps {
  boardMeta?: Record<string, BoardMetaFieldDef>
  boardTitle?: string[]
  boardTitleTemplate?: string
  onSave?: (title: string[], titleTemplate?: string) => void
}

// ---------------------------------------------------------------------------
// Segment utilities
// ---------------------------------------------------------------------------

let _idSeq = 0
function nextId(): string {
  return `seg-${++_idSeq}`
}

/** Ensure segments always have text at boundaries and between non-text items. */
function normalizeSegments(raw: Segment[]): Segment[] {
  const result: Segment[] = []

  for (const seg of raw) {
    if (seg.type === 'text') {
      const prev = result[result.length - 1]
      if (prev?.type === 'text') {
        ;(prev as TextSeg).value += seg.value
      } else {
        result.push({ ...seg })
      }
    } else {
      const prev = result[result.length - 1]
      if (!prev || prev.type !== 'text') {
        result.push({ type: 'text', id: nextId(), value: '' })
      }
      result.push({ ...seg })
      result.push({ type: 'text', id: nextId(), value: '' })
    }
  }

  if (result.length === 0 || result[0].type !== 'text') {
    result.unshift({ type: 'text', id: nextId(), value: '' })
  }
  if (result[result.length - 1].type !== 'text') {
    result.push({ type: 'text', id: nextId(), value: '' })
  }

  return result
}

/** Parse a template string like `${metadata.company}: ${title}` into segments. */
function parseTemplate(template: string): Segment[] {
  const segments: Segment[] = []
  let remaining = template

  while (remaining.length > 0) {
    const match = remaining.match(/\$\{(title|metadata\.[^}]+)\}/)
    if (!match || match.index === undefined) {
      segments.push({ type: 'text', id: nextId(), value: remaining })
      break
    }
    if (match.index > 0) {
      segments.push({ type: 'text', id: nextId(), value: remaining.slice(0, match.index) })
    }
    if (match[1] === 'title') {
      segments.push({ type: 'title', id: nextId() })
    } else {
      segments.push({ type: 'meta', id: nextId(), key: match[1].slice('metadata.'.length) })
    }
    remaining = remaining.slice(match.index + match[0].length)
  }

  return normalizeSegments(segments)
}

/** Build a default template from a legacy `string[]` title field list. */
function buildTemplateFromFields(fields?: string[]): string {
  if (!fields || fields.length === 0) return '${title}'
  return fields.map(f => `\${metadata.${f}}`).join(' ') + ' ${title}'
}

/** Serialize segments back to a template string. */
function serializeTemplate(segments: Segment[]): string {
  return segments.map(seg => {
    if (seg.type === 'text') return seg.value
    if (seg.type === 'meta') return `\${metadata.${seg.key}}`
    return '${title}'
  }).join('')
}

/** Derive the ordered list of referenced metadata keys. */
function deriveMetaKeys(segments: Segment[]): string[] {
  return segments.filter((s): s is MetaSeg => s.type === 'meta').map(s => s.key)
}

/** Evaluate segments for the live preview. */
function evaluatePreview(
  segments: Segment[],
  boardMeta?: Record<string, BoardMetaFieldDef>,
  sampleTitle = 'My Task Title',
): string {
  return segments.map(seg => {
    if (seg.type === 'text') return seg.value
    if (seg.type === 'title') return sampleTitle
    const def = boardMeta?.[seg.key]
    const sample = def?.default
      ? String(def.default)
      : seg.key.charAt(0).toUpperCase() + seg.key.slice(1)
    return sample
  }).join('') || sampleTitle
}

function hasTitleSeg(segments: Segment[]): boolean {
  return segments.some(s => s.type === 'title')
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sectionStyle: CSSProperties = {
  borderColor: 'var(--vscode-panel-border)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
}

const chipBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 12,
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  cursor: 'default',
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function TitleBuilderSection({ boardMeta, boardTitle, boardTitleTemplate, onSave }: TitleBuilderSectionProps) {
  const initialTemplate = boardTitleTemplate ?? buildTemplateFromFields(boardTitle)
  const resetKey = useMemo(
    () => JSON.stringify({ template: boardTitleTemplate, fields: boardTitle, meta: Object.keys(boardMeta ?? {}).sort() }),
    [boardTitleTemplate, boardTitle, boardMeta],
  )

  return (
    <TitleBuilderSectionContent
      key={resetKey}
      initialTemplate={initialTemplate}
      boardMeta={boardMeta}
      onSave={onSave}
    />
  )
}

// ---------------------------------------------------------------------------
// Inner content (stateful)
// ---------------------------------------------------------------------------

function TitleBuilderSectionContent({
  initialTemplate,
  boardMeta,
  onSave,
}: {
  initialTemplate: string
  boardMeta?: Record<string, BoardMetaFieldDef>
  onSave?: (title: string[], titleTemplate?: string) => void
}) {
  const [segments, setSegmentsRaw] = useState<Segment[]>(() => parseTemplate(initialTemplate))
  const [dragOverSegId, setDragOverSegId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const editorId = useId()

  const metaKeys = useMemo(() => Object.keys(boardMeta ?? {}), [boardMeta])
  const usedMetaKeys = useMemo(() => deriveMetaKeys(segments), [segments])
  const availableKeys = useMemo(
    () => [...new Set([...usedMetaKeys, ...metaKeys])],
    [usedMetaKeys, metaKeys],
  )

  const preview = useMemo(() => evaluatePreview(segments, boardMeta), [segments, boardMeta])

  const setSegments = useCallback((next: Segment[]) => {
    const normalized = normalizeSegments(next)
    setSegmentsRaw(normalized)
    const template = serializeTemplate(normalized)
    const metaKeysList = deriveMetaKeys(normalized)
    onSave?.(metaKeysList, template)
  }, [onSave])

  const updateText = useCallback((id: string, value: string) => {
    setSegments(segments.map(s => s.id === id ? { ...s, value } as TextSeg : s))
  }, [segments, setSegments])

  const removeSegment = useCallback((id: string) => {
    const seg = segments.find(s => s.id === id)
    if (!seg || seg.type === 'title') return  // title chip cannot be removed
    setSegments(segments.filter(s => s.id !== id))
  }, [segments, setSegments])

  const handleChipKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      removeSegment(id)
    }
  }, [removeSegment])

  const handleDragStart = useCallback((e: DragEvent<HTMLElement>, key: string) => {
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'copy'
    setIsDragging(true)
  }, [])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    setDragOverSegId(null)
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>, textSegId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverSegId(textSegId)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverSegId(null)
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLElement>, textSegId: string) => {
    e.preventDefault()
    setDragOverSegId(null)
    const key = e.dataTransfer.getData('text/plain')
    if (!key) return

    const isTitle = key === '__title__'
    if (isTitle && hasTitleSeg(segments)) return

    const idx = segments.findIndex(s => s.id === textSegId)
    if (idx === -1) return

    const newChip: Segment = isTitle
      ? { type: 'title', id: nextId() }
      : { type: 'meta', id: nextId(), key }

    const textSeg = segments[idx] as TextSeg
    const newSegments = [
      ...segments.slice(0, idx),
      { ...textSeg },
      newChip,
      { type: 'text' as const, id: nextId(), value: '' },
      ...segments.slice(idx + 1),
    ]

    setSegments(newSegments)
  }, [segments, setSegments])

  const insertKeyAtEnd = useCallback((key: string) => {
    const isTitle = key === '__title__'
    if (isTitle && hasTitleSeg(segments)) return

    const newChip: Segment = isTitle
      ? { type: 'title', id: nextId() }
      : { type: 'meta', id: nextId(), key }

    const lastTextIdx = segments.map((s, i) => s.type === 'text' ? i : -1).filter(i => i >= 0).pop() ?? segments.length - 1
    const newSegments = [
      ...segments.slice(0, lastTextIdx),
      newChip,
      ...segments.slice(lastTextIdx),
    ]
    setSegments(newSegments)
  }, [segments, setSegments])

  if (availableKeys.length === 0) {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="rounded-xl border border-dashed px-6 py-8 text-center" style={{ borderColor: 'var(--vscode-panel-border)' }}>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>No metadata fields available</h4>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6" style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Add board metadata fields first, then build a title template from them.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {/* Description */}
      <div className="rounded-xl border px-4 py-3 space-y-1" style={sectionStyle}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--vscode-foreground)' }}>Title Template</h3>
        <p className="text-xs leading-5" style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Build a template for how card titles are displayed. Drag metadata keys into the template row, or click them to append.
          Type any text between fields as separators (e.g. <code>: </code> or <code> – </code>).
        </p>
      </div>

      {/* Preview */}
      <div className="rounded-xl border px-4 py-3" style={sectionStyle}>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--vscode-descriptionForeground)' }}>Preview</p>
        <p
          className="text-sm font-medium truncate"
          style={{ color: 'var(--vscode-foreground)' }}
          aria-label="Title preview"
        >
          {preview}
        </p>
      </div>

      {/* Template editor */}
      <div
        id={editorId}
        className="rounded-xl border px-3 py-3"
        style={sectionStyle}
        aria-label="Title template editor"
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--vscode-descriptionForeground)' }}>Template</p>
        <div
          className="flex flex-wrap items-center"
          style={{ minHeight: 34, gap: '0px 2px', lineHeight: '28px' }}
        >
          {segments.map((seg) => {
            if (seg.type === 'text') {
              return (
                <TextSlot
                  key={seg.id}
                  id={seg.id}
                  value={(seg as TextSeg).value}
                  isDropTarget={dragOverSegId === seg.id}
                  isDragActive={isDragging}
                  onChange={updateText}
                  onDragOver={(e) => handleDragOver(e, seg.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, seg.id)}
                />
              )
            }
            if (seg.type === 'meta') {
              return (
                <MetaChip
                  key={seg.id}
                  segId={seg.id}
                  label={(seg as MetaSeg).key}
                  onRemove={removeSegment}
                  onKeyDown={handleChipKeyDown}
                />
              )
            }
            return (
              <TitleChip key={seg.id} segId={seg.id} onKeyDown={handleChipKeyDown} />
            )
          })}
        </div>
        {!hasTitleSeg(segments) && (
          <p className="mt-2 text-xs" style={{ color: 'var(--vscode-inputValidation-warningForeground, #e5c07b)' }}>
            {'The template has no ${title} placeholder — the card title won\'t appear.'}
          </p>
        )}
      </div>

      {/* Available keys panel */}
      <div className="rounded-xl border px-3 py-3" style={sectionStyle}>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Available fields <span className="normal-case font-normal">(drag or click to insert)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {!hasTitleSeg(segments) && (
            <DraggableKeyChip
              label="${title}"
              dragKey="__title__"
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onClick={() => insertKeyAtEnd('__title__')}
            />
          )}
          {availableKeys.map((key) => (
            <DraggableKeyChip
              key={key}
              label={key}
              dragKey={key}
              description={boardMeta?.[key]?.description}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onClick={() => insertKeyAtEnd(key)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Editable text slot between chips — also a drop target for dragged keys. */
function TextSlot({
  id,
  value,
  isDropTarget,
  isDragActive,
  onChange,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  id: string
  value: string
  isDropTarget: boolean
  isDragActive: boolean
  onChange: (id: string, value: string) => void
  onDragOver: (e: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const charWidth = Math.max(1, value.length) + 'ch'

  return (
    <span
      className="inline-flex items-center"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(id, e.target.value)}
        style={{
          width: charWidth,
          minWidth: isDropTarget ? '28px' : isDragActive ? '20px' : '4px',
          maxWidth: '200px',
          background: isDropTarget
            ? 'color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent)'
            : 'transparent',
          border: isDropTarget
            ? '1px dashed var(--vscode-focusBorder)'
            : '1px solid transparent',
          borderRadius: 4,
          color: 'var(--vscode-foreground)',
          fontSize: 13,
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          padding: '0 2px',
          outline: 'none',
          height: '26px',
          lineHeight: '24px',
          verticalAlign: 'middle',
          transition: 'min-width 0.1s, background 0.1s',
        }}
        placeholder={isDropTarget ? '↓' : ''}
        aria-label="separator text"
      />
    </span>
  )
}

/** A metadata field chip inside the template row. Has a remove (×) button. */
function MetaChip({
  segId,
  label,
  onRemove,
  onKeyDown,
}: {
  segId: string
  label: string
  onRemove: (id: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, id: string) => void
}) {
  return (
    <span
      style={{
        ...chipBase,
        background: 'color-mix(in srgb, var(--vscode-button-background) 20%, transparent)',
        border: '1px solid color-mix(in srgb, var(--vscode-button-background) 50%, transparent)',
        color: 'var(--vscode-foreground)',
        verticalAlign: 'middle',
      }}
    >
      <span style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: 10, opacity: 0.55 }}>meta.</span>
      <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label} from title template`}
        onClick={() => onRemove(segId)}
        onKeyDown={e => onKeyDown(e, segId)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 0 0 2px',
          fontSize: 14,
          lineHeight: 1,
          color: 'var(--vscode-descriptionForeground)',
          marginLeft: 2,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--vscode-errorForeground, #f87171)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--vscode-descriptionForeground)' }}
      >
        ×
      </button>
    </span>
  )
}

/** The special `${title}` chip — always required, the lock icon signals it can't be removed. */
function TitleChip({ segId, onKeyDown }: { segId: string; onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, id: string) => void }) {
  return (
    <span
      style={{
        ...chipBase,
        background: 'var(--vscode-badge-background)',
        border: '1px solid var(--vscode-badge-background)',
        color: 'var(--vscode-badge-foreground)',
        verticalAlign: 'middle',
        cursor: 'default',
      }}
      title="The card's markdown heading title (cannot be removed)"
    >
      <span style={{ fontWeight: 700, fontSize: 12 }}>title</span>
      <button
        type="button"
        aria-label="Base title placeholder — required, cannot be removed"
        onKeyDown={e => onKeyDown(e, segId)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'not-allowed',
          padding: '0 0 0 2px',
          fontSize: 11,
          color: 'inherit',
          opacity: 0.55,
        }}
        tabIndex={-1}
      >
        🔒
      </button>
    </span>
  )
}

/** A draggable key chip in the available keys panel. */
function DraggableKeyChip({
  label,
  dragKey,
  description,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  label: string
  dragKey: string
  description?: string
  onDragStart: (e: DragEvent<HTMLElement>, key: string) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={e => onDragStart(e, dragKey)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={description ?? `Insert ${label} into template`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        border: '1px solid var(--vscode-panel-border)',
        background: 'var(--vscode-input-background)',
        color: 'var(--vscode-foreground)',
        padding: '3px 10px',
        fontSize: 12,
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        cursor: 'grab',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--vscode-button-background)'
        e.currentTarget.style.background = 'color-mix(in srgb, var(--vscode-button-background) 10%, var(--vscode-input-background))'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--vscode-panel-border)'
        e.currentTarget.style.background = 'var(--vscode-input-background)'
      }}
    >
      {label}
    </button>
  )
}

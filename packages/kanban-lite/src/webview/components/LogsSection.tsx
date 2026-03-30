import { useState, useMemo, useEffect, useRef } from 'react'
import { Trash2, ChevronDown, Check, ChevronUp } from 'lucide-react'
import { parseCommentMarkdown } from '../lib/markdownTools'
import type { LogEntry } from '../../shared/types'
import { dump as yamlDump } from 'js-yaml'

type LogLimit = 10 | 25 | 50 | 100 | 'all'
type LogOrder = 'asc' | 'desc'
interface ShowOptions {
  timestamp: boolean
  source: boolean
  objects: boolean
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function LogText({ text }: { text: string }) {
  const html = useMemo(() => parseCommentMarkdown(text), [text])
  return (
    <span
      className="log-text [&_p]:inline [&_p]:m-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function toYaml(obj: Record<string, unknown>): string {
  try {
    return yamlDump(obj, { indent: 2, lineWidth: 80, noRefs: true }).trimEnd()
  } catch {
    return JSON.stringify(obj, null, 2)
  }
}

function toInlineJson(obj: Record<string, unknown>): string {
  const s = JSON.stringify(obj)
  return s.length > 60 ? s.slice(0, 59) + '…}' : s
}

/** Object cell shown when show.objects=true — always expanded as YAML */
function ObjectBlock({ obj }: { obj: Record<string, unknown> }) {
  const yaml = useMemo(() => toYaml(obj), [obj])
  return (
    <pre
      className="mt-1 px-2 py-1.5 rounded text-[10px] font-mono leading-relaxed overflow-x-auto"
      style={{
        background: 'var(--vscode-textCodeBlock-background, rgba(0,0,0,0.1))',
        color: 'var(--vscode-foreground)',
        border: '1px solid var(--vscode-panel-border)',
      }}
    >{yaml}</pre>
  )
}

/** Inline object shown when show.objects=false — compact JSON, expandable to YAML */
function InlineObject({ obj }: { obj: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const yaml = useMemo(() => toYaml(obj), [obj])
  const inline = useMemo(() => toInlineJson(obj), [obj])

  if (expanded) {
    return (
      <div style={{ flexBasis: '100%' }} className="mt-1 flex items-start gap-1">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center shrink-0 px-1 py-1 text-[10px] rounded transition-colors vscode-hover-bg"
          style={{ color: 'var(--vscode-descriptionForeground)' }}
          title="Collapse"
        >
          <ChevronUp size={10} />
        </button>
        <pre
          className="flex-1 px-2 py-1.5 rounded text-[10px] font-mono leading-relaxed overflow-x-auto"
          style={{
            background: 'var(--vscode-textCodeBlock-background, rgba(0,0,0,0.1))',
            color: 'var(--vscode-foreground)',
            border: '1px solid var(--vscode-panel-border)',
          }}
        >{yaml}</pre>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="font-mono text-[10px] ml-1 px-1 rounded transition-colors vscode-hover-bg cursor-pointer"
      style={{
        color: 'var(--vscode-descriptionForeground)',
        background: 'var(--vscode-textCodeBlock-background, rgba(0,0,0,0.08))',
      }}
      title="Click to expand"
    >
      {inline}
    </button>
  )
}

// Dropdown button
function DropdownButton({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors vscode-hover-bg"
        style={{ color: 'var(--vscode-descriptionForeground)' }}
      >
        {label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full mt-1 z-50 rounded shadow-lg py-1 min-w-[120px]"
            style={{
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function DropdownItem({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1 text-[10px] transition-colors vscode-hover-bg flex items-center gap-2"
      style={{ color: active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
    >
      <span className="w-3">{active && <Check size={10} />}</span>
      {label}
    </button>
  )
}

function CheckboxItem({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className="w-full text-left px-3 py-1 text-[10px] transition-colors vscode-hover-bg flex items-center gap-2"
      style={{ color: 'var(--vscode-foreground)' }}
    >
      <span
        className="w-3 h-3 rounded-sm border flex items-center justify-center shrink-0"
        style={{
          borderColor: checked ? 'var(--vscode-focusBorder)' : 'var(--vscode-checkbox-border, var(--vscode-panel-border))',
          background: checked ? 'var(--vscode-focusBorder)' : 'transparent',
        }}
      >
        {checked && <Check size={8} style={{ color: 'var(--vscode-checkbox-foreground, white)' }} />}
      </span>
      {label}
    </button>
  )
}

interface LogsFilterState {
  limit: number | 'all'
  order: 'asc' | 'desc'
  disabledSources: string[]
  show: { timestamp: boolean; source: boolean; objects: boolean }
}

interface LogsSectionProps {
  logs: LogEntry[]
  onClearLogs: () => void
  logsFilter?: LogsFilterState
  onLogsFilterChange?: (filter: LogsFilterState) => void
}

function getLogEntryBaseKey(entry: LogEntry): string {
  return JSON.stringify([entry.timestamp, entry.source, entry.text, entry.object ?? null])
}

export function LogsSection({ logs, onClearLogs, logsFilter, onLogsFilterChange }: LogsSectionProps) {
  const [limit, setLimit] = useState<LogLimit>(() => (logsFilter?.limit as LogLimit) ?? 'all')
  const [order, setOrder] = useState<LogOrder>(() => logsFilter?.order ?? 'desc')
  const [disabledSources, setDisabledSources] = useState<Set<string>>(() => new Set(logsFilter?.disabledSources ?? []))
  const [show, setShow] = useState<ShowOptions>(() => logsFilter?.show ?? {
    timestamp: true,
    source: true,
    objects: false,
  })

  // Get unique sources from the logs
  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const entry of logs) set.add(entry.source)
    return Array.from(set).sort()
  }, [logs])

  // Apply filters
  const filteredLogs = useMemo(() => {
    let result = logs
    if (disabledSources.size > 0) {
      result = result.filter(e => !disabledSources.has(e.source))
    }
    // Order
    result = [...result]
    if (order === 'desc') result.reverse()
    // Limit
    if (limit !== 'all') {
      result = result.slice(0, limit)
    }
    return result
  }, [logs, disabledSources, order, limit])

  const keyedLogs = useMemo(() => {
    const seen = new Map<string, number>()

    return filteredLogs.map((entry) => {
      const baseKey = getLogEntryBaseKey(entry)
      const nextCount = (seen.get(baseKey) ?? 0) + 1
      seen.set(baseKey, nextCount)

      return {
        entry,
        key: `${baseKey}:${nextCount}`,
      }
    })
  }, [filteredLogs])

  const limitOptions: LogLimit[] = [10, 25, 50, 100, 'all']

  // Persist filter changes — skip the initial mount so opening the Logs tab
  // doesn't fire saveSettings with the already-persisted defaults.
  const isMountedRef = useRef(false)
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      return
    }
    onLogsFilterChange?.({
      limit,
      order,
      disabledSources: Array.from(disabledSources),
      show,
    })
  }, [limit, order, disabledSources, show]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="card-log-toolbar shrink-0">
        {/* Clear */}
        <button
          type="button"
          onClick={onClearLogs}
          disabled={logs.length === 0}
          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors vscode-hover-bg disabled:opacity-40"
          style={{ color: 'var(--vscode-descriptionForeground)' }}
          title="Clear all logs"
        >
          <Trash2 size={10} />
          Clear
        </button>

        <span className="w-px h-4 mx-0.5" style={{ background: 'var(--vscode-panel-border)' }} />

        {/* Limit */}
        <DropdownButton label={<>Limit: {limit}</>}>
          {limitOptions.map(opt => (
            <DropdownItem
              key={String(opt)}
              label={String(opt)}
              active={limit === opt}
              onClick={() => setLimit(opt)}
            />
          ))}
        </DropdownButton>

        {/* Order */}
        <DropdownButton label={<>Order: {order === 'desc' ? 'Newest' : 'Oldest'}</>}>
          <DropdownItem label="Newest first" active={order === 'desc'} onClick={() => setOrder('desc')} />
          <DropdownItem label="Oldest first" active={order === 'asc'} onClick={() => setOrder('asc')} />
        </DropdownButton>

        {/* Sources filter (multi-select; system hidden by default) */}
        {sources.length > 0 && (
          <DropdownButton label={`Sources (${sources.filter(s => !disabledSources.has(s)).length}/${sources.length})`}>
            <div onClick={(e) => e.stopPropagation()}>
              {sources.map(s => (
                <CheckboxItem
                  key={s}
                  label={s}
                  checked={!disabledSources.has(s)}
                  onChange={checked => setDisabledSources(prev => {
                    const next = new Set(prev)
                    if (checked) next.delete(s)
                    else next.add(s)
                    return next
                  })}
                />
              ))}
            </div>
          </DropdownButton>
        )}

        {/* Show/Hide */}
        <DropdownButton label="Show">
          <div onClick={(e) => e.stopPropagation()}>
            <CheckboxItem label="Timestamp" checked={show.timestamp} onChange={v => setShow(prev => ({ ...prev, timestamp: v }))} />
            <CheckboxItem label="Source" checked={show.source} onChange={v => setShow(prev => ({ ...prev, source: v }))} />
            <CheckboxItem label="Objects" checked={show.objects} onChange={v => setShow(prev => ({ ...prev, objects: v }))} />
          </div>
        </DropdownButton>

        {/* Count */}
        <span className="card-log-count">
          {filteredLogs.length}{limit !== 'all' && logs.length > limit ? ` / ${logs.length}` : ''} entries
        </span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-auto">
        {filteredLogs.length === 0 ? (
          <p
            className="p-4 text-xs italic"
            style={{ color: 'var(--vscode-descriptionForeground)' }}
          >
            {logs.length === 0 ? 'No log entries yet.' : 'No entries match the current filters.'}
          </p>
        ) : (
          <div className="flex flex-col">
            {keyedLogs.map(({ entry, key }) => (
              <div
                key={key}
                className="card-log-entry px-4 py-2 text-xs"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {show.timestamp && (
                    <span
                      className="font-mono text-[10px] shrink-0"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                      title={entry.timestamp}
                    >
                      {formatTimestamp(entry.timestamp)}
                    </span>
                  )}
                  {show.source && (
                    <span
                      className="text-[10px] font-medium px-1 rounded shrink-0"
                      style={{
                        background: 'var(--vscode-badge-background)',
                        color: 'var(--vscode-badge-foreground)',
                      }}
                    >
                      {entry.source}
                    </span>
                  )}
                  <span
                    className="comment-markdown inline text-xs leading-normal [&_p]:inline [&_p]:m-0"
                    style={{ color: 'var(--vscode-foreground)' }}
                  >
                    <LogText text={entry.text} />
                  </span>
                  {/* Inline compact JSON when objects panel is hidden */}
                  {!show.objects && entry.object && (
                    <InlineObject obj={entry.object} />
                  )}
                </div>
                {/* Expanded YAML block when objects panel is enabled */}
                {show.objects && entry.object && (
                  <ObjectBlock obj={entry.object} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

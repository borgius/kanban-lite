import type { Card } from '../../shared/types'

export const CHECKLIST_RESERVED_LABELS = ['tasks', 'in-progress'] as const

type ChecklistReservedLabel = typeof CHECKLIST_RESERVED_LABELS[number]

type ChecklistCardShape = Pick<Card, 'labels'> & Partial<Pick<Card, 'tasks'>>

export interface ChecklistStats {
  total: number
  completed: number
  incomplete: number
}

export interface ChecklistItemReadModel {
  index: number
  raw: string
  expectedRaw: string
  checked: boolean
  text: string
}

export interface ChecklistReadModel {
  cardId: string
  boardId: string
  token: string
  summary: ChecklistStats
  items: ChecklistItemReadModel[]
}

function hashChecklistSnapshot(snapshot: string, seed: number, prime: number): string {
  let hash = seed >>> 0

  for (let index = 0; index < snapshot.length; index += 1) {
    hash ^= snapshot.charCodeAt(index)
    hash = Math.imul(hash, prime) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

function dedupeLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const label of labels) {
    if (!seen.has(label)) {
      seen.add(label)
      deduped.push(label)
    }
  }

  return deduped
}

function collapseTaskWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNormalizedChecklistText(task: string): string {
  const match = task.match(/^- \[(?: |x)\]\s*(.*)$/)
  return match?.[1] ?? ''
}

const CHECKLIST_MARKDOWN_LINK_RE = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g
const CHECKLIST_MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g

const CHECKLIST_ALLOWED_LINK_SCHEMES = new Set(['http', 'https', 'mailto'])
const CHECKLIST_HTML_ENTITY_RE = /&(?:#(\d+)|#x([\da-fA-F]+)|([A-Za-z][A-Za-z\d]+));/g
const CHECKLIST_NAMED_HTML_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['apos', "'"],
  ['colon', ':'],
  ['gt', '>'],
  ['lt', '<'],
  ['nbsp', ' '],
  ['newline', '\n'],
  ['quot', '"'],
  ['tab', '\t'],
])

function stripInlineCodeSpans(value: string): string {
  let result = ''
  let index = 0

  while (index < value.length) {
    const start = value.indexOf('`', index)
    if (start === -1) {
      return result + value.slice(index)
    }

    result += value.slice(index, start)

    let tickEnd = start
    while (value[tickEnd] === '`') {
      tickEnd += 1
    }

    const fence = value.slice(start, tickEnd)
    const close = value.indexOf(fence, tickEnd)
    if (close === -1) {
      return result + value.slice(start)
    }

    index = close + fence.length
  }

  return result
}

function extractChecklistLinkHref(rawHref: string): string {
  const trimmed = rawHref.trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('<')) {
    const closeIndex = trimmed.indexOf('>')
    if (closeIndex > 1) {
      return trimmed.slice(1, closeIndex).trim()
    }
  }

  const whitespaceIndex = trimmed.search(/\s/)
  return whitespaceIndex === -1 ? trimmed : trimmed.slice(0, whitespaceIndex)
}

function decodeChecklistHtmlEntity(entity: string, decimal?: string, hexadecimal?: string, named?: string): string {
  const numeric = decimal
    ? Number.parseInt(decimal, 10)
    : hexadecimal
      ? Number.parseInt(hexadecimal, 16)
      : undefined

  if (numeric !== undefined) {
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) {
      return entity
    }

    try {
      return String.fromCodePoint(numeric)
    } catch {
      return entity
    }
  }

  return named
    ? (CHECKLIST_NAMED_HTML_ENTITIES.get(named.toLowerCase()) ?? entity)
    : entity
}

function decodeChecklistHtmlEntities(value: string): string {
  let decoded = value

  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded.replace(
      CHECKLIST_HTML_ENTITY_RE,
      (entity, decimal, hexadecimal, named) => decodeChecklistHtmlEntity(entity, decimal, hexadecimal, named),
    )

    if (next === decoded) {
      break
    }

    decoded = next
  }

  return decoded
}

export function isSafeChecklistLinkHref(rawHref: string): boolean {
  const href = decodeChecklistHtmlEntities(extractChecklistLinkHref(rawHref)).trim()
  const scheme = href.match(/^([A-Za-z][A-Za-z\d+.-]*):/)?.[1]?.toLowerCase()

  if (!scheme) {
    return false
  }

  return CHECKLIST_ALLOWED_LINK_SCHEMES.has(scheme)
}

function assertNoRawChecklistHtml(text: string): void {
  const withoutCodeSpans = stripInlineCodeSpans(text)
  if (/<(?:!--[\s\S]*?--\s*|\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?)>/.test(withoutCodeSpans)) {
    throw new Error('Checklist task text must not contain raw HTML')
  }
}

function assertNoUnsafeChecklistMarkdownLinks(text: string): void {
  const withoutCodeSpans = stripInlineCodeSpans(text)

  for (const match of withoutCodeSpans.matchAll(CHECKLIST_MARKDOWN_LINK_RE)) {
    if (!isSafeChecklistLinkHref(match[1])) {
      throw new Error('Checklist task links must use http, https, or mailto URLs')
    }
  }
}

function assertNoChecklistMarkdownImages(text: string): void {
  const withoutCodeSpans = stripInlineCodeSpans(text)

  if (CHECKLIST_MARKDOWN_IMAGE_RE.test(withoutCodeSpans)) {
    CHECKLIST_MARKDOWN_IMAGE_RE.lastIndex = 0
    throw new Error('Checklist task text must not contain markdown images')
  }

  CHECKLIST_MARKDOWN_IMAGE_RE.lastIndex = 0
}

export function isReservedChecklistLabel(label: string): label is ChecklistReservedLabel {
  return CHECKLIST_RESERVED_LABELS.includes(label as ChecklistReservedLabel)
}

export function normalizeChecklistTaskLine(task: string): string {
  const flattened = collapseTaskWhitespace(String(task ?? ''))
  if (!flattened) return '- [ ]'

  const match = flattened.match(/^(?:[-*+]\s*)?\[( |x|X)\]\s*(.*)$/)
  if (match) {
    const checked = match[1].toLowerCase() === 'x'
    const body = match[2].trim().replace(/\s+/g, ' ')
    return body.length > 0
      ? `- [${checked ? 'x' : ' '}] ${body}`
      : `- [${checked ? 'x' : ' '}]`
  }

  const body = flattened.replace(/^(?:[-*+]\s*)/, '').trim()
  return body.length > 0 ? `- [ ] ${body}` : '- [ ]'
}

export function normalizeChecklistSeedTaskLine(task: string): string {
  if (/\r?\n/.test(String(task ?? ''))) {
    throw new Error('Checklist task text must be a single line')
  }

  const normalized = normalizeChecklistTaskLine(task)
  const text = extractNormalizedChecklistText(normalized)
  if (!text) {
    throw new Error('Checklist task text must not be empty')
  }

  assertNoRawChecklistHtml(text)
  assertNoChecklistMarkdownImages(text)
  assertNoUnsafeChecklistMarkdownLinks(text)

  return normalized
}

export function buildChecklistTask(text: string, checked = false): string {
  if (/\r?\n/.test(text)) {
    throw new Error('Checklist task text must be a single line')
  }

  const normalized = normalizeChecklistTaskLine(`- [${checked ? 'x' : ' '}] ${text}`)
  const normalizedText = extractNormalizedChecklistText(normalized)
  if (!normalizedText) {
    throw new Error('Checklist task text must not be empty')
  }

  assertNoRawChecklistHtml(normalizedText)
  assertNoChecklistMarkdownImages(normalizedText)
  assertNoUnsafeChecklistMarkdownLinks(normalizedText)
  return normalized
}

export function normalizeChecklistTasks(tasks: readonly string[] | undefined): string[] | undefined {
  if (!tasks || tasks.length === 0) return undefined

  const normalized = tasks.map((task) => normalizeChecklistTaskLine(task))
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeChecklistSeedTasks(tasks: readonly string[] | undefined): string[] | undefined {
  if (!tasks || tasks.length === 0) return undefined

  return tasks.map((task) => normalizeChecklistSeedTaskLine(task))
}

export function buildChecklistToken(tasks: readonly string[] | undefined): string {
  const normalized = normalizeChecklistTasks(tasks) ?? []
  const snapshot = JSON.stringify(normalized)
  const primary = hashChecklistSnapshot(snapshot, 0x811c9dc5, 0x01000193)
  const secondary = hashChecklistSnapshot(snapshot, 0x9e3779b1, 0x27d4eb2d)

  return `cl1:${snapshot.length}:${primary}${secondary}`
}

export function getChecklistStats(tasks: readonly string[] | undefined): ChecklistStats {
  const normalized = normalizeChecklistTasks(tasks)
  const total = normalized?.length ?? 0
  const completed = normalized?.filter((task) => task.startsWith('- [x]')).length ?? 0
  return {
    total,
    completed,
    incomplete: total - completed,
  }
}

export function syncChecklistDerivedLabels(labels: readonly string[], tasks: readonly string[] | undefined): string[] {
  const nextLabels = dedupeLabels(labels).filter((label) => !isReservedChecklistLabel(label))
  const { total, incomplete } = getChecklistStats(tasks)

  if (total > 0) {
    nextLabels.push('tasks')
  }
  if (incomplete > 0) {
    nextLabels.push('in-progress')
  }

  return nextLabels
}

export function normalizeCardChecklistState<T extends ChecklistCardShape>(card: T): T {
  const normalizedTasks = normalizeChecklistTasks(card.tasks)
  const normalized = {
    ...card,
    labels: syncChecklistDerivedLabels(card.labels, normalizedTasks),
  } as T & { tasks?: string[] }

  if (normalizedTasks) {
    normalized.tasks = normalizedTasks
  } else {
    delete normalized.tasks
  }

  return normalized as T
}

export function buildChecklistReadModel(card: Pick<Card, 'id' | 'boardId' | 'tasks'>): ChecklistReadModel {
  const normalizedTasks = normalizeChecklistTasks(card.tasks) ?? []
  const items = normalizedTasks.map((task, index) => {
    const match = task.match(/^- \[( |x)\]\s*(.*)$/)
    const checked = match?.[1] === 'x'
    const text = match?.[2] ?? ''

    return {
      index,
      raw: task,
      expectedRaw: task,
      checked,
      text,
    }
  })

  return {
    cardId: card.id,
    boardId: card.boardId ?? 'default',
    token: buildChecklistToken(normalizedTasks),
    summary: getChecklistStats(normalizedTasks),
    items,
  }
}

export function projectCardChecklistState<T extends ChecklistCardShape>(card: T, canShowChecklist: boolean): T {
  const normalized = normalizeCardChecklistState(card)
  if (canShowChecklist) {
    return normalized
  }

  const projected = {
    ...normalized,
    labels: normalized.labels.filter((label) => !isReservedChecklistLabel(label)),
  } as T & { tasks?: string[] }

  delete projected.tasks
  return projected as T
}

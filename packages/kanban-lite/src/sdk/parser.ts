import * as path from 'path'
import * as yaml from 'js-yaml'
import type { Comment, Card, CardStatus, Priority, CardFormAttachment, CardFormDataMap } from '../shared/types'
import { CARD_FORMAT_VERSION } from '../shared/types'
import { normalizeChecklistTasks } from './modules/checklist'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function parseForms(value: unknown): CardFormAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined

  const forms = value
    .flatMap((entry) => {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        return [{ name: entry.trim() } satisfies CardFormAttachment]
      }

      if (!isRecord(entry)) {
        return []
      }

      const form: CardFormAttachment = {}
      if (typeof entry.name === 'string' && entry.name.trim().length > 0) form.name = entry.name
      if (isRecord(entry.schema)) form.schema = entry.schema
      if (isRecord(entry.ui)) form.ui = entry.ui
      if (isRecord(entry.data)) form.data = entry.data
      return form.name !== undefined || form.schema !== undefined ? [form] : []
    })

  return forms.length > 0 ? forms : undefined
}

function parseFormData(value: unknown): CardFormDataMap | undefined {
  if (!isRecord(value)) return undefined

  const formData = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => isRecord(entry))
  ) as CardFormDataMap

  return Object.keys(formData).length > 0 ? formData : undefined
}

function extractIdFromFilename(filePath: string): string {
  const basename = path.basename(filePath, '.md')
  // New format: "42-some-slug" → "42"
  const numericMatch = basename.match(/^(\d+)-/)
  if (numericMatch) return numericMatch[1]
  // Legacy format: full basename is the ID
  return basename
}

function parseCommentBlock(header: string, body: string): Comment | null {
  const getValue = (key: string): string => {
    const match = header.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    if (!match) return ''
    return match[1].trim().replace(/^["']|["']$/g, '')
  }

  if (getValue('comment') !== 'true') return null

  const id = getValue('id')
  const author = getValue('author')
  const created = getValue('created')
  if (!id) return null

  return { id, author, created, content: body.trim() }
}

/**
 * Parses a markdown file with YAML frontmatter into a Card object.
 *
 * The file is expected to have a YAML frontmatter block delimited by `---` at the
 * top, followed by the card body content. Additional `---` delimited blocks after
 * the body are parsed as comment sections (if they contain `comment: true`),
 * otherwise they are treated as part of the body content.
 *
 * @param content - The raw string content of the markdown file.
 * @param filePath - The absolute file path, used to extract the card ID from the filename
 *   if no `id` field is present in the frontmatter.
 * @returns The parsed {@link Card} object, or `null` if no valid frontmatter block is found.
 */
export function parseCardFile(content: string, filePath: string): Card | null {
  content = content.replace(/\r\n/g, '\n')
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  const rest = frontmatterMatch[2] || ''

  let parsed: Record<string, unknown>
  try {
    const loaded = yaml.load(frontmatter, { schema: yaml.JSON_SCHEMA })
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) return null
    parsed = loaded as Record<string, unknown>
  } catch {
    return null
  }

  const str = (key: string): string => {
    const val = parsed[key]
    if (val == null) return ''
    return String(val)
  }

  const arr = (key: string): string[] => {
    const val = parsed[key]
    if (!Array.isArray(val)) return []
    return val.filter(v => v != null).map(String)
  }

  // Split rest into card body and comment sections
  // Comments are separated by --- blocks containing "comment: true"
  const sections = rest.split(/\n---\n/)
  let body = sections[0] || ''
  const comments: Comment[] = []

  let i = 1
  while (i < sections.length) {
    const section = sections[i]
    if (section?.trimStart().startsWith('comment:')) {
      const commentBody = sections[i + 1] || ''
      const comment = parseCommentBlock(section, commentBody)
      if (comment) {
        comments.push(comment)
        i += 2
      } else {
        body += `\n---\n${section}`
        i += 1
      }
    } else {
      body += `\n---\n${section}`
      i += 1
    }
  }

  const rawActions = parsed['actions']
  const actions: string[] | Record<string, string> | undefined = (() => {
    if (Array.isArray(rawActions)) return rawActions.filter(v => v != null).map(String)
    if (rawActions != null && typeof rawActions === 'object' && !Array.isArray(rawActions)) {
      const obj: Record<string, string> = {}
      for (const [k, v] of Object.entries(rawActions as Record<string, unknown>)) obj[k] = String(v ?? k)
      return obj
    }
    return undefined
  })()
  const rawMeta = parsed.metadata
  const meta = rawMeta != null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
    ? rawMeta as Record<string, unknown>
    : undefined
  const tasks = normalizeChecklistTasks(arr('tasks'))
  const forms = parseForms(parsed.forms)
  const formData = parseFormData(parsed.formData)

  return {
    version: typeof parsed.version === 'number' ? parsed.version : parseInt(str('version'), 10) || 0,
    id: str('id') || extractIdFromFilename(filePath),
    status: (str('status') as CardStatus) || 'backlog',
    priority: (str('priority') as Priority) || 'medium',
    assignee: parsed.assignee != null ? String(parsed.assignee) : null,
    dueDate: parsed.dueDate != null ? String(parsed.dueDate) : null,
    created: str('created') || new Date().toISOString(),
    modified: str('modified') || new Date().toISOString(),
    completedAt: parsed.completedAt != null ? String(parsed.completedAt) : null,
    labels: arr('labels'),
    attachments: arr('attachments'),
    ...(tasks ? { tasks } : {}),
    comments,
    order: str('order') || 'a0',
    content: body.trim(),
    ...(meta ? { metadata: meta } : {}),
    ...(actions && (Array.isArray(actions) ? actions.length > 0 : Object.keys(actions).length > 0) ? { actions } : {}),
    ...(forms ? { forms } : {}),
    ...(formData ? { formData } : {}),
    filePath
  }
}

/**
 * Serializes a Card object back to markdown with YAML frontmatter.
 *
 * Produces a string with a `---` delimited YAML frontmatter block containing all
 * card metadata, followed by the card body content. Any comments attached to the
 * card are appended as additional `---` delimited sections at the end of the file.
 *
 * @param card - The {@link Card} object to serialize.
 * @returns The complete markdown string ready to be written to a `.md` file.
 */
export function serializeCard(card: Card): string {
  const tasks = normalizeChecklistTasks(card.tasks)
  const frontmatterObj: Record<string, unknown> = {
    version: card.version ?? CARD_FORMAT_VERSION,
    id: card.id,
    status: card.status,
    priority: card.priority,
    assignee: card.assignee ?? null,
    dueDate: card.dueDate ?? null,
    created: card.created,
    modified: card.modified,
    completedAt: card.completedAt ?? null,
    labels: card.labels,
    attachments: card.attachments || [],
    ...(tasks ? { tasks } : {}),
    order: card.order,
    ...(card.actions && (Array.isArray(card.actions) ? card.actions.length > 0 : Object.keys(card.actions).length > 0) ? { actions: card.actions } : {}),
    ...(card.metadata && Object.keys(card.metadata).length > 0 ? { metadata: card.metadata } : {}),
    ...(card.forms && card.forms.length > 0 ? { forms: card.forms } : {}),
    ...(card.formData && Object.keys(card.formData).length > 0 ? { formData: card.formData } : {}),
  }

  const yamlStr = yaml.dump(frontmatterObj, { lineWidth: -1, quotingType: '"', forceQuotes: true })
  let result = `---\n${yamlStr}---\n\n${card.content}`

  for (const comment of card.comments || []) {
    result += '\n\n---\n'
    result += `comment: true\n`
    result += `id: "${comment.id}"\n`
    result += `author: "${comment.author}"\n`
    result += `created: "${comment.created}"\n`
    result += '---\n'
    result += comment.content
  }

  return result
}

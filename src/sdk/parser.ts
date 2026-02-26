import * as path from 'path'
import * as yaml from 'js-yaml'
import type { Comment, Feature, FeatureStatus, Priority } from '../shared/types'
import { CARD_FORMAT_VERSION } from '../shared/types'

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
 * Parses a markdown file with YAML frontmatter into a Feature object.
 *
 * The file is expected to have a YAML frontmatter block delimited by `---` at the
 * top, followed by the card body content. Additional `---` delimited blocks after
 * the body are parsed as comment sections (if they contain `comment: true`),
 * otherwise they are treated as part of the body content.
 *
 * @param content - The raw string content of the markdown file.
 * @param filePath - The absolute file path, used to extract the card ID from the filename
 *   if no `id` field is present in the frontmatter.
 * @returns The parsed {@link Feature} object, or `null` if no valid frontmatter block is found.
 */
export function parseFeatureFile(content: string, filePath: string): Feature | null {
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
      if (comment) comments.push(comment)
      i += 2
    } else {
      body += `\n---\n${section}`
      i += 1
    }
  }

  const actions = arr('actions')
  const rawMeta = parsed.metadata
  const meta = rawMeta != null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
    ? rawMeta as Record<string, unknown>
    : undefined

  return {
    version: typeof parsed.version === 'number' ? parsed.version : parseInt(str('version'), 10) || 0,
    id: str('id') || extractIdFromFilename(filePath),
    status: (str('status') as FeatureStatus) || 'backlog',
    priority: (str('priority') as Priority) || 'medium',
    assignee: parsed.assignee != null ? String(parsed.assignee) : null,
    dueDate: parsed.dueDate != null ? String(parsed.dueDate) : null,
    created: str('created') || new Date().toISOString(),
    modified: str('modified') || new Date().toISOString(),
    completedAt: parsed.completedAt != null ? String(parsed.completedAt) : null,
    labels: arr('labels'),
    attachments: arr('attachments'),
    comments,
    order: str('order') || 'a0',
    content: body.trim(),
    ...(meta ? { metadata: meta } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    filePath
  }
}

/**
 * Serializes a Feature object back to markdown with YAML frontmatter.
 *
 * Produces a string with a `---` delimited YAML frontmatter block containing all
 * card metadata, followed by the card body content. Any comments attached to the
 * feature are appended as additional `---` delimited sections at the end of the file.
 *
 * @param feature - The {@link Feature} object to serialize.
 * @returns The complete markdown string ready to be written to a `.md` file.
 */
export function serializeFeature(feature: Feature): string {
  const frontmatterObj: Record<string, unknown> = {
    version: feature.version ?? CARD_FORMAT_VERSION,
    id: feature.id,
    status: feature.status,
    priority: feature.priority,
    assignee: feature.assignee ?? null,
    dueDate: feature.dueDate ?? null,
    created: feature.created,
    modified: feature.modified,
    completedAt: feature.completedAt ?? null,
    labels: feature.labels,
    attachments: feature.attachments || [],
    order: feature.order,
    ...(feature.actions?.length ? { actions: feature.actions } : {}),
    ...(feature.metadata && Object.keys(feature.metadata).length > 0 ? { metadata: feature.metadata } : {}),
  }

  const yamlStr = yaml.dump(frontmatterObj, { lineWidth: -1, quotingType: '"', forceQuotes: true })
  let result = `---\n${yamlStr}---\n\n${feature.content}`

  for (const comment of feature.comments || []) {
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

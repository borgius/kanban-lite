import * as path from 'path'
import * as yaml from 'js-yaml'
import type { Comment, Feature, FeatureStatus, Priority } from '../shared/types'

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

  const getValue = (key: string): string => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    if (!match) return ''
    const value = match[1].trim().replace(/^["']|["']$/g, '')
    return value === 'null' ? '' : value
  }

  const getArrayValue = (key: string): string[] => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'))
    if (!match) return []
    return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }

  const getMetadata = (): Record<string, any> | undefined => {
    const lines = frontmatter.split('\n')
    let metaStart = -1
    for (let j = 0; j < lines.length; j++) {
      if (/^metadata:\s*$/.test(lines[j])) {
        metaStart = j + 1
        break
      }
    }
    if (metaStart === -1) return undefined
    const indentedLines: string[] = []
    for (let j = metaStart; j < lines.length; j++) {
      if (/^\s/.test(lines[j]) || lines[j].trim() === '') {
        indentedLines.push(lines[j])
      } else {
        break
      }
    }
    if (indentedLines.length === 0) return undefined
    try {
      const parsed = yaml.load(indentedLines.join('\n'))
      if (parsed && typeof parsed === 'object') return parsed as Record<string, any>
      return undefined
    } catch {
      return undefined
    }
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

  const meta = getMetadata()
  const actions = getArrayValue('actions')

  return {
    id: getValue('id') || extractIdFromFilename(filePath),
    status: (getValue('status') as FeatureStatus) || 'backlog',
    priority: (getValue('priority') as Priority) || 'medium',
    assignee: getValue('assignee') || null,
    dueDate: getValue('dueDate') || null,
    created: getValue('created') || new Date().toISOString(),
    modified: getValue('modified') || new Date().toISOString(),
    completedAt: getValue('completedAt') || null,
    labels: getArrayValue('labels'),
    attachments: getArrayValue('attachments'),
    comments,
    order: getValue('order') || 'a0',
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
  const lines = [
    '---',
    `id: "${feature.id}"`,
    `status: "${feature.status}"`,
    `priority: "${feature.priority}"`,
    `assignee: ${feature.assignee ? `"${feature.assignee}"` : 'null'}`,
    `dueDate: ${feature.dueDate ? `"${feature.dueDate}"` : 'null'}`,
    `created: "${feature.created}"`,
    `modified: "${feature.modified}"`,
    `completedAt: ${feature.completedAt ? `"${feature.completedAt}"` : 'null'}`,
    `labels: [${feature.labels.map(l => `"${l}"`).join(', ')}]`,
    `attachments: [${(feature.attachments || []).map(a => `"${a}"`).join(', ')}]`,
    `order: "${feature.order}"`,
  ]

  if (feature.actions && feature.actions.length > 0) {
    lines.push(`actions: [${feature.actions.map(a => `"${a}"`).join(', ')}]`)
  }

  if (feature.metadata && Object.keys(feature.metadata).length > 0) {
    const metaYaml = yaml.dump(feature.metadata, { indent: 2, lineWidth: -1 })
    lines.push('metadata:')
    for (const line of metaYaml.trimEnd().split('\n')) {
      lines.push('  ' + line)
    }
  }

  lines.push('---')
  lines.push('')

  const frontmatter = lines.join('\n')

  let result = frontmatter + feature.content

  const comments = feature.comments || []
  for (const comment of comments) {
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

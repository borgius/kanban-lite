import * as path from 'path'
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

  // Split rest into card body and comment sections
  // Comments are separated by --- blocks containing "comment: true"
  const sections = rest.split(/\n---\n/)
  let body = sections[0] || ''
  const comments: Comment[] = []

  for (let i = 1; i < sections.length; i += 2) {
    const header = sections[i]
    const commentBody = sections[i + 1] || ''
    if (header?.includes('comment:')) {
      const comment = parseCommentBlock(header, commentBody)
      if (comment) comments.push(comment)
    } else {
      // Not a comment section — it's part of the body content
      body += `\n---\n${header}`
      if (sections[i + 1] !== undefined) {
        body += `\n---\n${sections[i + 1]}`
        // Skip the next iteration since we consumed i+1
        i++
      }
    }
  }

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
    filePath
  }
}

export function serializeFeature(feature: Feature): string {
  const frontmatter = [
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
    '---',
    ''
  ].join('\n')

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

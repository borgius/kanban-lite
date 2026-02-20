import { describe, expect, it } from 'vitest'
import type { Feature } from '../../shared/types'
import { parseFeatureFile, serializeFeature } from '../parser'

describe('parseFeatureFile', () => {
  it('should parse a valid feature file', () => {
    const content = `---
id: "test-feature"
status: "todo"
priority: "high"
assignee: "alice"
dueDate: "2025-12-31"
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: ["frontend", "urgent"]
attachments: ["screenshot.png", "spec.pdf"]
order: "a0"
---
# Test Feature

Some description here.`

    const feature = parseFeatureFile(content, '/tmp/test-feature.md')

    expect(feature).not.toBeNull()
    expect(feature?.id).toBe('test-feature')
    expect(feature?.status).toBe('todo')
    expect(feature?.priority).toBe('high')
    expect(feature?.assignee).toBe('alice')
    expect(feature?.dueDate).toBe('2025-12-31')
    expect(feature?.created).toBe('2025-01-01T00:00:00.000Z')
    expect(feature?.completedAt).toBeNull()
    expect(feature?.labels).toEqual(['frontend', 'urgent'])
    expect(feature?.attachments).toEqual(['screenshot.png', 'spec.pdf'])
    expect(feature?.order).toBe('a0')
    expect(feature?.content).toBe('# Test Feature\n\nSome description here.')
    expect(feature?.filePath).toBe('/tmp/test-feature.md')
  })

  it('should return null for content without frontmatter', () => {
    const result = parseFeatureFile('# Just a heading\nNo frontmatter', '/tmp/no-fm.md')
    expect(result).toBeNull()
  })

  it('should handle null values correctly', () => {
    const content = `---
id: "null-test"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# Null Test`

    const feature = parseFeatureFile(content, '/tmp/null-test.md')
    expect(feature?.assignee).toBeNull()
    expect(feature?.dueDate).toBeNull()
    expect(feature?.completedAt).toBeNull()
    expect(feature?.labels).toEqual([])
    expect(feature?.attachments).toEqual([])
  })

  it('should handle Windows-style line endings', () => {
    const content = '---\r\nid: "crlf"\r\nstatus: "todo"\r\npriority: "low"\r\nassignee: null\r\ndueDate: null\r\ncreated: "2025-01-01T00:00:00.000Z"\r\nmodified: "2025-01-01T00:00:00.000Z"\r\ncompletedAt: null\r\nlabels: []\r\norder: "a0"\r\n---\r\n# CRLF Test'

    const feature = parseFeatureFile(content, '/tmp/crlf.md')
    expect(feature).not.toBeNull()
    expect(feature?.id).toBe('crlf')
  })

  it('should fall back to filename for missing id', () => {
    const content = `---
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# No ID`

    const feature = parseFeatureFile(content, '/tmp/fallback-name.md')
    expect(feature?.id).toBe('fallback-name')
  })

  it('should default status to backlog and priority to medium', () => {
    const content = `---
id: "minimal"
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# Minimal`

    const feature = parseFeatureFile(content, '/tmp/minimal.md')
    expect(feature?.status).toBe('backlog')
    expect(feature?.priority).toBe('medium')
  })
})

describe('serializeFeature', () => {
  it('should round-trip parse and serialize', () => {
    const original: Feature = {
      id: 'round-trip',
      status: 'in-progress',
      priority: 'critical',
      assignee: 'bob',
      dueDate: '2025-06-15',
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-02-01T00:00:00.000Z',
      completedAt: null,
      labels: ['backend', 'api'],
      attachments: ['design.png', 'notes.txt'],
      order: 'a1',
      content: '# Round Trip\n\nTest content.',
      filePath: '/tmp/round-trip.md'
    }

    const serialized = serializeFeature(original)
    const parsed = parseFeatureFile(serialized, original.filePath)

    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe(original.id)
    expect(parsed?.status).toBe(original.status)
    expect(parsed?.priority).toBe(original.priority)
    expect(parsed?.assignee).toBe(original.assignee)
    expect(parsed?.dueDate).toBe(original.dueDate)
    expect(parsed?.completedAt).toBe(original.completedAt)
    expect(parsed?.labels).toEqual(original.labels)
    expect(parsed?.attachments).toEqual(original.attachments)
    expect(parsed?.order).toBe(original.order)
    expect(parsed?.content).toBe(original.content)
  })

  it('should serialize null fields correctly', () => {
    const feature: Feature = {
      id: 'null-serialize',
      status: 'backlog',
      priority: 'low',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      order: 'a0',
      content: '# Null Serialize',
      filePath: '/tmp/null.md'
    }

    const serialized = serializeFeature(feature)
    expect(serialized).toContain('assignee: null')
    expect(serialized).toContain('dueDate: null')
    expect(serialized).toContain('completedAt: null')
    expect(serialized).toContain('labels: []')
    expect(serialized).toContain('attachments: []')
  })
})

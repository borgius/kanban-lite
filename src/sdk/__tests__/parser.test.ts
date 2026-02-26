import { describe, expect, it } from 'vitest'
import type { Comment, Feature } from '../../shared/types'
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
      version: 0,
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
      comments: [],
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
      version: 0,
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
      comments: [],
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

describe('parseFeatureFile - comments', () => {
  it('should parse a card with no comments (backward compat)', () => {
    const content = `---
id: "no-comments"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# No Comments Card

Just content, no comments.`

    const feature = parseFeatureFile(content, '/tmp/no-comments.md')
    expect(feature).not.toBeNull()
    expect(feature?.comments).toEqual([])
    expect(feature?.content).toBe('# No Comments Card\n\nJust content, no comments.')
  })

  it('should parse a card with multiple comments', () => {
    const content = `---
id: "with-comments"
status: "todo"
priority: "high"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# Card With Comments

Some description.

---
comment: true
id: "c1"
author: "alice"
created: "2025-06-01T10:00:00.000Z"
---
First comment here.

---
comment: true
id: "c2"
author: "bob"
created: "2025-06-01T11:30:00.000Z"
---
Second comment with **markdown**.`

    const feature = parseFeatureFile(content, '/tmp/with-comments.md')
    expect(feature).not.toBeNull()
    expect(feature?.content).toBe('# Card With Comments\n\nSome description.')
    expect(feature?.comments).toHaveLength(2)

    expect(feature?.comments[0].id).toBe('c1')
    expect(feature?.comments[0].author).toBe('alice')
    expect(feature?.comments[0].created).toBe('2025-06-01T10:00:00.000Z')
    expect(feature?.comments[0].content).toBe('First comment here.')

    expect(feature?.comments[1].id).toBe('c2')
    expect(feature?.comments[1].author).toBe('bob')
    expect(feature?.comments[1].content).toBe('Second comment with **markdown**.')
  })
})

describe('serializeFeature - comments', () => {
  it('should not append comment blocks when comments array is empty', () => {
    const feature: Feature = {
      version: 0,
      id: 'no-comments',
      status: 'backlog',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      comments: [],
      order: 'a0',
      content: '# No Comments',
      filePath: '/tmp/no-comments.md'
    }

    const serialized = serializeFeature(feature)
    // Should not contain comment: true
    expect(serialized).not.toContain('comment: true')
    // Content should end with the card body
    expect(serialized.trim().endsWith('# No Comments')).toBe(true)
  })

  it('should serialize comments after the content', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'alice', created: '2025-06-01T10:00:00.000Z', content: 'First comment.' },
      { id: 'c2', author: 'bob', created: '2025-06-01T11:00:00.000Z', content: 'Second comment.' },
    ]

    const feature: Feature = {
      version: 0,
      id: 'with-comments',
      status: 'todo',
      priority: 'high',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      comments,
      order: 'a0',
      content: '# With Comments\n\nBody text.',
      filePath: '/tmp/with-comments.md'
    }

    const serialized = serializeFeature(feature)
    expect(serialized).toContain('comment: true')
    expect(serialized).toContain('id: "c1"')
    expect(serialized).toContain('author: "alice"')
    expect(serialized).toContain('First comment.')
    expect(serialized).toContain('id: "c2"')
    expect(serialized).toContain('author: "bob"')
    expect(serialized).toContain('Second comment.')
  })

  it('should round-trip comments through parse and serialize', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'alice', created: '2025-06-01T10:00:00.000Z', content: 'Hello world' },
      { id: 'c2', author: 'bob', created: '2025-06-01T12:00:00.000Z', content: 'Goodbye world' },
    ]

    const original: Feature = {
      version: 0,
      id: 'round-trip-comments',
      status: 'in-progress',
      priority: 'critical',
      assignee: 'charlie',
      dueDate: '2025-12-31',
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-02-01T00:00:00.000Z',
      completedAt: null,
      labels: ['test'],
      attachments: [],
      comments,
      order: 'a1',
      content: '# Round Trip Comments\n\nBody content here.',
      filePath: '/tmp/round-trip-comments.md'
    }

    const serialized = serializeFeature(original)
    const parsed = parseFeatureFile(serialized, original.filePath)

    expect(parsed).not.toBeNull()
    expect(parsed?.content).toBe(original.content)
    expect(parsed?.comments).toHaveLength(2)
    expect(parsed?.comments[0]).toEqual(original.comments[0])
    expect(parsed?.comments[1]).toEqual(original.comments[1])
  })
})

describe('parseFeatureFile - horizontal rules in content', () => {
  const frontmatter = `---
id: "hr-test"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
`

  it('should preserve --- HR in content when there are no comments', () => {
    const content = frontmatter + 'Line 1\n\n---\n\nLine 2'

    const feature = parseFeatureFile(content, '/tmp/hr-test.md')
    expect(feature).not.toBeNull()
    expect(feature?.content).toBe('Line 1\n\n---\n\nLine 2')
    expect(feature?.comments).toEqual([])
  })

  it('should preserve --- HR in content and parse comments after it', () => {
    const content = frontmatter + `Line 1

---

Line 2

---
comment: true
id: "c1"
author: "alice"
created: "2025-06-01T10:00:00.000Z"
---
Hello world`

    const feature = parseFeatureFile(content, '/tmp/hr-test.md')
    expect(feature).not.toBeNull()
    expect(feature?.content).toBe('Line 1\n\n---\n\nLine 2')
    expect(feature?.comments).toHaveLength(1)
    expect(feature?.comments[0].id).toBe('c1')
    expect(feature?.comments[0].author).toBe('alice')
    expect(feature?.comments[0].content).toBe('Hello world')
  })

  it('should handle multiple --- HRs in content with comments after', () => {
    const content = frontmatter + `Section 1

---

Section 2

---

Section 3

---
comment: true
id: "c1"
author: "alice"
created: "2025-06-01T10:00:00.000Z"
---
First comment

---
comment: true
id: "c2"
author: "bob"
created: "2025-06-01T11:00:00.000Z"
---
Second comment`

    const feature = parseFeatureFile(content, '/tmp/hr-test.md')
    expect(feature).not.toBeNull()
    expect(feature?.content).toBe('Section 1\n\n---\n\nSection 2\n\n---\n\nSection 3')
    expect(feature?.comments).toHaveLength(2)
    expect(feature?.comments[0].id).toBe('c1')
    expect(feature?.comments[0].content).toBe('First comment')
    expect(feature?.comments[1].id).toBe('c2')
    expect(feature?.comments[1].content).toBe('Second comment')
  })

  it('should round-trip content with --- HRs and comments', () => {
    const comments: Comment[] = [
      { id: 'c1', author: 'alice', created: '2025-06-01T10:00:00.000Z', content: 'A comment' },
    ]

    const original: Feature = {
      version: 0,
      id: 'hr-roundtrip',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      attachments: [],
      comments,
      order: 'a0',
      content: 'Before HR\n\n---\n\nAfter HR',
      filePath: '/tmp/hr-roundtrip.md'
    }

    const serialized = serializeFeature(original)
    const parsed = parseFeatureFile(serialized, original.filePath)

    expect(parsed).not.toBeNull()
    expect(parsed?.content).toBe(original.content)
    expect(parsed?.comments).toHaveLength(1)
    expect(parsed?.comments[0]).toEqual(original.comments[0])
  })
})

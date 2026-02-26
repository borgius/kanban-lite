import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseFeatureFile, serializeFeature } from '../parser'
import { KanbanSDK } from '../KanbanSDK'
import { DEFAULT_COLUMNS } from '../../shared/types'
import type { Feature } from '../../shared/types'
import type { KanbanConfig } from '../../shared/config'

function createV2Config(overrides?: Partial<KanbanConfig>): KanbanConfig {
  return {
    version: 2,
    boards: {
      default: {
        name: 'Default',
        columns: [...DEFAULT_COLUMNS],
        nextCardId: 1,
        defaultStatus: 'backlog',
        defaultPriority: 'medium'
      }
    },
    defaultBoard: 'default',
    featuresDirectory: '.kanban',
    aiAgent: 'claude',
    defaultPriority: 'medium',
    defaultStatus: 'backlog',
    showPriorityBadges: true,
    showAssignee: true,
    showDueDate: true,
    showLabels: true,
    showBuildWithAI: true,
    showFileName: false,
    compactMode: false,
    markdownEditorMode: false,
    showDeletedColumn: false,
    port: 3000,
    ...overrides
  }
}

describe('parseFeatureFile - metadata', () => {
  it('should parse flat metadata from frontmatter', () => {
    const content = `---
id: "meta-flat"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
attachments: []
order: "a0"
metadata:
  sprint: 5
  team: backend
  estimate: 3.5
---
# Flat Metadata Card

Some content.`

    const feature = parseFeatureFile(content, '/tmp/meta-flat.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toEqual({
      sprint: 5,
      team: 'backend',
      estimate: 3.5
    })
  })

  it('should parse nested metadata (objects, arrays)', () => {
    const content = `---
id: "meta-nested"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
attachments: []
order: "a0"
metadata:
  tags:
    - alpha
    - beta
  config:
    retries: 3
    timeout: 30
---
# Nested Metadata Card`

    const feature = parseFeatureFile(content, '/tmp/meta-nested.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toEqual({
      tags: ['alpha', 'beta'],
      config: {
        retries: 3,
        timeout: 30
      }
    })
  })

  it('should return undefined when metadata is an inline scalar value', () => {
    const content = `---
id: "meta-scalar"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
attachments: []
order: "a0"
metadata: "just-a-string"
---
# Scalar Metadata Card`

    const feature = parseFeatureFile(content, '/tmp/meta-scalar.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toBeUndefined()
  })

  it('should return undefined metadata when no metadata block exists', () => {
    const content = `---
id: "no-meta"
status: "todo"
priority: "medium"
assignee: null
dueDate: null
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: []
attachments: []
order: "a0"
---
# No Metadata Card`

    const feature = parseFeatureFile(content, '/tmp/no-meta.md')
    expect(feature).not.toBeNull()
    expect(feature?.metadata).toBeUndefined()
  })
})

describe('serializeFeature - metadata', () => {
  it('should round-trip serialize and parse with metadata', () => {
    const original: Feature = {
      id: 'meta-roundtrip',
      status: 'in-progress',
      priority: 'high',
      assignee: 'alice',
      dueDate: '2025-12-31',
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-02-01T00:00:00.000Z',
      completedAt: null,
      labels: ['test'],
      attachments: [],
      comments: [],
      order: 'a1',
      content: '# Round Trip Metadata\n\nBody content.',
      metadata: {
        sprint: 5,
        team: 'backend',
        tags: ['alpha', 'beta'],
        config: { retries: 3, timeout: 30 }
      },
      filePath: '/tmp/meta-roundtrip.md'
    }

    const serialized = serializeFeature(original)
    const parsed = parseFeatureFile(serialized, original.filePath)

    expect(parsed).not.toBeNull()
    expect(parsed?.metadata).toEqual(original.metadata)
    expect(parsed?.content).toBe(original.content)
    expect(parsed?.id).toBe(original.id)
    expect(parsed?.status).toBe(original.status)
  })

  it('should omit metadata block when metadata is undefined', () => {
    const feature: Feature = {
      id: 'no-meta-serialize',
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
      content: '# No Metadata',
      filePath: '/tmp/no-meta.md'
    }

    const serialized = serializeFeature(feature)
    expect(serialized).not.toContain('metadata:')
  })

  it('should omit metadata block when metadata is empty object', () => {
    const feature: Feature = {
      id: 'empty-meta',
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
      content: '# Empty Metadata',
      metadata: {},
      filePath: '/tmp/empty-meta.md'
    }

    const serialized = serializeFeature(feature)
    expect(serialized).not.toContain('metadata:')
  })
})

describe('SDK integration - metadata', () => {
  let workspaceDir: string
  let featuresDir: string
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-metadata-'))
    featuresDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(featuresDir, { recursive: true })
    const config = createV2Config()
    fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config, null, 2))
    sdk = new KanbanSDK(featuresDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('should create a card with metadata', async () => {
    const card = await sdk.createCard({
      content: '# Card With Metadata\n\nDescription here.',
      metadata: {
        sprint: 5,
        team: 'backend',
        tags: ['alpha', 'beta']
      }
    })

    expect(card.metadata).toEqual({
      sprint: 5,
      team: 'backend',
      tags: ['alpha', 'beta']
    })

    // Verify persisted to disk
    const fileContent = fs.readFileSync(card.filePath, 'utf-8')
    expect(fileContent).toContain('metadata:')
    expect(fileContent).toContain('  sprint: 5')
    expect(fileContent).toContain('  team: backend')

    // Verify round-trip through listCards
    const cards = await sdk.listCards()
    const found = cards.find(c => c.id === card.id)
    expect(found).toBeDefined()
    expect(found?.metadata).toEqual({
      sprint: 5,
      team: 'backend',
      tags: ['alpha', 'beta']
    })
  })

  it('should update card metadata', async () => {
    const card = await sdk.createCard({
      content: '# Update Metadata Card',
      metadata: { sprint: 1 }
    })

    const updated = await sdk.updateCard(card.id, {
      metadata: { sprint: 2, team: 'frontend' }
    })

    expect(updated.metadata).toEqual({ sprint: 2, team: 'frontend' })

    // Verify persisted
    const cards = await sdk.listCards()
    const found = cards.find(c => c.id === updated.id)
    expect(found?.metadata).toEqual({ sprint: 2, team: 'frontend' })
  })

  it('should create a card without metadata (backward compat)', async () => {
    const card = await sdk.createCard({
      content: '# No Metadata Card\n\nJust content.'
    })

    expect(card.metadata).toBeUndefined()

    // Verify persisted file does not contain metadata block
    const fileContent = fs.readFileSync(card.filePath, 'utf-8')
    expect(fileContent).not.toContain('metadata:')

    // Verify round-trip
    const cards = await sdk.listCards()
    const found = cards.find(c => c.id === card.id)
    expect(found?.metadata).toBeUndefined()
  })
})

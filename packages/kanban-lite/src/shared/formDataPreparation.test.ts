import { describe, expect, it } from 'vitest'
import {
  buildCardInterpolationContext,
  prepareFormData,
  resolveTemplateString,
  type CardInterpolationContext,
} from './formDataPreparation'

const baseCtx: CardInterpolationContext = {
  id: '42',
  boardId: 'dev',
  status: 'in-progress',
  priority: 'high',
  assignee: 'alice',
  dueDate: '2026-06-01',
  metadata: { owner: 'bob', team: 'backend' },
}

describe('resolveTemplateString', () => {
  it('replaces a top-level placeholder', () => {
    expect(resolveTemplateString('Card ${id}', baseCtx)).toBe('Card 42')
  })

  it('replaces a dot-notation metadata placeholder', () => {
    expect(resolveTemplateString('Owner: ${metadata.owner}', baseCtx)).toBe('Owner: bob')
  })

  it('handles multiple placeholders in one string', () => {
    expect(resolveTemplateString('${status} / ${priority}', baseCtx)).toBe('in-progress / high')
  })

  it('resolves to empty string for missing path', () => {
    expect(resolveTemplateString('${unknown.field}', baseCtx)).toBe('')
  })

  it('resolves null fields to empty string', () => {
    const ctx: CardInterpolationContext = { ...baseCtx, assignee: null }
    expect(resolveTemplateString('by ${assignee}', ctx)).toBe('by ')
  })

  it('passes through strings with no placeholders', () => {
    expect(resolveTemplateString('plain text', baseCtx)).toBe('plain text')
  })

  it('coerces numeric metadata values to string', () => {
    const ctx: CardInterpolationContext = { ...baseCtx, metadata: { count: 5 } }
    expect(resolveTemplateString('count: ${metadata.count}', ctx)).toBe('count: 5')
  })

  it('handles boardId placeholder', () => {
    expect(resolveTemplateString('board: ${boardId}', baseCtx)).toBe('board: dev')
  })

  it('interpolates created and modified timestamps', () => {
    const ctx: CardInterpolationContext = {
      ...baseCtx,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-03-15T00:00:00.000Z',
    }
    expect(resolveTemplateString('Created: ${created}', ctx)).toBe('Created: 2026-01-01T00:00:00.000Z')
    expect(resolveTemplateString('Modified: ${modified}', ctx)).toBe('Modified: 2026-03-15T00:00:00.000Z')
  })

  it('interpolates order field', () => {
    const ctx: CardInterpolationContext = { ...baseCtx, order: 'a1z' }
    expect(resolveTemplateString('order: ${order}', ctx)).toBe('order: a1z')
  })

  it('interpolates labels array as comma-separated string', () => {
    const ctx: CardInterpolationContext = { ...baseCtx, labels: ['bug', 'frontend'] }
    expect(resolveTemplateString('tags: ${labels}', ctx)).toBe('tags: bug,frontend')
  })

  it('resolves completedAt null to empty string', () => {
    const ctx: CardInterpolationContext = { ...baseCtx, completedAt: null }
    expect(resolveTemplateString('[${completedAt}]', ctx)).toBe('[]')
  })
})

describe('prepareFormData', () => {
  it('interpolates string leaves', () => {
    const result = prepareFormData({ title: '${id} - Bug' }, baseCtx)
    expect(result.title).toBe('42 - Bug')
  })

  it('passes non-string scalars through unchanged', () => {
    const result = prepareFormData({ count: 3, active: true, nothing: null }, baseCtx)
    expect(result.count).toBe(3)
    expect(result.active).toBe(true)
    expect(result.nothing).toBeNull()
  })

  it('processes nested objects recursively', () => {
    const result = prepareFormData({ nested: { label: 'by ${assignee}' } }, baseCtx)
    expect((result.nested as Record<string, unknown>).label).toBe('by alice')
  })

  it('processes string elements in arrays', () => {
    const result = prepareFormData({ tags: ['${status}', 'static'] }, baseCtx)
    expect(result.tags).toEqual(['in-progress', 'static'])
  })

  it('passes non-string array elements through unchanged', () => {
    const result = prepareFormData({ counts: [1, 2, 3] }, baseCtx)
    expect(result.counts).toEqual([1, 2, 3])
  })

  it('does not mutate the input object', () => {
    const input: Record<string, unknown> = { title: '${id}' }
    prepareFormData(input, baseCtx)
    expect(input.title).toBe('${id}')
  })

  it('returns empty string for unresolved placeholder fields', () => {
    const result = prepareFormData({ field: '${does.not.exist}' }, baseCtx)
    expect(result.field).toBe('')
  })

  it('handles partial input (only some fields present) without error', () => {
    const result = prepareFormData({ summary: '${id}' }, baseCtx)
    expect(result.summary).toBe('42')
  })
})

describe('buildCardInterpolationContext', () => {
  it('maps all standard card fields', () => {
    const card = {
      id: '7',
      status: 'todo',
      priority: 'medium',
      assignee: 'carol',
      dueDate: '2026-12-31',
      metadata: { project: 'alpha' },
    }
    const ctx = buildCardInterpolationContext(card, 'board-x')
    expect(ctx).toEqual({
      id: '7',
      boardId: 'board-x',
      status: 'todo',
      priority: 'medium',
      assignee: 'carol',
      dueDate: '2026-12-31',
      metadata: { project: 'alpha' },
    })
  })

  it('supports undefined metadata', () => {
    const card = {
      id: '1',
      status: 'done',
      priority: 'low',
      assignee: null,
      dueDate: null,
    }
    const ctx = buildCardInterpolationContext(card, 'b')
    expect(ctx.metadata).toBeUndefined()
  })

  it('excludes filePath from the context', () => {
    const card = {
      id: '3',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      filePath: '/boards/default/todo/3-card.md',
    }
    const ctx = buildCardInterpolationContext(card, 'b')
    expect(ctx.filePath).toBeUndefined()
  })

  it('produces context usable for interpolation', () => {
    const card = {
      id: '99',
      status: 'review',
      priority: 'critical',
      assignee: 'dana',
      dueDate: null,
      metadata: { ticket: 'PROJ-42' },
    }
    const ctx = buildCardInterpolationContext(card, 'main')
    expect(resolveTemplateString('${id} (${metadata.ticket}) by ${assignee}', ctx))
      .toBe('99 (PROJ-42) by dana')
  })

  it('maps extended card fields when provided', () => {
    const card = {
      id: '5',
      status: 'in-progress',
      priority: 'high',
      assignee: 'eve',
      dueDate: '2026-07-01',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-03-01T00:00:00.000Z',
      completedAt: null as string | null,
      labels: ['bug', 'urgent'],
      attachments: ['screenshot.png'],
      order: 'a1',
      content: '# My Card',
      metadata: { sprint: '12' },
    }
    const ctx = buildCardInterpolationContext(card, 'proj')
    expect(ctx.created).toBe('2026-01-01T00:00:00.000Z')
    expect(ctx.modified).toBe('2026-03-01T00:00:00.000Z')
    expect(ctx.completedAt).toBeNull()
    expect(ctx.labels).toEqual(['bug', 'urgent'])
    expect(ctx.attachments).toEqual(['screenshot.png'])
    expect(ctx.order).toBe('a1')
    expect(ctx.content).toBe('# My Card')
  })

  it('interpolates extended fields for a prepared form', () => {
    const card = {
      id: '20',
      status: 'done',
      priority: 'low',
      assignee: null,
      dueDate: null,
      created: '2026-02-10T12:00:00.000Z',
      modified: '2026-03-20T08:00:00.000Z',
      order: 'b3',
      labels: ['feature'],
    }
    const ctx = buildCardInterpolationContext(card, 'board')
    expect(resolveTemplateString('${id} created ${created} order ${order}', ctx))
      .toBe('20 created 2026-02-10T12:00:00.000Z order b3')
  })
})

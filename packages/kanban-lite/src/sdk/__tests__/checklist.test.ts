import { describe, expect, it } from 'vitest'
import type { CardTask } from '../../shared/types.js'
import {
  CHECKLIST_RESERVED_LABELS,
  buildChecklistReadModel,
  buildChecklistTask,
  coerceChecklistSeedTasks,
  getChecklistStats,
  isSafeChecklistLinkHref,
  isReservedChecklistLabel,
  normalizeCardChecklistState,
  projectCardChecklistState,
  syncChecklistDerivedLabels,
} from '../modules/checklist.js'

function makeTask(overrides: Partial<CardTask> = {}): CardTask {
  return {
    title: 'task',
    description: '',
    checked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    createdBy: '',
    modifiedBy: '',
    ...overrides,
  }
}

describe('checklist helpers', () => {
  it('builds a CardTask from title, description and createdBy', () => {
    const task = buildChecklistTask('Review docs', 'Check the latest draft', 'alice', '2026-01-01T00:00:00.000Z')
    expect(task).toEqual({
      title: 'Review docs',
      description: 'Check the latest draft',
      checked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'alice',
      modifiedBy: 'alice',
    })
  })

  it('coerces legacy checklist markdown seed lines into CardTask entries', () => {
    const tasks = coerceChecklistSeedTasks([
      '- [ ] Draft release notes',
      '- [x] Ship fix',
    ], {
      createdBy: 'alice',
      now: '2026-01-01T00:00:00.000Z',
    })

    expect(tasks).toEqual([
      {
        title: 'Draft release notes',
        description: '',
        checked: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'alice',
        modifiedBy: 'alice',
      },
      {
        title: 'Ship fix',
        description: '',
        checked: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'alice',
        modifiedBy: 'alice',
      },
    ])
  })

  it('rejects blank task titles when building a task', () => {
    expect(() => buildChecklistTask('', '', '')).toThrow('Checklist task title must not be empty')
    expect(() => buildChecklistTask('   ', '', '')).toThrow('Checklist task title must not be empty')
  })

  it('accepts only explicit http, https, and mailto checklist hrefs after decoding entity-obfuscated schemes', () => {
    expect(isSafeChecklistLinkHref('https://example.com/guide')).toBe(true)
    expect(isSafeChecklistLinkHref('mailto:test@example.com')).toBe(true)
    expect(isSafeChecklistLinkHref('https&#58;//example.com/guide')).toBe(true)

    expect(isSafeChecklistLinkHref('//example.com/guide')).toBe(false)
    expect(isSafeChecklistLinkHref('/guide')).toBe(false)
    expect(isSafeChecklistLinkHref('guide')).toBe(false)
    expect(isSafeChecklistLinkHref('javas&#x63;ript:alert(1)')).toBe(false)
    expect(isSafeChecklistLinkHref('java&#115;cript:alert(1)')).toBe(false)
    expect(isSafeChecklistLinkHref('javascript&colon;alert(1)')).toBe(false)
  })

  it('rejects raw HTML and unsafe markdown links in task titles', () => {
    expect(() => buildChecklistTask('<img src=x onerror="alert(1)">', '', '')).toThrow(
      'Checklist task text must not contain raw HTML',
    )
    expect(() => buildChecklistTask('![logo](https://example.com/logo.png)', '', '')).toThrow(
      'Checklist task text must not contain markdown images',
    )
    expect(() => buildChecklistTask('Review [bad-js](javascript:alert(1)) now', '', '')).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(() => buildChecklistTask('Review [bad-data](data:text/html,hi) now', '', '')).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
  })

  it('accepts safe markdown content in task titles', () => {
    const task = buildChecklistTask('Review **docs** _today_ `api` [guide](https://example.com)', '', '', '2026-01-01T00:00:00.000Z')
    expect(task.title).toBe('Review **docs** _today_ `api` [guide](https://example.com)')
    const task2 = buildChecklistTask('Review [mail](mailto:test@example.com)', '', '', '2026-01-01T00:00:00.000Z')
    expect(task2.title).toBe('Review [mail](mailto:test@example.com)')
  })

  it('counts completed and total tasks from CardTask arrays', () => {
    expect(getChecklistStats([makeTask(), makeTask({ checked: true })])).toEqual({
      total: 2,
      completed: 1,
      incomplete: 1,
    })
  })

  it('syncs reserved checklist labels entirely from checklist state', () => {
    expect(syncChecklistDerivedLabels(['bug', 'tasks', 'in-progress'], undefined)).toEqual(['bug'])
    expect(syncChecklistDerivedLabels(['bug'], [makeTask()])).toEqual(['bug', 'tasks', 'in-progress'])
    expect(syncChecklistDerivedLabels(['bug', 'in-progress'], [makeTask({ checked: true })])).toEqual(['bug', 'tasks'])
  })

  it('normalizes card checklist state and syncs derived labels', () => {
    const card = normalizeCardChecklistState({
      id: 'card-1',
      labels: ['bug', 'tasks'],
      tasks: [makeTask({ checked: true }), makeTask()],
    })

    expect(card.tasks).toHaveLength(2)
    expect(card.labels).toEqual(['bug', 'tasks', 'in-progress'])
  })

  it('projects hidden checklist state by omitting tasks and reserved labels', () => {
    const projected = projectCardChecklistState({
      id: 'card-2',
      labels: ['public', 'tasks', 'in-progress'],
      tasks: [makeTask()],
    }, false)

    expect(projected.tasks).toBeUndefined()
    expect(projected.labels).toEqual(['public'])
  })

  it('builds a stable checklist token from CardTask array contents', () => {
    const task1 = makeTask({ title: 'done', checked: true, modifiedAt: '2026-01-01T00:00:00.000Z' })
    const task2 = makeTask({ title: 'todo', modifiedAt: '2026-01-01T00:00:00.000Z' })
    const first = buildChecklistReadModel({
      id: 'card-3',
      boardId: 'default',
      tasks: [task1, task2],
    })
    const second = buildChecklistReadModel({
      id: 'card-3',
      boardId: 'default',
      tasks: [task1, task2],
    })
    const changed = buildChecklistReadModel({
      id: 'card-3',
      boardId: 'default',
      tasks: [task1],
    })

    expect(first.token).toMatch(/^cl1:/)
    expect(second.token).toBe(first.token)
    expect(changed.token).not.toBe(first.token)
  })

  it('exports the reserved checklist labels as a stable public contract', () => {
    expect(CHECKLIST_RESERVED_LABELS).toEqual(['tasks', 'in-progress'])
    expect(isReservedChecklistLabel('tasks')).toBe(true)
    expect(isReservedChecklistLabel('in-progress')).toBe(true)
    expect(isReservedChecklistLabel('bug')).toBe(false)
  })
})

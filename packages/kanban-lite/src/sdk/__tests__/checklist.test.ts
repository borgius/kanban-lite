import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_RESERVED_LABELS,
  buildChecklistReadModel,
  buildChecklistTask,
  getChecklistStats,
  isSafeChecklistLinkHref,
  isReservedChecklistLabel,
  normalizeCardChecklistState,
  normalizeChecklistSeedTasks,
  normalizeChecklistTaskLine,
  projectCardChecklistState,
  syncChecklistDerivedLabels,
} from '../modules/checklist.js'

describe('checklist helpers', () => {
  it('normalizes common hand-authored task-line variants to the canonical single-line format', () => {
    expect(normalizeChecklistTaskLine(' [X] done ')).toBe('- [x] done')
    expect(normalizeChecklistTaskLine('-[ ]todo')).toBe('- [ ] todo')
    expect(normalizeChecklistTaskLine('- [X]   spaced   ')).toBe('- [x] spaced')
  })

  it('rejects multiline task text when building canonical checklist tasks', () => {
    expect(() => buildChecklistTask('line 1\nline 2')).toThrow('Checklist task text must be a single line')
  })

  it('normalizes seeded checklist task lines while preserving checked markers', () => {
    expect(normalizeChecklistSeedTasks([' [X] done ', '-[ ]todo'])).toEqual(['- [x] done', '- [ ] todo'])
  })

  it('rejects blank seeded checklist task lines', () => {
    expect(() => normalizeChecklistSeedTasks(['   '])).toThrow('Checklist task text must not be empty')
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

  it('rejects raw HTML and unsafe markdown links for new checklist writes while preserving supported inline markdown', () => {
    expect(() => normalizeChecklistSeedTasks(['<img src=x onerror="alert(1)"> **docs**'])).toThrow(
      'Checklist task text must not contain raw HTML',
    )
    expect(() => buildChecklistTask('<img src=x onerror="alert(1)"> **docs**')).toThrow(
      'Checklist task text must not contain raw HTML',
    )
    expect(() => normalizeChecklistSeedTasks(['![logo](https://example.com/logo.png)'])).toThrow(
      'Checklist task text must not contain markdown images',
    )
    expect(() => buildChecklistTask('![bad](data:text/html,hi)')).toThrow(
      'Checklist task text must not contain markdown images',
    )
    expect(() => normalizeChecklistSeedTasks(['Review [bad-js](javascript:alert(1)) now'])).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(() => normalizeChecklistSeedTasks(['Review [bad-protocol-relative](//example.com) now'])).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(() => normalizeChecklistSeedTasks(['Review [bad-entity](javas&#x63;ript:alert(1)) now'])).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(() => buildChecklistTask('Review [bad-data](data:text/html,hi) now')).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(() => buildChecklistTask('Review [bad-relative](/docs) now')).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(() => buildChecklistTask('Review [bad-colon](javascript&colon;alert(1)) now')).toThrow(
      'Checklist task links must use http, https, or mailto URLs',
    )
    expect(buildChecklistTask('Review **docs** _today_ `api` [guide](https://example.com)')).toBe(
      '- [ ] Review **docs** _today_ `api` [guide](https://example.com)',
    )
    expect(buildChecklistTask('Review [mail](mailto:test@example.com)')).toBe(
      '- [ ] Review [mail](mailto:test@example.com)',
    )
    expect(buildChecklistTask('Review `<img src=x onerror="alert(1)">` literally')).toBe(
      '- [ ] Review `<img src=x onerror="alert(1)">` literally',
    )
    expect(buildChecklistTask('Review `![logo](https://example.com/logo.png)` literally')).toBe(
      '- [ ] Review `![logo](https://example.com/logo.png)` literally',
    )
    expect(buildChecklistTask('Review `[bad-js](javascript:alert(1))` literally')).toBe(
      '- [ ] Review `[bad-js](javascript:alert(1))` literally',
    )
    expect(buildChecklistTask('Review `[bad-entity](javas&#x63;ript:alert(1))` literally')).toBe(
      '- [ ] Review `[bad-entity](javas&#x63;ript:alert(1))` literally',
    )
    expect(buildChecklistTask('Review `[bad-protocol-relative](//example.com)` literally')).toBe(
      '- [ ] Review `[bad-protocol-relative](//example.com)` literally',
    )
  })

  it('counts completed and total tasks from canonical task strings', () => {
    expect(getChecklistStats(['- [ ] one', '- [x] two'])).toEqual({
      total: 2,
      completed: 1,
      incomplete: 1,
    })
  })

  it('syncs reserved checklist labels entirely from checklist state', () => {
    expect(syncChecklistDerivedLabels(['bug', 'tasks', 'in-progress'], undefined)).toEqual(['bug'])
    expect(syncChecklistDerivedLabels(['bug'], ['- [ ] one'])).toEqual(['bug', 'tasks', 'in-progress'])
    expect(syncChecklistDerivedLabels(['bug', 'in-progress'], ['- [x] one'])).toEqual(['bug', 'tasks'])
  })

  it('self-heals dirty stored checklist state and canonicalizes reserved labels', () => {
    const card = normalizeCardChecklistState({
      id: 'card-1',
      labels: ['bug', 'tasks'],
      tasks: ['- [X] done', '- [ ] todo'],
    })

    expect(card.tasks).toEqual(['- [x] done', '- [ ] todo'])
    expect(card.labels).toEqual(['bug', 'tasks', 'in-progress'])
  })

  it('projects hidden checklist state by omitting tasks and reserved labels', () => {
    const projected = projectCardChecklistState({
      id: 'card-2',
      labels: ['public', 'tasks', 'in-progress'],
      tasks: ['- [ ] hidden work'],
    }, false)

    expect(projected.tasks).toBeUndefined()
    expect(projected.labels).toEqual(['public'])
  })

  it('builds a stable checklist token from the normalized checklist snapshot', () => {
    const first = buildChecklistReadModel({
      id: 'card-3',
      boardId: 'default',
      tasks: [' [X] done ', '-[ ]todo'],
    })
    const second = buildChecklistReadModel({
      id: 'card-3',
      boardId: 'default',
      tasks: ['- [x] done', '- [ ] todo'],
    })
    const changed = buildChecklistReadModel({
      id: 'card-3',
      boardId: 'default',
      tasks: ['- [x] done'],
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

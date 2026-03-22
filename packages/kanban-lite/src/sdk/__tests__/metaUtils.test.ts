import { describe, expect, it } from 'vitest'
import type { Card } from '../../shared/types'
import {
  getNestedValue,
  getSearchableCardText,
  matchesCardSearch,
  matchesExactTextSearch,
  matchesFuzzyTextSearch,
  matchesMetaFilter,
  parseSearchQuery,
} from '../metaUtils'

function createCard(overrides: Partial<Card> = {}): Card {
  return {
    version: 1,
    id: 'card-1',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-18T00:00:00.000Z',
    modified: '2026-03-18T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    comments: [],
    order: 'a0',
    content: '# Example Card\n\nImplements API plumbing.',
    filePath: '/tmp/card-1.md',
    ...overrides,
  }
}

describe('getNestedValue', () => {
  it('returns a top-level value', () => {
    expect(getNestedValue({ sprint: 'Q1' }, 'sprint')).toBe('Q1')
  })

  it('traverses nested objects via dot-notation', () => {
    expect(getNestedValue({ links: { jira: 'PROJ-123' } }, 'links.jira')).toBe('PROJ-123')
  })

  it('traverses three levels deep', () => {
    expect(getNestedValue({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42)
  })

  it('returns undefined for a missing key', () => {
    expect(getNestedValue({ a: 1 }, 'b')).toBeUndefined()
  })

  it('returns undefined when a path segment is missing', () => {
    expect(getNestedValue({ a: { b: 1 } }, 'a.c')).toBeUndefined()
  })

  it('returns undefined when a non-object is encountered mid-path', () => {
    expect(getNestedValue({ a: 'string' }, 'a.b')).toBeUndefined()
  })

  it('returns undefined for null mid-path', () => {
    expect(getNestedValue({ a: null }, 'a.b')).toBeUndefined()
  })

  it('returns numeric values', () => {
    expect(getNestedValue({ estimate: 5 }, 'estimate')).toBe(5)
  })

  it('returns boolean values', () => {
    expect(getNestedValue({ flag: false }, 'flag')).toBe(false)
  })
})

describe('matchesMetaFilter', () => {
  it('returns false when metadata is undefined', () => {
    expect(matchesMetaFilter(undefined, { sprint: 'Q1' })).toBe(false)
  })

  it('returns false when the filter key is missing from metadata', () => {
    expect(matchesMetaFilter({ team: 'backend' }, { sprint: 'Q1' })).toBe(false)
  })

  it('matches exact value', () => {
    expect(matchesMetaFilter({ sprint: '2026-Q1' }, { sprint: '2026-Q1' })).toBe(true)
  })

  it('matches substring (contains)', () => {
    expect(matchesMetaFilter({ sprint: '2026-Q1' }, { sprint: 'Q1' })).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesMetaFilter({ team: 'Backend' }, { team: 'backend' })).toBe(true)
    expect(matchesMetaFilter({ team: 'backend' }, { team: 'BACKEND' })).toBe(true)
  })

  it('matches nested field via dot-notation', () => {
    expect(matchesMetaFilter({ links: { jira: 'PROJ-123' } }, { 'links.jira': 'PROJ' })).toBe(true)
  })

  it('returns false when nested field does not match', () => {
    expect(matchesMetaFilter({ links: { jira: 'OTHER-99' } }, { 'links.jira': 'PROJ' })).toBe(false)
  })

  it('requires ALL filter entries to match (AND logic)', () => {
    const meta = { sprint: '2026-Q1', team: 'backend' }
    expect(matchesMetaFilter(meta, { sprint: 'Q1', team: 'backend' })).toBe(true)
    expect(matchesMetaFilter(meta, { sprint: 'Q1', team: 'frontend' })).toBe(false)
  })

  it('converts numeric values to string for matching', () => {
    expect(matchesMetaFilter({ estimate: 5 }, { estimate: '5' })).toBe(true)
    expect(matchesMetaFilter({ estimate: 15 }, { estimate: '5' })).toBe(true)  // "15" contains "5"
  })

  it('returns true for empty filter (no constraints)', () => {
    expect(matchesMetaFilter({ sprint: 'Q1' }, {})).toBe(true)
  })

  it('returns false when metadata is empty object and filter is non-empty', () => {
    expect(matchesMetaFilter({}, { sprint: 'Q1' })).toBe(false)
  })

  it('supports fuzzy matching for field-scoped metadata values when opted in', () => {
    expect(matchesMetaFilter({ team: 'backend' }, { team: 'backnd' }, true)).toBe(true)
  })
})

describe('parseSearchQuery', () => {
  it('extracts meta.field tokens and leaves the remaining plain text intact', () => {
    expect(parseSearchQuery('meta.team: backend fix login bug')).toEqual({
      metaFilter: { team: 'backend' },
      plainText: 'fix login bug',
    })
  })

  it('extracts multiple metadata tokens with AND semantics', () => {
    expect(parseSearchQuery('meta.team: backend meta.links.jira: PROJ-123 release')).toEqual({
      metaFilter: {
        team: 'backend',
        'links.jira': 'PROJ-123',
      },
      plainText: 'release',
    })
  })

  it('supports quoted metadata values so UI-inserted tokens can preserve spaces', () => {
    expect(parseSearchQuery('meta.team: "backend platform" meta.owner: alice release')).toEqual({
      metaFilter: {
        team: 'backend platform',
        owner: 'alice',
      },
      plainText: 'release',
    })
  })
})

describe('card search helpers', () => {
  it('builds searchable card text with metadata values for fuzzy search', () => {
    const text = getSearchableCardText(createCard({
      metadata: {
        team: 'backend',
        links: { jira: 'PROJ-123' },
      },
    }))

    expect(text).toContain('Implements API plumbing.')
    expect(text).toContain('backend')
    expect(text).toContain('PROJ-123')
  })

  it('keeps exact text matching on the legacy non-metadata fields', () => {
    const card = createCard({ metadata: { team: 'backend' } })
    expect(matchesExactTextSearch(card, 'backend')).toBe(false)
    expect(matchesExactTextSearch(card, 'api plumbing')).toBe(true)
  })

  it('lets fuzzy text matching find metadata values', () => {
    const card = createCard({ metadata: { team: 'backend' } })
    expect(matchesFuzzyTextSearch(card, 'backnd')).toBe(true)
  })

  it('keeps fuzzy free-text opt-in so exact mode still rejects typos', () => {
    const card = createCard({ content: '# Example Card\n\nImplements API plumbing.' })

    expect(matchesExactTextSearch(card, 'plumbng')).toBe(false)
    expect(matchesFuzzyTextSearch(card, 'plumbng')).toBe(true)
  })

  it('keeps metadata tokens field-scoped and AND-based in fuzzy mode', () => {
    const matchingCard = createCard({
      metadata: {
        team: 'backend',
        region: 'us-east',
        owner: 'alice',
      },
    })
    const wrongFieldCard = createCard({
      metadata: {
        owner: 'backend',
        region: 'us-east',
      },
    })

    expect(matchesCardSearch(matchingCard, 'meta.team: backnd meta.region: useast', {}, true)).toBe(true)
    expect(matchesCardSearch(wrongFieldCard, 'meta.team: backnd meta.region: useast', {}, true)).toBe(false)
  })

  it('keeps metadata tokens exact by default while fuzzy mode tolerates near matches', () => {
    const card = createCard({
      metadata: {
        team: 'backend',
        region: 'us-east',
      },
    })

    expect(matchesCardSearch(card, 'meta.team: backnd meta.region: useast')).toBe(false)
    expect(matchesCardSearch(card, 'meta.team: backnd meta.region: useast', {}, true)).toBe(true)
  })

  it('combines explicit metaFilter input with parsed metadata tokens', () => {
    const card = createCard({ metadata: { team: 'backend', sprint: '2026-Q1' } })
    expect(matchesCardSearch(card, 'meta.team: backend api', { sprint: 'Q1' })).toBe(true)
    expect(matchesCardSearch(card, 'meta.team: backend api', { sprint: 'Q2' })).toBe(false)
  })

  it('pairs exact and fuzzy behavior for mixed metadata plus free-text queries', () => {
    const card = createCard({
      content: '# Example Card\n\nImplements API plumbing for release readiness.',
      metadata: {
        team: 'backend',
      },
    })

    expect(matchesCardSearch(card, 'meta.team: backend plumbng')).toBe(false)
    expect(matchesCardSearch(card, 'meta.team: backend plumbng', {}, true)).toBe(true)
  })
})

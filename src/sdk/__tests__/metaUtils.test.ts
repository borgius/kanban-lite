import { describe, expect, it } from 'vitest'
import { getNestedValue, matchesMetaFilter } from '../metaUtils'

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
})

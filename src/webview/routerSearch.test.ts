import { describe, expect, it } from 'vitest'
import { buildSearchStr, parseRouteBoolean, validateSearch } from './routerSearch'

describe('routerSearch helpers', () => {
  it('accepts normal fuzzy=true query params parsed as booleans', () => {
    expect(validateSearch({ fuzzy: true, q: 'release' })).toEqual({
      q: 'release',
      fuzzy: 'true',
      priority: undefined,
      labels: undefined,
      assignee: undefined,
      dueDate: undefined,
    })
    expect(parseRouteBoolean(true)).toBe(true)
  })

  it('continues to accept quoted serialized fuzzy values for backward compatibility', () => {
    expect(parseRouteBoolean('true')).toBe(true)
    expect(parseRouteBoolean('"true"')).toBe(true)
    expect(parseRouteBoolean('false')).toBe(false)
  })

  it('includes fuzzy in the route state fingerprint when enabled', () => {
    expect(buildSearchStr({ q: 'release', fuzzy: 'true' })).toContain('"fuzzy":"true"')
  })
})

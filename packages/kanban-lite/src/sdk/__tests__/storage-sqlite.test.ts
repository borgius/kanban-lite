import { describe, expect, it } from 'vitest'
import { PROVIDER_ALIASES } from '../plugins'

describe('sqlite compatibility ownership boundary', () => {
  it('resolves the sqlite provider id through the external package alias', () => {
    expect(PROVIDER_ALIASES.get('sqlite')).toBe('kl-sqlite-storage')
  })
})

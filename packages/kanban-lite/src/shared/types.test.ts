import { describe, expect, it } from 'vitest'
import { getDisplayTitleFromContent, getTitleFromContent } from './types'

describe('getDisplayTitleFromContent', () => {
  it('prefixes configured metadata values in declared order', () => {
    expect(
      getDisplayTitleFromContent('# Ship release', { ticket: 'REL-42', sprint: 'Q1' }, ['ticket', 'sprint'])
    ).toBe('REL-42 Q1 Ship release')
  })

  it('skips missing and empty metadata values cleanly', () => {
    expect(
      getDisplayTitleFromContent('# Investigate auth', { team: 'platform', sprint: '   ', empty: [] }, ['missing', 'sprint', 'team', 'empty'])
    ).toBe('platform Investigate auth')
  })

  it('supports nested dot-notation metadata paths', () => {
    expect(
      getDisplayTitleFromContent('# Fix webhook', { links: { jira: 'OPS-9' } }, ['links.jira'])
    ).toBe('OPS-9 Fix webhook')
  })

  it('keeps raw title extraction behavior unchanged', () => {
    expect(getTitleFromContent('# Raw title\n\nBody')).toBe('Raw title')
    expect(getDisplayTitleFromContent('# Raw title\n\nBody', undefined, undefined)).toBe('Raw title')
  })
})

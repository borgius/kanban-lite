import { describe, expect, it } from 'vitest'
import { formatMarkdownSelection } from './markdownTools'

describe('formatMarkdownSelection', () => {
  it('wraps selected text in bold markers', () => {
    const result = formatMarkdownSelection('hello world', 0, 5, 'bold')

    expect(result).toEqual({
      nextValue: '**hello** world',
      selectionStart: 9,
      selectionEnd: 9,
    })
  })

  it('inserts a link placeholder when nothing is selected', () => {
    const result = formatMarkdownSelection('', 0, 0, 'link')

    expect(result).toEqual({
      nextValue: '[text](url)',
      selectionStart: 1,
      selectionEnd: 1,
    })
  })

  it('prefixes every selected line for task lists', () => {
    const result = formatMarkdownSelection('alpha\nbeta', 0, 10, 'tasklist')

    expect(result).toEqual({
      nextValue: '- [ ] alpha\n- [ ] beta',
      selectionStart: 22,
      selectionEnd: 22,
    })
  })
})

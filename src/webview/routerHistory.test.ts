import { describe, expect, it } from 'vitest'
import { shouldUseMemoryHistory } from './routerHistory'

describe('shouldUseMemoryHistory', () => {
  it('uses browser history in standalone http environments even when a VS Code shim exists', () => {
    expect(shouldUseMemoryHistory('http:')).toBe(false)
    expect(shouldUseMemoryHistory('https:')).toBe(false)
  })

  it('uses memory history inside VS Code webviews', () => {
    expect(shouldUseMemoryHistory('vscode-webview:')).toBe(true)
    expect(shouldUseMemoryHistory('vscode-file:')).toBe(true)
  })
})

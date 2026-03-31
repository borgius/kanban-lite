import { NOT_APPLICABLE } from '@jsonforms/core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@codemirror/lang-javascript', () => ({
  javascript: () => ({}),
}))

vi.mock('@uiw/react-codemirror', () => {
  const CodeMirror = () => null

  return {
    __esModule: true,
    default: CodeMirror,
    EditorView: {
      lineWrapping: {},
    },
  }
})

import { jsonFormsCodeEditorTester } from './JsonFormsCodeEditorControl'

describe('jsonFormsCodeEditorTester', () => {
  const nestedDetailSchema = {
    type: 'object',
    properties: {
      source: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  } as const

  const testerContext = {
    rootSchema: nestedDetailSchema,
    config: {},
  }

  it('matches code editor controls inside nested detail object schemas', () => {
    expect(jsonFormsCodeEditorTester(
      {
        type: 'Control',
        scope: '#/properties/source',
        options: { editor: 'code' },
      },
      nestedDetailSchema,
      testerContext,
    )).toBe(1000)
  })

  it('rejects non-string nested detail properties', () => {
    expect(jsonFormsCodeEditorTester(
      {
        type: 'Control',
        scope: '#/properties/enabled',
        options: { editor: 'code' },
      },
      nestedDetailSchema,
      testerContext,
    )).toBe(NOT_APPLICABLE)
  })

  it('rejects controls without the code editor option', () => {
    expect(jsonFormsCodeEditorTester(
      {
        type: 'Control',
        scope: '#/properties/source',
      },
      nestedDetailSchema,
      testerContext,
    )).toBe(NOT_APPLICABLE)
  })
})
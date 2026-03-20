import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BoardInfo, CardFrontmatter } from '../../shared/types'

vi.mock('@jsonforms/react', () => ({
  JsonForms: () => <div data-json-forms="true" />,
}))

vi.mock('../vsCodeApi', () => ({
  getVsCodeApi: () => ({
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  }),
}))

import { CardFormTab, formatFormValidationError, resolveCardFormDescriptors, shouldPreserveFormSuccessMessage } from './CardFormTab'

function makeFrontmatter(overrides: Partial<CardFrontmatter> = {}): CardFrontmatter {
  return {
    version: 1,
    id: '42',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    created: '2026-03-19T00:00:00.000Z',
    modified: '2026-03-19T00:00:00.000Z',
    completedAt: null,
    labels: [],
    attachments: [],
    order: 'a0',
    ...overrides,
  }
}

function makeBoard(overrides: Partial<BoardInfo> = {}): BoardInfo {
  return {
    id: 'default',
    name: 'Default',
    ...overrides,
  }
}

describe('resolveCardFormDescriptors', () => {
  it('applies the SDK-aligned initial data merge order', () => {
    const frontmatter = makeFrontmatter({
      metadata: {
        title: 'Metadata title',
        severity: 'critical',
        ignored: 'nope',
      },
      forms: [{
        name: 'bug-report',
        data: {
          title: 'Attachment title',
          severity: 'medium',
          attachmentOnly: 'yes',
        },
      }],
      formData: {
        'bug-report': {
          title: 'Persisted title',
          persistedOnly: true,
        },
      },
    })
    const board = makeBoard({
      forms: {
        'bug-report': {
          schema: {
            title: 'Bug Report',
            type: 'object',
            properties: {
              title: { type: 'string' },
              severity: { type: 'string' },
            },
          },
          data: {
            title: 'Config title',
            severity: 'low',
            configOnly: 'base',
          },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.id).toBe('bug-report')
    expect(form.initialData).toEqual({
      title: 'Metadata title',
      severity: 'critical',
      configOnly: 'base',
      attachmentOnly: 'yes',
      persistedOnly: true,
    })
  })

  it('keeps duplicate inline form ids stable by suffixing later tabs', () => {
    const frontmatter = makeFrontmatter({
      forms: [
        { schema: { type: 'object', title: 'Release Checklist' } },
        { schema: { type: 'object', title: 'Release Checklist' } },
      ],
    })

    const forms = resolveCardFormDescriptors(frontmatter)

    expect(forms.map((form) => form.id)).toEqual(['release-checklist', 'release-checklist-2'])
  })
})

describe('CardFormTab', () => {
  it('renders validation feedback when the initial form data is invalid', () => {
    const form = {
      id: 'bug-report',
      label: 'Bug Report',
      schema: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
        },
        required: ['severity'],
      },
      initialData: {},
      fromConfig: true,
    }

    const markup = renderToStaticMarkup(
      <CardFormTab cardId="42" boardId="default" form={form} />,
    )

    expect(markup).toContain('Fix 1 validation error before submitting.')
    expect(markup).toContain('Validation issues')
    expect(markup).toContain('data-json-forms="true"')
    expect(markup).toContain('disabled=""')
  })

  it('formats required-field validation errors clearly', () => {
    expect(formatFormValidationError({
      instancePath: '',
      message: "must have required property 'severity'",
      params: { missingProperty: 'severity' },
    })).toBe("severity must have required property 'severity'")
  })

  it('preserves success feedback when refreshed form data matches the last successful submit', () => {
    expect(shouldPreserveFormSuccessMessage('bug-report', JSON.stringify({ severity: 'high' }), {
      formId: 'bug-report',
      dataSignature: JSON.stringify({ severity: 'high' }),
    })).toBe(true)

    expect(shouldPreserveFormSuccessMessage('bug-report', JSON.stringify({ severity: 'low' }), {
      formId: 'bug-report',
      dataSignature: JSON.stringify({ severity: 'high' }),
    })).toBe(false)
  })

  it('renders the card-jsonforms scoped wrapper class required for CSS targeting', () => {
    const form = {
      id: 'style-hook-test',
      label: 'Style Hook',
      schema: { type: 'object', properties: {} },
      initialData: {},
      fromConfig: false,
    }

    const markup = renderToStaticMarkup(
      <CardFormTab cardId="42" boardId="default" form={form} />,
    )

    expect(markup).toContain('card-jsonforms')
  })
})

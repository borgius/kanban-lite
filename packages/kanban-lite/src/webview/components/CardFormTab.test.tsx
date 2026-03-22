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
          name: 'Bug Report',
          description: 'Capture production bug details.',
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
    expect(form.name).toBe('Bug Report')
    expect(form.description).toBe('Capture production bug details.')
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

  it('defaults config form names from the capitalized key and descriptions to empty', () => {
    const frontmatter = makeFrontmatter({ forms: [{ name: 'incident-report' }] })
    const board = makeBoard({
      forms: {
        'incident-report': {
          schema: { type: 'object', properties: {} },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.name).toBe('Incident Report')
    expect(form.label).toBe('Incident Report')
    expect(form.description).toBe('')
  })

  it('interpolates ${path} placeholders in persisted formData against card context', () => {
    const frontmatter = makeFrontmatter({
      forms: [{ name: 'ticket' }],
      formData: {
        ticket: {
          ref: '${id}',
          label: 'Card ${id} [${status}]',
        },
      },
    })
    const board = makeBoard({
      forms: {
        ticket: {
          schema: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              label: { type: 'string' },
            },
          },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.initialData).toEqual({
      ref: '42',
      label: 'Card 42 [backlog]',
    })
  })

  it('interpolates ${path} placeholders in config defaults and attachment defaults', () => {
    const frontmatter = makeFrontmatter({
      metadata: { owner: 'alice' },
      forms: [{ name: 'task', data: { label: 'Owned by ${metadata.owner}' } }],
    })
    const board = makeBoard({
      forms: {
        task: {
          schema: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              label: { type: 'string' },
            },
          },
          data: { ref: 'CARD-${id}' },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.initialData).toEqual({
      ref: 'CARD-42',
      label: 'Owned by alice',
    })
  })

  it('metadata overlay wins over an interpolated placeholder value in persisted formData', () => {
    const frontmatter = makeFrontmatter({
      metadata: { owner: 'real-owner' },
      forms: [{ name: 'meta' }],
      formData: {
        meta: {
          owner: '${id}',
          note: 'assigned to ${assignee}',
        },
      },
    })
    const board = makeBoard({
      forms: {
        meta: {
          schema: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    // metadata overlay wins over the interpolated ${id} placeholder
    expect(form.initialData.owner).toBe('real-owner')
    // assignee is null in makeFrontmatter → resolves to empty string
    expect(form.initialData.note).toBe('assigned to ')
  })

  it('correctly prepares partial stored formData — only present fields are interpolated, config defaults fill the rest', () => {
    const frontmatter = makeFrontmatter({
      forms: [{ name: 'multi' }],
      formData: {
        // only 'ref' is persisted — partial
        multi: { ref: '${id}' },
      },
    })
    const board = makeBoard({
      forms: {
        multi: {
          schema: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              note: { type: 'string' },
            },
          },
          data: { note: 'default note' },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.initialData).toEqual({
      ref: '42',
      note: 'default note',
    })
  })

  it('interpolates extended card fields (created, labels) in form templates', () => {
    const frontmatter = makeFrontmatter({
      created: '2026-01-15T00:00:00.000Z',
      labels: ['bug'],
      forms: [{ name: 'report' }],
      formData: {
        report: {
          ref: 'CARD-${id}',
          created: '${created}',
          tag: '${labels}',
        },
      },
    })
    const board = makeBoard({
      forms: {
        report: {
          schema: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              created: { type: 'string' },
              tag: { type: 'string' },
            },
          },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.initialData.ref).toBe('CARD-42')
    expect(form.initialData.created).toBe('2026-01-15T00:00:00.000Z')
    expect(form.initialData.tag).toBe('bug')
  })

  it('prefers frontmatter.boardId over board.id for interpolation context', () => {
    const frontmatter = makeFrontmatter({
      boardId: 'frontmatter-board',
      forms: [{ name: 'ctx-check' }],
      formData: {
        'ctx-check': { board: '${boardId}' },
      },
    })
    const board = makeBoard({ id: 'board-from-param' })
    board.forms = {
      'ctx-check': {
        schema: { type: 'object', properties: { board: { type: 'string' } } },
      },
    }

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.initialData.board).toBe('frontmatter-board')
  })

  it('interpolates ${content} placeholder from card body content', () => {
    const frontmatter = makeFrontmatter({
      forms: [{ name: 'summary' }],
      formData: {
        summary: {
          excerpt: '${content}',
          label: 'Content: ${content}',
        },
      },
    })
    const board = makeBoard({
      forms: {
        summary: {
          schema: {
            type: 'object',
            properties: {
              excerpt: { type: 'string' },
              label: { type: 'string' },
            },
          },
        },
      },
    })

    const [form] = resolveCardFormDescriptors({ ...frontmatter, content: '# My Card\nSome body text' }, board)

    expect(form.initialData.excerpt).toBe('# My Card\nSome body text')
    expect(form.initialData.label).toBe('Content: # My Card\nSome body text')
  })

  it('resolves ${content} to empty string when content is not provided', () => {
    const frontmatter = makeFrontmatter({
      forms: [{ name: 'empty-content' }],
      formData: {
        'empty-content': { ref: '${content}' },
      },
    })
    const board = makeBoard({
      forms: {
        'empty-content': {
          schema: { type: 'object', properties: { ref: { type: 'string' } } },
        },
      },
    })

    const [form] = resolveCardFormDescriptors(frontmatter, board)

    expect(form.initialData.ref).toBe('')
  })
})

describe('CardFormTab', () => {
  it('renders validation feedback when the initial form data is invalid', () => {
    const form = {
      id: 'bug-report',
      name: 'Bug Report',
      description: 'Capture production bug details.',
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
    expect(markup).toContain('Capture production bug details.')
    expect(markup).toContain('var(--vscode-errorForeground)')
    expect(markup).not.toContain('Ready to submit.')
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
      name: 'Style Hook',
      description: '',
      label: 'Style Hook',
      schema: { type: 'object', properties: {} },
      initialData: {},
      fromConfig: false,
    }

    const markup = renderToStaticMarkup(
      <CardFormTab cardId="42" boardId="default" form={form} />,
    )

    expect(markup).toContain('card-jsonforms')
    expect(markup).not.toContain('Ready to submit.')
  })
})

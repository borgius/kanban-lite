import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import { cmdActive, cmdAdd, cmdEdit, cmdForm, cmdList, parseArgs, showHelp } from './index'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    content: '# Card 1\n\nBody',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    dueDate: null,
    labels: [],
    attachments: [],
    comments: [],
    created: '2026-03-18T00:00:00.000Z',
    modified: '2026-03-18T00:00:00.000Z',
    completedAt: null,
    filePath: '/tmp/card-1.md',
    boardId: 'default',
    order: 'a0',
    metadata: { sprint: 'Q1' },
    actions: [],
    version: 1,
    ...overrides,
  }
}

function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? 0}`)
  }) as typeof process.exit)
}

describe('CLI list command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses --search and --fuzzy while preserving repeatable --meta filters', () => {
    const parsed = parseArgs([
      'node',
      'kl',
      'list',
      '--search',
      'backnd',
      '--fuzzy',
      '--meta',
      'sprint=Q1',
      '--meta',
      'links.jira=PROJ-123',
    ])

    expect(parsed.command).toBe('list')
    expect(parsed.flags.search).toBe('backnd')
    expect(parsed.flags.fuzzy).toBe(true)
    expect(parsed.flags.meta).toEqual(['sprint=Q1', 'links.jira=PROJ-123'])
  })

  it('delegates search and fuzzy matching to sdk.listCards while preserving JSON output', async () => {
    const sdk = {
      listCards: vi.fn().mockResolvedValue([makeCard()]),
      getLabelsInGroup: vi.fn().mockReturnValue([]),
    } as unknown as Pick<KanbanSDK, 'listCards' | 'getLabelsInGroup'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdList(sdk as KanbanSDK, {
      search: 'backnd',
      fuzzy: true,
      meta: ['sprint=Q1', 'links.jira=PROJ-123'],
      json: true,
    })

    expect(sdk.listCards).toHaveBeenCalledWith(undefined, undefined, {
      metaFilter: { sprint: 'Q1', 'links.jira': 'PROJ-123' },
      searchQuery: 'backnd',
      fuzzy: true,
      sort: undefined,
    })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual([makeCard()])
  })

  it('documents the new list search flags in help text', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    showHelp()

    const helpText = logSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(helpText).toContain('--search <text>')
    expect(helpText).toContain('--fuzzy')
    expect(helpText).toContain('--meta key=value')
    expect(helpText).toContain('form submit <id> <form>')
    expect(helpText).toContain("--forms '<json|@file>'")
    expect(helpText).toContain("--form-data '<json|@file>'")
    expect(helpText).toContain("--data '<json|@file>'")
  })
})

describe('CLI active command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the active card as JSON when requested', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(makeCard({ id: 'active-1' })),
    } as unknown as Pick<KanbanSDK, 'getActiveCard'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, { json: true })

    expect(sdk.getActiveCard).toHaveBeenCalledWith(undefined)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(makeCard({ id: 'active-1' }))
  })

  it('prints a friendly message when no active card exists', async () => {
    const sdk = {
      getActiveCard: vi.fn().mockResolvedValue(null),
    } as unknown as Pick<KanbanSDK, 'getActiveCard'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdActive(sdk as KanbanSDK, {})

    expect(logSpy.mock.calls[0][0]).toContain('No active card')
  })
})

describe('CLI form-aware card commands', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a card with forms and form data in a single createCard call', async () => {
    const card = makeCard({
      id: 'card-create',
      forms: [{ name: 'bug-report' }],
      formData: { 'bug-report': { severity: 'high' } },
    })
    const sdk = {
      createCard: vi.fn().mockResolvedValue(card),
    } as unknown as Pick<KanbanSDK, 'createCard'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdAdd(sdk as KanbanSDK, {
      title: 'Bug card',
      forms: JSON.stringify([{ name: 'bug-report' }]),
      'form-data': JSON.stringify({ 'bug-report': { severity: 'high' } }),
      json: true,
    })

    expect(sdk.createCard).toHaveBeenCalledWith({
      content: '# Bug card',
      status: undefined,
      priority: 'medium',
      assignee: null,
      dueDate: null,
      labels: [],
      metadata: undefined,
      actions: undefined,
      boardId: undefined,
      forms: [{ name: 'bug-report' }],
      formData: { 'bug-report': { severity: 'high' } },
    })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(card)
  })

  it('updates forms and form data on an existing card', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-edit' })),
      updateCard: vi.fn().mockResolvedValue(makeCard({
        id: 'card-edit',
        forms: [{ schema: { type: 'object', title: 'Checklist' } }],
        formData: { checklist: { approved: true } },
      })),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'updateCard'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdEdit(sdk as KanbanSDK, ['card-edit'], {
      forms: JSON.stringify([{ schema: { type: 'object', title: 'Checklist' } }]),
      'form-data': JSON.stringify({ checklist: { approved: true } }),
    })

    expect(sdk.updateCard).toHaveBeenCalledWith('card-edit', {
      forms: [{ schema: { type: 'object', title: 'Checklist' } }],
      formData: { checklist: { approved: true } },
    }, undefined)
    expect(logSpy.mock.calls[0][0]).toContain('Updated: card-edit')
  })

  it('submits a named card form using a JSON payload', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-submit' })),
      submitForm: vi.fn().mockResolvedValue({
        boardId: 'default',
        card: { ...makeCard({ id: 'card-submit' }), filePath: undefined },
        form: {
          id: 'bug-report',
          label: 'bug-report',
          schema: { type: 'object' },
          initialData: { severity: 'medium' },
          fromConfig: true,
        },
        data: { severity: 'high' },
      }),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
      data: JSON.stringify({ severity: 'high' }),
      json: true,
    })

    expect(sdk.submitForm).toHaveBeenCalledWith({
      cardId: 'card-submit',
      formId: 'bug-report',
      data: { severity: 'high' },
      boardId: undefined,
    })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
      form: { id: 'bug-report' },
      data: { severity: 'high' },
    })
  })

  it('supports @file JSON payloads for form submission ergonomics', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cli-form-'))
    const payloadPath = path.join(tempDir, 'payload.json')
    fs.writeFileSync(payloadPath, JSON.stringify({ severity: 'critical' }), 'utf-8')

    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-submit' })),
      submitForm: vi.fn().mockResolvedValue({
        boardId: 'default',
        card: { ...makeCard({ id: 'card-submit' }), filePath: undefined },
        form: {
          id: 'bug-report',
          label: 'bug-report',
          schema: { type: 'object' },
          initialData: { severity: 'medium' },
          fromConfig: true,
        },
        data: { severity: 'critical' },
      }),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm'>
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
        data: `@${payloadPath}`,
        json: true,
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    expect(sdk.submitForm).toHaveBeenCalledWith({
      cardId: 'card-submit',
      formId: 'bug-report',
      data: { severity: 'critical' },
      boardId: undefined,
    })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
      data: { severity: 'critical' },
    })
  })

  it('fails fast when --forms is not valid JSON', async () => {
    const sdk = {
      createCard: vi.fn(),
      updateCard: vi.fn(),
    } as unknown as Pick<KanbanSDK, 'createCard' | 'updateCard'>
    const exitSpy = mockProcessExit()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(cmdAdd(sdk as KanbanSDK, {
      title: 'Bad card',
      forms: '{not-json',
    })).rejects.toThrow('process.exit:1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--forms must be valid JSON'))
    expect(sdk.createCard).not.toHaveBeenCalled()
  })

  it('propagates SDK form submission errors', async () => {
    const sdk = {
      getCard: vi.fn().mockResolvedValue(makeCard({ id: 'card-submit' })),
      submitForm: vi.fn().mockRejectedValue(new Error('Invalid form submission for bug-report')),
    } as unknown as Pick<KanbanSDK, 'getCard' | 'submitForm'>

    await expect(cmdForm(sdk as KanbanSDK, ['submit', 'card-submit', 'bug-report'], {
      data: JSON.stringify({ severity: 'nope' }),
    })).rejects.toThrow('Invalid form submission for bug-report')
  })
})

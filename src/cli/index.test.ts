import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../shared/types'
import type { KanbanSDK } from '../sdk/KanbanSDK'
import { cmdActive, cmdList, parseArgs, showHelp } from './index'

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

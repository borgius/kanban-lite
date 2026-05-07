import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listBoardsOverview, type BoardOverviewContext } from '../modules/board-overview'
import { DELETED_STATUS_ID } from '../../shared/types'
import type { BoardInfo, Card, KanbanColumn } from '../../shared/types'
import type { CardUnreadSummary } from '../types'

function makeBoard(id: string, name = `Board ${id}`): BoardInfo {
  return { id, name, description: '' }
}

function makeColumn(id: string, name = `Col ${id}`): KanbanColumn {
  return { id, name, color: '#aaa' }
}

function makeCard(id: string, status: string, boardId?: string): Card {
  return {
    id,
    status,
    title: `Card ${id}`,
    content: '',
    priority: 'medium',
    assignee: null,
    labels: [],
    order: '',
    dueDate: null,
    attachments: [],
    metadata: {},
    actions: [],
    forms: [],
    formData: {},
    boardId: boardId ?? null,
    createdAt: null,
    updatedAt: null,
    deletedAt: null,
  } as unknown as Card
}

function makeCtx(overrides?: Partial<BoardOverviewContext>): BoardOverviewContext {
  return {
    listBoards: vi.fn().mockReturnValue([]),
    listColumns: vi.fn().mockReturnValue([]),
    listCards: vi.fn().mockResolvedValue([]),
    getCardStateReadModelForCards: vi.fn().mockResolvedValue(new Map()),
    ...overrides,
  }
}

describe('listBoardsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no boards exist', async () => {
    const ctx = makeCtx()
    const result = await listBoardsOverview(ctx)
    expect(result).toEqual([])
  })

  it('aggregates cards across columns for a single board', async () => {
    const board = makeBoard('b1')
    const colA = makeColumn('colA')
    const colB = makeColumn('colB')
    const cards = [makeCard('c1', 'colA'), makeCard('c2', 'colA'), makeCard('c3', 'colB')]

    const ctx = makeCtx({
      listBoards: vi.fn().mockReturnValue([board]),
      listColumns: vi.fn().mockReturnValue([colA, colB]),
      listCards: vi.fn().mockResolvedValue(cards),
      getCardStateReadModelForCards: vi.fn().mockResolvedValue(new Map()),
    })

    const result = await listBoardsOverview(ctx)

    expect(result).toHaveLength(1)
    expect(result[0]?.board).toEqual(board)
    expect(result[0]?.totalCards).toBe(3)
    expect(result[0]?.columns).toHaveLength(2)
    expect(result[0]?.columns.find(c => c.id === 'colA')?.cardCount).toBe(2)
    expect(result[0]?.columns.find(c => c.id === 'colB')?.cardCount).toBe(1)
  })

  it('sets notificationCards and column notificationCounts from card state map', async () => {
    const board = makeBoard('b1')
    const col = makeColumn('col1')
    const cards = [makeCard('c1', 'col1'), makeCard('c2', 'col1'), makeCard('c3', 'col1')]

    const stateMap = new Map<string, { unread: CardUnreadSummary }>([
      ['c1', { unread: { unread: true } as CardUnreadSummary }],
      ['c2', { unread: { unread: false } as CardUnreadSummary }],
      ['c3', { unread: { unread: true } as CardUnreadSummary }],
    ])

    const ctx = makeCtx({
      listBoards: vi.fn().mockReturnValue([board]),
      listColumns: vi.fn().mockReturnValue([col]),
      listCards: vi.fn().mockResolvedValue(cards),
      getCardStateReadModelForCards: vi.fn().mockResolvedValue(stateMap),
    })

    const result = await listBoardsOverview(ctx)

    expect(result[0]?.notificationCards).toBe(2)
    expect(result[0]?.columns[0]?.notificationCount).toBe(2)
  })

  it('sets notificationCards and notificationCount to null when card.state throws', async () => {
    const board = makeBoard('b1')
    const col = makeColumn('col1')
    const cards = [makeCard('c1', 'col1')]

    const ctx = makeCtx({
      listBoards: vi.fn().mockReturnValue([board]),
      listColumns: vi.fn().mockReturnValue([col]),
      listCards: vi.fn().mockResolvedValue(cards),
      getCardStateReadModelForCards: vi.fn().mockRejectedValue(new Error('card.state not configured')),
    })

    const result = await listBoardsOverview(ctx)

    expect(result[0]?.notificationCards).toBeNull()
    expect(result[0]?.columns[0]?.notificationCount).toBeNull()
  })

  it('excludes DELETED_STATUS_ID columns from summary', async () => {
    const board = makeBoard('b1')
    const normalCol = makeColumn('active')
    const deletedCol = makeColumn(DELETED_STATUS_ID)

    const ctx = makeCtx({
      listBoards: vi.fn().mockReturnValue([board]),
      listColumns: vi.fn().mockReturnValue([normalCol, deletedCol]),
      listCards: vi.fn().mockResolvedValue([]),
      getCardStateReadModelForCards: vi.fn().mockResolvedValue(new Map()),
    })

    const result = await listBoardsOverview(ctx)

    const colIds = result[0]?.columns.map(c => c.id) ?? []
    expect(colIds).toContain('active')
    expect(colIds).not.toContain(DELETED_STATUS_ID)
  })

  it('processes multiple boards in parallel', async () => {
    const boards = [makeBoard('b1'), makeBoard('b2')]

    const ctx = makeCtx({
      listBoards: vi.fn().mockReturnValue(boards),
      listColumns: vi.fn().mockReturnValue([makeColumn('col1')]),
      listCards: vi.fn().mockResolvedValue([makeCard('c1', 'col1')]),
      getCardStateReadModelForCards: vi.fn().mockResolvedValue(new Map()),
    })

    const result = await listBoardsOverview(ctx)

    expect(result).toHaveLength(2)
    expect(result.map(r => r.board.id)).toEqual(['b1', 'b2'])
  })

  it('returns zero notificationCards when card state map is empty (not null)', async () => {
    const board = makeBoard('b1')
    const col = makeColumn('col1')
    const cards = [makeCard('c1', 'col1')]

    const ctx = makeCtx({
      listBoards: vi.fn().mockReturnValue([board]),
      listColumns: vi.fn().mockReturnValue([col]),
      listCards: vi.fn().mockResolvedValue(cards),
      getCardStateReadModelForCards: vi.fn().mockResolvedValue(new Map()),
    })

    const result = await listBoardsOverview(ctx)

    // State map returned but no unread entries → 0, not null
    expect(result[0]?.notificationCards).toBe(0)
  })
})

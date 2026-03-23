import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()

  return {
    ...actual,
    useState<T>(initialState: T | (() => T)) {
      const value = typeof initialState === 'function'
        ? (initialState as () => T)()
        : initialState

      return [value, vi.fn()] as const
    },
    useEffect() {},
    useMemo<T>(factory: () => T) {
      return factory()
    },
    useRef<T>(initialValue: T) {
      return { current: initialValue }
    },
  }
})

vi.mock('lucide-react', () => ({
  Plus: () => null,
  MoreVertical: () => null,
  Pencil: () => null,
  Trash2: () => null,
  Check: () => null,
  CheckSquare: () => null,
  LayoutList: () => null,
  Maximize2: () => null,
  Minimize2: () => null,
  Zap: () => null,
}))

vi.mock('./CardItem', () => ({ CardItem: () => null }))
vi.mock('./QuickAddInput', () => ({ QuickAddInput: () => null }))

import { KanbanColumn } from './KanbanColumn'

describe('KanbanColumn minimized rail drop behavior', () => {
  it('does not swallow card drag events before they reach the column drop target', () => {
    const onColumnDragOver = vi.fn()
    const onColumnDrop = vi.fn()

    const element = KanbanColumn({
      column: { id: 'review', name: 'Review', color: '#8b5cf6' },
      columnIndex: 1,
      cards: [],
      onCardClick: vi.fn(),
      onAddCard: vi.fn(),
      onEditColumn: vi.fn(),
      onRemoveColumn: vi.fn(),
      onCleanupColumn: vi.fn(),
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragOverCard: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      draggedCard: null,
      dropTarget: null,
      draggedColumnId: null,
      dropColumnIndex: null,
      onColumnDragStart: vi.fn(),
      onColumnDragOver,
      onColumnDrop,
      onColumnDragEnd: vi.fn(),
      isMinimized: true,
      onToggleMinimized: vi.fn(),
      layout: 'horizontal',
      selectedCardIds: [],
      onSelectAll: vi.fn(),
      sort: 'order',
      onSortChange: vi.fn(),
    }) as ReactElement<{ children: ReactElement<{ onDragOver: (event: unknown) => void; onDrop: (event: unknown) => void }> }>

    const minimizedRail = element.props.children
    const dragOverEvent = {
      dataTransfer: { types: ['text/plain'] },
      stopPropagation: vi.fn(),
    }
    const dropEvent = {
      dataTransfer: { types: ['text/plain'] },
      stopPropagation: vi.fn(),
    }

    minimizedRail.props.onDragOver(dragOverEvent)
    minimizedRail.props.onDrop(dropEvent)

    expect(dragOverEvent.stopPropagation).not.toHaveBeenCalled()
    expect(dropEvent.stopPropagation).not.toHaveBeenCalled()
    expect(onColumnDragOver).not.toHaveBeenCalled()
    expect(onColumnDrop).not.toHaveBeenCalled()
  })
})

describe('KanbanColumn normal-mode header/body structure', () => {
  const baseProps = {
    column: { id: 'review', name: 'Review', color: '#8b5cf6' },
    columnIndex: 0,
    cards: [],
    onCardClick: vi.fn(),
    onAddCard: vi.fn(),
    onEditColumn: vi.fn(),
    onRemoveColumn: vi.fn(),
    onCleanupColumn: vi.fn(),
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragOverCard: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
    draggedCard: null,
    dropTarget: null,
    draggedColumnId: null,
    dropColumnIndex: null,
    onColumnDragStart: vi.fn(),
    onColumnDragOver: vi.fn(),
    onColumnDrop: vi.fn(),
    onColumnDragEnd: vi.fn(),
    isMinimized: false,
    onToggleMinimized: vi.fn(),
    layout: 'horizontal' as const,
    selectedCardIds: [],
    onSelectAll: vi.fn(),
    sort: 'order',
    onSortChange: vi.fn(),
  }

  it('renders a draggable header element above a distinct scrollable content body', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = KanbanColumn(baseProps as any) as ReactElement<{ children: any[] }>
    const [headerEl, contentEl] = element.props.children
    // Header must be draggable so columns can be reordered
    expect(headerEl.props.draggable).toBe(true)
    // Content body must exist (owns the card list)
    expect(contentEl).toBeDefined()
  })

  it('routes onDragStart from the header to the column drag handler', () => {
    const onColumnDragStart = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = KanbanColumn({ ...baseProps, onColumnDragStart } as any) as ReactElement<{ children: any[] }>
    const [headerEl] = element.props.children
    const fakeEvent = { dataTransfer: { effectAllowed: 'none', setData: vi.fn() } }
    headerEl.props.onDragStart(fakeEvent)
    expect(onColumnDragStart).toHaveBeenCalledWith(fakeEvent, 'review')
  })
})

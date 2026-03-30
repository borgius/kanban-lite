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

type KanbanColumnProps = Parameters<typeof KanbanColumn>[0]

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

  it('still routes column drag events through the reorder handlers when a column drag is already active', () => {
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
      draggedColumnId: 'todo',
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
      dataTransfer: {
        types: ['text/plain'],
        getData: vi.fn(() => ''),
      },
      stopPropagation: vi.fn(),
    }
    const dropEvent = {
      dataTransfer: {
        types: ['text/plain'],
        getData: vi.fn(() => ''),
      },
      stopPropagation: vi.fn(),
    }

    minimizedRail.props.onDragOver(dragOverEvent)
    minimizedRail.props.onDrop(dropEvent)

    expect(dragOverEvent.stopPropagation).toHaveBeenCalled()
    expect(onColumnDragOver).toHaveBeenCalledWith(dragOverEvent, 1)
    expect(dropEvent.stopPropagation).toHaveBeenCalled()
    expect(onColumnDrop).toHaveBeenCalledWith(dropEvent)
  })
})

describe('KanbanColumn normal-mode header/body structure', () => {
  const baseProps: KanbanColumnProps = {
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
    const element = KanbanColumn(baseProps) as ReactElement<{ children: ReactElement[] }>
    const [headerEl, contentEl] = element.props.children
    // Header must be draggable so columns can be reordered
    expect(headerEl.props.draggable).toBe(true)
    // Content body must exist (owns the card list)
    expect(contentEl).toBeDefined()
  })

  it('routes onDragStart from the header to the column drag handler', () => {
    const onColumnDragStart = vi.fn()
    const element = KanbanColumn({ ...baseProps, onColumnDragStart }) as ReactElement<{ children: ReactElement[] }>
    const [headerEl] = element.props.children
    const fakeEvent = { dataTransfer: { effectAllowed: 'none', setData: vi.fn() } }
    headerEl.props.onDragStart(fakeEvent)
    expect(onColumnDragStart).toHaveBeenCalledWith(fakeEvent, 'review')
  })

  it('forces the column landing border color to blue with a soft glow during column reordering', () => {
    const element = KanbanColumn({
      ...baseProps,
      draggedColumnId: 'todo',
      dropColumnIndex: 0,
    }) as ReactElement<{ style?: { borderLeftColor?: string; boxShadow?: string } }>

    expect(element.props.style?.borderLeftColor).toBe('#3b82f6')
    expect(element.props.style?.boxShadow).toContain('rgba(59,130,246,0.65)')
  })

  it('uses top border highlighting in vertical layout column reorder mode', () => {
    const element = KanbanColumn({
      ...baseProps,
      layout: 'vertical',
      draggedColumnId: 'todo',
      dropColumnIndex: 0,
    }) as ReactElement<{ style?: { borderTopColor?: string; boxShadow?: string }; className?: string }>

    expect(element.props.style?.borderTopColor).toBe('#3b82f6')
    expect(element.props.style?.boxShadow).toContain('rgba(59,130,246,0.65)')
    expect(element.props.className).toContain('border-t-2')
  })
})

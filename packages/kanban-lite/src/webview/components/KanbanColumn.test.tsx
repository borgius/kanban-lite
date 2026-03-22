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

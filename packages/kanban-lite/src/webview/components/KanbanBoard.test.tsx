import { renderToStaticMarkup } from 'react-dom/server'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookRuntime = {
  values: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
  refs: [] as Array<{ current: unknown }>,
  beginRender() {
    this.cursor = 0
    this.effects = []
    this.refs = []
  },
  reset() {
    this.values = []
    this.cursor = 0
    this.effects = []
    this.refs = []
  },
}

const renderedColumnProps: Array<Record<string, unknown>> = []

const storeState = {
  columns: [
    { id: 'todo', name: 'Todo', color: '#3b82f6' },
    { id: 'hidden', name: 'Hidden', color: '#f59e0b' },
    { id: 'done', name: 'Done', color: '#22c55e' },
  ],
  currentBoard: 'board-a',
  cardSettings: {
    showDeletedColumn: false,
    panelMode: 'drawer' as const,
    drawerWidth: 50,
  },
  effectiveDrawerWidth: 50,
  getFilteredCardsByStatus: vi.fn(() => []),
  getCardsByStatus: vi.fn(() => []),
  getHiddenColumnIds: vi.fn(() => ['hidden']),
  getMinimizedColumnIds: vi.fn(() => []),
  toggleColumnMinimized: vi.fn(),
  layout: 'horizontal' as const,
  columnSorts: {},
  setColumnSort: vi.fn(),
}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()

  return {
    ...actual,
    useState<T>(initialState: T | (() => T)) {
      const index = hookRuntime.cursor++
      if (!(index in hookRuntime.values)) {
        hookRuntime.values[index] = typeof initialState === 'function'
          ? (initialState as () => T)()
          : initialState
      }

      const setState = (nextState: T | ((previous: T) => T)) => {
        const previous = hookRuntime.values[index] as T
        hookRuntime.values[index] = typeof nextState === 'function'
          ? (nextState as (previous: T) => T)(previous)
          : nextState
      }

      return [hookRuntime.values[index] as T, setState] as const
    },
    useEffect(effect: () => void | (() => void)) {
      hookRuntime.cursor++
      hookRuntime.effects.push(effect)
    },
    useRef<T>(initialValue: T) {
      const index = hookRuntime.cursor++
      if (!(index in hookRuntime.values)) {
        hookRuntime.values[index] = { current: initialValue }
      }
      const ref = hookRuntime.values[index] as { current: T }
      hookRuntime.refs.push(ref as { current: unknown })
      return ref
    },
    useCallback<T extends (...args: never[]) => unknown>(callback: T) {
      hookRuntime.cursor++
      return callback
    },
  }
})

vi.mock('lucide-react', () => ({
  Columns: () => null,
}))

vi.mock('./KanbanColumn', () => ({
  KanbanColumn: (props: Record<string, unknown>) => {
    renderedColumnProps.push(props)
    return null
  },
}))

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()

  const useStore = Object.assign((selector: (state: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  })

  return { ...actual, useStore }
})

import { KanbanBoard } from './KanbanBoard'

type KanbanBoardProps = React.ComponentProps<typeof KanbanBoard>

function renderBoard(propOverrides: Partial<KanbanBoardProps> = {}) {
  renderedColumnProps.length = 0
  hookRuntime.beginRender()
  const markup = renderToStaticMarkup(
    <KanbanBoard
      onCardClick={() => {}}
      onAddCard={() => {}}
      onMoveCard={() => {}}
      onMoveCards={() => {}}
      onEditColumn={() => {}}
      onRemoveColumn={() => {}}
      onCleanupColumn={() => {}}
      onPurgeDeletedCards={() => {}}
      onReorderColumns={onReorderColumnsSpy}
      selectedCardIds={[]}
      onSelectAll={() => {}}
      {...propOverrides}
    />
  )

  return {
    columns: [...renderedColumnProps],
    effects: [...hookRuntime.effects],
    refs: [...hookRuntime.refs],
    markup,
  }
}

const onReorderColumnsSpy = vi.fn<(columnIds: string[]) => void>()

beforeEach(() => {
  hookRuntime.reset()
  renderedColumnProps.length = 0
  onReorderColumnsSpy.mockReset()
  storeState.cardSettings.panelMode = 'drawer'
  storeState.cardSettings.drawerWidth = 50
  storeState.effectiveDrawerWidth = 50
  storeState.layout = 'horizontal'
  storeState.getFilteredCardsByStatus.mockClear()
  storeState.getCardsByStatus.mockClear()
  storeState.getHiddenColumnIds.mockClear()
  storeState.getMinimizedColumnIds.mockClear()
  storeState.toggleColumnMinimized.mockClear()
  storeState.setColumnSort.mockClear()
})

describe('KanbanBoard hidden column reorder behavior', () => {
  it('keeps hidden columns out of the rendered board while preserving them in reorder callbacks', () => {
    const { columns: initialColumns } = renderBoard()

    expect(initialColumns.map((props) => props.column && (props.column as { id: string }).id)).toEqual(['todo', 'done'])

    const doneColumn = initialColumns[1]
    doneColumn.onColumnDragStart?.({
      dataTransfer: {
        effectAllowed: 'none',
        setData: vi.fn(),
      },
    }, 'done')

    const { columns: draggedColumns } = renderBoard()
    draggedColumns[0].onColumnDragOver?.({
      preventDefault: vi.fn(),
      clientX: 0,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 100, width: 80 }),
      },
      dataTransfer: {
        dropEffect: 'none',
      },
    }, 0)

    const { columns: dropReadyColumns } = renderBoard()
    dropReadyColumns[0].onColumnDrop?.({
      preventDefault: vi.fn(),
    })

    expect(onReorderColumnsSpy).toHaveBeenCalledWith(['done', 'hidden', 'todo'])
  })

  it('does not apply inline padding-right to the board scroll container (width is now constrained by App.tsx)', () => {
    storeState.cardSettings.drawerWidth = 50
    storeState.effectiveDrawerWidth = 72

    const { markup } = renderBoard({ selectedCardId: 'card-1' })

    expect(markup).not.toContain('padding-right')
  })

  it('uses the effective drawer width when scrolling a selected card into view', () => {
    storeState.cardSettings.drawerWidth = 50
    storeState.effectiveDrawerWidth = 70

    // Simulate a pre-narrowed board container: App.tsx sets the container to
    // (100 - 70)% = 30% of a 1000px viewport, so containerRect.right = 300.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        callback()
      }
      return 1 as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    const scrollBy = vi.fn()

    const { effects, refs } = renderBoard({ selectedCardId: 'card-1' })

    refs[0].current = {
      getBoundingClientRect: () => ({ left: 0, right: 300 }),
      querySelector: () => ({
        getBoundingClientRect: () => ({ left: 600, right: 750 }),
      }),
      scrollBy,
    }

    const cleanup = effects[0]?.()

    expect(scrollBy).toHaveBeenCalledWith({ left: 460, behavior: 'smooth' })

    cleanup?.()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(1)

    setTimeoutSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
  })
})

describe('KanbanBoard minimized column prop propagation', () => {
  it('passes isMinimized=true only to columns present in the minimized set', () => {
    storeState.getMinimizedColumnIds.mockReturnValueOnce(['todo'])
    const { columns } = renderBoard()
    const todoProps = columns.find((p) => (p.column as { id: string }).id === 'todo')
    const doneProps = columns.find((p) => (p.column as { id: string }).id === 'done')
    expect(todoProps?.isMinimized).toBe(true)
    expect(doneProps?.isMinimized).toBe(false)
  })

  it('renders all visible (non-hidden) columns regardless of minimized state', () => {
    storeState.getMinimizedColumnIds.mockReturnValueOnce(['todo'])
    const { columns } = renderBoard()
    const ids = columns.map((p) => (p.column as { id: string }).id)
    expect(ids).toEqual(['todo', 'done'])
  })
})

describe('KanbanBoard scroll container structure', () => {
  it('wraps columns in a horizontal overflow-scroll container with a min-width flex row', () => {
    const { markup } = renderBoard()
    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('min-w-max')
  })
})

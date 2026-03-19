import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookRuntime = {
  values: [] as unknown[],
  cursor: 0,
  beginRender() {
    this.cursor = 0
  },
  reset() {
    this.values = []
    this.cursor = 0
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
    useEffect() {},
    useRef<T>(initialValue: T) {
      const index = hookRuntime.cursor++
      if (!(index in hookRuntime.values)) {
        hookRuntime.values[index] = { current: initialValue }
      }
      return hookRuntime.values[index] as { current: T }
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

function renderBoard() {
  renderedColumnProps.length = 0
  hookRuntime.beginRender()
  renderToStaticMarkup(
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
    />
  )

  return [...renderedColumnProps]
}

const onReorderColumnsSpy = vi.fn<(columnIds: string[]) => void>()

beforeEach(() => {
  hookRuntime.reset()
  renderedColumnProps.length = 0
  onReorderColumnsSpy.mockReset()
  storeState.getFilteredCardsByStatus.mockClear()
  storeState.getCardsByStatus.mockClear()
  storeState.getHiddenColumnIds.mockClear()
  storeState.getMinimizedColumnIds.mockClear()
  storeState.toggleColumnMinimized.mockClear()
  storeState.setColumnSort.mockClear()
})

describe('KanbanBoard hidden column reorder behavior', () => {
  it('keeps hidden columns out of the rendered board while preserving them in reorder callbacks', () => {
    const initialColumns = renderBoard()

    expect(initialColumns.map((props) => props.column && (props.column as { id: string }).id)).toEqual(['todo', 'done'])

    const doneColumn = initialColumns[1]
    doneColumn.onColumnDragStart?.({
      dataTransfer: {
        effectAllowed: 'none',
        setData: vi.fn(),
      },
    }, 'done')

    const draggedColumns = renderBoard()
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

    const dropReadyColumns = renderBoard()
    dropReadyColumns[0].onColumnDrop?.({
      preventDefault: vi.fn(),
    })

    expect(onReorderColumnsSpy).toHaveBeenCalledWith(['done', 'hidden', 'todo'])
  })
})

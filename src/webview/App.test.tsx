import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardDisplaySettings, ExtensionMessage } from '../shared/types'

const DEFAULT_CARD_SETTINGS: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  showDeletedColumn: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
  boardZoom: 100,
  cardZoom: 100,
  panelMode: 'drawer',
  drawerWidth: 50,
}

const hookRuntime = {
  values: [] as unknown[],
  deps: [] as Array<unknown[] | undefined>,
  cleanups: [] as Array<(() => void) | undefined>,
  cursor: 0,
  pendingEffects: [] as Array<() => void>,
  beginRender() {
    this.cursor = 0
  },
  flushEffects() {
    const effects = [...this.pendingEffects]
    this.pendingEffects = []
    for (const effect of effects) {
      effect()
    }
  },
  reset() {
    for (const cleanup of this.cleanups) {
      cleanup?.()
    }
    this.values = []
    this.deps = []
    this.cleanups = []
    this.cursor = 0
    this.pendingEffects = []
  },
}

const storeState = {
  columns: [],
  currentBoard: 'default',
  columnVisibilityByBoard: {} as Record<string, { hiddenColumnIds: string[]; minimizedColumnIds: string[] }>,
  workspace: null,
  cardSettings: { ...DEFAULT_CARD_SETTINGS },
  settingsOpen: false,
  selectedCardIds: [] as string[],
  setCards: vi.fn((cards) => {
    storeState.cards = cards
  }),
  setColumns: vi.fn((columns) => {
    storeState.columns = columns
  }),
  setBoards: vi.fn((boards) => {
    storeState.boards = boards
  }),
  setCurrentBoard: vi.fn((boardId) => {
    storeState.currentBoard = boardId
  }),
  setIsDarkMode: vi.fn(),
  setWorkspace: vi.fn((workspace) => {
    storeState.workspace = workspace
  }),
  setCardSettings: vi.fn((cardSettings) => {
    storeState.cardSettings = cardSettings
  }),
  setSettingsOpen: vi.fn((settingsOpen) => {
    storeState.settingsOpen = settingsOpen
  }),
  setLabelDefs: vi.fn(),
  toggleSelectCard: vi.fn(),
  selectCardRange: vi.fn(),
  selectAllInColumn: vi.fn(),
  clearSelection: vi.fn(),
  setActiveCardId: vi.fn(),
  setActiveCardTab: vi.fn(),
  cards: [] as unknown[],
  boards: [] as unknown[],
}

const { postMessageSpy, getStateSpy, setStateSpy } = vi.hoisted(() => ({
  postMessageSpy: vi.fn(),
  getStateSpy: vi.fn<() => unknown>(() => null),
  setStateSpy: vi.fn<(state: unknown) => void>(),
}))
let messageHandler: ((event: MessageEvent<ExtensionMessage>) => void) | null = null

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
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = hookRuntime.cursor++
      const previousDeps = hookRuntime.deps[index]
      const changed = !deps
        || !previousDeps
        || deps.length !== previousDeps.length
        || deps.some((dependency, depIndex) => dependency !== previousDeps[depIndex])

      hookRuntime.deps[index] = deps

      if (!changed) {
        return
      }

      hookRuntime.pendingEffects.push(() => {
        hookRuntime.cleanups[index]?.()
        const cleanup = effect()
        hookRuntime.cleanups[index] = typeof cleanup === 'function' ? cleanup : undefined
      })
    },
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

vi.mock('./store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store')>()

  const storeSetStateSpy = vi.fn((nextState: Partial<typeof storeState> | ((previous: typeof storeState) => Partial<typeof storeState>)) => {
    const resolvedState = typeof nextState === 'function' ? nextState(storeState) : nextState
    Object.assign(storeState, resolvedState)
  })

  const useStore = Object.assign(() => storeState, {
    getState: () => storeState,
    setState: storeSetStateSpy,
  })

  return { ...actual, useStore }
})

vi.mock('./vsCodeApi', () => ({
  getVsCodeApi: () => ({
    postMessage: postMessageSpy,
    getState: getStateSpy,
    setState: setStateSpy,
  }),
}))

vi.mock('./components/KanbanBoard', () => ({ KanbanBoard: () => null }))
vi.mock('./components/CreateCardDialog', () => ({ CreateCardDialog: () => null }))
vi.mock('./components/CardEditor', () => ({ CardEditor: () => null }))
vi.mock('./components/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('./components/SettingsPanel', () => ({ SettingsPanel: () => null }))
vi.mock('./components/ColumnDialog', () => ({ ColumnDialog: () => null }))
vi.mock('./components/BulkActionsBar', () => ({ BulkActionsBar: () => null }))
vi.mock('./components/ShortcutHelp', () => ({ ShortcutHelp: () => null }))
vi.mock('./components/LogsSection', () => ({ LogsSection: () => null }))

import App from './App'

function renderApp() {
  hookRuntime.beginRender()
  const markup = renderToStaticMarkup(<App />)
  hookRuntime.flushEffects()
  return markup
}

function dispatchMessage(message: ExtensionMessage) {
  if (!messageHandler) {
    throw new Error('Expected App to register a message handler before dispatching test messages')
  }

  messageHandler({ data: message } as MessageEvent<ExtensionMessage>)
}

beforeEach(() => {
  postMessageSpy.mockClear()
  messageHandler = null

  Object.assign(storeState, {
    cards: [],
    columns: [],
    boards: [],
    currentBoard: 'default',
    columnVisibilityByBoard: {},
    workspace: null,
    cardSettings: { ...DEFAULT_CARD_SETTINGS },
    settingsOpen: false,
    selectedCardIds: [],
  })

  getStateSpy.mockReset()
  getStateSpy.mockReturnValue(null)
  setStateSpy.mockReset()

  for (const key of Object.keys(storeState) as Array<keyof typeof storeState>) {
    const value = storeState[key]
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear()
    }
  }

  vi.stubGlobal('window', {
    addEventListener: vi.fn((type: string, handler: (event: MessageEvent<ExtensionMessage>) => void) => {
      if (type === 'message') {
        messageHandler = handler
      }
    }),
    removeEventListener: vi.fn((type: string, handler: (event: MessageEvent<ExtensionMessage>) => void) => {
      if (type === 'message' && messageHandler === handler) {
        messageHandler = null
      }
    }),
  })

  vi.stubGlobal('document', {
    body: {
      classList: {
        contains: vi.fn(() => false),
      },
    },
    documentElement: {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
      style: {
        setProperty: vi.fn(),
      },
    },
  })

  vi.stubGlobal('MutationObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  hookRuntime.reset()
  vi.unstubAllGlobals()
})

describe('App connection notices', () => {
  it('renders a reconnecting notice and clears it after init arrives', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]

    expect(renderApp()).not.toContain('Reconnecting…')
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'ready' })

    dispatchMessage({
      type: 'connectionStatus',
      connected: false,
      reconnecting: true,
      fatal: false,
      retryCount: 2,
      maxRetries: 5,
      retryDelayMs: 1000,
      reason: 'socket-closed',
    })

    const reconnectMarkup = renderApp()
    expect(reconnectMarkup).toContain('Reconnecting…')
    expect(reconnectMarkup).toContain('attempt 2 of 5')
    expect(reconnectMarkup).toContain('1s')

    dispatchMessage({ type: 'init' } as ExtensionMessage)

    expect(renderApp()).not.toContain('Reconnecting…')
  })

  it('renders a fatal notice and clears it once connectivity is restored', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]

    renderApp()

    dispatchMessage({
      type: 'connectionStatus',
      connected: false,
      reconnecting: false,
      fatal: true,
      retryCount: 5,
      maxRetries: 5,
      reason: 'socket-closed',
    })

    const fatalMarkup = renderApp()
    expect(fatalMarkup).toContain('Connection lost')
    expect(fatalMarkup).toContain('Refresh or reopen this page')

    dispatchMessage({
      type: 'connectionStatus',
      connected: true,
      reconnecting: false,
      fatal: false,
      retryCount: 0,
      maxRetries: 5,
    })

    expect(renderApp()).not.toContain('Connection lost')
  })

  it('hydrates persisted column visibility for the current board and persists a sanitized payload', () => {
    getStateSpy.mockReturnValue({
      boardA: {
        hiddenColumnIds: ['todo', 'ghost'],
        minimizedColumnIds: ['doing', 'ghost', 'todo'],
      },
      boardB: {
        hiddenColumnIds: ['archive'],
        minimizedColumnIds: [],
      },
    })

    renderApp()

    dispatchMessage({
      type: 'init',
      cards: [],
      columns: [
        { id: 'todo', name: 'Todo', color: '#000000' },
        { id: 'doing', name: 'Doing', color: '#111111' },
      ],
      currentBoard: 'boardA',
    } as ExtensionMessage)

    renderApp()

    expect(storeState.columnVisibilityByBoard).toEqual({
      boardA: {
        hiddenColumnIds: ['todo'],
        minimizedColumnIds: ['doing'],
      },
      boardB: {
        hiddenColumnIds: ['archive'],
        minimizedColumnIds: [],
      },
    })

    expect(setStateSpy).toHaveBeenLastCalledWith({
      boardA: {
        hiddenColumnIds: ['todo'],
        minimizedColumnIds: ['doing'],
      },
      boardB: {
        hiddenColumnIds: ['archive'],
        minimizedColumnIds: [],
      },
    })
  })

  it('preserves unrelated board visibility state when init updates the current board', () => {
    storeState.columnVisibilityByBoard = {
      boardA: {
        hiddenColumnIds: ['todo'],
        minimizedColumnIds: [],
      },
    }

    renderApp()

    dispatchMessage({
      type: 'init',
      cards: [],
      columns: [
        { id: 'doing', name: 'Doing', color: '#111111' },
      ],
      currentBoard: 'boardB',
    } as ExtensionMessage)

    renderApp()

    expect(storeState.columnVisibilityByBoard).toEqual({
      boardA: {
        hiddenColumnIds: ['todo'],
        minimizedColumnIds: [],
      },
    })

    expect(setStateSpy).toHaveBeenLastCalledWith({
      boardA: {
        hiddenColumnIds: ['todo'],
        minimizedColumnIds: [],
      },
    })
  })
})

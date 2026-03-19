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
  workspace: null,
  cardSettings: { ...DEFAULT_CARD_SETTINGS },
  settingsOpen: false,
  selectedCardIds: [] as string[],
  setCards: vi.fn(),
  setColumns: vi.fn(),
  setBoards: vi.fn(),
  setCurrentBoard: vi.fn(),
  setIsDarkMode: vi.fn(),
  setWorkspace: vi.fn(),
  setCardSettings: vi.fn(),
  setSettingsOpen: vi.fn(),
  setLabelDefs: vi.fn(),
  toggleSelectCard: vi.fn(),
  selectCardRange: vi.fn(),
  selectAllInColumn: vi.fn(),
  clearSelection: vi.fn(),
  setActiveCardId: vi.fn(),
  setActiveCardTab: vi.fn(),
}

const postMessageSpy = vi.fn()
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

vi.mock('./store', () => {
  const useStore = Object.assign(() => storeState, {
    getState: () => ({
      cards: [],
      cardSettings: storeState.cardSettings,
      selectedCardIds: [],
    }),
    setState: vi.fn(),
  })

  return { useStore }
})

vi.mock('./vsCodeApi', () => ({
  getVsCodeApi: () => ({
    postMessage: postMessageSpy,
    getState: () => null,
    setState: vi.fn(),
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
    columns: [],
    workspace: null,
    cardSettings: { ...DEFAULT_CARD_SETTINGS },
    settingsOpen: false,
    selectedCardIds: [],
  })

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
})

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BoardInfo,
  Card,
  CardDisplaySettings,
  ExtensionMessage,
  KanbanColumn,
  PluginSettingsInstallTransportResult,
  PluginSettingsPayload,
  PluginSettingsProviderTransport,
  WorkspaceInfo,
} from '../shared/types'

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
  boardBackgroundMode: 'fancy',
  boardBackgroundPreset: 'aurora',
  panelMode: 'drawer',
  drawerWidth: 50,
}

const PLUGIN_SETTINGS_FIXTURE: PluginSettingsPayload = {
  redaction: {
    maskedValue: '••••••',
    writeOnly: true,
    targets: ['read', 'list', 'error'],
  },
  capabilities: [
    {
      capability: 'card.storage',
      selected: {
        capability: 'card.storage',
        providerId: 'markdown',
        source: 'default',
      },
      providers: [
        {
          capability: 'card.storage',
          providerId: 'markdown',
          packageName: 'markdown',
          discoverySource: 'builtin',
          isSelected: true,
        },
        {
          capability: 'card.storage',
          providerId: 'sqlite',
          packageName: 'kl-plugin-storage-sqlite',
          discoverySource: 'workspace',
          isSelected: false,
        },
      ],
    },
    {
      capability: 'auth.identity',
      selected: {
        capability: 'auth.identity',
        providerId: 'local',
        source: 'config',
      },
      providers: [
        {
          capability: 'auth.identity',
          providerId: 'local',
          packageName: 'kl-plugin-auth',
          discoverySource: 'dependency',
          isSelected: true,
        },
      ],
    },
  ],
}

const AUTH_PROVIDER_FIXTURE: PluginSettingsProviderTransport = {
  capability: 'auth.identity',
  providerId: 'local',
  packageName: 'kl-plugin-auth',
  discoverySource: 'dependency',
  selected: {
    capability: 'auth.identity',
    providerId: 'local',
    source: 'config',
  },
  optionsSchema: {
    schema: {
      type: 'object',
      properties: {
        apiToken: { type: 'string', title: 'API token' },
      },
    },
    secrets: [{ path: 'apiToken', redaction: PLUGIN_SETTINGS_FIXTURE.redaction }],
  },
  options: {
    values: { apiToken: '••••••' },
    redactedPaths: ['apiToken'],
    redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
  },
}

const INSTALL_RESULT_FIXTURE: PluginSettingsInstallTransportResult = {
  packageName: 'kl-plugin-auth',
  scope: 'global',
  command: {
    command: 'npm',
    args: ['install', '--global', '--ignore-scripts', 'kl-plugin-auth'],
    cwd: '/tmp/workspace',
    shell: false,
  },
  stdout: '',
  stderr: '',
  message: 'Installed plugin package with lifecycle scripts disabled.',
  redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
}

const PLUGIN_SETTINGS_AFTER_RESELECTION: PluginSettingsPayload = {
  ...PLUGIN_SETTINGS_FIXTURE,
  capabilities: [
    {
      capability: 'card.storage',
      selected: {
        capability: 'card.storage',
        providerId: 'sqlite',
        source: 'config',
      },
      providers: [
        {
          capability: 'card.storage',
          providerId: 'markdown',
          packageName: 'markdown',
          discoverySource: 'builtin',
          isSelected: false,
        },
        {
          capability: 'card.storage',
          providerId: 'sqlite',
          packageName: 'kl-plugin-storage-sqlite',
          discoverySource: 'workspace',
          isSelected: true,
        },
      ],
    },
  ],
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
  columns: [] as KanbanColumn[],
  currentBoard: 'default',
  columnVisibilityByBoard: {} as Record<string, { hiddenColumnIds: string[]; minimizedColumnIds: string[] }>,
  workspace: null as WorkspaceInfo | null,
  cardSettings: { ...DEFAULT_CARD_SETTINGS },
  drawerWidthPreview: null as number | null,
  effectiveDrawerWidth: 50,
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
    storeState.effectiveDrawerWidth = storeState.drawerWidthPreview ?? cardSettings.drawerWidth ?? 50
  }),
  setDrawerWidthPreview: vi.fn((width) => {
    storeState.drawerWidthPreview = width
    storeState.effectiveDrawerWidth = width
  }),
  clearDrawerWidthPreview: vi.fn(() => {
    storeState.drawerWidthPreview = null
    storeState.effectiveDrawerWidth = storeState.cardSettings.drawerWidth ?? 50
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
  cards: [] as Card[],
  boards: [] as BoardInfo[],
}

const { postMessageSpy, getStateSpy, setStateSpy, resizePropsRef, cardEditorPropsRef, settingsPanelSpy } = vi.hoisted(() => ({
  postMessageSpy: vi.fn(),
  getStateSpy: vi.fn<() => unknown>(() => null),
  setStateSpy: vi.fn<(state: unknown) => void>(),
  resizePropsRef: { current: null as null | { panelMode: string; onPreview: (width: number) => void; onCommit: (width: number) => void; onCancel: () => void } },
  cardEditorPropsRef: { current: null as null | Record<string, unknown> },
  settingsPanelSpy: vi.fn<(props: Record<string, unknown>) => void>(),
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
vi.mock('./components/CardEditor', () => ({
  CardEditor: (props: Record<string, unknown>) => {
    cardEditorPropsRef.current = props
    return null
  },
}))
vi.mock('./components/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('./components/SettingsPanel', () => ({
  SettingsPanel: (props: Record<string, unknown>) => {
    settingsPanelSpy(props)
    return null
  },
}))
vi.mock('./components/ColumnDialog', () => ({ ColumnDialog: () => null }))
vi.mock('./components/BulkActionsBar', () => ({ BulkActionsBar: () => null }))
vi.mock('./components/ShortcutHelp', () => ({ ShortcutHelp: () => null }))
vi.mock('./components/LogsSection', () => ({ LogsSection: () => null }))
vi.mock('./components/DrawerResizeHandle', async () => {
  const { createElement } = await import('react')
  return {
    DrawerResizeHandle: (props: { panelMode: string; onPreview: (width: number) => void; onCommit: (width: number) => void; onCancel: () => void }) => {
      resizePropsRef.current = props
      return props.panelMode === 'drawer' ? createElement('button', { 'data-panel-resize-handle': '' }) : null
    },
  }
})

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
  resizePropsRef.current = null
  cardEditorPropsRef.current = null
  settingsPanelSpy.mockClear()

  Object.assign(storeState, {
    cards: [],
    columns: [],
    boards: [],
    currentBoard: 'default',
    columnVisibilityByBoard: {},
    workspace: null,
    cardSettings: { ...DEFAULT_CARD_SETTINGS },
    drawerWidthPreview: null,
    effectiveDrawerWidth: 50,
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
      dataset: {},
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
      settings: { ...DEFAULT_CARD_SETTINGS },
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
      settings: { ...DEFAULT_CARD_SETTINGS },
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

  it('renders a resize handle for the board logs drawer in drawer mode', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]
    hookRuntime.values[6] = true

    const markup = renderApp()

    expect(markup).toContain('data-panel-drawer')
    expect(markup).toContain('data-panel-resize-handle')
  })

  it('does not render a resize handle for the card editor in popup mode', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]
    storeState.cardSettings = {
      ...DEFAULT_CARD_SETTINGS,
      panelMode: 'popup',
    }
    hookRuntime.values[6] = {
      id: 'card-1',
      content: '# Card',
      frontmatter: { status: 'backlog' },
      comments: [],
      logs: [],
      contentVersion: 1,
    }

    const markup = renderApp()

    expect(markup).not.toContain('data-panel-drawer')
    expect(markup).not.toContain('data-panel-resize-handle')
  })

  it('syncs the dark theme state onto the root dataset for background presets', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]
    const bodyContains = vi.fn((className: string) => className === 'vscode-dark')
    const rootDataset = {} as Record<string, string>

    vi.stubGlobal('document', {
      body: {
        classList: {
          contains: bodyContains,
        },
      },
      documentElement: {
        dataset: rootDataset,
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
        style: {
          setProperty: vi.fn(),
        },
      },
    })

    renderApp()

    expect(storeState.setIsDarkMode).toHaveBeenCalledWith(true)
    expect(rootDataset.kbTheme).toBe('dark')
    expect(rootDataset.kbBoardMode).toBe('fancy')
    expect(rootDataset.kbBoardPreset).toBe('aurora')
  })
})

describe('App resize preview and commit timing', () => {
  it('preview updates the in-memory drawer width without posting saveSettings', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]
    hookRuntime.values[6] = true // editingCard truthy → drawer panel renders

    renderApp()

    expect(resizePropsRef.current).not.toBeNull()
    postMessageSpy.mockClear()

    resizePropsRef.current!.onPreview(65)

    expect(storeState.setDrawerWidthPreview).toHaveBeenCalledWith(65)
    expect(postMessageSpy).not.toHaveBeenCalled()
  })

  it('commit saves settings exactly once and clears the in-memory preview', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]
    hookRuntime.values[6] = true // editingCard truthy → drawer panel renders

    renderApp()

    expect(resizePropsRef.current).not.toBeNull()
    postMessageSpy.mockClear()

    resizePropsRef.current!.onCommit(65)

    expect(storeState.clearDrawerWidthPreview).toHaveBeenCalledTimes(1)
    expect(storeState.setCardSettings).toHaveBeenCalledWith(
      expect.objectContaining({ drawerWidth: 65 }),
    )
    expect(postMessageSpy).toHaveBeenCalledTimes(1)
    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'saveSettings',
      settings: expect.objectContaining({ drawerWidth: 65 }),
    })
  })
})

describe('App plugin settings bridge', () => {
  it('passes plugin inventory into the settings panel and routes read, select, update, and install actions through the shared bridge', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]

    renderApp()

    dispatchMessage({
      type: 'showSettings',
      settings: { ...DEFAULT_CARD_SETTINGS },
      pluginSettings: PLUGIN_SETTINGS_FIXTURE,
    })

    renderApp()

    const latestSettingsPanelProps = settingsPanelSpy.mock.lastCall?.[0] as Record<string, unknown> | undefined

    expect(latestSettingsPanelProps).toMatchObject({
      isOpen: true,
      pluginSettings: PLUGIN_SETTINGS_FIXTURE,
      pluginSettingsProvider: null,
      pluginSettingsInstall: null,
      pluginSettingsError: null,
    })

    postMessageSpy.mockClear()
    ;(latestSettingsPanelProps?.onReadPluginSettingsProvider as ((capability: string, providerId: string) => void) | undefined)?.('auth.identity', 'local')

    expect(postMessageSpy).toHaveBeenNthCalledWith(1, {
      type: 'readPluginSettings',
      capability: 'auth.identity',
      providerId: 'local',
    })

    ;(latestSettingsPanelProps?.onSelectPluginSettingsProvider as ((capability: string, providerId: string) => void) | undefined)?.('card.storage', 'sqlite')

    expect(postMessageSpy).toHaveBeenNthCalledWith(2, {
      type: 'selectPluginSettingsProvider',
      capability: 'card.storage',
      providerId: 'sqlite',
    })

    ;(latestSettingsPanelProps?.onUpdatePluginSettingsOptions as ((capability: string, providerId: string, options: Record<string, unknown>) => void) | undefined)?.('auth.identity', 'local', { apiToken: '••••••' })

    expect(postMessageSpy).toHaveBeenNthCalledWith(3, {
      type: 'updatePluginSettingsOptions',
      capability: 'auth.identity',
      providerId: 'local',
      options: { apiToken: '••••••' },
    })

    ;(latestSettingsPanelProps?.onInstallPluginSettingsPackage as ((packageName: string, scope: 'workspace' | 'global') => void) | undefined)?.('kl-plugin-auth', 'global')

    expect(postMessageSpy).toHaveBeenNthCalledWith(4, {
      type: 'installPluginSettingsPackage',
      packageName: 'kl-plugin-auth',
      scope: 'global',
    })

    dispatchMessage({
      type: 'pluginSettingsResult',
      action: 'read',
      pluginSettings: PLUGIN_SETTINGS_FIXTURE,
      provider: AUTH_PROVIDER_FIXTURE,
    })

    renderApp()

    const readSettingsPanelProps = settingsPanelSpy.mock.lastCall?.[0] as Record<string, unknown> | undefined

    expect(readSettingsPanelProps).toMatchObject({
      pluginSettingsProvider: AUTH_PROVIDER_FIXTURE,
      pluginSettingsInstall: null,
      pluginSettingsError: null,
    })

    dispatchMessage({
      type: 'pluginSettingsResult',
      action: 'select',
      pluginSettings: PLUGIN_SETTINGS_AFTER_RESELECTION,
      provider: AUTH_PROVIDER_FIXTURE,
    })

    renderApp()

    const nextSettingsPanelProps = settingsPanelSpy.mock.lastCall?.[0] as Record<string, unknown> | undefined

    expect(nextSettingsPanelProps).toMatchObject({
      pluginSettings: PLUGIN_SETTINGS_AFTER_RESELECTION,
      pluginSettingsProvider: AUTH_PROVIDER_FIXTURE,
      pluginSettingsInstall: null,
      pluginSettingsError: null,
    })

    dispatchMessage({
      type: 'pluginSettingsResult',
      action: 'install',
      pluginSettings: PLUGIN_SETTINGS_AFTER_RESELECTION,
      provider: null,
      install: INSTALL_RESULT_FIXTURE,
    })

    renderApp()

    const installSettingsPanelProps = settingsPanelSpy.mock.lastCall?.[0] as Record<string, unknown> | undefined

    expect(installSettingsPanelProps).toMatchObject({
      pluginSettingsInstall: INSTALL_RESULT_FIXTURE,
      pluginSettingsProvider: null,
      pluginSettingsError: null,
    })

    dispatchMessage({
      type: 'pluginSettingsResult',
      action: 'install',
      error: {
        code: 'invalid-plugin-install-package-name',
        message: 'Use an exact package name like kl-plugin-auth.',
        redaction: PLUGIN_SETTINGS_FIXTURE.redaction,
      },
    })

    renderApp()

    const errorSettingsPanelProps = settingsPanelSpy.mock.lastCall?.[0] as Record<string, unknown> | undefined

    expect(errorSettingsPanelProps?.pluginSettingsError).toBe('Use an exact package name like kl-plugin-auth.')
    expect(errorSettingsPanelProps?.pluginSettingsInstall).toBeNull()
  })
})

describe('App live card refresh', () => {
  it('hydrates an already-open card from init payload updates', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]

    renderApp()

    dispatchMessage({
      type: 'cardContent',
      cardId: 'card-1',
      content: '# Old title',
      frontmatter: {
        version: 1,
        id: 'card-1',
        status: 'backlog',
        priority: 'low',
        assignee: null,
        dueDate: null,
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        labels: [],
        attachments: [],
        order: 'a0',
      },
      comments: [],
      logs: [],
    })

    renderApp()

    dispatchMessage({
      type: 'init',
      cards: [{
        version: 1,
        id: 'card-1',
        status: 'review',
        priority: 'high',
        assignee: 'alice',
        dueDate: null,
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        labels: ['ops'],
        attachments: [],
        comments: [{ id: 'c1', author: 'bot', created: '2024-01-02T00:00:00.000Z', content: 'Synced from server' }],
        order: 'a0',
        content: '# New title',
        filePath: '/tmp/card-1.md',
      }],
      columns: [{ id: 'todo', name: 'Todo', color: '#000000' }],
      settings: { ...DEFAULT_CARD_SETTINGS },
    })

    renderApp()

    expect(hookRuntime.values[6]).toMatchObject({
      content: '# New title',
      comments: [{ id: 'c1', author: 'bot', created: '2024-01-02T00:00:00.000Z', content: 'Synced from server' }],
      frontmatter: expect.objectContaining({
        status: 'review',
        priority: 'high',
        assignee: 'alice',
        labels: ['ops'],
      }),
    })
  })

  it('hydrates an already-open card from cardsUpdated payloads', () => {
    storeState.columns = [{ id: 'todo', name: 'Todo', color: '#000000' }]
    hookRuntime.values[6] = {
      id: 'card-2',
      content: '# Existing',
      frontmatter: {
        version: 1,
        id: 'card-2',
        status: 'backlog',
        priority: 'medium',
        assignee: null,
        dueDate: null,
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        labels: [],
        attachments: [],
        order: 'a0',
      },
      comments: [],
      logs: [{ timestamp: '2024-01-01T00:00:00.000Z', source: 'test', text: 'keep me' }],
      contentVersion: 2,
    }

    renderApp()

    dispatchMessage({
      type: 'cardsUpdated',
      cards: [{
        version: 1,
        id: 'card-2',
        status: 'in-progress',
        priority: 'medium',
        assignee: null,
        dueDate: null,
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-03T00:00:00.000Z',
        completedAt: null,
        labels: [],
        attachments: [],
        comments: [{ id: 'c2', author: 'api', created: '2024-01-03T00:00:00.000Z', content: 'Added externally' }],
        order: 'a0',
        content: '# Existing',
        filePath: '/tmp/card-2.md',
      }],
    })

    renderApp()

    expect(hookRuntime.values[6]).toMatchObject({
      comments: [{ id: 'c2', author: 'api', created: '2024-01-03T00:00:00.000Z', content: 'Added externally' }],
      logs: [{ timestamp: '2024-01-01T00:00:00.000Z', source: 'test', text: 'keep me' }],
      frontmatter: expect.objectContaining({
        status: 'in-progress',
        modified: '2024-01-03T00:00:00.000Z',
      }),
    })
  })
})

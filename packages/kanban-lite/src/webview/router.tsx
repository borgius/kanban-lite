/**
 * TanStack Router setup for the standalone web mode.
 *
 * URL schema:
 *   /<boardId>/<cardId>/<tabId>?priority=&labels=&assignee=&dueDate=&q=
 *   /settings/<general>
 *   /settings/board/<defaults|title|actions|labels|meta>
 *   /settings/plugins/<pluginId>
 *
 * Architecture:
 *  - rootRoute renders <App /> + <URLSync /> + <Outlet />
 *  - boardRoute / cardRoute / tabRoute extend the URL (nested paths)
 *  - settingsRoute / settingsBoardRoute / settingsTabRoute / settingsPluginIdRoute handle settings URLs
 *  - URLSync is the single bridge between the URL and Zustand store
 *
 * The Zustand store is always the source of truth for UI state.
 * URLSync only has TWO jobs:
 *   1. On mount: read URL params and initialize the store / open the correct card.
 *   2. After init: keep URL in sync with store changes (store → URL).
 */

import { useEffect, useRef } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import App from './App'
import { useStore, type DueDateFilter, isCardTabRouteCandidate, normalizeCardTab } from './store'
import type { Priority } from '../shared/types'
import {
  BOARD_SETTINGS_TAB_FROM_SLUG,
  BOARD_SETTINGS_TAB_TO_SLUG,
  DEFAULT_BOARD_SUBTAB,
  LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG,
  SETTINGS_TAB_FROM_SLUG,
  SETTINGS_TAB_TO_SLUG,
} from './settingsTabs'
import { shouldUseMemoryHistory } from './routerHistory'
import { buildSearchStr, parseRouteBoolean, validateSearch, type RouteSearch } from './routerSearch'

// ---------------------------------------------------------------------------
// vscode API (singleton so acquireVsCodeApi is called exactly once per page)
// ---------------------------------------------------------------------------
import { getVsCodeApi } from './vsCodeApi'
const vscode = getVsCodeApi()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']
const VALID_DUE_DATES: DueDateFilter[] = ['overdue', 'today', 'this-week', 'no-date']

// ---------------------------------------------------------------------------
// URLSync component — renders null, only has side-effects
// ---------------------------------------------------------------------------
function URLSync() {
  const navigate = useNavigate()
  // Use strict:false so we get params from any matched route in the tree
  const params = useParams({ strict: false }) as {
    boardId?: string
    cardId?: string
    tabId?: string
    settingsTab?: string
    boardSettingsTab?: string
    pluginId?: string
  }
  const search = useSearch({ strict: false }) as RouteSearch

  const {
    setPriorityFilter,
    setAssigneeFilter,
    setLabelFilter,
    setDueDateFilter,
    setSearchQuery,
    setFuzzySearch,
    setActiveCardTab,
    setSettingsOpen,
    setSettingsTab,
    setSettingsPluginId,
    setSettingsBoardSubTab,
  } = useStore.getState()

  const columns = useStore(s => s.columns)
  const currentBoard = useStore(s => s.currentBoard)
  const activeCardId = useStore(s => s.activeCardId)
  const activeCardTab = useStore(s => s.activeCardTab)
  const priorityFilter = useStore(s => s.priorityFilter)
  const assigneeFilter = useStore(s => s.assigneeFilter)
  const labelFilter = useStore(s => s.labelFilter)
  const dueDateFilter = useStore(s => s.dueDateFilter)
  const searchQuery = useStore(s => s.searchQuery)
  const fuzzySearch = useStore(s => s.fuzzySearch)
  const settingsOpen = useStore(s => s.settingsOpen)
  const settingsTab = useStore(s => s.settingsTab)
  const settingsPluginId = useStore(s => s.settingsPluginId)
  const settingsBoardSubTab = useStore(s => s.settingsBoardSubTab)

  // Detect initial settings route from URL params
  const initialSettingsTabResolved = params.pluginId
    ? 'pluginOptions'
    : params.boardSettingsTab
      ? 'board'
      : params.settingsTab
        ? SETTINGS_TAB_FROM_SLUG[params.settingsTab]
        : undefined
  const initialBoardSettingsTabResolved = params.boardSettingsTab
    ? BOARD_SETTINGS_TAB_FROM_SLUG[params.boardSettingsTab]
    : params.settingsTab
      ? LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG[params.settingsTab]
      : undefined
  const isInitialSettings = Boolean(initialSettingsTabResolved)

  // Initialise prevStateRef from current URL (not store defaults) to prevent
  // spurious navigation on the first Store→URL effect run.
  const initialStore = useStore.getState()
  const prevStateRef = useRef({
    board: params.boardId ?? initialStore.currentBoard,
    cardId: '', // card opens asynchronously, start empty
    tab: normalizeCardTab(params.tabId ?? initialStore.activeCardTab),
    searchStr: buildSearchStr(search),
    settingsOpen: isInitialSettings,
    settingsTab: isInitialSettings
      ? SETTINGS_TAB_TO_SLUG[initialSettingsTabResolved ?? 'general']
      : 'general',
    settingsPluginId: params.pluginId ?? null,
    settingsBoardSubTab: BOARD_SETTINGS_TAB_TO_SLUG[initialBoardSettingsTabResolved ?? initialStore.settingsBoardSubTab ?? DEFAULT_BOARD_SUBTAB],
  })

  // ── 1. URL → Store: one-time initialisation on mount ──────────────────────
  const urlInitialized = useRef(false)
  const pendingCardIdRef = useRef<string | null>(params.cardId ?? null)

  useEffect(() => {
    if (urlInitialized.current) return
    urlInitialized.current = true

    // Restore filters from URL
    if (search.priority && (VALID_PRIORITIES as string[]).includes(search.priority)) {
      setPriorityFilter(search.priority as Priority)
    }
    if (search.labels) {
      setLabelFilter(search.labels.split(',').filter(Boolean))
    }
    if (search.assignee) {
      setAssigneeFilter(search.assignee)
    }
    if (search.dueDate && (VALID_DUE_DATES as string[]).includes(search.dueDate)) {
      setDueDateFilter(search.dueDate as DueDateFilter)
    }
    if (search.q) {
      setSearchQuery(decodeURIComponent(search.q))
    }
    const fuzzyFromUrl = parseRouteBoolean(search.fuzzy)
    if (fuzzyFromUrl !== undefined) {
      setFuzzySearch(fuzzyFromUrl)
    }

    // Restore active tab
    if (params.tabId && isCardTabRouteCandidate(params.tabId)) {
      setActiveCardTab(params.tabId)
    }

    // Restore settings state from URL
    if (params.pluginId) {
      setSettingsOpen(true)
      setSettingsTab('pluginOptions')
      setSettingsPluginId(params.pluginId)
    } else if (params.boardSettingsTab) {
      const resolvedBoardSettingsTab = BOARD_SETTINGS_TAB_FROM_SLUG[params.boardSettingsTab]
      if (resolvedBoardSettingsTab) {
        setSettingsOpen(true)
        setSettingsTab('board')
        setSettingsPluginId(null)
        setSettingsBoardSubTab(resolvedBoardSettingsTab)
      }
    } else if (params.settingsTab) {
      const legacyBoardSettingsTab = LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG[params.settingsTab]
      if (legacyBoardSettingsTab) {
        setSettingsOpen(true)
        setSettingsTab('board')
        setSettingsPluginId(null)
        setSettingsBoardSubTab(legacyBoardSettingsTab)
        return
      }

      const resolved = SETTINGS_TAB_FROM_SLUG[params.settingsTab]
      if (resolved) {
        setSettingsOpen(true)
        setSettingsTab(resolved)
        setSettingsPluginId(null)
      }
    }

    // Switch to the board from the URL (shim queues the message if not yet connected)
    if (params.boardId) {
      vscode.postMessage({ type: 'switchBoard', boardId: params.boardId })
    }
    // pendingCardIdRef already set from params.cardId during ref init
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Open pending card once columns are loaded ───────────────────────────
  const columnsLoadedRef = useRef(false)
  useEffect(() => {
    if (columnsLoadedRef.current || columns.length === 0) return
    columnsLoadedRef.current = true
    if (pendingCardIdRef.current) {
      vscode.postMessage({ type: 'openCard', cardId: pendingCardIdRef.current })
      pendingCardIdRef.current = null
    }
  }, [columns])

  // ── 3a. Settings URL sync — runs independently of column loading ─────────
  useEffect(() => {
    if (!settingsOpen) return
    const tabSlug = SETTINGS_TAB_TO_SLUG[settingsTab] ?? 'general'
    const boardSettingsTabSlug = BOARD_SETTINGS_TAB_TO_SLUG[settingsBoardSubTab] ?? DEFAULT_BOARD_SUBTAB
    const prev = prevStateRef.current
    const justOpened = !prev.settingsOpen
    const tabChanged = prev.settingsTab !== tabSlug
    const pluginChanged = prev.settingsPluginId !== settingsPluginId
    const boardSettingsTabChanged = settingsTab === 'board' && prev.settingsBoardSubTab !== boardSettingsTabSlug

    if (!justOpened && !tabChanged && !pluginChanged && !boardSettingsTabChanged) return

    prevStateRef.current = {
      ...prev,
      settingsOpen: true,
      settingsTab: tabSlug,
      settingsPluginId: settingsPluginId,
      settingsBoardSubTab: boardSettingsTabSlug,
    }

    if (settingsTab === 'pluginOptions' && settingsPluginId) {
      navigate({
        to: '/settings/plugins/$pluginId',
        params: { pluginId: settingsPluginId },
        replace: !justOpened,
      })
    } else if (settingsTab === 'board') {
      navigate({
        to: '/settings/board/$boardSettingsTab',
        params: { boardSettingsTab: boardSettingsTabSlug },
        replace: !justOpened,
      })
    } else {
      navigate({
        to: '/settings/$settingsTab',
        params: { settingsTab: tabSlug },
        replace: !justOpened,
      })
    }
  }, [settingsOpen, settingsTab, settingsPluginId, settingsBoardSubTab, navigate])

  // ── 3b. Board URL sync — waits for columns ────────────────────────────────
  const firstNavRef = useRef(true)

  useEffect(() => {
    if (columns.length === 0) return // wait for server init
    if (settingsOpen) return // settings URL handled above

    // ── Settings just closed — force board navigation ──────────────────────
    const settingsJustClosed = prevStateRef.current.settingsOpen
    if (settingsJustClosed) {
      prevStateRef.current = {
        ...prevStateRef.current,
        settingsOpen: false,
        settingsTab: 'general',
        settingsPluginId: null,
      }
    }

    // ── Board URL sync ─────────────────────────────────────────────────────
    const searchObj: RouteSearch = {}
    if (priorityFilter !== 'all') searchObj.priority = priorityFilter
    if (labelFilter.length > 0) searchObj.labels = labelFilter.join(',')
    if (assigneeFilter !== 'all') searchObj.assignee = assigneeFilter
    if (dueDateFilter !== 'all') searchObj.dueDate = dueDateFilter
    if (searchQuery) searchObj.q = searchQuery
    if (fuzzySearch) searchObj.fuzzy = 'true'

    const searchStr = buildSearchStr(searchObj)
    const prev = prevStateRef.current

    const boardChanged = prev.board !== currentBoard
    const cardChanged = prev.cardId !== (activeCardId ?? '')
    // Tab only matters when a card is open
    const tabChanged = Boolean(activeCardId) && prev.tab !== activeCardTab
    const filterChanged = prev.searchStr !== searchStr

    if (!settingsJustClosed && !boardChanged && !cardChanged && !tabChanged && !filterChanged) return

    prevStateRef.current = {
      ...prevStateRef.current,
      board: currentBoard,
      cardId: activeCardId ?? '',
      tab: activeCardTab,
      searchStr,
    }

    // First navigation after server init: use replace to avoid duplicate history entry.
    const replace = firstNavRef.current || (!settingsJustClosed && !boardChanged && !cardChanged && !tabChanged && filterChanged)
    firstNavRef.current = false

    if (activeCardId) {
      navigate({
        to: '/$boardId/$cardId/$tabId',
        params: { boardId: currentBoard, cardId: activeCardId, tabId: activeCardTab },
        search: searchObj,
        replace,
      })
    } else {
      navigate({
        to: '/$boardId',
        params: { boardId: currentBoard },
        search: searchObj,
        replace,
      })
    }
  }, [columns.length, currentBoard, activeCardId, activeCardTab, priorityFilter, assigneeFilter, labelFilter, dueDateFilter, searchQuery, fuzzySearch, settingsOpen, navigate])

  return null
}

// ---------------------------------------------------------------------------
// Root layout — always rendered regardless of the matched child route
// ---------------------------------------------------------------------------
function RootLayout() {
  return (
    <>
      <App />
      <URLSync />
      <Outlet />
    </>
  )
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------
const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => null,
})

// "/" — handles bare root navigation; URLSync will push to /$boardId on init
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => null,
})

// "/$boardId" — board-only view
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$boardId',
  validateSearch,
  component: () => <Outlet />,
})

// "/$boardId/$cardId" — board with card editor open
const cardRoute = createRoute({
  getParentRoute: () => boardRoute,
  path: '$cardId',
  validateSearch,
  component: () => <Outlet />,
})

// "/$boardId/$cardId/$tabId" — board + card + active tab
const tabRoute = createRoute({
  getParentRoute: () => cardRoute,
  path: '$tabId',
  validateSearch,
  component: () => null,
})

// ---------------------------------------------------------------------------
// Settings routes
// ---------------------------------------------------------------------------

// "/settings" — settings layout
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: () => <Outlet />,
})

// "/settings/" — redirect to /settings/general
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/$settingsTab', params: { settingsTab: 'general' } })
  },
  component: () => null,
})

// "/settings/board" — board settings layout
const settingsBoardRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'board',
  component: () => <Outlet />,
})

// "/settings/board/" — redirect to /settings/board/defaults
const settingsBoardIndexRoute = createRoute({
  getParentRoute: () => settingsBoardRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({
      to: '/settings/board/$boardSettingsTab',
      params: { boardSettingsTab: BOARD_SETTINGS_TAB_TO_SLUG[DEFAULT_BOARD_SUBTAB] },
    })
  },
  component: () => null,
})

// "/settings/board/$boardSettingsTab" — defaults / title / actions / labels / meta
const settingsBoardTabRoute = createRoute({
  getParentRoute: () => settingsBoardRoute,
  path: '$boardSettingsTab',
  beforeLoad: ({ params }) => {
    if (BOARD_SETTINGS_TAB_FROM_SLUG[params.boardSettingsTab]) {
      return
    }

    throw redirect({
      to: '/settings/board/$boardSettingsTab',
      params: { boardSettingsTab: BOARD_SETTINGS_TAB_TO_SLUG[DEFAULT_BOARD_SUBTAB] },
    })
  },
  component: () => null,
})

// "/settings/plugins" — plugin options tab
const settingsPluginsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'plugins',
  component: () => <Outlet />,
})

// "/settings/plugins/" — redirect to plugin options tab (no specific plugin)
const settingsPluginsIndexRoute = createRoute({
  getParentRoute: () => settingsPluginsRoute,
  path: '/',
  component: function SettingsPluginsSync() {
    useEffect(() => {
      const s = useStore.getState()
      s.setSettingsOpen(true)
      s.setSettingsTab('pluginOptions')
    }, [])
    return null
  },
})

// "/settings/plugins/$pluginId" — specific plugin
const settingsPluginIdRoute = createRoute({
  getParentRoute: () => settingsPluginsRoute,
  path: '$pluginId',
  component: () => null,
})

// "/settings/$settingsTab" — general + legacy defaults/labels redirects
const settingsTabRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '$settingsTab',
  beforeLoad: ({ params }) => {
    const legacyBoardSettingsTab = LEGACY_BOARD_SETTINGS_TAB_FROM_SETTINGS_SLUG[params.settingsTab]
    if (legacyBoardSettingsTab) {
      throw redirect({
        to: '/settings/board/$boardSettingsTab',
        params: { boardSettingsTab: BOARD_SETTINGS_TAB_TO_SLUG[legacyBoardSettingsTab] },
      })
    }

    if (SETTINGS_TAB_FROM_SLUG[params.settingsTab]) {
      return
    }

    throw redirect({ to: '/settings/$settingsTab', params: { settingsTab: 'general' } })
  },
  component: () => null,
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    settingsBoardRoute.addChildren([
      settingsBoardIndexRoute,
      settingsBoardTabRoute,
    ]),
    settingsPluginsRoute.addChildren([
      settingsPluginsIndexRoute,
      settingsPluginIdRoute,
    ]),
    settingsTabRoute,
  ]),
  boardRoute.addChildren([
    cardRoute.addChildren([tabRoute]),
  ]),
])

export const router = createRouter({
  routeTree,
  history: shouldUseMemoryHistory(window.location.protocol) ? createMemoryHistory({ initialEntries: ['/'] }) : undefined,
  defaultPreload: 'intent',
})

// Augment TanStack Router type registry for type-safe navigation (optional but nice)
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

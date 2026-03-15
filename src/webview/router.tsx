/**
 * TanStack Router setup for the standalone web mode.
 *
 * URL schema: /<boardId>/<cardId>/<tabId>?priority=&labels=&assignee=&dueDate=&q=
 *
 * Architecture:
 *  - rootRoute renders <App /> + <URLSync /> + <Outlet />
 *  - boardRoute / cardRoute / tabRoute extend the URL (nested paths)
 *  - URLSync is the single bridge between the URL and Zustand store
 *
 * The Zustand store is always the source of truth for UI state.
 * URLSync only has TWO jobs:
 *   1. On mount: read URL params and initialize the store / open the correct card.
 *   2. After init: keep URL in sync with store changes (store → URL).
 */

import { useEffect, useRef } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import App from './App'
import { useStore, type CardTab, type DueDateFilter } from './store'
import type { Priority } from '../shared/types'

// ---------------------------------------------------------------------------
// vscode API (singleton so acquireVsCodeApi is called exactly once per page)
// ---------------------------------------------------------------------------
import { getVsCodeApi } from './vsCodeApi'
const vscode = getVsCodeApi()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TabId = CardTab
const VALID_TABS: TabId[] = ['write', 'preview', 'comments', 'logs']
const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']
const VALID_DUE_DATES: DueDateFilter[] = ['overdue', 'today', 'this-week', 'no-date']

interface RouteSearch {
  priority?: string
  labels?: string
  assignee?: string
  dueDate?: string
  q?: string
}

function validateSearch(search: Record<string, unknown>): RouteSearch {
  return {
    priority: typeof search.priority === 'string' ? search.priority : undefined,
    labels: typeof search.labels === 'string' ? search.labels : undefined,
    assignee: typeof search.assignee === 'string' ? search.assignee : undefined,
    dueDate: typeof search.dueDate === 'string' ? search.dueDate : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
  }
}

function buildSearchStr(s: RouteSearch): string {
  return JSON.stringify({
    ...(s.priority && { priority: s.priority }),
    ...(s.labels && { labels: s.labels }),
    ...(s.assignee && { assignee: s.assignee }),
    ...(s.dueDate && { dueDate: s.dueDate }),
    ...(s.q && { q: s.q }),
  })
}

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
  }
  const search = useSearch({ strict: false }) as RouteSearch

  const {
    setPriorityFilter,
    setAssigneeFilter,
    setLabelFilter,
    setDueDateFilter,
    setSearchQuery,
    setActiveCardTab,
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

  // Initialise prevStateRef from current URL (not store defaults) to prevent
  // spurious navigation on the first Store→URL effect run.
  const initialStore = useStore.getState()
  const prevStateRef = useRef({
    board: params.boardId ?? initialStore.currentBoard,
    cardId: '', // card opens asynchronously, start empty
    tab: (params.tabId as TabId | undefined) ?? initialStore.activeCardTab,
    searchStr: buildSearchStr(search),
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

    // Restore active tab
    if (params.tabId && VALID_TABS.includes(params.tabId as TabId)) {
      setActiveCardTab(params.tabId as TabId)
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

  // ── 3. Store → URL: keep URL in sync with store ───────────────────────────
  // Wait until the server has responded (columns populated) before syncing.
  const firstNavRef = useRef(true)

  useEffect(() => {
    if (columns.length === 0) return // wait for server init

    const searchObj: RouteSearch = {}
    if (priorityFilter !== 'all') searchObj.priority = priorityFilter
    if (labelFilter.length > 0) searchObj.labels = labelFilter.join(',')
    if (assigneeFilter !== 'all') searchObj.assignee = assigneeFilter
    if (dueDateFilter !== 'all') searchObj.dueDate = dueDateFilter
    if (searchQuery) searchObj.q = searchQuery

    const searchStr = buildSearchStr(searchObj)
    const prev = prevStateRef.current

    const boardChanged = prev.board !== currentBoard
    const cardChanged = prev.cardId !== (activeCardId ?? '')
    // Tab only matters when a card is open
    const tabChanged = Boolean(activeCardId) && prev.tab !== activeCardTab
    const filterChanged = prev.searchStr !== searchStr

    if (!boardChanged && !cardChanged && !tabChanged && !filterChanged) return

    prevStateRef.current = {
      board: currentBoard,
      cardId: activeCardId ?? '',
      tab: activeCardTab,
      searchStr,
    }

    // First navigation after server init: use replace to avoid duplicate history entry.
    const replace = firstNavRef.current || (!boardChanged && !cardChanged && !tabChanged && filterChanged)
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
  }, [columns.length, currentBoard, activeCardId, activeCardTab, priorityFilter, assigneeFilter, labelFilter, dueDateFilter, searchQuery, navigate])

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
// Router
// ---------------------------------------------------------------------------
const routeTree = rootRoute.addChildren([
  indexRoute,
  boardRoute.addChildren([
    cardRoute.addChildren([tabRoute]),
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

// Augment TanStack Router type registry for type-safe navigation (optional but nice)
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

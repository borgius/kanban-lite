import { useEffect, useState, useRef, useCallback } from 'react'
import { generateKeyBetween } from 'fractional-indexing'
import { useStore } from './store'
import { KanbanBoard } from './components/KanbanBoard'
import { CreateCardDialog } from './components/CreateCardDialog'
import { CardEditor } from './components/CardEditor'
import { Toolbar } from './components/Toolbar'
import { UndoToast } from './components/UndoToast'
import { SettingsPanel } from './components/SettingsPanel'
import { ColumnDialog } from './components/ColumnDialog'
import { BulkActionsBar } from './components/BulkActionsBar'
import { ShortcutHelp } from './components/ShortcutHelp'
import { DrawerResizeHandle } from './components/DrawerResizeHandle'
import type { Comment, Card, KanbanColumn, Priority, ExtensionMessage, CardFrontmatter, CardDisplaySettings, LogEntry } from '../shared/types'
import { DELETED_STATUS_ID, getTitleFromContent } from '../shared/types'
import { LogsSection } from './components/LogsSection'
import { buildConnectionNotice, type ConnectionNotice } from './connectionStatusNotice'

import { getVsCodeApi } from './vsCodeApi'
import type { ColumnVisibilityByBoard } from './store'
import { sanitizeColumnVisibilityByBoard } from './store'

const vscode = getVsCodeApi()

function readPersistedColumnVisibilityByBoard(state: unknown): ColumnVisibilityByBoard {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(state).flatMap(([boardId, visibility]) => {
      if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility)) {
        return []
      }

      const hiddenColumnIds = Array.isArray((visibility as { hiddenColumnIds?: unknown }).hiddenColumnIds)
        ? (visibility as { hiddenColumnIds: unknown[] }).hiddenColumnIds.filter((columnId): columnId is string => typeof columnId === 'string')
        : []
      const minimizedColumnIds = Array.isArray((visibility as { minimizedColumnIds?: unknown }).minimizedColumnIds)
        ? (visibility as { minimizedColumnIds: unknown[] }).minimizedColumnIds.filter((columnId): columnId is string => typeof columnId === 'string')
        : []

      return [[boardId, { hiddenColumnIds, minimizedColumnIds }] as const]
    })
  )
}

function hasBoardVisibilityState(columnVisibilityByBoard: ColumnVisibilityByBoard, boardId: string): boolean {
  return Object.prototype.hasOwnProperty.call(columnVisibilityByBoard, boardId)
}

function App(): React.JSX.Element {

  const {
    columns,
    currentBoard,
    columnVisibilityByBoard,
    workspace,
    cardSettings,
    effectiveDrawerWidth,
    settingsOpen,
    selectedCardIds,
    setCards,
    setColumns,
    setBoards,
    setIsDarkMode,
    setWorkspace,
    setCardSettings,
    setDrawerWidthPreview,
    clearDrawerWidthPreview,
    setSettingsOpen,
    setLabelDefs,
    toggleSelectCard,
    selectCardRange,
    selectAllInColumn,
    clearSelection,
    setActiveCardId,
    setActiveCardTab
  } = useStore()

  const [createCardOpen, setCreateCardOpen] = useState(false)
  const [createCardStatus, setCreateCardStatus] = useState<string>('backlog')
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)

  // Column dialog state
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null)

  // Editor state
  const contentVersionRef = useRef(0)
  const [editingCard, setEditingCard] = useState<{
    id: string
    content: string
    frontmatter: CardFrontmatter
    comments: Comment[]
    logs: LogEntry[]
    contentVersion: number
  } | null>(null)

  // Board logs panel state
  const [boardLogsOpen, setBoardLogsOpen] = useState(false)
  const [boardLogs, setBoardLogs] = useState<LogEntry[]>([])
  const [isColumnVisibilityPersistenceReady, setIsColumnVisibilityPersistenceReady] = useState(false)
  const persistedColumnVisibilityRef = useRef<ColumnVisibilityByBoard>(readPersistedColumnVisibilityByBoard(vscode.getState()))

  // Keep store in sync so URLSync (router) can read/update the active card
  useEffect(() => {
    setActiveCardId(editingCard?.id ?? null)
  }, [editingCard?.id, setActiveCardId])

  // Undo delete stack
  const [pendingDeletes, setPendingDeletes] = useState<{ id: string; card: Card; originalStatus: string }[]>([])
  const [connectionNotice, setConnectionNotice] = useState<ConnectionNotice | null>(null)
  const pendingDeletesRef = useRef(pendingDeletes)
  useEffect(() => {
    pendingDeletesRef.current = pendingDeletes
  }, [pendingDeletes])

  const nextIdRef = useRef(0)

  const handleDeleteCard = useCallback((cardId: string) => {
    const { cards } = useStore.getState()
    const card = cards.find(f => f.id === cardId)
    if (!card) return

    // Optimistically move to deleted status in local state
    const originalStatus = card.status
    setCards(cards.map(f => f.id === cardId ? { ...f, status: DELETED_STATUS_ID } : f))

    // Close editor if this card is open
    if (editingCard?.id === cardId) {
      setEditingCard(null)
    }

    // Push onto the undo stack
    const id = String(nextIdRef.current++)
    setPendingDeletes(prev => [...prev, { id, card, originalStatus }])
  }, [editingCard, setCards])

  const commitDelete = useCallback((entryId: string) => {
    const entry = pendingDeletesRef.current.find(d => d.id === entryId)
    if (!entry) return
    vscode.postMessage({ type: 'deleteCard', cardId: entry.card.id })
    setPendingDeletes(prev => prev.filter(d => d.id !== entryId))
  }, [])

  const handleUndoDelete = useCallback((entryId: string) => {
    const entry = pendingDeletesRef.current.find(d => d.id === entryId)
    if (!entry) return
    // Restore the card to its original status
    const { cards } = useStore.getState()
    setCards(cards.map(f => f.id === entry.card.id ? { ...f, status: entry.originalStatus } : f))
    setPendingDeletes(prev => prev.filter(d => d.id !== entryId))
  }, [setCards])

  const handleUndoLatest = useCallback(() => {
    const stack = pendingDeletesRef.current
    if (stack.length === 0) return
    handleUndoDelete(stack[stack.length - 1].id)
  }, [handleUndoDelete])

  // Keyboard shortcuts
  useEffect(() => {
    let altPressedAlone = false
    let altDownTimer: ReturnType<typeof setTimeout> | null = null

    const handleKeyDown = (e: KeyboardEvent) => {
      // Track bare ALT press to forward to VS Code menu bar
      if (e.key === 'Alt') {
        altPressedAlone = true
        // If ALT is held >1s it's likely a modifier hold or window drag, not a menu toggle
        if (altDownTimer) clearTimeout(altDownTimer)
        altDownTimer = setTimeout(() => { altPressedAlone = false }, 1000)
        return
      }
      if (e.altKey) {
        altPressedAlone = false
        if (altDownTimer) { clearTimeout(altDownTimer); altDownTimer = null }
      }

      // Ctrl/Cmd+Z to undo delete (works even in inputs)
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && pendingDeletesRef.current.length > 0) {
        e.preventDefault()
        handleUndoLatest()
        return
      }

      // Ctrl/Cmd +/- for board zoom, Ctrl/Cmd+Shift +/- for card detail zoom
      if ((e.key === '=' || e.key === '+' || e.key === '-') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const delta = (e.key === '-') ? -5 : 5
        const { cardSettings } = useStore.getState()
        if (e.shiftKey) {
          const newZoom = Math.max(75, Math.min(150, cardSettings.cardZoom + delta))
          if (newZoom !== cardSettings.cardZoom) {
            const next = { ...cardSettings, cardZoom: newZoom }
            setCardSettings(next)
            vscode.postMessage({ type: 'saveSettings', settings: next })
          }
        } else {
          const newZoom = Math.max(75, Math.min(150, cardSettings.boardZoom + delta))
          if (newZoom !== cardSettings.boardZoom) {
            const next = { ...cardSettings, boardZoom: newZoom }
            setCardSettings(next)
            vscode.postMessage({ type: 'saveSettings', settings: next })
          }
        }
        return
      }

      // Ignore if user is typing in an input or contentEditable (e.g. TipTap editor)
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return
      }

      switch (e.key) {
        case 'n':
          if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
            return
          }
          e.preventDefault()
          setCreateCardStatus('backlog')
          setCreateCardOpen(true)
          break
        case '?':
          if (e.ctrlKey || e.metaKey || e.altKey) return
          e.preventDefault()
          setShortcutHelpOpen(open => !open)
          break
        case 'Escape':
          if (shortcutHelpOpen) {
            setShortcutHelpOpen(false)
          } else if (createCardOpen) {
            setCreateCardOpen(false)
          } else if (useStore.getState().selectedCardIds.length > 0) {
            clearSelection()
          }
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && altPressedAlone) {
        altPressedAlone = false
        if (altDownTimer) { clearTimeout(altDownTimer); altDownTimer = null }
        vscode.postMessage({ type: 'focusMenuBar' })
      }
    }

    // Cancel ALT-alone if mouse is clicked while ALT is held (e.g. ALT+click window drag on Linux)
    const handleMouseDown = () => { altPressedAlone = false }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('mousedown', handleMouseDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('mousedown', handleMouseDown)
      if (altDownTimer) clearTimeout(altDownTimer)
    }
  }, [createCardOpen, shortcutHelpOpen, handleUndoLatest, setCardSettings, clearSelection])

  // Listen for VSCode theme changes
  useEffect(() => {
    const updateTheme = () => {
      const isDark = document.body.classList.contains('vscode-dark') ||
                     document.body.classList.contains('vscode-high-contrast')
      setIsDarkMode(isDark)
      if (isDark) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }

    updateTheme()

    // Watch for class changes on body
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [setIsDarkMode])

  // Sync zoom CSS custom properties
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--board-zoom', String(cardSettings.boardZoom / 100))
    root.style.setProperty('--card-zoom', String(cardSettings.cardZoom / 100))
  }, [cardSettings.boardZoom, cardSettings.cardZoom])

  // Listen for messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data
      if (!message || typeof message.type !== 'string') return

      switch (message.type) {
        case 'init':
          {
            const nextColumns = message.columns ?? []
            const nextBoardId = message.currentBoard ?? useStore.getState().currentBoard
            const nextColumnIds = nextColumns.map((column) => column.id)
            const currentColumnVisibilityByBoard = useStore.getState().columnVisibilityByBoard
            const hydratedColumnVisibilityByBoard = sanitizeColumnVisibilityByBoard(
              {
                ...persistedColumnVisibilityRef.current,
                ...currentColumnVisibilityByBoard,
              },
              nextBoardId,
              nextColumnIds
            )

            useStore.setState({
              currentBoard: nextBoardId,
              columnVisibilityByBoard: hydratedColumnVisibilityByBoard,
            })
          }
          setConnectionNotice(null)
          setCards(message.cards ?? [])
          setColumns(message.columns ?? [])
          if (message.boards) setBoards(message.boards)
          if (message.workspace) setWorkspace(message.workspace)
          if (message.settings) {
            if (message.settings.markdownEditorMode && editingCard) {
              setEditingCard(null)
            }
            setCardSettings(message.settings)
          }
          if (message.labels) setLabelDefs(message.labels)
          setIsColumnVisibilityPersistenceReady(true)
          break
        case 'connectionStatus':
          setConnectionNotice(buildConnectionNotice(message))
          break
        case 'cardsUpdated':
          setCards(message.cards)
          break
        case 'triggerCreateDialog':
          setCreateCardStatus('backlog')
          setCreateCardOpen(true)
          break
        case 'labelsUpdated':
          setLabelDefs(message.labels)
          break
        case 'showSettings':
          setCardSettings(message.settings)
          setSettingsOpen(true)
          break
        case 'cardContent': {
          const { cardSettings } = useStore.getState()
          if (cardSettings.markdownEditorMode) break
          contentVersionRef.current += 1
          setEditingCard(prev => ({
            id: message.cardId,
            content: message.content,
            frontmatter: message.frontmatter,
            comments: message.comments || [],
            // Preserve existing logs when server omits them (e.g. on status change broadcast)
            logs: message.logs !== undefined ? message.logs : (prev?.id === message.cardId ? prev.logs : []),
            contentVersion: contentVersionRef.current
          }))
          break
        }
        case 'actionResult': {
          // fire-and-forget: no UI feedback needed for now
          break
        }
        case 'boardActionResult': {
          // fire-and-forget: no UI feedback needed for now
          break
        }
        case 'logsUpdated': {
          setEditingCard(prev => prev && prev.id === message.cardId ? { ...prev, logs: message.logs } : prev)
          break
        }
        case 'boardLogsUpdated': {
          setBoardLogs(message.logs)
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [editingCard, setCards, setColumns, setBoards, setWorkspace, setCardSettings, setSettingsOpen, setLabelDefs])

  useEffect(() => {
    if (!isColumnVisibilityPersistenceReady) {
      return
    }

    const sanitizedColumnVisibilityByBoard = sanitizeColumnVisibilityByBoard(
      columnVisibilityByBoard,
      currentBoard,
      columns.map((column) => column.id)
    )

    if (sanitizedColumnVisibilityByBoard !== columnVisibilityByBoard) {
      useStore.setState({ columnVisibilityByBoard: sanitizedColumnVisibilityByBoard })
      return
    }

    persistedColumnVisibilityRef.current = sanitizedColumnVisibilityByBoard
    vscode.setState(sanitizedColumnVisibilityByBoard)
  }, [columnVisibilityByBoard, columns, currentBoard, isColumnVisibilityPersistenceReady])

  const handleCardClick = (card: Card, e: React.MouseEvent): void => {
    // Cmd/Ctrl+click → toggle this card in multi-selection
    if (e.metaKey || e.ctrlKey) {
      const current = useStore.getState().selectedCardIds
      const next = [...current]
      // If an editor card is open, include it in the multi-selection
      if (editingCard && !next.includes(editingCard.id)) {
        next.push(editingCard.id)
      }
      // Toggle the clicked card
      const idx = next.indexOf(card.id)
      if (idx >= 0) {
        next.splice(idx, 1)
      } else {
        next.push(card.id)
      }
      useStore.setState({ selectedCardIds: next, lastClickedCardId: card.id })
      if (editingCard) setEditingCard(null)
      return
    }
    // Shift+click → range select
    if (e.shiftKey) {
      // If editor is open, use it as anchor for range selection
      if (editingCard && !useStore.getState().lastClickedCardId) {
        const current = useStore.getState().selectedCardIds
        const next = current.includes(editingCard.id) ? [...current] : [...current, editingCard.id]
        useStore.setState({ selectedCardIds: next, lastClickedCardId: editingCard.id })
      }
      selectCardRange(card.id)
      if (editingCard) setEditingCard(null)
      return
    }
    // Normal click → single select, clear multi-selection, open editor
    clearSelection()
    // Request card content for inline editing
    vscode.postMessage({
      type: 'openCard',
      cardId: card.id
    })
  }

  const handleSaveCard = (content: string, frontmatter: CardFrontmatter): void => {
    if (!editingCard) return
    vscode.postMessage({
      type: 'saveCardContent',
      cardId: editingCard.id,
      content,
      frontmatter
    })
  }

  const handleTransferToBoard = (toBoard: string, targetStatus: string): void => {
    if (!editingCard) return
    vscode.postMessage({
      type: 'transferCard',
      cardId: editingCard.id,
      toBoard,
      targetStatus
    })
    setEditingCard(null)
  }

  const handleCloseEditor = (): void => {
    setEditingCard(null)
    setActiveCardTab('preview') // reset so next card opens on preview tab
    vscode.postMessage({ type: 'closeCard' })
  }

  const handleDeleteFromEditor = (): void => {
    if (!editingCard) return
    handleDeleteCard(editingCard.id)
  }

  const handlePermanentDeleteCard = (): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'permanentDeleteCard', cardId: editingCard.id })
    setEditingCard(null)
  }

  const handleRestoreCard = (): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'restoreCard', cardId: editingCard.id })
    setEditingCard(null)
  }

  const handlePurgeDeletedCards = (): void => {
    vscode.postMessage({ type: 'purgeDeletedCards' })
  }

  const handleOpenFile = (): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'openFile', cardId: editingCard.id })
  }

  const handleOpenMetadataFile = (path: string): void => {
    vscode.postMessage({ type: 'openMetadataFile', path })
  }

  const handleDownloadCard = (): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'downloadCard', cardId: editingCard.id })
  }

  const handleStartWithAI = (agent: 'claude' | 'codex' | 'opencode', permissionMode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'): void => {
    vscode.postMessage({ type: 'startWithAI', agent, permissionMode })
  }

  const handleAddAttachment = (): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'addAttachment', cardId: editingCard.id })
  }

  const handleOpenAttachment = (attachment: string): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'openAttachment', cardId: editingCard.id, attachment })
  }

  const handleRemoveAttachment = (attachment: string): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'removeAttachment', cardId: editingCard.id, attachment })
  }

  const handleAddComment = (author: string, content: string): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'addComment', cardId: editingCard.id, author, content })
  }

  const handleUpdateComment = (commentId: string, content: string): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'updateComment', cardId: editingCard.id, commentId, content })
  }

  const handleDeleteComment = (commentId: string): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'deleteComment', cardId: editingCard.id, commentId })
  }

  const handleClearLogs = (): void => {
    if (!editingCard) return
    vscode.postMessage({ type: 'clearLogs', cardId: editingCard.id })
  }

  const handleOpenBoardLogs = (): void => {
    if (boardLogsOpen) {
      setBoardLogsOpen(false)
    } else {
      setBoardLogsOpen(true)
      vscode.postMessage({ type: 'getBoardLogs' })
    }
  }

  const handleClearBoardLogs = (): void => {
    vscode.postMessage({ type: 'clearBoardLogs' })
  }

  const handleSaveSettings = (settings: CardDisplaySettings): void => {
    vscode.postMessage({ type: 'saveSettings', settings })
  }

  const handlePreviewDrawerWidth = useCallback((width: number): void => {
    setDrawerWidthPreview(width)
  }, [setDrawerWidthPreview])

  const handleCommitDrawerWidth = useCallback((width: number): void => {
    clearDrawerWidthPreview()
    const next = { ...useStore.getState().cardSettings, drawerWidth: width }
    setCardSettings(next)
    handleSaveSettings(next)
  }, [clearDrawerWidthPreview, setCardSettings])

  const handleCancelDrawerResize = useCallback((): void => {
    clearDrawerWidthPreview()
  }, [clearDrawerWidthPreview])

  const handleAddColumn = (): void => {
    setEditingColumn(null)
    setColumnDialogOpen(true)
  }

  const handleEditColumn = (columnId: string): void => {
    const col = columns.find(c => c.id === columnId)
    if (col) {
      setEditingColumn(col)
      setColumnDialogOpen(true)
    }
  }

  const handleRemoveColumn = (columnId: string): void => {
    const col = columns.find(c => c.id === columnId)
    if (!col) return
    const featuresInColumn = useStore.getState().cards.filter(f => f.status === columnId)
    if (featuresInColumn.length > 0) {
      // Don't remove columns that still have cards
      return
    }
    vscode.postMessage({ type: 'removeColumn', columnId })
  }

  const handleCleanupColumn = (columnId: string): void => {
    const col = columns.find(c => c.id === columnId)
    if (!col) return
    const featuresInColumn = useStore.getState().cards.filter(f => f.status === columnId)
    if (featuresInColumn.length === 0) return
    vscode.postMessage({ type: 'cleanupColumn', columnId })
  }

  const handleReorderColumns = useCallback((columnIds: string[]): void => {
    // Optimistic update
    const current = useStore.getState().columns
    setColumns(columnIds.map(id => current.find(c => c.id === id)).filter((c): c is KanbanColumn => c != null))
    vscode.postMessage({ type: 'reorderColumns', columnIds })
  }, [setColumns])

  const handleSaveColumn = (data: { name: string; color: string }): void => {
    if (editingColumn) {
      vscode.postMessage({ type: 'editColumn', columnId: editingColumn.id, updates: data })
    } else {
      vscode.postMessage({ type: 'addColumn', column: data })
    }
    setColumnDialogOpen(false)
    setEditingColumn(null)
  }

  const handleAddCardInColumn = (status: string): void => {
    setCreateCardStatus(status)
    setCreateCardOpen(true)
  }

  // --- Bulk action handlers ---
  const handleBulkMoveToColumn = useCallback((columnId: string): void => {
    const ids = Array.from(useStore.getState().selectedCardIds)
    for (const cardId of ids) {
      vscode.postMessage({ type: 'moveCard', cardId, newStatus: columnId, newOrder: -1 })
    }
    // Optimistic update
    const { cards } = useStore.getState()
    setCards(cards.map(c => ids.includes(c.id) ? { ...c, status: columnId } : c))
    clearSelection()
  }, [setCards, clearSelection])

  const handleBulkSetPriority = useCallback((priority: Priority): void => {
    const ids = Array.from(useStore.getState().selectedCardIds)
    for (const cardId of ids) {
      vscode.postMessage({ type: 'bulkUpdateCard', cardId, updates: { priority } })
    }
    const { cards } = useStore.getState()
    setCards(cards.map(c => ids.includes(c.id) ? { ...c, priority } : c))
    clearSelection()
  }, [setCards, clearSelection])

  const handleBulkSetAssignee = useCallback((assignee: string | null): void => {
    const ids = Array.from(useStore.getState().selectedCardIds)
    for (const cardId of ids) {
      vscode.postMessage({ type: 'bulkUpdateCard', cardId, updates: { assignee } })
    }
    const { cards } = useStore.getState()
    setCards(cards.map(c => ids.includes(c.id) ? { ...c, assignee } : c))
    clearSelection()
  }, [setCards, clearSelection])

  const handleBulkAddLabels = useCallback((labels: string[]): void => {
    const ids = Array.from(useStore.getState().selectedCardIds)
    const { cards } = useStore.getState()
    for (const cardId of ids) {
      const card = cards.find(c => c.id === cardId)
      if (!card) continue
      const merged = Array.from(new Set([...card.labels, ...labels]))
      vscode.postMessage({ type: 'bulkUpdateCard', cardId, updates: { labels: merged } })
    }
    setCards(cards.map(c => {
      if (!ids.includes(c.id)) return c
      return { ...c, labels: Array.from(new Set([...c.labels, ...labels])) }
    }))
    clearSelection()
  }, [setCards, clearSelection])

  const handleBulkDelete = useCallback((): void => {
    const ids = Array.from(useStore.getState().selectedCardIds)
    for (const cardId of ids) {
      handleDeleteCard(cardId)
    }
    clearSelection()
  }, [handleDeleteCard, clearSelection])

  const handleBulkMoveCards = useCallback((cardIds: string[], newStatus: string): void => {
    for (const cardId of cardIds) {
      vscode.postMessage({ type: 'moveCard', cardId, newStatus, newOrder: -1 })
    }
    const { cards } = useStore.getState()
    setCards(cards.map(c => cardIds.includes(c.id) ? { ...c, status: newStatus } : c))
    clearSelection()
  }, [setCards, clearSelection])

  const handleCreateCard = (data: {
    status: string
    priority: Priority
    content: string
    assignee: string | null
    dueDate: string | null
    labels: string[]
    actions: string[] | Record<string, string>
  }): void => {
    vscode.postMessage({
      type: 'createCard',
      data
    })
  }

  const handleTriggerAction = useCallback((action: string): void => {
    if (!editingCard) return
    const callbackKey = `action-${Date.now()}`
    vscode.postMessage({
      type: 'triggerAction',
      cardId: editingCard.id,
      action,
      callbackKey
    })
  }, [editingCard])

  const handleTriggerActionForCard = useCallback((cardId: string, action: string): void => {
    const callbackKey = `action-${Date.now()}`
    vscode.postMessage({ type: 'triggerAction', cardId, action, callbackKey })
  }, [])

  const handleTriggerBoardAction = useCallback((boardId: string, actionKey: string): void => {
    const callbackKey = `board-action-${Date.now()}`
    vscode.postMessage({ type: 'triggerBoardAction', boardId, actionKey, callbackKey })
  }, [])

  const handleMoveCard = (
    cardId: string,
    newStatus: string,
    newOrder: number
  ): void => {
    // Optimistic update: compute fractional index locally before server confirms
    const { cards } = useStore.getState()
    const card = cards.find(f => f.id === cardId)
    if (card) {
      // Get sorted target column cards (excluding the moved card)
      const targetColumn = cards
        .filter(f => f.status === newStatus && f.id !== cardId)
        .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

      const clampedOrder = Math.max(0, Math.min(newOrder, targetColumn.length))
      const before = clampedOrder > 0 ? targetColumn[clampedOrder - 1].order : null
      const after = clampedOrder < targetColumn.length ? targetColumn[clampedOrder].order : null
      const newOrderKey = generateKeyBetween(before, after)

      const updated = cards.map(f =>
        f.id === cardId
          ? { ...f, status: newStatus, order: newOrderKey }
          : f
      )
      setCards(updated)
    }

    // Tell extension to persist
    vscode.postMessage({
      type: 'moveCard',
      cardId,
      newStatus,
      newOrder
    })
  }

  const handleQuickAdd = useCallback((data: { status: string; priority: Priority; content: string }): void => {
    handleCreateCard({ ...data, assignee: null, dueDate: null, labels: [], actions: [] })
  }, [])

  // Show loading if no columns yet
  if (columns.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[var(--vscode-editor-background)]">
        <div className="text-[var(--vscode-foreground)] opacity-60">Loading...</div>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col bg-[var(--vscode-editor-background)]">
      <Toolbar
        onOpenSettings={() => vscode.postMessage({ type: 'openSettings' })}
        onAddColumn={handleAddColumn}
        onCreateCard={() => {
          setCreateCardStatus(cardSettings.defaultStatus || 'backlog')
          setCreateCardOpen(true)
        }}
        onToggleTheme={() => vscode.postMessage({ type: 'toggleTheme' })}
        onSwitchBoard={(boardId) => vscode.postMessage({ type: 'switchBoard', boardId })}
        onCreateBoard={(name) => vscode.postMessage({ type: 'createBoard', name })}
        onOpenBoardLogs={handleOpenBoardLogs}
        boardLogsOpen={boardLogsOpen}
        onTriggerBoardAction={handleTriggerBoardAction}
        onOpenShortcutHelp={() => setShortcutHelpOpen(open => !open)}
      />
      <div className="flex-1 flex overflow-hidden">
        <div
          className="board-zoom-scope w-full"
          style={(cardSettings.panelMode ?? 'drawer') === 'drawer' && selectedCardIds.length === 0 && (editingCard !== null || boardLogsOpen)
            ? { width: `${100 - effectiveDrawerWidth}%` }
            : undefined}
        >
          <KanbanBoard
            onCardClick={handleCardClick}
            onAddCard={handleAddCardInColumn}
            onMoveCard={handleMoveCard}
            onMoveCards={handleBulkMoveCards}
            onEditColumn={handleEditColumn}
            onRemoveColumn={handleRemoveColumn}
            onCleanupColumn={handleCleanupColumn}
            onReorderColumns={handleReorderColumns}
            onPurgeDeletedCards={handlePurgeDeletedCards}
            selectedCardId={editingCard?.id}
            selectedCardIds={selectedCardIds}
            onSelectAll={selectAllInColumn}
            onQuickAdd={handleQuickAdd}
            onTriggerAction={handleTriggerActionForCard}
          />
        </div>
        {boardLogsOpen && selectedCardIds.length === 0 && !editingCard && (() => {
          const isDrawer = (cardSettings.panelMode ?? 'drawer') === 'drawer'
          return (
            <div className={`fixed inset-0 z-40 flex ${isDrawer ? 'justify-end pointer-events-none' : 'items-center justify-center p-4'}`}>
              {!isDrawer && <div className="absolute inset-0 bg-black/50" onClick={() => setBoardLogsOpen(false)} />}
              <div
                className={isDrawer
                  ? 'relative h-full flex flex-col shadow-xl animate-in slide-in-from-right duration-200 pointer-events-auto'
                  : 'relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl shadow-xl animate-in zoom-in-95 fade-in duration-200'}
                style={isDrawer
                  ? { width: `${effectiveDrawerWidth}%`, background: 'var(--vscode-editor-background)', borderLeft: '1px solid var(--vscode-panel-border)' }
                  : { background: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-panel-border)' }}
                {...(isDrawer ? { 'data-panel-drawer': '' } : {})}
              >
                <DrawerResizeHandle
                  panelMode={isDrawer ? 'drawer' : 'popup'}
                  onPreview={handlePreviewDrawerWidth}
                  onCommit={handleCommitDrawerWidth}
                  onCancel={handleCancelDrawerResize}
                />
                <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--vscode-foreground)' }}>Board Logs</span>
                  <button
                    onClick={() => setBoardLogsOpen(false)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: 'var(--vscode-descriptionForeground)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    title="Close board logs"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  <LogsSection
                    logs={boardLogs}
                    onClearLogs={handleClearBoardLogs}
                  />
                </div>
              </div>
            </div>
          )
        })()}
        {editingCard && selectedCardIds.length === 0 && (() => {
          const isDrawer = (cardSettings.panelMode ?? 'drawer') === 'drawer'
          return (
            <div className={`fixed inset-0 z-40 flex ${isDrawer ? 'justify-end pointer-events-none' : 'items-center justify-center p-4'}`}>
              {!isDrawer && <div className="absolute inset-0 bg-black/50" onClick={handleCloseEditor} />}
              <div
                className={isDrawer
                  ? 'relative h-full flex flex-col shadow-xl overflow-hidden animate-in slide-in-from-right duration-200 pointer-events-auto'
                  : 'relative w-full max-w-4xl h-[90vh] flex flex-col rounded-xl shadow-xl overflow-hidden animate-in zoom-in-95 fade-in duration-200'}
                style={{
                  fontSize: `calc(1em * var(--card-zoom, 1))`,
                  ...(isDrawer
                    ? { width: `${effectiveDrawerWidth}%`, background: 'var(--vscode-editor-background)', borderLeft: '1px solid var(--vscode-panel-border)' }
                    : { background: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-panel-border)' })
                }}
                {...(isDrawer ? { 'data-panel-drawer': '' } : {})}
              >
                <DrawerResizeHandle
                  panelMode={isDrawer ? 'drawer' : 'popup'}
                  onPreview={handlePreviewDrawerWidth}
                  onCommit={handleCommitDrawerWidth}
                  onCancel={handleCancelDrawerResize}
                />
                <CardEditor
              cardId={editingCard.id}
              content={editingCard.content}
              frontmatter={editingCard.frontmatter}
              comments={editingCard.comments}
              contentVersion={editingCard.contentVersion}
              onSave={handleSaveCard}
              onClose={handleCloseEditor}
              onDelete={handleDeleteFromEditor}
              onPermanentDelete={handlePermanentDeleteCard}
              onRestore={handleRestoreCard}
              onOpenFile={handleOpenFile}
              onOpenMetadataFile={handleOpenMetadataFile}
              onDownloadCard={handleDownloadCard}
              onStartWithAI={handleStartWithAI}
              onAddAttachment={handleAddAttachment}
              onOpenAttachment={handleOpenAttachment}
              onRemoveAttachment={handleRemoveAttachment}
              onAddComment={handleAddComment}
              onUpdateComment={handleUpdateComment}
              onDeleteComment={handleDeleteComment}
              onTransferToBoard={handleTransferToBoard}
              onTriggerAction={handleTriggerAction}
              logs={editingCard.logs}
              onClearLogs={handleClearLogs}
              logsFilter={cardSettings.logsFilter}
              onLogsFilterChange={(filter) => {
                const next = { ...cardSettings, logsFilter: filter }
                setCardSettings(next)
                vscode.postMessage({ type: 'saveSettings', settings: next })
              }}
            />
            </div>
          </div>
          )
        })()}
      </div>

      {selectedCardIds.length > 1 && (
        <BulkActionsBar
          selectedCount={selectedCardIds.length}
          onClearSelection={clearSelection}
          onMoveToColumn={handleBulkMoveToColumn}
          onSetPriority={handleBulkSetPriority}
          onSetAssignee={handleBulkSetAssignee}
          onAddLabels={handleBulkAddLabels}
          onDelete={handleBulkDelete}
        />
      )}

      <CreateCardDialog
        isOpen={createCardOpen}
        onClose={() => setCreateCardOpen(false)}
        onCreate={handleCreateCard}
        initialStatus={createCardStatus}
        onSaveSettings={handleSaveSettings}
      />

      <SettingsPanel
        isOpen={settingsOpen}
        settings={cardSettings}
        workspace={workspace}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        onSetLabel={(name, definition) => vscode.postMessage({ type: 'setLabel', name, definition })}
        onRenameLabel={(oldName, newName) => vscode.postMessage({ type: 'renameLabel', oldName, newName })}
        onDeleteLabel={(name) => vscode.postMessage({ type: 'deleteLabel', name })}
      />

      <ColumnDialog
        isOpen={columnDialogOpen}
        onClose={() => { setColumnDialogOpen(false); setEditingColumn(null) }}
        onSave={handleSaveColumn}
        initial={editingColumn ? { name: editingColumn.name, color: editingColumn.color } : undefined}
        title={editingColumn ? 'Edit List' : 'Add List'}
      />

      {connectionNotice && (
        <UndoToast
          title={connectionNotice.title}
          message={connectionNotice.message}
          persistent
          tone={connectionNotice.tone}
          index={0}
        />
      )}

      {pendingDeletes.map((entry, i) => (
        <UndoToast
          key={entry.id}
          message={`Deleted "${getTitleFromContent(entry.card.content)}"`}
          onUndo={() => handleUndoDelete(entry.id)}
          onExpire={() => commitDelete(entry.id)}
          duration={5000}
          index={connectionNotice ? i + 1 : i}
        />
      ))}

      <ShortcutHelp isOpen={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  )
}

export default App

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
import type { Comment, Card, KanbanColumn, Priority, ExtensionMessage, CardFrontmatter, CardDisplaySettings } from '../shared/types'
import { DELETED_STATUS_ID, getTitleFromContent } from '../shared/types'

// Declare vscode API type
declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void
  getState: () => unknown
  setState: (state: unknown) => void
}

const vscode = acquireVsCodeApi()

function App(): React.JSX.Element {

  const {
    columns,
    workspace,
    cardSettings,
    settingsOpen,
    setCards,
    setColumns,
    setBoards,
    setCurrentBoard,
    setIsDarkMode,
    setWorkspace,
    setCardSettings,
    setSettingsOpen,
    setLabelDefs
  } = useStore()

  const [createCardOpen, setCreateCardOpen] = useState(false)
  const [createCardStatus, setCreateCardStatus] = useState<string>('backlog')

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
    contentVersion: number
  } | null>(null)

  // Undo delete stack
  const [pendingDeletes, setPendingDeletes] = useState<{ id: string; card: Card; originalStatus: string }[]>([])
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
        case 'Escape':
          if (createCardOpen) {
            setCreateCardOpen(false)
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
  }, [createCardOpen, handleUndoLatest, setCardSettings])

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
          setCards(message.cards)
          setColumns(message.columns)
          if (message.boards) setBoards(message.boards)
          if (message.currentBoard) setCurrentBoard(message.currentBoard)
          if (message.workspace) setWorkspace(message.workspace)
          if (message.settings) {
            if (message.settings.markdownEditorMode && editingCard) {
              setEditingCard(null)
            }
            setCardSettings(message.settings)
          }
          if (message.labels) setLabelDefs(message.labels)
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
          setEditingCard({
            id: message.cardId,
            content: message.content,
            frontmatter: message.frontmatter,
            comments: message.comments || [],
            contentVersion: contentVersionRef.current
          })
          break
        }
        case 'actionResult': {
          // fire-and-forget: no UI feedback needed for now
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [setCards, setColumns, setBoards, setCurrentBoard, setWorkspace, setCardSettings, setSettingsOpen, setLabelDefs])

  const handleCardClick = (card: Card): void => {
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

  const handleSaveSettings = (settings: CardDisplaySettings): void => {
    vscode.postMessage({ type: 'saveSettings', settings })
  }

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

  const handleCreateCard = (data: {
    status: string
    priority: Priority
    content: string
    assignee: string | null
    dueDate: string | null
    labels: string[]
    actions: string[]
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
        onToggleTheme={() => vscode.postMessage({ type: 'toggleTheme' })}
        onSwitchBoard={(boardId) => vscode.postMessage({ type: 'switchBoard', boardId })}
        onCreateBoard={(name) => vscode.postMessage({ type: 'createBoard', name })}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className={`board-zoom-scope ${editingCard ? 'w-1/2' : 'w-full'}`}>
          <KanbanBoard
            onCardClick={handleCardClick}
            onAddCard={handleAddCardInColumn}
            onMoveCard={handleMoveCard}
            onEditColumn={handleEditColumn}
            onRemoveColumn={handleRemoveColumn}
            onCleanupColumn={handleCleanupColumn}
            onPurgeDeletedCards={handlePurgeDeletedCards}
            selectedCardId={editingCard?.id}
          />
        </div>
        {editingCard && (
          <div className="w-1/2" style={{ fontSize: `calc(1em * var(--card-zoom, 1))` }}>
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
              onStartWithAI={handleStartWithAI}
              onAddAttachment={handleAddAttachment}
              onOpenAttachment={handleOpenAttachment}
              onRemoveAttachment={handleRemoveAttachment}
              onAddComment={handleAddComment}
              onUpdateComment={handleUpdateComment}
              onDeleteComment={handleDeleteComment}
              onTransferToBoard={handleTransferToBoard}
              onTriggerAction={handleTriggerAction}
            />
          </div>
        )}
      </div>

      <CreateCardDialog
        isOpen={createCardOpen}
        onClose={() => setCreateCardOpen(false)}
        onCreate={handleCreateCard}
        initialStatus={createCardStatus}
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

      {pendingDeletes.map((entry, i) => (
        <UndoToast
          key={entry.id}
          message={`Deleted "${getTitleFromContent(entry.card.content)}"`}
          onUndo={() => handleUndoDelete(entry.id)}
          onExpire={() => commitDelete(entry.id)}
          duration={5000}
          index={i}
        />
      ))}
    </div>
  )
}

export default App

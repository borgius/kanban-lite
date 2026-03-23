import { useState, useCallback, useRef, useEffect } from 'react'
import { Columns } from 'lucide-react'
import { KanbanColumn } from './KanbanColumn'
import { useStore } from '../store'
import type { SortOrder } from '../store'
import type { Card, CardStatus, Priority } from '../../shared/types'
import { DELETED_COLUMN } from '../../shared/types'

export interface DropTarget {
  columnId: string
  index: number
}

interface KanbanBoardProps {
  onCardClick: (card: Card, e: React.MouseEvent) => void
  onAddCard: (status: string) => void
  onMoveCard: (cardId: string, newStatus: string, newOrder: number) => void
  onMoveCards: (cardIds: string[], newStatus: string) => void
  onEditColumn: (columnId: string) => void
  onRemoveColumn: (columnId: string) => void
  onCleanupColumn: (columnId: string) => void
  onPurgeDeletedCards: () => void
  onReorderColumns: (columnIds: string[]) => void
  selectedCardId?: string
  selectedCardIds: string[]
  onSelectAll: (status: string) => void
  onQuickAdd?: (data: { status: CardStatus; priority: Priority; content: string }) => void
  onTriggerAction?: (cardId: string, action: string) => void
}

export function KanbanBoard({ onCardClick, onAddCard, onMoveCard, onMoveCards, onEditColumn, onRemoveColumn, onCleanupColumn, onPurgeDeletedCards, onReorderColumns, selectedCardId, selectedCardIds, onSelectAll, onQuickAdd, onTriggerAction }: KanbanBoardProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const cardSettings = useStore((s) => s.cardSettings)
  const effectiveDrawerWidth = useStore((s) => s.effectiveDrawerWidth)
  const columns = useStore((s) => s.columns)
  const currentBoard = useStore((s) => s.currentBoard)
  const getFilteredCardsByStatus = useStore((s) => s.getFilteredCardsByStatus)
  const getCardsByStatus = useStore((s) => s.getCardsByStatus)
  const hiddenColumnIds = useStore((s) => s.getHiddenColumnIds(currentBoard))
  const minimizedColumnIds = useStore((s) => s.getMinimizedColumnIds(currentBoard))
  const toggleColumnMinimized = useStore((s) => s.toggleColumnMinimized)
  const layout = useStore((s) => s.layout)
  const columnSorts = useStore((s) => s.columnSorts)
  const setColumnSort = useStore((s) => s.setColumnSort)

  useEffect(() => {
    if (!selectedCardId) return
    const container = scrollContainerRef.current
    if (!container) return

    const doScroll = () => {
      const cardEl = container.querySelector<HTMLElement>(`[data-card-id="${selectedCardId}"]`)
      if (!cardEl) return
      const containerRect = container.getBoundingClientRect()
      const cardRect = cardEl.getBoundingClientRect()
      // The board container is pre-narrowed by App.tsx to exclude the active
      // drawer width, so containerRect.right is already the unobscured boundary.
      const isFullyVisible = cardRect.left >= containerRect.left && cardRect.right <= containerRect.right
      if (!isFullyVisible) {
        const overflow = cardRect.right - containerRect.right
        container.scrollBy({ left: overflow + 10, behavior: 'smooth' })
      }
    }

    // Use a short timeout so the drawer has had time to mount and React has
    // finished its render cycle before we measure positions.
    const id = setTimeout(doScroll, 50)
    return () => clearTimeout(id)
  }, [cardSettings.panelMode, effectiveDrawerWidth, selectedCardId])

  const [draggedCard, setDraggedCard] = useState<Card | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
  const draggedColumnIdRef = useRef<string | null>(null)
  const [dropColumnIndex, setDropColumnIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, card: Card) => {
    setDraggedCard(card)
    e.dataTransfer.effectAllowed = 'move'
    // If multi-selected, store all IDs; otherwise just the single card
    if (selectedCardIds.length > 1 && selectedCardIds.includes(card.id)) {
      e.dataTransfer.setData('text/plain', JSON.stringify(selectedCardIds))
    } else {
      e.dataTransfer.setData('text/plain', card.id)
    }
  }, [selectedCardIds])

  const handleDragOver = useCallback((e: React.DragEvent, columnId?: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedColumnIdRef.current) return
    if (columnId) {
      setDropTarget((prev) => {
        if (prev?.columnId === columnId) return prev
        return { columnId, index: 0 }
      })
    }
  }, [])

  const handleDragOverCard = useCallback(
    (e: React.DragEvent, columnId: string, cardIndex: number) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (draggedColumnIdRef.current) return

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const insertIndex = e.clientY < midY ? cardIndex : cardIndex + 1

      setDropTarget((prev) => {
        if (prev && prev.columnId === columnId && prev.index === insertIndex) return prev
        return { columnId, index: insertIndex }
      })
    },
    []
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, columnId: string) => {
      e.preventDefault()
      if (!draggedCard) return

      // Multi-card drop: if the dragged card is part of a multi-selection, move all selected cards
      if (selectedCardIds.length > 1 && selectedCardIds.includes(draggedCard.id)) {
        onMoveCards([...selectedCardIds], columnId)
        setDraggedCard(null)
        setDropTarget(null)
        return
      }

      const filteredCards = getFilteredCardsByStatus(columnId as CardStatus)
      let filteredInsertIndex: number

      if (dropTarget && dropTarget.columnId === columnId) {
        filteredInsertIndex = dropTarget.index
      } else {
        // Dropped on empty area of the column — append to end
        filteredInsertIndex = filteredCards.length
      }

      // Adjust index if dragging within the same column and moving downward
      if (draggedCard.status === columnId) {
        const currentIndex = filteredCards.findIndex((f) => f.id === draggedCard.id)
        if (currentIndex !== -1 && filteredInsertIndex > currentIndex) {
          filteredInsertIndex--
        }
        // No-op if dropping in the same position
        if (currentIndex === filteredInsertIndex) {
          setDraggedCard(null)
          setDropTarget(null)
          return
        }
      }

      // Translate filtered index to unfiltered index
      const allCards = getCardsByStatus(columnId as CardStatus)
        .filter((f) => f.id !== draggedCard.id)
      const filteredWithoutDragged = filteredCards.filter((f) => f.id !== draggedCard.id)

      let unfilteredInsertIndex: number

      if (filteredWithoutDragged.length === 0) {
        // No visible cards — append to end of unfiltered list
        unfilteredInsertIndex = allCards.length
      } else if (filteredInsertIndex >= filteredWithoutDragged.length) {
        // Inserting past end of filtered list — place after last visible card
        const lastVisible = filteredWithoutDragged[filteredWithoutDragged.length - 1]
        const lastVisibleUnfilteredIdx = allCards.findIndex((f) => f.id === lastVisible.id)
        unfilteredInsertIndex = lastVisibleUnfilteredIdx + 1
      } else {
        // Find the anchor card at the filtered insert position
        const anchorCard = filteredWithoutDragged[filteredInsertIndex]
        unfilteredInsertIndex = allCards.findIndex((f) => f.id === anchorCard.id)
      }

      onMoveCard(draggedCard.id, columnId, unfilteredInsertIndex)
      setDraggedCard(null)
      setDropTarget(null)
    },
    [draggedCard, dropTarget, selectedCardIds, getFilteredCardsByStatus, getCardsByStatus, onMoveCard, onMoveCards]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedCard(null)
    setDropTarget(null)
  }, [])

  const handleColumnDragStart = useCallback((e: React.DragEvent, columnId: string) => {
    draggedColumnIdRef.current = columnId
    setDraggedColumnId(columnId)
    setDropTarget(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-column-id', columnId)
  }, [])

  const handleColumnDragOver = useCallback((e: React.DragEvent, colIdx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const insertIndex = e.clientX < rect.left + rect.width / 2 ? colIdx : colIdx + 1
    setDropColumnIndex(prev => prev === insertIndex ? prev : insertIndex)
  }, [])

  const handleColumnDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!draggedColumnId || dropColumnIndex === null) {
      setDraggedColumnId(null)
      setDropColumnIndex(null)
      return
    }
    const hiddenColumnIdSet = new Set(hiddenColumnIds)
    const colIds = columns.map(c => c.id)
    const visibleColIds = colIds.filter((columnId) => !hiddenColumnIdSet.has(columnId))
    const fromIdx = visibleColIds.indexOf(draggedColumnId)
    if (fromIdx === -1) {
      setDraggedColumnId(null)
      setDropColumnIndex(null)
      return
    }
    const newVisibleIds = [...visibleColIds]
    newVisibleIds.splice(fromIdx, 1)
    const adjustedIdx = dropColumnIndex > fromIdx ? dropColumnIndex - 1 : dropColumnIndex
    newVisibleIds.splice(adjustedIdx, 0, draggedColumnId)
    if (newVisibleIds.join() !== visibleColIds.join()) {
      let visibleIndex = 0
      const nextColumnIds = colIds.map((columnId) => (
        hiddenColumnIdSet.has(columnId) ? columnId : newVisibleIds[visibleIndex++]
      ))
      onReorderColumns(nextColumnIds)
    }
    draggedColumnIdRef.current = null
    setDraggedColumnId(null)
    setDropColumnIndex(null)
  }, [columns, draggedColumnId, dropColumnIndex, hiddenColumnIds, onReorderColumns])

  const handleColumnDragEnd = useCallback(() => {
    draggedColumnIdRef.current = null
    setDraggedColumnId(null)
    setDropColumnIndex(null)
  }, [])

  const isVertical = layout === 'vertical'
  const hiddenColumnIdSet = new Set(hiddenColumnIds)
  const minimizedColumnIdSet = new Set(minimizedColumnIds)
  const visibleColumns = columns.filter((column) => !hiddenColumnIdSet.has(column.id))

  return (
    <div
      ref={scrollContainerRef}
      className={isVertical ? "h-full overflow-y-auto px-5 py-4" : "h-full overflow-x-auto px-5 py-4"}
    >
      <div className={isVertical ? "flex flex-col gap-5" : "flex gap-5 h-full min-w-max"}>
        {columns.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-400 dark:text-zinc-500">
            <Columns size={40} className="opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No lists yet</p>
              <p className="text-[12px] mt-1 text-zinc-400 dark:text-zinc-500">Click "Add List" in the toolbar to create your first column</p>
            </div>
          </div>
        )}
        {visibleColumns.map((column, colIdx) => (
          <KanbanColumn
            key={column.id}
            column={column}
            columnIndex={colIdx}
            cards={getFilteredCardsByStatus(column.id as CardStatus)}
            onCardClick={onCardClick}
            onAddCard={onAddCard}
            onEditColumn={onEditColumn}
            onRemoveColumn={onRemoveColumn}
            onCleanupColumn={onCleanupColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragOverCard={handleDragOverCard}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggedCard={draggedCard}
            dropTarget={dropTarget}
            draggedColumnId={draggedColumnId}
            dropColumnIndex={dropColumnIndex}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragOver={handleColumnDragOver}
            onColumnDrop={handleColumnDrop}
            onColumnDragEnd={handleColumnDragEnd}
            isMinimized={minimizedColumnIdSet.has(column.id)}
            onToggleMinimized={() => toggleColumnMinimized(currentBoard, column.id)}
            layout={layout}
            selectedCardId={selectedCardId}
            selectedCardIds={selectedCardIds}
            onSelectAll={onSelectAll}
            sort={(columnSorts[column.id] || 'order') as SortOrder}
            onSortChange={(s) => setColumnSort(column.id, s)}
            onQuickAdd={onQuickAdd}
            onTriggerAction={onTriggerAction}
          />
        ))}
        {cardSettings.showDeletedColumn && (
          <KanbanColumn
            key={DELETED_COLUMN.id}
            column={DELETED_COLUMN}
            columnIndex={columns.length}
            cards={getFilteredCardsByStatus(DELETED_COLUMN.id as CardStatus)}
            onCardClick={onCardClick}
            onAddCard={onAddCard}
            onEditColumn={onEditColumn}
            onRemoveColumn={onRemoveColumn}
            onCleanupColumn={onCleanupColumn}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragOverCard={handleDragOverCard}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            draggedCard={draggedCard}
            dropTarget={dropTarget}
            draggedColumnId={draggedColumnId}
            dropColumnIndex={dropColumnIndex}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragOver={handleColumnDragOver}
            onColumnDrop={handleColumnDrop}
            onColumnDragEnd={handleColumnDragEnd}
            layout={layout}
            isDeletedColumn
            onPurgeColumn={onPurgeDeletedCards}
            selectedCardId={selectedCardId}
            selectedCardIds={selectedCardIds}
            onSelectAll={onSelectAll}
            sort={(columnSorts[DELETED_COLUMN.id] || 'order') as SortOrder}
            onSortChange={(s) => setColumnSort(DELETED_COLUMN.id, s)}
          />
        )}
      </div>
    </div>
  )
}
